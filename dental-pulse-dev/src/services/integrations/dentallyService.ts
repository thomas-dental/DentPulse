/**
 * Dentally Integration Service
 * Handles all Dentally-specific API calls and sync operations
 */

import { callIntegrationApi, IntegrationApiResponse } from '../integrationService';
import { supabase } from '@/integrations/supabase/client';
import { TreatmentCategoryInsert } from '@/types/treatment-category';
import { TreatmentInsert } from '@/types/treatment';
import { ProviderInsert } from '@/types/provider';
import { PracticeLocationInsert } from '@/types/location';
import { createLocationInboundEmailsBatch } from '@/services/inboundService';

// ============================================
// DENTALLY API INTERFACES
// ============================================

export interface DentallyTreatmentCategory {
  id: number;
  name: string;
}

export interface DentallyTreatment {
  id: number;
  active: boolean;
  code: string;
  created_at: string;
  description: string;
  insurance_classification: string | null;
  nhs_treatment_cat: string | null;
  nomenclature: string;
  notes: string | null;
  owner: string;
  patient_description: string;
  patient_nomenclature: string;
  region: string;
  treatment_category_id: number;
  uda_band: string | null;
  updated_at: string;
}

export interface DentallyPractitioner {
  id: number;
  active: boolean;
  colour: string;
  created_at: string;
  default_contract_id: number | null;
  gdc_number: string;
  import_id: string | null;
  nhs_number: string;
  site_id: string; // UUID string from Dentally
  uda_target: number | null;
  uoa_target: number | null;
  updated_at: string;
  calendar_position: number | null;
  uuid: string; // Dentally UUID
  contract_targets: any[];
  user: {
    id: number;
    allowed_sites: any[];
    created_at: string;
    email: string;
    first_name: string;
    image_url: string;
    import_id: string | null;
    last_login: string | null;
    last_name: string;
    middle_name: string | null;
    mobile_phone: string | null;
    permission_level: number;
    practice_id: string;
    role: string;
    site_id: string;
    title: string | null;
    updated_at: string;
    uuid: string;
  };
  site?: {
    id: string;
    name: string;
    nickname: string;
    address_line_1: string;
    address_line_2: string;
    address_line_3: string | null;
    town: string;
    county: string;
    postcode: string;
    phone_number: string;
    email_address: string;
  };
}

export interface DentallyPaymentPlan {
  id: number;
  active: boolean;
  colour: string;
  created_at: string;
  dentist_recall_interval: number;
  emergency_duration: number;
  exam_appointments_included: number;
  exam_duration: number;
  exam_scale_and_polish_duration: number;
  hygiene_appointments_included: number;
  hygienist_recall_interval: number;
  name: string;
  monthly_memberhsip_fee?: string; // String representation of decimal (typo in some API versions)
  monthly_membership_fee?: string; // Correct spelling
  patient_friendly_name: string;
  recall_method: string;
  scale_and_polish_duration: number;
  site_id: string | null;
}

export interface DentallyNhsClaim {
  id: number;
  claim_status: string | null;
  sequence_number: string | null;
  approval_date: string | null;
  submitted_date: string | null;
  awarded_uda: number | string | null;
  expected_uda: number | string | null;
  uda_band: string | null;
  dentist_charge: number | string | null;
  patient_charge: number | string | null;
  patient_id: number | null;
  practitioner_id: number | null;
  treatment_plan_id: number | null;
  site_id: string | null;
  contract_id: number | null;
  ortho: boolean | null;
  continuation_part_number: string | null;
  status_comments: string | null;
  ni_calculated_dentist_fee: number | string | null;
  ni_calculated_patient_fee: number | string | null;
  scot_amount_authorised: number | string | null;
  scot_amount_expected: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  nhs_updated_at: string | null;
}

export interface DentallySite {
  id: string; // UUID
  active: boolean;
  active_mailbox_address: string | null;
  address_line_1: string;
  address_line_2: string;
  address_line_3: string | null;
  business_number: string | null;
  county: string;
  default_payment_plan_id: number | null;
  email_address: string;
  logo_url: string | null;
  name: string;
  nickname: string;
  opening_hours: {
    [key: string]: {
      open: string;
      close: string;
    } | null;
  };
  phone_number: string;
  postcode: string;
  practice_id: string;
  region: string;
  stripe_account_id: string | null;
  town: string;
  website: string | null;
  start_date: string | null;
}

export interface DentallyTreatmentPlanItem {
  id: number;
  charged: boolean;
  completed_at: string | null;
  completed: boolean;
  invoice_id: number | null;
  patient_id: number;
  patient_nomenclature: string | null;
  payment_plan_id: number | null;
  practitioner_id: number | null;
  price: string | number; // String representation of decimal or number
  site_id?: string | null; // Dentally site UUID (matches practice_locations.api_record_unique_id)
  treatment_appointment_id: number | null;
  treatment_id: number | null; // Dentally treatment ID (matches treatments.external_id)
  treatment_plan_id: number;
  duration: number | null; // Duration in minutes
  created_at: string | null;
  updated_at: string;
}

export interface DentallyTreatmentAppointment {
  id: number;
  appointment_id: number | null;
  bookable: boolean;
  patient_id: number;
  treatment_plan_id: number;
  created_at: string;
  updated_at: string;
}

export interface DentallyInvoiceLineItem {
  id: number;
  treatment_id: number | null;
  practitioner_id: number | null;
  sundry_id: number | null;
  treatment_plan_id: number | null;
  treatment_plan_item_id: number | null;
  description: string | null;
  quantity: number;
  gross: string;
  discount: string;
  net: string;
  tax: string;
  created_at: string;
  updated_at: string;
}

export interface DentallyInvoice {
  id: number;
  patient_id: number;
  user_id: number;
  plan_id: number | null;
  paid: boolean;
  amount: string;
  amount_paid: string;
  amount_outstanding: string;
  invoice_date: string;
  created_at: string;
  updated_at: string;
  invoice_items?: DentallyInvoiceLineItem[];
}

// ============================================
// SYNC RESULT INTERFACES
// ============================================

export interface SyncResult {
  success: boolean;
  categoriesSynced: number;
  treatmentsSynced: number;
  practitionersSynced: number;
  errors: string[];
}

export interface CategoriesSyncResult {
  success: boolean;
  categoriesSynced: number;
  categoryMap: Map<number, string>; // Maps Dentally category ID to our UUID
  errors: string[];
}

export interface TreatmentsSyncResult {
  success: boolean;
  treatmentsSynced: number;
  errors: string[];
}

export interface PractitionersSyncResult {
  success: boolean;
  practitionersSynced: number;
  errors: string[];
}

export interface LocationsSyncResult {
  success: boolean;
  locationsSynced: number;
  errors: string[];
}

export interface PaymentPlansSyncResult {
  success: boolean;
  paymentPlansSynced: number;
  errors: string[];
}

export interface TreatmentPlanItemsSyncResult {
  success: boolean;
  treatmentPlanItemsSynced: number;
  errors: string[];
}

export interface TreatmentAppointmentsSyncResult {
  success: boolean;
  treatmentAppointmentsSynced: number;
  errors: string[];
}

export interface NhsClaimsSyncResult {
  success: boolean;
  nhsClaimsSynced: number;
  errors: string[];
}

export interface InvoicesSyncResult {
  success: boolean;
  invoicesSynced: number;
  invoiceLineItemsSynced: number;
  errors: string[];
}

// ============================================
// DENTALLY API SERVICE
// ============================================

