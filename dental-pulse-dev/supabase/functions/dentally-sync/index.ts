import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncJobRecord {
  id: string;
  organization_id: string;
  integration_id: string;
  job_type: string;
  entity_alias: string | null;
  status: string;
  progress_percentage: number;
  current_page: number;
  total_pages: number | null;
  records_processed: number;
  records_failed: number;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  start_date: string | null;
  end_date: string | null;
  user_id: string | null;
}

interface IntegrationRecord {
  id: string;
  organization_id: string;
  api_key: string;
  api_endpoints: string;
  is_connected: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const RATE_LIMIT_DELAY_MS = 150; // 150ms delay between invoice detail fetches to avoid rate limiting
const RATE_LIMIT_RETRY_DELAY_MS = 5000; // 5 second delay for rate limit errors
const PAGE_SIZE = 100; // Must match per_page value sent to Dentally API

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }

      // Don't retry on auth errors
      if (response.status === 401 || response.status === 403) {
        return response;
      }

      // Special handling for rate limit errors (429)
      if (response.status === 429) {
        const retryDelay = RATE_LIMIT_RETRY_DELAY_MS * (attempt + 1); // Exponential backoff
        console.log(`Rate limit hit (429). Waiting ${retryDelay}ms before retry ${attempt + 1}/${retries}`);
        lastError = new Error(`HTTP ${response.status}: Rate limit exceeded`);

        if (attempt < retries - 1) {
          await sleep(retryDelay);
          continue;
        }
      } else {
        lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < retries - 1) {
      console.log(`Retry attempt ${attempt + 1}/${retries - 1} after ${RETRY_DELAY_MS}ms`);
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error("Request failed after retries");
}

// deno-lint-ignore no-explicit-any
async function updateSyncJobProgress(
  supabase: SupabaseClient<any>,
  jobId: string,
  updates: {
    status?: string;
    progress_percentage?: number;
    current_page?: number;
    total_pages?: number;
    records_processed?: number;
    records_failed?: number;
    error_message?: string | null;
    started_at?: string;
    completed_at?: string;
    retry_count?: number;
  }
): Promise<void> {
  const { error } = await supabase
    .from("sync_jobs")
    .update(updates)
    .eq("id", jobId);

  if (error) {
    console.error("Failed to update sync job:", error);
  }
}

