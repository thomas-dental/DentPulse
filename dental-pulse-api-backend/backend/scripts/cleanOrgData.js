/**
 * Remove all Dentally-synced data for a specific organization.
 * Run: node scripts/cleanOrgData.js <orgId>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ORG_ID = process.argv[2];

if (!ORG_ID) {
  console.error('Usage: node scripts/cleanOrgData.js <organizationId>');
  process.exit(1);
}

// Tables to clean, in order (child tables first to avoid FK violations)
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
];
async function main() {
  console.log(`\nCleaning Dentally data for org: ${ORG_ID}\n`);

  for (const { table, label, extraFilter } of TABLES_TO_CLEAN) {
    try {
      // Count first
      let countQuery = supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
      if (extraFilter) {
        for (const [key, val] of Object.entries(extraFilter)) {
          countQuery = countQuery.eq(key, val);
        }
      }
      const { count, error: countError } = await countQuery;

      if (countError) {
        console.log(`  [SKIP] ${label} (${table}): ${countError.message}`);
        continue;
      }

      if (!count || count === 0) {
        console.log(`  [SKIP] ${label}: 0 rows`);
        continue;
      }

      // Delete
      let deleteQuery = supabase.from(table).delete().eq('organization_id', ORG_ID);
      if (extraFilter) {
        for (const [key, val] of Object.entries(extraFilter)) {
          deleteQuery = deleteQuery.eq(key, val);
        }
      }
      const { error: deleteError } = await deleteQuery;

      if (deleteError) {
        console.error(`  [ERROR] ${label} (${table}): ${deleteError.message}`);
      } else {
        console.log(`  [DELETED] ${label}: ${count} rows`);
      }
    } catch (err) {
      console.error(`  [ERROR] ${label}: ${err.message}`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
}

main();
