export type ProviderType = string; // Dynamic provider type from provider_types table

export type WorkingDayScheduleType = 'off' | 'full-day' | 'morning-half' | 'afternoon-half' | 'custom';

export interface WorkingDaySchedule {
  type: WorkingDayScheduleType;
  startTime: string | null; // 'HH:mm'; null when type is 'off'
  endTime: string | null; // 'HH:mm'; null when type is 'off'
  treatmentIds: string[]; // Treatments this provider performs on this day
}

// Keyed by lowercase day name: monday..sunday
export type ProviderWorkingDays = Record<string, WorkingDaySchedule>;

export type ProviderEmploymentType = 'self-employed' | 'employee';

export type ProviderCostSourceMethod = 'flat_percentage' | 'accounting_application' | 'sliding_scale' | 'monthly';
export type ProviderCostAccountPlatform = 'xero' | 'iplicit' | 'quickbooks' | 'sage';

export interface Provider {
  id: string;
  organization_id: string;
  practice_id: string | null;
  location_id: string | null;
  region_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  provider_type_id: string | null; // Foreign key to provider_types
  specialty_id: string | null; // Foreign key to specialties
  revenue: number;
  patients: number;
  avg_rev_per_patient: number;
  utilisation: number;
  trend: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Dentally-specific fields
  external_id: number | null;
  gdc_number: string | null;
  nhs_number: string | null;
  uda_target: number | null;
  uoa_target: number | null;
  provider_role: string | null; // Role from Dentally API (Dentist, Hygienist, Therapist, etc.)
  joining_date: string | null; // Date provider joined (from Dentally user.created_at)
  // Edit Provider tab fields
  provider_code: string | null; // Provider code (can be same as name)
  primary_chair: string | null; // Primary chair assignment
  leaving_date: string | null; // Date provider left
  // Contract Details tab fields
  contract_start_date: string | null; // Contract start date
  contract_end_date: string | null; // Contract end date
  /**
   * Bitmask of treatment options:
   *   bit 0 (1) = Does Perform NHS Treatments
   *   bit 1 (2) = Does Perform MOS Treatments
   *   bit 2 (4) = Does Perform UOA Treatments
   * Legacy: value `1` meant "Enable as UDA Associate" (= NHS).
   */
  additional_options: number | null;
  is_principal_associate: boolean | null; // Principal Associate flag — Associate (Dentist) providers only
  split_source_method: string | null; // Split source method (flat-percentage, sliding-scale, per-case, per-hour)
  associate_split_percentage: number | null; // Associate split percentage
  lab_split_percentage: number | null; // Lab split percentage
  lab_split_percentage_sliding: number | null; // Lab split % used when split_source_method = sliding-scale
  associate_split_per_case_rate: number | null; // Flat rate per case, when split_source_method = per-case
  associate_split_per_hour_rate: number | null; // Flat rate per hour, when split_source_method = per-hour
  working_days: ProviderWorkingDays | null; // Weekly working-days schedule, keyed by day name
  employment_type: ProviderEmploymentType | null; // Self Employed vs Employee, shown alongside per-hour split method
  membership_income: string | null; // JSON string of membership income account IDs
  nhs_income: string | null; // JSON string of NHS income account IDs
  // Lab/Material cost sourcing — only active when this provider's location is Associate Wise
  lab_cost_source_method: ProviderCostSourceMethod | null;
  lab_cost_percentage: number | null;
  lab_cost_account_id: string | null;
  lab_cost_account_platform: ProviderCostAccountPlatform | null;
  material_cost_source_method: ProviderCostSourceMethod | null;
  material_cost_percentage: number | null;
  material_cost_account_id: string | null;
  material_cost_account_platform: ProviderCostAccountPlatform | null;
  material_split_percentage: number | null; // Mirrors lab_split_percentage, always applicable
  // Joined data from provider_types and specialties
  provider_types?: {
    id: string;
    name: string;
    code: string;
  } | null;
  specialties?: {
    id: string;
    name: string;
    code: string | null;
  } | null;
}

