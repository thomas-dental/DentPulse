/**
 * Configuration for all syncable Xero entities.
 *
 * Each entity maps to:
 *   alias      — used as entity_alias in sync_jobs
 *   table      — target Supabase table (primary one — processors may write to more)
 *   priority   — sync order (lower = synced first)
 *   dateFilter — one of 'none' | 'date_range' | 'if_modified_since'
 *
 * Progressive watermark (see queue/xero/syncWindow.js):
 *   - First sync: INITIAL_LOOKBACK_MONTHS (or configured xero_start_date)
 *   - Later syncs: last_synced_at − INCREMENTAL_OVERLAP_DAYS
 *
 * dateFilter 'none' = reference catalogs (Chart of Accounts, Tracking Categories).
 * These have no date window and MUST be queued on the initial full sync as well
 * as every progressive run — location mapping depends on tracking options being
 * present from the first download, not only after a later incremental sync.
 *
 * All target tables are Xero-dedicated (separated from shared platform_*
 * tables in migration 20260423000002_xero_dedicated_tables.sql).
 */

/** Default historical lookback for the first Xero sync (~1.5 years). */
const INITIAL_LOOKBACK_MONTHS = 18;

/** Days re-pulled on incremental syncs to catch late/backdated edits. */
const INCREMENTAL_OVERLAP_DAYS = 3;

const ENTITIES = [
  {
    alias:      'xero_chart_of_accounts',
    table:      'xero_chart_of_accounts',
    priority:   0,
    dateFilter: 'none',
  },
  {
    alias:      'xero_tracking_categories',
    table:      'xero_tracking_categories',
    priority:   1,
    dateFilter: 'none',
  },
  {
    alias:      'xero_invoices',
    table:      'xero_invoices',
    priority:   2,
    dateFilter: 'if_modified_since',
  },
  {
    alias:      'xero_bank_transactions',
    table:      'xero_bank_transactions',
    priority:   3,
    dateFilter: 'if_modified_since',
  },
  {
    alias:      'xero_credit_notes',
    table:      'xero_credit_notes',
    priority:   4,
    dateFilter: 'if_modified_since',
  },
  {
    alias:      'xero_overpayments',
    table:      'xero_overpayments',
    priority:   5,
    dateFilter: 'if_modified_since',
  },
  {
    alias:      'xero_journals',
    table:      'xero_journals',
    priority:   6,
    dateFilter: 'if_modified_since',
  },
  {
    alias:      'xero_profit_loss',
    table:      'xero_profit_loss',
    priority:   7,
    dateFilter: 'date_range',
  },
  {
    alias:      'xero_balance_sheet',
    table:      'xero_balance_sheet',
    priority:   8,
    dateFilter: 'date_range',
  },
];

const ENTITY_BY_ALIAS = {};
const TABLE_MAP        = {};
for (const e of ENTITIES) {
  ENTITY_BY_ALIAS[e.alias] = e;
  TABLE_MAP[e.alias]        = e.table;
}

/** Reference catalogs with no date window — always included in full/initial sync. */
const REFERENCE_ENTITIES = ENTITIES.filter(e => e.dateFilter === 'none');

function entitiesForFullSync() {
  return [...ENTITIES].sort((a, b) => a.priority - b.priority);
}

module.exports = {
  ENTITIES,
  REFERENCE_ENTITIES,
  ENTITY_BY_ALIAS,
  TABLE_MAP,
  INITIAL_LOOKBACK_MONTHS,
  INCREMENTAL_OVERLAP_DAYS,
  entitiesForFullSync,
};
