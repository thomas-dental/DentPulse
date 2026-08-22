/**
 * Compare Dentally API treatment_plans count vs Supabase synced count
 * for user_id 5936857d-1c41-463a-927b-e9e169a5bd21
 * Date range: Feb 1, 2026 to Feb 24, 2026
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_ID = '5936857d-1c41-463a-927b-e9e169a5bd21';
const DATE_START = '2026-02-01T00:00:00';
const DATE_END = '2026-02-25T00:00:00'; // +1 day for inclusive end

async function main() {
  console.log('=== Treatment Plans Comparison Script ===\n');

  // Step 1: Get user's organizations via user_roles table
  console.log(`[1] Looking up organizations for user_id: ${USER_ID}`);
  const { data: roles, error: rolesErr } = await supabase
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', USER_ID);

  if (rolesErr) {
    console.error('Error fetching user_roles:', rolesErr.message);
    process.exit(1);
  }

  // Also check profiles.current_organization_id as fallback
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('current_organization_id')
    .eq('user_id', USER_ID)
    .maybeSingle();

  if (profileErr) {
    console.error('Error fetching profile:', profileErr.message);
    process.exit(1);
  }

  // Combine org IDs from both sources
  const orgIds = new Set();
  if (roles) {
    for (const r of roles) {
      if (r.organization_id) orgIds.add(r.organization_id);
    }
  }
  if (profile && profile.current_organization_id) {
    orgIds.add(profile.current_organization_id);
  }

  const orgIdArray = [...orgIds];
  console.log(`   Found ${orgIdArray.length} organization(s): ${orgIdArray.join(', ')}\n`);

  if (orgIdArray.length === 0) {
    console.error('No organizations found for this user.');
    process.exit(1);
  }

  // Step 2: Get Dentally integration API key for these organizations
  console.log('[2] Fetching Dentally integration API key...');
  const { data: integrations, error: intErr } = await supabase
    .from('integrations')
    .select('id, organization_id, api_key, api_endpoints')
    .in('organization_id', orgIdArray)
    .not('api_key', 'is', null)
    .is('deleted_at', null);

  if (intErr) {
    console.error('Error fetching integrations:', intErr.message);
    process.exit(1);
  }

  if (!integrations || integrations.length === 0) {
    console.error('No Dentally integration with api_key found for this user\'s organizations.');
    process.exit(1);
  }

  const integration = integrations[0];
  const apiKey = integration.api_key;
  const apiEndpoint = (integration.api_endpoints || 'https://api.dentally.co').replace(/\/$/, '');
  console.log(`   Integration ID: ${integration.id}`);
  console.log(`   Organization ID: ${integration.organization_id}`);
  console.log(`   API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`   API Endpoint: ${apiEndpoint}\n`);

  // Step 3: Call Dentally API to get treatment_plans page 1
  console.log('[3] Calling Dentally API for treatment_plans...');
  console.log(`   Date range: ${DATE_START} to ${DATE_END} (exclusive end)`);

  const params = new URLSearchParams({
    page: '1',
    per_page: '100',
    created_after: DATE_START,
    created_before: DATE_END,
    sort_by: 'created_at',
  });

  const url = `${apiEndpoint}/v1/treatment_plans?${params.toString()}`;
  console.log(`   URL: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'DentPulse/1.0',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Dentally API error (${response.status}): ${errText}`);
    process.exit(1);
  }

  const data = await response.json();
  const dentallyTotal = data.meta?.total ?? null;
  const dentallyTotalPages = data.meta?.total_pages ?? null;
  const dentallyPageCount = data.treatment_plans?.length ?? 0;

  console.log(`   Response meta: total=${dentallyTotal}, total_pages=${dentallyTotalPages}`);
  console.log(`   Page 1 records: ${dentallyPageCount}\n`);

  // Step 4: Count treatment_plans in Supabase for this org in the same date range
  console.log('[4] Counting treatment_plans in Supabase...');

  // Count records with created_at in the date range for the user's organizations
  const { count: supabaseCount, error: countErr } = await supabase
    .from('treatment_plans')
    .select('*', { count: 'exact', head: true })
    .in('organization_id', orgIdArray)
    .gte('created_at', '2026-02-01T00:00:00')
    .lt('created_at', '2026-02-25T00:00:00');

  if (countErr) {
    console.error('Error counting Supabase records:', countErr.message);
    process.exit(1);
  }

  const supabaseTotal = supabaseCount ?? 0;
  console.log(`   Supabase count: ${supabaseTotal}\n`);

  // Step 5: Print comparison table
  const match = dentallyTotal === supabaseTotal;
  const diff = dentallyTotal - supabaseTotal;

  console.log('='.repeat(56));
  console.log('  TREATMENT PLANS COMPARISON (Feb 1 - Feb 24, 2026)');
  console.log('='.repeat(56));
  console.log(`  Dentally API total:     ${String(dentallyTotal).padStart(6)}`);
  console.log(`  Supabase synced total:  ${String(supabaseTotal).padStart(6)}`);
  console.log('-'.repeat(56));
  console.log(`  Difference:             ${String(diff).padStart(6)}`);
  console.log(`  Status:                 ${match ? 'MATCH' : 'MISMATCH'}`);
  console.log('='.repeat(56));

  if (!match) {
    console.log(`\n  WARNING: ${Math.abs(diff)} record(s) ${diff > 0 ? 'missing from Supabase' : 'extra in Supabase'}`);
  } else {
    console.log('\n  All records are in sync.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