export const DentallyService = {
  /**
   * Build full endpoint URL from base endpoint
   * @param baseEndpoint - Base endpoint from database (e.g., 'https://api.dentally.co')
   * @param path - API path (e.g., '/api/v1/user')
   * @returns Full endpoint URL
   */
  buildEndpoint(baseEndpoint: string, path: string): string {
    // Remove trailing slash from base endpoint if present
    const base = baseEndpoint.replace(/\/$/, '');
    // Ensure path starts with /
    const apiPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${apiPath}`;
  },

  /**
   * Get user data from Dentally
   * Calls /v1/user endpoint to verify API key and get user info
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (e.g., 'https://api.dentally.co')
   */
  async getUser(apiKey: string, apiEndpoint?: string): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    const fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/user');

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      timeout: 10000,
    });
  },

  /**
   * Get treatments from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getTreatments(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/treatments');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get treatment categories from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getTreatmentCategories(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/treatment_categories');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get practitioners from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1', active: 'true' })
   */
  // Practitioners means Providers in our database
  async getProviders(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/practitioners');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0', // Required by Dentally API
      },
    });
  },

  /**
   * Get sites from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getSites(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/sites');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get payment plans from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getPaymentPlans(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/payment_plans');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get treatment plan items from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getTreatmentPlanItems(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/treatment_plan_items');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get treatment appointments from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1' })
   */
  async getTreatmentAppointments(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/treatment_appointments');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get NHS claims from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1', updated_after: '2024-01-01' })
   */
  async getNhsClaims(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/nhs_claims');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get invoices list from Dentally
   * @param apiKey - API key from database
   * @param apiEndpoint - Base API endpoint from database (optional)
   * @param params - Optional query parameters (e.g., { page: '1', start_date: '2024-01-01', end_date: '2024-12-31' })
   */
  async getInvoices(apiKey: string, apiEndpoint?: string, params?: Record<string, any>): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    let fullEndpoint = this.buildEndpoint(baseEndpoint, '/v1/invoices');

    // Add query parameters to URL if provided
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullEndpoint = `${fullEndpoint}?${queryString}`;
    }

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },

  /**
   * Get a single invoice by ID from Dentally
   * @param apiKey - API key from database
   * @param invoiceId - Dentally invoice ID
   * @param apiEndpoint - Base API endpoint from database (optional)
   */
  async getInvoice(apiKey: string, invoiceId: number, apiEndpoint?: string): Promise<IntegrationApiResponse> {
    const baseEndpoint = apiEndpoint || 'https://api.dentally.co';
    const fullEndpoint = this.buildEndpoint(baseEndpoint, `/v1/invoices/${invoiceId}`);

    return callIntegrationApi({
      endpoint: fullEndpoint,
      method: 'GET',
      apiKey,
      headers: {
        'User-Agent': 'DentPulse/1.0',
      },
    });
  },
};

// ============================================
// SYNC FUNCTIONS
// ============================================

/**
 * Sync practitioners from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyPractitioners(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<PractitionersSyncResult> {
  const errors: string[] = [];
  let practitionersSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      practitionersSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting practitioners sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL practitioners from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching practitioners from Dentally API...`);

    let allPractitioners: DentallyPractitioner[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching practitioners page ${currentPage}...`);

      const practitionersResult = await DentallyService.getProviders(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!practitionersResult.success || !practitionersResult.data) {
        throw new Error(practitionersResult.error || 'Failed to fetch practitioners');
      }

      // Handle array response or object with practitioners property
      let pagePractitioners: DentallyPractitioner[] = [];
      if (Array.isArray(practitionersResult.data)) {
        pagePractitioners = practitionersResult.data;
      } else if (practitionersResult.data.practitioners && Array.isArray(practitionersResult.data.practitioners)) {
        pagePractitioners = practitionersResult.data.practitioners;
      } else {
        throw new Error('Invalid practitioners response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pagePractitioners.length} practitioners`);

      // Add this page's practitioners to the full list
      allPractitioners = [...allPractitioners, ...pagePractitioners];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pagePractitioners.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const practitioners = allPractitioners;
    console.log(`[Dentally Sync] Fetched total of ${practitioners.length} practitioners across ${currentPage} page(s)`);

    // Step 2: Fetch ALL existing practitioners for this organization in ONE query (batch fetch)
    console.log(`[Dentally Sync] Fetching existing practitioners from database...`);
    const externalIds = practitioners.map(p => p.id);
    const { data: existingPractitionersData, error: existingPractitionersError } = await (supabase as any)
      .from('providers')
      .select('id, external_id')
      .eq('organization_id', organizationId)
      .in('external_id', externalIds);

    if (existingPractitionersError) {
      throw new Error(`Failed to fetch existing practitioners: ${existingPractitionersError.message}`);
    }

    // Create a map of external_id -> database id for existing practitioners
    const existingPractitionerMap = new Map<number, string>();
    if (existingPractitionersData) {
      existingPractitionersData.forEach((prov: any) => {
        if (prov.external_id) {
          existingPractitionerMap.set(prov.external_id, prov.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${existingPractitionerMap.size} existing practitioners`);

    // Step 3: Sync practitioners to database (batch operations using upsert)
    const practitionersToUpsert: Array<ProviderInsert & {
      external_id: number;
      gdc_number: string;
      nhs_number: string;
      uda_target: number | null;
      uoa_target: number | null;
      id?: string;
    }> = [];

    // Prepare all practitioners for upsert (both insert and update)
    for (const practitioner of practitioners) {
      // Build full name from user data
      const fullName = [
        practitioner.user.first_name,
        practitioner.user.middle_name,
        practitioner.user.last_name
      ].filter(Boolean).join(' ').trim() || `${practitioner.user.first_name} ${practitioner.user.last_name}`;

      // Map Dentally practitioner to our schema
      const practitionerData: ProviderInsert & {
        external_id: number;
        gdc_number: string;
        nhs_number: string;
        uda_target: number | null;
        uoa_target: number | null;
        provider_role: string | null;
        joining_date: string | null;
        id?: string;
      } = {
        organization_id: organizationId,
        name: fullName,
        email: practitioner.user.email || null,
        phone: practitioner.user.mobile_phone || null,
        photo_url: practitioner.user.image_url || null,
        is_active: practitioner.active,
        // Dentally-specific fields (only essential ones)
        external_id: practitioner.id,
        gdc_number: practitioner.gdc_number,
        nhs_number: practitioner.nhs_number,
        uda_target: practitioner.uda_target,
        uoa_target: practitioner.uoa_target,
        provider_role: practitioner.user.role || null, // Save Dentally role (Dentist, Hygienist, Therapist, etc.)
        joining_date: practitioner.user.created_at || null, // Date provider joined from Dentally
        // Default values for analytics fields (can be updated later)
        revenue: 0,
        patients: 0,
        avg_rev_per_patient: 0,
        utilisation: 0,
        trend: 0,
      };

      const existingId = existingPractitionerMap.get(practitioner.id);
      if (existingId) {
        // Practitioner exists - include id for update
        practitionerData.id = existingId;
        (practitionerData as any).updated_by = userId || null;
      } else {
        // Practitioner doesn't exist - will be inserted
        // DO NOT include id field for new inserts
        delete practitionerData.id;
        (practitionerData as any).created_by = userId || null;
      }

      practitionersToUpsert.push(practitionerData);
    }

    // Batch upsert practitioners (handles both insert and update in one operation)
    const PRACTITIONER_CHUNK_SIZE = 100;
    if (practitionersToUpsert.length > 0) {
      console.log(`[Dentally Sync] Upserting ${practitionersToUpsert.length} practitioners in chunks of ${PRACTITIONER_CHUNK_SIZE}...`);

      // Process in chunks
      for (let i = 0; i < practitionersToUpsert.length; i += PRACTITIONER_CHUNK_SIZE) {
        const chunk = practitionersToUpsert.slice(i, i + PRACTITIONER_CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing practitioner chunk ${Math.floor(i / PRACTITIONER_CHUNK_SIZE) + 1}/${Math.ceil(practitionersToUpsert.length / PRACTITIONER_CHUNK_SIZE)} (${chunk.length} items)...`);

        // Use upsert with onConflict to handle both inserts and updates
        const { data: upsertedPractitioners, error: upsertError } = await (supabase as any)
          .from('providers')
          .upsert(chunk, {
            onConflict: 'organization_id,external_id',
            ignoreDuplicates: false
          })
          .select('id');

        if (upsertError) {
          console.warn(`[Dentally Sync] Chunk upsert failed:`, upsertError);
          errors.push(`Failed to upsert practitioners chunk: ${upsertError.message}`);
          // Try individual upserts as fallback
          for (const provToUpsert of chunk) {
            try {
              const { data: upsertedPractitioner, error: singleUpsertError } = await (supabase as any)
                .from('providers')
                .upsert(provToUpsert, {
                  onConflict: 'organization_id,external_id',
                  ignoreDuplicates: false
                })
                .select('id')
                .single();

              if (singleUpsertError) {
                errors.push(`Failed to upsert practitioner (ID: ${provToUpsert.external_id}): ${singleUpsertError.message}`);
              } else {
                practitionersSynced++;
              }
            } catch (error: any) {
              errors.push(`Error upserting practitioner (ID: ${provToUpsert.external_id}): ${error.message}`);
            }
          }
        } else if (upsertedPractitioners) {
          console.log(`[Dentally Sync] Successfully upserted ${upsertedPractitioners.length} practitioners in chunk`);
          practitionersSynced += upsertedPractitioners.length;
        } else {
          console.warn(`[Dentally Sync] No data returned from practitioners upsert, but no error occurred`);
        }
      }
    }

    console.log(`[Dentally Sync] Synced ${practitionersSynced} practitioners to database`);
    console.log(`[Dentally Sync] Completed practitioners sync for organization ${organizationId}`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      practitionersSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed practitioners sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      practitionersSynced,
      errors,
    };
  }
}

/**
 * Sync sites (locations) from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyLocations(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<LocationsSyncResult> {
  const errors: string[] = [];
  let locationsSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      locationsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting locations sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL sites from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching sites from Dentally API...`);

    let allSites: DentallySite[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching sites page ${currentPage}...`);

      const sitesResult = await DentallyService.getSites(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!sitesResult.success || !sitesResult.data) {
        throw new Error(sitesResult.error || 'Failed to fetch sites');
      }

      // Handle array response, object with sites property, or single site object
      let pageSites: DentallySite[] = [];
      if (Array.isArray(sitesResult.data)) {
        pageSites = sitesResult.data;
      } else if (sitesResult.data.sites && Array.isArray(sitesResult.data.sites)) {
        pageSites = sitesResult.data.sites;
      } else if (sitesResult.data.site && typeof sitesResult.data.site === 'object') {
        // Handle single site object response
        pageSites = [sitesResult.data.site];
      } else if (sitesResult.data.id && sitesResult.data.name) {
        // Handle direct site object (not wrapped in site property)
        pageSites = [sitesResult.data];
      } else {
        throw new Error('Invalid sites response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageSites.length} sites`);

      // Add this page's sites to the full list
      allSites = [...allSites, ...pageSites];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageSites.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    console.log(`[Dentally Sync] Fetched total of ${allSites.length} sites across ${currentPage} page(s)`);

    // Step 1.5: Filter sites to only sync the site(s) that belong to this organization
    // This prevents creating locations from other Dentally sites under wrong organization
    let sites = allSites;

    // Filter sites by matching against existing practice_locations.api_record_unique_id
    // IMPORTANT: Always check by BOTH organization_id AND user_id
    console.log(`[Dentally Sync] Checking existing locations for organization_id: ${organizationId} AND user_id: ${userId}...`);

    const locQuery = (supabase as any)
      .from('practice_locations')
      .select('api_record_unique_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    if (userId) locQuery.eq('user_id', userId);

    const { data: existingLocs } = await locQuery;

    if (existingLocs && existingLocs.length > 0) {
      // Only sync sites that already have locations in this organization
      const existingSiteIds = new Set(existingLocs.map((loc: any) => loc.api_record_unique_id).filter(Boolean));
      sites = allSites.filter(site => existingSiteIds.has(site.id));
      console.log(`[Dentally Sync] Found ${existingSiteIds.size} existing site IDs, filtering to ${sites.length} site(s)`);
    } else {
      // No existing locations found - skip to prevent data issues
      console.warn(`[Dentally Sync] No existing locations found for this org - skipping location sync`);
      sites = [];
    }

    console.log(`[Dentally Sync] Will sync ${sites.length} site(s) for this organization`);

    // Step 1.6: Update organization with first site data (if sites exist)
    if (sites.length > 0) {
      const firstSite = sites[0]; // Use first site as primary organization data
      console.log(`[Dentally Sync] Updating organization with site data: ${firstSite.name}`);
      console.log(`[Dentally Sync] Site details:`, {
        name: firstSite.name,
        email: firstSite.email_address,
        phone: firstSite.phone_number,
        address: `${firstSite.address_line_1}, ${firstSite.town}, ${firstSite.postcode}`,
        region: firstSite.region,
      });

      // Build address string from site data
      const addressParts = [
        firstSite.address_line_1,
        firstSite.address_line_2,
        firstSite.town,
        firstSite.postcode
      ].filter(part => part && part.trim());
      const fullAddress = addressParts.join(', ');

      // Update organization with site data
      const orgUpdateData: any = {
        updated_at: new Date().toISOString(),
      };

      // Only update fields that have values
      if (firstSite.name) orgUpdateData.name = firstSite.name;
      if (firstSite.email_address) orgUpdateData.email = firstSite.email_address;
      if (firstSite.phone_number) orgUpdateData.phone = firstSite.phone_number;
      if (fullAddress) orgUpdateData.address = fullAddress;
      if (firstSite.logo_url) orgUpdateData.logo_url = firstSite.logo_url;

      const { error: orgUpdateError } = await (supabase as any)
        .from('organizations')
        .update(orgUpdateData)
        .eq('id', organizationId);

      if (orgUpdateError) {
        console.warn(`[Dentally Sync] Failed to update organization with site data:`, orgUpdateError);
        errors.push(`Failed to update organization: ${orgUpdateError.message}`);
      } else {
        console.log(`[Dentally Sync] Successfully updated organization with site data:`, orgUpdateData);
      }
    } else {
      console.warn(`[Dentally Sync] No sites found to update organization`);
    }

    // Step 2: Fetch existing regions for this organization and create/find region mappings
    console.log(`[Dentally Sync] Fetching existing regions from database...`);
    const { data: existingRegionsData, error: existingRegionsError } = await (supabase as any)
      .from('regions')
      .select('id, name')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    if (existingRegionsError) {
      throw new Error(`Failed to fetch existing regions: ${existingRegionsError.message}`);
    }

    // Create a map of region name -> region id (case-insensitive)
    const regionMap = new Map<string, string>();
    if (existingRegionsData) {
      existingRegionsData.forEach((reg: any) => {
        if (reg.name) {
          regionMap.set(reg.name.toLowerCase().trim(), reg.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${regionMap.size} existing regions`);

    // Step 3: Process regions from sites - create missing regions
    const uniqueRegions = new Set<string>();
    sites.forEach(site => {
      if (site.region && site.region.trim()) {
        uniqueRegions.add(site.region.trim());
      }
    });

    console.log(`[Dentally Sync] Processing ${uniqueRegions.size} unique regions from sites...`);
    for (const regionName of uniqueRegions) {
      const regionNameLower = regionName.toLowerCase().trim();
      if (!regionMap.has(regionNameLower)) {
        // Region doesn't exist - create it
        console.log(`[Dentally Sync] Creating new region: ${regionName}`);

        // Generate region code from name (first 3 letters, uppercase)
        const regionCode = regionName
          .replace(/[^a-zA-Z0-9]/g, '')
          .substring(0, 3)
          .toUpperCase();

        const { data: newRegion, error: createRegionError } = await (supabase as any)
          .from('regions')
          .insert({
            organization_id: organizationId,
            name: regionName,
            code: regionCode || null,
            description: `Region for ${regionName}`,
            is_active: true,
            created_by: userId || null,
          })
          .select('id')
          .single();

        if (createRegionError) {
          console.warn(`[Dentally Sync] Failed to create region "${regionName}": ${createRegionError.message}`);
          errors.push(`Failed to create region "${regionName}": ${createRegionError.message}`);
        } else if (newRegion) {
          regionMap.set(regionNameLower, newRegion.id);
          console.log(`[Dentally Sync] Created region "${regionName}" with ID: ${newRegion.id}`);
        }
      } else {
        console.log(`[Dentally Sync] Region "${regionName}" already exists, using existing region`);
      }
    }

    // Step 4: Fetch ALL existing locations for this user across ALL organizations (to prevent cross-org duplicates)
    // IMPORTANT: Check by user_id + api_record_unique_id to handle multi-org architecture (1 Dentally site = 1 org)
    const existingLocationsQuery = (supabase as any)
      .from('practice_locations')
      .select('id, location_name, api_record_unique_id, organization_id')
      .eq('user_id', userId)
      .is('deleted_at', null);

    const { data: existingLocationsData, error: existingLocationsError } = await existingLocationsQuery;

    if (existingLocationsError) {
      throw new Error(`Failed to fetch existing locations: ${existingLocationsError.message}`);
    }

    // Create a map of api_record_unique_id -> database id for existing locations
    const existingLocationMap = new Map<string, string>();
    // Also create a map of location name -> database id as fallback (case-insensitive)
    const existingLocationNameMap = new Map<string, string>();

    if (existingLocationsData) {
      existingLocationsData.forEach((loc: any) => {
        if (loc.api_record_unique_id) {
          existingLocationMap.set(loc.api_record_unique_id, loc.id);
        }
        if (loc.location_name) {
          existingLocationNameMap.set(loc.location_name.toLowerCase().trim(), loc.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${existingLocationMap.size} existing locations (by api_record_unique_id), ${existingLocationNameMap.size} (by name)`);
    console.log(`[Dentally Sync] Existing location IDs by api_record_unique_id:`, Array.from(existingLocationMap.entries()));
    console.log(`[Dentally Sync] Existing location IDs by name:`, Array.from(existingLocationNameMap.entries()));

    // Step 3: Sync locations to database (batch operations using upsert)
    const locationsToInsert: Array<PracticeLocationInsert & { id?: string }> = [];

    // Separate locations into insert and update batches
    for (const site of sites) {
      // Convert opening_hours format from Dentally to our format
      const operatingHours: Record<string, any> = {};
      if (site.opening_hours) {
        Object.keys(site.opening_hours).forEach(day => {
          const hours = site.opening_hours[day];
          if (hours && hours.open && hours.close) {
            operatingHours[day.toLowerCase()] = {
              open: hours.open,
              close: hours.close,
            };
          }
        });
      }

      // Get region_id from region name
      let regionId: string | null = null;
      if (site.region && site.region.trim()) {
        const regionNameLower = site.region.trim().toLowerCase();
        regionId = regionMap.get(regionNameLower) || null;
        if (!regionId) {
          console.warn(`[Dentally Sync] Region "${site.region}" not found in region map for site "${site.name}"`);
        }
      }

      // Map Dentally site to our location schema
      const locationData: Partial<PracticeLocationInsert> = {
        organization_id: organizationId,
        user_id: userId || null,
        location_name: site.name || site.nickname || 'Unnamed Location',
        location_code: site.nickname || site.name?.toLowerCase().replace(/\s+/g, '_') || null,
        email: site.email_address || null,
        phone: site.phone_number || null,
        address_line1: site.address_line_1 || null,
        address_line2: site.address_line_2 || null,
        city: site.town || null,
        state: site.county || null,
        postal_code: site.postcode || null,
        country: 'UK', // Default to UK for Dentally sites
        operating_hours: Object.keys(operatingHours).length > 0 ? operatingHours : null,
        is_active: site.active !== undefined ? site.active : true,
        is_primary: false, // First location will be set as primary below
        notes: site.website ? `Website: ${site.website}` : null,
        api_record_unique_id: site.id, // Store Dentally site ID
        region_id: regionId, // Map Dentally region to our region_id
        created_by: userId || null,
      };

      // Check if location exists by api_record_unique_id first (across ALL organizations for this user)
      let existingId = existingLocationMap.get(site.id);
      let matchedBy = '';
      let existingOrgId = '';

      if (existingId) {
        matchedBy = 'api_record_unique_id';
        // Find the org_id of the existing location
        const existingLoc = existingLocationsData?.find((loc: any) => loc.api_record_unique_id === site.id);
        existingOrgId = existingLoc?.organization_id || '';
      } else {
        // Fallback to name matching if api_record_unique_id not found
        const locationNameLower = (site.name || site.nickname).toLowerCase().trim();
        existingId = existingLocationNameMap.get(locationNameLower);
        if (existingId) {
          matchedBy = 'location_name';
          const existingLoc = existingLocationsData?.find((loc: any) => loc.id === existingId);
          existingOrgId = existingLoc?.organization_id || '';
        }
      }

      if (existingId) {
        // Location already exists for this user - SKIP to prevent duplicates
        locationsSynced++;
        continue;
      } else {
        // Location doesn't exist - will be inserted
        delete (locationData as any).id;
        locationData.created_by = userId || null;
      }

      locationsToInsert.push(locationData as PracticeLocationInsert & { id?: string });
    }

    // Set first location as primary if no primary exists
    if (locationsToInsert.length > 0) {
      // IMPORTANT: Always check by BOTH organization_id AND user_id
      const { data: existingPrimary } = await (supabase as any)
        .from('practice_locations')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('is_primary', true)
        .is('deleted_at', null)
        .limit(1);

      if ((!existingPrimary || existingPrimary.length === 0) && locationsToInsert.length > 0) {
        // Set first location as primary
        locationsToInsert[0].is_primary = true;
        console.log(`[Dentally Sync] Setting first location "${locationsToInsert[0].location_name}" as primary`);
      }
    }

    // Process locations - UPDATE existing or INSERT new (avoid duplicates)
    if (locationsToInsert.length > 0) {
      console.log(`[Dentally Sync] Processing ${locationsToInsert.length} locations (update existing or insert new)...`);

      for (const locationData of locationsToInsert) {
        try {
          if ((locationData as any).id) {
            // Location exists - UPDATE it
            const existingId = (locationData as any).id;
            const updateData = { ...locationData };
            delete (updateData as any).id; // Remove id from update data
            delete (updateData as any).created_by; // Don't update created_by

            const { error: updateError } = await (supabase as any)
              .from('practice_locations')
              .update(updateData)
              .eq('id', existingId);

            if (updateError) {
              console.error(`[Dentally Sync] Failed to update location "${locationData.location_name}":`, updateError);
              errors.push(`Failed to update location "${locationData.location_name}": ${updateError.message}`);
            } else {
              console.log(`[Dentally Sync] Updated location: ${locationData.location_name}`);
              locationsSynced++;
            }
          } else {
            // Location doesn't exist - INSERT new one
            const { error: insertError } = await (supabase as any)
              .from('practice_locations')
              .insert(locationData)
              .select('id')
              .single();

            if (insertError) {
              console.error(`[Dentally Sync] Failed to insert location "${locationData.location_name}":`, insertError);
              errors.push(`Failed to insert location "${locationData.location_name}": ${insertError.message}`);
            } else {
              console.log(`[Dentally Sync] Inserted location: ${locationData.location_name}`);
              locationsSynced++;
            }
          }
        } catch (error: any) {
          console.error(`[Dentally Sync] Error processing location "${locationData.location_name}":`, error);
          errors.push(`Error processing location "${locationData.location_name}": ${error.message}`);
        }
      }
    }

    console.log(`[Dentally Sync] Synced ${locationsSynced} locations to database`);

    // Step 4.5: Create inbound emails for newly synced locations
    console.log(`[Dentally Sync] Creating inbound emails for locations...`);

    // IMPORTANT: Always get locations by BOTH organization_id AND user_id
    const { data: allLocations } = await (supabase as any)
      .from('practice_locations')
      .select('id, location_name')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (allLocations && allLocations.length > 0) {
      // Use batch function from inboundService
      const locations = allLocations.map((loc: { id: string; location_name: string }) => ({
        id: loc.id,
        name: loc.location_name,
      }));

      const inboundResult = await createLocationInboundEmailsBatch(
        organizationId,
        locations,
        userId || undefined,
        5 // batch size
      );

      console.log(`[Dentally Sync] Inbound email creation complete: ${inboundResult.created} created, ${inboundResult.existed} already existed, ${inboundResult.failed} failed`);

      if (inboundResult.failed > 0) {
        errors.push(`Failed to create inbound emails for ${inboundResult.failed} locations`);
      }
    }

    // Step 5: Update treatments and categories with location_id and region_id
    console.log(`[Dentally Sync] Updating treatments and categories with location_id and region_id...`);

    // Get primary location (first active location) for default location_id
    // IMPORTANT: Always get by BOTH organization_id AND user_id
    const { data: primaryLocations } = await (supabase as any)
      .from('practice_locations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1);

    const primaryLocation = primaryLocations && primaryLocations.length > 0 ? primaryLocations[0] : null;

    const defaultLocationId = primaryLocation?.id || null;

    // Update treatments with region_id based on region field
    // Only do this if there are treatments in the database (skip during initial onboarding)
    if (regionMap.size > 0 || defaultLocationId) {
      // First check how many treatments exist
      const { count: treatmentsCount } = await (supabase as any)
        .from('treatments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      // Only update if there are treatments (not during initial onboarding)
      if (treatmentsCount && treatmentsCount > 0) {
        console.log(`[Dentally Sync] Found ${treatmentsCount} treatments to update with location/region info...`);

        // Get treatments that need updating
        const { data: treatmentsToUpdate } = await (supabase as any)
          .from('treatments')
          .select('id, region, location_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null);

        if (treatmentsToUpdate && treatmentsToUpdate.length > 0) {
          console.log(`[Dentally Sync] Updating ${treatmentsToUpdate.length} treatments with location_id and region_id...`);

          // Batch update for better performance
          const updatePromises = treatmentsToUpdate.map(async (treatment) => {
            let regionId: string | null = null;
            if (treatment.region) {
              const regionNameLower = treatment.region.trim().toLowerCase();
              regionId = regionMap.get(regionNameLower) || null;
            }

            const updateData: any = {};
            if (defaultLocationId && !treatment.location_id) {
              updateData.location_id = defaultLocationId;
            }
            if (regionId) {
              updateData.region_id = regionId;
            }

            if (Object.keys(updateData).length > 0) {
              return (supabase as any)
                .from('treatments')
                .update(updateData)
                .eq('id', treatment.id);
            }
          });

          await Promise.all(updatePromises.filter(Boolean));
          console.log(`[Dentally Sync] Updated treatments with location_id and region_id`);
        }
      } else {
        console.log(`[Dentally Sync] No treatments found, skipping treatment location/region update`);
      }

      // Update treatment categories with region_id
      const { data: categoriesToUpdate } = await (supabase as any)
        .from('treatment_categories')
        .select('id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      if (categoriesToUpdate && categoriesToUpdate.length > 0 && defaultLocationId) {
        console.log(`[Dentally Sync] Updating ${categoriesToUpdate.length} categories with location_id...`);

        await (supabase as any)
          .from('treatment_categories')
          .update({ location_id: defaultLocationId })
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .is('location_id', null);

        console.log(`[Dentally Sync] Updated categories with location_id`);
      }

      // Update providers without location_id to use default location
      // Note: site_id column was removed from providers table, so we use default location for all providers
      if (defaultLocationId) {
        console.log(`[Dentally Sync] Updating providers without location_id to use default location...`);

        const { error: providersUpdateError } = await (supabase as any)
          .from('providers')
          .update({ location_id: defaultLocationId })
          .eq('organization_id', organizationId)
          .is('location_id', null)
          .is('deleted_at', null);

        if (providersUpdateError) {
          console.warn(`[Dentally Sync] Failed to update providers with default location:`, providersUpdateError);
        } else {
          console.log(`[Dentally Sync] Updated providers with default location_id`);
        }
      }
    }

    console.log(`[Dentally Sync] Completed locations sync for organization ${organizationId}`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      locationsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed locations sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      locationsSynced,
      errors,
    };
  }
}

/**
 * Sync payment plans from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyPaymentPlans(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<PaymentPlansSyncResult> {
  const errors: string[] = [];
  let paymentPlansSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      paymentPlansSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting payment plans sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL payment plans from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching payment plans from Dentally API...`);

    let allPaymentPlans: DentallyPaymentPlan[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching payment plans page ${currentPage}...`);

      const paymentPlansResult = await DentallyService.getPaymentPlans(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!paymentPlansResult.success || !paymentPlansResult.data) {
        throw new Error(paymentPlansResult.error || 'Failed to fetch payment plans');
      }

      // Handle array response or object with payment_plans property
      let pagePaymentPlans: DentallyPaymentPlan[] = [];
      if (Array.isArray(paymentPlansResult.data)) {
        pagePaymentPlans = paymentPlansResult.data;
      } else if (paymentPlansResult.data.payment_plans && Array.isArray(paymentPlansResult.data.payment_plans)) {
        pagePaymentPlans = paymentPlansResult.data.payment_plans;
      } else if (paymentPlansResult.data.id && paymentPlansResult.data.name) {
        // Handle single payment plan object
        pagePaymentPlans = [paymentPlansResult.data];
      } else {
        throw new Error('Invalid payment plans response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pagePaymentPlans.length} payment plans`);

      // Add this page's payment plans to the full list
      allPaymentPlans = [...allPaymentPlans, ...pagePaymentPlans];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pagePaymentPlans.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const paymentPlans = allPaymentPlans;
    console.log(`[Dentally Sync] Fetched total of ${paymentPlans.length} payment plans across ${currentPage} page(s)`);

    // Step 2: Upsert payment plans into database
    if (paymentPlans.length > 0) {
      console.log(`[Dentally Sync] Upserting ${paymentPlans.length} payment plans into database...`);

      for (const plan of paymentPlans) {
        try {
          // Convert Dentally payment plan to our database format
          const paymentPlanData: any = {
            organization_id: organizationId,
            pp_id: plan.id,
            pp_name: plan.name,
            pp_is_active: plan.active,
            pp_dentist_recall_interval: plan.dentist_recall_interval,
            pp_emergency_duration: plan.emergency_duration,
            pp_exam_appointments_included: plan.exam_appointments_included,
            pp_exam_duration: plan.exam_duration,
            pp_exam_scale_and_polish_duration: plan.exam_scale_and_polish_duration,
            pp_hygiene_appointments_included: plan.hygiene_appointments_included,
            pp_hygienist_recall_interval: plan.hygienist_recall_interval,
            pp_monthly_memberhsip_fee: parseFloat(plan.monthly_membership_fee || plan.monthly_memberhsip_fee || '0') || 0,
            pp_patient_friendly_name: plan.patient_friendly_name,
            pp_recall_method: plan.recall_method,
            pp_scale_and_polish_duration: plan.scale_and_polish_duration,
            pp_colour: plan.colour,
            pp_site_id: plan.site_id,
            pp_created_at: plan.created_at,
            user_id: userId,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          };

          // Upsert payment plan (insert or update if exists)
          const { error: upsertError } = await (supabase as any)
            .from('payment_plans')
            .upsert(paymentPlanData, {
              onConflict: 'organization_id,pp_id',
            });

          if (upsertError) {
            console.error(`[Dentally Sync] Failed to upsert payment plan ${plan.id} (${plan.name}):`, upsertError);
            errors.push(`Failed to sync payment plan ${plan.name}: ${upsertError.message}`);
          } else {
            paymentPlansSynced++;
            console.log(`[Dentally Sync] ✓ Synced payment plan: ${plan.name} (ID: ${plan.id})`);
          }
        } catch (error: any) {
          console.error(`[Dentally Sync] Error processing payment plan ${plan.id}:`, error);
          errors.push(`Error processing payment plan ${plan.name}: ${error.message}`);
        }
      }
    } else {
      console.warn(`[Dentally Sync] No payment plans found from Dentally API`);
    }

    console.log(`[Dentally Sync] Completed payment plans sync for organization ${organizationId}`);
    console.log(`[Dentally Sync] Total synced: ${paymentPlansSynced} payment plans`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      paymentPlansSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed payment plans sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      paymentPlansSynced,
      errors,
    };
  }
}

/**
 * Sync treatment plan items from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyTreatmentPlanItems(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<TreatmentPlanItemsSyncResult> {
  const errors: string[] = [];
  let treatmentPlanItemsSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      treatmentPlanItemsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting treatment plan items sync for organization: ${organizationId}`);

  try {
    // Build location map: Dentally site UUID → our practice_locations.id
    const siteToLocationMap = new Map<string, string>();
    const { data: locationsData } = await (supabase as any)
      .from('practice_locations')
      .select('id, api_record_unique_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .not('api_record_unique_id', 'is', null);
    if (locationsData) {
      (locationsData as Array<{ id: string; api_record_unique_id: string }>).forEach(loc => {
        siteToLocationMap.set(loc.api_record_unique_id, loc.id);
      });
    }
    console.log(`[Dentally Sync] Location map built: ${siteToLocationMap.size} site(s)`);

    // Step 1: Fetch ALL treatment plan items from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching treatment plan items from Dentally API...`);

    let allTreatmentPlanItems: DentallyTreatmentPlanItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching treatment plan items page ${currentPage}...`);

      const treatmentPlanItemsResult = await DentallyService.getTreatmentPlanItems(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!treatmentPlanItemsResult.success || !treatmentPlanItemsResult.data) {
        throw new Error(treatmentPlanItemsResult.error || 'Failed to fetch treatment plan items');
      }

      // Handle array response or object with treatment_plan_items property
      let pageTreatmentPlanItems: DentallyTreatmentPlanItem[] = [];
      if (Array.isArray(treatmentPlanItemsResult.data)) {
        pageTreatmentPlanItems = treatmentPlanItemsResult.data;
      } else if (treatmentPlanItemsResult.data.treatment_plan_items && Array.isArray(treatmentPlanItemsResult.data.treatment_plan_items)) {
        pageTreatmentPlanItems = treatmentPlanItemsResult.data.treatment_plan_items;
      } else if (treatmentPlanItemsResult.data.id && treatmentPlanItemsResult.data.treatment_plan_id) {
        // Handle single treatment plan item object
        pageTreatmentPlanItems = [treatmentPlanItemsResult.data];
      } else {
        throw new Error('Invalid treatment plan items response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageTreatmentPlanItems.length} treatment plan items`);

      // Add this page's treatment plan items to the full list
      allTreatmentPlanItems = [...allTreatmentPlanItems, ...pageTreatmentPlanItems];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageTreatmentPlanItems.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const treatmentPlanItems = allTreatmentPlanItems;
    console.log(`[Dentally Sync] Fetched total of ${treatmentPlanItems.length} treatment plan items across ${currentPage} page(s)`);

    // Step 2: Upsert treatment plan items into database
    if (treatmentPlanItems.length > 0) {
      console.log(`[Dentally Sync] Upserting ${treatmentPlanItems.length} treatment plan items into database...`);

      for (const item of treatmentPlanItems) {
        try {
          // Convert Dentally treatment plan item to our database format
          const locationId = item.site_id ? (siteToLocationMap.get(item.site_id) ?? null) : null;
          const treatmentPlanItemData: any = {
            organization_id: organizationId,
            location_id: locationId,
            tpi_id: item.id,
            tpi_charged: item.charged || false,
            tpi_completed_at: item.completed_at || null,
            tpi_completed: item.completed || false,
            tpi_invoice_id: item.invoice_id || null,
            tpi_patient_id: item.patient_id || null,
            tpi_patient_nomenclature: item.patient_nomenclature || null,
            tpi_payment_plan_id: item.payment_plan_id || null,
            tpi_practitioner_id: item.practitioner_id || null,
            tpi_price: parseFloat(item.price as string) || null,
            tpi_treatment_appointment_id: item.treatment_appointment_id || null,
            tpi_treatment_plan_id: item.treatment_plan_id || null,
            tpi_treatment_id: item.treatment_id || null,
            tpi_updated_at: item.updated_at || null,
            duration: item.duration || null,
            tpi_created_at: item.created_at || null,
            user_id: userId,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          };

          // Upsert treatment plan item (insert or update if exists)
          const { error: upsertError } = await (supabase as any)
            .from('treatment_plan_items')
            .upsert(treatmentPlanItemData, {
              onConflict: 'organization_id,tpi_id',
            });

          if (upsertError) {
            console.error(`[Dentally Sync] Failed to upsert treatment plan item ${item.id}:`, upsertError);
            errors.push(`Failed to sync treatment plan item ${item.id}: ${upsertError.message}`);
          } else {
            treatmentPlanItemsSynced++;
            console.log(`[Dentally Sync] ✓ Synced treatment plan item: ${item.id}`);
          }
        } catch (error: any) {
          console.error(`[Dentally Sync] Error processing treatment plan item ${item.id}:`, error);
          errors.push(`Error processing treatment plan item ${item.id}: ${error.message}`);
        }
      }
    } else {
      console.warn(`[Dentally Sync] No treatment plan items found from Dentally API`);
    }

    console.log(`[Dentally Sync] Completed treatment plan items sync for organization ${organizationId}`);
    console.log(`[Dentally Sync] Total synced: ${treatmentPlanItemsSynced} treatment plan items`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      treatmentPlanItemsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed treatment plan items sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      treatmentPlanItemsSynced,
      errors,
    };
  }
}

/**
 * Sync treatment appointments from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyTreatmentAppointments(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<TreatmentAppointmentsSyncResult> {
  const errors: string[] = [];
  let treatmentAppointmentsSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      treatmentAppointmentsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting treatment appointments sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL treatment appointments from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching treatment appointments from Dentally API...`);

    let allTreatmentAppointments: DentallyTreatmentAppointment[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching treatment appointments page ${currentPage}...`);

      const treatmentAppointmentsResult = await DentallyService.getTreatmentAppointments(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!treatmentAppointmentsResult.success || !treatmentAppointmentsResult.data) {
        throw new Error(treatmentAppointmentsResult.error || 'Failed to fetch treatment appointments');
      }

      // Handle array response or object with treatment_appointments property
      let pageTreatmentAppointments: DentallyTreatmentAppointment[] = [];
      if (Array.isArray(treatmentAppointmentsResult.data)) {
        pageTreatmentAppointments = treatmentAppointmentsResult.data;
      } else if (treatmentAppointmentsResult.data.treatment_appointments && Array.isArray(treatmentAppointmentsResult.data.treatment_appointments)) {
        pageTreatmentAppointments = treatmentAppointmentsResult.data.treatment_appointments;
      } else if (treatmentAppointmentsResult.data.id && treatmentAppointmentsResult.data.treatment_plan_id) {
        // Handle single treatment appointment object
        pageTreatmentAppointments = [treatmentAppointmentsResult.data];
      } else {
        throw new Error('Invalid treatment appointments response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageTreatmentAppointments.length} treatment appointments`);

      // Add this page's treatment appointments to the full list
      allTreatmentAppointments = [...allTreatmentAppointments, ...pageTreatmentAppointments];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageTreatmentAppointments.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const treatmentAppointments = allTreatmentAppointments;
    console.log(`[Dentally Sync] Fetched total of ${treatmentAppointments.length} treatment appointments across ${currentPage} page(s)`);

    // Step 1.5: Build Dentally site_id → practice_locations.id map
    // So we can populate location_id on each treatment_appointment
    const siteToLocationMap = new Map<string, string>();
    try {
      const { data: locs } = await (supabase as any)
        .from('practice_locations')
        .select('id, api_record_unique_id')
        .eq('organization_id', organizationId)
        .not('api_record_unique_id', 'is', null)
        .is('deleted_at', null);
      if (locs) {
        for (const loc of locs) {
          if (loc.api_record_unique_id) {
            siteToLocationMap.set(loc.api_record_unique_id, loc.id);
          }
        }
      }
      console.log(`[Dentally Sync] Built site→location map: ${siteToLocationMap.size} entries`);
    } catch (mapErr: any) {
      console.warn(`[Dentally Sync] Could not build site→location map:`, mapErr.message);
    }

    // Step 2: Upsert treatment appointments into database
    if (treatmentAppointments.length > 0) {
      console.log(`[Dentally Sync] Upserting ${treatmentAppointments.length} treatment appointments into database...`);

      for (const appointment of treatmentAppointments) {
        try {
          // Resolve Dentally site_id → practice_locations.id
          const locationId = appointment.site_id ? siteToLocationMap.get(appointment.site_id) || null : null;

          // Convert Dentally treatment appointment to our database format
          const treatmentAppointmentData: any = {
            organization_id: organizationId,
            ta_id: appointment.id,
            ta_appointment_id: appointment.appointment_id || null,
            ta_bookable: appointment.bookable || false,
            ta_patient_id: appointment.patient_id || null,
            ta_treatment_plan_id: appointment.treatment_plan_id || null,
            ta_created_at: appointment.created_at || null,
            ta_updated_at: appointment.updated_at || null,
            location_id: locationId,
            user_id: userId,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          };

          // Upsert treatment appointment (insert or update if exists)
          const { error: upsertError } = await (supabase as any)
            .from('treatment_appointments')
            .upsert(treatmentAppointmentData, {
              onConflict: 'organization_id,ta_id',
            });

          if (upsertError) {
            console.error(`[Dentally Sync] Failed to upsert treatment appointment ${appointment.id}:`, upsertError);
            errors.push(`Failed to sync treatment appointment ${appointment.id}: ${upsertError.message}`);
          } else {
            treatmentAppointmentsSynced++;
            console.log(`[Dentally Sync] ✓ Synced treatment appointment: ${appointment.id}`);
          }
        } catch (error: any) {
          console.error(`[Dentally Sync] Error processing treatment appointment ${appointment.id}:`, error);
          errors.push(`Error processing treatment appointment ${appointment.id}: ${error.message}`);
        }
      }
    } else {
      console.warn(`[Dentally Sync] No treatment appointments found from Dentally API`);
    }

    console.log(`[Dentally Sync] Completed treatment appointments sync for organization ${organizationId}`);
    console.log(`[Dentally Sync] Total synced: ${treatmentAppointmentsSynced} treatment appointments`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      treatmentAppointmentsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed treatment appointments sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      treatmentAppointmentsSynced,
      errors,
    };
  }
}

/**
 * Sync treatment categories from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 * @returns CategoriesSyncResult with categoryMap for linking treatments
 */
export async function syncDentallyCategories(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<CategoriesSyncResult> {
  const errors: string[] = [];
  let categoriesSynced = 0;
  const categoryMap = new Map<number, string>(); // Maps Dentally category ID to our UUID

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      categoriesSynced: 0,
      categoryMap,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting categories sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL treatment categories from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching categories from Dentally API...`);

    let allCategories: DentallyTreatmentCategory[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching categories page ${currentPage}...`);

      const categoriesResult = await DentallyService.getTreatmentCategories(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!categoriesResult.success || !categoriesResult.data) {
        throw new Error(categoriesResult.error || 'Failed to fetch treatment categories');
      }

      // Handle array response or object with treatment_categories property
      let pageCategories: DentallyTreatmentCategory[] = [];
      if (Array.isArray(categoriesResult.data)) {
        pageCategories = categoriesResult.data;
      } else if (categoriesResult.data.treatment_categories && Array.isArray(categoriesResult.data.treatment_categories)) {
        pageCategories = categoriesResult.data.treatment_categories;
      } else {
        throw new Error('Invalid treatment categories response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageCategories.length} categories`);

      // Add this page's categories to the full list
      allCategories = [...allCategories, ...pageCategories];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageCategories.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const categories = allCategories;
    console.log(`[Dentally Sync] Fetched total of ${categories.length} categories across ${currentPage} page(s)`);

    // Step 2: Fetch ALL existing categories for this organization in ONE query (batch fetch)
    console.log(`[Dentally Sync] Fetching existing categories from database...`);
    const externalIds = categories.map(c => c.id);
    const { data: existingCategoriesData, error: existingCategoriesError } = await (supabase as any)
      .from('treatment_categories')
      .select('id, external_id')
      .eq('organization_id', organizationId)
      .in('external_id', externalIds)
      .is('deleted_at', null);

    if (existingCategoriesError) {
      throw new Error(`Failed to fetch existing categories: ${existingCategoriesError.message}`);
    }

    // Create a map of external_id -> database id for existing categories
    const existingCategoryMap = new Map<number, string>();
    if (existingCategoriesData) {
      existingCategoriesData.forEach((cat: any) => {
        if (cat.external_id) {
          existingCategoryMap.set(cat.external_id, cat.id);
          categoryMap.set(cat.external_id, cat.id); // Add existing to categoryMap
        }
      });
    }

    console.log(`[Dentally Sync] Found ${existingCategoryMap.size} existing categories`);

    // Step 3: Sync treatment categories to database (batch operations using upsert)
    const categoriesToUpsert: Array<TreatmentCategoryInsert & { id?: string }> = [];

    // Prepare all categories for upsert (both insert and update)
    for (const category of categories) {
      const existingId = existingCategoryMap.get(category.id);

      if (existingId) {
        // Category exists - include id for update
        categoriesToUpsert.push({
          id: existingId,
          organization_id: organizationId,
          name: category.name,
          external_id: category.id,
          updated_by: userId || null,
        } as TreatmentCategoryInsert & { id: string; updated_by?: string | null });
        categoryMap.set(category.id, existingId);
      } else {
        // Category doesn't exist - will be inserted
        categoriesToUpsert.push({
          organization_id: organizationId,
          name: category.name,
          external_id: category.id,
          created_by: userId || null,
        });
      }
    }

    // Batch upsert categories (handles both insert and update in one operation)
    const CHUNK_SIZE = 100;
    if (categoriesToUpsert.length > 0) {
      console.log(`[Dentally Sync] Upserting ${categoriesToUpsert.length} categories in chunks of ${CHUNK_SIZE}...`);

      // Process in chunks
      for (let i = 0; i < categoriesToUpsert.length; i += CHUNK_SIZE) {
        const chunk = categoriesToUpsert.slice(i, i + CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing category chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(categoriesToUpsert.length / CHUNK_SIZE)} (${chunk.length} items)...`);

        // Use upsert with onConflict to handle both inserts and updates
        const { data: upsertedCategories, error: upsertError } = await (supabase as any)
          .from('treatment_categories')
          .upsert(chunk, {
            onConflict: 'organization_id,external_id',
            ignoreDuplicates: false
          })
          .select('id, external_id');

        if (upsertError) {
          console.warn(`[Dentally Sync] Chunk upsert failed:`, upsertError);
          errors.push(`Failed to upsert categories chunk: ${upsertError.message}`);
          // Try individual upserts as fallback
          for (const catToUpsert of chunk) {
            try {
              const { data: upsertedCategory, error: singleUpsertError } = await (supabase as any)
                .from('treatment_categories')
                .upsert(catToUpsert, {
                  onConflict: 'organization_id,external_id',
                  ignoreDuplicates: false
                })
                .select('id, external_id')
                .single();

              if (singleUpsertError) {
                errors.push(`Failed to upsert category (ID: ${catToUpsert.external_id}): ${singleUpsertError.message}`);
              } else if (upsertedCategory) {
                categoryMap.set(upsertedCategory.external_id, upsertedCategory.id);
                categoriesSynced++;
              }
            } catch (error: any) {
              errors.push(`Error upserting category (ID: ${catToUpsert.external_id}): ${error.message}`);
            }
          }
        } else if (upsertedCategories) {
          console.log(`[Dentally Sync] Successfully upserted ${upsertedCategories.length} categories in chunk`);
          upsertedCategories.forEach((cat: any) => {
            if (cat.external_id) {
              categoryMap.set(cat.external_id, cat.id);
              categoriesSynced++;
            }
          });
        } else {
          console.warn(`[Dentally Sync] No data returned from categories upsert, but no error occurred`);
        }
      }
    }

    console.log(`[Dentally Sync] Synced ${categoriesSynced} categories to database`);

    return {
      success: errors.length === 0,
      categoriesSynced,
      categoryMap,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed categories sync for organization ${organizationId}:`, error);
    errors.push(`Categories sync failed: ${error.message}`);
    return {
      success: false,
      categoriesSynced,
      categoryMap,
      errors,
    };
  }
}

/**
 * Sync treatments from Dentally (requires categoryMap from syncDentallyCategories)
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param categoryMap - Map of Dentally category ID to database UUID (from syncDentallyCategories)
 * @param userId - User ID (optional, for audit fields)
 * @returns TreatmentsSyncResult
 */
export async function syncDentallyTreatmentsOnly(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  categoryMap: Map<number, string>,
  userId?: string | null
): Promise<TreatmentsSyncResult> {
  const errors: string[] = [];
  let treatmentsSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      treatmentsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting treatments sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL treatments from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching treatments from Dentally API...`);

    let allTreatments: DentallyTreatment[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching treatments page ${currentPage}...`);

      const treatmentsResult = await DentallyService.getTreatments(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!treatmentsResult.success || !treatmentsResult.data) {
        throw new Error(treatmentsResult.error || 'Failed to fetch treatments');
      }

      // Handle array response or object with treatments property
      let pageTreatments: DentallyTreatment[] = [];
      if (Array.isArray(treatmentsResult.data)) {
        pageTreatments = treatmentsResult.data;
      } else if (treatmentsResult.data.treatments && Array.isArray(treatmentsResult.data.treatments)) {
        pageTreatments = treatmentsResult.data.treatments;
      } else {
        throw new Error('Invalid treatments response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageTreatments.length} treatments`);

      // Add this page's treatments to the full list
      allTreatments = [...allTreatments, ...pageTreatments];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageTreatments.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const treatments = allTreatments;
    console.log(`[Dentally Sync] Fetched total of ${treatments.length} treatments across ${currentPage} page(s)`);

    // Step 2: Fetch ALL existing treatments for this organization in ONE query (batch fetch)
    console.log(`[Dentally Sync] Fetching existing treatments from database...`);
    const treatmentExternalIds = treatments.map(t => t.id);
    const { data: existingTreatmentsData, error: existingTreatmentsError } = await (supabase as any)
      .from('treatments')
      .select('id, external_id')
      .eq('organization_id', organizationId)
      .in('external_id', treatmentExternalIds)
      .is('deleted_at', null);

    if (existingTreatmentsError) {
      throw new Error(`Failed to fetch existing treatments: ${existingTreatmentsError.message}`);
    }

    // Create a map of external_id -> database id for existing treatments
    const existingTreatmentMap = new Map<number, string>();
    if (existingTreatmentsData) {
      existingTreatmentsData.forEach((treat: any) => {
        if (treat.external_id) {
          existingTreatmentMap.set(treat.external_id, treat.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${existingTreatmentMap.size} existing treatments`);

    // Step 3: Sync treatments to database (batch operations using upsert)
    const treatmentsToUpsert: Array<TreatmentInsert & { is_active: boolean; id?: string }> = [];

    // Prepare all treatments for upsert (both insert and update)
    for (const treatment of treatments) {
      // Get category UUID from map
      const categoryId = treatment.treatment_category_id
        ? categoryMap.get(treatment.treatment_category_id) || null
        : null;

      // Determine treatment type
      const treatmentType = treatment.nhs_treatment_cat ? 'nhs' : 'private';

      // Map Dentally treatment to our schema
      const treatmentData: Partial<TreatmentInsert> & { is_active: boolean; id?: string } = {
        organization_id: organizationId,
        category_id: categoryId,
        treatment_name: treatment.nomenclature || treatment.description || treatment.code,
        treatment_code: treatment.code,
        description: treatment.description,
        treatment_type: treatmentType,
        price: 0,
        notes: treatment.notes,
        external_id: treatment.id,
        insurance_classification: treatment.insurance_classification,
        nhs_treatment_cat: treatment.nhs_treatment_cat,
        nomenclature: treatment.nomenclature,
        owner: treatment.owner,
        patient_description: treatment.patient_description || null,
        patient_nomenclature: treatment.patient_nomenclature,
        region: treatment.region,
        uda_band: treatment.uda_band,
        is_active: treatment.active,
      };

      const existingId = existingTreatmentMap.get(treatment.id);
      if (existingId) {
        // Treatment exists - include id for update
        (treatmentData as any).id = existingId;
        (treatmentData as any).updated_by = userId || null;
      } else {
        // Treatment doesn't exist - will be inserted
        // DO NOT include id field for new inserts
        delete (treatmentData as any).id;
        treatmentData.created_by = userId || null;
      }

      treatmentsToUpsert.push(treatmentData as TreatmentInsert & { is_active: boolean; id?: string });
    }

    // Batch upsert treatments (handles both insert and update in one operation)
    const TREATMENT_CHUNK_SIZE = 100;
    if (treatmentsToUpsert.length > 0) {
      console.log(`[Dentally Sync] Upserting ${treatmentsToUpsert.length} treatments in chunks of ${TREATMENT_CHUNK_SIZE}...`);

      // Process in chunks
      for (let i = 0; i < treatmentsToUpsert.length; i += TREATMENT_CHUNK_SIZE) {
        const chunk = treatmentsToUpsert.slice(i, i + TREATMENT_CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing treatment chunk ${Math.floor(i / TREATMENT_CHUNK_SIZE) + 1}/${Math.ceil(treatmentsToUpsert.length / TREATMENT_CHUNK_SIZE)} (${chunk.length} items)...`);

        // Use upsert with onConflict to handle both inserts and updates
        const { data: upsertedTreatments, error: upsertError } = await (supabase as any)
          .from('treatments')
          .upsert(chunk, {
            onConflict: 'organization_id,external_id',
            ignoreDuplicates: false
          })
          .select('id');

        if (upsertError) {
          console.warn(`[Dentally Sync] Chunk upsert failed:`, upsertError);
          errors.push(`Failed to upsert treatments chunk: ${upsertError.message}`);
          // Try individual upserts as fallback
          for (const treatToUpsert of chunk) {
            try {
              const { data: upsertedTreatment, error: singleUpsertError } = await (supabase as any)
                .from('treatments')
                .upsert(treatToUpsert, {
                  onConflict: 'organization_id,external_id',
                  ignoreDuplicates: false
                })
                .select('id')
                .single();

              if (singleUpsertError) {
                errors.push(`Failed to upsert treatment (ID: ${treatToUpsert.external_id}): ${singleUpsertError.message}`);
              } else {
                treatmentsSynced++;
              }
            } catch (error: any) {
              errors.push(`Error upserting treatment (ID: ${treatToUpsert.external_id}): ${error.message}`);
            }
          }
        } else if (upsertedTreatments) {
          console.log(`[Dentally Sync] Successfully upserted ${upsertedTreatments.length} treatments in chunk`);
          treatmentsSynced += upsertedTreatments.length;
        } else {
          console.warn(`[Dentally Sync] No data returned from treatments upsert, but no error occurred`);
        }
      }
    }

    console.log(`[Dentally Sync] Synced ${treatmentsSynced} treatments to database`);

    return {
      success: errors.length === 0,
      treatmentsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed treatments sync for organization ${organizationId}:`, error);
    errors.push(`Treatments sync failed: ${error.message}`);
    return {
      success: false,
      treatmentsSynced,
      errors,
    };
  }
}

/**
 * Map existing treatments to categories based on Dentally treatment_category_id
 * This function fixes treatments that have external_id but missing category_id
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function mapTreatmentsToCategories(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<{ success: boolean; treatmentsMapped: number; errors: string[] }> {
  const errors: string[] = [];
  let treatmentsMapped = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      treatmentsMapped: 0,
      errors: ['Organization ID is required'],
    };
  }

  console.log(`[Dentally Sync] Starting treatment-category mapping for organization: ${organizationId}`);

  try {
    // Step 1: Get categoryMap from existing categories in database
    // This maps Dentally category ID (external_id) to our category UUID
    console.log(`[Dentally Sync] Fetching category mapping from database...`);
    const { data: categoriesData, error: categoriesError } = await (supabase as any)
      .from('treatment_categories')
      .select('id, external_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .not('external_id', 'is', null);

    if (categoriesError) {
      throw new Error(`Failed to fetch categories: ${categoriesError.message}`);
    }

    // Create map: Dentally category ID -> our category UUID
    const categoryMap = new Map<number, string>();
    if (categoriesData && categoriesData.length > 0) {
      categoriesData.forEach((cat: any) => {
        if (cat.external_id && cat.id) {
          categoryMap.set(cat.external_id, cat.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${categoryMap.size} categories with external_id mapping`);

    if (categoryMap.size === 0) {
      return {
        success: false,
        treatmentsMapped: 0,
        errors: ['No categories found with external_id. Please sync categories first.'],
      };
    }

    // Step 2: Fetch treatments from Dentally API to get their treatment_category_id
    console.log(`[Dentally Sync] Fetching treatments from Dentally API...`);

    let allTreatments: DentallyTreatment[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching treatments page ${currentPage}...`);

      const treatmentsResult = await DentallyService.getTreatments(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!treatmentsResult.success || !treatmentsResult.data) {
        throw new Error(treatmentsResult.error || 'Failed to fetch treatments');
      }

      let pageTreatments: DentallyTreatment[] = [];
      if (Array.isArray(treatmentsResult.data)) {
        pageTreatments = treatmentsResult.data;
      } else if (treatmentsResult.data.treatments && Array.isArray(treatmentsResult.data.treatments)) {
        pageTreatments = treatmentsResult.data.treatments;
      } else {
        throw new Error('Invalid treatments response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageTreatments.length} treatments`);

      allTreatments = [...allTreatments, ...pageTreatments];

      if (pageTreatments.length < 25) {
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        currentPage++;
      }
    }

    console.log(`[Dentally Sync] Fetched total of ${allTreatments.length} treatments from Dentally`);

    // Step 3: Get existing treatments from database that need category mapping
    // Only get treatments that have external_id but no category_id
    console.log(`[Dentally Sync] Fetching treatments without category_id from database...`);
    const treatmentExternalIds = allTreatments.map(t => t.id);
    const { data: existingTreatmentsData, error: existingTreatmentsError } = await (supabase as any)
      .from('treatments')
      .select('id, external_id, category_id')
      .eq('organization_id', organizationId)
      .in('external_id', treatmentExternalIds)
      .is('deleted_at', null)
      .is('category_id', null); // Only treatments without category_id

    if (existingTreatmentsError) {
      throw new Error(`Failed to fetch existing treatments: ${existingTreatmentsError.message}`);
    }

    console.log(`[Dentally Sync] Found ${existingTreatmentsData?.length || 0} treatments without category_id`);

    if (!existingTreatmentsData || existingTreatmentsData.length === 0) {
      return {
        success: true,
        treatmentsMapped: 0,
        errors: [],
      };
    }

    // Step 4: Create a map of external_id -> treatment data from Dentally
    const dentallyTreatmentMap = new Map<number, DentallyTreatment>();
    allTreatments.forEach(treatment => {
      dentallyTreatmentMap.set(treatment.id, treatment);
    });

    // Step 5: Map treatments to categories and update in batches
    const TREATMENT_UPDATE_CHUNK_SIZE = 100;
    const treatmentsToUpdate: Array<{ id: string; category_id: string }> = [];

    for (const dbTreatment of existingTreatmentsData) {
      const dentallyTreatment = dentallyTreatmentMap.get(dbTreatment.external_id);

      if (dentallyTreatment && dentallyTreatment.treatment_category_id) {
        const categoryId = categoryMap.get(dentallyTreatment.treatment_category_id);

        if (categoryId) {
          treatmentsToUpdate.push({
            id: dbTreatment.id,
            category_id: categoryId,
          });
        } else {
          console.warn(`[Dentally Sync] Treatment ${dbTreatment.external_id} has category_id ${dentallyTreatment.treatment_category_id} but category not found in database`);
          errors.push(`Treatment ${dbTreatment.external_id}: Category ${dentallyTreatment.treatment_category_id} not found`);
        }
      } else {
        console.warn(`[Dentally Sync] Treatment ${dbTreatment.external_id} not found in Dentally data or has no treatment_category_id`);
        if (!dentallyTreatment) {
          errors.push(`Treatment ${dbTreatment.external_id}: Not found in Dentally API response`);
        } else {
          errors.push(`Treatment ${dbTreatment.external_id}: No treatment_category_id in Dentally data`);
        }
      }
    }

    console.log(`[Dentally Sync] Mapping ${treatmentsToUpdate.length} treatments to categories...`);

    // Step 6: Update treatments in batches
    if (treatmentsToUpdate.length > 0) {
      for (let i = 0; i < treatmentsToUpdate.length; i += TREATMENT_UPDATE_CHUNK_SIZE) {
        const chunk = treatmentsToUpdate.slice(i, i + TREATMENT_UPDATE_CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing update chunk ${Math.floor(i / TREATMENT_UPDATE_CHUNK_SIZE) + 1}/${Math.ceil(treatmentsToUpdate.length / TREATMENT_UPDATE_CHUNK_SIZE)} (${chunk.length} items)...`);

        // Update each treatment individually (Supabase doesn't support batch updates with different values)
        const updatePromises = chunk.map(async (treatmentUpdate) => {
          const { error: updateError } = await (supabase as any)
            .from('treatments')
            .update({
              category_id: treatmentUpdate.category_id,
              updated_by: userId || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', treatmentUpdate.id);

          if (updateError) {
            console.error(`[Dentally Sync] Failed to update treatment ${treatmentUpdate.id}:`, updateError);
            errors.push(`Failed to update treatment ${treatmentUpdate.id}: ${updateError.message}`);
            return false;
          }
          return true;
        });

        const results = await Promise.all(updatePromises);
        const successCount = results.filter(r => r === true).length;
        treatmentsMapped += successCount;
        console.log(`[Dentally Sync] Successfully mapped ${successCount} treatments in chunk`);
      }
    }

    console.log(`[Dentally Sync] Completed treatment-category mapping: ${treatmentsMapped} treatments mapped`);

    return {
      success: errors.length === 0,
      treatmentsMapped,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed treatment-category mapping for organization ${organizationId}:`, error);
    errors.push(`Mapping failed: ${error.message}`);
    return {
      success: false,
      treatmentsMapped,
      errors,
    };
  }
}

/**
 * Sync treatment categories and treatments from Dentally
 * This is the main function that orchestrates categories, treatments, and practitioners sync
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyTreatments(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<SyncResult> {
  const errors: string[] = [];
  let categoriesSynced = 0;
  let treatmentsSynced = 0;
  let practitionersSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      categoriesSynced: 0,
      treatmentsSynced: 0,
      practitionersSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting sync for organization: ${organizationId}`);

  try {
    // Step 1: Sync categories first (needed for treatment category mapping)
    console.log(`[Dentally Sync] Step 1: Syncing categories...`);
    const categoriesResult = await syncDentallyCategories(
      apiKey,
      apiEndpoint,
      organizationId,
      userId
    );

    categoriesSynced = categoriesResult.categoriesSynced;
    if (categoriesResult.errors.length > 0) {
      errors.push(...categoriesResult.errors);
    }

    // Step 2: Sync treatments (requires categoryMap from categories sync)
    console.log(`[Dentally Sync] Step 2: Syncing treatments...`);
    const treatmentsResult = await syncDentallyTreatmentsOnly(
      apiKey,
      apiEndpoint,
      organizationId,
      categoriesResult.categoryMap,
      userId
    );

    treatmentsSynced = treatmentsResult.treatmentsSynced;
    if (treatmentsResult.errors.length > 0) {
      errors.push(...treatmentsResult.errors);
    }

    // Step 2.5: Map any treatments that might have been synced without category_id
    // This ensures treatments get their category_id even if they were synced before categories
    console.log(`[Dentally Sync] Step 2.5: Mapping treatments to categories...`);
    try {
      const mappingResult = await mapTreatmentsToCategories(
        apiKey,
        apiEndpoint,
        organizationId,
        userId
      );

      if (mappingResult.treatmentsMapped > 0) {
        console.log(`[Dentally Sync] Mapped ${mappingResult.treatmentsMapped} treatments to categories`);
      }
      if (mappingResult.errors.length > 0) {
        errors.push(...mappingResult.errors);
      }
    } catch (error: any) {
      console.error(`[Dentally Sync] Treatment-category mapping failed:`, error);
      errors.push(`Treatment-category mapping failed: ${error.message}`);
      // Don't fail entire sync if mapping fails
    }

    // Step 3: Sync practitioners (optional - can be done separately or together)
    console.log(`[Dentally Sync] Step 3: Syncing practitioners...`);
    try {
      const practitionersResult = await syncDentallyPractitioners(
        apiKey,
        apiEndpoint,
        organizationId,
        userId
      );

      practitionersSynced = practitionersResult.practitionersSynced;
      if (practitionersResult.errors.length > 0) {
        errors.push(...practitionersResult.errors);
      }

      console.log(`[Dentally Sync] Synced ${practitionersSynced} practitioners to database`);
    } catch (error: any) {
      console.error(`[Dentally Sync] Practitioners sync failed:`, error);
      errors.push(`Practitioners sync failed: ${error.message}`);
      // Don't fail entire sync if practitioners sync fails
    }

    console.log(`[Dentally Sync] Completed for organization ${organizationId}: ${categoriesSynced} categories, ${treatmentsSynced} treatments, ${practitionersSynced} practitioners synced`);

    // Ensure all data is saved before returning
    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      categoriesSynced,
      treatmentsSynced,
      practitionersSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      categoriesSynced,
      treatmentsSynced,
      practitionersSynced,
      errors,
    };
  }
}

/**
 * Sync invoices and invoice line items from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param integrationId - Integration ID for linking invoices
 * @param startDate - Optional start date for filtering invoices (YYYY-MM-DD)
 * @param endDate - Optional end date for filtering invoices (YYYY-MM-DD)
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyInvoices(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  integrationId: string,
  startDate?: string | null,
  endDate?: string | null,
  userId?: string | null
): Promise<InvoicesSyncResult> {
  const errors: string[] = [];
  let invoicesSynced = 0;
  let invoiceLineItemsSynced = 0;

  // Validate required parameters
  if (!organizationId) {
    return {
      success: false,
      invoicesSynced: 0,
      invoiceLineItemsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  if (!integrationId) {
    return {
      success: false,
      invoicesSynced: 0,
      invoiceLineItemsSynced: 0,
      errors: ['Integration ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting invoices sync for organization: ${organizationId}`);
  console.log(`[Dentally Sync] Date range: ${startDate || 'beginning'} to ${endDate || 'now'}`);

  try {
    // Step 1: Fetch ALL invoices from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching invoices from Dentally API...`);

    let allInvoices: DentallyInvoice[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Build query parameters for date filtering
    const queryParams: Record<string, any> = {};
    if (startDate) {
      queryParams.start_date = startDate;
    }
    if (endDate) {
      queryParams.end_date = endDate;
    }

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching invoices page ${currentPage}...`);

      const invoicesResult = await DentallyService.getInvoices(
        apiKey,
        apiEndpoint,
        { ...queryParams, page: currentPage.toString() }
      );

      if (!invoicesResult.success || !invoicesResult.data) {
        throw new Error(invoicesResult.error || 'Failed to fetch invoices');
      }

      // Handle array response or object with invoices property
      let pageInvoices: DentallyInvoice[] = [];
      if (Array.isArray(invoicesResult.data)) {
        pageInvoices = invoicesResult.data;
      } else if (invoicesResult.data.invoices && Array.isArray(invoicesResult.data.invoices)) {
        pageInvoices = invoicesResult.data.invoices;
      } else if (invoicesResult.data.id && invoicesResult.data.invoice_date) {
        // Handle single invoice object
        pageInvoices = [invoicesResult.data];
      } else {
        throw new Error('Invalid invoices response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageInvoices.length} invoices`);

      // Add this page's invoices to the full list
      allInvoices = [...allInvoices, ...pageInvoices];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageInvoices.length < 25) {
        // Last page - fewer than 25 items means no more pages
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        // More pages might exist, continue to next page
        currentPage++;
      }
    }

    const invoices = allInvoices;
    console.log(`[Dentally Sync] Fetched total of ${invoices.length} invoices across ${currentPage} page(s)`);

    // Step 2: For each invoice, fetch detailed invoice data (includes invoice_items)
    console.log(`[Dentally Sync] Fetching detailed invoice data for ${invoices.length} invoices...`);

    const detailedInvoices: DentallyInvoice[] = [];
    for (const invoice of invoices) {
      try {
        const invoiceDetailResult = await DentallyService.getInvoice(
          apiKey,
          invoice.id,
          apiEndpoint
        );

        if (!invoiceDetailResult.success || !invoiceDetailResult.data) {
          console.warn(`[Dentally Sync] Failed to fetch details for invoice ${invoice.id}: ${invoiceDetailResult.error}`);
          errors.push(`Failed to fetch details for invoice ${invoice.id}: ${invoiceDetailResult.error}`);
          continue;
        }

        // Handle response format
        let detailedInvoice: DentallyInvoice;
        if (invoiceDetailResult.data.invoice) {
          detailedInvoice = invoiceDetailResult.data.invoice;
        } else {
          detailedInvoice = invoiceDetailResult.data;
        }

        detailedInvoices.push(detailedInvoice);
      } catch (error: any) {
        console.warn(`[Dentally Sync] Error fetching details for invoice ${invoice.id}:`, error);
        errors.push(`Error fetching details for invoice ${invoice.id}: ${error.message}`);
      }
    }

    console.log(`[Dentally Sync] Fetched details for ${detailedInvoices.length} invoices`);

    // Step 3: Fetch existing invoices from database to determine inserts vs updates
    console.log(`[Dentally Sync] Fetching existing invoices from database...`);
    const invoiceExternalIds = detailedInvoices.map(inv => inv.id);
    const { data: existingInvoicesData, error: existingInvoicesError } = await (supabase as any)
      .from('platform_integration_invoices')
      .select('id, platform_invoice_id')
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId)
      .in('platform_invoice_id', invoiceExternalIds);

    if (existingInvoicesError) {
      throw new Error(`Failed to fetch existing invoices: ${existingInvoicesError.message}`);
    }

    // Create a map of platform_invoice_id -> database id for existing invoices
    const existingInvoiceMap = new Map<number, string>();
    if (existingInvoicesData) {
      existingInvoicesData.forEach((inv: any) => {
        if (inv.platform_invoice_id) {
          existingInvoiceMap.set(inv.platform_invoice_id, inv.id);
        }
      });
    }

    console.log(`[Dentally Sync] Found ${existingInvoiceMap.size} existing invoices`);

    // Step 4: Prepare invoices for upsert
    const invoicesToUpsert: any[] = [];
    const invoiceLineItemsToUpsert: any[] = [];

    for (const invoice of detailedInvoices) {
      // Determine invoice status based on paid field
      let status = 'outstanding';
      if (invoice.paid) {
        status = 'paid';
      } else if (parseFloat(invoice.amount_paid) > 0) {
        status = 'partially_paid';
      }

      // Map Dentally invoice to our schema
      const invoiceData: any = {
        organization_id: organizationId,
        integration_id: integrationId,
        platform_invoice_id: invoice.id,
        patient_id: invoice.patient_id,
        invoice_user_id: invoice.user_id,
        plan_id: invoice.plan_id,
        status: status,
        amount: parseFloat(invoice.amount),
        subtotal: parseFloat(invoice.amount), // Populate subtotal so invoice-based revenue queries work
        amount_paid: parseFloat(invoice.amount_paid),
        amount_outstanding: parseFloat(invoice.amount_outstanding),
        invoice_date: invoice.invoice_date,
        api_record_created_at: invoice.created_at,
        api_record_updated_at: invoice.updated_at,
        created_by: userId || null,
        updated_by: userId || null,
      };

      const existingId = existingInvoiceMap.get(invoice.id);
      if (existingId) {
        // Invoice exists - include id for update
        invoiceData.id = existingId;
      }

      invoicesToUpsert.push(invoiceData);

      // Prepare invoice line items if they exist
      if (invoice.invoice_items && Array.isArray(invoice.invoice_items)) {
        for (const lineItem of invoice.invoice_items) {
          const lineItemData: any = {
            organization_id: organizationId,
            integration_id: integrationId,
            platform_invoice_line_item_id: lineItem.id,
            platform_invoice_id: invoice.id, // Will be updated with actual DB ID after invoice upsert
            treatment_id: lineItem.treatment_id,
            practitioner_id: lineItem.practitioner_id,
            sundry_id: lineItem.sundry_id,
            treatment_plan_id: lineItem.treatment_plan_id,
            treatment_plan_item_id: lineItem.treatment_plan_item_id,
            description: lineItem.description,
            quantity: lineItem.quantity,
            gross: parseFloat(lineItem.gross),
            discount: parseFloat(lineItem.discount),
            net: parseFloat(lineItem.net),
            tax: parseFloat(lineItem.tax),
            api_record_created_at: lineItem.created_at,
            api_record_updated_at: lineItem.updated_at,
            created_by: userId || null,
            updated_by: userId || null,
          };

          invoiceLineItemsToUpsert.push(lineItemData);
        }
      }
    }

    // Step 5: Batch upsert invoices
    const INVOICE_CHUNK_SIZE = 50;
    if (invoicesToUpsert.length > 0) {
      console.log(`[Dentally Sync] Upserting ${invoicesToUpsert.length} invoices in chunks of ${INVOICE_CHUNK_SIZE}...`);

      for (let i = 0; i < invoicesToUpsert.length; i += INVOICE_CHUNK_SIZE) {
        const chunk = invoicesToUpsert.slice(i, i + INVOICE_CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing invoice chunk ${Math.floor(i / INVOICE_CHUNK_SIZE) + 1}/${Math.ceil(invoicesToUpsert.length / INVOICE_CHUNK_SIZE)} (${chunk.length} items)...`);

        // Use upsert with onConflict to handle both inserts and updates
        const { data: upsertedInvoices, error: upsertError } = await (supabase as any)
          .from('platform_integration_invoices')
          .upsert(chunk, {
            onConflict: 'organization_id,integration_id,platform_invoice_id',
            ignoreDuplicates: false
          })
          .select('id, platform_invoice_id');

        if (upsertError) {
          console.warn(`[Dentally Sync] Invoice chunk upsert failed:`, upsertError);
          errors.push(`Failed to upsert invoices chunk: ${upsertError.message}`);
          // Try individual upserts as fallback
          for (const invToUpsert of chunk) {
            try {
              const { data: upsertedInvoice, error: singleUpsertError } = await (supabase as any)
                .from('platform_integration_invoices')
                .upsert(invToUpsert, {
                  onConflict: 'organization_id,integration_id,platform_invoice_id',
                  ignoreDuplicates: false
                })
                .select('id, platform_invoice_id')
                .single();

              if (singleUpsertError) {
                errors.push(`Failed to upsert invoice (ID: ${invToUpsert.platform_invoice_id}): ${singleUpsertError.message}`);
              } else {
                invoicesSynced++;
              }
            } catch (error: any) {
              errors.push(`Error upserting invoice (ID: ${invToUpsert.platform_invoice_id}): ${error.message}`);
            }
          }
        } else if (upsertedInvoices) {
          console.log(`[Dentally Sync] Successfully upserted ${upsertedInvoices.length} invoices in chunk`);
          invoicesSynced += upsertedInvoices.length;
        }
      }
    }

    // Step 6: Batch upsert invoice line items
    const LINE_ITEM_CHUNK_SIZE = 100;
    if (invoiceLineItemsToUpsert.length > 0) {
      console.log(`[Dentally Sync] Upserting ${invoiceLineItemsToUpsert.length} invoice line items in chunks of ${LINE_ITEM_CHUNK_SIZE}...`);

      for (let i = 0; i < invoiceLineItemsToUpsert.length; i += LINE_ITEM_CHUNK_SIZE) {
        const chunk = invoiceLineItemsToUpsert.slice(i, i + LINE_ITEM_CHUNK_SIZE);
        console.log(`[Dentally Sync] Processing line item chunk ${Math.floor(i / LINE_ITEM_CHUNK_SIZE) + 1}/${Math.ceil(invoiceLineItemsToUpsert.length / LINE_ITEM_CHUNK_SIZE)} (${chunk.length} items)...`);

        // Use upsert with onConflict to handle both inserts and updates
        const { data: upsertedLineItems, error: upsertError } = await (supabase as any)
          .from('platform_integration_invoice_line_items')
          .upsert(chunk, {
            onConflict: 'organization_id,integration_id,platform_invoice_line_item_id',
            ignoreDuplicates: false
          })
          .select('id');

        if (upsertError) {
          console.warn(`[Dentally Sync] Line item chunk upsert failed:`, upsertError);
          errors.push(`Failed to upsert invoice line items chunk: ${upsertError.message}`);
          // Try individual upserts as fallback
          for (const itemToUpsert of chunk) {
            try {
              const { data: upsertedItem, error: singleUpsertError } = await (supabase as any)
                .from('platform_integration_invoice_line_items')
                .upsert(itemToUpsert, {
                  onConflict: 'organization_id,integration_id,platform_invoice_line_item_id',
                  ignoreDuplicates: false
                })
                .select('id')
                .single();

              if (singleUpsertError) {
                errors.push(`Failed to upsert line item (ID: ${itemToUpsert.platform_invoice_line_item_id}): ${singleUpsertError.message}`);
              } else {
                invoiceLineItemsSynced++;
              }
            } catch (error: any) {
              errors.push(`Error upserting line item (ID: ${itemToUpsert.platform_invoice_line_item_id}): ${error.message}`);
            }
          }
        } else if (upsertedLineItems) {
          console.log(`[Dentally Sync] Successfully upserted ${upsertedLineItems.length} line items in chunk`);
          invoiceLineItemsSynced += upsertedLineItems.length;
        }
      }
    }

    console.log(`[Dentally Sync] Completed invoices sync for organization ${organizationId}`);
    console.log(`[Dentally Sync] Total synced: ${invoicesSynced} invoices, ${invoiceLineItemsSynced} line items`);

    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      invoicesSynced,
      invoiceLineItemsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed invoices sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      invoicesSynced,
      invoiceLineItemsSynced,
      errors,
    };
  }
}

/**
 * Sync NHS claims from Dentally
 * @param apiKey - API key from database
 * @param apiEndpoint - Base API endpoint from database
 * @param organizationId - Organization ID
 * @param userId - User ID (optional, for audit fields)
 */
export async function syncDentallyNhsClaims(
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId?: string | null
): Promise<NhsClaimsSyncResult> {
  const errors: string[] = [];
  let nhsClaimsSynced = 0;

  // Validate organizationId
  if (!organizationId) {
    return {
      success: false,
      nhsClaimsSynced: 0,
      errors: ['Organization ID is required for syncing'],
    };
  }

  console.log(`[Dentally Sync] Starting NHS claims sync for organization: ${organizationId}`);

  try {
    // Step 1: Fetch ALL NHS claims from Dentally (handle pagination)
    console.log(`[Dentally Sync] Fetching NHS claims from Dentally API...`);

    let allNhsClaims: DentallyNhsClaim[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Loop through all pages until no more data
    while (hasMorePages) {
      console.log(`[Dentally Sync] Fetching NHS claims page ${currentPage}...`);

      const nhsClaimsResult = await DentallyService.getNhsClaims(
        apiKey,
        apiEndpoint,
        { page: currentPage.toString() }
      );

      if (!nhsClaimsResult.success || !nhsClaimsResult.data) {
        throw new Error(nhsClaimsResult.error || 'Failed to fetch NHS claims');
      }

      // Handle array response or object with nhs_claims property
      let pageNhsClaims: DentallyNhsClaim[] = [];
      if (Array.isArray(nhsClaimsResult.data)) {
        pageNhsClaims = nhsClaimsResult.data;
      } else if (nhsClaimsResult.data.nhs_claims && Array.isArray(nhsClaimsResult.data.nhs_claims)) {
        pageNhsClaims = nhsClaimsResult.data.nhs_claims;
      } else if (nhsClaimsResult.data.id && nhsClaimsResult.data.claim_status) {
        // Handle single NHS claim object
        pageNhsClaims = [nhsClaimsResult.data];
      } else {
        throw new Error('Invalid NHS claims response format');
      }

      console.log(`[Dentally Sync] Page ${currentPage}: Fetched ${pageNhsClaims.length} NHS claims`);

      // Add this page's claims to the full list
      allNhsClaims = [...allNhsClaims, ...pageNhsClaims];

      // Check if there are more pages (Dentally returns 25 per page by default)
      if (pageNhsClaims.length < 25) {
        hasMorePages = false;
        console.log(`[Dentally Sync] Reached last page (page ${currentPage})`);
      } else {
        currentPage++;
      }
    }

    const nhsClaims = allNhsClaims;
    console.log(`[Dentally Sync] Fetched total of ${nhsClaims.length} NHS claims across ${currentPage} page(s)`);

    // Step 2: Upsert NHS claims into database in batches
    if (nhsClaims.length > 0) {
      console.log(`[Dentally Sync] Upserting ${nhsClaims.length} NHS claims into database...`);

      const BATCH_SIZE = 50;
      for (let i = 0; i < nhsClaims.length; i += BATCH_SIZE) {
        const batch = nhsClaims.slice(i, i + BATCH_SIZE);
        const batchData = batch.map((claim) => ({
          organization_id: organizationId,
          nc_id: claim.id,
          nc_claim_status: claim.claim_status,
          nc_sequence_number: claim.sequence_number,
          nc_approval_date: claim.approval_date,
          nc_submitted_date: claim.submitted_date,
          nc_awarded_uda: claim.awarded_uda != null ? parseFloat(String(claim.awarded_uda)) || 0 : null,
          nc_expected_uda: claim.expected_uda != null ? parseFloat(String(claim.expected_uda)) || 0 : null,
          nc_uda_band: claim.uda_band,
          nc_dentist_charge: claim.dentist_charge != null ? parseFloat(String(claim.dentist_charge)) || 0 : null,
          nc_patient_charge: claim.patient_charge != null ? parseFloat(String(claim.patient_charge)) || 0 : null,
          nc_patient_id: claim.patient_id,
          nc_practitioner_id: claim.practitioner_id,
          nc_treatment_plan_id: claim.treatment_plan_id,
          nc_site_id: claim.site_id,
          nc_contract_id: claim.contract_id,
          nc_ortho: claim.ortho ?? false,
          nc_continuation_part_number: claim.continuation_part_number,
          nc_status_comments: claim.status_comments,
          nc_ni_dentist_fee: claim.ni_calculated_dentist_fee != null ? parseFloat(String(claim.ni_calculated_dentist_fee)) || 0 : null,
          nc_ni_patient_fee: claim.ni_calculated_patient_fee != null ? parseFloat(String(claim.ni_calculated_patient_fee)) || 0 : null,
          nc_scot_amount_authorised: claim.scot_amount_authorised != null ? parseFloat(String(claim.scot_amount_authorised)) || 0 : null,
          nc_scot_amount_expected: claim.scot_amount_expected != null ? parseFloat(String(claim.scot_amount_expected)) || 0 : null,
          nc_created_at: claim.created_at,
          nc_updated_at: claim.updated_at,
          nc_nhs_updated_at: claim.nhs_updated_at,
          user_id: userId,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }));

        try {
          const { error: upsertError } = await (supabase as any)
            .from('nhs_claims')
            .upsert(batchData, {
              onConflict: 'organization_id,nc_id',
            });

          if (upsertError) {
            console.error(`[Dentally Sync] Failed to upsert NHS claims batch ${i / BATCH_SIZE + 1}:`, upsertError);
            errors.push(`Failed to sync NHS claims batch: ${upsertError.message}`);
          } else {
            nhsClaimsSynced += batch.length;
            console.log(`[Dentally Sync] Synced batch ${i / BATCH_SIZE + 1}: ${batch.length} NHS claims`);
          }
        } catch (error: any) {
          console.error(`[Dentally Sync] Error processing NHS claims batch:`, error);
          errors.push(`Error processing NHS claims batch: ${error.message}`);
        }
      }
    } else {
      console.warn(`[Dentally Sync] No NHS claims found from Dentally API`);
    }

    console.log(`[Dentally Sync] Completed NHS claims sync for organization ${organizationId}`);
    console.log(`[Dentally Sync] Total synced: ${nhsClaimsSynced} NHS claims`);

    if (errors.length > 0) {
      console.warn(`[Dentally Sync] Completed with ${errors.length} errors:`, errors);
    }

    return {
      success: errors.length === 0,
      nhsClaimsSynced,
      errors,
    };
  } catch (error: any) {
    console.error(`[Dentally Sync] Failed NHS claims sync for organization ${organizationId}:`, error);
    errors.push(`Sync failed: ${error.message}`);
    return {
      success: false,
      nhsClaimsSynced,
      errors,
    };
  }
}
