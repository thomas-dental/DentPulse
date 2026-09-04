/**
 * Compare Dentally invoices/payments vs PE DB, re-sync discrepancies, heal event_ledger.
 *
 * Usage:
 *   node backend/scripts/reconcilePeInvoicesPayments.js <practice_id>
 *   node backend/scripts/reconcilePeInvoicesPayments.js <practice_id> --compare-only
 *   node backend/scripts/reconcilePeInvoicesPayments.js <practice_id> --lookback-days=14
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const {
  fetchDentallyPage,
  fetchInvoiceDetailsBatch,
  extractRecords,
} = require('../api/dentally/client');
const { loadPracticePat } = require('../services/patientEconomics/sync/syncHelpers');
const { getDentallyBaseUrl } = require('../services/patientEconomics/validatePat');
const { getPracticeSyncRange } = require('../services/patientEconomics/sync/practiceSyncRange');
const {
  resetCursor,
  RESOURCE_INVOICES,
  RESOURCE_PAYMENTS,
  todayUtc,
} = require('../services/patientEconomics/sync/cursorStore');
const { syncInvoices } = require('../services/patientEconomics/sync/syncInvoices');
const { syncPayments } = require('../services/patientEconomics/sync/syncPayments');
const {
  backfillPracticeEventLedger,
} = require('../services/patientEconomics/sync/eventLedgerBackfill');

const practiceId = process.argv[2];
if (!practiceId) {
  console.error(
    'Usage: node reconcilePeInvoicesPayments.js <practice_id> [--compare-only] [--lookback-days=N]',
  );
  process.exit(1);
}

const compareOnly = process.argv.includes('--compare-only');
const lookbackArg = process.argv.find((a) => a.startsWith('--lookback-days='));
const lookbackDays = lookbackArg ? Number(lookbackArg.split('=')[1]) : null;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysAgoUtc(days) {
  const d = new Date(`${todayUtc()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, days));
  return d.toISOString().slice(0, 10);
}

async function countDb(table, column, practiceId) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, practiceId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function countLedger(practiceId, eventType) {
  const { count, error } = await supabaseAdmin
    .from('event_ledger')
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('event_type', eventType);
  if (error) throw new Error(`event_ledger ${eventType}: ${error.message}`);
  return count ?? 0;
}

async function dentallyMeta(pat, apiEndpoint, alias, startDate, endDate) {
  const responseData = await fetchDentallyPage(pat, apiEndpoint, alias, 1, startDate, endDate);
  const { records, totalPages, total } = extractRecords(responseData, alias);
  return {
    total: total ?? records.length,
    totalPages: totalPages ?? 1,
    sample: records || [],
  };
}

async function loadDbInvoicesByIds(practiceId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('platform_integration_invoices')
    .select(
      'platform_invoice_id, subtotal, total_amount, amount_outstanding, is_paid, invoice_date, patient_id, updated_at',
    )
    .eq('organization_id', practiceId)
    .in(
      'platform_invoice_id',
      ids.map((id) => String(id)),
    );
  if (error) throw new Error(`load invoices: ${error.message}`);
  return new Map((data || []).map((r) => [Number(r.platform_invoice_id), r]));
}

async function loadDbPaymentsByIds(practiceId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('dentally_payments')
    .select('dp_id, dp_amount, dp_dated_on, dp_patient_id, updated_at')
    .eq('organization_id', practiceId)
    .in('dp_id', ids);
  if (error) throw new Error(`load payments: ${error.message}`);
  return new Map((data || []).map((r) => [Number(r.dp_id), r]));
}

function compareInvoice(api, db) {
  const issues = [];
  if (!db) {
    issues.push('missing_in_db');
    return issues;
  }
  const apiOutstanding = num(api.amount_outstanding);
  const dbOutstanding = num(db.amount_outstanding);
  const apiPaid = api.paid === true || api.is_paid === true;
  const dbPaid = db.is_paid === true;
  const apiTotal = num(api.total ?? api.amount ?? api.subtotal);
  const dbTotal = num(db.total_amount ?? db.subtotal);

  if (apiOutstanding != null && dbOutstanding != null && Math.abs(apiOutstanding - dbOutstanding) > 0.01) {
    issues.push(`amount_outstanding api=${apiOutstanding} db=${dbOutstanding}`);
  }
  if (apiPaid !== dbPaid) {
    issues.push(`is_paid api=${apiPaid} db=${dbPaid}`);
  }
  if (apiTotal != null && dbTotal != null && Math.abs(apiTotal - dbTotal) > 0.01) {
    issues.push(`total api=${apiTotal} db=${dbTotal}`);
  }
  return issues;
}

function comparePayment(api, db) {
  const issues = [];
  if (!db) {
    issues.push('missing_in_db');
    return issues;
  }
  const apiAmount = num(api.amount ?? api.total);
  const dbAmount = num(db.dp_amount);
  if (apiAmount != null && dbAmount != null && Math.abs(apiAmount - dbAmount) > 0.01) {
    issues.push(`amount api=${apiAmount} db=${dbAmount}`);
  }
  return issues;
}

async function drainResource(label, syncFn, maxChunks = 2500) {
  let chunks = 0;
  let processed = 0;
  for (let i = 0; i < maxChunks; i += 1) {
    const result = await syncFn(practiceId);
    chunks += 1;
    processed += result.processed || 0;
    if (chunks % 10 === 0 || result.complete || !result.hasMore || !result.success) {
      console.log(
        `[reconcile] ${label} chunk ${chunks}:`,
        JSON.stringify({
          success: result.success,
          complete: result.complete,
          hasMore: result.hasMore,
          page: result.page,
          chunkStart: result.chunkStart,
          chunkEnd: result.chunkEnd,
          processed: result.processed,
          cursorStatus: result.cursorStatus,
          errorCode: result.errorCode,
        }),
      );
    }
    if (!result.success && result.errorCode !== 'RATE_LIMIT_RETRY') {
      throw new Error(`${label} sync failed: ${result.error || result.errorCode}`);
    }
    if (result.errorCode === 'RATE_LIMIT_RETRY') {
      const waitMs = 15_000;
      console.log(`[reconcile] ${label} rate-limited — waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (result.complete || !result.hasMore) {
      return { chunks, processed, complete: true };
    }
  }
  return { chunks, processed, complete: false };
}

async function main() {
  const range = await getPracticeSyncRange(practiceId);
  const endDate = todayUtc();
  const startDate =
    lookbackDays != null && Number.isFinite(lookbackDays)
      ? daysAgoUtc(lookbackDays)
      : range.startDate;

  console.log(
    JSON.stringify(
      {
        practiceId,
        compareOnly,
        window: { startDate, endDate },
        practiceRangeStart: range.startDate,
      },
      null,
      2,
    ),
  );

  const pat = await loadPracticePat(practiceId);
  const apiEndpoint = getDentallyBaseUrl();

  const [dbInvoices, dbPayments, dbExplanations, ledgerInvoice, ledgerPayment] =
    await Promise.all([
      countDb('platform_integration_invoices', 'organization_id', practiceId),
      countDb('dentally_payments', 'organization_id', practiceId),
      countDb('dentally_payment_explanations', 'organization_id', practiceId),
      countLedger(practiceId, 'INVOICE_RAISED'),
      countLedger(practiceId, 'PAYMENT_ALLOCATED'),
    ]);

  console.log('[reconcile] DB counts before:', {
    invoices: dbInvoices,
    payments: dbPayments,
    payment_explanations: dbExplanations,
    INVOICE_RAISED: ledgerInvoice,
    PAYMENT_ALLOCATED: ledgerPayment,
  });

  const invMeta = await dentallyMeta(pat, apiEndpoint, 'invoices', startDate, endDate);
  const payMeta = await dentallyMeta(pat, apiEndpoint, 'payments', startDate, endDate);

  console.log('[reconcile] Dentally window totals:', {
    invoices: invMeta.total,
    invoicePages: invMeta.totalPages,
    payments: payMeta.total,
    paymentPages: payMeta.totalPages,
  });

  // Sample recent pages (page 1) and compare field-level parity after detail enrich.
  const enrichedInvoices = await fetchInvoiceDetailsBatch(
    pat,
    apiEndpoint,
    invMeta.sample.slice(0, 25),
  );
  const invIds = enrichedInvoices.map((r) => Number(r.id)).filter(Number.isFinite);
  const payIds = payMeta.sample.map((r) => Number(r.id)).filter(Number.isFinite);
  const [dbInvMap, dbPayMap] = await Promise.all([
    loadDbInvoicesByIds(practiceId, invIds),
    loadDbPaymentsByIds(practiceId, payIds),
  ]);

  const invoiceMismatches = [];
  for (const api of enrichedInvoices) {
    const id = Number(api.id);
    const issues = compareInvoice(api, dbInvMap.get(id));
    if (issues.length) invoiceMismatches.push({ id, issues });
  }

  const paymentMismatches = [];
  for (const api of payMeta.sample) {
    const id = Number(api.id);
    const issues = comparePayment(api, dbPayMap.get(id));
    if (issues.length) paymentMismatches.push({ id, issues });
  }

  console.log('[reconcile] Sample mismatches:', {
    invoiceSampleSize: enrichedInvoices.length,
    invoiceMismatches: invoiceMismatches.length,
    paymentSampleSize: payMeta.sample.length,
    paymentMismatches: paymentMismatches.length,
    invoiceExamples: invoiceMismatches.slice(0, 8),
    paymentExamples: paymentMismatches.slice(0, 8),
  });

  const needsResync =
    invoiceMismatches.length > 0 ||
    paymentMismatches.length > 0 ||
    // If DB count for the practice is lower than Dentally window total, force resync.
    // (DB may also include older rows outside the compare window — only treat as signal when sample mismatches exist.)
    false;

  if (compareOnly) {
    console.log(JSON.stringify({ success: true, compareOnly: true, needsResync }, null, 2));
    return;
  }

  // Full re-pull from practice sync_start_date → today using monthly chunks
  // (same as kickoffFull). Do not pass a multi-month dateWindow — that becomes
  // one oversized chunk and can leave earlier months unprocessed.
  console.log('[reconcile] Resetting payment + invoice cursors (full monthly from practice start)…');
  await resetCursor(practiceId, RESOURCE_PAYMENTS, { kickoffMode: 'full' });
  await resetCursor(practiceId, RESOURCE_INVOICES, { kickoffMode: 'full' });

  if (lookbackDays != null && Number.isFinite(lookbackDays)) {
    const window = { chunkStart: startDate, chunkEnd: endDate };
    console.log('[reconcile] Overriding to lookback window:', window);
    await resetCursor(practiceId, RESOURCE_PAYMENTS, {
      dateWindow: window,
      kickoffMode: 'incremental',
    });
    await resetCursor(practiceId, RESOURCE_INVOICES, {
      dateWindow: window,
      kickoffMode: 'incremental',
    });
  }

  console.log('[reconcile] Draining payments…');
  const payDrain = await drainResource('payments', syncPayments);
  console.log('[reconcile] payments drain:', payDrain);

  console.log('[reconcile] Draining invoices (refreshes paid/outstanding from Dentally)…');
  const invDrain = await drainResource('invoices', syncInvoices);
  console.log('[reconcile] invoices drain:', invDrain);

  console.log('[reconcile] Backfilling event_ledger for invoices + payments…');
  const ledger = await backfillPracticeEventLedger(practiceId, {
    entities: ['invoices', 'payments'],
    onProgress: (p) => console.log('[reconcile] ledger progress:', JSON.stringify(p)),
  });

  const [dbInvoicesAfter, dbPaymentsAfter, ledgerInvoiceAfter, ledgerPaymentAfter] =
    await Promise.all([
      countDb('platform_integration_invoices', 'organization_id', practiceId),
      countDb('dentally_payments', 'organization_id', practiceId),
      countLedger(practiceId, 'INVOICE_RAISED'),
      countLedger(practiceId, 'PAYMENT_ALLOCATED'),
    ]);

  // Re-sample after sync
  const invMetaAfter = await dentallyMeta(pat, apiEndpoint, 'invoices', startDate, endDate);
  const enrichedAfter = await fetchInvoiceDetailsBatch(
    pat,
    apiEndpoint,
    invMetaAfter.sample.slice(0, 25),
  );
  const dbInvMapAfter = await loadDbInvoicesByIds(
    practiceId,
    enrichedAfter.map((r) => Number(r.id)).filter(Number.isFinite),
  );
  const invoiceMismatchesAfter = [];
  for (const api of enrichedAfter) {
    const id = Number(api.id);
    const issues = compareInvoice(api, dbInvMapAfter.get(id));
    if (issues.length) invoiceMismatchesAfter.push({ id, issues });
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        window: { startDate, endDate },
        drains: { payments: payDrain, invoices: invDrain },
        ledgerBackfill: ledger,
        countsAfter: {
          invoices: dbInvoicesAfter,
          payments: dbPaymentsAfter,
          INVOICE_RAISED: ledgerInvoiceAfter,
          PAYMENT_ALLOCATED: ledgerPaymentAfter,
        },
        sampleMismatchesAfter: {
          invoices: invoiceMismatchesAfter.length,
          examples: invoiceMismatchesAfter.slice(0, 8),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