// deno-lint-ignore no-explicit-any
async function fetchDentallyData(
  apiKey: string,
  apiEndpoint: string,
  entityAlias: string,
  page: number,
  startDate?: string | null,
  endDate?: string | null
): Promise<any> {
  const endpoint = apiEndpoint.replace(/\/$/, ""); // Remove trailing slash

  // Map entity alias to Dentally API endpoint
  const endpointMap: Record<string, string> = {
    appointments: "/v1/appointments",
    practitioners: "/v1/practitioners",
    payment_plans: "/v1/payment_plans",
    treatment_plans: "/v1/treatment_plans",
    treatment_plan_items: "/v1/treatment_plan_items",
    treatment_appointments: "/v1/treatment_appointments",
    treatments: "/v1/treatments",
    treatment_category: "/v1/treatment_categories",
    locations: "/v1/sites",
    patients: "/v1/patients",
    invoices: "/v1/invoices",
    nhs_claims: "/v1/nhs_claims",
  };

  // Normalize entityAlias (trim whitespace)
  const normalizedEntityAlias = entityAlias?.trim();
  const apiPath = endpointMap[normalizedEntityAlias];

  if (!apiPath) {
    console.error(`Unknown entity alias: "${entityAlias}" (normalized: "${normalizedEntityAlias}")`);
    console.error(`Available entity aliases: ${Object.keys(endpointMap).join(", ")}`);
    throw new Error(`Unknown entity alias: ${entityAlias}`);
  }

  // Build query parameters
  const queryParams = new URLSearchParams({
    page: page.toString(),
    per_page: '100'  // Request 100 items per page (max allowed by Dentally API) instead of default 25
  });

  // Add date filters if provided based on entity type and API docs
  // Skip date filters for small reference data (locations, treatment_category, treatments, practitioners)
  // These datasets are small and should always be fully synced
  const skipDateFilter = ["locations", "treatment_category", "treatments", "practitioners", "payment_plans"];

  // Always filter invoices to paid=true, regardless of whether a date range is provided.
  // This ensures the DB only contains paid invoices (used for revenue calculations).
  // Use updated_since to capture old invoices recently paid (paid_on_after is not supported by Dentally API).
  if (entityAlias === "invoices") {
    queryParams.append("paid", "true");
    queryParams.append("sort_by", "updated_at");
    if (startDate) queryParams.append("updated_since", startDate);
  } else if (startDate && !skipDateFilter.includes(entityAlias)) {
    // Entities that should use created_after/created_before for date-range sync
    if (entityAlias === "patients" || entityAlias === "treatment_plans") {
      queryParams.append("created_after", startDate);
      if (endDate) queryParams.append("created_before", endDate);
      // Dentally API requires sort_by when date filters are present
      queryParams.append("sort_by", "created_at");
    }
    // Appointments use updated_since per API docs
    else if (entityAlias === "appointments") {
      queryParams.append("updated_since", startDate);
      queryParams.append("sort_by", "updated_at");
    }
    // Treatment plan items use updated_after and updated_before for filtering
    else if (entityAlias === "treatment_plan_items") {
      queryParams.append("updated_after", startDate);
      if (endDate) queryParams.append("updated_before", endDate);
      queryParams.append("sort_by", "updated_at");
    }
    // Default: use updated_after/updated_before for other entities (including treatment_appointments)
    else {
      queryParams.append("updated_after", startDate);
      if (endDate) queryParams.append("updated_before", endDate);
      // Dentally API requires sort_by when date filters are present
      queryParams.append("sort_by", "updated_at");
    }
  }

  const url = `${endpoint}${apiPath}?${queryParams.toString()}`;
  console.log(`Fetching from Dentally: ${url}`);

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "User-Agent": "DentPulse/1.0",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

// deno-lint-ignore no-explicit-any
async function fetchInvoiceDetail(
  apiKey: string,
  apiEndpoint: string,
  invoiceId: number
): Promise<any> {
  const endpoint = apiEndpoint.replace(/\/$/, "");
  const url = `${endpoint}/v1/invoices/${invoiceId}`;
  console.log(`Fetching invoice detail: ${url}`);

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "User-Agent": "DentPulse/1.0",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

// Fetch patient details from Dentally API
// deno-lint-ignore no-explicit-any
async function fetchPatientDetail(
  apiKey: string,
  apiEndpoint: string,
  patientId: number
): Promise<any> {
  const endpoint = apiEndpoint.replace(/\/$/, "");
  const url = `${endpoint}/v1/patients/${patientId}`;
  console.log(`Fetching patient detail: ${url}`);

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "User-Agent": "DentPulse/1.0",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dentally API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

// Sync missing patients on-demand when processing invoices
// deno-lint-ignore no-explicit-any
async function syncMissingPatients(
  supabase: SupabaseClient<any>,
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  integrationId: string,
  userId: string | null,
  patientIds: number[]
): Promise<{ synced: number; failed: number }> {
  if (patientIds.length === 0) return { synced: 0, failed: 0 };

  console.log(`Checking ${patientIds.length} unique patient IDs...`);

  // Check which patient IDs are missing from the database
  const { data: existingPatients, error: checkError } = await supabase
    .from('patients')
    .select('pt_id')
    .eq('organization_id', organizationId)
    .in('pt_id', patientIds);

  if (checkError) {
    console.error('Error checking existing patients:', checkError);
    return { synced: 0, failed: patientIds.length };
  }

  const existingPatientIds = new Set(existingPatients?.map((p: any) => p.pt_id) || []);
  const missingPatientIds = patientIds.filter(id => !existingPatientIds.has(id));

  if (missingPatientIds.length === 0) {
    console.log('All patients already exist in database');
    return { synced: 0, failed: 0 };
  }

  console.log(`Found ${missingPatientIds.length} missing patients. Fetching from Dentally...`);

  let synced = 0;
  let failed = 0;

  // Fetch and upsert missing patients
  for (const patientId of missingPatientIds) {
    try {
      const patientResponse = await fetchPatientDetail(apiKey, apiEndpoint, patientId);

      // Extract patient data from response
      const patientData = patientResponse.patient || patientResponse;

      // Transform and upsert patient using existing logic
      const { processed } = await upsertEntityData(
        supabase,
        'patients',
        organizationId,
        integrationId,
        userId,
        [patientData]
      );

      if (processed > 0) {
        synced++;
        console.log(`✓ Synced patient ${patientId}`);
      } else {
        failed++;
      }

      // Rate limiting delay
      await sleep(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      console.error(`Failed to sync patient ${patientId}:`, error);
      failed++;
    }
  }

  console.log(`Patient sync complete: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

// deno-lint-ignore no-explicit-any
async function getCategoryMap(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<Map<number, string>> {
  // Fetch all categories with external_id for this organization
  const { data: categories, error } = await supabase
    .from('treatment_categories')
    .select('id, external_id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .not('external_id', 'is', null);

  if (error) {
    console.error('Error fetching category map:', error);
    return new Map();
  }

  // Create map: Dentally category ID (external_id) -> our category UUID (id)
  const categoryMap = new Map<number, string>();
  if (categories) {
    categories.forEach((cat: any) => {
      if (cat.external_id && cat.id) {
        categoryMap.set(cat.external_id, cat.id);
      }
    });
  }

  console.log(`Category map loaded: ${categoryMap.size} categories`);
  return categoryMap;
}

// deno-lint-ignore no-explicit-any
async function getLocationMap(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<Map<string, string>> {
  // Fetch all locations with api_record_unique_id for this organization
  // Dentally site_id (UUID) is stored in api_record_unique_id column
  const { data: locations, error } = await supabase
    .from('practice_locations')
    .select('id, api_record_unique_id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .not('api_record_unique_id', 'is', null);

  if (error) {
    console.error('Error fetching location map:', error);
    return new Map();
  }

  // Create map: Dentally site_id (UUID) -> our location UUID (id)
  const locationMap = new Map<string, string>();
  if (locations) {
    locations.forEach((loc: any) => {
      if (loc.id && loc.api_record_unique_id) {
        locationMap.set(String(loc.api_record_unique_id), loc.id);
      }
    });
  }

  console.log(`Location map loaded: ${locationMap.size} locations`);
  return locationMap;
}

// deno-lint-ignore no-explicit-any
async function mapExistingTreatmentsToCategories(
  supabase: SupabaseClient<any>,
  apiKey: string,
  apiEndpoint: string,
  organizationId: string,
  userId: string | null
): Promise<void> {
  console.log(`[Category Mapping] Starting post-sync treatment-category mapping...`);

  // Step 1: Get category map
  const categoryMap = await getCategoryMap(supabase, organizationId);
  if (categoryMap.size === 0) {
    console.log(`[Category Mapping] No categories found. Skipping mapping.`);
    return;
  }

  // Step 2: Get treatments without category_id that have external_id
  const { data: treatmentsWithoutCategory, error: treatmentsError } = await supabase
    .from('treatments')
    .select('id, external_id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .is('category_id', null)
    .not('external_id', 'is', null);

  if (treatmentsError) {
    console.error(`[Category Mapping] Error fetching treatments:`, treatmentsError);
    return;
  }

  if (!treatmentsWithoutCategory || treatmentsWithoutCategory.length === 0) {
    console.log(`[Category Mapping] No treatments need category mapping.`);
    return;
  }

  console.log(`[Category Mapping] Found ${treatmentsWithoutCategory.length} treatments without category_id`);

  // Step 3: Fetch treatments from Dentally to get their treatment_category_id
  const treatmentExternalIds = treatmentsWithoutCategory.map((t: any) => t.external_id);
  const dentallyTreatmentMap = new Map<number, number>(); // external_id -> treatment_category_id

  // Fetch treatments from Dentally in batches
  let currentPage = 1;
  let hasMorePages = true;
  const BATCH_SIZE = 100;

  while (hasMorePages && dentallyTreatmentMap.size < treatmentExternalIds.length) {
    try {
      const responseData = await fetchDentallyData(apiKey, apiEndpoint, "treatments", currentPage);
      const records = responseData.treatments || responseData || [];

      if (records.length === 0) {
        hasMorePages = false;
        break;
      }

      // Map treatments that we need
      records.forEach((treatment: any) => {
        if (treatment.id && treatmentExternalIds.includes(treatment.id) && treatment.treatment_category_id) {
          dentallyTreatmentMap.set(treatment.id, treatment.treatment_category_id);
        }
      });

      if (records.length < PAGE_SIZE) {
        hasMorePages = false;
      } else {
        currentPage++;
      }
    } catch (error) {
      console.error(`[Category Mapping] Error fetching treatments from Dentally:`, error);
      break;
    }
  }

  console.log(`[Category Mapping] Fetched ${dentallyTreatmentMap.size} treatments with category info from Dentally`);

  // Step 4: Map and update treatments
  let mappedCount = 0;
  const updatePromises: Promise<void>[] = [];

  for (const dbTreatment of treatmentsWithoutCategory) {
    const dentallyCategoryId = dentallyTreatmentMap.get(dbTreatment.external_id);
    if (dentallyCategoryId) {
      const categoryId = categoryMap.get(dentallyCategoryId);
      if (categoryId) {
        updatePromises.push(
          supabase
            .from('treatments')
            .update({
              category_id: categoryId,
              updated_by: userId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbTreatment.id)
            .then(({ error }) => {
              if (error) {
                console.error(`[Category Mapping] Failed to update treatment ${dbTreatment.id}:`, error);
              } else {
                mappedCount++;
              }
            })
        );
      }
    }
  }

  await Promise.all(updatePromises);
  console.log(`[Category Mapping] Mapped ${mappedCount} treatments to categories`);
}

// deno-lint-ignore no-explicit-any
async function upsertEntityData(
  supabase: SupabaseClient<any>,
  entityAlias: string,
  organizationId: string,
  integrationId: string,
  userId: string | null,
  data: any[]
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Map entity alias to table name and data transformation
  const tableMap: Record<string, string> = {
    appointments: "appointments",
    practitioners: "providers",
    payment_plans: "payment_plans",
    treatment_plans: "treatment_plans",
    treatment_plan_items: "treatment_plan_items",
    treatment_appointments: "treatment_appointments",
    treatments: "treatments",
    treatment_category: "treatment_categories",
    locations: "practice_locations",
    patients: "patients",
    invoices: "platform_integration_invoices",
    nhs_claims: "nhs_claims",
  };

  const tableName = tableMap[entityAlias];
  if (!tableName) {
    console.error(`Unknown table for entity: ${entityAlias}`);
    return { processed, failed };
  }

  console.log(`Upserting ${data.length} ${entityAlias} records using BATCH mode...`);

  // Get category map if we're syncing treatments (needed for category_id mapping)
  let categoryMap: Map<number, string> = new Map();
  if (entityAlias === "treatments") {
    console.log(`Loading category map for treatment-category mapping...`);
    categoryMap = await getCategoryMap(supabase, organizationId);
    if (categoryMap.size === 0) {
      console.warn(`No categories found with external_id. Treatments will be synced without category_id.`);
    }
  }

  // Get location map for entities that have site_id in API response
  // Entities that need location mapping: appointments, payment_plans, patients, invoices, treatment_plans, treatment_plan_items, treatment_appointments
  const entitiesNeedingLocationMap = [
    "appointments",
    "payment_plans",
    "patients",
    "invoices",
    "treatment_plans",
    "treatment_plan_items",
    "treatment_appointments"
  ];
  let locationMap: Map<string, string> = new Map();
  if (entitiesNeedingLocationMap.includes(entityAlias)) {
    console.log(`Loading location map for ${entityAlias} location_id mapping...`);
    locationMap = await getLocationMap(supabase, organizationId);
    if (locationMap.size === 0) {
      console.warn(`No locations found with api_record_unique_id. ${entityAlias} will be synced without location_id.`);
    }
  }

  // Helper function to transform a single record
  const transformRecord = (record: any): any => {
    // Helper function to map Dentally site_id to location_id
    const mapSiteIdToLocationId = (siteId: any): string | null => {
      if (!siteId) return null;
      const siteIdStr = String(siteId);
      const locationId = locationMap.get(siteIdStr);
      if (!locationId && locationMap.size > 0) {
        console.warn(`Site ID ${siteIdStr} not found in location map for ${entityAlias}`);
      }
      return locationId || null;
    };

    // Transform data based on entity type
    let transformedData: any = {
      organization_id: organizationId,
      user_id: userId, // Set to the authenticated user who initiated the sync
    };

    // Note: integration_id is not needed for invoices table

    // Entity-specific transformations
    switch (entityAlias) {
      case "appointments":
        // Helper to safely parse BIGINT (handle both number and string, ignore UUID)
        const parseBigIntApmt = (value: any): number | null => {
          if (value === null || value === undefined) return null;
          // If it's a UUID string (contains dashes), return null (can't store UUID in BIGINT)
          if (typeof value === 'string' && value.includes('-')) return null;
          // Try to parse as number
          const num = typeof value === 'number' ? value : parseInt(value, 10);
          return isNaN(num) ? null : num;
        };

        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id || record.practitioner_site_id), // Map site_id to location_id
          apmt_unique_id: record.uuid || null,
          apmt_id: record.id || null,
          apmt_practitioner_id: record.practitioner_id || null,
          apmt_practitioner_name: record.practitioner_name || null,
          apmt_practitioner_site_id: record.practitioner_site_id || null,
          apmt_user_id: record.user_id || null, // Dentally's internal user_id (if available)
          apmt_arrived_at: record.arrived_at || null,
          apmt_cancelled_at: record.cancelled_at || null,
          apmt_completed_at: record.completed_at || null,
          apmt_confirmed_at: record.confirmed_at || null,
          apmt_created_at: record.created_at || null,
          apmt_duration: record.duration || null,
          apmt_finish_time: record.finish_time || null,
          apmt_in_surgery_at: record.in_surgery_at || null,
          apmt_patient_id: record.patient_id || null,
          apmt_patient_image_url: record.patient_image_url || null,
          apmt_patient_name: record.patient_name || null,
          apmt_payment_plan_id: record.payment_plan_id || null,
          apmt_pending_at: record.pending_at || null,
          apmt_reason: record.reason || null,
          apmt_start_time: record.start_time || null,
          apmt_state: record.state || null,
          apmt_treatment_description: record.treatment_description || null,
          apmt_booked_via_api: record.booked_via_api || false,
          apmt_updated_at: record.updated_at || null,
          // Handle cancellation_reason_id: API may return UUID but column is BIGINT, so filter out UUIDs
          apmt_appointment_cancellation_reason_id: parseBigIntApmt(record.appointment_cancellation_reason_id),
          apmt_did_not_attend_at: record.did_not_attend_at || null,
          apmt_notes: record.notes || null,
        };
        break;

      case "payment_plans":
        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          pp_id: record.id,
          pp_name: record.name,
          pp_is_active: record.active,
          pp_dentist_recall_interval: record.dentist_recall_interval,
          pp_emergency_duration: record.emergency_duration,
          pp_exam_appointments_included: record.exam_appointments_included,
          pp_exam_duration: record.exam_duration,
          pp_exam_scale_and_polish_duration: record.exam_scale_and_polish_duration,
          pp_hygiene_appointments_included: record.hygiene_appointments_included,
          pp_hygienist_recall_interval: record.hygienist_recall_interval,
          pp_monthly_memberhsip_fee: parseFloat(record.monthly_membership_fee || record.monthly_memberhsip_fee || "0"),
          pp_patient_friendly_name: record.patient_friendly_name,
          pp_recall_method: record.recall_method,
          pp_scale_and_polish_duration: record.scale_and_polish_duration,
          pp_colour: record.colour,
          pp_site_id: record.site_id,
          pp_created_at: record.created_at,
        };
        break;

      case "treatment_plans":
        // Helper to safely parse BIGINT (handle both number and string, ignore UUID)
        const parseBigIntTP = (value: any): number | null => {
          if (value === null || value === undefined) return null;
          // If it's a UUID string (contains dashes), return null
          if (typeof value === 'string' && value.includes('-')) return null;
          // Try to parse as number
          const num = typeof value === 'number' ? value : parseInt(value, 10);
          return isNaN(num) ? null : num;
        };

        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          tp_id: parseBigIntTP(record.id),
          tp_nickname: record.nickname || null,
          tp_patient_id: parseBigIntTP(record.patient_id),
          tp_practitioner_id: parseBigIntTP(record.practitioner_id),
          tp_private_treatment_value: record.private_treatment_value || null,
          tp_start_date: record.start_date || null,
          tp_completed_at: record.completed_at || null,
          tp_is_completed: record.completed_at ? true : false,
          tp_end_date: record.end_date || null,
          tp_last_completed_at: record.last_completed_at || null,
          tp_created_at: record.created_at || null,
          tp_updated_at: record.updated_at || null,
        };
        break;

      case "practitioners":
        // Build name from user object
        const firstName = record.user?.first_name || '';
        const lastName = record.user?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Provider';

        transformedData = {
          ...transformedData,
          external_id: record.id || null,
          dentally_uuid: record.uuid || null,
          name: fullName,
          email: record.user?.email || null,
          phone: record.user?.mobile_phone || null,
          photo_url: record.user?.image_url || null,
          is_active: record.active !== false,
          // Dentally-specific fields
          gdc_number: record.gdc_number || null,
          nhs_number: record.nhs_number || null,
          uda_target: record.uda_target || null,
          uoa_target: record.uoa_target || null,
          provider_role: record.user?.role || null,
          joining_date: record.user?.created_at || record.created_at || null,
          // Default analytics fields
          revenue: 0,
          patients: 0,
          avg_rev_per_patient: 0,
          utilisation: 0,
          trend: 0,
        };
        break;

      case "locations":
        transformedData = {
          ...transformedData,
          api_record_unique_id: record.id || null,  // UUID from Dentally sites API
          location_name: record.name || record.nickname || 'Practice Location',
          location_code: record.nickname || null,
          address_line1: record.address_line_1 || null,
          address_line2: record.address_line_2 || null,
          city: record.town || null,
          state: record.county || null,
          postal_code: record.postcode || null,
          phone: record.phone_number || null,
          email: record.email_address || null,
          is_active: record.active !== false,
          is_primary: false,
          // Additional fields from API (optional but good to have)
          notes: record.website ? `Website: ${record.website}` : null,
        };
        break;

      case "treatments":
        // Map category_id from Dentally treatment_category_id using categoryMap
        let categoryId: string | null = null;
        if (record.treatment_category_id && categoryMap.size > 0) {
          const mappedCategoryId = categoryMap.get(record.treatment_category_id);
          if (mappedCategoryId) {
            categoryId = mappedCategoryId;
          } else {
            console.warn(`Treatment ${record.id} has treatment_category_id ${record.treatment_category_id} but category not found in database`);
          }
        }

        // Map Dentally uda_band to nhs_band format expected by CHECK constraint
        // CHECK: nhs_band IN ('Band 1', 'Band 2', 'Band 3') or NULL
        // Dentally returns raw values like "1", "2", "3", "1.2", etc.
        const mapUdaBandToNhsBand = (udaBand: any): string | null => {
          if (!udaBand) return null;
          const bandStr = String(udaBand).trim();
          // Direct match
          if (bandStr === 'Band 1' || bandStr === 'Band 2' || bandStr === 'Band 3') return bandStr;
          // Map numeric values: "1" -> "Band 1", "2" -> "Band 2", "3" -> "Band 3"
          if (bandStr === '1' || bandStr === '1.0') return 'Band 1';
          if (bandStr === '2' || bandStr === '2.0') return 'Band 2';
          if (bandStr === '3' || bandStr === '3.0') return 'Band 3';
          // Partial matches like "1.2" -> map to nearest band
          const num = parseFloat(bandStr);
          if (!isNaN(num)) {
            if (num >= 0 && num < 1.5) return 'Band 1';
            if (num >= 1.5 && num < 2.5) return 'Band 2';
            if (num >= 2.5) return 'Band 3';
          }
          // Unrecognized value - store as null to avoid CHECK constraint violation
          // Raw value is still preserved in uda_band column
          console.warn(`Unrecognized uda_band value "${bandStr}" for treatment ${record.id}, setting nhs_band to null`);
          return null;
        };

        transformedData = {
          ...transformedData,
          external_id: record.id || null,
          category_id: categoryId, // Map Dentally treatment_category_id to our category UUID
          treatment_name: record.nomenclature || record.description || record.patient_nomenclature || 'Treatment',
          treatment_code: record.code || null,
          description: record.description || record.patient_description || null,
          treatment_type: record.nhs_treatment_cat ? 'nhs' : 'private',
          price: 0, // Default price, will need to be set manually or from another endpoint
          nhs_band: mapUdaBandToNhsBand(record.uda_band),
          is_active: record.active !== false,
          // Dentally-specific fields
          insurance_classification: record.insurance_classification || null,
          nhs_treatment_cat: record.nhs_treatment_cat || null,
          nomenclature: record.nomenclature || null,
          owner: record.owner || null,
          patient_description: record.patient_description || null,
          patient_nomenclature: record.patient_nomenclature || null,
          region: record.region || null,
          uda_band: record.uda_band || null, // Preserve raw Dentally value
          duration_minutes: record.duration ? parseInt(record.duration.toString(), 10) : null,
        };
        break;

      case "treatment_category":
        transformedData = {
          ...transformedData,
          external_id: record.id || null,
          name: record.name || 'Unknown Category',
          description: record.description || null,
          display_order: record.display_order || 0,
        };
        break;

      case "patients":
        // Helper to safely parse BIGINT (handle both number and string, ignore UUID)
        const parseBigInt = (value: any): number | null => {
          if (value === null || value === undefined) return null;
          // If it's a UUID string (contains dashes), return null
          if (typeof value === 'string' && value.includes('-')) return null;
          // Try to parse as number
          const num = typeof value === 'number' ? value : parseInt(value, 10);
          return isNaN(num) ? null : num;
        };

        // Safely parse UUID - return null if value is not a valid UUID
        const parseUuid = (value: any): string | null => {
          if (value === null || value === undefined) return null;
          const str = String(value).trim();
          // Basic UUID format check (8-4-4-4-12 hex chars)
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(str)) return str;
          console.warn(`Invalid UUID value "${str}" for patient ${record.id}, setting to null`);
          return null;
        };

        // Safely parse date - return null if value is not a valid date
        const parseDate = (value: any): string | null => {
          if (value === null || value === undefined || value === '') return null;
          const str = String(value).trim();
          // Check for common date formats (YYYY-MM-DD or ISO 8601)
          const d = new Date(str);
          if (isNaN(d.getTime())) {
            console.warn(`Invalid date value "${str}" for patient ${record.id}, setting to null`);
            return null;
          }
          return str;
        };

        // Safely truncate string to max length to avoid varchar overflow (error 22001)
        const truncate = (value: any, maxLen: number): string | null => {
          if (value === null || value === undefined) return null;
          const str = String(value);
          if (str.length > maxLen) {
            console.warn(`Truncating value for patient ${record.id}: "${str}" (${str.length} chars) to ${maxLen} chars`);
            return str.substring(0, maxLen);
          }
          return str;
        };

        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          pt_unique_id: parseUuid(record.uuid),
          pt_id: parseBigInt(record.id),
          pt_account_id: record.account_id ? String(record.account_id) : null,
          is_active: record.active !== false,
          pt_title: truncate(record.title, 50),
          pt_first_name: truncate(record.first_name, 255),
          pt_middle_name: truncate(record.middle_name, 255),
          pt_last_name: truncate(record.last_name, 255),
          pt_site_id: parseUuid(record.site_id),
          pt_address_line_1: truncate(record.address_line_1, 255),
          pt_address_line_2: truncate(record.address_line_2, 255),
          pt_address_line_3: truncate(record.address_line_3, 255),
          pt_county: truncate(record.county, 255),
          pt_dob: parseDate(record.date_of_birth),
          pt_dentist_id: parseBigInt(record.dentist_id),
          pt_dentist_recall_date: parseDate(record.dentist_recall_date),
          pt_dentist_recall_interval: record.dentist_recall_interval || null,
          pt_doctor_id: parseBigInt(record.doctor_id),
          pt_email: truncate(record.email, 255),
          pt_family_id: parseBigInt(record.family_id),
          pt_gender: truncate(record.gender, 50),
          pt_image_url: record.image_url || null,
          pt_is_student: record.is_student || false,
          pt_mobile_phone: truncate(record.mobile_phone, 50),
          pt_payment_plan_id: parseBigInt(record.payment_plan_id),
          pt_payment_plan_subscription_id: record.payment_plan_subscription_id ? String(record.payment_plan_subscription_id) : null,
          pt_payment_plan_subscription_status: truncate(record.payment_plan_subscription_status, 100),
          pt_postcode: truncate(record.postcode, 20),
          pt_region: truncate(record.region, 255),
          pt_town: truncate(record.town, 255),
          pt_created_at: record.created_at || null,
          pt_updated_at: record.updated_at || null,
        };
        break;

      case "treatment_plan_items":
        // Helper to safely parse BIGINT (handle both number and string, ignore UUID)
        const parseBigIntTPI = (value: any): number | null => {
          if (value === null || value === undefined) return null;
          // If it's a UUID string (contains dashes), return null
          if (typeof value === 'string' && value.includes('-')) return null;
          // Try to parse as number
          const num = typeof value === 'number' ? value : parseInt(value, 10);
          return isNaN(num) ? null : num;
        };

        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          tpi_id: parseBigIntTPI(record.id),
          tpi_charged: record.charged || false,
          tpi_completed_at: record.completed_at || null,
          tpi_completed: record.completed || false,
          tpi_invoice_id: parseBigIntTPI(record.invoice_id),
          tpi_patient_id: parseBigIntTPI(record.patient_id),
          tpi_patient_nomenclature: record.patient_nomenclature || null,
          tpi_payment_plan_id: parseBigIntTPI(record.payment_plan_id),
          tpi_practitioner_id: parseBigIntTPI(record.practitioner_id),
          tpi_price: record.price ? parseFloat(record.price.toString()) : null,
          tpi_treatment_appointment_id: parseBigIntTPI(record.treatment_appointment_id),
          tpi_treatment_plan_id: parseBigIntTPI(record.treatment_plan_id),
          tpi_treatment_id: parseBigIntTPI(record.treatment_id), // Dentally treatment_id (matches treatments.external_id)
          tpi_updated_at: record.updated_at || null,
          duration: record.duration ? parseInt(record.duration.toString(), 10) : null,
          tpi_created_at: record.created_at || null,
        };
        break;

      case "treatment_appointments":
        // Helper to safely parse BIGINT (handle both number and string, ignore UUID)
        const parseBigIntTA = (value: any): number | null => {
          if (value === null || value === undefined) return null;
          // If it's a UUID string (contains dashes), return null
          if (typeof value === 'string' && value.includes('-')) return null;
          // Try to parse as number
          const num = typeof value === 'number' ? value : parseInt(value, 10);
          return isNaN(num) ? null : num;
        };

        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          ta_id: parseBigIntTA(record.id),
          ta_appointment_id: parseBigIntTA(record.appointment_id),
          ta_bookable: record.bookable || false,
          ta_patient_id: parseBigIntTA(record.patient_id),
          ta_treatment_plan_id: parseBigIntTA(record.treatment_plan_id),
          ta_created_at: record.created_at || null,
          ta_updated_at: record.updated_at || null,
        };
        break;

      case "invoices":
        transformedData = {
          ...transformedData,
          // Platform identification
          platform_type: 'dentally',
          platform_invoice_id: String(record.id),
          invoice_number: String(record.id), // Use Dentally ID as invoice number

          // Invoice details
          reference: record.reference || null,

          // Dates
          invoice_date: record.dated_on || null,
          due_date: record.due_on || null,
          paid_date: record.paid_on || null,
          sent_at: record.sent_at || null,

          // Status
          status: record.paid ? 'paid' : (record.sent_at ? 'sent' : 'draft'),
          is_paid: record.paid || false,

          // Financial amounts
          currency: 'GBP',
          subtotal: record.amount ? parseFloat(record.amount) : null,
          amount_outstanding: record.amount_outstanding ? parseFloat(record.amount_outstanding) : null,
          nhs_amount: record.nhs_amount ? parseFloat(record.nhs_amount) : null,

          // Relationships
          location_id: mapSiteIdToLocationId(record.site_id), // Map site_id to location_id
          patient_id: record.patient_id || null,
          account_id: record.account_id || null,
          site_id: record.site_id || null, // Keep original site_id for reference

          // Additional fields
          payment_terms: record.payment_terms || null,
          footnote: record.footnote || null,

          // Preserve invoice_items from detailed invoice response (will be processed separately)
          _invoice_items: record.invoice_items || [],
        };
        break;

      case "nhs_claims": {
        const safeParseFloat = (val: any): number | null => {
          if (val === null || val === undefined) return null;
          const parsed = parseFloat(String(val));
          return isNaN(parsed) ? null : parsed;
        };
        transformedData = {
          ...transformedData,
          location_id: mapSiteIdToLocationId(record.site_id),
          nc_id: record.id || null,
          nc_claim_status: record.claim_status || null,
          nc_sequence_number: record.sequence_number || null,
          nc_approval_date: record.approval_date || null,
          nc_submitted_date: record.submitted_date || null,
          nc_awarded_uda: safeParseFloat(record.awarded_uda),
          nc_expected_uda: safeParseFloat(record.expected_uda),
          nc_uda_band: record.uda_band || null,
          nc_dentist_charge: safeParseFloat(record.dentist_charge),
          nc_patient_charge: safeParseFloat(record.patient_charge),
          nc_patient_id: record.patient_id || null,
          nc_practitioner_id: record.practitioner_id || null,
          nc_treatment_plan_id: record.treatment_plan_id || null,
          nc_site_id: record.site_id || null,
          nc_contract_id: record.contract_id || null,
          nc_ortho: record.ortho ?? false,
          nc_continuation_part_number: record.continuation_part_number || null,
          nc_status_comments: record.status_comments || null,
          nc_ni_dentist_fee: safeParseFloat(record.ni_calculated_dentist_fee),
          nc_ni_patient_fee: safeParseFloat(record.ni_calculated_patient_fee),
          nc_scot_amount_authorised: safeParseFloat(record.scot_amount_authorised),
          nc_scot_amount_expected: safeParseFloat(record.scot_amount_expected),
          nc_created_at: record.created_at || null,
          nc_updated_at: record.updated_at || null,
          nc_nhs_updated_at: record.nhs_updated_at || null,
        };
        break;
      }

      // Add more entity transformations as needed
      default:
        console.warn(`No transformation defined for entity: ${entityAlias}`);
        return null;
    }

    return transformedData;
  };

  // Determine onConflict clause once for this entity
  let onConflict = "id"; // default
  if (entityAlias === "appointments") {
    onConflict = "organization_id,apmt_unique_id";
  } else if (entityAlias === "payment_plans") {
    onConflict = "organization_id,pp_id";
  } else if (entityAlias === "treatment_plans") {
    onConflict = "organization_id,tp_id";
  } else if (entityAlias === "treatment_plan_items") {
    onConflict = "organization_id,tpi_id";
  } else if (entityAlias === "treatment_appointments") {
    onConflict = "organization_id,ta_id";
  } else if (entityAlias === "practitioners") {
    onConflict = "organization_id,external_id";
  } else if (entityAlias === "locations") {
    onConflict = "organization_id,api_record_unique_id";
  } else if (entityAlias === "treatments") {
    onConflict = "organization_id,external_id";
  } else if (entityAlias === "treatment_category") {
    onConflict = "organization_id,external_id";
  } else if (entityAlias === "patients") {
    onConflict = "organization_id,pt_unique_id";
  } else if (entityAlias === "invoices") {
    // DB unique constraint: (organization_id, platform_type, platform_invoice_id) — 3 columns
    onConflict = "organization_id,platform_type,platform_invoice_id";
  } else if (entityAlias === "nhs_claims") {
    onConflict = "organization_id,nc_id";
  }

  // Transform all records first
  const transformedRecords: any[] = [];
  for (const record of data) {
    try {
      const transformed = transformRecord(record);
      if (transformed) {
        transformedRecords.push(transformed);
      }
    } catch (error) {
      console.error(`Error transforming ${entityAlias} record:`, error);
      console.error(`Original record was:`, JSON.stringify(record, null, 2));
      failed++;
    }
  }

  if (transformedRecords.length === 0) {
    console.log(`No valid records to upsert for ${entityAlias}`);
    return { processed, failed };
  }

  // Special handling for locations: check for duplicates across ALL organizations by user_id + api_record_unique_id
  // This prevents creating duplicate locations when each Dentally site = separate organization
  if (entityAlias === "locations" && userId) {
    const siteIds = transformedRecords
      .map((r: any) => r._dentally_site_id || r.api_record_unique_id)
      .filter(Boolean);

    if (siteIds.length > 0) {
      // Check which locations already exist for this user (across ALL organizations)
      const { data: existingLocations, error: checkError } = await supabase
        .from('practice_locations')
        .select('api_record_unique_id')
        .eq('user_id', userId)
        .in('api_record_unique_id', siteIds)
        .is('deleted_at', null);

      if (!checkError && existingLocations && existingLocations.length > 0) {
        const existingSiteIds = new Set(existingLocations.map((loc: any) => loc.api_record_unique_id));
        const originalCount = transformedRecords.length;

        // Filter out locations that already exist
        const filteredRecords = transformedRecords.filter((record: any) => {
          const siteId = record._dentally_site_id || record.api_record_unique_id;
          return !existingSiteIds.has(siteId);
        });

        const skippedCount = originalCount - filteredRecords.length;
        if (skippedCount > 0) {
          console.log(`[Locations] Skipping ${skippedCount} locations that already exist for user (cross-org duplicate check)`);
          processed += skippedCount; // Count as processed since they already exist
        }

        // Update transformedRecords to only include new locations
        transformedRecords.length = 0;
        transformedRecords.push(...filteredRecords);
      }
    }

    // Clean up the temporary _dentally_site_id field
    transformedRecords.forEach((record: any) => {
      delete record._dentally_site_id;
    });

    if (transformedRecords.length === 0) {
      console.log(`[Locations] All locations already exist for user. Skipping upsert.`);
      return { processed, failed };
    }
  }

  console.log(`Transformed ${transformedRecords.length} records, attempting batch upsert...`);

  // For appointments, split records by whether they have apmt_unique_id
  let appointmentsWithUuid: any[] = [];
  let appointmentsWithoutUuid: any[] = [];
  if (entityAlias === "appointments") {
    appointmentsWithUuid = transformedRecords.filter((r: any) => r.apmt_unique_id !== null && r.apmt_unique_id !== undefined);
    appointmentsWithoutUuid = transformedRecords.filter((r: any) => r.apmt_unique_id === null || r.apmt_unique_id === undefined);
    console.log(`Appointments: ${appointmentsWithUuid.length} with UUID, ${appointmentsWithoutUuid.length} without UUID`);
  }

  // For invoices, save invoice_items separately and clean up before upsert
  let savedInvoiceItems: any[] = [];
  if (entityAlias === "invoices") {
    savedInvoiceItems = transformedRecords.map(record => ({
      platform_invoice_id: record.platform_invoice_id,
      items: record._invoice_items || []
    }));

    // Remove _invoice_items from all records before upsert
    transformedRecords.forEach(record => {
      delete record._invoice_items;
    });
  }

  // Special handling for appointments: process those with UUID and without UUID separately
  if (entityAlias === "appointments" && appointmentsWithoutUuid.length > 0) {
    // Process appointments with UUID first (using standard conflict resolution)
    if (appointmentsWithUuid.length > 0) {
      try {
        // Remove count: 'exact' as it can cause issues with upserts
        const { error } = await supabase
          .from(tableName)
          .upsert(appointmentsWithUuid, { onConflict });

        if (error) {
          console.error(`Batch upsert failed for appointments with UUID:`, error);
          console.error(`Batch error details:`, JSON.stringify(error, null, 2));
          // Fallback to individual upserts
          for (const record of appointmentsWithUuid) {
            try {
              const { error: individualError } = await supabase
                .from(tableName)
                .upsert(record, { onConflict });

              if (individualError) {
                console.error(`Failed to upsert appointment with UUID (apmt_unique_id: ${record.apmt_unique_id}):`, individualError);
                console.error(`Upsert error details:`, JSON.stringify(individualError, null, 2));
                console.error(`Failed record:`, JSON.stringify(record, null, 2));

                // Try to find existing record and update explicitly
                try {
                  const { data: existing, error: findError } = await supabase
                    .from(tableName)
                    .select("id")
                    .eq("organization_id", record.organization_id)
                    .eq("apmt_unique_id", record.apmt_unique_id)
                    .maybeSingle();

                  if (!findError && existing) {
                    console.log(`Found existing appointment with UUID ${record.apmt_unique_id}, attempting explicit update...`);
                    const { error: updateError } = await supabase
                      .from(tableName)
                      .update(record)
                      .eq("id", existing.id);

                    if (!updateError) {
                      console.log(`✓ Successfully updated existing appointment via explicit update`);
                      processed++;
                      continue;
                    } else {
                      console.error(`Explicit update also failed:`, updateError);
                    }
                  }
                } catch (updateErr) {
                  console.error(`Error attempting explicit update:`, updateErr);
                }

                failed++;
              } else {
                processed++;
              }
            } catch (err) {
              console.error(`Exception upserting appointment with UUID (apmt_unique_id: ${record?.apmt_unique_id || 'unknown'}):`, err);
              console.error(`Exception details:`, err instanceof Error ? err.stack : String(err));
              console.error(`Failed record:`, JSON.stringify(record, null, 2));
              failed++;
            }
          }
        } else {
          processed += appointmentsWithUuid.length;
          console.log(`✓ Upserted ${appointmentsWithUuid.length} appointments with UUID`);
        }
      } catch (error) {
        console.error(`Critical error upserting appointments with UUID:`, error);
        failed += appointmentsWithUuid.length;
      }
    }

    // Process appointments without UUID: check if record exists by organization_id + apmt_id, then update or insert
    for (const record of appointmentsWithoutUuid) {
      try {
        // Validate required fields
        if (!record.organization_id) {
          console.error(`Appointment missing organization_id. Cannot process.`);
          console.error(`Record:`, JSON.stringify(record, null, 2));
          failed++;
          continue;
        }

        // Validate that we have at least apmt_id to identify the record
        if (!record.apmt_id && record.apmt_id !== 0) {
          console.error(`Appointment without UUID also missing apmt_id. Cannot process.`);
          console.error(`Record:`, JSON.stringify(record, null, 2));
          failed++;
          continue;
        }

        // Check if appointment with same organization_id and apmt_id exists
        // Use .maybeSingle() instead of .single() to handle cases where no record exists
        const { data: existing, error: checkError } = await supabase
          .from(tableName)
          .select("id")
          .eq("organization_id", record.organization_id)
          .eq("apmt_id", record.apmt_id)
          .is("apmt_unique_id", null)
          .limit(1)
          .maybeSingle();

        if (checkError) {
          console.error(`Error checking existing appointment (apmt_id: ${record.apmt_id}):`, checkError);
          console.error(`Error details:`, JSON.stringify(checkError, null, 2));
          console.error(`Record being processed:`, JSON.stringify(record, null, 2));
          failed++;
          continue;
        }

        if (existing) {
          // Update existing record
          const { error: updateError } = await supabase
            .from(tableName)
            .update(record)
            .eq("id", existing.id);

          if (updateError) {
            console.error(`Failed to update appointment without UUID (apmt_id: ${record.apmt_id}, existing_id: ${existing.id}):`, updateError);
            console.error(`Update error details:`, JSON.stringify(updateError, null, 2));
            console.error(`Record being updated:`, JSON.stringify(record, null, 2));
            failed++;
          } else {
            processed++;
            console.log(`✓ Updated appointment without UUID (apmt_id: ${record.apmt_id})`);
          }
        } else {
          // Insert new record
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(record);

          if (insertError) {
            console.error(`Failed to insert appointment without UUID (apmt_id: ${record.apmt_id}):`, insertError);
            console.error(`Insert error details:`, JSON.stringify(insertError, null, 2));
            console.error(`Record being inserted:`, JSON.stringify(record, null, 2));

            // Check for specific constraint violations
            if (insertError.code === '23505') { // Unique constraint violation
              console.error(`Unique constraint violation detected. Attempting to find and update existing record...`);
              // Try to find by organization_id and apmt_id without the null check
              const { data: existingByApmtId, error: findError } = await supabase
                .from(tableName)
                .select("id, apmt_unique_id")
                .eq("organization_id", record.organization_id)
                .eq("apmt_id", record.apmt_id)
                .limit(1)
                .maybeSingle();

              if (!findError && existingByApmtId) {
                console.error(`Found existing appointment with apmt_id ${record.apmt_id} but different apmt_unique_id: ${existingByApmtId.apmt_unique_id}`);
              }
            }

            failed++;
          } else {
            processed++;
            console.log(`✓ Inserted appointment without UUID (apmt_id: ${record.apmt_id})`);
          }
        }
      } catch (err) {
        console.error(`Exception processing appointment without UUID (apmt_id: ${record?.apmt_id || 'unknown'}):`, err);
        console.error(`Exception details:`, err instanceof Error ? err.stack : String(err));
        console.error(`Record:`, JSON.stringify(record, null, 2));
        failed++;
      }
    }
  } else {
    // Standard batch upsert for all other entities (or appointments with UUID only)
    const recordsToUpsert = entityAlias === "appointments" ? appointmentsWithUuid : transformedRecords;

    if (recordsToUpsert.length === 0) {
      console.log(`No records to upsert for ${entityAlias}`);
      return { processed, failed };
    }

    try {
      // Remove count: 'exact' as it can cause issues with upserts - use standard upsert
      const { error } = await supabase
        .from(tableName)
        .upsert(recordsToUpsert, { onConflict });

      if (error) {
        console.error(`Batch upsert failed for ${entityAlias}:`, error);
        console.error(`Batch error details:`, JSON.stringify(error, null, 2));
        console.log(`Falling back to individual upserts to identify failing records...`);

        // Fallback: upsert individually to identify which records fail
        for (let i = 0; i < recordsToUpsert.length; i++) {
          try {
            const { error: individualError } = await supabase
              .from(tableName)
              .upsert(recordsToUpsert[i], { onConflict });

            if (individualError) {
              console.error(`Failed to upsert ${entityAlias} record ${i + 1}/${recordsToUpsert.length}:`, individualError);
              console.error(`Upsert error details:`, JSON.stringify(individualError, null, 2));
              console.error(`Transformed data was:`, JSON.stringify(recordsToUpsert[i], null, 2));

              // For appointments, try to find existing record and update explicitly
              if (entityAlias === "appointments" && recordsToUpsert[i].apmt_unique_id) {
                try {
                  const { data: existing, error: findError } = await supabase
                    .from(tableName)
                    .select("id")
                    .eq("organization_id", recordsToUpsert[i].organization_id)
                    .eq("apmt_unique_id", recordsToUpsert[i].apmt_unique_id)
                    .maybeSingle();

                  if (!findError && existing) {
                    console.log(`Found existing appointment, attempting explicit update...`);
                    const { error: updateError } = await supabase
                      .from(tableName)
                      .update(recordsToUpsert[i])
                      .eq("id", existing.id);

                    if (!updateError) {
                      console.log(`✓ Successfully updated existing appointment via explicit update`);
                      processed++;
                      continue;
                    } else {
                      console.error(`Explicit update also failed:`, updateError);
                    }
                  }
                } catch (updateErr) {
                  console.error(`Error attempting explicit update:`, updateErr);
                }
              }

              failed++;
            } else {
              processed++;
            }
          } catch (err) {
            console.error(`Error upserting ${entityAlias} record ${i + 1}:`, err);
            console.error(`Exception details:`, err instanceof Error ? err.stack : String(err));
            console.error(`Failed record:`, JSON.stringify(recordsToUpsert[i], null, 2));
            failed++;
          }
        }
      } else {
        // Batch upsert succeeded! Count all synced records (inserts + updates)
        processed = recordsToUpsert.length;
        console.log(`✓ Batch upsert successful: ${processed} ${entityAlias} records (inserts + updates)`);
      }
    } catch (error) {
      console.error(`Critical error during batch upsert for ${entityAlias}:`, error);
      // Fallback to individual upserts
      for (let i = 0; i < recordsToUpsert.length; i++) {
        try {
          const { error: individualError } = await supabase
            .from(tableName)
            .upsert(recordsToUpsert[i], { onConflict });

          if (!individualError) {
            processed++;
          } else {
            console.error(`Failed record ${i + 1}:`, individualError);
            failed++;
          }
        } catch (err) {
          console.error(`Error upserting record ${i + 1}:`, err);
          failed++;
        }
      }
    }
  }

  // For invoices, freeze the processed count BEFORE upserting line items
  // Line items should NOT be counted in records_processed
  const invoiceProcessedCount = processed;

  // Special handling for invoices: also upsert invoice_items
  // IMPORTANT: Each invoice item is processed individually - NO merging logic exists
  // Each item from the API response creates a separate line item record
  if (entityAlias === "invoices" && savedInvoiceItems.length > 0) {
    console.log(`Processing invoice line items for ${savedInvoiceItems.length} invoices...`);

    // CRITICAL: Fetch invoice UUIDs from database after upsert
    // invoice_id in line items must reference the UUID from platform_integration_invoices table
    const platformInvoiceIds = savedInvoiceItems.map(inv => inv.platform_invoice_id);
    const { data: invoiceRecords, error: invoiceFetchError } = await supabase
      .from("platform_integration_invoices")
      .select("id, platform_invoice_id")
      .eq("organization_id", organizationId)
      .eq("platform_type", "dentally")
      .in("platform_invoice_id", platformInvoiceIds);

    if (invoiceFetchError) {
      console.error(`Failed to fetch invoice UUIDs for line items:`, invoiceFetchError);
      console.error(`Cannot proceed with line items - invoices may not have been saved correctly`);
    } else if (!invoiceRecords || invoiceRecords.length === 0) {
      console.error(`No invoice records found in database for platform_invoice_ids: ${platformInvoiceIds.join(", ")}`);
      console.error(`Cannot proceed with line items - invoices may not have been saved correctly`);
    } else {
      // Create a map: platform_invoice_id -> database UUID
      const invoiceIdMap = new Map<string, string>();
      invoiceRecords.forEach((inv: any) => {
        invoiceIdMap.set(inv.platform_invoice_id, inv.id);
      });
      console.log(`Fetched ${invoiceIdMap.size} invoice UUIDs for line item mapping`);

      // Fetch treatments to get category names for treatment_category mapping
      // Create map: treatment external_id -> category name
      const treatmentCategoryMap = new Map<number, string>();
      const { data: treatments, error: treatmentsError } = await supabase
        .from("treatments")
        .select(`
          external_id,
          treatment_categories!inner(
            name
          )
        `)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .not("external_id", "is", null);

      if (treatmentsError) {
        console.warn(`Failed to fetch treatments for category mapping:`, treatmentsError);
        console.warn(`Invoice line items will be saved without treatment_category`);
      } else if (treatments && treatments.length > 0) {
        treatments.forEach((t: any) => {
          if (t.external_id && t.treatment_categories && t.treatment_categories.name) {
            treatmentCategoryMap.set(Number(t.external_id), t.treatment_categories.name);
          }
        });
        console.log(`Loaded ${treatmentCategoryMap.size} treatment categories for mapping`);
      }

      const allLineItems: any[] = [];
      let totalApiItems = 0; // Track total items from API for verification

      // Process each invoice and its items individually - NO merging/grouping
      for (const savedInvoice of savedInvoiceItems) {
        // Get the database UUID for this invoice
        const invoiceUuid = invoiceIdMap.get(savedInvoice.platform_invoice_id);
        if (!invoiceUuid) {
          console.error(`[SKIP] No database UUID found for invoice ${savedInvoice.platform_invoice_id}. Skipping line items for this invoice.`);
          continue;
        }
        const invoiceItems = savedInvoice.items || [];
        totalApiItems += invoiceItems.length; // Track total from API
        console.log(`Processing ${invoiceItems.length} line items for invoice ${savedInvoice.platform_invoice_id}`);

        // Track items with null IDs and duplicate IDs to generate unique identifiers
        let nullIdCount = 0;
        let duplicateIdCount = 0;
        const seenIds = new Map<string, number>(); // Track ID -> count to detect duplicates

        // First pass: identify duplicates
        for (const item of invoiceItems) {
          if (item.id) {
            const idStr = String(item.id);
            seenIds.set(idStr, (seenIds.get(idStr) || 0) + 1);
          }
        }

        // Process each item individually - each creates a separate database record
        for (let itemIndex = 0; itemIndex < invoiceItems.length; itemIndex++) {
          const item = invoiceItems[itemIndex];

          // CRITICAL FIX: Generate unique platform_line_id for items without an ID or with duplicate IDs
          // PostgreSQL treats all NULLs as equal in unique constraints, causing items with null IDs
          // in the same invoice to overwrite each other. Duplicate IDs also cause overwrites.
          let platformLineId: string;
          if (item.id) {
            const idStr = String(item.id);
            // Check if this ID appears multiple times in the same invoice
            if (seenIds.get(idStr)! > 1) {
              // Duplicate ID detected - append index to make it unique
              duplicateIdCount++;
              platformLineId = `${idStr}-${itemIndex}`;
              console.log(`[WARNING] Duplicate ID ${idStr} detected at index ${itemIndex} in invoice ${savedInvoice.platform_invoice_id}. Generated unique ID: ${platformLineId}`);
            } else {
              platformLineId = idStr;
            }
          } else {
            // Generate unique ID: invoice_id-index to ensure uniqueness within invoice
            // This prevents items with null IDs from overwriting each other
            nullIdCount++;
            platformLineId = `${savedInvoice.platform_invoice_id}-${itemIndex}`;
            console.log(`[WARNING] Item at index ${itemIndex} in invoice ${savedInvoice.platform_invoice_id} has no ID. Generated unique ID: ${platformLineId}`);
          }

          // Get treatment category from treatment_id if available
          let treatmentCategory: string | null = null;
          let treatmentIdNum: number | null = null;
          if (item.treatment_id) {
            treatmentIdNum = typeof item.treatment_id === 'number'
              ? item.treatment_id
              : parseInt(String(item.treatment_id), 10);
            if (!isNaN(treatmentIdNum)) {
              treatmentCategory = treatmentCategoryMap.get(treatmentIdNum) || null;
            } else {
              treatmentIdNum = null;
            }
          }

          const lineItemData: any = {
            organization_id: organizationId,
            platform_line_id: platformLineId, // Now always has a value - prevents NULL conflicts
            invoice_id: invoiceUuid, // Use database UUID, not platform_invoice_id string
            treatment_id: treatmentIdNum, // Store as BIGINT (number)
            treatment_category: treatmentCategory, // Map category from treatment lookup
            practitioner_id: item.practitioner_id ? String(item.practitioner_id) : null,
            sundry_id: item.sundry_id ? String(item.sundry_id) : null,
            treatment_plan_id: item.treatment_plan_id ? String(item.treatment_plan_id) : null,
            treatment_plan_item_id: item.treatment_plan_item_id ? String(item.treatment_plan_item_id) : null,
            item_name: item.name || null,  // Map 'name' from API to item_name
            description: item.name || item.description || null,  // Dentally uses 'name' field
            quantity: item.quantity || 0,
            line_amount: item.total_price ? parseFloat(item.total_price) : 0,  // Map total_price to line_amount
            gross: item.total_price ? parseFloat(item.total_price) : 0,  // Use total_price as gross
            discount: 0,  // Dentally API doesn't provide discount breakdown
            net: item.total_price ? parseFloat(item.total_price) : 0,  // Map total_price to net
            tax: 0,  // Dentally API doesn't provide tax breakdown
            api_record_created_at: item.created_at || null,
            api_record_updated_at: item.updated_at || null,
          };

          // Each item is added individually - NO merging with other items
          allLineItems.push(lineItemData);
        }

        if (nullIdCount > 0 || duplicateIdCount > 0) {
          console.log(`[WARNING] Invoice ${savedInvoice.platform_invoice_id} has ${nullIdCount} items without IDs and ${duplicateIdCount} items with duplicate IDs - generated unique IDs to prevent conflicts`);
        }
      }

      // Verify all items were processed
      if (allLineItems.length !== totalApiItems) {
        console.error(`[CRITICAL] Item count mismatch! API returned ${totalApiItems} items but only ${allLineItems.length} were processed. Missing: ${totalApiItems - allLineItems.length} items`);
      } else {
        console.log(`[VERIFIED] All ${totalApiItems} items from API were processed successfully`);
      }

      if (allLineItems.length > 0) {
        console.log(`Upserting ${allLineItems.length} invoice line items (each item processed individually, NO merging)...`);
        console.log(`[COUNT DEBUG] Line items count: ${allLineItems.length} (NOT included in processed count)`);
        console.log(`[COUNT DEBUG] Total items from API: ${totalApiItems}, Items to upsert: ${allLineItems.length}`);

        // Log item count per invoice for verification
        const itemsPerInvoice = new Map<string, number>();
        for (const item of allLineItems) {
          const count = itemsPerInvoice.get(item.invoice_id) || 0;
          itemsPerInvoice.set(item.invoice_id, count + 1);
        }
        console.log(`Line items distribution: ${Array.from(itemsPerInvoice.entries()).map(([invId, count]) => `Invoice ${invId}: ${count} items`).join(', ')}`);

        try {
          // Use column names for onConflict (Supabase requires column names, not constraint names)
          // Unique constraint: (organization_id, platform_line_id, invoice_id)
          // This ensures items from different invoices are NOT merged even if they have the same platform_line_id
          const { error: lineItemsError, count: lineItemsCount } = await supabase
            .from("platform_integration_invoice_line_items")
            .upsert(allLineItems, {
              onConflict: "organization_id,platform_line_id,invoice_id", // Column names matching unique constraint
              count: 'exact'
            });

          if (lineItemsError) {
            console.error(`Batch upsert failed for invoice line items:`, lineItemsError);
            console.log(`Falling back to individual upserts for line items...`);

            // Fallback: upsert individually - each item is processed separately
            let individualSuccessCount = 0;
            let individualFailedCount = 0;
            for (let i = 0; i < allLineItems.length; i++) {
              try {
                const { error: individualError } = await supabase
                  .from("platform_integration_invoice_line_items")
                  .upsert(allLineItems[i], {
                    onConflict: "organization_id,platform_line_id,invoice_id" // Column names matching unique constraint
                  });

                if (individualError) {
                  individualFailedCount++;
                  console.error(`Failed to upsert line item ${i + 1}/${allLineItems.length}:`, individualError);
                  console.error(`Failed item details:`, JSON.stringify(allLineItems[i], null, 2));
                } else {
                  individualSuccessCount++;
                }
              } catch (err) {
                individualFailedCount++;
                console.error(`Error upserting line item ${i + 1}:`, err);
              }
            }
            console.log(`[FALLBACK UPSERT] Successfully upserted ${individualSuccessCount} items, failed ${individualFailedCount} items`);
            if (individualFailedCount > 0) {
              console.error(`[CRITICAL] ${individualFailedCount} line items failed to upsert! This may cause data mismatch.`);
            }
          } else {
            const upsertedCount = lineItemsCount || allLineItems.length;
            console.log(`✓ Successfully upserted ${upsertedCount} invoice line items (each as separate record, NO merging)`);
            if (upsertedCount !== allLineItems.length) {
              console.warn(`[WARNING] Upserted count (${upsertedCount}) differs from items processed (${allLineItems.length}). This may indicate some items were not saved.`);
            }
          }
        } catch (error) {
          console.error(`Critical error during invoice line items upsert:`, error);
        }
      } else {
        console.log(`No line items to upsert (allLineItems.length = 0)`);
      }
    } // End of else block for invoiceFetchError check
  }

  // For invoices, return the count BEFORE line items were processed
  const finalProcessed = entityAlias === "invoices" ? invoiceProcessedCount : processed;

  console.log(`[COUNT DEBUG] Returning from upsertEntityData - Entity: ${entityAlias}, Processed: ${finalProcessed}, Failed: ${failed}`);
  if (entityAlias === "invoices") {
    console.log(`[COUNT DEBUG] Invoice-only count (excluding line items): ${finalProcessed}`);
  }

  return { processed: finalProcessed, failed };
}

// deno-lint-ignore no-explicit-any
async function processSyncJob(
  supabase: SupabaseClient<any>,
  job: SyncJobRecord,
  integration: IntegrationRecord
): Promise<void> {
  console.log(`Processing sync job ${job.id} for entity: ${job.entity_alias}`);

  try {
    // Update job status to running if not already
    if (job.status !== "running") {
      await updateSyncJobProgress(supabase, job.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });
    }

    const entityAlias = job.entity_alias || "appointments";

    // Process ONLY the current page (resume from where we left off)
    const currentPage = job.current_page;
    console.log(`Fetching page ${currentPage} for ${entityAlias}...`);

    const responseData = await fetchDentallyData(
      integration.api_key,
      integration.api_endpoints,
      entityAlias,
      currentPage,
      job.start_date,
      job.end_date
    );

    // Handle different response formats
    let records: any[] = [];
    let apiTotalPages: number | null = null;

    // Map entity alias to API response key (handle singular/plural differences)
    const responseKeyMap: Record<string, string> = {
      treatment_category: "treatment_categories",  // API returns plural
      locations: "sites",  // API endpoint is /v1/sites, returns "sites" key
      treatment_appointments: "treatment_appointments",  // API returns treatment_appointments key
      // Add other mappings if needed
    };

    const responseKey = responseKeyMap[entityAlias] || entityAlias;

    if (Array.isArray(responseData)) {
      records = responseData;
    } else if (responseData[responseKey] && Array.isArray(responseData[responseKey])) {
      records = responseData[responseKey];
    } else if (responseData[entityAlias] && Array.isArray(responseData[entityAlias])) {
      records = responseData[entityAlias];  // Fallback to entity alias
    } else if (responseData.data && Array.isArray(responseData.data)) {
      records = responseData.data;
    }

    // Extract total_pages from API metadata
    if (responseData.meta && responseData.meta.total_pages) {
      apiTotalPages = responseData.meta.total_pages;
      console.log(`API reports total_pages: ${apiTotalPages}`);
    }

    // Track raw page size BEFORE any filtering — used for pagination detection
    const rawPageSize = records.length;

    console.log(`Fetched ${records.length} records from page ${currentPage}`);

    // Client-side filter: only keep paid invoices
    // The Dentally API does NOT support 'paid' as a query parameter (it is silently ignored),
    // so we must filter after fetching to match Dentally UI's "State: Paid" filter.
    if (entityAlias === "invoices") {
      const beforeFilter = records.length;
      records = records.filter((r: any) => r.paid === true);
      if (beforeFilter !== records.length) {
        console.log(`Filtered ${beforeFilter - records.length} unpaid invoices (${records.length} paid remain)`);
      }
    }

    // For invoices, fetch detailed data for each invoice to get invoice_items
    if (entityAlias === "invoices" && records.length > 0) {
      console.log(`Fetching detailed invoice data for ${records.length} invoices...`);
      const detailedRecords: any[] = [];

      for (let i = 0; i < records.length; i++) {
        const invoice = records[i];
        try {
          const detailResponse = await fetchInvoiceDetail(
            integration.api_key,
            integration.api_endpoints,
            invoice.id
          );

          // Handle different response formats
          let detailedInvoice: any;
          if (detailResponse.invoice) {
            detailedInvoice = detailResponse.invoice;
          } else {
            detailedInvoice = detailResponse;
          }

          detailedRecords.push(detailedInvoice);

          // Add delay between invoice detail fetches to avoid rate limiting
          // Skip delay for the last invoice in the batch
          if (i < records.length - 1) {
            await sleep(RATE_LIMIT_DELAY_MS);
          }
        } catch (error) {
          console.error(`Failed to fetch detail for invoice ${invoice.id}:`, error);
          // Still include the basic invoice data even if detail fetch fails
          detailedRecords.push(invoice);
        }
      }

      records = detailedRecords;
      console.log(`Fetched details for ${records.length} invoices`);

      // Extract unique patient IDs from invoices and sync missing patients
      const patientIds = new Set<number>();
      for (const invoice of records) {
        if (invoice.patient_id && typeof invoice.patient_id === 'number') {
          patientIds.add(invoice.patient_id);
        }
      }

      if (patientIds.size > 0) {
        console.log(`Found ${patientIds.size} unique patient IDs in invoices. Syncing missing patients...`);
        await syncMissingPatients(
          supabase,
          integration.api_key,
          integration.api_endpoints,
          job.organization_id,
          job.integration_id,
          job.user_id,
          Array.from(patientIds)
        );
      }
    }

    // Upsert data into database
    const { processed, failed } = await upsertEntityData(
      supabase,
      entityAlias,
      job.organization_id,
      job.integration_id,
      job.user_id,
      records
    );

    console.log(`[COUNT DEBUG] Entity: ${entityAlias}, Page ${currentPage}: Processed ${processed} records, Failed ${failed} records`);
    console.log(`[COUNT DEBUG] Previous total: ${job.records_processed}, Adding: ${processed}, New total: ${job.records_processed + processed}`);

    const totalProcessed = job.records_processed + processed;
    const totalFailed = job.records_failed + failed;

    // Check if this is the last page
    // Use API's total_pages if available, otherwise fall back to checking record count
    // Use rawPageSize (before paid/dedup filtering) for pagination check,
    // otherwise filtering out unpaid invoices could prematurely stop pagination.
    const isLastPage = apiTotalPages
      ? currentPage >= apiTotalPages
      : rawPageSize < PAGE_SIZE;

    if (isLastPage) {
      // Post-processing: If this was a treatments sync, map any existing treatments without category_id
      if (entityAlias === "treatments") {
        console.log(`Post-processing: Mapping existing treatments to categories...`);
        try {
          await mapExistingTreatmentsToCategories(
            supabase,
            integration.api_key,
            integration.api_endpoints,
            job.organization_id,
            job.user_id
          );
        } catch (error) {
          console.error(`Error mapping treatments to categories:`, error);
          // Don't fail the sync job if mapping fails
        }
      }

      // Mark job as completed
      await updateSyncJobProgress(supabase, job.id, {
        status: "completed",
        progress_percentage: 100,
        current_page: currentPage,
        total_pages: currentPage,
        records_processed: totalProcessed,
        records_failed: totalFailed,
        completed_at: new Date().toISOString(),
      });

      console.log(`Sync job ${job.id} completed. Processed: ${totalProcessed}, Failed: ${totalFailed}`);
    } else {
      // More pages to process - update progress and increment page
      const progressPercentage = Math.min(95, Math.floor((currentPage / (currentPage + 5)) * 100));

      await updateSyncJobProgress(supabase, job.id, {
        current_page: currentPage + 1, // Move to next page
        records_processed: totalProcessed,
        records_failed: totalFailed,
        progress_percentage: progressPercentage,
      });

      console.log(`Page ${currentPage} processed. Next page: ${currentPage + 1}`);
      console.log(`Job ${job.id} is still running - will be continued by polling mechanism`);

      // Note: The frontend polling mechanism (useAutoTriggerSync) will
      // automatically trigger this job again to process the next page
    }
  } catch (error) {
    console.error(`Sync job ${job.id} failed:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if we should retry
    if (job.retry_count < job.max_retries) {
      await updateSyncJobProgress(supabase, job.id, {
        status: "queued",
        error_message: errorMessage,
        retry_count: job.retry_count + 1,
      });
      console.log(`Job ${job.id} queued for retry (${job.retry_count + 1}/${job.max_retries})`);
    } else {
      await updateSyncJobProgress(supabase, job.id, {
        status: "failed",
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });
      console.log(`Job ${job.id} failed after ${job.max_retries} retries`);
    }
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Note: We rely on RLS (Row Level Security) policies for authorization
    // The edge function is called from authenticated frontend code
    // RLS policies ensure users can only access their organization's data

    // Create Supabase client with SERVICE_ROLE_KEY for database operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse request body
    const { jobId } = await req.json();

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "jobId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing sync job: ${jobId}`);

    // Fetch sync job
    const { data: job, error: jobError } = await supabase
      .from("sync_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error("Failed to fetch sync job:", jobError);
      return new Response(
        JSON.stringify({ error: "Sync job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", job.integration_id)
      .single();

    if (integrationError || !integration) {
      console.error("Failed to fetch integration:", integrationError);
      await updateSyncJobProgress(supabase, jobId, {
        status: "failed",
        error_message: "Integration not found",
      });
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process the sync job
    await processSyncJob(supabase, job, integration);

    return new Response(
      JSON.stringify({ success: true, jobId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
