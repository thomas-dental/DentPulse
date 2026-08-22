/**
 * QuickBooks Online sync processor — processes a single sync job.
 *
 * Mirrors backend/queue/xero/processor.js. Pulls each configured QBO entity
 * via the query API (or the ProfitAndLoss report) and upserts into the
 * dedicated quickbooks_* tables. Every row keeps the full QBO object in
 * raw_data so nothing the API returns is lost and downstream (Phase-3)
 * mapping can always re-derive from the source payload.
 *
 * Phase-2 scope only: this writes raw QBO data. No EBITDA / P&L / cost-bucket
 * resolver reads these tables yet (that wiring is reconciliation-gated).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  getOrRefreshToken,
  refreshAccessToken,
  queryAll,
  getProfitAndLossReport,
} = require('../../api/quickbooks/client');
const { ENTITY_BY_ALIAS } = require('../../api/quickbooks/config');
const { sleep }  = require('../../utils/helpers');
const logger     = require('../../services/sync/logger');

const BATCH_SIZE = 500;

// ── Helpers ────────────────────────────────────────────────────────────────

/** QBO TxnDate / DueDate are 'YYYY-MM-DD' strings. */
function qbDate(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

/** QBO MetaData.CreateTime / LastUpdatedTime are ISO-8601. */
function qbDateTime(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ref(o) { return (o && o.value) ? String(o.value) : null; }
function refName(o) { return (o && o.name) ? String(o.name) : null; }

/**
 * Per-transaction line ordinal used as the 4th part of every line table's
 * upsert key (…, line_num). QBO Invoice and Bill lines carry a `LineNum`, but
 * Purchase and JournalEntry lines do NOT — they only have a line-level `Id`
 * (a small per-transaction integer: "0", "1", …). Without this fallback the
 * `if (lr.line_num == null) continue` guard in syncQueryEntity silently drops
 * every Purchase and JournalEntry line (→ 0 rows in those line tables).
 */
function lineOrdinal(l) {
  const raw = (l && l.LineNum != null) ? l.LineNum
            : (l && l.Id != null)      ? l.Id
            : null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the QBO company rows (realmId + company UUID) for the integration.
 * QuickBooks connects exactly one company per integration, but we loop for
 * parity with the multi-tenant Xero pattern.
 */
async function loadQuickBooksCompanies(organizationId, integrationId) {
  const { data, error } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integrationId)
    .eq('platform_name', 'quickbooks')
    .eq('status', 'active');
  if (error) throw new Error(`Failed to fetch QuickBooks companies: ${error.message}`);
  return data || [];
}

/**
 * QuickBooks company (platform_integration_organizations.id) → practice location_id,
 * from the Practice Location Mapping. Lets us stamp quickbooks_invoices with the
 * location of the company they came from. Empty Map on error (never fail the sync).
 */
async function loadCompanyLocationMap(organizationId) {
  const map = new Map();
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id, location_id')
      .eq('organization_id', organizationId);
    if (error) {
      console.warn(`[QuickBooksProcessor] Could not load company→location map: ${error.message}`);
      return map;
    }
    for (const row of data || []) {
      if (row.platform_integration_organizations_id && row.location_id) {
        map.set(String(row.platform_integration_organizations_id), String(row.location_id));
      }
    }
  } catch (e) {
    console.warn(`[QuickBooksProcessor] Could not load company→location map: ${e.message}`);
  }
  return map;
}

/** Upsert in batches with per-row fallback; returns {processed, failed} and
 *  (optionally) the inserted id-by-key map for FK-ing child line tables. */
async function upsertBatch(table, rows, onConflict, selectKey = null) {
  let processed = 0;
  let failed    = 0;
  const idByKey = new Map();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    let q = supabaseAdmin.from(table).upsert(chunk, { onConflict, ignoreDuplicates: false });
    if (selectKey) q = q.select(`id, ${selectKey}`);
    const { data, error } = await q;

    if (!error) {
      processed += chunk.length;
      if (selectKey && data) data.forEach(r => idByKey.set(r[selectKey], r.id));
      continue;
    }

    console.warn(`[QuickBooksProcessor] ${table} batch failed (${error.message}); row retry`);
    for (const single of chunk) {
      let rq = supabaseAdmin.from(table).upsert(single, { onConflict, ignoreDuplicates: false });
      if (selectKey) rq = rq.select(`id, ${selectKey}`);
      const { data: ins, error: rowErr } = await rq;
      if (rowErr) {
        failed += 1;
        console.error(`[QuickBooksProcessor] ${table} row failed: ${rowErr.message}`);
      } else {
        processed += 1;
        if (selectKey && ins) ins.forEach(r => idByKey.set(r[selectKey], r.id));
      }
    }
  }

  return { processed, failed, idByKey };
}

