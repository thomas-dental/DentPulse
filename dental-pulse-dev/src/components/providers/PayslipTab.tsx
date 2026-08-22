import { useCallback, useMemo, useState } from 'react';
import { DatePicker, ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Eye, Loader2, FileText } from 'lucide-react';
import { usePayslips, useDeletePayslipMutation, PayslipFilters } from '@/hooks/usePayslips';
import { Payslip, PayslipStatus } from '@/types/payslip';
import { Provider } from '@/types/provider';
import { PayslipDialog } from './PayslipDialog';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

interface PayslipTabProps {
  provider: Provider | undefined;
  providerId: string;
}

function StatusBadge({ status }: { status: PayslipStatus }) {
  if (status === 'posted') {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        Posted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
      Draft
    </Badge>
  );
}

export function PayslipTab({ provider, providerId }: PayslipTabProps) {
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = useCallback(
    (value: number | null | undefined) => formatCurrencyBase(value, showDecimals),
    [showDecimals],
  );
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [statusFilter, setStatusFilter] = useState<PayslipStatus | 'all'>('all');
  const [dialogState, setDialogState] = useState<{ open: boolean; mode: 'add' | 'edit' | 'view'; payslipId?: string }>({
    open: false,
    mode: 'add',
  });
  const [payslipToDelete, setPayslipToDelete] = useState<Payslip | null>(null);

  const filters: PayslipFilters = useMemo(
    () => ({
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: format(dateRange.to, 'yyyy-MM-dd'),
      status: statusFilter,
    }),
    [dateRange, statusFilter],
  );

  const { payslips, isLoading } = usePayslips(providerId, filters);
  const { deletePayslip, isDeleting } = useDeletePayslipMutation(providerId);

  const summary = useMemo(() => {
    const count = payslips.length;
    const totalNetPay = payslips.reduce((sum, p) => sum + (Number(p.net_pay) || 0), 0);
    const totalGrossPay = payslips.reduce((sum, p) => sum + (Number(p.total_gross_fees) || 0), 0);
    const totalUdas = payslips.reduce((sum, p) => sum + (Number(p.udas) || 0), 0);
    return {
      count,
      totalNetPay,
      totalGrossPay,
      totalUdas,
      averageNet: count > 0 ? totalNetPay / count : 0,
    };
  }, [payslips]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Payslip Details</h3>
          <p className="text-sm text-muted-foreground">Generate and review this provider's payslips.</p>
        </div>
        <Button onClick={() => setDialogState({ open: true, mode: 'add' })} className="gap-2 text-white">
          <Plus className="w-4 h-4" />
          Add Payslip
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Net Pay</p>
            <p className="text-2xl font-semibold text-foreground">{formatCurrency(summary.totalNetPay)}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.count} statement{summary.count === 1 ? '' : 's'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Gross Pay</p>
            <p className="text-2xl font-semibold text-foreground">{formatCurrency(summary.totalGrossPay)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total UDAs</p>
            <p className="text-2xl font-semibold text-foreground">{summary.totalUdas.toLocaleString('en-GB')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Average Net</p>
            <p className="text-2xl font-semibold text-foreground">{formatCurrency(summary.averageNet)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <ConfigProvider theme={{ token: { colorPrimary: 'hsl(244, 48%, 25%)' } }}>
              <DatePicker.RangePicker
                value={[dayjs(dateRange.from), dayjs(dateRange.to)]}
                format="DD-MM-YYYY"
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setDateRange({ from: dates[0].toDate(), to: dates[1].toDate() });
                  }
                }}
              />
            </ConfigProvider>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as PayslipStatus | 'all')}>
              <SelectTrigger className="w-[160px] focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading payslips...
            </div>
          ) : payslips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <FileText className="w-8 h-8" />
              <p>No payslips found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month Ending</TableHead>
                    <TableHead>Statement Date</TableHead>
                    <TableHead className="text-right">UDAs</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deduction</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Pay Band Share</TableHead>
                    <TableHead className="text-right">Labs Total</TableHead>
                    <TableHead className="text-right">Lab Split %</TableHead>
                    <TableHead className="text-right">Lab Share</TableHead>
                    <TableHead className="text-right">Additions</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((payslip) => (
                    <TableRow key={payslip.id}>
                      <TableCell>{format(new Date(payslip.month_ending), 'dd MMM yyyy')}</TableCell>
                      <TableCell>{format(new Date(payslip.statement_date), 'dd MMM yyyy')}</TableCell>
                      <TableCell className="text-right">{payslip.udas ?? 0}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.gross_fees_total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.gross_deductions_total)}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">
                          {formatCurrency(payslip.net_pay)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.pay_band_associate_share_total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.labs_total)}</TableCell>
                      <TableCell className="text-right">{payslip.associate_lab_split_percentage ?? '-'}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.associate_lab_share_total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.additions_total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(payslip.deductions_total)}</TableCell>
                      <TableCell><StatusBadge status={payslip.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {payslip.status === 'draft' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDialogState({ open: true, mode: 'edit', payslipId: payslip.id })}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setPayslipToDelete(payslip)}>
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDialogState({ open: true, mode: 'view', payslipId: payslip.id })}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PayslipDialog
        open={dialogState.open}
        mode={dialogState.mode}
        payslipId={dialogState.payslipId}
        provider={provider}
        providerId={providerId}
        onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
      />

      <AlertDialog open={!!payslipToDelete} onOpenChange={(open) => !open && setPayslipToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payslip</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the draft payslip for{' '}
              <strong>{payslipToDelete ? format(new Date(payslipToDelete.month_ending), 'MMMM yyyy') : ''}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (payslipToDelete) {
                  deletePayslip(payslipToDelete.id);
                  setPayslipToDelete(null);
                }
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
