/**
 * Stable Supabase/PostgREST offset pagination.
 *
 * PostgREST .range() without ORDER BY returns a non-deterministic row subset,
 * so aggregated £/counts drift between reloads. Always order before .range().
 */

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 500;

/** @type {Record<string, string[]>} */
const TABLE_ORDER = {
  event_ledger: ['created_at', 'id'],
  patients: ['id'],
  payment_plans: ['pp_id'],
  pe_patient_contribution_facts: ['patient_id'],
  v_pe_retention_segment: ['patient_id'],
  v_patient_contribution: ['patient_id'],
  pe_invoice_contribution_facts: ['invoice_id'],
  v_invoice_contribution: ['invoice_id'],
  patient_economics_modelled_scores: ['patient_id'],
  appointments: ['apmt_start_time', 'id'],
  providers: ['id'],
  pe_reactivation_flags: ['id'],
};

const DEFAULT_ORDER = ['id'];

/**
 * @param {string | string[] | Array<{ column: string, ascending?: boolean }>} orderSpec
 * @returns {Array<{ column: string, ascending: boolean }>}
 */
function normalizeOrderSpec(orderSpec) {
  if (Array.isArray(orderSpec)) {
    if (orderSpec.length === 0) {
      return DEFAULT_ORDER.map((column) => ({ column, ascending: true }));
    }
    if (typeof orderSpec[0] === 'string') {
      return orderSpec.map((column) => ({ column, ascending: true }));
    }
    return orderSpec.map((spec) => ({
      column: spec.column,
      ascending: spec.ascending !== false,
    }));
  }

  const cols = TABLE_ORDER[orderSpec] ?? DEFAULT_ORDER;
  return cols.map((column) => ({ column, ascending: true }));
}

/**
 * @param {import('@supabase/supabase-js').PostgrestFilterBuilder} query
 * @param {string | string[] | Array<{ column: string, ascending?: boolean }>} orderSpec
 */
function withStableOrder(query, orderSpec = DEFAULT_ORDER) {
  let q = query;
  for (const { column, ascending } of normalizeOrderSpec(orderSpec)) {
    q = q.order(column, { ascending });
  }
  return q;
}

/**
 * @param {() => import('@supabase/supabase-js').PostgrestFilterBuilder} buildQuery
 * @param {{
 *   orderBy?: string | string[] | Array<{ column: string, ascending?: boolean }>,
 *   pageSize?: number,
 *   maxPages?: number,
 * }} [options]
 */
async function paginateAll(buildQuery, options = {}) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const rows = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    let query = buildQuery();
    query = withStableOrder(query, options.orderBy ?? DEFAULT_ORDER);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
  TABLE_ORDER,
  DEFAULT_ORDER,
  normalizeOrderSpec,
  withStableOrder,
  paginateAll,
};
