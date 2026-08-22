/**
 * Integration logo URLs served from the Supabase public storage bucket.
 * To swap a logo, upload the new file to the `integration-logos` bucket
 * and update only the filename below.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

const LOGO_BUCKET_BASE = `${SUPABASE_URL}/storage/v1/object/public/integration-logos`;

export const INTEGRATION_LOGOS = {
  iplicit:    `${LOGO_BUCKET_BASE}/iplicit-logo.svg`,
  xero:       `${LOGO_BUCKET_BASE}/xero-logo.svg`,
  quickbooks: `${LOGO_BUCKET_BASE}/quickbooks-logo.svg`,
  supabase:   `${LOGO_BUCKET_BASE}/Supabase.svg`,
} as const;

/**
 * DentPulse site logo URLs served from the `site-logo` bucket.
 * Update VITE_SUPABASE_URL in .env to point to a different project —
 * no other changes needed.
 */
const SITE_LOGO_BASE = `${SUPABASE_URL}/storage/v1/object/public/site-logo`;

export const SITE_LOGOS = {
  menuIcon:  `${SITE_LOGO_BASE}/DentPulseLIghtMenu.svg`,
  logoLight: `${SITE_LOGO_BASE}/DentPulseLogoLight.png`,
  logoDark:  `${SITE_LOGO_BASE}/DentPulseLogoDark.png`,
  favicon:   `${SITE_LOGO_BASE}/favicon-icon-design.ico`,
} as const;