// ── Per-entity header mappers (QBO object → table row) ──────────────────────

// Columns common to EVERY quickbooks_* table. currency/exchange_rate are NOT
// here — reference tables (chart_of_accounts/vendors/customers/items) have
// neither, and chart_of_accounts/transfers have currency but no exchange_rate.
// Those are added per-mapper via money()/currencyOnly() to match each schema.
function baseCols(o, ctx) {
  return {
    organization_id:         ctx.organizationId,
    platform_integration_id: ctx.integrationId,
    quickbooks_company_id:   ctx.companyUuid,
    user_id:                 ctx.userId,
    realm_id:                ctx.realmId,
    sync_token:              o.SyncToken != null ? String(o.SyncToken) : null,
    qb_created_at:           qbDateTime(o.MetaData && o.MetaData.CreateTime),
    qb_updated_at:           qbDateTime(o.MetaData && o.MetaData.LastUpdatedTime),
    raw_data:                o,
    last_synced_at:          new Date().toISOString(),
  };
}

// Transactional tables with both currency + exchange_rate columns.
function money(o) {
  return { currency: ref(o.CurrencyRef), exchange_rate: num(o.ExchangeRate) };
}
// chart_of_accounts / transfers have currency but no exchange_rate.
function currencyOnly(o) {
  return { currency: ref(o.CurrencyRef) };
}

