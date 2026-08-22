/**
 * Re-stamp treatment_plan_items.location_id over a completed-date window.
 *
 * Why this exists: the sync only resolves TPI locations for rows in the
 * CURRENT sync batch (processor.js calls resolveTpiLocationsFromAppointments
 * with just-fetched records), and TPIs are fetched by `updated_after`. So a
 * TPI completed months ago and untouched in Dentally since keeps whatever
 * location it was stamped with at the time.
 *
 * That matters because the resolution order changed: Method 0 (practitioner
 * HOME site) used to win, and now Method 1 (the APPOINTMENT site) does — see
 * 20260817000002_net_production_use_appointment_location.sql. Rows synced
 * before that reorder still carry the old, wrong home-site stamp, which is
 * what makes a site-filtered Practitioner Activity report disagree with
 * Dentally.
 *
 * This re-runs the CURRENT resolution logic over an explicit window without
 * re-downloading anything from Dentally.
 *
 * Usage:
 *   node scripts/backfillTpiLocations.js <organization_id> <from:YYYY-MM-DD> <to:YYYY-MM-DD> [--dry-run]
 *
 * `to` is inclusive. Dates are matched against tpi_completed_at.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const { resolveTpiLocationsFromAppointments } = require('../queue/processor');

const [ORG_ID, FROM, TO] = process.argv.slice(2);
const DRY_RUN = process.argv.includes('--dry-run');

if (!ORG_ID || !FROM || !TO) {
  console.error('Usage: node scripts/backfillTpiLocations.js <organization_id> <from:YYYY-MM-DD> <to:YYYY-MM-DD> [--dry-run]');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error('Dates must be YYYY-MM-DD');
  process.exit(1);
}

// Exclusive upper bound = the day after `to`.
const endExclusive = new Date(Date.UTC(
  +TO.slice(0, 4), +TO.slice(5, 7) - 1, +TO.slice(8, 10) + 1,
)).toISOString();

const PAGE = 1000;

async function fetchWindowTpiIds() {
  const ids = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('treatment_plan_items')
      .select('tpi_id')
      .eq('organization_id', ORG_ID)
      .gte('tpi_completed_at', `${FROM}T00:00:00Z`)
      .lt('tpi_completed_at', endExclusive)
      .order('tpi_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch tpi_ids: ${error.message}`);
    const rows = data || [];
    ids.push(...rows.map(r => r.tpi_id).filter(v => v != null));
    if (rows.length < PAGE) break;
  }
  return ids;
}

async function snapshotLocations(tpiIds) {
  const byId = new Map();
  for (let i = 0; i < tpiIds.length; i += 500) {
    const batch = tpiIds.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from('treatment_plan_items')
      .select('tpi_id, location_id')
      .eq('organization_id', ORG_ID)
      .in('tpi_id', batch);
    if (error) throw new Error(`snapshot: ${error.message}`);
    for (const r of (data || [])) byId.set(String(r.tpi_id), r.location_id || null);
  }
  return byId;
}

async function main() {
  console.log(`[Backfill] org=${ORG_ID} window=${FROM}..${TO}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const tpiIds = await fetchWindowTpiIds();
  console.log(`[Backfill] ${tpiIds.length} TPIs completed in window`);
  if (tpiIds.length === 0) return;

  const before = await snapshotLocations(tpiIds);

  if (DRY_RUN) {
    // Report the current spread only — resolution itself writes, so we don't run it.
    const spread = new Map();
    for (const loc of before.values()) {
      const k = loc || '(none)';
      spread.set(k, (spread.get(k) || 0) + 1);
    }
    console.log('[Backfill] current location spread:');
    for (const [loc, n] of [...spread].sort((a, b) => b[1] - a[1])) console.log(`   ${loc}: ${n}`);
    console.log('[Backfill] dry run — nothing written. Re-run without --dry-run to re-stamp.');
    return;
  }

  // resolveTpiLocationsFromAppointments takes Dentally-API-shaped records and
  // only considers those with no site_id — which is every TPI, since the
  // Dentally API never returns site_id for them.
  const pseudoRecords = tpiIds.map(id => ({ id, site_id: null }));

  const CHUNK = 2000;
  for (let i = 0; i < pseudoRecords.length; i += CHUNK) {
    const chunk = pseudoRecords.slice(i, i + CHUNK);
    console.log(`[Backfill] resolving ${i + 1}..${i + chunk.length} of ${pseudoRecords.length}`);
    await resolveTpiLocationsFromAppointments(chunk, ORG_ID);
  }

  const after = await snapshotLocations(tpiIds);
  let changed = 0, filled = 0;
  for (const [id, oldLoc] of before) {
    const newLoc = after.get(id) ?? null;
    if (newLoc !== oldLoc) {
      changed++;
      if (!oldLoc) filled++;
    }
  }
  console.log(`[Backfill] done — ${changed} TPI locations changed (${filled} previously unset, ${changed - filled} re-stamped to a different site)`);
}

main().catch((err) => { console.error('[Backfill] Error:', err.message); process.exit(1); });
