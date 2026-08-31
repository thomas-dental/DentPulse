/**
 * Growth Levers — multi-practice rollup with configurable headroom benchmarks.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { getGrowthLeversSummary } = require('./growthLeversSummary');
const {
  BENCHMARK_METHOD_GROUP_TOP,
  DEFAULT_BENCHMARK_METHOD,
  maxLeverAcrossPractices,
  resolveBenchmarksForPractice,
  headroom,
  headroomPct,
  combinedHeadroomPct,
  topLeverToPull,
  benchmarkMethodNote,
  numOrNull,
} = require('./growthLeversBenchmarkLogic');

async function loadUserPracticeIds(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw new Error(`user_roles: ${error.message}`);

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id) => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadPracticeNames(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (error) throw new Error(`organizations: ${error.message}`);

  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name || 'Practice').trim() || 'Practice');
  }
  return map;
}

async function loadBenchmarkConfig(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('pe_economic_assumptions')
    .select(
      'growth_levers_benchmark_method, growth_levers_target_visit_frequency, growth_levers_target_value_per_visit, growth_levers_target_tenure_years, growth_levers_target_projected_lifetime_years',
    )
    .eq('practice_id', practiceId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    if (String(error.message || '').includes('growth_levers_benchmark_method')) {
      return { benchmarkMethod: DEFAULT_BENCHMARK_METHOD };
    }
    throw new Error(`pe_economic_assumptions benchmark: ${error.message}`);
  }

  const method = data?.growth_levers_benchmark_method || DEFAULT_BENCHMARK_METHOD;

  return {
    benchmarkMethod: method,
    targetVisitFrequency: data?.growth_levers_target_visit_frequency,
    targetValuePerVisit: data?.growth_levers_target_value_per_visit,
    targetTenureYears: data?.growth_levers_target_tenure_years,
    targetProjectedLifetimeYears: data?.growth_levers_target_projected_lifetime_years,
  };
}

async function loadPerPracticeTargets(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('pe_economic_assumptions')
    .select(
      'practice_id, growth_levers_benchmark_method, growth_levers_target_visit_frequency, growth_levers_target_value_per_visit, growth_levers_target_tenure_years, growth_levers_target_projected_lifetime_years',
    )
    .in('practice_id', practiceIds);

  if (error) {
    if (String(error.message || '').includes('growth_levers_benchmark_method')) {
      return map;
    }
    throw new Error(`pe_economic_assumptions targets: ${error.message}`);
  }

  for (const row of data ?? []) {
    map.set(String(row.practice_id), {
      benchmarkMethod: row.growth_levers_benchmark_method || DEFAULT_BENCHMARK_METHOD,
      targetVisitFrequency: row.growth_levers_target_visit_frequency,
      targetValuePerVisit: row.growth_levers_target_value_per_visit,
      targetTenureYears: row.growth_levers_target_tenure_years,
      targetProjectedLifetimeYears: row.growth_levers_target_projected_lifetime_years,
    });
  }
  return map;
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId — org whose pe_economic_assumptions sets group benchmark method
 */