const HEADER_MAPPERS = {
  Account: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...currencyOnly(o),
    qb_account_id:                     String(o.Id),
    account_name:                      o.Name || null,
    fully_qualified_name:              o.FullyQualifiedName || null,
    account_number:                    o.AcctNum || null,
    account_type:                      o.AccountType || null,
    account_sub_type:                  o.AccountSubType || null,
    classification:                    o.Classification || null,
    description:                       o.Description || null,
    current_balance:                   num(o.CurrentBalance),
    current_balance_with_sub_accounts: num(o.CurrentBalanceWithSubAccounts),
    is_active:                         o.Active !== false,
    is_sub_account:                    o.SubAccount === true,
    parent_account_id:                 ref(o.ParentRef),
  }),
  Vendor: (o, ctx) => ({
    ...baseCols(o, ctx),
    qb_vendor_id: String(o.Id),
    display_name: o.DisplayName || null,
    company_name: o.CompanyName || null,
    email:        o.PrimaryEmailAddr ? o.PrimaryEmailAddr.Address : null,
    phone:        o.PrimaryPhone ? o.PrimaryPhone.FreeFormNumber : null,
    balance:      num(o.Balance),
    is_active:    o.Active !== false,
    is_1099:      o.Vendor1099 === true,
  }),
  Customer: (o, ctx) => ({
    ...baseCols(o, ctx),
    qb_customer_id: String(o.Id),
    display_name:   o.DisplayName || null,
    company_name:   o.CompanyName || null,
    email:          o.PrimaryEmailAddr ? o.PrimaryEmailAddr.Address : null,
    phone:          o.PrimaryPhone ? o.PrimaryPhone.FreeFormNumber : null,
    balance:        num(o.Balance),
    is_active:      o.Active !== false,
  }),
  Item: (o, ctx) => ({
    ...baseCols(o, ctx),
    qb_item_id:           String(o.Id),
    name:                 o.Name || null,
    fully_qualified_name: o.FullyQualifiedName || null,
    item_type:            o.Type || null,
    description:          o.Description || null,
    unit_price:           num(o.UnitPrice),
    purchase_cost:        num(o.PurchaseCost),
    income_account_id:    ref(o.IncomeAccountRef),
    expense_account_id:   ref(o.ExpenseAccountRef),
    asset_account_id:     ref(o.AssetAccountRef),
    is_active:            o.Active !== false,
  }),
  Invoice: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    location_id:   ctx.locationId || null, // quickbooks_invoices is the only QB table with this column
    qb_invoice_id: String(o.Id),
    doc_number:    o.DocNumber || null,
    txn_date:      qbDate(o.TxnDate),
    due_date:      qbDate(o.DueDate),
    customer_id:   ref(o.CustomerRef),
    customer_name: refName(o.CustomerRef),
    customer_memo: o.CustomerMemo ? o.CustomerMemo.value : null,
    private_note:  o.PrivateNote || null,
    total_amount:  num(o.TotalAmt),
    total_tax:     o.TxnTaxDetail ? num(o.TxnTaxDetail.TotalTax) : null,
    balance:       num(o.Balance),
    is_paid:       num(o.Balance) === 0,
    email_status:  o.EmailStatus || null,
  }),
  Bill: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_bill_id:    String(o.Id),
    doc_number:    o.DocNumber || null,
    txn_date:      qbDate(o.TxnDate),
    due_date:      qbDate(o.DueDate),
    vendor_id:     ref(o.VendorRef),
    vendor_name:   refName(o.VendorRef),
    ap_account_id: ref(o.APAccountRef),
    private_note:  o.PrivateNote || null,
    total_amount:  num(o.TotalAmt),
    balance:       num(o.Balance),
    is_paid:       num(o.Balance) === 0,
  }),
  JournalEntry: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_journal_entry_id: String(o.Id),
    doc_number:          o.DocNumber || null,
    txn_date:            qbDate(o.TxnDate),
    private_note:        o.PrivateNote || null,
    total_amount:        num(o.TotalAmt),
    is_adjustment:       o.Adjustment === true,
  }),
  Purchase: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_purchase_id: String(o.Id),
    doc_number:     o.DocNumber || null,
    txn_date:       qbDate(o.TxnDate),
    payment_type:   o.PaymentType || null,
    account_id:     ref(o.AccountRef),
    entity_id:      ref(o.EntityRef),
    entity_name:    refName(o.EntityRef),
    private_note:   o.PrivateNote || null,
    total_amount:   num(o.TotalAmt),
    is_credit:      o.Credit === true,
  }),
  Payment: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_payment_id:      String(o.Id),
    txn_date:           qbDate(o.TxnDate),
    customer_id:        ref(o.CustomerRef),
    customer_name:      refName(o.CustomerRef),
    deposit_account_id: ref(o.DepositToAccountRef),
    total_amount:       num(o.TotalAmt),
    unapplied_amount:   num(o.UnappliedAmt),
    payment_ref_num:    o.PaymentRefNum || null,
  }),
  BillPayment: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_bill_payment_id: String(o.Id),
    doc_number:         o.DocNumber || null,
    txn_date:           qbDate(o.TxnDate),
    vendor_id:          ref(o.VendorRef),
    vendor_name:        refName(o.VendorRef),
    pay_type:           o.PayType || null,
    bank_account_id:    o.CheckPayment ? ref(o.CheckPayment.BankAccountRef) : null,
    cc_account_id:      o.CreditCardPayment ? ref(o.CreditCardPayment.CCAccountRef) : null,
    total_amount:       num(o.TotalAmt),
    private_note:       o.PrivateNote || null,
  }),
  CreditMemo: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_credit_memo_id: String(o.Id),
    doc_number:        o.DocNumber || null,
    txn_date:          qbDate(o.TxnDate),
    customer_id:       ref(o.CustomerRef),
    customer_name:     refName(o.CustomerRef),
    total_amount:      num(o.TotalAmt),
    total_tax:         o.TxnTaxDetail ? num(o.TxnTaxDetail.TotalTax) : null,
    balance:           num(o.Balance),
    remaining_credit:  num(o.RemainingCredit),
    private_note:      o.PrivateNote || null,
  }),
  VendorCredit: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_vendor_credit_id: String(o.Id),
    doc_number:          o.DocNumber || null,
    txn_date:            qbDate(o.TxnDate),
    vendor_id:           ref(o.VendorRef),
    vendor_name:         refName(o.VendorRef),
    ap_account_id:       ref(o.APAccountRef),
    total_amount:        num(o.TotalAmt),
    private_note:        o.PrivateNote || null,
  }),
  Deposit: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...money(o),
    qb_deposit_id:         String(o.Id),
    txn_date:              qbDate(o.TxnDate),
    deposit_to_account_id: ref(o.DepositToAccountRef),
    total_amount:          num(o.TotalAmt),
    private_note:          o.PrivateNote || null,
  }),
  Transfer: (o, ctx) => ({
    ...baseCols(o, ctx),
    ...currencyOnly(o),
    qb_transfer_id:  String(o.Id),
    txn_date:        qbDate(o.TxnDate),
    from_account_id: ref(o.FromAccountRef),
    to_account_id:   ref(o.ToAccountRef),
    amount:          num(o.Amount),
    private_note:    o.PrivateNote || null,
  }),
};

