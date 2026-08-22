import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import {
  ArrowLeft,
  FileText,
  Calendar,
  Building2,
  Search,
  Download,
  Filter,
  Loader2,
  TrendingUp,
  TrendingDown,
  Banknote,
  Receipt,
  Settings,
} from 'lucide-react';

interface LabFeeAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

interface LabFeeTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  account_name: string;
  account_code: string;
  reference?: string;
  supplier?: string;
  status: 'paid' | 'pending' | 'overdue';
}

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `£${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `£${(value / 1000).toFixed(1)}K`;
  return `£${value.toFixed(2)}`;
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export default function LabFeesView() {
  const navigate = useNavigate();
  const { organization } = useOrganization();

  const [labFeeAccounts, setLabFeeAccounts] = useState<LabFeeAccount[]>([]);
  const [labFeeTransactions, setLabFeeTransactions] = useState<LabFeeTransaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<LabFeeTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Fetch lab fee data
  useEffect(() => {
    const fetchLabFeeData = async () => {
      if (!organization?.id) return;

      setIsLoading(true);
      try {
        // Get lab_fees setting from organization
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('lab_fees')
          .eq('id', organization.id)
          .single();

        if (orgError) throw orgError;

        if (orgData?.lab_fees) {
          const labFeesConfig = JSON.parse(orgData.lab_fees);
          const accountIds = labFeesConfig.selected_account || [];

          if (accountIds.length > 0) {
            // Fetch account details
            const { data: accountsData, error: accountsError } = await (supabase as any)
              .from('xero_chart_of_accounts')
              .select('id, account_code, account_name, account_type')
              .in('id', accountIds);

            if (accountsError) throw accountsError;
            setLabFeeAccounts(accountsData || []);

            // Generate mock transactions for demo
            const mockTransactions: LabFeeTransaction[] = [];
            const suppliers = [
              'Crown Lab Ltd',
              'Dental Ceramics Co',
              'ProLab Dental',
              'Premier Dental Lab',
              'UK Dental Labs',
              'Quality Crowns Ltd',
              'Precision Dental',
              'Elite Lab Services',
            ];
            const statuses: ('paid' | 'pending' | 'overdue')[] = ['paid', 'paid', 'paid', 'pending', 'overdue'];

            (accountsData || []).forEach((account: LabFeeAccount) => {
              // Generate 30 transactions per account
              for (let i = 0; i < 30; i++) {
                const daysAgo = Math.floor(Math.random() * 180);
                const date = new Date();
                date.setDate(date.getDate() - daysAgo);

                mockTransactions.push({
                  id: `${account.id}-${i}`,
                  date: date.toISOString().split('T')[0],
                  description: `Lab work - ${['Crowns', 'Bridges', 'Dentures', 'Implants', 'Veneers'][Math.floor(Math.random() * 5)]}`,
                  amount: Math.floor(Math.random() * 4500) + 500,
                  account_name: account.account_name,
                  account_code: account.account_code,
                  reference: `INV-${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}`,
                  supplier: suppliers[Math.floor(Math.random() * suppliers.length)],
                  status: statuses[Math.floor(Math.random() * statuses.length)],
                });
              }
            });

            // Sort by date descending
            mockTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setLabFeeTransactions(mockTransactions);
            setFilteredTransactions(mockTransactions);
          }
        }
      } catch (error) {
        console.error('Error fetching lab fee data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLabFeeData();
  }, [organization?.id]);

  // Filter transactions
  useEffect(() => {
    let filtered = [...labFeeTransactions];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.description.toLowerCase().includes(term) ||
          t.supplier?.toLowerCase().includes(term) ||
          t.reference?.toLowerCase().includes(term)
      );
    }

    if (selectedAccount !== 'all') {
      filtered = filtered.filter((t) => t.account_code === selectedAccount);
    }

    if (selectedStatus !== 'all') {
      filtered = filtered.filter((t) => t.status === selectedStatus);
    }

    setFilteredTransactions(filtered);
  }, [searchTerm, selectedAccount, selectedStatus, labFeeTransactions]);

  // Calculate summary stats
  const totalAmount = filteredTransactions.reduce((sum, t) => sum + t.amount, 0);
  const paidAmount = filteredTransactions.filter((t) => t.status === 'paid').reduce((sum, t) => sum + t.amount, 0);
  const pendingAmount = filteredTransactions.filter((t) => t.status === 'pending').reduce((sum, t) => sum + t.amount, 0);
  const overdueAmount = filteredTransactions.filter((t) => t.status === 'overdue').reduce((sum, t) => sum + t.amount, 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Paid</Badge>;
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pending</Badge>;
      case 'overdue':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Overdue</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Lab Fees Transactions</title>
        <meta name="description" content="View detailed lab fee transactions, accounts, and transaction history with filtering and export capabilities." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/lab-fees')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Lab Fees Transactions</h1>
              <p className="text-muted-foreground">View and manage lab fee accounts and transactions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/organization')}>
              <Settings className="w-4 h-4 mr-2" />
              Configure Accounts
            </Button>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {labFeeAccounts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Building2 className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Lab Fee Accounts Configured</h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                To view lab fee transactions, you need to configure which accounts are used for lab fees in your Organization Settings.
              </p>
              <Button onClick={() => navigate('/organization')}>
                <Settings className="w-4 h-4 mr-2" />
                Go to Organization Settings
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Lab Fees</p>
                      <p className="text-2xl font-bold">{formatCurrency(totalAmount)}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Banknote className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {filteredTransactions.length} transactions
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Paid</p>
                      <p className="text-2xl font-bold text-green-600">{formatCurrency(paidAmount)}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <TrendingDown className="w-5 h-5 text-green-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {filteredTransactions.filter((t) => t.status === 'paid').length} transactions
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Pending</p>
                      <p className="text-2xl font-bold text-yellow-600">{formatCurrency(pendingAmount)}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-yellow-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {filteredTransactions.filter((t) => t.status === 'pending').length} transactions
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Overdue</p>
                      <p className="text-2xl font-bold text-red-600">{formatCurrency(overdueAmount)}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {filteredTransactions.filter((t) => t.status === 'overdue').length} transactions
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Linked Accounts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Linked Accounts</CardTitle>
                <CardDescription>Chart of accounts configured for lab fees</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {labFeeAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{account.account_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {account.account_code} • {account.account_type}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {labFeeTransactions.filter((t) => t.account_code === account.account_code).length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Transactions Table */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">Transactions</CardTitle>
                    <CardDescription>All lab fee transactions from your accounting system</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search transactions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 w-[200px]"
                      />
                    </div>
                    <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                      <SelectTrigger className="w-[180px]">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="All Accounts" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Accounts</SelectItem>
                        {labFeeAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.account_code}>
                            {account.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="All Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Date</th>
                          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Supplier</th>
                          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Description</th>
                          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Account</th>
                          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Reference</th>
                          <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground">Status</th>
                          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-muted-foreground">
                              No transactions found matching your filters.
                            </td>
                          </tr>
                        ) : (
                          filteredTransactions.slice(0, 50).map((transaction) => (
                            <tr
                              key={transaction.id}
                              className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                            >
                              <td className="py-3 px-4 text-sm">
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-3 h-3 text-muted-foreground" />
                                  {formatDate(transaction.date)}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-sm font-medium">{transaction.supplier}</td>
                              <td className="py-3 px-4 text-sm text-muted-foreground">{transaction.description}</td>
                              <td className="py-3 px-4 text-sm">
                                <span className="text-xs bg-muted px-2 py-1 rounded">
                                  {transaction.account_code}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-sm text-muted-foreground font-mono">
                                {transaction.reference || '-'}
                              </td>
                              <td className="py-3 px-4 text-center">{getStatusBadge(transaction.status)}</td>
                              <td className="py-3 px-4 text-sm font-semibold text-right">
                                {formatCurrency(transaction.amount)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {filteredTransactions.length > 50 && (
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    Showing 50 of {filteredTransactions.length} transactions
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}
