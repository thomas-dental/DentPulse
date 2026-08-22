import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { FileText, ArrowUpDown, Wallet, Clock, RefreshCw, AlertCircle, CheckCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { useIplicitData } from '@/hooks/useIplicitData';
import { useAccountingConnections } from '@/hooks/useAccountingConnections';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface IplicitDataDashboardProps {
  organizationId?: string;
}

const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `£${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `£${(value / 1000).toFixed(1)}K`;
  }
  return `£${value.toFixed(2)}`;
};

const formatDate = (date: string | null): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--danger))',
  'hsl(var(--accent))',
];

export function IplicitDataDashboard({ organizationId }: IplicitDataDashboardProps) {
  const { 
    invoices, 
    transactions, 
    accountBalances, 
    syncLogs, 
    summary, 
    isLoading, 
    error,
    refetch 
  } = useIplicitData(organizationId);
  
  const { connections, syncConnection } = useAccountingConnections(organizationId);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    const activeConnection = connections.find(c => c.status === 'connected');
    if (!activeConnection) return;

    setIsSyncing(true);
    await syncConnection(activeConnection.id);
    await refetch();
    setIsSyncing(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-danger/50 bg-danger-muted">
        <CardContent className="flex items-center gap-3 py-4">
          <AlertCircle className="h-5 w-5 text-danger" />
          <span className="text-danger">{error}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!summary || (invoices.length === 0 && transactions.length === 0 && accountBalances.length === 0)) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Financial Data Yet</h3>
          <p className="text-muted-foreground text-sm max-w-md mb-4">
            Connect to iplicit and sync your data to see invoices, transactions, and account balances here.
          </p>
          {connections.length > 0 && connections[0].status === 'connected' && (
            <Button onClick={handleSync} disabled={isSyncing}>
              <RefreshCw className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data
  const invoicesByStatus = invoices.reduce((acc, inv) => {
    const status = inv.status || 'Unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const invoiceStatusData = Object.entries(invoicesByStatus).map(([name, value]) => ({
    name,
    value,
  }));

  const accountsByType = accountBalances.reduce((acc, bal) => {
    const type = bal.account_type || 'Other';
    acc[type] = (acc[type] || 0) + Number(bal.balance);
    return acc;
  }, {} as Record<string, number>);

  const accountTypeData = Object.entries(accountsByType)
    .map(([name, value]) => ({
      name,
      value: Math.abs(value),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // Monthly invoice trend
  const monthlyInvoices = invoices.reduce((acc, inv) => {
    if (!inv.issue_date) return acc;
    const month = new Date(inv.issue_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    acc[month] = (acc[month] || 0) + Number(inv.amount);
    return acc;
  }, {} as Record<string, number>);

  const monthlyTrendData = Object.entries(monthlyInvoices)
    .slice(-6)
    .map(([month, amount]) => ({ month, amount }));

  return (
    <div className="space-y-6">
      {/* Header with Sync Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">iplicit Financial Data</h2>
          {summary.lastSync && (
            <p className="text-sm text-muted-foreground">
              Last synced: {formatDate(summary.lastSync)}
            </p>
          )}
        </div>
        <Button 
          onClick={handleSync} 
          disabled={isSyncing || connections.length === 0}
          variant="outline"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")} />
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Total Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalInvoices}</div>
            <p className="text-sm text-muted-foreground">
              Value: {formatCurrency(summary.totalInvoiceValue)}
            </p>
          </CardContent>
        </Card>

        <Card className={cn(summary.overdueInvoices > 0 && "border-warning/50")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Unpaid Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.unpaidInvoices}</div>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(summary.unpaidValue)}
              {summary.overdueInvoices > 0 && (
                <span className="text-warning ml-2">
                  ({summary.overdueInvoices} overdue)
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {formatCurrency(summary.totalAssets)}
            </div>
            <p className="text-sm text-muted-foreground">
              Across {accountBalances.filter(a => a.account_type?.toLowerCase().includes('asset')).length} accounts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Total Liabilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-danger">
              {formatCurrency(summary.totalLiabilities)}
            </div>
            <p className="text-sm text-muted-foreground">
              {summary.totalTransactions} transactions recorded
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoice Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice Value Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis 
                    tickFormatter={(v) => `£${(v / 1000).toFixed(0)}K`}
                    className="text-xs"
                  />
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), 'Amount']}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No invoice data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Balances by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account Balances by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {accountTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={accountTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {accountTypeData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), 'Balance']}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No account data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="invoices">
            <TabsList className="mb-4">
              <TabsTrigger value="invoices" className="gap-2">
                <FileText className="h-4 w-4" />
                Invoices ({invoices.length})
              </TabsTrigger>
              <TabsTrigger value="transactions" className="gap-2">
                <ArrowUpDown className="h-4 w-4" />
                Transactions ({transactions.length})
              </TabsTrigger>
              <TabsTrigger value="accounts" className="gap-2">
                <Wallet className="h-4 w-4" />
                Accounts ({accountBalances.length})
              </TabsTrigger>
              <TabsTrigger value="logs" className="gap-2">
                <Clock className="h-4 w-4" />
                Sync Logs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="invoices" className="mt-0">
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Invoice #</th>
                      <th>Customer</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                      <th>Issue Date</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.slice(0, 10).map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="font-medium">{invoice.invoice_number || invoice.external_id}</td>
                        <td>{invoice.customer_name || '-'}</td>
                        <td className="text-right font-mono">{formatCurrency(invoice.amount)}</td>
                        <td>
                          <Badge 
                            variant={
                              invoice.status === 'paid' || invoice.status === 'Paid' 
                                ? 'default' 
                                : invoice.status === 'overdue' 
                                ? 'destructive' 
                                : 'secondary'
                            }
                          >
                            {invoice.status || 'Unknown'}
                          </Badge>
                        </td>
                        <td>{formatDate(invoice.issue_date)}</td>
                        <td>{formatDate(invoice.due_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {invoices.length > 10 && (
                  <p className="text-sm text-muted-foreground mt-3 text-center">
                    Showing 10 of {invoices.length} invoices
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="transactions" className="mt-0">
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Account</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 10).map((tx) => (
                      <tr key={tx.id}>
                        <td>{formatDate(tx.transaction_date)}</td>
                        <td>
                          <Badge variant="outline">{tx.transaction_type || 'General'}</Badge>
                        </td>
                        <td className="max-w-xs truncate">{tx.description || '-'}</td>
                        <td>{tx.account_name || tx.account_code || '-'}</td>
                        <td className={cn(
                          "text-right font-mono",
                          tx.amount >= 0 ? "text-success" : "text-danger"
                        )}>
                          {formatCurrency(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {transactions.length > 10 && (
                  <p className="text-sm text-muted-foreground mt-3 text-center">
                    Showing 10 of {transactions.length} transactions
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="accounts" className="mt-0">
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Code</th>
                      <th>Account Name</th>
                      <th>Type</th>
                      <th className="text-right">Balance</th>
                      <th>As Of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountBalances.map((account) => (
                      <tr key={account.id}>
                        <td className="font-mono">{account.account_code}</td>
                        <td className="font-medium">{account.account_name || '-'}</td>
                        <td>
                          <Badge variant="outline">{account.account_type || 'Unknown'}</Badge>
                        </td>
                        <td className={cn(
                          "text-right font-mono",
                          account.balance >= 0 ? "text-success" : "text-danger"
                        )}>
                          {formatCurrency(account.balance)}
                        </td>
                        <td>{formatDate(account.as_of_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="logs" className="mt-0">
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Started</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Records</th>
                      <th>Duration</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLogs.map((log) => {
                      const duration = log.completed_at 
                        ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                        : null;
                      
                      return (
                        <tr key={log.id}>
                          <td>{formatDate(log.started_at)}</td>
                          <td>
                            <Badge variant="outline">
                              {log.sync_type === 'scheduled' ? 'Scheduled' : 'Manual'}
                            </Badge>
                          </td>
                          <td>
                            <Badge 
                              variant={
                                log.status === 'completed' 
                                  ? 'default' 
                                  : log.status === 'failed' 
                                  ? 'destructive' 
                                  : 'secondary'
                              }
                              className="gap-1"
                            >
                              {log.status === 'completed' && <CheckCircle className="h-3 w-3" />}
                              {log.status === 'failed' && <AlertCircle className="h-3 w-3" />}
                              {log.status === 'in_progress' && <RefreshCw className="h-3 w-3 animate-spin" />}
                              {log.status}
                            </Badge>
                          </td>
                          <td>{log.records_synced || 0}</td>
                          <td>{duration !== null ? `${duration}s` : '-'}</td>
                          <td className="text-danger text-sm max-w-xs truncate">
                            {log.error_message || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
