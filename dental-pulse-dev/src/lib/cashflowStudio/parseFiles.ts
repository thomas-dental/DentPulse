/**
 * Cash Flow Scenario Studio — best-effort file parser.
 *
 * Turns messy finance exports (CSV / XLSX) into a Week-0 model. This is a
 * first-pass, demo-grade aggregator, not a full audit-trail engine:
 *   - Detects each file's kind from its name + headers (bank / AR / AP / PO /
 *     payroll / generic).
 *   - Classifies rows into the fixed receipt/disbursement categories by keyword.
 *   - Buckets amounts into the 13 weeks by the most relevant date column.
 *   - Flags anything it can't reconcile as an Exception and, when material,
 *     marks the model a DRAFT.
 *
 * When confidence is low it prefers to flag rather than silently guess.
 */

import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { finalizeModel, makeWeeks, weekIndexFor } from './buildModel';
import {
  WEEKS,
  RECEIPT_KEYS,
  DISBURSEMENT_KEYS,
  type CashFlowModel,
  type ExceptionRow,
  type InputInventoryRow,
  type ReceiptKey,
  type DisbursementKey,
  type WeekArray,
} from './types';

interface RawFile {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

type FileKind = 'bank' | 'ar' | 'ap' | 'po' | 'payroll' | 'generic';

const zeros = (): WeekArray => Array(WEEKS).fill(0);

// ── low-level readers ──────────────────────────────────────────────

async function readCsv(file: File): Promise<RawFile> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  return { name: file.name, headers, rows: parsed.data ?? [] };
}

async function readXlsx(file: File): Promise<RawFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  const rows = json.map((r) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v == null ? '' : String(v);
    return o;
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { name: file.name, headers, rows };
}

async function readFile(file: File): Promise<RawFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return readXlsx(file);
  return readCsv(file);
}

// ── column + value helpers ─────────────────────────────────────────

const findCol = (headers: string[], patterns: RegExp[]): string | null => {
  for (const p of patterns) {
    const hit = headers.find((h) => p.test(h));
    if (hit) return hit;
  }
  return null;
};

const AMOUNT_PATS = [/amount/i, /\bvalue\b/i, /\btotal\b/i, /gross/i, /\bnet\b/i, /balance change/i];
const DATE_PATS = [/expected/i, /due.?date/i, /run.?date/i, /settle/i, /payment.?date/i, /\bdate\b/i];
const BALANCE_PATS = [/running.?balance/i, /balance/i];
const DESC_PATS = [/description/i, /memo/i, /narrat/i, /detail/i, /vendor/i, /customer/i, /payee/i, /category/i, /type/i, /account/i, /name/i];
const STATUS_PATS = [/status/i, /state/i, /hold/i, /flag/i, /dispute/i];

function parseAmount(raw: string): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // yyyy-mm-dd (or with time)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // mm/dd/yyyy or dd/mm/yyyy — assume US mm/dd for the demo
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const a = m[1];
    const b = m[2];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  // fall back to Date parsing (handles "Jan 5 2026", ISO w/ tz, etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// ── file-kind detection ────────────────────────────────────────────

function detectKind(name: string, headers: string[]): FileKind {
  const n = name.toLowerCase();
  const h = headers.join(' ').toLowerCase();
  if (/bank|transaction|statement|ledger/.test(n) || /running.?balance/.test(h)) return 'bank';
  if (/\bar\b|receivable|aging|invoice|collection/.test(n) || /customer.*(due|expected)/.test(h))
    return 'ar';
  if (/\bap\b|payable|bills?/.test(n) || /vendor.*(due|hold)/.test(h)) return 'ap';
  if (/purchase|\bpo\b|order/.test(n) || /\bpo\b|expected.?receipt/.test(h)) return 'po';
  if (/payroll|salary|wages/.test(n)) return 'payroll';
  return 'generic';
}

// ── keyword → category classifiers ─────────────────────────────────

function classifyReceipt(text: string): ReceiptKey {
  const t = text.toLowerCase();
  if (/retail|card|pos|in.?store|settlement|terminal/.test(t)) return 'retailCard';
  if (/online|marketplace|amazon|shopify|ecom|e-com|web|payout|stripe|paypal/.test(t))
    return 'onlineMarketplace';
  if (/invoice|receivable|collection|customer|\bar\b/.test(t)) return 'arCollections';
  return 'otherReceipts';
}

