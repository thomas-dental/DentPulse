import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

/**
 * Membership-only per-treatment cost settings (dentist time / hygienist time
 * / lab cost / material cost) — a hand-picked subset of the org's treatment
 * catalog, stored in membership_treatment_settings (migration
 * 20260816000001). Never writes to the shared `treatments` table; this is a
 * parallel override used only by the Membership module.
 */

export interface MembershipTreatmentSetting {
  id: string;
  treatmentId: string;
  dentistTimeMinutes: number | null;
  hygienistTimeMinutes: number | null;
  labCost: number | null;
  materialCost: number | null;
}

export interface TreatmentSettingDefaults {
  dentistTimeMinutes: number | null;
  labCost: number | null;
  materialCost: number | null;
}

export interface ImportTreatmentSettingRow {
  treatmentId: string;
  dentistTimeMinutes: number | null;
  hygienistTimeMinutes: number | null;
  labCost: number | null;
  materialCost: number | null;
}

export function useMembershipTreatmentSettings() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['membership_treatment_settings', organizationId];

  const { data: settings = [], isLoading } = useQuery<MembershipTreatmentSetting[]>({
    queryKey,
    enabled: !!organizationId,
    queryFn: async () => {
      // THROW on error — a swallowed failure would cache [] as fresh.
      const { data, error } = await (supabase as any)
        .from('membership_treatment_settings')
        .select('id, treatment_id, dentist_time_minutes, hygienist_time_minutes, lab_cost, material_cost')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        treatmentId: r.treatment_id,
        dentistTimeMinutes: r.dentist_time_minutes != null ? Number(r.dentist_time_minutes) : null,
        hygienistTimeMinutes: r.hygienist_time_minutes != null ? Number(r.hygienist_time_minutes) : null,
        labCost: r.lab_cost != null ? Number(r.lab_cost) : null,
        materialCost: r.material_cost != null ? Number(r.material_cost) : null,
      }));
    },
  });

  // Reconcile the full desired selected-treatment set in one call: adds a
  // default-prefilled row for every newly selected id, removes the row for
  // every deselected one. Re-reads the current treatment_id set from the DB
  // right before diffing (not the query's cached `settings`) so two rapid
  // toggles never race against a stale in-flight closure.
  const setSelectedMutation = useMutation({
    mutationFn: async ({
      treatmentIds,
      defaultsByTreatmentId,
    }: {
      treatmentIds: string[];
      defaultsByTreatmentId: Map<string, TreatmentSettingDefaults>;
    }) => {
      if (!organizationId) throw new Error('No organization selected');

      const { data: currentRows, error: readErr } = await (supabase as any)
        .from('membership_treatment_settings')
        .select('treatment_id')
        .eq('organization_id', organizationId);
      if (readErr) throw readErr;
      const currentIds: Set<string> = new Set(((currentRows ?? []) as any[]).map((r) => String(r.treatment_id)));
      const nextIds = new Set(treatmentIds);

      const toRemove = Array.from(currentIds).filter((id) => !nextIds.has(id));
      const toAdd = treatmentIds.filter((id) => !currentIds.has(id));

      if (toRemove.length > 0) {
        const { error } = await (supabase as any)
          .from('membership_treatment_settings')
          .delete()
          .eq('organization_id', organizationId)
          .in('treatment_id', toRemove);
        if (error) throw error;
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map((id) => {
          const d = defaultsByTreatmentId.get(id);
          return {
            organization_id: organizationId,
            treatment_id: id,
            dentist_time_minutes: d?.dentistTimeMinutes ?? null,
            hygienist_time_minutes: null,
            lab_cost: d?.labCost ?? null,
            material_cost: d?.materialCost ?? null,
            created_by: user?.id ?? null,
          };
        });
        const { error } = await (supabase as any)
          .from('membership_treatment_settings')
          .upsert(rows, { onConflict: 'organization_id,treatment_id' });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: any) => {
      toast.error(`Couldn't update the treatment selection: ${error?.message ?? 'unknown error'}`);
    },
  });

  const updateSettingMutation = useMutation({
    mutationFn: async (input: {
      treatmentId: string;
      dentistTimeMinutes: number | null;
      hygienistTimeMinutes: number | null;
      labCost: number | null;
      materialCost: number | null;
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      const { error } = await (supabase as any)
        .from('membership_treatment_settings')
        .upsert(
          {
            organization_id: organizationId,
            treatment_id: input.treatmentId,
            dentist_time_minutes: input.dentistTimeMinutes,
            hygienist_time_minutes: input.hygienistTimeMinutes,
            lab_cost: input.labCost,
            material_cost: input.materialCost,
            created_by: user?.id ?? null,
          },
          { onConflict: 'organization_id,treatment_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: any) => {
      if (/relation .* does not exist/i.test(error?.message ?? '')) {
        toast.error('Membership treatment settings aren’t set up on this database yet — migration 20260816000001 needs to be applied first.');
      } else {
        toast.error(`Couldn't save treatment settings: ${error?.message ?? 'unknown error'}`);
      }
    },
  });

  // CSV import: upserts every row it's given in one call (adds a row for a
  // treatment not yet selected, overwrites the four values for one that
  // already is). Additive only — a treatment selected in the app but absent
  // from the file is left untouched, never removed.
  const importMutation = useMutation({
    mutationFn: async (rows: ImportTreatmentSettingRow[]) => {
      if (!organizationId) throw new Error('No organization selected');
      if (rows.length === 0) return;
      const payload = rows.map((r) => ({
        organization_id: organizationId,
        treatment_id: r.treatmentId,
        dentist_time_minutes: r.dentistTimeMinutes,
        hygienist_time_minutes: r.hygienistTimeMinutes,
        lab_cost: r.labCost,
        material_cost: r.materialCost,
        created_by: user?.id ?? null,
      }));
      const { error } = await (supabase as any)
        .from('membership_treatment_settings')
        .upsert(payload, { onConflict: 'organization_id,treatment_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: any) => {
      toast.error(`Couldn't import treatment settings: ${error?.message ?? 'unknown error'}`);
    },
  });

  return {
    settings,
    isLoading,
    setSelectedTreatments: setSelectedMutation.mutateAsync,
    isSelecting: setSelectedMutation.isPending,
    updateSetting: updateSettingMutation.mutateAsync,
    isSaving: updateSettingMutation.isPending,
    importSettings: importMutation.mutateAsync,
    isImporting: importMutation.isPending,
  };
}