// ── Line mappers for header+line entities ──────────────────────────────────
// Returns the child-table name, the parent-id column, the qb-id column, and a
// function mapping (parentRow, parentUuid) → array of line rows.

const LINE_SPECS = {
  Invoice: {
    table: 'quickbooks_invoice_line_items',
    parentCol: 'invoice_id',
    qbIdCol: 'qb_invoice_id',
    map: (o, ctx) => (o.Line || [])
      .filter(l => l.DetailType && l.DetailType !== 'SubTotalLineDetail')
      .map(l => {
        const d = l.SalesItemLineDetail || {};
        return {
          organization_id: ctx.organizationId,
          realm_id:        ctx.realmId,
          qb_invoice_id:   String(o.Id),
          line_num:        lineOrdinal(l),
          line_id:         l.Id != null ? String(l.Id) : null,
          detail_type:     l.DetailType || null,
          description:     l.Description || null,
          amount:          num(l.Amount),
          quantity:        num(d.Qty),
          unit_price:      num(d.UnitPrice),
          item_id:         ref(d.ItemRef),
          item_name:       refName(d.ItemRef),
          income_account_id: ref(d.ItemAccountRef),
          tax_code:        d.TaxCodeRef ? ref(d.TaxCodeRef) : null,
          raw_data:        l,
        };
      }),
  },
  Bill: {
    table: 'quickbooks_bill_line_items',
    parentCol: 'bill_id',
    qbIdCol: 'qb_bill_id',
    map: (o, ctx) => (o.Line || [])
      .filter(l => l.DetailType && l.DetailType !== 'SubTotalLineDetail')
      .map(l => {
        const a = l.AccountBasedExpenseLineDetail || {};
        const it = l.ItemBasedExpenseLineDetail || {};
        return {
          organization_id: ctx.organizationId,
          realm_id:        ctx.realmId,
          qb_bill_id:      String(o.Id),
          line_num:        lineOrdinal(l),
          line_id:         l.Id != null ? String(l.Id) : null,
          detail_type:     l.DetailType || null,
          description:     l.Description || null,
          amount:          num(l.Amount),
          account_id:      ref(a.AccountRef),
          item_id:         ref(it.ItemRef),
          customer_id:     ref(a.CustomerRef || it.CustomerRef),
          billable_status: a.BillableStatus || it.BillableStatus || null,
          tax_code:        ref(a.TaxCodeRef || it.TaxCodeRef),
          raw_data:        l,
        };
      }),
  },
  Purchase: {
    table: 'quickbooks_purchase_line_items',
    parentCol: 'purchase_id',
    qbIdCol: 'qb_purchase_id',
    map: (o, ctx) => (o.Line || [])
      .filter(l => l.DetailType && l.DetailType !== 'SubTotalLineDetail')
      .map(l => {
        const a = l.AccountBasedExpenseLineDetail || {};
        const it = l.ItemBasedExpenseLineDetail || {};
        return {
          organization_id: ctx.organizationId,
          realm_id:        ctx.realmId,
          qb_purchase_id:  String(o.Id),
          line_num:        lineOrdinal(l),
          line_id:         l.Id != null ? String(l.Id) : null,
          detail_type:     l.DetailType || null,
          description:     l.Description || null,
          amount:          num(l.Amount),
          account_id:      ref(a.AccountRef),
          item_id:         ref(it.ItemRef),
          customer_id:     ref(a.CustomerRef || it.CustomerRef),
          billable_status: a.BillableStatus || it.BillableStatus || null,
          tax_code:        ref(a.TaxCodeRef || it.TaxCodeRef),
          raw_data:        l,
        };
      }),
  },
  JournalEntry: {
    table: 'quickbooks_journal_entry_lines',
    parentCol: 'journal_entry_id',
    qbIdCol: 'qb_journal_entry_id',
    map: (o, ctx) => (o.Line || [])
      .filter(l => l.DetailType === 'JournalEntryLineDetail')
      .map(l => {
        const d = l.JournalEntryLineDetail || {};
        return {
          organization_id:     ctx.organizationId,
          realm_id:            ctx.realmId,
          qb_journal_entry_id: String(o.Id),
          line_num:            lineOrdinal(l),
          line_id:             l.Id != null ? String(l.Id) : null,
          description:         l.Description || null,
          amount:              num(l.Amount),
          posting_type:        d.PostingType || null,
          account_id:          ref(d.AccountRef),
          account_name:        refName(d.AccountRef),
          entity_type:         d.Entity ? d.Entity.Type : null,
          entity_id:           d.Entity ? ref(d.Entity.EntityRef) : null,
          txn_date:            qbDate(o.TxnDate),
          raw_data:            l,
        };
      }),
  },
};

