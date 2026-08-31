export type ProvenanceKind =
  | 'dentally'
  | 'derived'
  | 'modelled'
  | 'external'
  | 'pending'
  | 'partial_no_practitioner'
  | 'partial_missing_rate'
  | 'partial';

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full border px-[7px] py-[2px] text-[10px] font-semibold leading-none';

function ChipDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />;
}

export function ProvenanceChip({ kind }: { kind: ProvenanceKind }) {
  if (kind === 'pending') {
    return (
      <span
        className={`${CHIP_BASE} border-border bg-muted/60 text-muted-foreground`}
      >
        <ChipDot />
        Pending
      </span>
    );
  }
  if (kind === 'partial_no_practitioner') {
    return (
      <span
        className={`${CHIP_BASE} border-warning/30 bg-warning-muted text-warning`}
      >
        <ChipDot />
        No practitioner
      </span>
    );
  }
  if (kind === 'partial_missing_rate' || kind === 'partial') {
    return (
      <span
        className={`${CHIP_BASE} border-warning/30 bg-warning-muted text-warning`}
      >
        <ChipDot />
        {kind === 'partial' ? 'Partial data' : 'Missing rate'}
      </span>
    );
  }
  if (kind === 'dentally') {
    return (
      <span
        className={`${CHIP_BASE} border-success/30 bg-success-muted text-success`}
      >
        <ChipDot />
        Dentally
      </span>
    );
  }
  if (kind === 'modelled') {
    return (
      <span
        className={`${CHIP_BASE} border-warning/30 bg-warning-muted text-warning`}
      >
        <ChipDot />
        Modelled
      </span>
    );
  }
  if (kind === 'external') {
    return (
      <span
        className={`${CHIP_BASE} border-primary/30 bg-primary/10 text-primary`}
      >
        <ChipDot />
        External
      </span>
    );
  }
  return (
    <span
      className={`${CHIP_BASE} border-chart-5/30 bg-chart-5/10 text-chart-5`}
    >
      <ChipDot />
      Derived
    </span>
  );
}

export function tierToChip(
  tier: string | null | undefined,
): Extract<ProvenanceKind, 'dentally' | 'derived' | 'modelled' | 'external'> {
  const t = String(tier || '').toLowerCase();
  if (t === 'dentally') return 'dentally';
  if (t === 'modelled') return 'modelled';
  if (t === 'external') return 'external';
  return 'derived';
}