function classifyDisbursement(text: string): DisbursementKey {
  const t = text.toLowerCase();
  if (/payroll|salary|wages|benefit|pension|401k/.test(t)) return 'payrollBenefits';
  if (/inventory|vendor|supplier|cogs|stock|goods|merchandise/.test(t))
    return 'inventoryVendorPayments';
  if (/rent|lease|facilit|utilit|premises/.test(t)) return 'rentFacilities';
  if (/marketing|advert|campaign|ad.?spend|promo/.test(t)) return 'marketingDiscretionary';
  if (/\btax\b|vat|hmrc|irs|duty|levy/.test(t)) return 'tax';
  if (/loan|debt|interest|principal|financ|repayment/.test(t)) return 'debtService';
  if (/subscription|saas|software|recurring|licen|hosting/.test(t)) return 'recurringPayments';
  if (/purchase.?order|\bpo\b|commitment/.test(t)) return 'purchaseCommitments';
  return 'operatingAP';
}

// ── main entry ─────────────────────────────────────────────────────

export interface ParseOptions {
  title?: string;
  currencySymbol?: string;
  asOfDate?: string; // ISO; else inferred from data
  threshold?: number; // default 750000
  openingCashOverride?: number;
}

export interface ParseResult {
  model: CashFlowModel;
  warnings: string[];
}

