const allowList = require('./tableAllowList');

/**
 * SQL-safe, JS-side aggregation layer for the Conversational BI pipeline.
 *
 * This is the only place BI queries touch the database. Every request is
 * validated against tableAllowList.js before a row is fetched, so a
 * hallucinated/injected table/column/operator cannot reach Supabase. Rows are
 * fetched with cursor pagination (Supabase silently caps at ~1000) and
 * aggregated in JS — matching the existing hybrid pattern in dataResolver.js.
 *
 * Read-only by design: there is no insert/update/delete path here.
 */

const PAGE_SIZE = 1000;

// Stable cursor (primary-key) column per allow-listed table — required for
// keyset pagination past Supabase's ~1000-row cap.
const CURSOR_COLUMN = {
  treatment_plan_items: 'tpi_id',
  patients: 'id',
  practice_locations: 'id',
};

function applyFilter(query, f) {
  switch (f.operator) {
    case 'eq': return query.eq(f.column, f.value);
    case 'neq': return query.neq(f.column, f.value);
    case 'gt': return query.gt(f.column, f.value);
    case 'gte': return query.gte(f.column, f.value);
    case 'lt': return query.lt(f.column, f.value);
    case 'lte': return query.lte(f.column, f.value);
    case 'in': return query.in(f.column, Array.isArray(f.value) ? f.value : [f.value]);
    case 'not_in': return query.not(f.column, 'in', `(${(Array.isArray(f.value) ? f.value : [f.value]).join(',')})`);
    case 'is_null': return query.is(f.column, null);
    case 'not_null': return query.not(f.column, 'is', null);
    default:
      // Unreachable — assertQueryShape already rejected unknown operators.
      throw new Error(`[BI-SAFETY] unhandled operator: ${f.operator}`);
  }
}

/**
 * Fetch every row matching the filters, paginated on the table's cursor column.
 * Returns the raw rows (only the projected columns).
 */
async function fetchRows({ table, columns, filters }) {
  // Lazy-require so the pure aggregation core (aggregateRows) stays loadable
  // without Supabase env vars — keeps __test__/bi.test.js DB-free.
  const { supabaseAdmin } = require('../../../config/supabase');
  const cursorCol = CURSOR_COLUMN[table];
  // cursor column must be in the projection so we can paginate on it.
  const projection = Array.from(new Set([cursorCol, ...columns])).join(', ');

  const out = [];
  let cursor = null;
  // Hard ceiling so a pathological query can't fetch the whole table.
  const MAX_ROWS = 200_000;

  while (out.length < MAX_ROWS) {
    let q = supabaseAdmin.from(table).select(projection).order(cursorCol).limit(PAGE_SIZE);
    for (const f of filters) q = applyFilter(q, f);
    if (cursor != null) q = q.gt(cursorCol, cursor);

    const { data: page, error } = await q;
    if (error) throw error;
    if (!page || page.length === 0) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1][cursorCol];
  }
  return out;
}

// Bucket a date/timestamp value to day | month | year for time-series group-by.
function formatDateBucket(value, dateFormat) {
  if (value == null) return null;
  const s = String(value);
  // ISO-ish: YYYY-MM-DD[...]. Slice rather than Date-parse to avoid TZ drift.
  if (dateFormat === 'year') return s.slice(0, 4);
  if (dateFormat === 'month') return s.slice(0, 7);
  return s.slice(0, 10); // day
}

