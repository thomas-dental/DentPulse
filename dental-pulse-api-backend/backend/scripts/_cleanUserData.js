/**
 * Remove ALL Dentally-synced data + sync jobs for a specific user_id.
 * Finds all organizations owned by the user, cleans each one.
 *
 * Run: node scripts/_cleanUserData.js <userId>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = process.argv[2];

if (!USER_ID) {
  console.error('Usage: node scripts/_cleanUserData.js <userId>');
  process.exit(1);
}

// Tables to clean per org (child tables first to avoid FK violations)
const TABLES_TO_CLEAN = [
  { table: 'platform_integration_invoice_line_items', label: 'Invoice line items' },
  { table: 'platform_integration_invoices', label: 'Invoices', extraFilter: { platform_type: 'dentally' } },
  { table: 'treatment_plan_items', label: 'Treatment plan items' },
  { table: 'treatment_appointments', label: 'Treatment appointments' },
  { table: 'treatment_plans', label: 'Treatment plans' },
  { table: 'appointments', label: 'Appointments' },
  { table: 'patients', label: 'Patients' },
  { table: 'providers', label: 'Providers/Practitioners' },
  { table: 'treatments', label: 'Treatments' },
  { table: 'payment_plans', label: 'Payment plans' },
  { table: 'treatment_categories', label: 'Treatment categories' },
  { table: 'practice_locations', label: 'Practice locations' },
  { table: 'sync_jobs', label: 'Sync jobs' },
  { table: 'integration_sync_entities', label: 'Sync entities', fkColumn: 'integration_id' },
];

async function deleteFromTable(orgId, { table, label, extraFilter, fkColumn }, integrationIds) {
  try {
    // For integration_sync_entities, filter by integration_id instead of organization_id
    if (fkColumn === 'integration_id' && integrationIds && integrationIds.length > 0) {
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in('integration_id', integrationIds);

      if (!count || count === 0) {
        console.log(`    [SKIP] ${label}: 0 rows`);
        return 0;
      }

      const { error } = await supabase.from(table).delete().in('integration_id', integrationIds);
      if (error) {
        console.error(`    [ERROR] ${label}: ${error.message}`);
        return 0;
      }
      console.log(`    [DELETED] ${label}: ${count} rows`);
      return count;
    }

    // Standard org-based deletion
    let countQuery = supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    if (extraFilter) {
      for (const [key, val] of Object.entries(extraFilter)) {
        countQuery = countQuery.eq(key, val);
      }
    }
    const { count, error: countError } = await countQuery;

    if (countError) {
      console.log(`    [SKIP] ${label} (${table}): ${countError.message}`);
      return 0;
    }

    if (!count || count === 0) {
      console.log(`    [SKIP] ${label}: 0 rows`);
      return 0;
    }

    let deleteQuery = supabase.from(table).delete().eq('organization_id', orgId);
    if (extraFilter) {
      for (const [key, val] of Object.entries(extraFilter)) {
        deleteQuery = deleteQuery.eq(key, val);
      }
    }
    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      console.error(`    [ERROR] ${label}: ${deleteError.message}`);
      return 0;
    }
    console.log(`    [DELETED] ${label}: ${count} rows`);
    return count;
  } catch (err) {
    console.error(`    [ERROR] ${label}: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log(`\nCleaning ALL Dentally data for user: ${USER_ID}\n`);

  // 1. Find all organizations for this user
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('user_id', USER_ID);

  if (orgErr) {
    console.error('Failed to fetch organizations:', orgErr.message);
    process.exit(1);
  }

  if (!orgs || orgs.length === 0) {
    console.log('No organizations found for this user.');
    process.exit(0);
  }

  console.log(`Found ${orgs.length} organization(s):\n`);
  for (const org of orgs) {
    console.log(`  - ${org.name} (${org.id})`);
  }
  console.log('');

  let totalDeleted = 0;

  // 2. Clean each org
  for (const org of orgs) {
    console.log(`\n  ── Cleaning: ${org.name} (${org.id}) ──\n`);

    // Get integration IDs for this org (needed for sync_entities)
    const { data: integrations } = await supabase
      .from('integrations')
      .select('id')
      .eq('organization_id', org.id);

    const integrationIds = (integrations || []).map(i => i.id);

    for (const tableConfig of TABLES_TO_CLEAN) {
      const deleted = await deleteFromTable(org.id, tableConfig, integrationIds);
      totalDeleted += deleted;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Total deleted: ${totalDeleted} rows across ${orgs.length} org(s)`);
  console.log(`════════════════════════════════════════\n`);

  process.exit(0);
}

main();
