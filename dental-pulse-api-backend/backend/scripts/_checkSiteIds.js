require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ORG_ID = 'dbcca632-1c4f-4290-990c-bef6fdb2bd74';

(async () => {
  const { data: integ } = await sb.from('integrations')
    .select('api_key, api_endpoints')
    .eq('organization_id', ORG_ID)
    .limit(1)
    .single();

  if (!integ || !integ.api_key) {
    console.log('No API key found');
    return;
  }

  const resp = await fetch(integ.api_endpoints + '/v1/sites', {
    headers: { 'Authorization': 'Bearer ' + integ.api_key, 'Content-Type': 'application/json' }
  });
  const data = await resp.json();
  const sites = data.sites || [];
  console.log('Dentally sites returned:', sites.length);
  for (const s of sites) {
    console.log('  Site:', s.name, '| id:', s.id, '| type:', typeof s.id, '| String():', String(s.id));
  }

  // Compare with org dentally_site_ids
  const { data: orgs } = await sb.from('organizations')
    .select('name, dentally_site_id')
    .eq('user_id', '06ddd1a8-52fa-4aa2-a81f-bfdaaf38ca4d');

  console.log('\nOrg dentally_site_ids:');
  for (const o of orgs) {
    const siteMatch = sites.find(s => String(s.id) === String(o.dentally_site_id));
    console.log('  ', o.name, '| dentally_site_id:', o.dentally_site_id, '| match:', siteMatch ? 'YES' : 'NO');
  }

  // Check what upsertLocations would do
  console.log('\nSimulating upsertLocations lookup:');
  for (const s of sites) {
    const siteIdStr = String(s.id);
    const { data: org, error } = await sb.from('organizations')
      .select('id, name')
      .eq('dentally_site_id', siteIdStr)
      .eq('user_id', '06ddd1a8-52fa-4aa2-a81f-bfdaaf38ca4d')
      .limit(1)
      .maybeSingle();

    if (error) console.log('  ERROR:', error.message);
    else if (org) console.log('  Site', s.name, '(', siteIdStr, ') -> org:', org.name);
    else console.log('  Site', s.name, '(', siteIdStr, ') -> NO MATCH');
  }
})();
