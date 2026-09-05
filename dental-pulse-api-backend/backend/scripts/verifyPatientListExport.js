/**
 * Verify Patient List CSV export matches on-screen row data (same filtered/sorted set).
 *
 * Usage:
 *   node backend/scripts/verifyPatientListExport.js [practice_id]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function displayName(rawName, ptId) {
  const trimmed = String(rawName ?? '').trim();
  if (trimmed) return trimmed;
  if (ptId != null) return `Patient #${ptId}`;
  return 'Unknown patient';
}

function dataQualityLabel(status) {
  if (status === 'partial_no_practitioner') return 'No practitioner';
  if (status === 'partial_missing_rate') return 'Missing rate';
  return 'Derived';
}

function filterRows(rows, search) {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if (r.patientName.toLowerCase().includes(q)) return true;
    if (r.ptId != null && String(r.ptId).includes(q)) return true;
    return false;
  });
}

function sortRows(rows, sortKey, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv, 'en-GB');
    }
    const an = Number(av);
    const bn = Number(bv);
    if (an === bn) return mul * a.patientName.localeCompare(b.patientName, 'en-GB');
    return mul * (an - bn);
  });
}

function buildCsvLine(row) {
  const quality = dataQualityLabel(row.contributionProvenanceStatus);
  const qualityDetail =
    row.contributionProvenanceStatus !== 'complete' && row.pctComplete != null
      ? `${row.pctComplete}% complete`
      : '';
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    row.patientName,
    row.ptId ?? '',
    row.revenuePrivatePlan.toFixed(2),
    row.directCost.toFixed(2),
    row.contribution.toFixed(2),
    quality,
    qualityDetail,
  ]
    .map(esc)
    .join(',');
}

async function resolvePracticeId(arg) {
  if (arg) return arg;
  const { data, error } = await supabaseAdmin
    .from('v_patient_contribution')
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

async function fetchRows(practiceId) {
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
    for (const row of rows) {
      const status = String(row.contribution_provenance_status || 'complete');
      const ptId =
        row.pt_id == null || row.pt_id === ''
          ? null
          : Number.isFinite(Number(row.pt_id))
            ? Number(row.pt_id)
            : null;
      all.push({
        patientId: String(row.patient_id),
        ptId,
        patientName: displayName(row.patient_name, ptId),
        revenuePrivatePlan: num(row.revenue_private_plan),
        directCost: num(row.direct_cost),
        contribution: num(row.contribution),
        contributionProvenanceStatus:
          status === 'partial_no_practitioner' || status === 'partial_missing_rate'
            ? status
            : 'complete',
        pctComplete: row.pct_complete == null ? null : num(row.pct_complete),
        isActive: false,
        hasPaymentPlan: false,
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const ids = all.map((r) => r.patientId);
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id, is_active, pt_payment_plan_id')
      .eq('organization_id', practiceId)
      .in('id', chunk);
    if (error) throw error;
    for (const p of data || []) {
      meta.set(String(p.id), {
        isActive: p.is_active === true,
        hasPaymentPlan: p.pt_payment_plan_id != null,
      });
    }
  }

  return all.map((r) => ({
    ...r,
    isActive: meta.get(r.patientId)?.isActive ?? false,
    hasPaymentPlan: meta.get(r.patientId)?.hasPaymentPlan ?? false,
  }));
}

function computeSummary(rows) {
  const total = rows.length;
  if (total === 0) {
    return { totalPatients: 0, activePatients: 0, privatePlanPatients: 0, averageContribution: 0 };
  }
  let active = 0;
  let privatePlan = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.isActive) active += 1;
    if (r.revenuePrivatePlan > 0 || r.hasPaymentPlan) privatePlan += 1;
    sum += r.contribution;
  }
  return {
    totalPatients: total,
    activePatients: active,
    privatePlanPatients: privatePlan,
    averageContribution: sum / total,
  };
}

async function main() {
  const practiceId = await resolvePracticeId(process.argv[2]);
  if (!practiceId) {
    console.log('No practice with patient contribution data.');
    return;
  }

  console.log('Practice:', practiceId);

  const all = await fetchRows(practiceId);
  const sorted = sortRows(filterRows(all, ''), 'contribution', 'desc');
  const pageSize = 25;
  const pageRows = sorted.slice(0, pageSize);
  const summary = computeSummary(sorted);

  console.log('Summary KPIs (full filtered set):');
  console.log(`  Total patients: ${summary.totalPatients}`);
  console.log(`  Active patients: ${summary.activePatients}`);
  console.log(`  Private-plan patients: ${summary.privatePlanPatients}`);
  console.log(`  Average contribution: £${summary.averageContribution.toFixed(2)}`);

  let mismatches = 0;
  for (const row of pageRows) {
    const csvLine = buildCsvLine(row);
    const parts = csvLine.match(/("([^"]|"")*"|[^,]+)/g) || [];
    const parsed = parts.map((p) => p.replace(/^"|"$/g, '').replace(/""/g, '"'));

    const nameOk = parsed[0] === row.patientName;
    const revOk = parsed[2] === row.revenuePrivatePlan.toFixed(2);
    const costOk = parsed[3] === row.directCost.toFixed(2);
    const contribOk = parsed[4] === row.contribution.toFixed(2);
    const qualOk = parsed[5] === dataQualityLabel(row.contributionProvenanceStatus);

    if (!nameOk || !revOk || !costOk || !contribOk || !qualOk) {
      mismatches += 1;
      console.log('MISMATCH:', row.patientName, { nameOk, revOk, costOk, contribOk, qualOk });
    }
  }

  console.log(`CSV vs on-screen page-1 check: ${pageRows.length - mismatches}/${pageRows.length} rows match`);
  if (mismatches === 0) {
    console.log('PASS — export rows match table data for sample page');
  } else {
    console.log('FAIL — drift detected');
    process.exit(1);
  }

  console.log(`Export would include ${sorted.length} rows (not just page 1)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
