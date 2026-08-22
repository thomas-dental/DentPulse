/**
 * Xero sync processor — processes a single sync job.
 *
 * Supported entity aliases:
 *   xero_chart_of_accounts — GET /Accounts (no date filter)
 *   xero_invoices          — GET /Invoices (paginated, date-filtered, rate-limit aware)
 */

const path = require('path');
const fs   = require('fs');
const { supabaseAdmin } = require('../../config/supabase');
const {
  getOrRefreshToken,
  xeroGet,
  xeroGetPagedIfModified,
  xeroGetJournalsOffset,
} = require('../../api/xero/client');
const { sleep } = require('../../utils/helpers');
const logger = require('../../services/sync/logger');
const {
  ensureFinanceDataSource,
  syncAccountsFromXeroChartTable,
  syncJournalsFromXeroInvoices,
} = require('../../services/normalizers/xeroToCanonical');

const BATCH_SIZE          = 500;
const {
  getXeroSettingsDates,
  resolveModifiedSinceForJob,
} = require('./syncWindow');
const MAX_PAGES_PER_JOB   = 500;

/**
 * Parse a Xero date value to a YYYY-MM-DD string.
 * Xero returns dates as "/Date(1234567890000+0000)/" or ISO strings.
 * Returns null if the value is falsy or unparseable.
 */
function parseXeroDate(val) {
  if (!val) return null;

  // Xero .NET JSON date: /Date(milliseconds+offset)/
  const match = String(val).match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (match) {
    const ms = parseInt(match[1], 10);
    return new Date(ms).toISOString().substring(0, 10);
  }

  // Already an ISO-ish string — just take the date part
  const str = String(val);
  if (str.length >= 10) {
    return str.substring(0, 10);
  }

  return null;
}

/**
 * Parse a Xero datetime value to a full ISO timestamp.
 * Differs from parseXeroDate in that it preserves the time part — needed for
 * updated_date_utc / platform_created_date_utc columns.
 */
function parseXeroDateTime(val) {
  if (!val) return null;

  const match = String(val).match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (match) {
    const ms = parseInt(match[1], 10);
    return new Date(ms).toISOString();
  }

  const str = String(val);
  if (str.length >= 10) {
    // Already ISO-like; let Date normalise it
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * Read Xero date range from sync settings (DB-backed, JSON file fallback).
 * Prefer job.start_date / job.end_date when present (progressive snapshot).
 */
function getXeroDateRange(job = null) {
  if (job?.start_date || job?.end_date) {
    return {
      startDate: job.start_date ? String(job.start_date).slice(0, 10) : null,
      endDate:   job.end_date   ? String(job.end_date).slice(0, 10)   : null,
    };
  }

  try {
    const settings = getXeroSettingsDates();
    return {
      startDate: settings.startDate || null,
      endDate:   settings.endDate   || null,
    };
  } catch {
    return { startDate: null, endDate: null };
  }
}

/**
 * Resolve If-Modified-Since for transactional Xero entities.
 * Uses the job snapshot from triggerSync when available; otherwise falls back
 * to the connection watermark / settings (see syncWindow.js).
 */
function getXeroModifiedSince(job = null, integration = null) {
  return resolveModifiedSinceForJob(job, integration);
}

/**
 * Map a Xero SourceType enum to the descriptive string the old edge function
 * used for xero_journals.source_type_desc.
 */
function journalSourceTypeDesc(sourceType) {
  switch (sourceType) {
    case 'ACCREC':         return 'Invoice';
    case 'ACCPAY':         return 'Bill';
    case 'ACCRECCREDIT':   return 'CreditNote';
    case 'ACCPAYCREDIT':   return 'BillCreditNote';
    case 'ACCRECPAYMENT':  return 'InvoicePayment';
    case 'ACCPAYPAYMENT':  return 'BillPayment';
    case 'ARCREDITPAYMENT':return 'CreditNotePayment';
    case 'MANJOURNAL':     return 'ManualJournal';
    case 'CASHREC':        return 'CashReceived';
    case 'CASHPAID':       return 'CashPaid';
    case 'TRANSFER':       return 'Transfer';
    default:               return '';
  }
}

/**
 * Normalise Xero line Tracking / TrackingCategories into JSONB + option id list.
 * Invoice/Bank lines use `Tracking`; journal lines use `TrackingCategories`.
 */
function extractTrackingFields(line) {
  const raw = line?.TrackingCategories || line?.Tracking || [];
  const arr = Array.isArray(raw) ? raw : [];
  const tracking = [];
  const optionIds = [];
  for (const t of arr) {
    if (!t) continue;
    const categoryId = t.TrackingCategoryID || t.trackingCategoryID || null;
    const optionId =
      t.TrackingOptionID ||
      t.TrackingOptionId ||
      t.OptionID ||
      t.optionID ||
      null;
    const entry = {
      TrackingCategoryID: categoryId,
      TrackingOptionID: optionId,
      Name: t.Name || null,
      Option: t.Option || t.OptionName || null,
    };
    tracking.push(entry);
    if (optionId) optionIds.push(String(optionId));
  }
  return {
    tracking: tracking.length > 0 ? tracking : null,
    tracking_option_ids: [...new Set(optionIds)],
  };
}

/**
 * Collect Tracking from bank transaction header or first line item that has it.
 */
function extractBankTransactionTracking(txn) {
  const fromHeader = extractTrackingFields(txn);
  if (fromHeader.tracking_option_ids.length > 0) return fromHeader;
  const lines = Array.isArray(txn?.LineItems) ? txn.LineItems : [];
  const merged = [];
  const optionIds = [];
  for (const li of lines) {
    const { tracking, tracking_option_ids } = extractTrackingFields(li);
    if (tracking) merged.push(...tracking);
    optionIds.push(...tracking_option_ids);
  }
  return {
    tracking: merged.length > 0 ? merged : null,
    tracking_option_ids: [...new Set(optionIds)],
  };
}

/**
 * Load distinct tracking option mappings for a Xero tenant (PIO id).
 * Returns [{ categoryId, optionId }] — includes Saint Catherine (still syncs).
 */
async function loadTenantTrackingOptionMaps(organizationId, tenantUuid) {
  const scopes = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('xero_tracking_category_id, xero_tracking_option_id')
      .eq('organization_id', organizationId)
      .eq('platform_integration_organizations_id', tenantUuid)
      .not('xero_tracking_option_id', 'is', null);
    if (error) {
      console.warn(`[XeroProcessor] Could not load tracking maps: ${error.message}`);
      return scopes;
    }
    const seen = new Set();
    for (const row of data || []) {
      const optionId = String(row.xero_tracking_option_id || '').trim();
      if (!optionId || seen.has(optionId)) continue;
      seen.add(optionId);
      scopes.push({
        categoryId: String(row.xero_tracking_category_id || '').trim() || null,
        optionId,
      });
    }
  } catch (e) {
    console.warn(`[XeroProcessor] Could not load tracking maps: ${e.message}`);
  }
  return scopes;
}

/**
 * Fetch one month of P&L (optional tracking filters) into accountRows structure.
 */
async function fetchProfitLossMonth(integration, tenantId, monthStart, monthEnd, trackingScope) {
  let path = `/Reports/ProfitAndLoss?fromDate=${monthStart}&toDate=${monthEnd}&standardLayout=true`;
  if (trackingScope?.categoryId && trackingScope?.optionId) {
    path += `&trackingCategoryID=${encodeURIComponent(trackingScope.categoryId)}&trackingOptionID=${encodeURIComponent(trackingScope.optionId)}`;
  }
  const data = await xeroGet(integration, tenantId, path);
  return data?.Reports?.[0] || null;
}

function walkProfitLossReport(report, accountRows, accountRowByKey, periodIndex, monthCount) {
  if (!report) return;
  function walkPL(rows, sectionLabel) {
    for (const r of (rows || [])) {
      if (r.RowType === 'Section') {
        walkPL(r.Rows, r.Title || sectionLabel);
      } else if (r.RowType === 'Row' && Array.isArray(r.Cells) && r.Cells.length > 1) {
        const label = r.Cells[0]?.Value;
        const attrs = r.Cells[0]?.Attributes || [];
        const accountId = (
          attrs.find(a => a.Id === 'account') ||
          attrs.find(a => a.Id === 'accountID')
        )?.Value || null;
        if (!accountId) continue;
        const amount = Number(r.Cells[1]?.Value) || 0;
        const key = `id:${accountId}`;
        if (!accountRowByKey.has(key)) {
          accountRowByKey.set(key, accountRows.length);
          accountRows.push({
            section: sectionLabel,
            label,
            accountId,
            amounts: new Array(Math.max(0, monthCount - 1)).fill(0),
          });
        }
        const idx = accountRowByKey.get(key);
        while (accountRows[idx].amounts.length < periodIndex) accountRows[idx].amounts.push(0);
        accountRows[idx].amounts[periodIndex] = amount;
      }
    }
  }
  walkPL(report.Rows, null);
  for (const row of accountRows) {
    while (row.amounts.length < monthCount) row.amounts.push(0);
  }
}

/**
 * Batch insert with sub-batch fallback.
 */
async function batchInsert(tableName, records) {
  let processed = 0;
  let failed    = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabaseAdmin.from(tableName).insert(chunk);
      if (error) {
        console.error(`[XeroProcessor] Batch insert error for ${tableName}: ${error.message}`);
        failed += chunk.length;
      } else {
        processed += chunk.length;
      }
    } catch (err) {
      console.error(`[XeroProcessor] Batch insert exception:`, err.message);
      failed += chunk.length;
    }
  }

  return { processed, failed };
}

/**
 * Sync Chart of Accounts for Xero tenants belonging to the triggered integration.
 */
