// One row per treatment (kept in sync automatically by a DB trigger on
// treatments), carrying the extra "step" settings shown in the Steps tab.
export interface TreatmentServiceStep {
  id: string;
  organization_id: string;
  treatment_id: string;
  service_code: string | null;
  service_name: string;
  is_main_treatment_step: boolean;
  completion_time_used_mins: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  // The parent/main treatment this step is mapped to (e.g. "X-ray" mapped
  // under "Root Canal - Full Treatment"); null while unmapped. Distinct
  // from treatment_id, which is this row's own identity. A step can only
  // ever be mapped under one treatment at a time (enforced by a unique
  // constraint on treatment_service_step_mappings.step_id), so once it's
  // mapped here it disappears from every other treatment's step picker.
  // Derived from treatment_service_step_mappings by the fetch query.
  mapped_treatment_id: string | null;
  mapped_treatment: { id: string; treatment_name: string } | null;
}

export interface TreatmentServiceStepUpdate {
  mapped_treatment_id?: string | null;
  is_main_treatment_step?: boolean;
  completion_time_used_mins?: number | null;
  updated_by?: string | null;
}
