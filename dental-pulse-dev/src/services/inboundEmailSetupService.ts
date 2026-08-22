/**
 * Inbound Email Setup Service
 * Handles checking and creating inbound email addresses for organizations and locations
 * Uses Vite proxy on localhost to bypass CORS, direct API calls on production
 */

import { isLocalhost, isConfigured, getOrganizationInboundEmails, getLocationInboundEmails, createInboundEmail as createInboundEmailBase, InboundEmailType } from './inboundService';

// Re-export for convenience
export { createLocationInboundEmailsBatch } from './inboundService';

// Email types for organization-level
const ORG_EMAIL_TYPES: InboundEmailType[] = ['cost', 'sales'];

export interface InboundEmailStatus {
  exists: boolean;
  cost_email: string | null;
  sales_email: string | null;
}

export interface CreateInboundEmailResult {
  status: 'created' | 'exists' | 'partial' | 'error';
  cost_email?: string;
  sales_email?: string;
  location_email?: string;
  location_cost_email?: string;
  location_sales_email?: string;
  location_id?: string;
  message?: string;
  error?: string;
  errors?: string[];
}

/**
 * Check if organization has inbound emails configured
 * Checks by organization_id and user_id (if provided)
 */
export async function checkInboundEmailStatus(organizationId: string, userId?: string): Promise<InboundEmailStatus> {
  try {
    const emails = await getOrganizationInboundEmails(organizationId, userId);

    const costEmail = emails.find(e => e.email_type === 'cost');
    const salesEmail = emails.find(e => e.email_type === 'sales');

    return {
      exists: !!(costEmail || salesEmail),
      cost_email: costEmail?.inbound_email_address || null,
      sales_email: salesEmail?.inbound_email_address || null,
    };
  } catch (error) {
    console.error('[InboundEmailSetup] Error checking status:', error);
    return {
      exists: false,
      cost_email: null,
      sales_email: null,
    };
  }
}

/**
 * Create inbound emails for organization (cost & sales)
 */