async function syncChartOfAccounts(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;

  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integration.id)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (tenantsErr) {
    throw new Error(`Failed to fetch Xero tenants: ${tenantsErr.message}`);
  }

  if (!tenants || tenants.length === 0) {
    console.log(`[XeroProcessor] No active Xero tenants for org ${organizationId}`);
    return { processed: 0, failed: 0 };
  }

  console.log(`[XeroProcessor] Syncing CoA for ${tenants.length} Xero tenant(s)`);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantId, platform_org_name: tenantName } = tenant;

    console.log(`[XeroProcessor] Fetching CoA for tenant: ${tenantName} (${tenantId})`);

    try {
      const data = await xeroGet(integration, tenantId, '/Accounts');
      const accounts = data?.Accounts || [];

      console.log(`[XeroProcessor] ${tenantName}: ${accounts.length} accounts received`);

      if (accounts.length === 0) {
        continue;
      }

      const rows = accounts.map(account => ({
        organization_id:         organizationId,
        platform_integration_id: integration.id,
        xero_tenant_id:          tenantUuid,
        user_id:                 userId,
        xero_account_id:         account.AccountID,
        account_code:            account.Code || null,
        account_name:            account.Name || null,
        account_type:            account.Type || null,
        account_sub_type:        account.SystemAccount || null,
        classification:          account.Class || null,
        description:             account.Description || null,
        tax_type:                account.TaxType || null,
        bank_account_type:       account.BankAccountType || null,
        reporting_code:          account.ReportingCode || null,
        reporting_name:          account.ReportingCodeName || null,
        is_active:               account.Status === 'ACTIVE',
        updated_date_utc:        parseXeroDateTime(account.UpdatedDateUTC),
      }));

      // Upsert on (org, integration, xero_account_id) so row UUIDs are preserved
      // across syncs — expense-account mappings in practice_locations reference
      // these UUIDs, so regenerating them would orphan every mapping.
      let processed = 0;
      let failed    = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('xero_chart_of_accounts')
          .upsert(chunk, {
            onConflict: 'organization_id,platform_integration_id,xero_account_id',
            ignoreDuplicates: false,
          });
        if (error) {
          console.error(`[XeroProcessor] Upsert error for ${tenantName}: ${error.message}`);
          failed += chunk.length;
        } else {
          processed += chunk.length;
        }
      }

      // Delete rows whose Xero AccountID is no longer in the API response
      // (account was archived/removed in Xero). Do this AFTER upsert so we
      // never orphan a mapping that's still valid upstream.
      const currentAccountIds = rows.map(r => r.xero_account_id);
      const { data: stale, error: staleErr } = await supabaseAdmin
        .from('xero_chart_of_accounts')
        .select('id, xero_account_id')
        .eq('organization_id', organizationId)
        .eq('platform_integration_id', integration.id)
        .eq('xero_tenant_id', tenantUuid)
        .not('xero_account_id', 'in', `(${currentAccountIds.map(id => `"${id}"`).join(',')})`);
      if (staleErr) {
        console.warn(`[XeroProcessor] Stale lookup error for ${tenantName}: ${staleErr.message}`);
      } else if (stale && stale.length > 0) {
        const staleIds = stale.map(s => s.id);
        const { error: delErr } = await supabaseAdmin
          .from('xero_chart_of_accounts')
          .delete()
          .in('id', staleIds);
        if (delErr) console.warn(`[XeroProcessor] Stale delete error: ${delErr.message}`);
        else       console.log(`[XeroProcessor] ${tenantName}: removed ${stale.length} stale account(s) no longer in Xero`);
      }

      console.log(`[XeroProcessor] ${tenantName}: ${processed} upserted, ${failed} failed`);
      totalProcessed += processed;
      totalFailed    += failed;

    } catch (tenantErr) {
      // Re-throw rate limit errors so the queue can pause
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') {
        throw tenantErr;
      }
      console.error(`[XeroProcessor] Error syncing tenant ${tenantName}: ${tenantErr.message}`);
      totalFailed += 1;
      errors.push(`[${tenantName}] ${tenantErr.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Tracking Categories + Options for each active Xero tenant.
 * GET /TrackingCategories returns categories with nested Options (no pagination).
 */
async function syncTrackingCategories(job, integration) {
  const { organization_id: organizationId } = job;
  const tenants = await loadActiveXeroTenants(organizationId, integration.id);

  if (tenants.length === 0) {
    console.log(`[XeroProcessor] No active Xero tenants for tracking sync org ${organizationId}`);
    return { processed: 0, failed: 0 };
  }

  console.log(`[XeroProcessor] Syncing TrackingCategories for ${tenants.length} tenant(s)`);
  await getOrRefreshToken(integration);

  let totalProcessed = 0;
  let totalFailed = 0;
  const errors = [];
  const nowIso = new Date().toISOString();

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantGuid, platform_org_name: tenantName } = tenant;
    try {
      const data = await xeroGet(integration, tenantGuid, '/TrackingCategories');
      const categories = Array.isArray(data?.TrackingCategories) ? data.TrackingCategories : [];

      const categoryRows = [];
      const optionRows = [];
      const seenCategoryIds = new Set();
      const seenOptionIds = new Set();

      for (const cat of categories) {
        const categoryId = cat.TrackingCategoryID;
        if (!categoryId || seenCategoryIds.has(categoryId)) continue;
        seenCategoryIds.add(categoryId);
        categoryRows.push({
          organization_id: organizationId,
          platform_integration_id: integration.id,
          platform_integration_organizations_id: tenantUuid,
          xero_tracking_category_id: categoryId,
          name: cat.Name || 'Unnamed',
          status: cat.Status || 'ACTIVE',
          synced_at: nowIso,
          updated_at: nowIso,
        });

        const options = Array.isArray(cat.Options) ? cat.Options : [];
        for (const opt of options) {
          const optionId = opt.TrackingOptionID;
          if (!optionId || seenOptionIds.has(optionId)) continue;
          seenOptionIds.add(optionId);
          optionRows.push({
            organization_id: organizationId,
            platform_integration_id: integration.id,
            platform_integration_organizations_id: tenantUuid,
            xero_tracking_category_id: categoryId,
            xero_tracking_option_id: optionId,
            name: opt.Name || 'Unnamed',
            status: opt.Status || 'ACTIVE',
            synced_at: nowIso,
            updated_at: nowIso,
          });
        }
      }

      // Soft-deactivate categories/options no longer returned for this tenant
      const { data: existingCats } = await supabaseAdmin
        .from('xero_tracking_categories')
        .select('id, xero_tracking_category_id')
        .eq('organization_id', organizationId)
        .eq('platform_integration_organizations_id', tenantUuid);
      const staleCatIds = (existingCats || [])
        .filter(r => r.xero_tracking_category_id && !seenCategoryIds.has(r.xero_tracking_category_id))
        .map(r => r.id);
      if (staleCatIds.length > 0) {
        await supabaseAdmin
          .from('xero_tracking_categories')
          .update({ status: 'DELETED', updated_at: nowIso })
          .in('id', staleCatIds);
      }

      const { data: existingOpts } = await supabaseAdmin
        .from('xero_tracking_options')
        .select('id, xero_tracking_option_id')
        .eq('organization_id', organizationId)
        .eq('platform_integration_organizations_id', tenantUuid);
      const staleOptIds = (existingOpts || [])
        .filter(r => r.xero_tracking_option_id && !seenOptionIds.has(r.xero_tracking_option_id))
        .map(r => r.id);
      if (staleOptIds.length > 0) {
        await supabaseAdmin
          .from('xero_tracking_options')
          .update({ status: 'DELETED', updated_at: nowIso })
          .in('id', staleOptIds);
      }

      const catResult = await upsertWithFallback(
        'xero_tracking_categories',
        categoryRows,
        'organization_id,platform_integration_organizations_id,xero_tracking_category_id',
        tenantName,
        errors,
      );
      const optResult = await upsertWithFallback(
        'xero_tracking_options',
        optionRows,
        'organization_id,platform_integration_organizations_id,xero_tracking_option_id',
        tenantName,
        errors,
      );

      totalProcessed += catResult.processed + optResult.processed;
      totalFailed += catResult.failed + optResult.failed;
      console.log(
        `[XeroProcessor] ${tenantName}: ${catResult.processed} categories, ${optResult.processed} options upserted`,
      );
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] TrackingCategories error for ${tenantName}: ${tenantErr.message}`);
      totalFailed += 1;
      errors.push(`[${tenantName}] ${tenantErr.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Invoices for Xero tenants belonging to the triggered integration —
 * paginated, date-filtered, rate-limit aware.
 */
async function syncInvoices(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;

  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integration.id)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (tenantsErr) {
    throw new Error(`Failed to fetch Xero tenants: ${tenantsErr.message}`);
  }

  if (!tenants || tenants.length === 0) {
    console.log(`[XeroProcessor] No active Xero tenants for org ${organizationId}`);
    return { processed: 0, failed: 0 };
  }

  // Invoices use If-Modified-Since — the Xero modified-since timestamp catches
  // backdated edits AND voided invoices (Xero bumps UpdatedDateUTC on any
  // mutation), matching the old edge-function behaviour. The date-range
  // where-clause was silently dropping voided invoices because Xero excludes
  // them by default for `Date>=...` filters.
  const modifiedSince = getXeroModifiedSince(job, integration);
  console.log(`[XeroProcessor] Syncing Invoices for ${tenants.length} tenant(s) since ${modifiedSince || '(all)'}`);

  // Tenant → practice location, so every invoice can be stamped with the location
  // of the Xero org it belongs to (Practice Location Mapping).
  const tenantLocationMap = await loadTenantLocationMap(organizationId);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantId, platform_org_name: tenantName } = tenant;
    console.log(`[XeroProcessor] Fetching Invoices for tenant: ${tenantName} (${tenantId})`);

    let page            = 1;
    let tenantProcessed = 0;
    let tenantFailed    = 0;
    const tenantErrors  = [];

    // No pre-delete: upsert on (org, platform_type, platform_invoice_id) handles
    // both new rows and re-sync of existing ones (including healing misattributed
    // tenant_id from earlier buggy runs). Leaving stale real invoices in place
    // is preferable to wiping rows that might legitimately belong to this
    // tenant — a separate reconcile step can prune Xero-deleted invoices later.
    // We also must NOT wipe PL_SYNTHETIC rows here; they come from the
    // xero_profit_loss entity and are keyed differently.

    while (page <= MAX_PAGES_PER_JOB) {
      console.log(`[XeroProcessor] ${tenantName}: Invoices page ${page}...`);

      const { items: invoices, hasMore } = await xeroGetPagedIfModified(
        integration,
        tenantId,
        '/Invoices',
        page,
        modifiedSince,
      );

      console.log(`[XeroProcessor] ${tenantName}: page ${page} → ${invoices.length} invoices`);

      if (invoices.length > 0) {
        // Defensive: drop duplicate InvoiceIDs within the same page. Xero
        // pagination can return the same invoice twice when pages aren't
        // stable (records shifting between pages during sync), and
        // PostgreSQL ON CONFLICT fails if a batch contains two rows with
        // the same conflict-target key.
        const seenIds = new Set();
        const uniqueInvoices = [];
        for (const inv of invoices) {
          if (!inv.InvoiceID || seenIds.has(inv.InvoiceID)) continue;
          seenIds.add(inv.InvoiceID);
          uniqueInvoices.push(inv);
        }
        if (uniqueInvoices.length < invoices.length) {
          console.log(`[XeroProcessor] ${tenantName}: deduped ${invoices.length - uniqueInvoices.length} in-page duplicate(s)`);
        }

        const rows = uniqueInvoices.map(inv => ({
          organization_id:     organizationId,
          xero_tenant_id:      tenantId,
          location_id:         tenantLocationMap.get(String(tenantUuid)) || null,
          user_id:             userId,

          platform_invoice_id: inv.InvoiceID,
          xero_invoice_id:     inv.InvoiceID,
          invoice_number:      inv.InvoiceNumber || null,
          invoice_type:        inv.Type || null,
          reference:           inv.Reference || null,

          invoice_date:        parseXeroDate(inv.Date),
          due_date:            parseXeroDate(inv.DueDate),
          paid_date:           parseXeroDate(inv.FullyPaidOnDate),

          status:              (inv.Status || '').toLowerCase() || 'draft',
          is_paid:             inv.Status === 'PAID',

          currency:            inv.CurrencyCode || 'GBP',
          currency_rate:       inv.CurrencyRate || 1.0,

          subtotal:            inv.SubTotal   ?? null,
          tax_amount:          inv.TotalTax   ?? null,
          total_amount:        inv.Total      ?? null,
          amount_paid:         inv.AmountPaid ?? 0,
          amount_due:          inv.AmountDue  ?? null,

          contact_id:          inv.Contact?.ContactID    || null,
          contact_name:        inv.Contact?.Name         || null,
          contact_email:       inv.Contact?.EmailAddress || null,

          line_amount_types:   inv.LineAmountTypes || null,
          invoice_url:         inv.Url || null,
          branding_theme_id:   inv.BrandingThemeID || null,

          sync_status:         'synced',
          last_synced_at:      new Date().toISOString(),
        }));

        // Insert invoices and capture their UUIDs so line items can FK them.
        const invoiceIdMap = new Map(); // Xero InvoiceID → xero_invoices.id UUID
        let invoiceProcessed = 0;
        let invoiceFailed    = 0;

        async function upsertInvoiceRows(batch) {
          return supabaseAdmin
            .from('xero_invoices')
            .upsert(batch, {
              onConflict: 'organization_id,xero_tenant_id,platform_invoice_id',
              ignoreDuplicates: false,
            })
            .select('id, platform_invoice_id');
        }

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const chunk = rows.slice(i, i + BATCH_SIZE);
          // Try batch upsert first; if Postgres rejects the whole chunk due to
          // an unknown constraint or intra-batch edge case, fall back to
          // per-row inserts so one bad row can never block the others.
          const { data: inserted, error } = await upsertInvoiceRows(chunk);

          if (!error) {
            invoiceProcessed += inserted?.length || 0;
            (inserted || []).forEach(row => invoiceIdMap.set(row.platform_invoice_id, row.id));
            continue;
          }

          console.warn(`[XeroProcessor] Batch upsert failed (${error.message}); falling back to per-row upsert for this chunk.`);
          tenantErrors.push(`batch upsert failed: ${error.message} (retried row-by-row)`);

          for (const single of chunk) {
            const { data: ins, error: rowErr } = await upsertInvoiceRows([single]);
            if (rowErr) {
              console.error(`[XeroProcessor] Row upsert error pid=${single.platform_invoice_id}: ${rowErr.message}`);
              invoiceFailed += 1;
              tenantErrors.push(`row pid=${single.platform_invoice_id}: ${rowErr.message}`);
              continue;
            }
            invoiceProcessed += ins?.length || 0;
            (ins || []).forEach(row => invoiceIdMap.set(row.platform_invoice_id, row.id));
          }
        }

        tenantProcessed += invoiceProcessed;
        tenantFailed    += invoiceFailed;

        // AP dual-write removed — Xero data now lives only in xero_* tables
        // per the 2026-04-23 separation. Accounts Payable pages read from
        // accounts_payable_invoice for non-Xero workflows only.

        // Build and insert line items for the invoices that were persisted.
        // CASCADE delete on the FK means we don't need to pre-delete — the earlier
        // invoice delete already wiped the line items for this tenant.
        const lineItemRows = [];
        for (const inv of uniqueInvoices) {
          const invoiceUuid = invoiceIdMap.get(inv.InvoiceID);
          if (!invoiceUuid) continue;

          const lineItems = Array.isArray(inv.LineItems) ? inv.LineItems : [];
          lineItems.forEach((li, idx) => {
            const { tracking, tracking_option_ids } = extractTrackingFields(li);
            lineItemRows.push({
              organization_id:   organizationId,
              invoice_id:        invoiceUuid,
              platform_line_id:  li.LineItemID || null,
              xero_line_item_id: li.LineItemID || null,
              line_number:       idx + 1,
              description:       li.Description || null,
              item_code:         li.ItemCode || null,
              quantity:          li.Quantity ?? null,
              unit_amount:       li.UnitAmount ?? null,
              line_amount:       li.LineAmount ?? null,
              tax_amount:        li.TaxAmount ?? null,
              discount_rate:     li.DiscountRate ?? null,
              tax_type:          li.TaxType || null,
              account_id:        li.AccountID || null,
              account_code:      li.AccountCode || null,
              tracking,
              tracking_option_ids,
            });
          });
        }

        if (lineItemRows.length > 0) {
          // Dedupe by platform_line_id within the batch.
          const seenLineIds = new Set();
          const dedupedLines = [];
          for (const row of lineItemRows) {
            const key = row.platform_line_id;
            if (key && seenLineIds.has(key)) continue;
            if (key) seenLineIds.add(key);
            dedupedLines.push(row);
          }
          if (dedupedLines.length < lineItemRows.length) {
            console.log(`[XeroProcessor] ${tenantName}: deduped ${lineItemRows.length - dedupedLines.length} in-batch line item(s)`);
          }

          let liProcessed = 0;
          let liFailed    = 0;
          for (let i = 0; i < dedupedLines.length; i += BATCH_SIZE) {
            const chunk = dedupedLines.slice(i, i + BATCH_SIZE);
            const { error } = await supabaseAdmin
              .from('xero_invoice_line_items')
              .upsert(chunk, { onConflict: 'organization_id,platform_line_id', ignoreDuplicates: false });
            if (!error) {
              liProcessed += chunk.length;
              continue;
            }
            console.warn(`[XeroProcessor] Line item batch upsert failed (${error.message}); retrying per-row.`);
            tenantErrors.push(`line items batch: ${error.message} (row-by-row retry)`);
            for (const single of chunk) {
              const { error: rowErr } = await supabaseAdmin
                .from('xero_invoice_line_items')
                .upsert(single, { onConflict: 'organization_id,platform_line_id', ignoreDuplicates: false });
              if (rowErr) {
                liFailed++;
                tenantErrors.push(`line item pid=${single.platform_line_id}: ${rowErr.message}`);
              } else {
                liProcessed++;
              }
            }
          }
          console.log(`[XeroProcessor] ${tenantName}: page ${page} → ${liProcessed} line items upserted, ${liFailed} failed`);
        }

        // Payments — upsert into xero_payments keyed on PaymentID.
        const paymentRows = [];
        for (const inv of uniqueInvoices) {
          if (!Array.isArray(inv.Payments)) continue;
          for (const pay of inv.Payments) {
            if (!pay.PaymentID) continue;
            paymentRows.push({
              organization_id:                      organizationId,
              platform_integration_id:              integration.id,
              platform_integration_organization_id: tenantUuid,
              payment_id:                           pay.PaymentID,
              invoice_id:                           inv.InvoiceID,
              accounts_payable_invoice_id:          null,
              payment_date:                         parseXeroDate(pay.Date),
              amount:                               pay.Amount ?? null,
              reference:                            pay.Reference || null,
              currency_rate:                        pay.CurrencyRate ?? null,
              transaction_type:                     'InvoicePayment',
            });
          }
        }

        if (paymentRows.length > 0) {
          const seenPayIds = new Set();
          const dedupedPayments = paymentRows.filter(p => {
            if (seenPayIds.has(p.payment_id)) return false;
            seenPayIds.add(p.payment_id);
            return true;
          });
          let payProcessed = 0;
          let payFailed    = 0;
          for (let i = 0; i < dedupedPayments.length; i += BATCH_SIZE) {
            const chunk = dedupedPayments.slice(i, i + BATCH_SIZE);
            const { error } = await supabaseAdmin
              .from('xero_payments')
              .upsert(chunk, {
                onConflict: 'organization_id,platform_integration_organization_id,payment_id',
                ignoreDuplicates: false,
              });
            if (!error) { payProcessed += chunk.length; continue; }
            console.warn(`[XeroProcessor] ${tenantName}: payments batch failed (${error.message}); row retry`);
            tenantErrors.push(`payments batch: ${error.message}`);
            for (const single of chunk) {
              const { error: rowErr } = await supabaseAdmin
                .from('xero_payments')
                .upsert(single, {
                  onConflict: 'organization_id,platform_integration_organization_id,payment_id',
                  ignoreDuplicates: false,
                });
              if (rowErr) {
                payFailed++;
                tenantErrors.push(`payment pid=${single.payment_id}: ${rowErr.message}`);
              } else {
                payProcessed++;
              }
            }
          }
          console.log(`[XeroProcessor] ${tenantName}: page ${page} → ${payProcessed} payments upserted, ${payFailed} failed`);
        }
      }

      if (!hasMore || invoices.length === 0) break;
      page++;

      // Brief pause between pages to stay within rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`[XeroProcessor] ${tenantName}: ${tenantProcessed} invoices inserted, ${tenantFailed} failed`);
    totalProcessed += tenantProcessed;
    totalFailed    += tenantFailed;
    if (tenantErrors.length > 0) {
      errors.push(`[${tenantName}] ${tenantErrors.join('; ')}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Xero P&L report per tenant. Writes synthetic invoices + line items so
 * Cost Impact queries pick up authoritative Xero P&L totals (which include
 * bills, journals, bank transactions — not just /Invoices).
 *
 * For each tenant we call GET /Reports/ProfitAndLoss?fromDate&toDate&timeframe=MONTH,
 * parse the monthly columns, and for each month write:
 *   - one synthetic invoice  (platform_invoice_id = `pl_<tenantId>_<YYYY-MM>`)
 *   - one line item per account row in the P&L
 *
 * Idempotent: deletes any existing synthetic invoices for the tenant in the
 * requested range before re-inserting.
 */
async function syncProfitLoss(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;

  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integration.id)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (tenantsErr) throw new Error(`Failed to fetch Xero tenants: ${tenantsErr.message}`);
  if (!tenants || tenants.length === 0) return { processed: 0, failed: 0 };

  const { startDate: settingsStart, endDate: settingsEnd } = getXeroDateRange(job);
  const rawStart = job.start_date || settingsStart;
  const rawEnd   = job.end_date   || settingsEnd;
  const ymd = (d) => (d ? String(d).slice(0, 10) : null);
  const fromDate = ymd(rawStart);
  const toDate   = ymd(rawEnd);

  if (!fromDate || !toDate) {
    throw new Error('P&L sync requires both fromDate and toDate in the Xero sync date range settings or job overrides');
  }

  console.log(`[XeroProcessor] Syncing P&L for ${tenants.length} tenant(s): ${fromDate} → ${toDate}`);

  const tenantLocationMap = await loadTenantLocationMap(organizationId);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client
  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantId, platform_org_name: tenantName } = tenant;
    console.log(`[XeroProcessor] Fetching P&L for tenant: ${tenantName}`);

    try {
      // Loop one Xero P&L call per month so each synthetic invoice is dated
      // to its true period — Cost Impact can then filter by month correctly.
      // We can't rely on Xero's timeframe/periods params: `timeframe=MONTH`
      // without `periods` still returns one aggregated column, and the headers
      // come back as "31 Dec 25" (dd Mmm yy), not the "Apr 2025" form my
      // earlier parser expected.
      const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Sept:9, Oct:10, Nov:11, Dec:12 };

      const startY = Number(fromDate.slice(0, 4));
      const startM = Number(fromDate.slice(5, 7));
      const endY   = Number(toDate.slice(0, 4));
      const endM   = Number(toDate.slice(5, 7));

      const periodDates  = [];
      const accountRows  = []; // { label, accountId, amounts: [month1, month2, ...] }
      const accountRowByKey = new Map(); // accountId|label → index in accountRows

      let monthCount = 0;
      for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDay    = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const monthEnd   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        periodDates.push(monthEnd);
        const periodIndex = monthCount;
        monthCount++;

        const path = `/Reports/ProfitAndLoss?fromDate=${monthStart}&toDate=${monthEnd}&standardLayout=true`;
        const data = await xeroGet(integration, tenantId, path);
        const report = data?.Reports?.[0];
        if (report) {
          function walk(rows, sectionLabel) {
            for (const r of (rows || [])) {
              if (r.RowType === 'Section') {
                walk(r.Rows, r.Title || sectionLabel);
              } else if (r.RowType === 'Row' && Array.isArray(r.Cells) && r.Cells.length > 1) {
                const label = r.Cells[0]?.Value;
                const attrs = r.Cells[0]?.Attributes || [];
                // Xero's P&L payload tags account rows with Attributes[].Id = "account"
                // (lowercase, singular). Older docs suggested "accountID" but the live
                // shape is "account" — check both to stay forward-compatible.
                const accountId = (attrs.find(a => a.Id === 'account') || attrs.find(a => a.Id === 'accountID'))?.Value || null;
                const amount = Number(r.Cells[1]?.Value) || 0;
                const key = accountId ? `id:${accountId}` : `label:${sectionLabel}|${label}`;
                if (!accountRowByKey.has(key)) {
                  accountRowByKey.set(key, accountRows.length);
                  accountRows.push({ section: sectionLabel, label, accountId, amounts: new Array(monthCount - 1).fill(0) });
                }
                const idx = accountRowByKey.get(key);
                // pad amounts for any months this account didn't appear
                while (accountRows[idx].amounts.length < periodIndex) accountRows[idx].amounts.push(0);
                accountRows[idx].amounts[periodIndex] = amount;
              }
            }
          }
          walk(report.Rows, null);
        }

        // Backfill any account row missed this month so all arrays stay aligned
        for (const row of accountRows) {
          while (row.amounts.length < monthCount) row.amounts.push(0);
        }

        // advance to next month
        m++;
        if (m > 12) { m = 1; y++; }
      }

      console.log(`[XeroProcessor] ${tenantName}: fetched P&L for ${monthCount} month(s), ${accountRows.length} unique accounts`);

      // Resolve accountId → account_code via our synced COA so the rows match
      // what the user has mapped in practice_locations.*_accounts.
      const accountIdToCode = new Map();
      const uniqAccountIds = [...new Set(accountRows.map(r => r.accountId).filter(Boolean))];
      if (uniqAccountIds.length > 0) {
        for (let i = 0; i < uniqAccountIds.length; i += 500) {
          const chunk = uniqAccountIds.slice(i, i + 500);
          const { data: coa } = await supabaseAdmin
            .from('xero_chart_of_accounts')
            .select('xero_account_id, account_code')
            .eq('organization_id', organizationId)
            .eq('platform_integration_id', integration.id)
            .eq('xero_tenant_id', tenantUuid)
            .in('xero_account_id', chunk);
          (coa || []).forEach(c => {
            if (c.xero_account_id && c.account_code) {
              accountIdToCode.set(c.xero_account_id, c.account_code);
            }
          });
        }
      }

      // Wipe existing synthetic invoices for this tenant — CASCADE drops their line items.
      const { error: delErr } = await supabaseAdmin
        .from('xero_invoices')
        .delete()
        .eq('organization_id', organizationId)
        .eq('xero_tenant_id', tenantId)
        .eq('invoice_type', 'PL_SYNTHETIC');
      if (delErr) console.warn(`[XeroProcessor] PL delete error for ${tenantName}: ${delErr.message}`);

      // Build one synthetic invoice per (tenant, month) with a stable platform_invoice_id.
      const invoiceRows = [];
      for (let p = 0; p < periodDates.length; p++) {
        const periodDate = periodDates[p];
        if (!periodDate) continue;
        invoiceRows.push({
          organization_id:     organizationId,
          xero_tenant_id:      tenantId,
          location_id:         tenantLocationMap.get(String(tenantUuid)) || null,
          user_id:             userId,

          // xero_invoice_id is a UUID column; synthetic rows aren't real
          // Xero invoices so we leave it NULL. platform_invoice_id is varchar
          // so we can use a deterministic string here for idempotent re-sync.
          platform_invoice_id: `pl_${tenantId}_${periodDate.slice(0, 7)}`,
          xero_invoice_id:     null,
          invoice_number:      `PL ${periodDate.slice(0, 7)}`,
          invoice_type:        'PL_SYNTHETIC',
          reference:           'Xero P&L synthetic row',

          invoice_date:        periodDate,
          due_date:            null,
          paid_date:           null,

          status:              'posted',
          is_paid:             false,

          currency:            'GBP',
          currency_rate:       1.0,

          subtotal:            0,
          tax_amount:          0,
          total_amount:        0,
          amount_paid:         0,
          amount_due:          0,

          sync_status:         'synced',
          last_synced_at:      new Date().toISOString(),
        });
      }

      if (invoiceRows.length === 0) continue;

      // Upsert synthetic invoices — idempotent on (org, xero_tenant_id, platform_invoice_id).
      const invoiceIdByPeriod = new Map(); // periodDate (YYYY-MM-DD) → uuid
      async function upsertSynthetics(rows) {
        return supabaseAdmin
          .from('xero_invoices')
          .upsert(rows, {
            onConflict: 'organization_id,xero_tenant_id,platform_invoice_id',
            ignoreDuplicates: false,
          })
          .select('id, invoice_date');
      }
      let plProcessed = 0;
      let plFailed    = 0;
      for (let i = 0; i < invoiceRows.length; i += BATCH_SIZE) {
        const chunk = invoiceRows.slice(i, i + BATCH_SIZE);
        const { data: inserted, error } = await upsertSynthetics(chunk);
        if (!error) {
          plProcessed += inserted?.length || 0;
          (inserted || []).forEach(row => invoiceIdByPeriod.set(row.invoice_date, row.id));
          continue;
        }
        console.warn(`[XeroProcessor] PL batch upsert failed for ${tenantName}: ${error.message}; retrying row-by-row`);
        errors.push(`[${tenantName}] PL batch: ${error.message} (row-by-row retry)`);

        for (const single of chunk) {
          const { data: ins, error: rowErr } = await upsertSynthetics([single]);
          if (rowErr) {
            console.error(`[XeroProcessor] PL row upsert error for ${tenantName} ${single.invoice_date}: ${rowErr.message}`);
            plFailed += 1;
            errors.push(`[${tenantName}] PL ${single.invoice_date}: ${rowErr.message}`);
            continue;
          }
          plProcessed += ins?.length || 0;
          (ins || []).forEach(row => invoiceIdByPeriod.set(row.invoice_date, row.id));
        }
      }

      // Build line items: one per (account, period) where amount != 0.
      // P&L expense accounts post as positive amounts in the "Less Cost of Sales"
      // / "Less Operating Expenses" sections. We keep them positive in line_amount
      // so Cost Impact's SUM matches the Xero P&L number directly.
      const lineItemRows = [];
      for (const row of accountRows) {
        const code = row.accountId ? accountIdToCode.get(row.accountId) : null;
        if (!code) continue; // skip unmapped rows (totals, headers, etc.)
        for (let p = 0; p < periodDates.length; p++) {
          const periodDate = periodDates[p];
          if (!periodDate) continue;
          const amount = Number(row.amounts[p]) || 0;
          if (amount === 0) continue;
          const invoiceUuid = invoiceIdByPeriod.get(periodDate);
          if (!invoiceUuid) continue;
          lineItemRows.push({
            organization_id: organizationId,
            invoice_id:      invoiceUuid,
            platform_line_id: `${row.accountId}_${periodDate}`,
            line_number:     lineItemRows.length + 1,
            description:     row.label || null,
            account_id:      row.accountId,
            account_code:    code,
            line_amount:     amount,
            tax_amount:      0,
            quantity:        1,
            unit_amount:     amount,
          });
        }
      }

      if (lineItemRows.length > 0) {
        // Upsert on (organization_id, platform_line_id) so re-syncing updates
        // existing synthetic line items rather than failing on the hidden
        // unique_key constraint.
        let liProcessed = 0;
        let liFailed    = 0;
        for (let i = 0; i < lineItemRows.length; i += BATCH_SIZE) {
          const chunk = lineItemRows.slice(i, i + BATCH_SIZE);
          const { error } = await supabaseAdmin
            .from('xero_invoice_line_items')
            .upsert(chunk, { onConflict: 'organization_id,platform_line_id', ignoreDuplicates: false });
          if (!error) { liProcessed += chunk.length; continue; }
          console.warn(`[XeroProcessor] PL line item batch upsert failed (${error.message}); retrying per-row.`);
          errors.push(`[${tenantName}] PL line items batch: ${error.message} (row-by-row retry)`);
          for (const single of chunk) {
            const { error: rowErr } = await supabaseAdmin
              .from('xero_invoice_line_items')
              .upsert(single, { onConflict: 'organization_id,platform_line_id', ignoreDuplicates: false });
            if (rowErr) {
              liFailed++;
              errors.push(`[${tenantName}] PL line pid=${single.platform_line_id}: ${rowErr.message}`);
            } else {
              liProcessed++;
            }
          }
        }
        console.log(`[XeroProcessor] ${tenantName}: ${plProcessed} P&L periods upserted, ${liProcessed} line items, ${liFailed} failed`);
      }

      totalProcessed += plProcessed;
      totalFailed    += plFailed;
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] P&L sync error for ${tenantName}: ${tenantErr.message}`);
      totalFailed += 1;
      errors.push(`[${tenantName}] ${tenantErr.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Xero P&L report into the dedicated xero_profit_loss table.
 * One row per (account × calendar month × tracking option).
 * Always pulls an unscoped tenant report (xero_tracking_option_id = ''),
 * then pulls option-scoped reports for each mapped tracking option.
 *
 * Idempotent: deletes existing rows for the tenant within the date range
 * before re-inserting so a re-sync is always clean.
 */
async function syncProfitLossReport(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;

  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integration.id)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (tenantsErr) throw new Error(`Failed to fetch Xero tenants: ${tenantsErr.message}`);
  if (!tenants || tenants.length === 0) return { processed: 0, failed: 0 };

  const tenantLocationMap = await loadTenantLocationMap(organizationId);

  const { startDate: settingsStart, endDate: settingsEnd } = getXeroDateRange(job);
  const ymd = (d) => (d ? String(d).slice(0, 10) : null);
  const fromDate = ymd(job.start_date || settingsStart);
  const toDate   = ymd(job.end_date   || settingsEnd);

  if (!fromDate || !toDate) {
    throw new Error('P&L report sync requires fromDate and toDate in the Xero sync date range settings or job overrides');
  }

  console.log(`[XeroProcessor] Syncing P&L report for ${tenants.length} tenant(s): ${fromDate} → ${toDate}`);

  await getOrRefreshToken(integration);
  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  const plOnConflict = 'organization_id,xero_tenant_id,xero_account_id,to_date,xero_tracking_option_id';

  async function pullMonthsForScope(tenantId, trackingScope) {
    const accountRows = [];
    const accountRowByKey = new Map();
    const periodDates = [];
    let monthCount = 0;

    const startY = Number(fromDate.slice(0, 4));
    const startM = Number(fromDate.slice(5, 7));
    const endY   = Number(toDate.slice(0, 4));
    const endM   = Number(toDate.slice(5, 7));

    for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay    = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthEnd   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      periodDates.push(monthEnd);
      const periodIndex = monthCount++;

      const report = await fetchProfitLossMonth(integration, tenantId, monthStart, monthEnd, trackingScope);
      walkProfitLossReport(report, accountRows, accountRowByKey, periodIndex, monthCount);

      m++;
      if (m > 12) { m = 1; y++; }
      await sleep(200);
    }

    return { accountRows, periodDates, monthCount };
  }

  async function upsertProfitLossRows(tenantUuid, tenantName, accountRows, periodDates, trackingOptionId) {
    const optionKey = trackingOptionId || '';
    const rows = [];
    for (const row of accountRows) {
      for (let p = 0; p < periodDates.length; p++) {
        const amount = Number(row.amounts[p]) || 0;
        if (amount === 0) continue;
        const toDateStr   = periodDates[p];
        const fromDateStr = `${toDateStr.slice(0, 7)}-01`;
        rows.push({
          organization_id:         organizationId,
          platform_integration_id: integration.id,
          xero_tenant_id:          tenantUuid,
          user_id:                 userId,
          from_date:               fromDateStr,
          to_date:                 toDateStr,
          period_year:             Number(toDateStr.slice(0, 4)),
          period_month:            Number(toDateStr.slice(5, 7)),
          section:                 row.section || null,
          xero_account_id:         row.accountId,
          amount,
          xero_tracking_option_id: optionKey,
          synced_at:               new Date().toISOString(),
        });
      }
    }

    if (rows.length === 0) return { inserted: 0, failed: 0 };

    let inserted = 0;
    let failed   = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('xero_profit_loss')
        .upsert(chunk, { onConflict: plOnConflict, ignoreDuplicates: false });
      if (!error) { inserted += chunk.length; continue; }
      console.warn(`[XeroProcessor] P&L report batch upsert failed (${error.message}); retrying per-row`);
      for (const single of chunk) {
        const { error: rowErr } = await supabaseAdmin
          .from('xero_profit_loss')
          .upsert(single, { onConflict: plOnConflict, ignoreDuplicates: false });
        if (rowErr) {
          failed++;
          errors.push(`[${tenantName}] ${single.xero_account_id} ${single.to_date}: ${rowErr.message}`);
        } else {
          inserted++;
        }
      }
    }
    return { inserted, failed };
  }

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantId, platform_org_name: tenantName } = tenant;
    console.log(`[XeroProcessor] Fetching P&L report for tenant: ${tenantName}`);

    try {
      // Wipe all scoped + unscoped rows for this tenant/date range
      const { error: delErr } = await supabaseAdmin
        .from('xero_profit_loss')
        .delete()
        .eq('organization_id', organizationId)
        .eq('xero_tenant_id', tenantUuid)
        .gte('from_date', fromDate)
        .lte('to_date', toDate);
      if (delErr) console.warn(`[XeroProcessor] P&L report delete error for ${tenantName}: ${delErr.message}`);

      // 1) Unscoped tenant P&L
      const unscoped = await pullMonthsForScope(tenantId, null);
      console.log(
        `[XeroProcessor] ${tenantName}: unscoped ${unscoped.monthCount} month(s), ${unscoped.accountRows.length} accounts`,
      );

      const unscopedResult = await upsertProfitLossRows(
        tenantUuid, tenantName, unscoped.accountRows, unscoped.periodDates, '',
      );
      totalProcessed += unscopedResult.inserted;
      totalFailed += unscopedResult.failed;

      // Synthetic invoices remain unscoped (tenant-level) for backward compat
      if (unscoped.accountRows.length > 0) {
        try {
          const synth = await writeSyntheticPlInvoices({
            organizationId, userId, integration,
            tenantUuid, tenantId, tenantName,
            accountRows: unscoped.accountRows,
            periodDates: unscoped.periodDates,
            tenantLocationMap, errors,
          });
          console.log(`[XeroProcessor] ${tenantName}: synthetic P&L → ${synth.invoices} invoices, ${synth.lines} line items, ${synth.failed} failed`);
          totalFailed += synth.failed;
        } catch (synthErr) {
          console.error(`[XeroProcessor] synthetic P&L write failed for ${tenantName}: ${synthErr.message}`);
          errors.push(`[${tenantName}] synthetic P&L: ${synthErr.message}`);
        }
      }

      // 2) Option-scoped P&L for each mapped tracking option (incl. Saint Catherine)
      const trackingScopes = await loadTenantTrackingOptionMaps(organizationId, tenantUuid);
      for (const scope of trackingScopes) {
        if (!scope.categoryId || !scope.optionId) {
          console.warn(`[XeroProcessor] ${tenantName}: skipping tracking scope missing categoryId (option=${scope.optionId})`);
          continue;
        }
        try {
          const scoped = await pullMonthsForScope(tenantId, scope);
          const scopedResult = await upsertProfitLossRows(
            tenantUuid, tenantName, scoped.accountRows, scoped.periodDates, scope.optionId,
          );
          console.log(
            `[XeroProcessor] ${tenantName}: option ${scope.optionId} → ${scopedResult.inserted} P&L rows`,
          );
          totalProcessed += scopedResult.inserted;
          totalFailed += scopedResult.failed;
        } catch (scopeErr) {
          if (scopeErr.isRateLimit || scopeErr.message === 'RATE_LIMIT_EXHAUSTED') throw scopeErr;
          console.error(`[XeroProcessor] P&L option ${scope.optionId} failed for ${tenantName}: ${scopeErr.message}`);
          totalFailed += 1;
          errors.push(`[${tenantName}] option ${scope.optionId}: ${scopeErr.message}`);
        }
      }
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] P&L report sync error for ${tenantName}: ${tenantErr.message}`);
      totalFailed += 1;
      errors.push(`[${tenantName}] ${tenantErr.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Write the PL_SYNTHETIC invoices + line items for one tenant from already-
 * parsed P&L report data (accountRows × periodDates). This is the format the
 * frontend cost readers consume; the dedicated xero_profit_loss table (written
 * by syncProfitLossReport above) is the raw archive. Same row shapes as the
 * original syncProfitLoss implementation:
 *   - invoice per (tenant, month): platform_invoice_id `pl_<tenantGuid>_<YYYY-MM>`,
 *     xero_tenant_id = the Xero tenant GUID (platform_org_id — what the
 *     frontend's location mapping resolves to), invoice_date = month end.
 *   - line per (account, month) with amount ≠ 0: account_code resolved via the
 *     synced chart of accounts; amounts kept positive so SUM matches Xero's P&L.
 * Idempotent: deletes the tenant's existing synthetic invoices first (CASCADE
 * drops their line items), then upserts.
 */
async function writeSyntheticPlInvoices({
  organizationId, userId, integration,
  tenantUuid, tenantId, tenantName,
  accountRows, periodDates, tenantLocationMap, errors,
}) {
  // Resolve accountId → account_code via our synced COA so line items match
  // what users map in the Cost Impact settings.
  const accountIdToCode = new Map();
  const uniqAccountIds = [...new Set(accountRows.map(r => r.accountId).filter(Boolean))];
  for (let i = 0; i < uniqAccountIds.length; i += 500) {
    const chunk = uniqAccountIds.slice(i, i + 500);
    const { data: coa } = await supabaseAdmin
      .from('xero_chart_of_accounts')
      .select('xero_account_id, account_code')
      .eq('organization_id', organizationId)
      .eq('platform_integration_id', integration.id)
      .eq('xero_tenant_id', tenantUuid)
      .in('xero_account_id', chunk);
    (coa || []).forEach(c => {
      if (c.xero_account_id && c.account_code) accountIdToCode.set(c.xero_account_id, c.account_code);
    });
  }

  // Wipe the tenant's existing synthetic invoices — CASCADE drops line items.
  const { error: delErr } = await supabaseAdmin
    .from('xero_invoices')
    .delete()
    .eq('organization_id', organizationId)
    .eq('xero_tenant_id', tenantId)
    .eq('invoice_type', 'PL_SYNTHETIC');
  if (delErr) console.warn(`[XeroProcessor] PL_SYNTHETIC delete error for ${tenantName}: ${delErr.message}`);

  const nowIso = new Date().toISOString();
  const invoiceRows = periodDates.filter(Boolean).map(periodDate => ({
    organization_id:     organizationId,
    xero_tenant_id:      tenantId,
    location_id:         tenantLocationMap.get(String(tenantUuid)) || null,
    user_id:             userId,
    platform_invoice_id: `pl_${tenantId}_${periodDate.slice(0, 7)}`,
    xero_invoice_id:     null,
    invoice_number:      `PL ${periodDate.slice(0, 7)}`,
    invoice_type:        'PL_SYNTHETIC',
    reference:           'Xero P&L synthetic row',
    invoice_date:        periodDate,
    due_date:            null,
    paid_date:           null,
    status:              'posted',
    is_paid:             false,
    currency:            'GBP',
    currency_rate:       1.0,
    subtotal:            0,
    tax_amount:          0,
    total_amount:        0,
    amount_paid:         0,
    amount_due:          0,
    sync_status:         'synced',
    last_synced_at:      nowIso,
  }));
  if (invoiceRows.length === 0) return { invoices: 0, lines: 0, failed: 0 };

  const invoiceIdByPeriod = new Map();
  let invoices = 0;
  let failed = 0;
  for (let i = 0; i < invoiceRows.length; i += BATCH_SIZE) {
    const chunk = invoiceRows.slice(i, i + BATCH_SIZE);
    const { data: inserted, error } = await supabaseAdmin
      .from('xero_invoices')
      .upsert(chunk, { onConflict: 'organization_id,xero_tenant_id,platform_invoice_id', ignoreDuplicates: false })
      .select('id, invoice_date');
    if (error) {
      failed += chunk.length;
      errors.push(`[${tenantName}] PL_SYNTHETIC invoices: ${error.message}`);
      continue;
    }
    invoices += inserted?.length || 0;
    (inserted || []).forEach(row => invoiceIdByPeriod.set(row.invoice_date, row.id));
  }

  const lineItemRows = [];
  for (const row of accountRows) {
    const code = row.accountId ? accountIdToCode.get(row.accountId) : null;
    if (!code) continue; // skip unmapped rows (totals, headers, etc.)
    for (let p = 0; p < periodDates.length; p++) {
      const periodDate = periodDates[p];
      if (!periodDate) continue;
      const amount = Number(row.amounts[p]) || 0;
      if (amount === 0) continue;
      const invoiceUuid = invoiceIdByPeriod.get(periodDate);
      if (!invoiceUuid) continue;
      lineItemRows.push({
        organization_id: organizationId,
        invoice_id:      invoiceUuid,
        platform_line_id: `${row.accountId}_${periodDate}`,
        line_number:     lineItemRows.length + 1,
        description:     row.label || null,
        account_id:      row.accountId,
        account_code:    code,
        line_amount:     amount,
        tax_amount:      0,
        quantity:        1,
        unit_amount:     amount,
      });
    }
  }

  let lines = 0;
  for (let i = 0; i < lineItemRows.length; i += BATCH_SIZE) {
    const chunk = lineItemRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('xero_invoice_line_items')
      .upsert(chunk, { onConflict: 'organization_id,platform_line_id', ignoreDuplicates: false });
    if (error) {
      failed += chunk.length;
      errors.push(`[${tenantName}] PL_SYNTHETIC lines: ${error.message}`);
      continue;
    }
    lines += chunk.length;
  }

  return { invoices, lines, failed };
}

function isCashBankSectionTitle(title) {
  const t = (title || '').toLowerCase();
  return (
    t.includes('cash at bank') ||
    t === 'bank' ||
    t.includes('bank and in hand') ||
    t.includes('bank account')
  );
}

/** Inclusive month count between YYYY-MM-DD bounds (same logic as the BS/P&L loops). */
function countMonthsInclusive(fromDate, toDate) {
  const startY = Number(fromDate.slice(0, 4));
  const startM = Number(fromDate.slice(5, 7));
  const endY   = Number(toDate.slice(0, 4));
  const endM   = Number(toDate.slice(5, 7));
  return (endY - startY) * 12 + (endM - startM) + 1;
}

/**
 * Walk a Xero Bank Summary report and return Map<accountId, closingBalance>.
 * Used to fill BANK/CREDITCARD accounts that Xero omits from the Balance Sheet
 * "Bank" / "Cash at bank" sections (e.g. BarclayCard).
 * CREDITCARD closings are stored negated to match Reports/BalanceSheet sign
 * convention (cashflow edge functions negate CREDITCARD again when summing).
 */
function parseBankSummaryClosingBalances(report) {
  const out = new Map();
  function walk(rows) {
    for (const r of rows || []) {
      if (r.RowType === 'Section' || r.RowType === 'Header') {
        walk(r.Rows);
        continue;
      }
      if ((r.RowType === 'Row' || r.RowType === 'SummaryRow') && Array.isArray(r.Cells) && r.Cells.length > 1) {
        const first = r.Cells[0] || {};
        const attrs = first.Attributes || [];
        const accountId = (
          attrs.find((a) => String(a.Id || '').toLowerCase() === 'accountid') ||
          attrs.find((a) => String(a.Id || '').toLowerCase() === 'account') ||
          attrs.find((a) => a.Id === 'accountID')
        )?.Value || null;
        if (!accountId) continue;
        // Closing balance is typically the last numeric cell (Opening, Received, Spent, Closing).
        let closing = null;
        for (let i = r.Cells.length - 1; i >= 1; i--) {
          const raw = r.Cells[i]?.Value;
          if (raw == null || String(raw).trim() === '') continue;
          const n = Number(raw);
          if (!Number.isNaN(n)) {
            closing = n;
            break;
          }
        }
        if (closing == null) continue;
        out.set(String(accountId), closing);
      }
    }
  }
  walk(report?.Rows);
  return out;
}

/**
 * Sync Xero Balance Sheet snapshots (month-end) into xero_balance_sheet.
 * Persists the FULL month-end Balance Sheet (Current Assets, Liabilities, Equity, etc.)
 * so Growth liquidity/solvency ratios can be computed client-side.
 *
 * Cash/bank rows are still tagged under "Cash at bank and in hand" when the account
 * is a BANK/CREDITCARD COA (or sits in a cash section) so cashflow-report filters
 * continue to work unchanged.
 */
async function syncBalanceSheetReport(job, integration) {
  const { organization_id: organizationId, user_id: userId } = job;

  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integration.id)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (tenantsErr) throw new Error(`Failed to fetch Xero tenants: ${tenantsErr.message}`);
  if (!tenants || tenants.length === 0) return { processed: 0, failed: 0 };

  const { startDate: settingsStart, endDate: settingsEnd } = getXeroDateRange(job);
  const ymd = (d) => (d ? String(d).slice(0, 10) : null);
  const fromDate = ymd(job.start_date || settingsStart);
  const toDate   = ymd(job.end_date   || settingsEnd);

  if (!fromDate || !toDate) {
    throw new Error('Balance Sheet report sync requires fromDate and toDate in the Xero sync date range settings or job overrides');
  }

  const monthsPerTenant = countMonthsInclusive(fromDate, toDate);
  const totalMonthSlots = monthsPerTenant * tenants.length;

  await logger.updatePageProgress(job.id, {
    currentPage:       0,
    totalPages:        totalMonthSlots,
    recordsProcessed:  0,
    recordsFailed:     0,
  });

  console.log(`[XeroProcessor] Syncing Balance Sheet for ${tenants.length} tenant(s): ${fromDate} → ${toDate} (${monthsPerTenant} month(s) each)`);

  // Re-read integration row so token refresh sees the latest tokens/lock state.
  const { data: freshIntegration } = await supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected')
    .eq('id', integration.id)
    .single();

  // Pre-warm/validate the token. xeroGet derives + refreshes the token per
  // request from the INTEGRATION ROW (not a token string). Passing the
  // accessToken string to xeroGet — as this function used to — made xeroGet's
  // internal getOrRefreshToken destructure `access_token` off a string
  // (→ undefined) and throw "No Xero access_token found. Please reconnect Xero."
  const activeIntegration = freshIntegration || integration;
  await getOrRefreshToken(activeIntegration);
  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];
  let   monthSlot    = 0;

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantId, platform_org_name: tenantName } = tenant;
    console.log(`[XeroProcessor] Fetching Balance Sheet for tenant: ${tenantName}`);

    try {
      const startY = Number(fromDate.slice(0, 4));
      const startM = Number(fromDate.slice(5, 7));
      const endY   = Number(toDate.slice(0, 4));
      const endM   = Number(toDate.slice(5, 7));

      const accountRows     = [];
      const accountRowByKey = new Map();
      const periodDates     = [];
      let   monthCount      = 0;

      for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDay    = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const monthEnd   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        periodDates.push(monthEnd);
        const periodIndex = monthCount++;

        const path = `/Reports/BalanceSheet?date=${monthEnd}`;
        const data = await xeroGet(activeIntegration, tenantId, path);
        const report = data?.Reports?.[0];

        monthSlot++;
        await logger.updatePageProgress(job.id, {
          currentPage:      monthSlot,
          totalPages:       totalMonthSlots,
          recordsProcessed: totalProcessed,
          recordsFailed:    totalFailed,
        });

        if (report) {
          // Known BANK / CREDITCARD accounts for this tenant — capture even if Xero
          // places them outside the standard "Cash at bank" section (e.g. BarclayCard).
          const { data: bankCoaRows } = await supabaseAdmin
            .from('xero_chart_of_accounts')
            .select('xero_account_id, account_type, bank_account_type')
            .eq('organization_id', organizationId)
            .eq('platform_integration_id', integration.id)
            .eq('xero_tenant_id', tenantUuid)
            .eq('is_active', true);
          const bankCoaIds = new Set();
          for (const row of bankCoaRows || []) {
            const type = String(row.account_type || '').trim().toUpperCase();
            const bankType = String(row.bank_account_type || '').trim().toUpperCase();
            if (bankType || type === 'BANK' || type === 'CREDITCARD') {
              if (row.xero_account_id) bankCoaIds.add(String(row.xero_account_id));
            }
          }

          function pushAccountAmount(accountId, sectionLabel, amount) {
            if (!accountId) return;
            const key = `id:${accountId}`;
            // Bank/CC always stored under cash section so cashflow-report BS filters include them.
            const forceCashSection = bankCoaIds.has(String(accountId));
            const resolvedSection = forceCashSection
              ? 'Cash at bank and in hand'
              : (sectionLabel || 'Other');
            if (!accountRowByKey.has(key)) {
              accountRowByKey.set(key, accountRows.length);
              accountRows.push({
                section: resolvedSection,
                accountId,
                amounts: new Array(monthCount - 1).fill(0),
                touched: new Array(monthCount - 1).fill(false),
              });
            }
            const idx = accountRowByKey.get(key);
            while (accountRows[idx].amounts.length < periodIndex) {
              accountRows[idx].amounts.push(0);
              accountRows[idx].touched.push(false);
            }
            accountRows[idx].amounts[periodIndex] = amount;
            accountRows[idx].touched[periodIndex] = true;
            accountRows[idx].section = resolvedSection;
          }

          function walkBS(rows, sectionLabel, inCashSection) {
            for (const r of (rows || [])) {
              if (r.RowType === 'Section') {
                const title = r.Title || sectionLabel;
                const childInCash = inCashSection || isCashBankSectionTitle(title);
                walkBS(r.Rows, title, childInCash);
              } else if (r.RowType === 'Row' && Array.isArray(r.Cells) && r.Cells.length > 1) {
                const attrs = r.Cells[0]?.Attributes || [];
                const accountId = (
                  attrs.find(a => a.Id === 'account') ||
                  attrs.find(a => a.Id === 'accountID') ||
                  attrs.find(a => String(a.Id || '').toLowerCase() === 'accountid')
                )?.Value || null;
                if (!accountId) continue;
                const amount = Number(r.Cells[1]?.Value) || 0;
                // Persist ALL BS account rows (full sheet). Cash tagging handled in pushAccountAmount.
                pushAccountAmount(
                  accountId,
                  inCashSection ? (sectionLabel || 'Cash at bank and in hand') : (sectionLabel || 'Other'),
                  amount
                );
              }
            }
          }
          walkBS(report.Rows, null, false);

          // Bank Summary fallback: credit cards / bank accounts omitted from BS entirely.
          // Do NOT overlay Bank Summary over accounts already on the BS — Reports/BalanceSheet
          // CREDITCARD signs are inverted vs Bank Summary/journals, and cashflow-report /
          // statement-report negate CREDITCARD when summing. Mixing conventions breaks totals.
          const missingBankIds = [...bankCoaIds].filter((id) => {
            const key = `id:${id}`;
            if (!accountRowByKey.has(key)) return true;
            const idx = accountRowByKey.get(key);
            return !accountRows[idx].touched?.[periodIndex];
          });
          if (missingBankIds.length > 0) {
            try {
              const bsPath = `/Reports/BankSummary?fromDate=${monthStart}&toDate=${monthEnd}`;
              const bsData = await xeroGet(activeIntegration, tenantId, bsPath);
              const bankSummary = bsData?.Reports?.[0];
              const closingByAccount = parseBankSummaryClosingBalances(bankSummary);
              let filled = 0;
              for (const id of missingBankIds) {
                if (!closingByAccount.has(id)) continue;
                // Bank Summary uses journal/Excel signs. Store negated for CREDITCARD so
                // it matches Reports/BalanceSheet convention (report layer negates again).
                const coa = (bankCoaRows || []).find((r) => String(r.xero_account_id) === id);
                const bankType = String(coa?.bank_account_type || '').trim().toUpperCase();
                const accType = String(coa?.account_type || '').trim().toUpperCase();
                const isCc = bankType === 'CREDITCARD' || accType === 'CREDITCARD';
                const closing = Number(closingByAccount.get(id)) || 0;
                pushAccountAmount(
                  id,
                  'Cash at bank and in hand',
                  isCc ? -closing : closing
                );
                filled++;
              }
              if (filled > 0) {
                console.log(
                  `[XeroProcessor] ${tenantName} ${monthEnd}: Bank Summary filled ${filled}/${missingBankIds.length} missing bank/CC account(s)`
                );
              }
              await sleep(350);
            } catch (bsErr) {
              console.warn(
                `[XeroProcessor] ${tenantName} ${monthEnd}: Bank Summary fallback failed: ${bsErr.message}`
              );
            }
          }

          // Preserve prior DB / prior-month balances for bank/CC still missing after
          // BS + Bank Summary — otherwise re-sync wipes cards like BarclayCard.
          const stillMissingBankIds = [...bankCoaIds].filter((id) => {
            const key = `id:${id}`;
            if (!accountRowByKey.has(key)) return true;
            const idx = accountRowByKey.get(key);
            return !accountRows[idx].touched?.[periodIndex];
          });
          if (stillMissingBankIds.length > 0) {
            const { data: priorBs } = await supabaseAdmin
              .from('xero_balance_sheet')
              .select('xero_account_id, amount')
              .eq('organization_id', organizationId)
              .eq('xero_tenant_id', tenantUuid)
              .eq('to_date', monthEnd)
              .in('xero_account_id', stillMissingBankIds);
            const restored = new Set();
            for (const row of priorBs || []) {
              const id = String(row.xero_account_id || '');
              if (!id) continue;
              pushAccountAmount(id, 'Cash at bank and in hand', Number(row.amount) || 0);
              restored.add(id);
            }
            for (const id of stillMissingBankIds) {
              if (restored.has(id)) continue;
              const key = `id:${id}`;
              if (!accountRowByKey.has(key) || periodIndex < 1) continue;
              const idx = accountRowByKey.get(key);
              if (!accountRows[idx].touched?.[periodIndex - 1]) continue;
              pushAccountAmount(
                id,
                'Cash at bank and in hand',
                Number(accountRows[idx].amounts[periodIndex - 1]) || 0
              );
            }
            if (restored.size > 0) {
              console.log(
                `[XeroProcessor] ${tenantName} ${monthEnd}: preserved ${restored.size} bank/CC balance(s) from prior BS`
              );
            }
          }
        }

        for (const row of accountRows) {
          while (row.amounts.length < monthCount) row.amounts.push(0);
          if (!Array.isArray(row.touched)) row.touched = [];
          while (row.touched.length < monthCount) row.touched.push(false);
        }

        m++;
        if (m > 12) { m = 1; y++; }
        await sleep(350);
      }

      console.log(`[XeroProcessor] ${tenantName}: BS ${monthCount} month(s), ${accountRows.length} account(s) (full Balance Sheet)`);
      if (accountRows.length === 0) {
        console.warn(`[XeroProcessor] ${tenantName}: no accounts found on Balance Sheet — check Xero report layout`);
        continue;
      }

      const { error: delErr } = await supabaseAdmin
        .from('xero_balance_sheet')
        .delete()
        .eq('organization_id', organizationId)
        .eq('xero_tenant_id', tenantUuid)
        .gte('from_date', fromDate)
        .lte('to_date', toDate);
      if (delErr) console.warn(`[XeroProcessor] BS delete error for ${tenantName}: ${delErr.message}`);

      const rows = [];
      for (const row of accountRows) {
        for (let p = 0; p < periodDates.length; p++) {
          const amount = Number(row.amounts[p]) || 0;
          const toDateStr   = periodDates[p];
          const fromDateStr = `${toDateStr.slice(0, 7)}-01`;
          rows.push({
            organization_id:         organizationId,
            platform_integration_id: integration.id,
            xero_tenant_id:          tenantUuid,
            user_id:                 userId,
            from_date:               fromDateStr,
            to_date:                 toDateStr,
            period_year:             Number(toDateStr.slice(0, 4)),
            period_month:            Number(toDateStr.slice(5, 7)),
            section:                 row.section || 'Cash at bank and in hand',
            xero_account_id:         row.accountId,
            amount,
            synced_at:               new Date().toISOString(),
          });
        }
      }

      let inserted = 0;
      let failed   = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('xero_balance_sheet')
          .upsert(chunk, { onConflict: 'organization_id,xero_tenant_id,xero_account_id,to_date', ignoreDuplicates: false });
        if (!error) { inserted += chunk.length; continue; }
        for (const single of chunk) {
          const { error: rowErr } = await supabaseAdmin
            .from('xero_balance_sheet')
            .upsert(single, { onConflict: 'organization_id,xero_tenant_id,xero_account_id,to_date', ignoreDuplicates: false });
          if (rowErr) { failed++; errors.push(`[${tenantName}] BS ${single.xero_account_id} ${single.to_date}: ${rowErr.message}`); }
          else inserted++;
        }
      }

      console.log(`[XeroProcessor] ${tenantName}: ${inserted} BS rows upserted, ${failed} failed`);
      totalProcessed += inserted;
      totalFailed    += failed;
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] Balance Sheet sync error for ${tenantName}: ${tenantErr.message}`);
      totalFailed += 1;
      errors.push(`[${tenantName}] ${tenantErr.message}`);
    }
  }

  return { processed: totalProcessed, failed: totalFailed, errors, totalPages: totalMonthSlots };
}

/**
 * Fetch the active Xero tenants for the org + integration triggering this job.
 * Returns [] when nothing's wired up (not fatal — caller logs and returns 0).
 *
 * Selects `id` (our UUID, needed as FK into legacy platform_* tables) and
 * `platform_org_id` (the Xero tenant GUID used as the `Xero-tenant-id` header).
 */
async function loadActiveXeroTenants(organizationId, integrationId) {
  const { data, error } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_id, platform_org_name')
    .eq('organization_id', organizationId)
    .eq('platform_integration_id', integrationId)
    .eq('platform_name', 'xero')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to fetch Xero tenants: ${error.message}`);
  return data || [];
}

