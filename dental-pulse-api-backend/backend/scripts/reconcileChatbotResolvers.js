/**
 * Reconciliation harness for the dedicated chatbot resolvers shipped
 * 2026-05-18 (plan-mix, NHS, membership, profit-goals).
 *
 * These resolvers are correct-by-construction (exact mirrors of the page
 * hooks) and fully unit-tested, but the acceptance gate is £/unit
 * reconciliation against the LIVE pages on a real org — which needs Supabase
 * credentials + real data. This script runs each resolver for a given
 * org/period/location and prints the headline numbers next to the exact page
 * card to eyeball-compare. Read-only (no writes).
 *
 *   node backend/scripts/reconcileChatbotResolvers.js <orgId> <from> <to> [locationId]
 *
 *   <from> <to>  : YYYY-MM-DD. For plan-mix/NHS/membership use the SAME range
 *                  the page filter shows. For profit-goals, use an exact
 *                  calendar month/quarter/year (else targets are absent).
 *   [locationId] : optional practice_locations.id. Omit = all locations
 *                  (set the page's Location filter to "All").
 *
 * Tip: `node backend/scripts/getOrgs.js` lists org IDs.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const dataResolver = require('../services/chatbot/dataResolver');

const [orgId, from, to, locationId] = process.argv.slice(2);
if (!orgId || !from || !to) {
  console.error('Usage: node backend/scripts/reconcileChatbotResolvers.js <orgId> <from YYYY-MM-DD> <to YYYY-MM-DD> [locationId]');
  process.exit(1);
}

const gbp = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const args = { period_from: from, period_to: to };
if (locationId) args.location_id = locationId;

async function run(toolName) {
  try {
    return await dataResolver.resolve({ toolName, args: { ...args } }, orgId, {});
  } catch (err) {
    return { __error: err.message };
  }
}

(async () => {
  const scope = locationId ? `location ${locationId}` : 'ALL locations';
  console.log(`\nReconciliation — org ${orgId} · ${from} → ${to} · ${scope}\n${'='.repeat(72)}`);

  // ── Plan Mix ── compare vs Treatment Insights → "Plan Mix" donut ──
  {
    const r = await run('get_plan_mix');
    console.log('\n● PLAN MIX  — compare vs Treatment Insights page → "Plan Mix" donut');
    if (r.__error) console.log('  ERROR:', r.__error);
    else if (r.preformatted) console.log('  (no data) ', r.markdown);
    else {
      console.log(`  Location: ${r.locationName} · Total: ${gbp(r.total)}`);
      (r.data || []).forEach(d => console.log(`   - ${d.plan}: ${gbp(d.revenue)}  (${d.sharePercent}% · ${d.count} items)`));
      console.log('  ✔ Compare each plan name + share% + the total against the donut legend.');
    }
  }

  // ── NHS ── compare vs NHS Contract Performance summary cards ──
  {
    const r = await run('get_nhs_performance');
    console.log('\n● NHS CONTRACT  — compare vs NHS Contract Performance page summary cards');
    if (r.__error) console.log('  ERROR:', r.__error);
    else if (r.preformatted) console.log('  (no data) ', r.markdown);
    else {
      const t = r.totals || {};
      console.log(`  Location: ${r.locationName}`);
      console.log(`  UDA delivered/target: ${t.udaDelivered}/${t.udaTarget} (${t.udaDeliveryPct}%)`);
      console.log(`  Fee expected: ${gbp(t.feeExpected)} · Fee awarded: ${gbp(t.feeAwarded)} (${t.feeDeliveryPct}%)`);
      console.log(`  Patient charges: ${gbp(t.patientCharge)} · YTD revenue: ${gbp(t.ytdRevenue)} · Claims: ${t.claimCount}`);
      console.log(`  Providers: ${(r.providers || []).length} (top: ${(r.providers || []).slice(0, 3).map(p => `${p.name} ${gbp(p.feeExpected)}`).join(', ')})`);
      console.log('  ✔ Compare UDA delivered/target, fee expected/awarded, YTD revenue against the cards.');
    }
  }

  // ── Membership ── compare vs Membership Performance per-plan ──
  {
    const r = await run('get_membership_performance');
    console.log('\n● MEMBERSHIP  — compare vs Membership Performance page (members + revenue per plan)');
    if (r.__error) console.log('  ERROR:', r.__error);
    else if (r.preformatted) console.log('  (no data) ', r.markdown);
    else {
      const t = r.totals || {};
      console.log(`  Location: ${r.locationName} · Total members: ${t.totalMembers} · Membership revenue: ${gbp(t.membershipRevenue)} · Plans: ${t.planCount}`);
      (r.plans || []).forEach(p => console.log(`   - ${p.plan}: ${p.members} members · fee ${gbp(p.monthlyFee)} · ${gbp(p.revenue)}`));
      console.log('  ✔ Compare members + revenue per plan (NOT cost/profit/tenure — deferred by design).');
    }
  }

  // ── Profit Goals ── compare vs Treatment Profit Goals page ──
  {
    const r = await run('get_profit_goals');
    console.log('\n● PROFIT GOALS  — compare vs Treatment Profit Goals page (actual vs target)');
    if (r.__error) console.log('  ERROR:', r.__error);
    else if (r.preformatted) console.log('  (no data) ', r.markdown);
    else {
      const t = r.totals || {};
      console.log(`  Location: ${r.locationName} · targets available: ${r.targetsAvailable}`);
      console.log(`  Units actual/target: ${t.unitActual}/${t.unitTarget} · Avg £ actual/target: ${gbp(t.avgActual)}/${gbp(t.avgTarget)}`);
      console.log(`  Rows: ${(r.rows || []).length} (top: ${(r.rows || []).slice(0, 3).map(x => `${x.name} ${x.unitActual}/${x.unitTarget}`).join(', ')})`);
      console.log('  ✔ Compare totals + a few treatment rows against the page table. If targets');
      console.log('    available:false, your range is not an exact calendar month/quarter/year.');
    }
  }

  console.log(`\n${'='.repeat(72)}\nDone. Mismatches → report the resolver + the page number; I'll fix the mirror.\n`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
