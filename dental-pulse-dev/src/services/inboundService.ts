/**
 * Inbound Service
 * Common reusable service for Inbound.dev API interactions
 * Handles email registration, configuration, and database operations
 */

import { supabase } from '@/integrations/supabase/client';

// ============================================
// CONFIGURATION
// ============================================

export const INBOUND_CONFIG = {
  apiKey: import.meta.env.VITE_INBOUND_API_KEY || '',
  apiUrl: import.meta.env.VITE_INBOUND_API_URL || 'https://inbound.new/api/e2',
  domain: import.meta.env.VITE_INBOUND_DOMAIN || '',
  domainId: import.meta.env.VITE_INBOUND_DOMAIN_ID || '',
  endpointId: import.meta.env.VITE_INBOUND_ENDPOINT_ID || '',
};

/**
 * Get the API URL - uses proxy to bypass CORS
 * Local: Vite proxy (/api/inbound -> https://inbound.new/api/e2)
 * LIVE: Vercel rewrite (/api/inbound -> https://inbound.new/api/e2)
 */
export function getApiUrl(): string {
  // Always use /api/inbound proxy (works on both local and LIVE)
  return '/api/inbound';
}

// ============================================
// TYPES
// ============================================

export type InboundEmailType = 'cost' | 'sales' | 'location';

export interface InboundApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface InboundEmailRecord {
  id: string;
  organization_id: string;
  location_id?: string | null;
  user_id?: string | null;
  email_type: InboundEmailType;
  inbound_email_address: string;
  inbound_provider_id?: string | null;
  inbound_meta?: any;
  inbound_created: number;
}

