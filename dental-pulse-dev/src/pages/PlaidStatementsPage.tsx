import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  ArrowLeft, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2,
} from 'lucide-react';
import { DatePicker, ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';

interface Transaction {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string;
  category: string[] | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
  pending: boolean;
}

interface Connection {
  id: string;
  institution_name: string | null;
  institution_logo: string | null;
  institution_color: string | null;
  status: string;
}

function txCategory(tx: Transaction): string {
  if (tx.category?.length) return tx.category[tx.category.length - 1];
  const pfc = tx.personal_finance_category?.detailed || tx.personal_finance_category?.primary;
  if (pfc) return pfc.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return '—';
}

interface StatementsData {
  institutionName: string | null;
  institutionLogo: string | null;
  accounts: any[];
  transactions: Transaction[];
  totalIn: number;
  totalOut: number;
  netFlow: number;
  transactionCount: number;
  dateRange: { start: string; end: string };
}

function fmt(amount: number, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Math.abs(amount));
}

function defaultDates() {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const iso = (d: Date) => d.toISOString().split('T')[0];
  return { start: iso(start), end: iso(end) };
}

export default function PlaidStatementsPage() {
  const { connId }     = useParams<{ connId: string }>();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const orgId          = searchParams.get('orgId');

  const [dates, setDates]           = useState(defaultDates);
  const [data,  setData]            = useState<StatementsData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    if (!orgId) return;
    PlaidService.getConnections(orgId)
      .then((res: any) => setConnections(res.connections || []))
      .catch(() => {});
  }, [orgId]);

  const fetchData = async () => {
    if (!connId) return;
    setLoading(true);
    try {
      const res = await PlaidService.getTransactions(connId, dates.start, dates.end);
      setData(res);
    } catch (e: any) {
      toast.error('Failed to load statements', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [connId, dates.start, dates.end]);

  const handleSwitchBank = (newConnId: string) => {
    if (newConnId === connId) return;
    navigate(`/plaid/statements/${newConnId}?orgId=${encodeURIComponent(orgId ?? '')}`, { replace: true });
  };

  const accountName = (accountId: string) =>
    data?.accounts.find(a => a.plaid_account_id === accountId)?.name || '';

  const logoSrc = data?.institutionLogo
    ? `data:image/png;base64,${data.institutionLogo}`
    : null;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-6xl mx-auto p-6 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="w-px h-5 bg-border" />

          {connections.length > 1 ? (
            <Select value={connId} onValueChange={handleSwitchBank}>
              <SelectTrigger className="w-auto gap-2 border-none shadow-none bg-transparent px-2 h-auto focus:ring-0 hover:bg-muted/60 rounded-lg transition-colors">
                <div className="flex items-center gap-2.5">
                  {logoSrc && <img src={logoSrc} alt="" className="w-7 h-7 rounded-md object-contain shrink-0" />}
                  <div className="text-left">
                    <p className="text-base font-bold leading-tight">{data?.institutionName || 'Bank Statements'}</p>
                    <p className="text-xs text-muted-foreground">Open Banking via Plaid</p>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                {connections.map(conn => {
                  const logo     = conn.institution_logo ? `data:image/png;base64,${conn.institution_logo}` : null;
                  const initials = (conn.institution_name || 'BK').slice(0, 2).toUpperCase();
                  return (
                    <SelectItem key={conn.id} value={conn.id}>
                      <div className="flex items-center gap-2.5 py-0.5">
                        {logo ? (
                          <img src={logo} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                        ) : (
                          <span className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                            style={{ background: conn.institution_color || 'linear-gradient(135deg,#1e40af,#3b82f6)' }}>
                            {initials}
                          </span>
                        )}
                        <span className="text-sm">{conn.institution_name || 'Bank Account'}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2.5">
              {logoSrc && <img src={logoSrc} alt={data?.institutionName || ''} className="w-8 h-8 rounded-lg object-contain" />}
              <div>
                <h1 className="text-xl font-bold">{data?.institutionName || 'Bank Statements'}</h1>
                <p className="text-sm text-muted-foreground">Open Banking via Plaid</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Toolbar: date picker ── */}
        <Card className="shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range</span>
              <ConfigProvider theme={{ token: { colorPrimary: 'hsl(244, 48%, 25%)' } }}>
                <DatePicker.RangePicker
                  value={[dayjs(dates.start), dayjs(dates.end)]}
                  onChange={(vals: [Dayjs | null, Dayjs | null] | null) => {
                    if (vals?.[0] && vals?.[1]) {
                      setDates({ start: vals[0].format('YYYY-MM-DD'), end: vals[1].format('YYYY-MM-DD') });
                    }
                  }}
                  format="DD MMM YYYY"
                  style={{ width: 260 }}
                  disabledDate={d => d && d.isAfter(dayjs())}
                />
              </ConfigProvider>
              <button
                onClick={fetchData}
                disabled={loading}
                className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </button>
            </div>
          </CardContent>
        </Card>

        {/* ── Summary cards ── */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Money In */}
            <Card className="shadow-sm border-l-4 border-l-green-500">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                    <TrendingDown className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Money In</span>
                </div>
                <p className="text-xl font-bold text-green-600 tabular-nums">{fmt(data.totalIn)}</p>
              </CardContent>
            </Card>
            {/* Money Out */}
            <Card className="shadow-sm border-l-4 border-l-red-500">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-3.5 h-3.5 text-red-600" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Money Out</span>
                </div>
                <p className="text-xl font-bold text-red-600 tabular-nums">{fmt(data.totalOut)}</p>
              </CardContent>
            </Card>
            {/* Net Flow */}
            <Card className={`shadow-sm border-l-4 ${data.netFlow >= 0 ? 'border-l-blue-500' : 'border-l-orange-500'}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${data.netFlow >= 0 ? 'bg-blue-100' : 'bg-orange-100'}`}>
                    <Minus className={`w-3.5 h-3.5 ${data.netFlow >= 0 ? 'text-blue-600' : 'text-orange-600'}`} />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Net Flow</span>
                </div>
                <p className={`text-xl font-bold tabular-nums ${data.netFlow >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {data.netFlow >= 0 ? '+' : '-'}{fmt(data.netFlow)}
                </p>
              </CardContent>
            </Card>
            {/* Transactions count */}
            <Card className="shadow-sm border-l-4 border-l-slate-400">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Transactions</span>
                </div>
                <p className="text-xl font-bold tabular-nums">{data.transactionCount}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Transactions table ── */}
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="py-3 px-5 border-b bg-muted/20">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                Transactions
              </CardTitle>
              {data && data.transactions.length > 0 && (
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-xs">
                    <TrendingDown className="w-3 h-3 text-green-500" />
                    <span className="text-muted-foreground">Total In</span>
                    <span className="font-semibold text-green-600">{fmt(data.totalIn)}</span>
                  </span>
                  <span className="w-px h-4 bg-border" />
                  <span className="flex items-center gap-1.5 text-xs">
                    <TrendingUp className="w-3 h-3 text-red-500" />
                    <span className="text-muted-foreground">Total Out</span>
                    <span className="font-semibold text-red-600">{fmt(data.totalOut)}</span>
                  </span>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading && (
              <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading transactions…
              </div>
            )}
            {!loading && data && data.transactions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Minus className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No transactions in this date range</p>
              </div>
            )}
            {!loading && data && data.transactions.length > 0 && (
              <>
                {/* Fixed header — outside the scroll container so it truly sticks */}
                <div className="border-b bg-card">
                  <table className="table-fixed w-full text-sm">
                    <thead>
                      <tr>
                        <th className="w-[10%] h-10 px-4 text-left text-xs font-semibold text-foreground/70">Date</th>
                        <th className="w-[13%] h-10 px-4 text-left text-xs font-semibold text-foreground/70">Transaction ID</th>
                        <th className="w-[18%] h-10 px-4 text-left text-xs font-semibold text-foreground/70">Description</th>
                        <th className="w-[16%] h-10 px-4 text-left text-xs font-semibold text-foreground/70">Account</th>
                        <th className="w-[16%] h-10 px-4 text-left text-xs font-semibold text-foreground/70">Category</th>
                        <th className="w-[12%] h-10 px-4 text-right text-xs font-semibold text-green-700">Money In</th>
                        <th className="w-[12%] h-10 px-4 text-right text-xs font-semibold text-red-600">Money Out</th>
                        <th className="w-[9%] h-10 px-4 text-right text-xs font-semibold text-foreground/70">Status</th>
                      </tr>
                    </thead>
                  </table>
                </div>

                {/* Scrollable body — separate container */}
                <div className="overflow-y-auto max-h-[calc(100vh-460px)]">
                  <table className="table-fixed w-full text-sm">
                    <colgroup>
                      <col className="w-[10%]" /><col className="w-[13%]" />
                      <col className="w-[18%]" /><col className="w-[16%]" />
                      <col className="w-[16%]" /><col className="w-[12%]" />
                      <col className="w-[12%]" /><col className="w-[9%]" />
                    </colgroup>
                    <tbody>
                      {data.transactions.map((tx, idx) => {
                        const moneyIn  = tx.amount < 0 ? Math.abs(tx.amount) : null;
                        const moneyOut = tx.amount > 0 ? tx.amount : null;
                        const cat      = txCategory(tx);
                        return (
                          <tr
                            key={tx.transaction_id}
                            className={idx % 2 === 0 ? 'bg-background hover:bg-muted/30' : 'bg-muted/20 hover:bg-muted/40'}
                          >
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                              {new Date(tx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-2.5 overflow-hidden">
                              <span title={tx.transaction_id} className="text-xs text-blue-500 font-mono cursor-default block truncate">
                                {tx.transaction_id.slice(0, 16)}…
                              </span>
                            </td>
                            <td className="px-4 py-2.5 overflow-hidden">
                              <p className="text-sm font-medium truncate" title={tx.merchant_name || tx.name}>
                                {tx.merchant_name || tx.name}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 overflow-hidden">
                              <span className="text-xs text-muted-foreground block truncate" title={accountName(tx.account_id)}>
                                {accountName(tx.account_id)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 overflow-hidden">
                              {cat !== '—' ? (
                                <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 truncate max-w-full" title={cat}>
                                  {cat}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap overflow-hidden">
                              {moneyIn != null && (
                                <span className="text-sm font-semibold text-green-600 tabular-nums">
                                  +{tx.iso_currency_code} {moneyIn.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap overflow-hidden">
                              {moneyOut != null && (
                                <span className="text-sm font-semibold text-red-600 tabular-nums">
                                  -{tx.iso_currency_code} {moneyOut.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right overflow-hidden">
                              {tx.pending ? (
                                <Badge variant="outline" className="text-[10px] font-medium text-amber-600 border-amber-200 bg-amber-50">
                                  Pending
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] font-medium text-green-600 border-green-200 bg-green-50">
                                  Settled
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
