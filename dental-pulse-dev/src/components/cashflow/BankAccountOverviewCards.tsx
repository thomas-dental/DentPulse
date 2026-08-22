import { CheckCircle2, ExternalLink, Landmark } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { XeroBankOverviewCard } from '@/services/xeroBankOverviewService';

interface BankAccountOverviewCardsProps {
  cards: XeroBankOverviewCard[];
  isLoading?: boolean;
  message?: string | null;
  currencySymbol?: string;
  className?: string;
}

function formatMoney(value: number | null, symbol: string): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}

function formatAsOf(asOf: string | null): string | null {
  if (!asOf) return null;
  try {
    return format(parseISO(asOf.length === 10 ? `${asOf}T00:00:00` : asOf), 'd MMM yyyy');
  } catch {
    return asOf;
  }
}

function BankAccountCard({
  card,
  currencySymbol,
}: {
  card: XeroBankOverviewCard;
  currencySymbol: string;
}) {
  const asOfLabel = formatAsOf(card.balanceAsOf);
  const difference =
    card.bankBalance != null && card.xeroBalance != null
      ? Math.round((card.bankBalance - card.xeroBalance) * 100) / 100
      : null;
  const showDifference = difference != null && Math.abs(difference) >= 0.01;
  const needsReconcile = card.unreconciledCount > 0;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {card.accountName}
          </h3>
          {(card.accountNumber || card.accountCode) && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {card.accountNumber || card.accountCode}
            </p>
          )}
        </div>
        <div
          className="shrink-0 h-8 w-8 rounded-md bg-muted/60 flex items-center justify-center text-muted-foreground"
          aria-hidden
        >
          <Landmark className="h-4 w-4" />
        </div>
      </div>

      <div className="px-4 pb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground leading-tight">
            {formatMoney(card.bankBalance, currencySymbol)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Bank balance
            {asOfLabel ? (
              <span className="text-muted-foreground/80"> ({asOfLabel})</span>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground leading-tight">
            {formatMoney(card.xeroBalance, currencySymbol)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Balance in Xero
          </p>
        </div>
      </div>

      {showDifference && (
        <div className="px-4 pb-2 flex justify-end">
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="mr-1">Balance difference</span>
            {formatMoney(Math.abs(difference!), currencySymbol)}
          </p>
        </div>
      )}

      <div className="mt-auto px-4 pb-4 pt-1 space-y-2">
        {needsReconcile ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {card.unreconciledCount} unreconciled item
            {card.unreconciledCount === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Reconciled
          </p>
        )}

        <Button
          asChild
          size="sm"
          variant={needsReconcile ? 'default' : 'outline'}
          className="w-full gap-1.5"
        >
          <a
            href={card.reconciliationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {needsReconcile
              ? `Reconcile ${card.unreconciledCount} item${card.unreconciledCount === 1 ? '' : 's'}`
              : 'View account transactions'}
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </a>
        </Button>
      </div>
    </div>
  );
}

export function BankAccountOverviewCards({
  cards,
  isLoading,
  message,
  currencySymbol = '£',
  className,
}: BankAccountOverviewCardsProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-4',
          className,
        )}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!cards.length) {
    if (!message) return null;
    return (
      <div
        className={cn(
          'mb-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground',
          className,
        )}
      >
        {message}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-4',
        className,
      )}
    >
      {cards.map((card) => (
        <BankAccountCard
          key={card.accountId}
          card={card}
          currencySymbol={currencySymbol}
        />
      ))}
    </div>
  );
}
