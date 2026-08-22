/**
 * Default integrations configuration
 * This file contains the default integrations that are created for new organizations
 * You can easily add, remove, or modify integrations here
 */

export interface DefaultIntegration {
  integration_name: string;
  integration_description: string;
  is_connected: boolean;
  api_endpoints: string;
  api_key: string | null;
  secret_key_id_available: string | null;
  sync_frequency: string;
  sync_at: string | null;
}

/**
 * Default integrations template
 * These will be created for each new organization during onboarding
 * Only Dentally integration is created by default
 */
export const DEFAULT_INTEGRATIONS: DefaultIntegration[] = [
  {
    integration_name: 'Dentally',
    integration_description: 'Cloud-based dental practice management software',
    is_connected: false,
    api_endpoints: 'https://api.dentally.co',
    api_key: null,
    secret_key_id_available: null,
    sync_frequency: '15min',
    sync_at: null,
  },
];

/**
 * Creates integration records for a new organization
 * @param organizationId - The organization ID to associate integrations with
 * @param createdBy - The user ID who created the organization
 * @returns Array of integration objects ready for database insertion
 */
export function createDefaultIntegrations(
  organizationId: string,
  createdBy: string
): Array<DefaultIntegration & { organization_id: string; created_by: string; user_id: string }> {
  const integrations = DEFAULT_INTEGRATIONS.map((integration) => {
    // Explicitly set all fields to ensure no unexpected values
    const integrationData = {
      organization_id: organizationId,
      created_by: createdBy,
      user_id: createdBy, // Associate integration with user
      integration_name: integration.integration_name,
      integration_description: integration.integration_description,
      is_connected: integration.is_connected,
      api_endpoints: integration.api_endpoints,
      api_key: null, // Explicitly set to null
      secret_key_id_available: null, // Explicitly set to null
      sync_frequency: integration.sync_frequency,
      sync_at: null, // Explicitly set to null
    };

    console.log(`Creating integration: ${integration.integration_name}`, {
      secret_key_id_available: integrationData.secret_key_id_available,
      api_key: integrationData.api_key,
    });

    return integrationData;
  });

  console.log('createDefaultIntegrations - All integrations:', JSON.stringify(integrations, null, 2));
  return integrations;
}