/**
 * Build a map of Xero tenant (platform_integration_organizations.id) → practice
 * location_id, from the Practice Location Mapping (platform_integration_organization_mapping).
 * Used to stamp each invoice with the location of the Xero org it came from, so the
 * app no longer has to resolve location client-side. Returns an empty Map on error
 * (sync must never fail just because a mapping is missing → location stays null).
 */
async function loadTenantLocationMap(organizationId) {
  const map = new Map();
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id, location_id')
      .eq('organization_id', organizationId);
    if (error) {
      console.warn(`[XeroProcessor] Could not load tenant→location map: ${error.message}`);
      return map;
    }
    for (const row of data || []) {
      if (row.platform_integration_organizations_id && row.location_id) {
        map.set(String(row.platform_integration_organizations_id), String(row.location_id));
      }
    }
  } catch (e) {
    console.warn(`[XeroProcessor] Could not load tenant→location map: ${e.message}`);
  }
  return map;
}

/**
 * Shared helper — upsert rows into a table in BATCH_SIZE chunks, falling back
 * to per-row upserts when a chunk fails (so one bad row doesn't sink a page).
 */
async function upsertWithFallback(tableName, rows, onConflict, tenantName, tenantErrors) {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from(tableName)
      .upsert(chunk, { onConflict, ignoreDuplicates: false });

    if (!error) {
      processed += chunk.length;
      continue;
    }

    console.warn(`[XeroProcessor] ${tenantName}: ${tableName} batch upsert failed (${error.message}); row-by-row retry`);
    tenantErrors.push(`${tableName} batch: ${error.message}`);

    for (const single of chunk) {
      const { error: rowErr } = await supabaseAdmin
        .from(tableName)
        .upsert(single, { onConflict, ignoreDuplicates: false });
      if (rowErr) {
        failed += 1;
        tenantErrors.push(`${tableName} row: ${rowErr.message}`);
      } else {
        processed += 1;
      }
    }
  }

  return { processed, failed };
}