function numeric(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * aiAggregate — the workhorse.
 *
 * @param {object} spec
 * @param {string} spec.table          allow-listed table
 * @param {Array}  spec.filters        [{ column, operator, value }]
 * @param {string} [spec.method]       'count' | 'count_distinct' | 'sum' | 'avg'
 * @param {string} [spec.valueCol]     numeric column for sum/avg
 * @param {string} [spec.distinctCol]  column for count_distinct
 * @param {string} [spec.groupBy]      column to group by (optionally date-bucketed)
 * @param {string} [spec.dateFormat]   'day' | 'month' | 'year' (applied to groupBy)
 * @param {string} [spec.sort]         'asc' | 'desc' (by aggregated value)
 * @param {number} [spec.topN]         keep only the first N groups after sort
 * @param {boolean}[spec.excludeCharting] drop charting nomenclature rows (TPI revenue)
 * @returns {Promise<{ total:number, rows:Array<{key:string,value:number,count:number}> }>}
 */
/**
 * Pure in-memory aggregation — fetched rows in, { total, rows } out. Extracted
 * so the math is unit-testable without a DB (see __test__/bi.test.js).
 */
function aggregateRows(rows, spec) {
  const {
    method = 'sum',
    valueCol = null,
    distinctCol = null,
    groupBy = null,
    dateFormat = null,
    sort = 'desc',
    topN = null,
    excludeCharting = false,
  } = spec || {};

  let work = rows;
  if (excludeCharting) {
    work = work.filter(r => !allowList.CHARTING_NOMENCLATURES.has(String(r.tpi_patient_nomenclature || '').trim()));
  }

  // Build groups. No groupBy → a single synthetic "all" bucket.
  const groups = new Map(); // key -> { sum, count, distinct:Set }
  for (const r of work) {
    let key = '__all__';
    if (groupBy) {
      key = dateFormat ? formatDateBucket(r[groupBy], dateFormat) : r[groupBy];
      if (key == null) key = '(none)';
      key = String(key);
    }
    let g = groups.get(key);
    if (!g) { g = { sum: 0, count: 0, distinct: new Set() }; groups.set(key, g); }
    g.count += 1;
    if (valueCol) g.sum += numeric(r[valueCol]);
    if (distinctCol && r[distinctCol] != null) g.distinct.add(r[distinctCol]);
  }

  const aggOf = (g) => {
    switch (method) {
      case 'count': return g.count;
      case 'count_distinct': return g.distinct.size;
      case 'avg': return g.count > 0 ? g.sum / g.count : 0;
      case 'sum':
      default: return g.sum;
    }
  };

  let resultRows = Array.from(groups.entries()).map(([key, g]) => ({
    key,
    value: aggOf(g),
    count: g.count,
  }));

  // Time buckets sort chronologically by key; everything else by value.
  if (groupBy && dateFormat) {
    resultRows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } else {
    resultRows.sort((a, b) => (sort === 'asc' ? a.value - b.value : b.value - a.value));
  }

  if (topN && Number.isFinite(topN) && topN > 0 && !(groupBy && dateFormat)) {
    resultRows = resultRows.slice(0, topN);
  }

  const total = resultRows.reduce((s, r) => s + r.value, 0);
  return { total, rows: resultRows };
}

async function aiAggregate(spec) {
  const {
    table,
    filters = [],
    valueCol = null,
    distinctCol = null,
    groupBy = null,
    excludeCharting = false,
  } = spec || {};

  const projection = [];
  if (valueCol) projection.push(valueCol);
  if (distinctCol) projection.push(distinctCol);
  if (groupBy) projection.push(groupBy);
  if (excludeCharting) projection.push('tpi_patient_nomenclature');

  allowList.assertQueryShape({ table, columns: projection, filters, groupBy });

  const rows = await fetchRows({ table, columns: projection, filters });
  return aggregateRows(rows, spec);
}

/**
 * aiCount — ground-truth row count for a filter set. Used by insight
 * verification ("does the aggregated total reconcile with a plain COUNT?").
 */
async function aiCount({ table, filters = [], excludeCharting = false }) {
  const columns = excludeCharting ? ['tpi_patient_nomenclature'] : [];
  allowList.assertQueryShape({ table, columns, filters });
  let rows = await fetchRows({ table, columns, filters });
  if (excludeCharting) {
    rows = rows.filter(r => !allowList.CHARTING_NOMENCLATURES.has(String(r.tpi_patient_nomenclature || '').trim()));
  }
  return rows.length;
}

module.exports = { aiAggregate, aiCount, aggregateRows, formatDateBucket };
