export interface Treatment {
  id: string;
  organization_id: string;
  category_id: string | null;
  location_id: string | null;
  region_id: string | null;
  treatment_name: string;
  treatment_code: string | null;
  description: string | null;
  treatment_type: 'private' | 'nhs';
  type_of_treatment: string | null;
  price: number;
  private_price: number | null;
  nhs_price: number | null;
  nhs_band: string | null;
  duration_minutes: number | null;
  requires_followup: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  // DentLedger-specific analytics fields
  no_items: number | null;
  average: number | null;
  percent_fees: number | null;
  hourly_rate: number | null;
  average_time_minutes: number | null;
  therapist_time_mins: number | null;
  therapist_completion_mins: number | null;
  lab_bill: number | null;
  lab_bill_discount: number | null;
  material_cost: number | null;
  therapist_pay_rate: number | null;
  finance_fee: number | null;
  // Dentally-specific fields
  external_id: number | null;
  insurance_classification: string | null;
  nhs_treatment_cat: string | null;
  nomenclature: string | null;
  owner: string | null;
  patient_description: string | null;
  patient_nomenclature: string | null;
  region: string | null;
  uda_band: string | null;
  // Joined data
  category?: {
    id: string;
    name: string;
  } | null;
}

export interface TreatmentInsert {
  organization_id: string;
  category_id?: string | null;
  location_id?: string | null;
  region_id?: string | null;
  treatment_name: string;
  treatment_code?: string | null;
  description?: string | null;
  treatment_type: 'private' | 'nhs';
  type_of_treatment?: string | null;
  price: number;
  private_price?: number | null;
  nhs_price?: number | null;
  nhs_band?: string | null;
  duration_minutes?: number | null;
  requires_followup?: boolean;
  notes?: string | null;
  created_by?: string | null;
  no_items?: number | null;
  average?: number | null;
  percent_fees?: number | null;
  hourly_rate?: number | null;
  average_time_minutes?: number | null;
  therapist_time_mins?: number | null;
  therapist_completion_mins?: number | null;
  lab_bill?: number | null;
  lab_bill_discount?: number | null;
  material_cost?: number | null;
  therapist_pay_rate?: number | null;
  finance_fee?: number | null;
  // Dentally-specific fields
  external_id?: number | null;
  insurance_classification?: string | null;
  nhs_treatment_cat?: string | null;
  nomenclature?: string | null;
  owner?: string | null;
  patient_description?: string | null;
  patient_nomenclature?: string | null;
  region?: string | null;
  uda_band?: string | null;
}

export interface TreatmentUpdate {
  id: string;
  category_id?: string | null;
  location_id?: string | null;
  region_id?: string | null;
  treatment_name?: string;
  treatment_code?: string | null;
  description?: string | null;
  treatment_type?: 'private' | 'nhs';
  type_of_treatment?: string | null;
  price?: number;
  private_price?: number | null;
  nhs_price?: number | null;
  nhs_band?: string | null;
  duration_minutes?: number | null;
  requires_followup?: boolean;
  is_active?: boolean;
  notes?: string | null;
  updated_by?: string | null;
  no_items?: number | null;
  average?: number | null;
  percent_fees?: number | null;
  hourly_rate?: number | null;
  average_time_minutes?: number | null;
  therapist_time_mins?: number | null;
  therapist_completion_mins?: number | null;
  lab_bill?: number | null;
  lab_bill_discount?: number | null;
  material_cost?: number | null;
  therapist_pay_rate?: number | null;
  finance_fee?: number | null;
  // Dentally-specific fields
  external_id?: number | null;
  insurance_classification?: string | null;
  nhs_treatment_cat?: string | null;
  nomenclature?: string | null;
  owner?: string | null;
  patient_description?: string | null;
  patient_nomenclature?: string | null;
  region?: string | null;
  uda_band?: string | null;
}