export async function parseFilesToModel(files: File[], opts: ParseOptions = {}): Promise<ParseResult> {
  const warnings: string[] = [];
  const raws: RawFile[] = [];
  for (const f of files) {
    try {
      raws.push(await readFile(f));
    } catch (e) {
      warnings.push(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  }

  const receipts = Object.fromEntries(RECEIPT_KEYS.map((k) => [k, zeros()])) as Record<
    ReceiptKey,
    WeekArray
  >;
  const disbursements = Object.fromEntries(DISBURSEMENT_KEYS.map((k) => [k, zeros()])) as Record<
    DisbursementKey,
    WeekArray
  >;

  const inventory: InputInventoryRow[] = [];
  const exceptions: ExceptionRow[] = [];
  const excludedItems: string[] = [];
  const assumptions: string[] = [
    'Amounts bucketed by the most relevant date column (expected → due → transaction).',
    'Rows classified into categories by keyword on description/type columns.',
  ];

  // Determine the forecast calendar first, from all dates seen.
  const allDates: string[] = [];
  for (const rf of raws) {
    const dateCol = findCol(rf.headers, DATE_PATS);
    if (!dateCol) continue;
    for (const r of rf.rows) {
      const d = parseDate(r[dateCol]);
      if (d) allDates.push(d);
    }
  }
  allDates.sort();
  const inferredAsOf =
    opts.asOfDate ?? allDates.find((d) => d >= todayISO()) ?? allDates[0] ?? todayISO();
  const weeks = makeWeeks(inferredAsOf);

  let openingCash = opts.openingCashOverride ?? 0;
  let openingResolved = opts.openingCashOverride != null;

  // Process each file.
  for (const rf of raws) {
    const kind = detectKind(rf.name, rf.headers);
    const amountCol = findCol(rf.headers, AMOUNT_PATS);
    const dateCol = findCol(rf.headers, DATE_PATS);
    const descCol = findCol(rf.headers, DESC_PATS);
    const statusCol = findCol(rf.headers, STATUS_PATS);
    const balanceCol = findCol(rf.headers, BALANCE_PATS);

    const dates = rf.rows.map((r) => (dateCol ? parseDate(r[dateCol]) : null)).filter(Boolean) as string[];
    dates.sort();
    const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : 'no dates found';

    let usage: InputInventoryRow['usage'] = 'Used';
    const issues: string[] = [];

    // Bank file → opening cash from the final running balance.
    if (kind === 'bank') {
      if (balanceCol && !opts.openingCashOverride) {
        // last row by date, or last row in file order
        const withDates = rf.rows
          .map((r, i) => ({ r, i, d: dateCol ? parseDate(r[dateCol]) : null }))
          .filter((x) => x.d);
        let chosen: Record<string, string> | undefined;
        if (withDates.length) {
          withDates.sort((a, b) => (a.d! < b.d! ? -1 : a.d! > b.d! ? 1 : a.i - b.i));
          chosen = withDates[withDates.length - 1].r;
        } else {
          chosen = rf.rows[rf.rows.length - 1];
        }
        const bal = chosen ? parseAmount(chosen[balanceCol]) : 0;
        if (bal) {
          openingCash = bal;
          openingResolved = true;
        } else {
          issues.push('running balance unreadable');
        }
      } else if (!balanceCol) {
        issues.push('no running_balance column');
      }
      usage = 'Partially used';
      inventory.push(
        invRow(rf, 'CSV/Excel', dateRange, 'Opening cash (running balance)', usage, issues),
      );
      continue;
    }

    if (!amountCol) {
      usage = 'Not used';
      issues.push('no amount column found');
      inventory.push(invRow(rf, 'CSV/Excel', dateRange, '—', usage, issues));
      warnings.push(`${rf.name}: no amount column — skipped.`);
      continue;
    }

    let scheduled = 0;
    let missingDate = 0;
    let excludedCount = 0;

    for (const r of rf.rows) {
      const amt = parseAmount(r[amountCol]);
      if (!amt) continue;
      const status = statusCol ? (r[statusCol] || '').toLowerCase() : '';
      const desc = descCol ? r[descCol] || '' : rf.name;

      // Exclusions per skill.
      if (kind === 'ap' && /hold|held/.test(status)) {
        excludedCount++;
        excludedItems.push(`Held AP — ${desc || rf.name}`);
        continue;
      }
      if (kind === 'ar' && /disput/.test(status)) {
        excludedCount++;
        excludedItems.push(`Disputed AR — ${desc || rf.name}`);
        continue;
      }
      if (kind === 'po' && /cancel/.test(status)) {
        excludedCount++;
        excludedItems.push(`Cancelled PO — ${desc || rf.name}`);
        continue;
      }

      const dateStr = dateCol ? parseDate(r[dateCol]) : null;
      if (!dateStr) {
        missingDate++;
        continue;
      }
      const wi = weekIndexFor(weeks, dateStr);
      if (wi < 0) continue; // outside the 13-week horizon

      // Direction + category.
      if (kind === 'ar') {
        receipts.arCollections[wi] += Math.abs(amt);
      } else if (kind === 'ap') {
        disbursements.operatingAP[wi] += Math.abs(amt);
      } else if (kind === 'po') {
        disbursements.purchaseCommitments[wi] += Math.abs(amt);
      } else if (kind === 'payroll') {
        disbursements.payrollBenefits[wi] += Math.abs(amt);
      } else {
        // generic: sign decides direction
        if (amt >= 0) {
          receipts[classifyReceipt(desc)][wi] += amt;
        } else {
          disbursements[classifyDisbursement(desc)][wi] += Math.abs(amt);
        }
      }
      scheduled++;
    }

    if (missingDate > 0) {
      issues.push(`${missingDate} rows missing a usable date`);
      exceptions.push({
        issueType: 'Missing due/expected dates',
        sourceFile: rf.name,
        sourceRef: `${missingDate} rows`,
        treatment: 'Not scheduled — held for review',
        cfoReview: kind === 'ap',
        category: 'warning',
      });
    }
    if (excludedCount > 0) issues.push(`${excludedCount} rows excluded (hold/dispute/cancel)`);
    if (scheduled === 0) {
      usage = 'Not used';
      warnings.push(`${rf.name}: nothing scheduled into the 13-week horizon.`);
    }

    inventory.push(
      invRow(rf, 'CSV/Excel', dateRange, forecastUseFor(kind), usage, issues),
    );
  }

  if (!openingResolved) {
    exceptions.push({
      issueType: 'Opening cash unresolved',
      sourceFile: 'bank export',
      treatment: 'No bank running balance found — opening cash assumed 0. Provide it manually.',
      cfoReview: true,
      category: 'cfo',
    });
    warnings.push('No opening cash could be derived from a bank file — set it manually.');
  }

  const model = finalizeModel({
    title: opts.title ?? 'Uploaded Model — 13-Week Cash Flow',
    currencySymbol: opts.currencySymbol ?? '$',
    asOfDate: inferredAsOf,
    threshold: opts.threshold ?? 750000,
    openingCash,
    openingCashResolved: openingResolved,
    weeks,
    receipts,
    disbursements,
    assumptions,
    excludedItems: dedupe(excludedItems).slice(0, 25),
    inventory,
    exceptions,
  });

  return { model, warnings };
}

// ── small helpers ──────────────────────────────────────────────────

function invRow(
  rf: RawFile,
  fileType: string,
  dateRange: string,
  forecastUse: string,
  usage: InputInventoryRow['usage'],
  issues: string[],
): InputInventoryRow {
  return {
    fileName: rf.name,
    fileType,
    rowCount: rf.rows.length,
    dateRange,
    mainColumns: rf.headers.slice(0, 6).join(', '),
    forecastUse,
    usage,
    issues: issues.length ? issues.join('; ') : 'none',
  };
}

function forecastUseFor(kind: FileKind): string {
  switch (kind) {
    case 'ar':
      return 'AR collections schedule';
    case 'ap':
      return 'Operating AP schedule';
    case 'po':
      return 'Purchase commitments';
    case 'payroll':
      return 'Payroll and benefits';
    default:
      return 'Mixed receipts / disbursements';
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
