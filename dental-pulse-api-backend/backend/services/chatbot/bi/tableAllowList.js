/**
 * Central security boundary for the Conversational BI aggregator.
 *
 * The LLM never chooses tables or columns directly — it resolves a canonical
 * KPI from kpiRegistry.js, and that registry may only reference identifiers
 * declared here. safeAggregator.js validates every table/column/operator
 * against this file and throws on any violation, so a hallucinated or injected
 * identifier can never reach Supabase.
 *
 * Scope is deliberately narrow for v1: the three tables whose schema is
 * well-understood and whose numbers are auditable. Widening the BI surface
 * means adding a table here AND adding KPIs in kpiRegistry.js — never one
 * without the other.
 */

// Only these comparison operators may appear in a KPI filter. No raw SQL,
// no LIKE/regex, no boolean expressions — keeps the filter surface trivially safe.
const ALLOWED_OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'not_null',
]);

// table -> Set(column). A column is queryable/filterable/groupable only if it
// appears here. Every column listed is one the v1 KPIs actually use.
const TABLES = {
  treatment_plan_items: new Set([
    'organization_id',
    'tpi_id',
    'tpi_price',
    'tpi_completed',
    'tpi_completed_at',
    'tpi_payment_plan_id',
    'tpi_patient_id',
    'tpi_provider_id',
    'tpi_treatment_id',
    'tpi_patient_nomenclature',
    'location_id',
  ]),
  patients: new Set([
    'organization_id',
    'id',
    'legacy_id',
    'location_id',
    'created_at',
  ]),
  practice_locations: new Set([
    'organization_id',
    'id',
    'location_name',
    'deleted_at',
  ]),
};

// Charting/odontogram nomenclatures are tooth-status records, NOT clinical
// procedures. Dentally's Practitioner Activity report excludes them and ~56%
// of TPI rows are charting — including them overstates revenue massively.
// Revenue/count KPIs on treatment_plan_items apply this exclusion.
const CHARTING_NOMENCLATURES = new Set([
  'Missing', 'Missing Tooth', 'Caries', 'Unerupted', 'Watch',
  'Fractured', 'Root', 'Partially Erupted', 'Impacted', 'Sound',
]);

const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

function isAllowedTable(table) {
  return typeof table === 'string' && Object.prototype.hasOwnProperty.call(TABLES, table);
}

function isAllowedColumn(table, column) {
  if (!isAllowedTable(table)) return false;
  if (typeof column !== 'string' || !SAFE_IDENTIFIER_RE.test(column)) return false;
  return TABLES[table].has(column);
}

function isAllowedOperator(op) {
  return ALLOWED_OPERATORS.has(op);
}

/**
 * Throws a descriptive Error if any part of an aggregation request references
 * a table/column/operator that isn't allow-listed. Called by safeAggregator
 * before a single row is fetched.
 */
function assertQueryShape({ table, columns = [], filters = [], groupBy = null }) {
  if (!isAllowedTable(table)) {
    throw new Error(`[BI-SAFETY] table not allow-listed: ${JSON.stringify(table)}`);
  }
  for (const col of columns) {
    if (!isAllowedColumn(table, col)) {
      throw new Error(`[BI-SAFETY] column not allow-listed: ${table}.${col}`);
    }
  }
  if (groupBy != null && !isAllowedColumn(table, groupBy)) {
    throw new Error(`[BI-SAFETY] groupBy column not allow-listed: ${table}.${groupBy}`);
  }
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') {
      throw new Error('[BI-SAFETY] malformed filter');
    }
    if (!isAllowedColumn(table, f.column)) {
      throw new Error(`[BI-SAFETY] filter column not allow-listed: ${table}.${f.column}`);
    }
    if (!isAllowedOperator(f.operator)) {
      throw new Error(`[BI-SAFETY] filter operator not allow-listed: ${JSON.stringify(f.operator)}`);
    }
  }
}

module.exports = {
  TABLES,
  ALLOWED_OPERATORS,
  CHARTING_NOMENCLATURES,
  isAllowedTable,
  isAllowedColumn,
  isAllowedOperator,
  assertQueryShape,
};
