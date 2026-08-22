import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AccountMultiSelect } from '@/components/settings/AccountMultiSelect';
import { AlertTriangle, CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePaymentPlans } from '@/hooks/usePaymentPlans';
import { useMembershipPlanMappings } from '@/hooks/useMembershipPlanMappings';

/**
 * Settings module mapping each Practice Plan statement plan (fee-category
 * label, e.g. "Comprehensive"/"Low B") to its Dentally payment plan(s).
 * Statement plans have no payment_plans row of their own; this mapping gives
 * them Dentally identities for analytics joins. Multi-select per row; every
 * toggle saves immediately.
 *
 * Selections are mirrored in local state so consecutive toggles never build
 * on a stale server snapshot while the previous save is still in flight.
 */

export function PlanMappingDialog({ open, onOpenChange, statementPlanLabels, providerLabel }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Practice Plan statement fee categories present in the uploaded data. */
  statementPlanLabels: string[];
  providerLabel: string;
}) {
  const { paymentPlans, isLoading: plansLoading } = usePaymentPlans();
  const { mappings, isLoading: mappingsLoading, setMapping } = useMembershipPlanMappings();
  const [localSel, setLocalSel] = useState<Record<string, string[]>>({});
  const [savingLabels, setSavingLabels] = useState<Set<string>>(new Set());

  const planOptions = useMemo(() =>
    (paymentPlans ?? [])
      .map(p => {
        const name = p.pp_name || p.pp_patient_friendly_name || 'Unnamed plan';
        return {
          value: p.id,
          label: p.pp_is_active === false ? `${name} (Inactive)` : name,
        };
      }),
    [paymentPlans]);

  const planNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of planOptions) map.set(p.value, p.label);
    return map;
  }, [planOptions]);

  const mappingByLabel = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of mappings) map.set(m.plan_label, m.payment_plan_ids);
    return map;
  }, [mappings]);

  const selectedFor = (label: string): string[] =>
    localSel[label] ?? mappingByLabel.get(label) ?? [];

  const sortedLabels = useMemo(() => [...statementPlanLabels].sort((a, b) => a.localeCompare(b)), [statementPlanLabels]);
  const mappedCount = sortedLabels.filter(l => selectedFor(l).length > 0).length;

  const handleChange = async (planLabel: string, ids: string[]) => {
    setLocalSel(prev => ({ ...prev, [planLabel]: ids }));
    setSavingLabels(prev => new Set(prev).add(planLabel));
    try {
      await setMapping({ planLabel, paymentPlanIds: ids });
    } catch (err: any) {
      toast.error(`Failed to save mapping for ${planLabel}: ${err?.message ?? 'unknown error'}`);
      // Fall back to the last saved server state for this row.
      setLocalSel(prev => {
        const next = { ...prev };
        delete next[planLabel];
        return next;
      });
    } finally {
      setSavingLabels(prev => {
        const next = new Set(prev);
        next.delete(planLabel);
        return next;
      });
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setLocalSel({});
    onOpenChange(next);
  };

  const loading = plansLoading || mappingsLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Plan Mapping
          </DialogTitle>
          <DialogDescription>
            Match each {providerLabel} statement plan to its Dentally payment plan(s), so
            statement plans can join to Dentally treatment and patient data.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading plans…
          </div>
        ) : sortedLabels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No {providerLabel} statement plans found — upload a statement first.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{providerLabel} statement plans</p>
              <Badge variant="outline">{mappedCount}/{sortedLabels.length} mapped</Badge>
            </div>

            {sortedLabels.map(label => {
              const selected = selectedFor(label);
              const isSavingRow = savingLabels.has(label);
              const mappedNames = selected.map(id => planNameById.get(id) ?? 'Unknown plan');
              return (
                <div key={label} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2 pt-1.5">
                    {selected.length > 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{label}</p>
                      <p className="text-xs text-muted-foreground truncate" title={mappedNames.join(', ')}>
                        {selected.length > 0
                          ? `→ ${mappedNames.join(', ')}`
                          : 'Not mapped to a Dentally plan yet'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 w-[260px]">
                    {isSavingRow && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <AccountMultiSelect
                        options={planOptions}
                        value={selected}
                        onChange={ids => handleChange(label, ids)}
                        placeholder="Select Dentally plans…"
                        itemNoun="plan"
                        modalPopover
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
