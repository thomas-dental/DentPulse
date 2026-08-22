const { supabaseAdmin } = require('../../config/supabase');

/**
 * Daily morning briefing with smart period detection.
 * Tries: yesterday → last 7 days → last month → empty.
 * Returns 3 highlights from production, cashflow, patients.
 */

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatCurrency(val) {
  return '£' + (parseFloat(val) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function fetchMetricTotal(orgId, rpcName, valKey, from, to) {
  const { data } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: from,
    p_end_date: to,
    p_organization_id: orgId,
    p_provider_type: null,
    p_location_id: null,
  });
  return (data || []).reduce((sum, p) => sum + parseFloat(p[valKey] || 0), 0);
}

async function fetchPatientCount(orgId, from, to) {
  // get_total_distinct_patients takes TIMESTAMPTZ; pass full-day bounds so a
  // single-day range (start = end) still covers the whole day, not just midnight.
  const { data } = await supabaseAdmin.rpc('get_total_distinct_patients', {
    p_organization_id: orgId,
    p_start_date: `${from}T00:00:00Z`,
    p_end_date: `${to}T23:59:59.999Z`,
    p_provider_type: null,
    p_location_id: null,
  });
  if (Array.isArray(data)) return data[0]?.count || 0;
  return data || 0;
}

async function generateBriefing(organizationId) {
  const now = new Date();

  // Smart period detection: try yesterday, then last 7 days, then last month
  const periods = [
    {
      label: 'Yesterday',
      from: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
      to: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
    },
    {
      label: 'Last 7 Days',
      from: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)),
      to: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
    },
    {
      label: 'Last 30 Days',
      from: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)),
      to: formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
    },
  ];

  let usedPeriod = null;
  let revenue = 0;
  let profit = 0;
  let patients = 0;

  for (const period of periods) {
    revenue = await fetchMetricTotal(organizationId, 'chart_get_production_metrics', 'production_amount', period.from, period.to);
    profit = await fetchMetricTotal(organizationId, 'chart_get_profit_metrics', 'periodic_profit', period.from, period.to);
    patients = await fetchPatientCount(organizationId, period.from, period.to);

    if (revenue > 0 || profit > 0 || patients > 0) {
      usedPeriod = period;
      break;
    }
  }

  if (!usedPeriod) {
    return {
      greeting: getGreeting(),
      periodLabel: 'No recent data',
      highlights: [
        { label: 'Revenue', value: '£0.00', trend: null },
        { label: 'Profit', value: '£0.00', trend: null },
        { label: 'Patients', value: '0', trend: null },
      ],
      empty: true,
    };
  }

  // Get previous period for trend comparison
  const durationMs = new Date(usedPeriod.to) - new Date(usedPeriod.from) + 86400000;
  const prevFrom = formatDate(new Date(new Date(usedPeriod.from).getTime() - durationMs));
  const prevTo = formatDate(new Date(new Date(usedPeriod.from).getTime() - 86400000));

  const prevRevenue = await fetchMetricTotal(organizationId, 'chart_get_production_metrics', 'production_amount', prevFrom, prevTo);
  const prevProfit = await fetchMetricTotal(organizationId, 'chart_get_profit_metrics', 'periodic_profit', prevFrom, prevTo);
  const prevPatients = await fetchPatientCount(organizationId, prevFrom, prevTo);

  function calcTrend(curr, prev) {
    if (prev === 0) return curr > 0 ? 'up' : null;
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    return { direction: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct).toFixed(1) };
  }

  return {
    greeting: getGreeting(),
    periodLabel: usedPeriod.label,
    highlights: [
      { label: 'Revenue', value: formatCurrency(revenue), trend: calcTrend(revenue, prevRevenue) },
      { label: 'Profit', value: formatCurrency(profit), trend: calcTrend(profit, prevProfit) },
      { label: 'Patients', value: String(patients), trend: calcTrend(patients, prevPatients) },
    ],
    empty: false,
  };
}

module.exports = { generateBriefing };