// ── Query-entity sync ──────────────────────────────────────────────────────

async function syncQueryEntity(job, integration, entityCfg) {
  const { organization_id: organizationId, user_id: userId } = job;
  const companies = await loadQuickBooksCompanies(organizationId, integration.id);
  if (companies.length === 0) {
    console.log(`[QuickBooksProcessor] No active QuickBooks company for org ${organizationId}`);
    return { processed: 0, failed: 0 };
  }

  const accessToken = await getOrRefreshToken(integration);
  const headerMapper = HEADER_MAPPERS[entityCfg.qbEntity];
  const lineSpec     = LINE_SPECS[entityCfg.qbEntity];
  if (!headerMapper) throw new Error(`No mapper for QBO entity ${entityCfg.qbEntity}`);

  // qb_<x>_id column name on the header table (the upsert key & FK lookup).
  const qbIdCol = Object.keys(headerMapper({ Id: '0' }, {
    organizationId, integrationId: integration.id, companyUuid: null, userId, realmId: '',
  })).find(k => k.startsWith('qb_') && k.endsWith('_id'));

  // Company → practice location, to stamp quickbooks_invoices with its location.
  const companyLocationMap = await loadCompanyLocationMap(organizationId);

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const company of companies) {
    const ctx = {
      organizationId,
      integrationId: integration.id,
      companyUuid:   company.id,
      userId,
      realmId:       company.platform_org_id,
      locationId:    companyLocationMap.get(String(company.id)) || null,
    };

    try {
      let where = null;
      if (entityCfg.dateFilter === 'date_range' && job.start_date && job.end_date) {
        const s = String(job.start_date).slice(0, 10);
        const e = String(job.end_date).slice(0, 10);
        where = `TxnDate >= '${s}' AND TxnDate <= '${e}'`;
      }

      const objects = await queryAll(accessToken, ctx.realmId, entityCfg.qbEntity, where);
      console.log(`[QuickBooksProcessor] ${company.platform_org_name || ctx.realmId}: ${entityCfg.qbEntity} → ${objects.length}`);

      if (objects.length === 0) continue;

      const headerRows = objects.map(o => headerMapper(o, ctx));
      const { processed, failed, idByKey } = await upsertBatch(
        entityCfg.table,
        headerRows,
        `organization_id,realm_id,${qbIdCol}`,
        lineSpec ? qbIdCol : null,
      );
      totalProcessed += processed;
      totalFailed    += failed;

      if (lineSpec) {
        const lineRows = [];
        for (const o of objects) {
          const parentUuid = idByKey.get(String(o.Id));
          if (!parentUuid) continue;
          for (const lr of lineSpec.map(o, ctx)) {
            if (lr.line_num == null) continue; // upsert key needs line_num
            lr[lineSpec.parentCol] = parentUuid;
            lineRows.push(lr);
          }
        }
        if (lineRows.length > 0) {
          const lineRes = await upsertBatch(
            lineSpec.table,
            lineRows,
            `organization_id,realm_id,${lineSpec.qbIdCol},line_num`,
          );
          totalFailed += lineRes.failed;
          console.log(`[QuickBooksProcessor] ${entityCfg.qbEntity} lines: ${lineRes.processed} upserted, ${lineRes.failed} failed`);
        }
      }

      await sleep(150);
    } catch (err) {
      if (err.isRateLimit || err.message === 'RATE_LIMIT_EXHAUSTED') throw err;
      // Auth failures must propagate so the outer handler can force-refresh the token.
      if (/QuickBooks .* 403/i.test(err.message) && /(ApplicationAuthorizationFailed|003100)/i.test(err.message)) throw err;
      console.error(`[QuickBooksProcessor] ${entityCfg.qbEntity} error: ${err.message}`);
      totalFailed += 1;
      errors.push(`[${company.platform_org_name || ctx.realmId}] ${err.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

// ── ProfitAndLoss report sync ──────────────────────────────────────────────

/** Read per-column {from,to} windows from the report Columns metadata. */
function buildColumnWindows(report) {
  const cols = (report && report.Columns && report.Columns.Column) || [];
  return cols.map(c => {
    const md = (c && c.MetaData) || [];
    const get = (n) => { const m = md.find(x => x.Name === n); return m ? m.Value : null; };
    const start = get('StartDate');
    const end   = get('EndDate');
    return (start && end) ? { from: start.slice(0, 10), to: end.slice(0, 10) } : null;
  });
}

/** Recursively flatten the P&L row tree into per-account-per-column amounts. */
function flattenPLRows(rowTree, windows, section, out) {
  const rows = (rowTree && rowTree.Row) || [];
  for (const r of rows) {
    // Determine the section title for this branch.
    let sec = section;
    if (r.Header && r.Header.ColData && r.Header.ColData[0] && r.Header.ColData[0].value && !section) {
      sec = r.Header.ColData[0].value;
    } else if (r.group && !section) {
      sec = r.group;
    }

    // Parent accounts with sub-accounts appear as Section rows in QBO's P&L.
    // When a parent account has direct transactions, those amounts live in the
    // Section's Header.ColData (not in a child Data row). Capture them here.
    if (r.Header && r.Header.ColData && r.Header.ColData[0] && r.Header.ColData[0].id) {
      const acct   = r.Header.ColData[0];
      const acctId = String(acct.id);
      for (let i = 1; i < r.Header.ColData.length; i++) {
        const win = windows[i];
        if (!win) continue;
        const amount = Number((r.Header.ColData[i] && r.Header.ColData[i].value) || 0);
        if (!Number.isFinite(amount)) continue;
        out.push({
          section:       sec || null,
          qb_account_id: acctId,
          account_name:  acct.value || null,
          from:          win.from,
          to:            win.to,
          amount,
        });
      }
    }

    if (r.ColData && r.type === 'Data') {
      const acct = r.ColData[0] || {};
      const acctId = acct.id ? String(acct.id) : null;
      if (acctId) {
        for (let i = 1; i < r.ColData.length; i++) {
          const win = windows[i];
          if (!win) continue; // skip Total / non-dated columns
          const amount = Number((r.ColData[i] && r.ColData[i].value) || 0);
          if (!Number.isFinite(amount)) continue;
          out.push({
            section:       sec || null,
            qb_account_id: acctId,
            account_name:  acct.value || null,
            from:          win.from,
            to:            win.to,
            amount,
          });
        }
      }
    }

    if (r.Rows) flattenPLRows(r.Rows, windows, sec, out);
  }
}

async function syncProfitLoss(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;
  const companies = await loadQuickBooksCompanies(organizationId, integration.id);
  if (companies.length === 0) return { processed: 0, failed: 0 };
  if (!job.start_date || !job.end_date) {
    return { processed: 0, failed: 0, errors: ['P&L sync needs a start/end date range'] };
  }

  const accessToken = await getOrRefreshToken(integration);
  const start = String(job.start_date).slice(0, 10);
  const end   = String(job.end_date).slice(0, 10);

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const company of companies) {
    const realmId = company.platform_org_id;
    try {
      const report  = await getProfitAndLossReport(accessToken, realmId, start, end, 'Month', 'Accrual');
      const windows = buildColumnWindows(report);
      const flat    = [];
      flattenPLRows(report.Rows, windows, null, flat);

      // Deduplicate by (qb_account_id, to_date). A parent account can appear as
      // both a Section Header (captured above) and a sibling Data row in the same
      // QBO P&L response. Later entries win so Data rows override Header rows
      // (Header is pushed before recursing into children, Data rows come after).
      const flatMap = new Map();
      for (const f of flat) flatMap.set(`${f.qb_account_id}::${f.to}`, f);
      const uniqueFlat = [...flatMap.values()];

      if (uniqueFlat.length === 0) { console.log(`[QuickBooksProcessor] P&L ${realmId}: no account rows`); continue; }

      const rows = uniqueFlat.map(f => {
        const to = new Date(f.to);
        return {
          organization_id:         organizationId,
          platform_integration_id: integration.id,
          quickbooks_company_id:   company.id,
          user_id:                 userId,
          realm_id:                realmId,
          from_date:               f.from,
          to_date:                 f.to,
          period_year:             to.getUTCFullYear(),
          period_month:            to.getUTCMonth() + 1,
          section:                 f.section,
          qb_account_id:           f.qb_account_id,
          account_name:            f.account_name,
          amount:                  f.amount,
          raw_data:                { section: f.section, account: f.account_name },
          synced_at:               new Date().toISOString(),
        };
      });

      const { processed, failed } = await upsertBatch(
        'quickbooks_profit_loss',
        rows,
        'organization_id,realm_id,qb_account_id,to_date',
      );
      totalProcessed += processed;
      totalFailed    += failed;

      // Prune stale partial-month rows. The last (current) month's column
      // uses the report end-date as to_date, so an earlier sync with a
      // shorter range wrote that month under a DIFFERENT to_date. Those rows
      // are not in `rows` (to_date is part of the upsert key) and would
      // otherwise double-count the current month in COA / Cost-Impact sums.
      // Upsert-first-then-prune means fresh data is always present — we only
      // delete rows in the just-synced from_date window whose to_date isn't
      // one we just wrote. Fully-elapsed months always get the same
      // (month-end) to_date every sync, so only the partial month is pruned.
      const freshToDates = [...new Set(rows.map(r => r.to_date))];
      const froms        = rows.map(r => r.from_date).sort();
      const { error: pruneErr } = await supabaseAdmin
        .from('quickbooks_profit_loss')
        .delete()
        .eq('organization_id', organizationId)
        .eq('realm_id', realmId)
        .gte('from_date', froms[0])
        .lte('from_date', froms[froms.length - 1])
        .not('to_date', 'in', `(${freshToDates.map(d => `"${d}"`).join(',')})`);
      if (pruneErr) {
        console.warn(`[QuickBooksProcessor] P&L ${realmId}: stale-row prune failed: ${pruneErr.message}`);
      }

      console.log(`[QuickBooksProcessor] P&L ${realmId}: ${processed} rows upserted, ${failed} failed`);
    } catch (err) {
      if (err.isRateLimit || err.message === 'RATE_LIMIT_EXHAUSTED') throw err;
      // Auth failures must propagate so the outer handler can force-refresh the token.
      if (/QuickBooks .* 403/i.test(err.message) && /(ApplicationAuthorizationFailed|003100)/i.test(err.message)) throw err;
      console.error(`[QuickBooksProcessor] P&L error: ${err.message}`);
      totalFailed += 1;
      errors.push(err.message);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

// ── Job dispatcher ─────────────────────────────────────────────────────────

async function processQuickBooksSyncJob(job, integration, cancelTokens) {
  const entityAlias = job.entity_alias;
  console.log(`[QuickBooksProcessor] Starting job ${job.id}: ${entityAlias}`);

  try {
    await logger.markRunning(job.id);
    if (cancelTokens.get(job.id)) { await logger.markCancelled(job.id); return; }

    const entityCfg = ENTITY_BY_ALIAS[entityAlias];
    if (!entityCfg) throw new Error(`Unknown QuickBooks entity alias: ${entityAlias}`);

    const result = entityCfg.kind === 'report'
      ? await syncProfitLoss(job, integration)
      : await syncQueryEntity(job, integration, entityCfg);

    if (cancelTokens.get(job.id)) { await logger.markCancelled(job.id); return; }

    await logger.markCompleted(job.id, {
      recordsProcessed: result.processed,
      recordsFailed:    result.failed,
      currentPage:      1,
      totalPages:       1,
      errorMessage: Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors.join(' | ').substring(0, 2000)
        : null,
    });

    await supabaseAdmin
      .from('platform_integrations')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', integration.id);

    console.log(`[QuickBooksProcessor] ${entityAlias}: ${result.processed} synced, ${result.failed} failed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[QuickBooksProcessor] Job ${job.id} error:`, errorMessage);

    if (error.isRateLimit || errorMessage === 'RATE_LIMIT_EXHAUSTED') {
      await logger.markRetry(job.id, job.retry_count || 0, 'Rate limit paused — will resume automatically');
      return 'rate_limited';
    }

    // QBO 403 ApplicationAuthorizationFailed — the access token was rejected
    // even though token_expires_at may show it as valid (clock skew, server-
    // side revocation, sandbox-vs-prod mismatch). Force a token refresh and
    // requeue once. If the refresh itself fails with a dead-token error, fall
    // through to the disconnected path below.
    const isQbo403 =
      /QuickBooks .* 403/i.test(errorMessage) &&
      /(ApplicationAuthorizationFailed|003100)/i.test(errorMessage);

    if (isQbo403 && (job.retry_count || 0) < 1) {
      console.warn(`[QuickBooksProcessor] 403 auth failure for job ${job.id} — forcing token refresh`);
      try {
        const { data: freshRow } = await supabaseAdmin
          .from('platform_integrations')
          .select('id, client_id, client_secret, refresh_token')
          .eq('id', job.integration_id)
          .single();

        if (freshRow?.refresh_token) {
          await refreshAccessToken(freshRow);
          console.log('[QuickBooksProcessor] Token force-refreshed after 403. Requeueing job.');
          await logger.markRetry(job.id, 1, `403 auth failure — token refreshed, retrying`);
          return 'retry';
        }
      } catch (refreshErr) {
        const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        // If the forced refresh returns a dead-token error, fall through to
        // the disconnected handler below by setting errorMessage accordingly.
        if (/invalid_grant|token refresh failed \(40[01]\)/i.test(refreshMsg)) {
          console.warn(`[QuickBooksProcessor] Token refresh after 403 also failed: ${refreshMsg}`);
          await supabaseAdmin
            .from('platform_integrations')
            .update({
              is_connected:     false,
              access_token:     null,
              refresh_token:    null,
              token_expires_at: null,
              updated_at:       new Date().toISOString(),
            })
            .eq('id', job.integration_id);
          await logger.markFailed(job.id, 'QuickBooks token revoked. Please reconnect QuickBooks to resume syncing.');
          return 'failed';
        }
      }
      // If freshRow has no refresh_token (already cleared), fall through to generic fail.
    }

    // Dead refresh token — Intuit refresh tokens die after ~100 days idle or
    // when the user disconnects the app. Retrying never succeeds; flag the
    // integration disconnected so the queue stops enqueuing for it.
    const isDeadRefreshToken =
      /invalid_grant/i.test(errorMessage) ||
      /QuickBooks token refresh failed \(400\)/i.test(errorMessage) ||
      /QuickBooks token refresh failed \(401\)/i.test(errorMessage);

    if (isDeadRefreshToken && job.integration_id) {
      console.warn(`[QuickBooksProcessor] Dead QuickBooks refresh token for integration ${job.integration_id}. Marking disconnected.`);
      try {
        await supabaseAdmin
          .from('platform_integrations')
          .update({
            is_connected:     false,
            access_token:     null,
            refresh_token:    null,
            token_expires_at: null,
            updated_at:       new Date().toISOString(),
          })
          .eq('id', job.integration_id);
      } catch (flagErr) {
        console.error(`[QuickBooksProcessor] Failed to flag integration disconnected:`, flagErr.message);
      }
      await logger.markFailed(job.id, 'QuickBooks refresh token is no longer valid. Please reconnect QuickBooks to resume syncing.');
      return 'failed';
    }

    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;
    if (retryCount <= maxRetries) {
      await logger.markRetry(job.id, retryCount, errorMessage);
      return 'retry';
    }
    await logger.markFailed(job.id, errorMessage);
    return 'failed';
  }
}

module.exports = { processQuickBooksSyncJob };