export interface ProviderInsert {
  organization_id: string;
  practice_id?: string | null;
  location_id?: string | null;
  region_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  provider_type_id?: string | null; // Foreign key to provider_types
  specialty_id?: string | null; // Foreign key to specialties
  revenue?: number;
  patients?: number;
  avg_rev_per_patient?: number;
  utilisation?: number;
  trend?: number;
  is_active?: boolean;
  // Dentally-specific fields
  external_id?: number | null;
  gdc_number?: string | null;
  nhs_number?: string | null;
  uda_target?: number | null;
  uoa_target?: number | null;
  provider_role?: string | null; // Role from Dentally API (Dentist, Hygienist, Therapist, etc.)
  joining_date?: string | null; // Date provider joined (from Dentally user.created_at)
  // Edit Provider tab fields
  provider_code?: string | null; // Provider code (can be same as name)
  primary_chair?: string | null; // Primary chair assignment
  leaving_date?: string | null; // Date provider left
  // Contract Details tab fields
  contract_start_date?: string | null; // Contract start date
  contract_end_date?: string | null; // Contract end date
  /** Bitmask: bit0=NHS treatments, bit1=MOS treatments, bit2=UOA treatments. */
  additional_options?: number | null;
  is_principal_associate?: boolean | null; // Principal Associate flag — Associate (Dentist) providers only
  split_source_method?: string | null; // Split source method (flat-percentage, sliding-scale, per-case, per-hour)
  associate_split_percentage?: number | null; // Associate split percentage
  lab_split_percentage?: number | null; // Lab split percentage
  lab_split_percentage_sliding?: number | null; // Lab split % used when split_source_method = sliding-scale
  associate_split_per_case_rate?: number | null; // Flat rate per case, when split_source_method = per-case
  associate_split_per_hour_rate?: number | null; // Flat rate per hour, when split_source_method = per-hour
  working_days?: ProviderWorkingDays | null; // Weekly working-days schedule, keyed by day name
  employment_type?: ProviderEmploymentType | null; // Self Employed vs Employee, shown alongside per-hour split method
  membership_income?: string | null; // JSON string of membership income account IDs
  nhs_income?: string | null; // JSON string of NHS income account IDs
  lab_cost_source_method?: ProviderCostSourceMethod | null;
  lab_cost_percentage?: number | null;
  lab_cost_account_id?: string | null;
  lab_cost_account_platform?: ProviderCostAccountPlatform | null;
  material_cost_source_method?: ProviderCostSourceMethod | null;
  material_cost_percentage?: number | null;
  material_cost_account_id?: string | null;
  material_cost_account_platform?: ProviderCostAccountPlatform | null;
  material_split_percentage?: number | null;
}

export interface ProviderUpdate {
  practice_id?: string | null;
  location_id?: string | null;
  region_id?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  provider_type_id?: string | null; // Foreign key to provider_types
  specialty_id?: string | null; // Foreign key to specialties
  revenue?: number;
  patients?: number;
  avg_rev_per_patient?: number;
  utilisation?: number;
  trend?: number;
  is_active?: boolean;
  // Dentally-specific fields
  external_id?: number | null;
  gdc_number?: string | null;
  nhs_number?: string | null;
  uda_target?: number | null;
  uoa_target?: number | null;
  provider_role?: string | null; // Role from Dentally API (Dentist, Hygienist, Therapist, etc.)
  joining_date?: string | null; // Date provider joined (from Dentally user.created_at)
  // Edit Provider tab fields
  provider_code?: string | null; // Provider code (can be same as name)
  primary_chair?: string | null; // Primary chair assignment
  leaving_date?: string | null; // Date provider left
  // Contract Details tab fields
  contract_start_date?: string | null; // Contract start date
  contract_end_date?: string | null; // Contract end date
  /** Bitmask: bit0=NHS treatments, bit1=MOS treatments, bit2=UOA treatments. */
  additional_options?: number | null;
  is_principal_associate?: boolean | null; // Principal Associate flag — Associate (Dentist) providers only
  split_source_method?: string | null; // Split source method (flat-percentage, sliding-scale, per-case, per-hour)
  associate_split_percentage?: number | null; // Associate split percentage
  lab_split_percentage?: number | null; // Lab split percentage
  lab_split_percentage_sliding?: number | null; // Lab split % used when split_source_method = sliding-scale
  associate_split_per_case_rate?: number | null; // Flat rate per case, when split_source_method = per-case
  associate_split_per_hour_rate?: number | null; // Flat rate per hour, when split_source_method = per-hour
  working_days?: ProviderWorkingDays | null; // Weekly working-days schedule, keyed by day name
  employment_type?: ProviderEmploymentType | null; // Self Employed vs Employee, shown alongside per-hour split method
  membership_income?: string | null; // JSON string of membership income account IDs
  nhs_income?: string | null; // JSON string of NHS income account IDs
  lab_cost_source_method?: ProviderCostSourceMethod | null;
  lab_cost_percentage?: number | null;
  lab_cost_account_id?: string | null;
  lab_cost_account_platform?: ProviderCostAccountPlatform | null;
  material_cost_source_method?: ProviderCostSourceMethod | null;
  material_cost_percentage?: number | null;
  material_cost_account_id?: string | null;
  material_cost_account_platform?: ProviderCostAccountPlatform | null;
  material_split_percentage?: number | null;
}

