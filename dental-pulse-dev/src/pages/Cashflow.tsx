import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import {
  totalCashFlowData,
  cashCollectionByCategory,
  cashPaidByCategory,
  closingBalanceTrend,
  topThreeCashGenerating,
  outliersTopMetrics,
  outliersCashflowWise,
  stabilityReport,
  sustainabilityReport,
  scalingReport,
  freeCashFlowTotal,
} from '@/data/cashflowData';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Calendar, FileText } from 'lucide-react';
import { formatGbp } from '@/utils/formatMoney';

const formatCurrency = (value: number): string => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000000) {
    const compact = `${(abs / 1000000).toFixed(2)}M`;
    return n < 0 ? `(£${compact})` : `£${compact}`;
  }
  if (abs >= 1000) {
    const compact = `${(abs / 1000).toFixed(0)}K`;
    return n < 0 ? `(£${compact})` : `£${compact}`;
  }
  return formatGbp(n);
};

// Merge total cash flow into Recharts format
const totalCashFlowChartData = totalCashFlowData.data.xAxis.map((mon, i) => ({
  month: mon,
  Received: totalCashFlowData.data.dataSet.find((s) => s.name === 'Income')?.data[i] ?? 0,
  Paid: (totalCashFlowData.data.dataSet.find((s) => s.name === 'Payment')?.data[i] ?? 0) * -1,
}));

const PIE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#8b5cf6', '#ec4899'];