/**
 * Sync Bank Transactions for Xero tenants belonging to the triggered integration.
 */
async function syncBankTransactions(job, integration) {
  const { organization_id: organizationId } = job;
  const tenants = await loadActiveXeroTenants(organizationId, integration.id);

  if (tenants.length === 0) {
    console.log(`[XeroProcessor] No active Xero tenants for org ${organizationId}`);
    return { processed: 0, failed: 0 };
  }

  const modifiedSince = getXeroModifiedSince(job, integration);
  console.log(`[XeroProcessor] Syncing BankTransactions for ${tenants.length} tenant(s) since ${modifiedSince || '(all)'}`);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantGuid, platform_org_name: tenantName } = tenant;
    const tenantErrors = [];
    let tenantProcessed = 0;
    let tenantFailed    = 0;
    let page = 1;

    try {
      while (page <= MAX_PAGES_PER_JOB) {
        const { items, hasMore } = await xeroGetPagedIfModified(
          integration, tenantGuid, '/BankTransactions', page, modifiedSince,
        );
        console.log(`[XeroProcessor] ${tenantName}: BankTransactions page ${page} → ${items.length}`);

        if (items.length > 0) {
          const seen = new Set();
          const rows = [];
          for (const txn of items) {
            if (!txn.BankTransactionID || seen.has(txn.BankTransactionID)) continue;
            seen.add(txn.BankTransactionID);
            const { tracking, tracking_option_ids } = extractBankTransactionTracking(txn);
            rows.push({
              organization_id:                      organizationId,
              platform_integration_id:              integration.id,
              platform_integration_organization_id: tenantUuid,
              bank_transaction_id:                  txn.BankTransactionID,
              bank_account_id:                      txn.BankAccount?.AccountID || null,
              bank_account_name:                    txn.BankAccount?.Name      || null,
              type:                                 txn.Type                   || null,
              is_reconciled:                        txn.IsReconciled || false,
              has_attachments:                      txn.HasAttachments || false,
              contact_id:                           txn.Contact?.ContactID || null,
              contact_name:                         txn.Contact?.Name      || null,
              transaction_date:                     parseXeroDate(txn.Date),
              status:                               txn.Status             || null,
              line_amount_types:                    txn.LineAmountTypes    || null,
              sub_total:                            txn.SubTotal ?? 0,
              total_tax:                            txn.TotalTax ?? 0,
              total:                                txn.Total    ?? 0,
              currency_code:                        txn.CurrencyCode || null,
              updated_date_utc:                     parseXeroDateTime(txn.UpdatedDateUTC),
              tracking,
              tracking_option_ids,
            });
          }

          const { processed, failed } = await upsertWithFallback(
            'xero_bank_transactions',
            rows,
            'organization_id,platform_integration_organization_id,bank_transaction_id',
            tenantName,
            tenantErrors,
          );
          tenantProcessed += processed;
          tenantFailed    += failed;
        }

        if (!hasMore || items.length === 0) break;
        page++;
        await sleep(300);
      }

      console.log(`[XeroProcessor] ${tenantName}: ${tenantProcessed} bank transactions upserted, ${tenantFailed} failed`);
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] BankTransactions error for ${tenantName}: ${tenantErr.message}`);
      tenantFailed += 1;
      tenantErrors.push(tenantErr.message);
    }

    totalProcessed += tenantProcessed;
    totalFailed    += tenantFailed;
    if (tenantErrors.length > 0) errors.push(`[${tenantName}] ${tenantErrors.join('; ')}`);
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Credit Notes (and their allocations + payments) for Xero tenants.
 * Writes into xero_credit_notes, xero_credit_note_allocations,
 * and xero_payments (transaction_type='CreditNotePayment').
 */
async function syncCreditNotes(job, integration) {
  const { organization_id: organizationId } = job;
  const tenants = await loadActiveXeroTenants(organizationId, integration.id);

  if (tenants.length === 0) return { processed: 0, failed: 0 };

  const modifiedSince = getXeroModifiedSince(job, integration);
  console.log(`[XeroProcessor] Syncing CreditNotes for ${tenants.length} tenant(s) since ${modifiedSince || '(all)'}`);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantGuid, platform_org_name: tenantName } = tenant;
    const tenantErrors = [];
    let tenantProcessed = 0;
    let tenantFailed    = 0;
    let page = 1;

    try {
      while (page <= MAX_PAGES_PER_JOB) {
        const { items, hasMore } = await xeroGetPagedIfModified(
          integration, tenantGuid, '/CreditNotes', page, modifiedSince,
        );
        console.log(`[XeroProcessor] ${tenantName}: CreditNotes page ${page} → ${items.length}`);

        if (items.length > 0) {
          // Dedupe by CreditNoteID within the page.
          const seen = new Set();
          const unique = [];
          for (const cn of items) {
            if (!cn.CreditNoteID || seen.has(cn.CreditNoteID)) continue;
            seen.add(cn.CreditNoteID);
            unique.push(cn);
          }

          const headerRows = unique.map(cn => ({
            organization_id:                      organizationId,
            platform_integration_id:              integration.id,
            platform_integration_organization_id: tenantUuid,
            credit_note_id:                       cn.CreditNoteID,
            credit_note_number:                   cn.CreditNoteNumber || cn.CreditNoteID, // NOT NULL column
            account_type:                         cn.Type || '',                          // NOT NULL column
            credit_note_reference:                cn.Reference || null,
            fully_paid_on_date:                   parseXeroDate(cn.FullyPaidOnDate),
            credit_note_date:                     parseXeroDate(cn.Date),
            sub_total:                            cn.SubTotal        ?? 0,
            total_tax:                            cn.TotalTax        ?? 0,
            total:                                cn.Total           ?? 0,
            remaining_credit:                     cn.RemainingCredit ?? 0,
            currency_rate:                        cn.CurrencyRate    ?? 0,
            currency_code:                        cn.CurrencyCode    || null,
            payment_id:                           cn.Payments?.[0]?.PaymentID || null,
            payment_date:                         parseXeroDate(cn.Payments?.[0]?.Date),
            payment_amount:                       cn.Payments?.[0]?.Amount    ?? 0,
            payment_reference:                    cn.Payments?.[0]?.Reference || null,
            allocation_id:                        cn.Allocations?.[0]?.AllocationID || null,
            allocation_amount:                    cn.Allocations?.[0]?.Amount       ?? 0,
            allocation_date:                      parseXeroDate(cn.Allocations?.[0]?.Date),
            invoice_id:                           cn.Allocations?.[0]?.Invoice?.InvoiceID     || null,
            invoice_number:                       cn.Allocations?.[0]?.Invoice?.InvoiceNumber || null,
            contact_id:                           cn.Contact?.ContactID || null,
            contact_name:                         cn.Contact?.Name      || null,
            status:                               cn.Status || null,
            updated_date_utc:                     parseXeroDateTime(cn.UpdatedDateUTC),
          }));

          // Upsert headers and capture UUIDs for allocation FK.
          const headerIdByCreditNoteId = new Map();
          for (let i = 0; i < headerRows.length; i += BATCH_SIZE) {
            const chunk = headerRows.slice(i, i + BATCH_SIZE);
            const { data: inserted, error } = await supabaseAdmin
              .from('xero_credit_notes')
              .upsert(chunk, {
                onConflict: 'organization_id,platform_integration_organization_id,credit_note_id',
                ignoreDuplicates: false,
              })
              .select('id, credit_note_id');

            if (!error) {
              tenantProcessed += inserted?.length || 0;
              (inserted || []).forEach(r => headerIdByCreditNoteId.set(r.credit_note_id, r.id));
              continue;
            }

            console.warn(`[XeroProcessor] ${tenantName}: credit_notes batch failed (${error.message}); row retry`);
            tenantErrors.push(`credit_notes batch: ${error.message}`);
            for (const single of chunk) {
              const { data: ins, error: rowErr } = await supabaseAdmin
                .from('xero_credit_notes')
                .upsert(single, {
                  onConflict: 'organization_id,platform_integration_organization_id,credit_note_id',
                  ignoreDuplicates: false,
                })
                .select('id, credit_note_id');
              if (rowErr) {
                tenantFailed += 1;
                tenantErrors.push(`credit_note ${single.credit_note_id}: ${rowErr.message}`);
              } else {
                tenantProcessed += ins?.length || 0;
                (ins || []).forEach(r => headerIdByCreditNoteId.set(r.credit_note_id, r.id));
              }
            }
          }

          // Allocations — one row per allocation, FK to parent credit note UUID.
          const allocationRows = [];
          for (const cn of unique) {
            const parentUuid = headerIdByCreditNoteId.get(cn.CreditNoteID);
            if (!parentUuid || !Array.isArray(cn.Allocations)) continue;
            for (const alloc of cn.Allocations) {
              if (!alloc.AllocationID) continue;
              allocationRows.push({
                organization_id:                      organizationId,
                platform_integration_id:              integration.id,
                platform_integration_organization_id: tenantUuid,
                credit_note_id:                       parentUuid,
                platform_credit_note_id:              cn.CreditNoteID,
                allocation_id:                        alloc.AllocationID,
                allocation_amount:                    alloc.Amount ?? 0,
                allocation_date:                      parseXeroDate(alloc.Date) || parseXeroDate(cn.Date) || new Date().toISOString().slice(0, 10),
                invoice_id:                           alloc.Invoice?.InvoiceID     || null,
                invoice_number:                       alloc.Invoice?.InvoiceNumber || null,
              });
            }
          }

          if (allocationRows.length > 0) {
            const { processed, failed } = await upsertWithFallback(
              'xero_credit_note_allocations',
              allocationRows,
              'organization_id,platform_integration_organization_id,platform_credit_note_id,allocation_id',
              tenantName,
              tenantErrors,
            );
            console.log(`[XeroProcessor] ${tenantName}: ${processed} CN allocations upserted, ${failed} failed`);
            tenantFailed += failed;
          }

          // Payments — transaction_type='CreditNotePayment'. invoice_id column
          // here stores the string credit-note ID (matches edge function shape).
          const paymentRows = [];
          for (const cn of unique) {
            if (!Array.isArray(cn.Payments)) continue;
            for (const pay of cn.Payments) {
              if (!pay.PaymentID) continue;
              paymentRows.push({
                organization_id:                      organizationId,
                platform_integration_id:              integration.id,
                platform_integration_organization_id: tenantUuid,
                payment_id:                           pay.PaymentID,
                invoice_id:                           cn.CreditNoteID,
                accounts_payable_invoice_id:          null,
                payment_date:                         parseXeroDate(pay.Date),
                amount:                               pay.Amount ?? null,
                reference:                            pay.Reference || null,
                currency_rate:                        null,
                transaction_type:                     'CreditNotePayment',
              });
            }
          }

          if (paymentRows.length > 0) {
            const { processed, failed } = await upsertWithFallback(
              'xero_payments',
              paymentRows,
              'organization_id,platform_integration_organization_id,payment_id',
              tenantName,
              tenantErrors,
            );
            console.log(`[XeroProcessor] ${tenantName}: ${processed} CN payments upserted, ${failed} failed`);
            tenantFailed += failed;
          }
        }

        if (!hasMore || items.length === 0) break;
        page++;
        await sleep(300);
      }

      console.log(`[XeroProcessor] ${tenantName}: ${tenantProcessed} credit notes upserted, ${tenantFailed} failed`);
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] CreditNotes error for ${tenantName}: ${tenantErr.message}`);
      tenantFailed += 1;
      tenantErrors.push(tenantErr.message);
    }

    totalProcessed += tenantProcessed;
    totalFailed    += tenantFailed;
    if (tenantErrors.length > 0) errors.push(`[${tenantName}] ${tenantErrors.join('; ')}`);
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Overpayments (and their payments) for Xero tenants.
 */