// Provider Types
export interface ProviderTypeEntity {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface ProviderTypeInsert {
  organization_id: string;
  name: string;
  code: string;
  description?: string | null;
  is_active?: boolean;
  display_order?: number;
  created_by?: string | null;
}

export interface ProviderTypeUpdate {
  name?: string;
  code?: string;
  description?: string | null;
  is_active?: boolean;
  display_order?: number;
  deleted_at?: string | null;
  updated_by?: string | null;
}

// Specialties
export interface Specialty {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  description: string | null;
  provider_type_id: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface SpecialtyInsert {
  organization_id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  provider_type_id?: string | null;
  is_active?: boolean;
  display_order?: number;
  created_by?: string | null;
}

export interface SpecialtyUpdate {
  name?: string;
  code?: string | null;
  description?: string | null;
  provider_type_id?: string | null;
  is_active?: boolean;
  display_order?: number;
  deleted_at?: string | null;
  updated_by?: string | null;
}

/** providers.additional_options bit 0 — Does Perform NHS Treatments */
export const PROVIDER_OPT_NHS = 1;
/** providers.additional_options bit 1 — Does Perform MOS Treatments */
export const PROVIDER_OPT_MOS = 2;
/** providers.additional_options bit 2 — Does Perform UOA Treatments */
export const PROVIDER_OPT_UOA = 4;

export function providerPerformsNhs(additionalOptions: number | null | undefined): boolean {
  return ((Number(additionalOptions) || 0) & PROVIDER_OPT_NHS) !== 0;
}

export function providerPerformsMos(additionalOptions: number | null | undefined): boolean {
  return ((Number(additionalOptions) || 0) & PROVIDER_OPT_MOS) !== 0;
}

export function providerPerformsUoa(additionalOptions: number | null | undefined): boolean {
  return ((Number(additionalOptions) || 0) & PROVIDER_OPT_UOA) !== 0;
}

// Manually-entered monthly lab/material cost values, used when
// lab_cost_source_method / material_cost_source_method = 'monthly'
export interface ProviderMonthlyCost {
  id: string;
  organization_id: string;
  provider_id: string;
  month: string; // date string, always first-of-month
  lab_cost_value: number | null;
  material_cost_value: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface ProviderMonthlyCostUpsert {
  organization_id: string;
  provider_id: string;
  month: string;
  lab_cost_value?: number | null;
  material_cost_value?: number | null;
  created_by?: string | null;
  updated_by?: string | null;
}

export function encodeProviderAdditionalOptions(
  performsNhs: boolean,
  performsMos: boolean,
  performsUoa: boolean = false,
): number {
  return (
    (performsNhs ? PROVIDER_OPT_NHS : 0) |
    (performsMos ? PROVIDER_OPT_MOS : 0) |
    (performsUoa ? PROVIDER_OPT_UOA : 0)
  );
}
