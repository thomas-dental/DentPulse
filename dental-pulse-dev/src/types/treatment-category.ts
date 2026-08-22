export interface TreatmentCategory {
  id: string;
  organization_id: string;
  location_id: string | null;
  region_id: string | null;
  name: string;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  // Dentally-specific fields
  external_id: number | null;
}

export interface TreatmentCategoryInsert {
  organization_id: string;
  location_id?: string | null;
  region_id?: string | null;
  name: string;
  description?: string | null;
  display_order?: number;
  created_by?: string | null;
  // Dentally-specific fields
  external_id?: number | null;
}

export interface TreatmentCategoryUpdate {
  name?: string;
  description?: string | null;
  display_order?: number;
  location_id?: string | null;
  region_id?: string | null;
  updated_by?: string | null;
  // Dentally-specific fields
  external_id?: number | null;
}
