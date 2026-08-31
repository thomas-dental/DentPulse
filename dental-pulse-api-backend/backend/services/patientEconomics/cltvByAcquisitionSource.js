/**
 * CLTV by acquisition source — rolls up Day 3 modelled scores per source.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { round2, DEFAULT_CLTV_MIN_SAMPLE } = require('./growthLeversBenchmarkLogic');

const PAGE_SIZE = 1000;
const MODELLED_TIER = 'Modelled';

async function loadCltvMinSample(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('pe_economic_assumptions')
    .select('cltv_acquisition_min_sample')
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    if (String(error.message || '').includes('cltv_acquisition_min_sample')) {
      return DEFAULT_CLTV_MIN_SAMPLE;
    }
    throw new Error(`pe_economic_assumptions: ${error.message}`);
  }

  const n = Number(data?.cltv_acquisition_min_sample);
  if (Number.isFinite(n) && n >= 1) return Math.round(n);
  return DEFAULT_CLTV_MIN_SAMPLE;
}

async function loadAcquisitionSourceCatalog(practiceId) {
  const map = new Map();
  const { data, error } = await supabaseAdmin
    .from('acquisition_sources')
    .select('as_id, as_name')
    .eq('organization_id', practiceId)
    .is('deleted_at', null);

  if (error) throw new Error(`acquisition_sources: ${error.message}`);

  for (const row of data ?? []) {
    if (row.as_id != null) {
      map.set(String(row.as_id), String(row.as_name || 'Unknown').trim() || 'Unknown');
    }
  }
  return map;
}

/**
 * @param {string} practiceId
 */
async function getCltvByAcquisitionSource(practiceId) {
  const minSample = await loadCltvMinSample(practiceId);
  const catalog = await loadAcquisitionSourceCatalog(practiceId);

  const agg = new Map();
  let offset = 0;
  let unknownCount = 0;
  let unknownCltvSum = 0;
  let unknownQualitySum = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('patient_economics_modelled_scores')
      .select('patient_id, cltv_projection, quality_score')
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`modelled scores: ${error.message}`);

    const batch = data ?? [];
    if (batch.length === 0) break;

    const patientIds = batch.map((r) => r.patient_id).filter(Boolean);
    const { data: patients, error: pErr } = await supabaseAdmin
      .from('patients')
      .select('id, pt_acquisition_source_id, pt_acquisition_source_name')
      .eq('organization_id', practiceId)
      .in('id', patientIds);

    if (pErr) throw new Error(`patients acquisition: ${pErr.message}`);

    const patientMap = new Map();
    for (const p of patients ?? []) {
      patientMap.set(String(p.id), p);
    }

    for (const row of batch) {
      const patient = patientMap.get(String(row.patient_id));
      const sourceId =
        patient?.pt_acquisition_source_id != null
          ? String(patient.pt_acquisition_source_id)
          : null;

      let sourceName = null;
      if (sourceId && catalog.has(sourceId)) {
        sourceName = catalog.get(sourceId);
      } else if (
        patient?.pt_acquisition_source_name &&
        String(patient.pt_acquisition_source_name).trim()
      ) {
        sourceName = String(patient.pt_acquisition_source_name).trim();
      }

      const cltv = Number(row.cltv_projection) || 0;
      const quality = Number(row.quality_score) || 0;

      if (!sourceName) {
        unknownCount += 1;
        unknownCltvSum += cltv;
        unknownQualitySum += quality;
        continue;
      }

      if (!agg.has(sourceName)) {
        agg.set(sourceName, {
          acquisitionSourceName: sourceName,
          patientCount: 0,
          cltvSum: 0,
          qualitySum: 0,
        });
      }
      const entry = agg.get(sourceName);
      entry.patientCount += 1;
      entry.cltvSum += cltv;
      entry.qualitySum += quality;
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const sources = [...agg.values()]
    .map((e) => ({
      acquisitionSourceName: e.acquisitionSourceName,
      patientCount: e.patientCount,
      avgCltv: round2(e.cltvSum / e.patientCount),
      totalCltv: round2(e.cltvSum),
      avgQualityScore: round2(e.qualitySum / e.patientCount),
      isThinSample: e.patientCount < minSample,
      tier: MODELLED_TIER,
    }))
    .sort((a, b) => b.avgCltv - a.avgCltv);

  if (unknownCount > 0) {
    sources.push({
      acquisitionSourceName: 'Unknown / no source',
      patientCount: unknownCount,
      avgCltv: round2(unknownCltvSum / unknownCount),
      totalCltv: round2(unknownCltvSum),
      avgQualityScore: round2(unknownQualitySum / unknownCount),
      isThinSample: unknownCount < minSample,
      tier: MODELLED_TIER,
    });
  }

  return {
    practiceId,
    minSampleSize: minSample,
    minSampleTierNote: `Sources with fewer than ${minSample} modelled patients flagged as thin sample`,
    sources,
    hasData: sources.length > 0,
    tier: MODELLED_TIER,
    tierNote:
      'Day 3 modelled CLTV rollup by acquisition source (catalog join on pt_acquisition_source_id)',
  };
}

module.exports = {
  getCltvByAcquisitionSource,
};