export interface CreateEmailParams {
  organizationId: string;
  locationId?: string | null;
  userId?: string | null;
  emailType: InboundEmailType;
  emailAddress: string;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Generate random alphanumeric code
 */
export function generateRandomCode(length: number = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create email slug from name
 */
export function createEmailSlug(name: string, maxLength: number = 20): string {
  return (name || 'unnamed')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, maxLength);
}

/**
 * Generate a unique email address
 */
export function generateEmailAddress(
  name: string,
  emailType?: InboundEmailType
): string {
  const slug = createEmailSlug(name);
  const randomCode = generateRandomCode(8);
  const typePrefix = emailType && emailType !== 'location' ? `_${emailType}` : '';
  return `${slug}${typePrefix}_${randomCode}@${INBOUND_CONFIG.domain}`;
}

/**
 * Check if running on localhost
 * Now returns false because we use Vite proxy to bypass CORS on localhost
 */
export function isLocalhost(): boolean {
  // Vite proxy handles CORS, so we can create inbound emails on localhost
  return false;
}

/**
 * Check if Inbound.dev configuration is available
 */
export function isConfigured(): boolean {
  return !!(INBOUND_CONFIG.apiKey && INBOUND_CONFIG.domainId && INBOUND_CONFIG.domain);
}

// ============================================
// INBOUND.DEV API FUNCTIONS
// ============================================

/**
 * Register email address with Inbound.dev API
 * Uses Vite proxy on localhost to bypass CORS
 */
export async function registerEmailWithInbound(emailAddress: string): Promise<InboundApiResponse> {
  try {
    const payload = {
      address: emailAddress,
      domainId: INBOUND_CONFIG.domainId,
      isActive: true,
      endpointId: INBOUND_CONFIG.endpointId,
    };

    const apiUrl = getApiUrl();
    console.log('[InboundService] Registering with Inbound.dev:', emailAddress, 'via', apiUrl);
    console.log('[InboundService]  api URL:', apiUrl);
    const response = await fetch(`${apiUrl}/email-addresses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INBOUND_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log('[InboundService] API response:', {
      status: response.status,
      body: responseText.substring(0, 500),
    });

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    // Handle success (200/201) or conflict (409 - already exists)
    if (response.ok || response.status === 409) {
      if (response.status === 409) {
        console.log('[InboundService] Email already exists in Inbound.dev:', emailAddress);
      }
      return { success: true, data: responseData };
    } else {
      console.error('[InboundService] API error:', responseData);
      return { success: false, error: `API error: ${response.status}` };
    }
  } catch (error: any) {
    console.error('[InboundService] Exception calling API:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Deactivate email address in Inbound.dev API
 */
export async function deactivateEmailInInbound(emailAddressId: string): Promise<InboundApiResponse> {
  try {
    const apiUrl = getApiUrl();
    console.log('[InboundService] Deactivating email in Inbound.dev:', emailAddressId);

    const response = await fetch(`${apiUrl}/email-addresses/${emailAddressId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${INBOUND_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ isActive: false }),
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    if (response.ok) {
      return { success: true, data: responseData };
    } else {
      return { success: false, error: `API error: ${response.status}` };
    }
  } catch (error: any) {
    console.error('[InboundService] Exception deactivating email:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DATABASE FUNCTIONS
// ============================================

/**
 * Save inbound email to database
 */
export async function saveInboundEmailToDatabase(
  params: CreateEmailParams,
  apiResponse: any
): Promise<{ success: boolean; data?: InboundEmailRecord; error?: string; existed?: boolean }> {
  try {
    // First check if email already exists for this combination
    let existingQuery = supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('email_type', params.emailType)
      .eq('inbound_created', 1);

    if (params.userId) {
      existingQuery = existingQuery.eq('user_id', params.userId);
    }

    if (params.locationId) {
      existingQuery = existingQuery.eq('location_id', params.locationId);
    } else {
      existingQuery = existingQuery.is('location_id', null);
    }

    const { data: existingData } = await existingQuery.maybeSingle();

    if (existingData) {
      console.log('[InboundService] Email already exists for this combination:', {
        organizationId: params.organizationId,
        userId: params.userId,
        locationId: params.locationId,
        emailType: params.emailType,
        existingEmail: existingData.inbound_email_address,
      });
      return { success: true, data: existingData as InboundEmailRecord, existed: true };
    }

    // Insert new email
    const insertData: any = {
      organization_id: params.organizationId,
      user_id: params.userId || null,
      email_type: params.emailType,
      inbound_email_address: params.emailAddress,
      inbound_provider_id: apiResponse?.id || apiResponse?.data?.id || null,
      inbound_meta: apiResponse,
      inbound_created: 1,
    };

    // Only add location_id if it's provided (for location-specific emails)
    if (params.locationId) {
      insertData.location_id = params.locationId;
    }

    console.log('[InboundService] Inserting new email:', insertData);

    const { data, error } = await supabase
      .from('location_inbound_emails')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[InboundService] Database insert error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as InboundEmailRecord };
  } catch (error: any) {
    console.error('[InboundService] Exception saving to database:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if inbound email exists for organization
 * Checks by organization_id and user_id (if provided)
 */
export async function getOrganizationInboundEmails(
  organizationId: string,
  userId?: string
): Promise<InboundEmailRecord[]> {
  try {
    let query = supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', organizationId)
      .is('location_id', null)
      .eq('inbound_created', 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[InboundService] Error fetching organization emails:', error);
      return [];
    }

    return (data || []) as InboundEmailRecord[];
  } catch (error) {
    console.error('[InboundService] Exception fetching organization emails:', error);
    return [];
  }
}

/**
 * Check if inbound email exists for location
 * Returns the first email found (cost or sales) for the location
 * Checks by organization_id, location_id, and user_id (if provided)
 */
export async function getLocationInboundEmail(
  organizationId: string,
  locationId: string,
  userId?: string
): Promise<InboundEmailRecord | null> {
  try {
    let query = supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId)
      .eq('inbound_created', 1)
      .limit(1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('[InboundService] Error fetching location email:', error);
      return null;
    }

    return data as InboundEmailRecord | null;
  } catch (error) {
    console.error('[InboundService] Exception fetching location email:', error);
    return null;
  }
}

/**
 * Get all inbound emails for a specific location (cost & sales)
 */
export async function getLocationInboundEmails(
  organizationId: string,
  locationId: string,
  userId?: string
): Promise<InboundEmailRecord[]> {
  try {
    let query = supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId)
      .eq('inbound_created', 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[InboundService] Error fetching location emails:', error);
      return [];
    }

    return (data || []) as InboundEmailRecord[];
  } catch (error) {
    console.error('[InboundService] Exception fetching location emails:', error);
    return [];
  }
}

/**
 * Check if a specific email type exists for the given combination
 * Used to prevent duplicate emails
 */
export async function checkEmailExists(
  organizationId: string,
  emailType: InboundEmailType,
  userId?: string,
  locationId?: string | null
): Promise<InboundEmailRecord | null> {
  try {
    let query = supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('email_type', emailType)
      .eq('inbound_created', 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (locationId) {
      query = query.eq('location_id', locationId);
    } else {
      query = query.is('location_id', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('[InboundService] Error checking email exists:', error);
      return null;
    }

    return data as InboundEmailRecord | null;
  } catch (error) {
    console.error('[InboundService] Exception checking email exists:', error);
    return null;
  }
}

/**
 * Get all location inbound emails for an organization
 * Returns all emails that have a location_id (cost & sales for each location)
 */
export async function getAllLocationInboundEmails(
  organizationId: string
): Promise<InboundEmailRecord[]> {
  try {
    const { data, error } = await supabase
      .from('location_inbound_emails')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('inbound_created', 1)
      .not('location_id', 'is', null);

    if (error) {
      console.error('[InboundService] Error fetching location emails:', error);
      return [];
    }

    return (data || []) as InboundEmailRecord[];
  } catch (error) {
    console.error('[InboundService] Exception fetching location emails:', error);
    return [];
  }
}

// ============================================
// HIGH-LEVEL FUNCTIONS
// ============================================

/**
 * Create and register a new inbound email
 * Combines API registration and database storage
 */
export async function createInboundEmail(
  params: Omit<CreateEmailParams, 'emailAddress'> & { name: string }
): Promise<{ success: boolean; email?: string; error?: string }> {
  // Skip on localhost
  if (isLocalhost()) {
    console.log('[InboundService] Skipping on localhost');
    return { success: true, email: undefined };
  }

  // Check configuration
  if (!isConfigured()) {
    console.error('[InboundService] Missing configuration');
    return { success: false, error: 'Missing Inbound.dev configuration' };
  }

  try {
    // Generate email address
    const emailAddress = generateEmailAddress(params.name, params.emailType);

    // Register with Inbound.dev
    const apiResult = await registerEmailWithInbound(emailAddress);

    if (!apiResult.success) {
      return { success: false, error: apiResult.error };
    }

    // Save to database
    const dbResult = await saveInboundEmailToDatabase(
      {
        organizationId: params.organizationId,
        locationId: params.locationId,
        userId: params.userId,
        emailType: params.emailType,
        emailAddress,
      },
      apiResult.data
    );

    if (!dbResult.success) {
      return { success: false, error: dbResult.error };
    }

    console.log('[InboundService] Email created successfully:', emailAddress);
    return { success: true, email: emailAddress };
  } catch (error: any) {
    console.error('[InboundService] Exception creating email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Batch create inbound emails for multiple locations
 */
export async function createLocationInboundEmailsBatch(
  organizationId: string,
  locations: Array<{ id: string; name: string }>,
  userId?: string,
  batchSize: number = 5
): Promise<{
  success: boolean;
  created: number;
  existed: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let created = 0;
  let existed = 0;
  let failed = 0;

  // Skip on localhost
  if (isLocalhost()) {
    console.log('[InboundService] Skipping batch creation on localhost');
    return { success: true, created: 0, existed: 0, failed: 0, errors: [] };
  }

  // Check configuration
  if (!isConfigured()) {
    return { success: false, created: 0, existed: 0, failed: locations.length, errors: ['Missing configuration'] };
  }

  // Process in batches
  for (let i = 0; i < locations.length; i += batchSize) {
    const batch = locations.slice(i, i + batchSize);
    console.log(`[InboundService] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(locations.length / batchSize)}`);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (location) => {
        // Check if email already exists for this location
        const existing = await getLocationInboundEmail(organizationId, location.id);
        if (existing) {
          console.log(`[InboundService] Email already exists for location ${location.id} (${location.name}): ${existing.inbound_email_address}`);
          return { success: true, existed: true, locationId: location.id };
        }

        console.log(`[InboundService] Creating new email for location ${location.id} (${location.name})`);

        // Create new email
        const result = await createInboundEmail({
          organizationId,
          locationId: location.id,
          userId,
          emailType: 'location',
          name: location.name,
        });

        if (result.success) {
          console.log(`[InboundService] Email created for location ${location.id}: ${result.email}`);
        } else {
          console.error(`[InboundService] Failed to create email for location ${location.id}: ${result.error}`);
        }

        return { ...result, locationId: location.id };
      })
    );

    // Count results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        if ((result.value as any).existed) {
          existed++;
        } else {
          created++;
        }
      } else {
        failed++;
        const locationName = batch[index].name;
        const errorMsg = result.status === 'rejected'
          ? result.reason?.message
          : (result.value as any).error;
        errors.push(`${locationName}: ${errorMsg || 'Unknown error'}`);
      }
    });
  }

  console.log(`[InboundService] Batch complete: ${created} newly created, ${existed} already existed, ${failed} failed`);

  return {
    success: failed === 0,
    created,
    existed,
    failed,
    errors,
  };
}
