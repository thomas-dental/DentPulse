import { cn } from '@/lib/utils';
import { MetricHelp } from '@/components/dashboard/MetricHelp';
import { DATE_BASIS_HELP, type TreatmentDateBasis } from '@/lib/paidDateBasis';

/**
 * Completed on / Paid on segmented control — mirrors the Date dropdown on
 * Dentally's Practitioner Activity report. Used by Treatment Insights and
 * Private Treatment so both pages expose the identical control + wording.
 */
export function DateBasisToggle({
  value,
  onChange,
}: {
  value: TreatmentDateBasis;
  onChange: (basis: TreatmentDateBasis) => void;
}) {
  const options: Array<{ key: TreatmentDateBasis; label: string }> = [
    { key: 'completed', label: 'Completed on' },
    { key: 'paid', label: 'Paid on' },
  ];
  return (
    <div className="flex items-center gap-1.5">
      <div className="inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5" role="group" aria-label="Date basis">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            aria-pressed={value === opt.key}
            onClick={() => onChange(opt.key)}
            className={cn(
              'px-3 py-1 text-sm rounded transition-colors whitespace-nowrap',
              value === opt.key
                ? 'bg-background text-foreground font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <MetricHelp title="Date basis">{DATE_BASIS_HELP}</MetricHelp>
    </div>
  );
}
