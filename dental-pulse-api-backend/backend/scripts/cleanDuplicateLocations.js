/**
 * Find and remove duplicate locations for a specific organization.
 * Keeps the oldest row per (organization_id, api_record_unique_id) and deletes the rest.
 *
 * Run: node scripts/cleanDuplicateLocations.js <orgId>
 * Dry run (no deletes): node scripts/cleanDuplicateLocations.js <orgId> --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ORG_ID = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!ORG_ID) {
  console.error('Usage: node scripts/cleanDuplicateLocations.js <organizationId> [--dry-run]');
  process.exit(1);
}

async function main() {
  console.log(`Checking for duplicate locations in org: ${ORG_ID}`);
  if (DRY_RUN) console.log('(DRY RUN — no records will be deleted)\n');

  // Fetch all locations for this org
  const { data: locations, error } = await supabase
    .from('practice_locations')
    .select('id, api_record_unique_id, location_name, created_at, deleted_at')
    .eq('organization_id', ORG_ID)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching locations:', error.message);
    process.exit(1);
  }

  if (!locations || locations.length === 0) {
    console.log('No locations found for this organization.');
    return;
  }

  console.log(`Total location rows: ${locations.length}\n`);

  // Group by api_record_unique_id
  const groups = new Map();
  for (const loc of locations) {
    const key = loc.api_record_unique_id || `no-api-id-${loc.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(loc);
  }

  const duplicateIds = [];

  for (const [apiId, rows] of groups) {
    if (rows.length > 1) {
      console.log(`DUPLICATE: api_record_unique_id=${apiId} (${rows.length} rows)`);
      // Keep the first (oldest by created_at), mark rest for deletion
      const [keep, ...extras] = rows;
      console.log(`  KEEP:   id=${keep.id}  name="${keep.location_name}"  created=${keep.created_at}`);
      for (const dup of extras) {
        console.log(`  DELETE: id=${dup.id}  name="${dup.location_name}"  created=${dup.created_at}  deleted_at=${dup.deleted_at}`);
        duplicateIds.push(dup.id);
      }
      console.log('');
    }
  }

  if (duplicateIds.length === 0) {
    console.log('No duplicates found.');
    return;
  }

  console.log(`Found ${duplicateIds.length} duplicate location(s) to remove.\n`);

  if (DRY_RUN) {
    console.log('Dry run complete. Run without --dry-run to delete duplicates.');
    return;
  }

  // Delete duplicates
  const { error: deleteError } = await supabase
    .from('practice_locations')
    .delete()
    .in('id', duplicateIds);

  if (deleteError) {
    console.error('Error deleting duplicates:', deleteError.message);
    process.exit(1);
  }

  console.log(`Successfully deleted ${duplicateIds.length} duplicate location(s).`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
