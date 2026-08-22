/**
 * ★ DOMAIN HEART of the Conversational BI module ★
 *
 * Every metric the dashboard can compute is declared here as a canonical query
 * template. The LLM is NEVER allowed to pick a table/column itself — the
 * classifier only identifies intent; nlResolver.js maps the question to one or
 * more of these KpiDefs, and the aggregator copies the template verbatim. This
 * is the fix for the "wrong-column" class of bugs.
 *
 * Every `table`/`column` named here MUST be allow-listed in tableAllowList.js.
 * v1 is intentionally scoped to treatment_plan_items + patients — the tables
 * whose numbers are auditable against the Treatments pages (matches the
 * "chatbot must mirror the page" + "no misleading numbers" product rules).
 *
 * KpiDef shape:
 *   id            snake_case unique id
 *   name          human label (used in widget titles)
 *   table         allow-listed table
 *   method        'sum' | 'count' | 'count_distinct' | 'avg' | 'derived'
 *   valueColumn   numeric col for sum/avg
 *   distinctColumn col for count_distinct
 *   dateColumn    date/timestamp col the period filter applies to
 *   baseFilters   extra canonical filters (besides org + period + location)
 *   excludeCharting drop tooth-status rows (Dentally activity-report parity)
 *   dimensions    { dimKey: { groupBy, dateFormat?, labelTable? } } supported breakdowns
 *   unit          'currency' | 'count'
 *   derivedFrom   [numeratorKpiId, denominatorKpiId]  (method='derived')
 *   synonyms      lowercase trigger phrases for nlResolver scoring
 *   examples      few-shot questions
 */

const TPI = 'treatment_plan_items';

// Canonical base filter for "completed treatment revenue" — mirrors
// fetchCompletedTpis() in dataResolver.js so dashboard totals reconcile with
// the Treatments pages exactly.
const COMPLETED_TPI_FILTERS = [
  { column: 'tpi_completed', operator: 'eq', value: true },
  { column: 'tpi_payment_plan_id', operator: 'not_null' },
];

const KPIS = [
  {
    id: 'total_treatment_revenue',
    name: 'Treatment revenue',
    table: TPI,
    method: 'sum',
    valueColumn: 'tpi_price',
    dateColumn: 'tpi_completed_at',
    baseFilters: COMPLETED_TPI_FILTERS,
    excludeCharting: true,
    unit: 'currency',
    dimensions: {
      location: { groupBy: 'location_id', labelTable: 'practice_locations' },
      provider: { groupBy: 'tpi_provider_id', labelTable: 'providers' },
      treatment: { groupBy: 'tpi_patient_nomenclature' },
      month: { groupBy: 'tpi_completed_at', dateFormat: 'month' },
      day: { groupBy: 'tpi_completed_at', dateFormat: 'day' },
    },
    synonyms: [
      'revenue', 'treatment revenue', 'income', 'turnover', 'production',
      'earnings', 'sales', 'money in', 'how much did we make', 'top line',
    ],
    examples: [
      'show me treatment revenue this month',
      'revenue dashboard for last quarter',
      'how much revenue did we generate',
    ],
  },
  {
    id: 'completed_treatment_count',
    name: 'Completed treatments',
    table: TPI,
    method: 'count',
    dateColumn: 'tpi_completed_at',
    baseFilters: COMPLETED_TPI_FILTERS,
    excludeCharting: true,
    unit: 'count',
    dimensions: {
      location: { groupBy: 'location_id', labelTable: 'practice_locations' },
      provider: { groupBy: 'tpi_provider_id', labelTable: 'providers' },
      treatment: { groupBy: 'tpi_patient_nomenclature' },
      month: { groupBy: 'tpi_completed_at', dateFormat: 'month' },
    },
    synonyms: [
      'treatments completed', 'completed treatments', 'number of treatments',
      'treatment count', 'how many treatments', 'procedures done', 'volume',
    ],
    examples: [
      'how many treatments were completed last month',
      'treatment volume by location',
    ],
  },
  {
    id: 'patients_treated',
    name: 'Patients treated',
    table: TPI,
    method: 'count_distinct',
    distinctColumn: 'tpi_patient_id',
    dateColumn: 'tpi_completed_at',
    baseFilters: COMPLETED_TPI_FILTERS,
    excludeCharting: true,
    unit: 'count',
    dimensions: {
      location: { groupBy: 'location_id', labelTable: 'practice_locations' },
      provider: { groupBy: 'tpi_provider_id', labelTable: 'providers' },
      treatment: { groupBy: 'tpi_patient_nomenclature' },
      month: { groupBy: 'tpi_completed_at', dateFormat: 'month' },
    },
    synonyms: [
      'patients', 'patients treated', 'patient count', 'how many patients',
      'unique patients', 'active patients', 'patient volume', 'footfall',
    ],
    examples: [
      'how many patients did we treat this quarter',
      'patients by location this month',
    ],
  },
  {
    id: 'avg_revenue_per_patient',
    name: 'Revenue per patient',
    method: 'derived',
    derivedFrom: ['total_treatment_revenue', 'patients_treated'],
    unit: 'currency',
    synonyms: [
      'revenue per patient', 'average revenue per patient', 'per patient',
      'patient value', 'average spend', 'average patient value', 'yield per patient',
    ],
    examples: [
      'what is our average revenue per patient',
      'revenue per patient this month',
    ],
  },
];

const BY_ID = Object.fromEntries(KPIS.map(k => [k.id, k]));

/**
 * Assemble the full filter list for a KPI given org + resolved date range +
 * optional location scope. This is what gets handed verbatim to aiAggregate.
 */
function buildFilters(kpi, { organizationId, from, to, locationIds = null }) {
  const filters = [
    { column: 'organization_id', operator: 'eq', value: organizationId },
  ];
  if (kpi.dateColumn) {
    filters.push({ column: kpi.dateColumn, operator: 'gte', value: from });
    filters.push({ column: kpi.dateColumn, operator: 'lte', value: `${to}T23:59:59` });
  }
  for (const f of kpi.baseFilters || []) filters.push({ ...f });
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    filters.push({ column: 'location_id', operator: 'in', value: locationIds });
  }
  return filters;
}

module.exports = { KPIS, BY_ID, buildFilters, COMPLETED_TPI_FILTERS };
