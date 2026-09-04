import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type PeHeroCardTone =
  | 'default'
  | 'success'
  | 'risk'
  | 'warn'
  | 'opp'
  | 'conv'
  | 'qual';

type PeHeroCardProps = {
  tone?: PeHeroCardTone;
  valueTone?: 'default' | 'primary' | 'muted' | PeHeroCardTone;
  question: string;
  value: ReactNode;
  subtitle: ReactNode;
  pending?: boolean;
};

function barClass(tone: PeHeroCardTone): string {
  switch (tone) {
    case 'success':
    case 'qual':
      return 'bg-success';
    case 'risk':
      return 'bg-danger';
    case 'warn':
    case 'conv':
      return 'bg-warning';
    case 'opp':
      return 'bg-[hsl(var(--chart-5))]';
    default:
      return 'bg-primary';
  }
}

function valueClass(tone: PeHeroCardTone, valueTone?: PeHeroCardProps['valueTone']): string {
  if (valueTone === 'primary') return 'text-primary';
  if (valueTone === 'muted') return 'text-muted-foreground';
  if (valueTone && valueTone !== 'default') return valueClass(valueTone as PeHeroCardTone);

  switch (tone) {
    case 'success':
    case 'qual':
      return 'text-success';
    case 'risk':
      return 'text-danger-strong';
    case 'warn':
    case 'conv':
      return 'text-warning';
    case 'opp':
      return 'text-[hsl(var(--chart-5))]';
    default:
      return 'text-foreground';
  }
}

/** KPI hero card with in-card skeleton while a scoped read is loading/refetching. */
export function PeHeroCard({
  tone = 'default',
  valueTone,
  question,
  value,
  subtitle,
  pending = false,
}: PeHeroCardProps) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', barClass(tone))} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {question}
      </div>
      {pending ? (
        <>
          <Skeleton className="h-8 w-[92px]" />
          <Skeleton className="mt-2 h-3.5 w-[140px]" />
        </>
      ) : (
        <>
          <div className={cn('text-[28px] font-extrabold tracking-tight', valueClass(tone, valueTone))}>
            {value}
          </div>
          <div className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
        </>
      )}
    </div>
  );
}

export function PeChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('h-[200px] w-full rounded-[10px]', className)} />;
}
