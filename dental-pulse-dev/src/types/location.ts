export interface PracticeLocation {
  id: string;
  organization_id: string;
  region_id: string | null;
  location_name: string;
  location_code: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  operating_hours: Record<string, any> | null;
  timezone: string | null;
  is_primary: boolean;
  is_active: boolean;
  /** When true, location syncs but is omitted from financial UI aggregates. */
  exclude_from_financial_display?: boolean;
  notes: string | null;
  api_record_unique_id: string | null; // Unique ID from external API (e.g., Dentally site UUID)
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  user_id: string | null;
  chairs_count: number | null;
  // Business Information — operational settings used by profit/payslip calculations
  week_open_per_year: number | null;
  days_open_per_week: number | null;
  open_hours_per_day: number | null;
  number_of_surgeries: number | null;
  associate_weeks_per_year: number | null;
  associate_days_per_week: number | null;
  associate_cost_lab_source: string | null;
  associate_cost_labs_percent: number | null;
  material_cost_source: string | null;
  practice_cost_materials_percent: number | null;
  target_profit_percent: number | null;
  target_chair_revenue_per_hour: number | null;
  employee_working_duration_type: string | null;
  is_associate_pay_including_lab_cost: boolean | null;
  is_associate_pay_including_material_cost: boolean | null;
}

export interface PracticeLocationInsert {
  organization_id: string;
  region_id?: string | null;
  location_name: string;
  location_code?: string | null;
  email?: string | null;
  phone?: string | null;
  fax?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  operating_hours?: Record<string, any> | null;
  timezone?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
  notes?: string | null;
  api_record_unique_id?: string | null; // Unique ID from external API (e.g., Dentally site UUID)
  created_by?: string | null;
  chairs_count?: number | null;
  week_open_per_year?: number | null;
  days_open_per_week?: number | null;
  open_hours_per_day?: number | null;
  number_of_surgeries?: number | null;
  associate_weeks_per_year?: number | null;
  associate_days_per_week?: number | null;
  associate_cost_lab_source?: string | null;
  associate_cost_labs_percent?: number | null;
  material_cost_source?: string | null;
  practice_cost_materials_percent?: number | null;
  target_profit_percent?: number | null;
  target_chair_revenue_per_hour?: number | null;
  employee_working_duration_type?: string | null;
  is_associate_pay_including_lab_cost?: boolean | null;
  is_associate_pay_including_material_cost?: boolean | null;
}

export interface PracticeLocationUpdate {
  region_id?: string | null;
  location_name?: string;
  location_code?: string | null;
  email?: string | null;
  phone?: string | null;
  fax?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  operating_hours?: Record<string, any> | null;
  timezone?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
  notes?: string | null;
  api_record_unique_id?: string | null; // Unique ID from external API (e.g., Dentally site UUID)
  updated_by?: string | null;
  chairs_count?: number | null;
  week_open_per_year?: number | null;
  days_open_per_week?: number | null;
  open_hours_per_day?: number | null;
  number_of_surgeries?: number | null;
  associate_weeks_per_year?: number | null;
  associate_days_per_week?: number | null;
  associate_cost_lab_source?: string | null;
  associate_cost_labs_percent?: number | null;
  material_cost_source?: string | null;
  practice_cost_materials_percent?: number | null;
  target_profit_percent?: number | null;
  target_chair_revenue_per_hour?: number | null;
  employee_working_duration_type?: string | null;
  is_associate_pay_including_lab_cost?: boolean | null;
  is_associate_pay_including_material_cost?: boolean | null;
}

export interface Region {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface RegionInsert {
  organization_id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
  created_by?: string | null;
}

export interface RegionUpdate {
  name?: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
  updated_by?: string | null;
}