async function getGrowthLeversByPractice(userId, contextPracticeId) {
  const practiceIds = await loadUserPracticeIds(userId);
  if (practiceIds.length === 0) {
    return {
      contextPracticeId,
      benchmarkMethod: DEFAULT_BENCHMARK_METHOD,
      benchmarkMethodNote: benchmarkMethodNote(DEFAULT_BENCHMARK_METHOD),
      practices: [],
      hasData: false,
    };
  }

  const [names, contextConfig, perPracticeTargets] = await Promise.all([
    loadPracticeNames(practiceIds),
    loadBenchmarkConfig(contextPracticeId),
    loadPerPracticeTargets(practiceIds),
  ]);

  const benchmarkMethod = contextConfig.benchmarkMethod || DEFAULT_BENCHMARK_METHOD;

  const summaries = await Promise.all(
    practiceIds.map(async (pid) => {
      try {
        const s = await getGrowthLeversSummary(pid);
        return {
          practiceId: pid,
          practiceName: names.get(pid) || 'Practice',
          visitFrequency: s.visitFrequency,
          valuePerVisit: s.valuePerVisit,
          tenureYears: s.tenureYears,
          projectedLifetimeYears: s.projectedLifetimeYears,
          trailingMonths: s.trailingMonths,
        };
      } catch (err) {
        console.warn(`[GrowthLevers] practice ${pid} summary failed:`, err.message);
        return {
          practiceId: pid,
          practiceName: names.get(pid) || 'Practice',
          visitFrequency: null,
          valuePerVisit: null,
          tenureYears: null,
          projectedLifetimeYears: null,
          trailingMonths: null,
        };
      }
    }),
  );

  const groupTop = {
    visitFrequency: maxLeverAcrossPractices(summaries, 'visitFrequency'),
    valuePerVisit: maxLeverAcrossPractices(summaries, 'valuePerVisit'),
    tenureYears: maxLeverAcrossPractices(summaries, 'tenureYears'),
    projectedLifetimeYears: maxLeverAcrossPractices(summaries, 'projectedLifetimeYears'),
  };

  const practices = summaries.map((row) => {
    const practiceTargetRow = perPracticeTargets.get(row.practiceId) || {};
    const targets = { benchmarkMethod, ...contextConfig, ...practiceTargetRow };

    const benchmarks = resolveBenchmarksForPractice(targets, groupTop, row);

    const visitFrequencyHeadroom = headroom(benchmarks.visitFrequency, row.visitFrequency);
    const valuePerVisitHeadroom = headroom(benchmarks.valuePerVisit, row.valuePerVisit);
    const tenureHeadroom = headroom(benchmarks.tenureYears, row.tenureYears);
    const projectedLifetimeHeadroom = headroom(
      benchmarks.projectedLifetimeYears,
      row.projectedLifetimeYears,
    );

    const gapPcts = {
      visitFrequency: headroomPct(benchmarks.visitFrequency, row.visitFrequency),
      valuePerVisit: headroomPct(benchmarks.valuePerVisit, row.valuePerVisit),
      tenureYears: headroomPct(benchmarks.tenureYears, row.tenureYears),
      projectedLifetimeYears: headroomPct(
        benchmarks.projectedLifetimeYears,
        row.projectedLifetimeYears,
      ),
    };

    return {
      ...row,
      benchmarks: {
        visitFrequency: benchmarks.visitFrequency,
        valuePerVisit: benchmarks.valuePerVisit,
        tenureYears: benchmarks.tenureYears,
        projectedLifetimeYears: benchmarks.projectedLifetimeYears,
      },
      visitFrequencyHeadroom,
      valuePerVisitHeadroom,
      tenureHeadroom,
      projectedLifetimeHeadroom,
      combinedHeadroomPct: combinedHeadroomPct([
        gapPcts.visitFrequency,
        gapPcts.valuePerVisit,
        gapPcts.tenureYears,
        gapPcts.projectedLifetimeYears,
      ]),
      topLeverToPull: topLeverToPull(gapPcts),
    };
  });

  practices.sort(
    (a, b) =>
      (numOrNull(b.combinedHeadroomPct) ?? -1) - (numOrNull(a.combinedHeadroomPct) ?? -1),
  );

  return {
    contextPracticeId,
    benchmarkMethod,
    benchmarkMethodNote: benchmarkMethodNote(benchmarkMethod),
    groupBenchmarks: groupTop,
    practices,
    hasData: practices.some(
      (p) =>
        p.visitFrequency != null ||
        p.valuePerVisit != null ||
        p.tenureYears != null ||
        p.projectedLifetimeYears != null,
    ),
  };
}

module.exports = {
  getGrowthLeversByPractice,
  loadUserPracticeIds,
};
