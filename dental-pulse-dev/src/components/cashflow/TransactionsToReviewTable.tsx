import { ExternalLink } from 'lucide-react';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TransactionToReview } from '@/data/preparingCashflowStatementData';
import {
  accountingLinkClassName,
  AccountingPlatform,
  isValidTransactionLink,
} from '@/utils/accountingTransactionLinks';
import { cn } from '@/lib/utils';
import { normalizeMoneyDisplay } from '@/utils/formatMoney';

function MoneyInHeader() {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-green-600 font-semibold">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="6.5" stroke="#019C00" />
        <text x="7" y="10" textAnchor="middle" fontSize="8" fill="#019C00" fontWeight="700">£</text>
      </svg>
      Money (IN)
    </span>
  );
}

function MoneyOutHeader() {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-red-600 font-semibold">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="6.5" stroke="#DF081A" />
        <text x="7" y="10" textAnchor="middle" fontSize="8" fill="#DF081A" fontWeight="700">£</text>
      </svg>
      Money (OUT)
    </span>
  );
}

function TransactionTypeCell(props: {
  transaction: TransactionToReview;
  accountingPlatform: AccountingPlatform | null | undefined;
}) {
  const { transaction, accountingPlatform } = props;
  const link = transaction.transactionLink;
  const label = transaction.transactionType || '—';
  const linkClass = accountingLinkClassName(accountingPlatform);

  if (!isValidTransactionLink(link)) {
    return <span className="text-sm">{label}</span>;
  }

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1.5 text-sm font-medium hover:underline', linkClass)}
      title={`Open in ${accountingPlatform ?? 'accounting app'}`}
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </a>
  );
}

interface TransactionsToReviewTableProps {
  transactions: TransactionToReview[];
  totals: { totalMoneyIn: number; totalMoneyOut: number; closingBalance: number };
  accountingPlatform?: AccountingPlatform | null;
  formatCurrency: (value: number) => string;
  formatDisplayDate: (value: string) => string;
  emptyMessage?: string;
  /** Applied to the scroll container (table body scrolls; header stays sticky). */
  className?: string;
}

export function TransactionsToReviewTable({
  transactions,
  totals,
  accountingPlatform,
  formatCurrency,
  formatDisplayDate,
  emptyMessage = 'No data found',
  className,
}: TransactionsToReviewTableProps) {
  // Use a native <table> (not the Table wrapper) so sticky thead works inside
  // this overflow container without a nested overflow-auto wrapper.
  return (
    <div className={cn('overflow-auto border border-t-0 border-border', className)}>
      <table className="w-full caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="bg-muted hover:bg-muted border-b">
            <TableHead className="whitespace-nowrap bg-muted">Date</TableHead>
            <TableHead className="whitespace-nowrap min-w-[140px] bg-muted">Transaction Type</TableHead>
            <TableHead className="bg-muted">Name</TableHead>
            <TableHead className="bg-muted">Memo / Description</TableHead>
            <TableHead className="bg-muted">Who Paid</TableHead>
            <TableHead className="bg-muted">For What</TableHead>
            <TableHead className="text-right bg-muted">
              <MoneyInHeader />
            </TableHead>
            <TableHead className="text-right bg-muted">
              <MoneyOutHeader />
            </TableHead>
            <TableHead className="text-right font-semibold bg-muted">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            transactions.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/30">
                <TableCell className="whitespace-nowrap tabular-nums">{formatDisplayDate(t.date)}</TableCell>
                <TableCell>
                  <TransactionTypeCell transaction={t} accountingPlatform={accountingPlatform} />
                </TableCell>
                <TableCell className="font-medium max-w-[200px] truncate" title={t.name}>
                  {t.name}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[220px] truncate" title={t.memoOrDescription}>
                  {t.memoOrDescription || '—'}
                </TableCell>
                <TableCell className="max-w-[160px] truncate" title={t.location}>
                  {t.location}
                </TableCell>
                <TableCell className="max-w-[180px] truncate" title={t.split}>
                  {t.split}
                </TableCell>
                <TableCell className="text-right tabular-nums text-green-600 font-medium">
                  {t.debit}
                </TableCell>
                <TableCell className="text-right tabular-nums text-red-600 font-medium">
                  {t.credit}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {normalizeMoneyDisplay(t.balance)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        <TableFooter className="sticky bottom-0 z-10 bg-muted/95 backdrop-blur-sm">
          <TableRow className="bg-muted/95 font-semibold border-t-2 hover:bg-muted/95">
            <TableCell colSpan={6} className="text-right bg-muted/95">
              Total
            </TableCell>
            <TableCell className="text-right tabular-nums text-green-600 bg-muted/95">
              {formatCurrency(totals.totalMoneyIn)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-red-600 bg-muted/95">
              {formatCurrency(totals.totalMoneyOut)}
            </TableCell>
            <TableCell className="text-right tabular-nums font-bold bg-muted/95">
              {formatCurrency(totals.closingBalance)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </table>
    </div>
  );
}
