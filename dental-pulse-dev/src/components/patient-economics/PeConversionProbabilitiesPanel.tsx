/**
 * Conversion Probabilities — read-only review of commitment-derived weighting.
 */

import { AlertCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversionProbabilities } from '@/hooks/useConversionProbabilities';

function fmtGbp(n: number) {
  return `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

export function PeConversionProbabilitiesPanel() {
  const query = useConversionProbabilities();
  const data = query.data;

  if (query.isLoading) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">Could not load conversion probabilities</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={() => query.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">No probability data for this practice.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <span className="font-semibold">Read-only — </span>
          {data.readOnlyReason}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Practice Commitment Rate" value={`${data.commitmentRatePct}%`} />
        <Metric label="Learning window" value={`${data.windowDays} days`} />
        <Metric label="Confidence" value={`${data.confidence}%`} />
        <Metric label="Open plan gross" value={fmtGbp(data.openPlanGrossGbp)} />
        <Metric label="Eligible items" value={String(data.eligibleItemCount)} />
        <Metric label="Within window" value={String(data.committedItemCount)} />
      </div>

      <div className="rounded-[10px] bg-muted/40 px-3 py-2.5 text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">Formula: </span>
        {data.weightedFormula}
      </div>

      {data.tierNote && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{data.tierNote}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-[15px] font-bold text-foreground">{value}</div>
    </div>
  );
}