export async function createInboundEmail(
  organizationId: string,
  organizationName: string,
  userId?: string
): Promise<CreateInboundEmailResult> {
  // Skip on localhost
  if (isLocalhost()) {
    console.log('[InboundEmailSetup] Skipping on localhost');
    return {
      status: 'exists',
      message: 'Skipped on localhost - inbound email creation disabled for local development',
    };
  }

  // Check configuration
  if (!isConfigured()) {
    console.error('[InboundEmailSetup] Missing configuration');
    return {
      status: 'error',
      error: 'Missing Inbound.dev configuration',
    };
  }

  try {
    console.log('[InboundEmailSetup] Creating emails for organization:', organizationId, 'userId:', userId);

    // Get existing emails - check by organization_id and user_id
    const existingEmails = await getOrganizationInboundEmails(organizationId, userId);
    const existingEmailsMap = new Map(
      existingEmails.map(e => [e.email_type, e.inbound_email_address])
    );

    // Check if all emails already exist
    const allExist = ORG_EMAIL_TYPES.every(type => existingEmailsMap.has(type));

    if (allExist) {
      return {
        status: 'exists',
        cost_email: existingEmailsMap.get('cost') || undefined,
        sales_email: existingEmailsMap.get('sales') || undefined,
        message: 'Inbound emails already exist',
      };
    }

    // Create missing emails
    const results: Record<string, string> = {};
    const errors: string[] = [];

    for (const emailType of ORG_EMAIL_TYPES) {
      // Skip if already exists
      if (existingEmailsMap.has(emailType)) {
        results[`${emailType}_email`] = existingEmailsMap.get(emailType)!;
        console.log(`[InboundEmailSetup] ${emailType} email already exists`);
        continue;
      }

      // Create new email
      const result = await createInboundEmailBase({
        organizationId,
        userId,
        emailType,
        name: organizationName,
      });

      if (result.success && result.email) {
        results[`${emailType}_email`] = result.email;
      } else {
        errors.push(`${emailType}: ${result.error || 'Unknown error'}`);
      }
    }

    if (Object.keys(results).length === 0) {
      return {
        status: 'error',
        error: 'Failed to create any inbound emails',
        errors,
      };
    }

    return {
      status: errors.length === 0 ? 'created' : 'partial',
      cost_email: results.cost_email,
      sales_email: results.sales_email,
      message: errors.length === 0
        ? 'Inbound emails created successfully'
        : 'Some emails created with errors',
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    console.error('[InboundEmailSetup] Exception:', error);
    return {
      status: 'error',
      error: error.message || 'Failed to create inbound email',
    };
  }
}

/**
 * Create inbound emails for a specific location (Cost & Sales - same as organization)
 * Checks for existing emails by organization_id, location_id, user_id, and email_type before creating
 * Uses Vite proxy on localhost to bypass CORS
 */
export async function createLocationInboundEmail(
  organizationId: string,
  locationId: string,
  locationName: string,
  userId?: string
): Promise<CreateInboundEmailResult> {
  // Check configuration
  if (!isConfigured()) {
    console.error('[InboundEmailSetup] Missing configuration');
    return {
      status: 'error',
      error: 'Missing Inbound.dev configuration',
    };
  }

  try {
    console.log('[InboundEmailSetup] Creating Cost & Sales emails for location:', { organizationId, locationId, locationName, userId });

    // First check if emails already exist for this location
    const existingEmails = await getLocationInboundEmails(organizationId, locationId, userId);
    const existingEmailsMap = new Map(
      existingEmails.map(e => [e.email_type, e.inbound_email_address])
    );

    console.log('[InboundEmailSetup] Existing location emails:', {
      count: existingEmails.length,
      types: Array.from(existingEmailsMap.keys()),
    });

    // Check if both cost and sales emails already exist
    const hasCost = existingEmailsMap.has('cost');
    const hasSales = existingEmailsMap.has('sales');

    if (hasCost && hasSales) {
      console.log('[InboundEmailSetup] Both Cost & Sales emails already exist for location');
      return {
        status: 'exists',
        location_cost_email: existingEmailsMap.get('cost'),
        location_sales_email: existingEmailsMap.get('sales'),
        location_id: locationId,
        message: 'Location inbound emails already exist',
      };
    }

    const results: { cost?: string; sales?: string } = {};
    const errors: string[] = [];

    // Create Cost email for location (only if doesn't exist)
    if (hasCost) {
      results.cost = existingEmailsMap.get('cost');
      console.log('[InboundEmailSetup] Location Cost email already exists:', results.cost);
    } else {
      const costResult = await createInboundEmailBase({
        organizationId,
        locationId,
        userId,
        emailType: 'cost',
        name: `${locationName} Cost`,
      });

      if (costResult.success && costResult.email) {
        results.cost = costResult.email;
        console.log('[InboundEmailSetup] Location Cost email created:', costResult.email);
      } else {
        errors.push(`Cost: ${costResult.error || 'Failed'}`);
      }
    }

    // Create Sales email for location (only if doesn't exist)
    if (hasSales) {
      results.sales = existingEmailsMap.get('sales');
      console.log('[InboundEmailSetup] Location Sales email already exists:', results.sales);
    } else {
      const salesResult = await createInboundEmailBase({
        organizationId,
        locationId,
        userId,
        emailType: 'sales',
        name: `${locationName} Sales`,
      });

      if (salesResult.success && salesResult.email) {
        results.sales = salesResult.email;
        console.log('[InboundEmailSetup] Location Sales email created:', salesResult.email);
      } else {
        errors.push(`Sales: ${salesResult.error || 'Failed'}`);
      }
    }

    // Determine status
    const hasAny = results.cost || results.sales;
    const hasAll = results.cost && results.sales;

    if (!hasAny) {
      return {
        status: 'error',
        location_id: locationId,
        error: 'Failed to create any location emails',
        errors,
      };
    }

    return {
      status: hasAll ? 'created' : 'partial',
      location_cost_email: results.cost,
      location_sales_email: results.sales,
      location_id: locationId,
      message: hasAll ? 'Location inbound emails created successfully' : 'Some location emails created',
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    console.error('[InboundEmailSetup] Exception:', error);
    return {
      status: 'error',
      error: error.message || 'Failed to create location inbound emails',
    };
  }
}

/**
 * Check and create inbound emails if not exist
 * This is the main function to call when organization page loads
 * Uses Vite proxy on localhost to bypass CORS
 */
export async function ensureInboundEmail(
  organizationId: string,
  organizationName: string,
  userId?: string
): Promise<CreateInboundEmailResult> {
  console.log('[InboundEmailSetup] ensureInboundEmail called:', { organizationId, organizationName, userId });

  // First check if inbound emails exist - check by organization_id and user_id
  const status = await checkInboundEmailStatus(organizationId, userId);
  console.log('[InboundEmailSetup] Current status:', status);

  // If both emails exist, return them
  if (status.cost_email && status.sales_email) {
    console.log('[InboundEmailSetup] Both emails already exist');
    return {
      status: 'exists',
      cost_email: status.cost_email,
      sales_email: status.sales_email,
      message: 'Inbound emails already configured',
    };
  }

  // Create new inbound emails (or missing ones)
  console.log('[InboundEmailSetup] Creating inbound emails...');
  const result = await createInboundEmail(organizationId, organizationName, userId);
  console.log('[InboundEmailSetup] Create result:', result);
  return result;
}
