/**
 * Spot-check v_patient_contribution after migration (or simulate from v_invoice_contribution).
 *
 * Usage:
 *   node backend/scripts/spotCheckPatientContribution.js [practice_id]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function resolvePracticeId(arg) {
  if (arg) return arg;
  const { data, error } = await supabaseAdmin
    .from('v_invoice_contribution')
    .select('practice_id')
    .limit(5000);
  if (error) throw error;
  const counts = new Map();
  for (const row of data || []) {
    counts.set(row.practice_id, (counts.get(row.practice_id) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

async function aggregateFromInvoices(practiceId) {
  const PAGE = 1000;
  const byPatient = new Map();
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select(
        'patient_id, pt_id, revenue_private_plan, direct_cost, contribution, contribution_provenance_status',
      )
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      if (!row.patient_id) continue;
      const key = String(row.patient_id);
      const cur = byPatient.get(key) || {
        patientId: key,
        ptId: row.pt_id,
        revenue: 0,
        directCost: 0,
        contribution: 0,
        partialNoPractitioner: 0,
        partialMissingRate: 0,
        invoiceCount: 0,
      };
      cur.revenue += num(row.revenue_private_plan);
      cur.directCost += num(row.direct_cost);
      cur.contribution += num(row.contribution);
      cur.invoiceCount += 1;
      if (row.contribution_provenance_status === 'partial_no_practitioner') {
        cur.partialNoPractitioner += 1;
      }
      if (row.contribution_provenance_status === 'partial_missing_rate') {
        cur.partialMissingRate += 1;
      }
      byPatient.set(key, cur);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return [...byPatient.values()];
}

async function fetchViewRows(practiceId) {
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('*')
      .eq('practice_id', practiceId)
      .order('contribution', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  const practiceId = await resolvePracticeId(process.argv[2]);
  if (!practiceId) {
    console.log('No practice with invoice contribution data.');
    return;
  }

  console.log('Practice:', practiceId);

  let viewRows = null;
  try {
    viewRows = await fetchViewRows(practiceId);
    console.log('v_patient_contribution rows:', viewRows.length);
  } catch (e) {
    console.log('v_patient_contribution not available:', e.message);
  }

  const simulated = await aggregateFromInvoices(practiceId);
  console.log('Simulated patient count from v_invoice_contribution:', simulated.length);

  const partialPatients = simulated.filter(
    (p) => p.partialNoPractitioner > 0 || p.partialMissingRate > 0,
  );
  console.log('Patients with partial invoices:', partialPatients.length);

  const top = [...simulated].sort((a, b) => b.contribution - a.contribution).slice(0, 5);
  console.log('Top 5 by contribution (simulated):');
  for (const p of top) {
    const status =
      p.partialNoPractitioner > 0
        ? 'partial_no_practitioner'
        : p.partialMissingRate > 0
          ? 'partial_missing_rate'
          : 'complete';
    console.log(
      `  pt=${p.ptId} revenue=${p.revenue.toFixed(2)} cost=${p.directCost.toFixed(2)} contrib=${p.contribution.toFixed(2)} status=${status} invoices=${p.invoiceCount}`,
    );
  }

  if (viewRows) {
    const viewTop = viewRows.slice(0, 5);
    console.log('Top 5 from view:');
    for (const r of viewTop) {
      console.log(
        `  ${r.patient_name || '—'} revenue=${num(r.revenue_private_plan).toFixed(2)} cost=${num(r.direct_cost).toFixed(2)} contrib=${num(r.contribution).toFixed(2)} status=${r.contribution_provenance_status}`,
      );
    }
    if (viewRows.length === simulated.length) {
      const viewContrib = viewRows.reduce((s, r) => s + num(r.contribution), 0);
      const simContrib = simulated.reduce((s, r) => s + r.contribution, 0);
      const delta = Math.abs(viewContrib - simContrib);
      console.log(
        `Rollup check: view total contribution £${viewContrib.toFixed(2)} vs simulated £${simContrib.toFixed(2)} (Δ £${delta.toFixed(2)})`,
      );
      if (delta < 0.05) console.log('PASS — view matches invoice aggregation');
      else console.log('WARN — totals diverge');
    }
  }

  console.log(
    `Volume check: ${simulated.length} patients — pagination at 25/page = ${Math.ceil(simulated.length / 25)} pages`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