async function syncOverpayments(job, integration) {
  const { organization_id: organizationId } = job;
  const tenants = await loadActiveXeroTenants(organizationId, integration.id);

  if (tenants.length === 0) return { processed: 0, failed: 0 };

  const modifiedSince = getXeroModifiedSince(job, integration);
  console.log(`[XeroProcessor] Syncing Overpayments for ${tenants.length} tenant(s) since ${modifiedSince || '(all)'}`);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantGuid, platform_org_name: tenantName } = tenant;
    const tenantErrors = [];
    let tenantProcessed = 0;
    let tenantFailed    = 0;
    let page = 1;

    try {
      while (page <= MAX_PAGES_PER_JOB) {
        const { items, hasMore } = await xeroGetPagedIfModified(
          integration, tenantGuid, '/Overpayments', page, modifiedSince,
        );
        console.log(`[XeroProcessor] ${tenantName}: Overpayments page ${page} → ${items.length}`);

        if (items.length > 0) {
          const seen = new Set();
          const unique = [];
          for (const op of items) {
            if (!op.OverpaymentID || seen.has(op.OverpaymentID)) continue;
            seen.add(op.OverpaymentID);
            unique.push(op);
          }

          // xero_overpayments has NOT-NULL `overpayment_date` and
          // `updated_date_utc` — fall back to current timestamp when Xero
          // omits them (matches edge-function behaviour, avoids rejects).
          const nowIso = new Date().toISOString();
          const rows = unique.map(op => ({
            organization_id:                      organizationId,
            platform_integration_id:              integration.id,
            platform_integration_organization_id: tenantUuid,
            overpayment_id:                       op.OverpaymentID,
            account_type:                         op.Type || null,
            remaining_credit:                     op.RemainingCredit ?? 0,
            sub_total:                            op.SubTotal        ?? 0,
            total_tax:                            op.TotalTax        ?? 0,
            total:                                op.Total           ?? 0,
            currency_code:                        op.CurrencyCode || null,
            contact_id:                           op.Contact?.ContactID || null,
            contact_name:                         op.Contact?.Name      || null,
            overpayment_date:                     parseXeroDate(op.Date) || nowIso.slice(0, 10),
            status:                               op.Status || null,
            line_amount_types:                    op.LineAmountTypes || null,
            updated_date_utc:                     parseXeroDateTime(op.UpdatedDateUTC) || nowIso,
          }));

          const { processed, failed } = await upsertWithFallback(
            'xero_overpayments',
            rows,
            'organization_id,platform_integration_organization_id,overpayment_id',
            tenantName,
            tenantErrors,
          );
          tenantProcessed += processed;
          tenantFailed    += failed;

          // Payments tied to overpayments.
          const paymentRows = [];
          for (const op of unique) {
            if (!Array.isArray(op.Payments)) continue;
            for (const pay of op.Payments) {
              if (!pay.PaymentID) continue;
              paymentRows.push({
                organization_id:                      organizationId,
                platform_integration_id:              integration.id,
                platform_integration_organization_id: tenantUuid,
                payment_id:                           pay.PaymentID,
                invoice_id:                           pay.Invoice?.InvoiceID || op.OverpaymentID,
                accounts_payable_invoice_id:          null,
                payment_date:                         parseXeroDate(pay.Date),
                amount:                               pay.Amount ?? null,
                reference:                            pay.Reference || null,
                currency_rate:                        pay.CurrencyRate ?? null,
                transaction_type:                     'OverPayment',
              });
            }
          }

          if (paymentRows.length > 0) {
            const { processed: pp, failed: pf } = await upsertWithFallback(
              'xero_payments',
              paymentRows,
              'organization_id,platform_integration_organization_id,payment_id',
              tenantName,
              tenantErrors,
            );
            console.log(`[XeroProcessor] ${tenantName}: ${pp} OP payments upserted, ${pf} failed`);
            tenantFailed += pf;
          }
        }

        if (!hasMore || items.length === 0) break;
        page++;
        await sleep(300);
      }

      console.log(`[XeroProcessor] ${tenantName}: ${tenantProcessed} overpayments upserted, ${tenantFailed} failed`);
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] Overpayments error for ${tenantName}: ${tenantErr.message}`);
      tenantFailed += 1;
      tenantErrors.push(tenantErr.message);
    }

    totalProcessed += tenantProcessed;
    totalFailed    += tenantFailed;
    if (tenantErrors.length > 0) errors.push(`[${tenantName}] ${tenantErrors.join('; ')}`);
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Sync Journals (offset-paginated) for Xero tenants. Writes to xero_journals
 * and xero_journal_details. Journals are Xero's full-fidelity financial feed:
 * every invoice, bill, payment, credit note, manual journal, bank receipt or
 * transfer posts here. This is what a P&L is actually built from.
 */
async function syncJournals(job, integration) {
  const { organization_id: organizationId } = job;
  const tenants = await loadActiveXeroTenants(organizationId, integration.id);

  if (tenants.length === 0) return { processed: 0, failed: 0 };

  const modifiedSince = getXeroModifiedSince(job, integration);
  console.log(`[XeroProcessor] Syncing Journals for ${tenants.length} tenant(s) since ${modifiedSince || '(all)'}`);

  await getOrRefreshToken(integration); // pre-warm/validate token; per-request refresh handled in the Xero client

  let totalProcessed = 0;
  let totalFailed    = 0;
  const errors       = [];

  for (const tenant of tenants) {
    const { id: tenantUuid, platform_org_id: tenantGuid, platform_org_name: tenantName } = tenant;
    const tenantErrors = [];
    let tenantProcessed = 0;
    let tenantFailed    = 0;
    let offset = null;
    let safetyIter = 0;
    const MAX_ITER = MAX_PAGES_PER_JOB;

    try {
      while (safetyIter++ < MAX_ITER) {
        const { items, nextOffset, hasMore } = await xeroGetJournalsOffset(
          integration, tenantGuid, offset, modifiedSince,
        );
        console.log(`[XeroProcessor] ${tenantName}: Journals offset=${offset ?? 0} → ${items.length}`);

        if (items.length === 0) break;

        // Dedupe by JournalID within the page.
        const seen = new Set();
        const unique = [];
        for (const j of items) {
          if (!j.JournalID || seen.has(j.JournalID)) continue;
          seen.add(j.JournalID);
          unique.push(j);
        }

        // Headers — capture UUID per JournalID so journal_details can FK them.
        const nowIso = new Date().toISOString();
        const headerRows = unique.map(j => ({
          organization_id:                      organizationId,
          platform_integration_id:              integration.id,
          platform_integration_organization_id: tenantUuid,
          journal_id:                           j.JournalID,
          journal_number:                       j.JournalNumber ?? 0, // NOT NULL
          journal_date:                         parseXeroDate(j.JournalDate) || nowIso.slice(0, 10), // NOT NULL
          platform_created_date_utc:            parseXeroDateTime(j.CreatedDateUTC) || nowIso,        // NOT NULL
          reference:                            j.Reference || null,
          source_id:                            j.SourceID   || null,
          source_type:                          j.SourceType || '',  // NOT NULL
          source_type_desc:                     journalSourceTypeDesc(j.SourceType),
          total_amount:                         0,
          due_amount:                           0,
        }));

        const headerIdByJournalId = new Map();
        for (let i = 0; i < headerRows.length; i += BATCH_SIZE) {
          const chunk = headerRows.slice(i, i + BATCH_SIZE);
          const { data: inserted, error } = await supabaseAdmin
            .from('xero_journals')
            .upsert(chunk, {
              onConflict: 'organization_id,platform_integration_organization_id,journal_id',
              ignoreDuplicates: false,
            })
            .select('id, journal_id');

          if (!error) {
            tenantProcessed += inserted?.length || 0;
            (inserted || []).forEach(r => headerIdByJournalId.set(r.journal_id, r.id));
            continue;
          }

          console.warn(`[XeroProcessor] ${tenantName}: journals batch failed (${error.message}); row retry`);
          tenantErrors.push(`journals batch: ${error.message}`);
          for (const single of chunk) {
            const { data: ins, error: rowErr } = await supabaseAdmin
              .from('xero_journals')
              .upsert(single, {
                onConflict: 'organization_id,platform_integration_organization_id,journal_id',
                ignoreDuplicates: false,
              })
              .select('id, journal_id');
            if (rowErr) {
              tenantFailed += 1;
              tenantErrors.push(`journal ${single.journal_id}: ${rowErr.message}`);
            } else {
              tenantProcessed += ins?.length || 0;
              (ins || []).forEach(r => headerIdByJournalId.set(r.journal_id, r.id));
            }
          }
        }

        // Detail lines — carry forward first non-empty description when a
        // specific line has none (matches edge-function behaviour).
        const detailRows = [];
        for (const j of unique) {
          const parentUuid = headerIdByJournalId.get(j.JournalID);
          if (!parentUuid || !Array.isArray(j.JournalLines)) continue;
          const fallbackDesc = j.JournalLines.find(l => l?.Description)?.Description || null;
          const journalDate = parseXeroDate(j.JournalDate) || nowIso.slice(0, 10);
          for (const line of j.JournalLines) {
            if (!line.JournalLineID) continue;
            const { tracking, tracking_option_ids } = extractTrackingFields(line);
            detailRows.push({
              organization_id:                      organizationId,
              platform_integration_id:              integration.id,
              platform_integration_organization_id: tenantUuid,
              journal_id:                           parentUuid,
              journal_line_id:                      line.JournalLineID,
              source_id:                            j.SourceID   || null,
              platform_journal_id:                  j.JournalID,
              account_id:                           line.AccountID   || null,
              account_code:                         line.AccountCode || null,
              account_type:                         line.AccountType || null,
              account_name:                         line.AccountName || null,
              description:                          line.Description || fallbackDesc,
              net_amount:                           line.NetAmount   ?? null,
              gross_amount:                         line.GrossAmount ?? null,
              tax_amount:                           line.TaxAmount   ?? null,
              tax_type:                             line.TaxType || null,
              tax_name:                             line.TaxName || null,
              journal_date:                         journalDate,
              tracking,
              tracking_option_ids,
            });
          }
        }

        if (detailRows.length > 0) {
          const { processed, failed } = await upsertWithFallback(
            'xero_journal_details',
            detailRows,
            'organization_id,platform_integration_organization_id,platform_journal_id,journal_line_id',
            tenantName,
            tenantErrors,
          );
          console.log(`[XeroProcessor] ${tenantName}: ${processed} journal lines upserted, ${failed} failed`);
          tenantFailed += failed;
        }

        if (!hasMore || nextOffset == null) break;
        offset = nextOffset;
        await sleep(300);
      }

      console.log(`[XeroProcessor] ${tenantName}: ${tenantProcessed} journals upserted, ${tenantFailed} failed`);
    } catch (tenantErr) {
      if (tenantErr.isRateLimit || tenantErr.message === 'RATE_LIMIT_EXHAUSTED') throw tenantErr;
      console.error(`[XeroProcessor] Journals error for ${tenantName}: ${tenantErr.message}`);
      tenantFailed += 1;
      tenantErrors.push(tenantErr.message);
    }

    totalProcessed += tenantProcessed;
    totalFailed    += tenantFailed;
    if (tenantErrors.length > 0) errors.push(`[${tenantName}] ${tenantErrors.join('; ')}`);
  }

  return { processed: totalProcessed, failed: totalFailed, errors };
}

/**
 * Process a single Xero sync job.
 */
async function processXeroSyncJob(job, integration, cancelTokens) {
  const entityAlias = job.entity_alias || 'xero_chart_of_accounts';
  console.log(`[XeroProcessor] Starting job ${job.id}: ${entityAlias}`);

  try {
    await logger.markRunning(job.id);

    if (cancelTokens.get(job.id)) {
      await logger.markCancelled(job.id);
      return;
    }

    let result;

    switch (entityAlias) {
      case 'xero_chart_of_accounts':
        result = await syncChartOfAccounts(job, integration);
        break;
      case 'xero_tracking_categories':
        result = await syncTrackingCategories(job, integration);
        break;
      case 'xero_invoices':
        result = await syncInvoices(job, integration);
        break;
      case 'xero_bank_transactions':
        result = await syncBankTransactions(job, integration);
        break;
      case 'xero_credit_notes':
        result = await syncCreditNotes(job, integration);
        break;
      case 'xero_overpayments':
        result = await syncOverpayments(job, integration);
        break;
      case 'xero_journals':
        result = await syncJournals(job, integration);
        break;
      case 'xero_profit_loss':
        result = await syncProfitLossReport(job, integration);
        break;
      case 'xero_balance_sheet':
        result = await syncBalanceSheetReport(job, integration);
        break;
      default:
        throw new Error(`Unknown Xero entity alias: ${entityAlias}`);
    }

    if (cancelTokens.get(job.id)) {
      await logger.markCancelled(job.id);
      return;
    }

    // Canonical finance_accounts from xero_chart_of_accounts
    if (entityAlias === 'xero_chart_of_accounts' && result.processed > 0) {
      try {
        const sourceId = await ensureFinanceDataSource(job.organization_id, integration.id);
        if (sourceId) {
          const canon = await syncAccountsFromXeroChartTable(
            job.organization_id,
            sourceId,
            integration.id,
          );
          console.log(`[XeroProcessor] Canonical COA rows upserted: ${canon.upserted}`);
        }
      } catch (canonErr) {
        console.warn('[XeroProcessor] Canonical COA sync failed (non-fatal):', canonErr?.message || canonErr);
      }
    }

    // Canonical finance_journal_entries / _lines from Xero invoices + line items
    if (entityAlias === 'xero_invoices' && result.processed > 0) {
      try {
        const sourceId = await ensureFinanceDataSource(job.organization_id, integration.id);
        if (sourceId) {
          const canonJournal = await syncJournalsFromXeroInvoices(
            job.organization_id,
            sourceId,
            integration.id,
          );
          if (canonJournal.error) {
            console.warn('[XeroProcessor] Canonical journals sync failed (non-fatal):', canonJournal.error);
          } else {
            console.log(
              `[XeroProcessor] Canonical journals synced: invoices=${canonJournal.sourceRowCount}, ` +
              `entries=${canonJournal.journalEntriesUpserted}, lines=${canonJournal.journalLinesUpserted}, ` +
              `lineCandidates=${canonJournal.mappedLineCandidates}, ` +
              `skipNoAccount=${canonJournal.skippedNoAccount}, ` +
              `skipNoJournalMap=${canonJournal.skippedNoJournalMap}` +
              (canonJournal.skippedReason ? ` (${canonJournal.skippedReason})` : ''),
            );
          }
        }
      } catch (canonErr) {
        console.warn('[XeroProcessor] Canonical journal sync exception (non-fatal):', canonErr?.message || canonErr);
      }
    }

    await logger.markCompleted(job.id, {
      recordsProcessed: result.processed,
      recordsFailed:    result.failed,
      currentPage:      result.totalPages || 1,
      totalPages:       result.totalPages || 1,
      // Surface partial-failure details (per-tenant / per-batch errors) so
      // the sync_jobs.error_message field shows what went wrong even when
      // the overall job completed.
      errorMessage: Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors.join(' | ').substring(0, 2000)
        : null,
    });

    // Update last_synced_at on the connection
    await supabaseAdmin
      .from('platform_integrations')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', integration.id);

    console.log(`[XeroProcessor] ${entityAlias}: ${result.processed} synced, ${result.failed} failed`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[XeroProcessor] Job ${job.id} error:`, errorMessage);

    // Rate limit exhausted: pause and re-queue (not counted as retry)
    if (error.isRateLimit || errorMessage === 'RATE_LIMIT_EXHAUSTED') {
      console.log(`[XeroProcessor] Job ${job.id}: Rate limit exhausted, pausing for re-queue`);
      await logger.markRetry(job.id, job.retry_count || 0, 'Rate limit paused — will resume automatically');
      return 'rate_limited';
    }

    // Dead refresh token (user disconnected the app in Xero, 60-day idle, or
    // revoked consent). Retrying will never succeed — the user must reconnect
    // through the OAuth flow. Mark the integration as disconnected so the
    // scheduler stops enqueuing jobs for it, clear the stale tokens, and fail
    // the job immediately without consuming retry attempts.
    const isDeadRefreshToken =
      /invalid_grant/i.test(errorMessage) ||
      /Refresh token not found/i.test(errorMessage) ||
      /Xero token refresh failed \(400\)/i.test(errorMessage);

    if (isDeadRefreshToken && job.integration_id) {
      console.warn(
        `[XeroProcessor] Xero refresh token is dead for integration ${job.integration_id}. ` +
          'Marking integration as disconnected — user must reconnect Xero. Failing job without retry.',
      );
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
        console.error(
          `[XeroProcessor] Failed to flag integration ${job.integration_id} as disconnected:`,
          flagErr instanceof Error ? flagErr.message : String(flagErr),
        );
      }
      await logger.markFailed(
        job.id,
        'Xero refresh token is no longer valid. Please reconnect Xero to resume syncing.',
      );
      return 'failed';
    }

    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries  || 3;

    if (retryCount <= maxRetries) {
      console.log(`[XeroProcessor] Queuing job ${job.id} for retry (${retryCount}/${maxRetries})`);
      await logger.markRetry(job.id, retryCount, errorMessage);
      return 'retry';
    } else {
      await logger.markFailed(job.id, errorMessage);
      return 'failed';
    }
  }
}

module.exports = { processXeroSyncJob };
