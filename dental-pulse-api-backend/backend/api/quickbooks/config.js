/**
 * Configuration for all syncable QuickBooks Online entities.
 *
 * Mirrors backend/api/xero/config.js. Each entity maps to:
 *   alias      — used as entity_alias in sync_jobs
 *   table      — primary target quickbooks_* table
 *   priority   — sync order (lower first; CoA + reference data before txns)
 *   dateFilter — 'none' (reference data) | 'date_range' (filter on TxnDate)
 *   kind       — 'query'  → QBO query API (SELECT * FROM <qbEntity>)
 *                'report' → QBO Reports API (ProfitAndLoss)
 *   qbEntity   — QBO entity name for the query API
 *
 * All target tables are QuickBooks-dedicated (migration
 * 20260519000001_quickbooks_dedicated_tables.sql) — QBO data never shares
 * the platform_* / xero_* / iplicit_* tables.
 */

const ENTITIES = [
  // Reference data first (no date filter) — txn syncs reference these.
  { alias: 'quickbooks_chart_of_accounts', table: 'quickbooks_chart_of_accounts', priority: 0,  dateFilter: 'none',       kind: 'query',  qbEntity: 'Account'  },
  { alias: 'quickbooks_vendors',           table: 'quickbooks_vendors',           priority: 1,  dateFilter: 'none',       kind: 'query',  qbEntity: 'Vendor'   },
  { alias: 'quickbooks_customers',         table: 'quickbooks_customers',         priority: 2,  dateFilter: 'none',       kind: 'query',  qbEntity: 'Customer' },
  { alias: 'quickbooks_items',             table: 'quickbooks_items',             priority: 3,  dateFilter: 'none',       kind: 'query',  qbEntity: 'Item'     },

  // Transactional entities (filtered on TxnDate).
  { alias: 'quickbooks_invoices',          table: 'quickbooks_invoices',          priority: 10, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Invoice'      },
  { alias: 'quickbooks_bills',             table: 'quickbooks_bills',             priority: 11, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Bill'         },
  { alias: 'quickbooks_journal_entries',   table: 'quickbooks_journal_entries',   priority: 12, dateFilter: 'date_range', kind: 'query',  qbEntity: 'JournalEntry' },
  { alias: 'quickbooks_purchases',         table: 'quickbooks_purchases',         priority: 13, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Purchase'     },
  { alias: 'quickbooks_payments',          table: 'quickbooks_payments',          priority: 14, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Payment'      },
  { alias: 'quickbooks_bill_payments',     table: 'quickbooks_bill_payments',     priority: 15, dateFilter: 'date_range', kind: 'query',  qbEntity: 'BillPayment'  },
  { alias: 'quickbooks_credit_memos',      table: 'quickbooks_credit_memos',      priority: 16, dateFilter: 'date_range', kind: 'query',  qbEntity: 'CreditMemo'   },
  { alias: 'quickbooks_vendor_credits',    table: 'quickbooks_vendor_credits',    priority: 17, dateFilter: 'date_range', kind: 'query',  qbEntity: 'VendorCredit' },
  { alias: 'quickbooks_deposits',          table: 'quickbooks_deposits',          priority: 18, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Deposit'      },
  { alias: 'quickbooks_transfers',         table: 'quickbooks_transfers',         priority: 19, dateFilter: 'date_range', kind: 'query',  qbEntity: 'Transfer'     },

  // Reports last (built from the synced ledger).
  { alias: 'quickbooks_profit_loss',       table: 'quickbooks_profit_loss',       priority: 30, dateFilter: 'date_range', kind: 'report', qbEntity: 'ProfitAndLoss' },
];

const ENTITY_BY_ALIAS = {};
const TABLE_MAP        = {};
for (const e of ENTITIES) {
  ENTITY_BY_ALIAS[e.alias] = e;
  TABLE_MAP[e.alias]       = e.table;
}

module.exports = { ENTITIES, ENTITY_BY_ALIAS, TABLE_MAP };