export default function Cashflow() {
  const [dateLabel] = useState('This Year'); // Placeholder for future date filter

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const inflowRows = cashCollectionByCategory
    .map((r) => ({ category: r.rangeGroup, amount: round2(r.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);

  const outflowRows = cashPaidByCategory
    .map((r) => ({ category: r.rangeGroup, amount: round2(Math.abs(r.amount)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);

  const closingTrendRows = closingBalanceTrend
    .slice(-12)
    .map((r) => ({ period: r.name, value: round2(r.value) }));

  // Biggest deltas: change from previous month in closing balance
  const closingDeltas = closingTrendRows
    .map((row, i) => {
      if (i === 0) return null;
      const prev = closingTrendRows[i - 1];
      return { period: row.period, delta: round2(row.value - prev.value) };
    })
    .filter((x): x is { period: string; delta: number } => x !== null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

  const totalIncome = totalCashFlowData.data.dataSet.find((s) => s.name === 'Income')?.data.reduce((a, b) => a + b, 0) ?? 0;
  const totalPayment = totalCashFlowData.data.dataSet.find((s) => s.name === 'Payment')?.data.reduce((a, b) => a + b, 0) ?? 0;

  const cashflowContext = {
    totalIncome: round2(totalIncome),
    totalPayment: round2(totalPayment),
    closingBalance: round2(closingBalanceTrend[closingBalanceTrend.length - 1]?.value ?? 0),
    freeCashFlow: round2(freeCashFlowTotal()),
    topCategories: topThreeCashGenerating,
    period: { label: dateLabel },
    rows: {
      inflowCategories: inflowRows,
      outflowCategories: outflowRows,
      closingBalanceTrend: closingTrendRows,
      topCashGenerating: topThreeCashGenerating.map((r) => ({ category: r.category, amount: round2(r.amount) })).slice(0, 50),
    },
    rankings: {
      topInflowCategories: inflowRows.slice(0, 10),
      topOutflowCategories: outflowRows.slice(0, 10),
      biggestClosingBalanceDeltas: closingDeltas,
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'cashflow', data: cashflowContext }}>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cash Flow</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Overview of cash received, paid, closing balance and free cash flow (reference: Version 2.0)
            </p>
            <Link
              to="/cashflow/preparing-statement"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline mt-2"
            >
              <FileText className="w-4 h-4" />
              Cash Flow Statement
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
            <Calendar className="w-4 h-4" />
            <span>{dateLabel}</span>
          </div>
        </div>

        <AISummaryCard page="cashflow" data={cashflowContext} />

        {/* Total Monthly Cash Received and Paid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Monthly Cash Received and Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={totalCashFlowChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(Math.abs(v))} />
                  <Tooltip formatter={(v: number) => [formatCurrency(Math.abs(v)), '']} labelFormatter={(l) => l} />
                  <Legend />
                  <Bar dataKey="Received" fill="#22c55e" name="Received" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Paid" fill="#ef4444" name="Paid" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <h3 className="text-lg font-medium text-foreground">Past (What has happened)</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cash Collected by category */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash Collected in a Specific Period</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col md:flex-row gap-4">
              <div className="h-[220px] w-full md:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={cashCollectionByCategory}
                      dataKey="amount"
                      nameKey="rangeGroup"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ rangeGroup, percent }) => `${rangeGroup} ${(percent * 100).toFixed(0)}%`}
                    >
                      {cashCollectionByCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 flex-1">
                {cashCollectionByCategory.map((row, i) => (
                  <li key={i} className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{row.rangeGroup}</span>
                    <span className={cn('font-medium', row.amount >= 0 ? 'text-success' : 'text-destructive')}>
                      {formatCurrency(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Cash Paid by category */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash Paid in a Specific Period</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col md:flex-row gap-4">
              <div className="h-[220px] w-full md:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={cashPaidByCategory}
                      dataKey="amount"
                      nameKey="rangeGroup"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ rangeGroup, percent }) => `${rangeGroup} ${(percent * 100).toFixed(0)}%`}
                    >
                      {cashPaidByCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 flex-1">
                {cashPaidByCategory.map((row, i) => (
                  <li key={i} className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{row.rangeGroup}</span>
                    <span className={cn('font-medium', row.amount >= 0 ? 'text-success' : 'text-destructive')}>
                      {formatCurrency(-Math.abs(row.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Closing Cash Balance Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closing Cash Balance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={closingBalanceTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v), 'Closing balance']} />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Closing balance" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <h3 className="text-lg font-medium text-foreground">Present (What is happening)</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 3 Cash Generating */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 3 Cash Generating Products/Services</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {topThreeCashGenerating.map((row, i) => (
                  <li key={i} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{row.category}</span>
                    <span className={cn('font-semibold', row.amount >= 0 ? 'text-success' : 'text-destructive')}>
                      {formatCurrency(row.amount)}
                    </span>
                  </li>
                ))}
                {topThreeCashGenerating.length === 0 && (
                  <li className="text-muted-foreground text-sm">No data yet</li>
                )}
              </ul>
            </CardContent>
          </Card>

          {/* Outliers – Top 5 Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outliers – Top 5 Metrics That Matter</CardTitle>
              <p className="text-xs text-muted-foreground">{dateLabel}</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium">Metric</th>
                      <th className="text-right py-2 font-medium">Amount</th>
                      <th className="text-right py-2 font-medium">% of Receipts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outliersTopMetrics.map((row, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 text-muted-foreground">{row.name}</td>
                        <td className={cn('py-2 text-right font-medium', row.amount < 0 ? 'text-destructive' : 'text-success')}>
                          {formatCurrency(row.amount)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">{row.per}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-sm font-medium mt-4 mb-2">Your Cash Flow Margins</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium">Metric</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                    <th className="text-right py-2 font-medium">% of Receipts</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="py-2 text-muted-foreground">{outliersCashflowWise.cashReceipt.name}</td>
                    <td className="py-2 text-right font-medium text-success">{formatCurrency(outliersCashflowWise.cashReceipt.amount)}</td>
                    <td className="py-2 text-right text-muted-foreground">{outliersCashflowWise.cashReceipt.per}%</td>
                  </tr>
                  {outliersCashflowWise.outliersTopMetrics.map((row, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 text-muted-foreground">{row.name}</td>
                      <td className={cn('py-2 text-right font-medium', row.amount < 0 ? 'text-destructive' : 'text-success')}>
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{row.per}%</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-2">{outliersCashflowWise.moneyLeft.name}</td>
                    <td className={cn('py-2 text-right', outliersCashflowWise.moneyLeft.amount < 0 ? 'text-destructive' : 'text-success')}>
                      {formatCurrency(outliersCashflowWise.moneyLeft.amount)}
                    </td>
                    <td className="py-2 text-right">{outliersCashflowWise.moneyLeft.per}%</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <h3 className="text-lg font-medium text-foreground">Future (What will happen)</h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* When/If run out of money – Stability */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">When and If, You Are Going to Run Out of Money</CardTitle>
            </CardHeader>
            <CardContent>
              {!stabilityReport?.mon ? (
                <p className="text-muted-foreground text-sm">You have a positive cash flow.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{stabilityReport.mon}</span>
                    <span className={cn('font-semibold', stabilityReport.amount < 0 ? 'text-destructive' : 'text-success')}>
                      {formatCurrency(stabilityReport.amount)}
                    </span>
                  </div>
                  {stabilityReport.overdraftLimit > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Headroom</span>
                      <span className="font-medium">
                        {formatCurrency(stabilityReport.overdraftLimit + stabilityReport.amount)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Biggest 3 tax or one-off cash outflow – Sustainability */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Biggest 3 Tax or One-Off Cash Outflow Coming Up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-2">One-off expenses</p>
                <ul className="space-y-2">
                  {sustainabilityReport.oneOffExpenseRecords.map((row, i) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{row.location} {row.mon}</span>
                      <span className="text-destructive font-medium">{formatCurrency(row.amount)}</span>
                    </li>
                  ))}
                  {sustainabilityReport.oneOffExpenseRecords.length === 0 && (
                    <li className="text-muted-foreground text-sm">No data</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Taxes</p>
                <ul className="space-y-2">
                  {sustainabilityReport.taxRecords.map((row, i) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{row.location} {row.mon}</span>
                      <span className="text-destructive font-medium">{formatCurrency(row.amount)}</span>
                    </li>
                  ))}
                  {sustainabilityReport.taxRecords.length === 0 && (
                    <li className="text-muted-foreground text-sm">No data</li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Free Cash Flow – Scaling */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Free Cash Flow (Re-invest in Your Business)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {scalingReport.map((row, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.name}</span>
                    <span className={cn('font-medium', row.amount >= 0 ? 'text-success' : 'text-destructive')}>
                      {formatCurrency(row.amount)}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between font-semibold pt-2 border-t border-border">
                  <span>Your Free Cash Flow</span>
                  <span className={freeCashFlowTotal() >= 0 ? 'text-success' : 'text-destructive'}>
                    {formatCurrency(freeCashFlowTotal())}
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
