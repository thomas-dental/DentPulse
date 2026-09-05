/**
 * Data Provenance & Confidence — documentation surface for PE tiering.
 */

import type { ReactNode } from 'react';
import {
  ProvenanceChip,
} from '@/components/patient-economics/ProvenanceChip';

function DocRow({ title, body, chip }: { title: string; body: string; chip?: ReactNode }) {
  return (
    <div className="border-b border-border/60 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {chip}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function PeProvenanceConfidencePanel() {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 rounded-[10px] bg-muted/50 p-3">
        <ProvenanceChip kind="dentally" />
        <ProvenanceChip kind="derived" />
        <ProvenanceChip kind="modelled" />
        <ProvenanceChip kind="external" />
      </div>

      <DocRow
        title="Dentally"
        body="Synced PMS facts: invoices, appointments, treatment plans, recall dates, is_active. Highest trust when sync is complete."
        chip={<ProvenanceChip kind="dentally" />}
      />
      <DocRow
        title="Derived"
        body="Computed directly from Dentally inputs without extra assumptions — e.g. invoice contribution rollup, opportunity gross from ledger, tenure from first visit."
        chip={<ProvenanceChip kind="derived" />}
      />
      <DocRow
        title="Modelled"
        body="Rule tables and heuristics with explicit thresholds (retention days, CLTV projection, quality score, commitment-weighted opportunity). Tune in Economic Assumptions."
        chip={<ProvenanceChip kind="modelled" />}
      />
      <DocRow
        title="External"
        body="Associate private-share %, lab/material costs from contracts or finance integrations — not from Dentally treatment rows alone."
        chip={<ProvenanceChip kind="external" />}
      />

      <div className="mt-3 rounded-[10px] border border-border/60 bg-card px-3 py-3">
        <div className="text-[13px] font-semibold text-foreground">Confidence scoring</div>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Contribution confidence</strong> — invoice-level
            attribution completeness (practitioner + rate coverage).
          </li>
          <li>
            <strong className="text-foreground">Opportunity confidence</strong> — sample size for
            conversion probability used in weighted opportunity.
          </li>
          <li>
            <strong className="text-foreground">Retention confidence</strong> — recall and visit-gap
            data freshness from Dentally sync.
          </li>
        </ul>
      </div>
    </div>
  );
}
