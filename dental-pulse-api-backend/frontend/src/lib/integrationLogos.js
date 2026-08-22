/**
 * Integration logo URLs served from the Supabase public storage bucket.
 * Same bucket used by the main dental-pulse-dev frontend.
 */
const LOGO_BUCKET_BASE =
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/integration-logos`;

export const INTEGRATION_LOGOS = {
  iplicit:    `${LOGO_BUCKET_BASE}/iplicit-logo.svg`,
  xero:       `${LOGO_BUCKET_BASE}/xero-logo.svg`,
  quickbooks: `${LOGO_BUCKET_BASE}/quickbooks-logo.svg`,
};
