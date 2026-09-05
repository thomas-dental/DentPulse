/**
 * Pure text-level parser for Practice Plan monthly statement PDFs — takes the
 * reading-order text LINES of the document (extracted by
 * practicePlanPdfParser.ts via pdf.js) and produces membership rows. Kept free
 * of pdf.js imports so it can be exercised directly in Node against sample
 * statements.
 *
 * See practicePlanPdfParser.ts for the statement layout and the mapping
 * rationale (pay_grp_id = Practice Plan patient id, patient_id left null).
 */
import type { MembershipParseResult, ParsedMembershipRow } from './membershipFileParser';

export interface PracticePlanBreakdownRow {
  code: string;
  description: string;
  price: number;
  monthly: number;
  annual: number;
  total: number;
}

/**
 * A row from the statement's "Failed Collections" or "Cancelled Patients"
 * section. These are informational (not collected revenue) but they are the
 * only place the practice's DD failures and plan cancellations appear at all,
 * so they are captured rather than skipped. Layouts vary slightly between
 * statement versions — rawLine always preserves the original text.
 */
export interface PracticePlanStatementEventRow {
  eventType: 'failed_collection' | 'cancelled_patient';
  /** Practice Plan's own patient id (same id space as pay_grp_id on member rows). */
  ppPatientId: string;
  surname: string;
  title: string | null;
  initial: string;
  dob: string | null; // YYYY-MM-DD
  planCode: string | null;
  amount: number | null;
  /** A non-DOB date on the row (e.g. cancellation date) when one is present. */
  eventDate: string | null; // YYYY-MM-DD
  rawLine: string;
}

/** One "Label [count] £value" line from the statement's Summary page. */
export interface PracticePlanSummaryLine {
  label: string;
  count: number | null;
  value: number;
}

export interface PracticePlanParseResult extends MembershipParseResult {
  /** 1-12 when the "Statement for <Month> <Year>" header was found. */
  statementMonth: number | null;
  statementYear: number | null;
  planBreakdown: PracticePlanBreakdownRow[];
  failedCollections: PracticePlanStatementEventRow[];
  cancelledPatients: PracticePlanStatementEventRow[];
  summaryLines: PracticePlanSummaryLine[];
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const TITLE_TOKENS = new Set([
  'mr', 'mrs', 'miss', 'ms', 'mx', 'dr', 'master', 'mstr', 'prof', 'rev', 'sir', 'lady', 'lord',
]);

/** DD/MM/YYYY → YYYY-MM-DD (Practice Plan prints UK dates). */
function ukDateToISO(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseAmount(v: string): number {
  const n = parseFloat(v.replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Split a statement "Name" blob into surname / title / given names.
 * The layout is `<Surname(s)> <Title> <Given names>` — e.g.
 *   "Edwards Mrs Linda M"      → surname "Edwards",      title "Mrs", given "Linda M"
 *   "Bailey Wells Ms Delilah"  → surname "Bailey Wells", title "Ms",  given "Delilah"
 *   "Dixon, Mrs Lindsey"       → surname "Dixon",        title "Mrs", given "Lindsey"
 * If no title token is found the first token is treated as the surname.
 */
function splitName(blob: string): { surname: string; title: string | null; given: string } {
  const tokens = blob.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const titleIdx = tokens.findIndex(t => TITLE_TOKENS.has(t.toLowerCase().replace(/\.$/, '')));
  if (titleIdx > 0) {
    return {
      surname: tokens.slice(0, titleIdx).join(' '),
      title: tokens[titleIdx].replace(/\.$/, ''),
      given: tokens.slice(titleIdx + 1).join(' '),
    };
  }
  return { surname: tokens[0] ?? blob.trim(), title: null, given: tokens.slice(1).join(' ') };
}

// A member collection row:
//   <PatientID> <Name…> <PlanCode> <Freq> [<Disc>] [£]<Amount> <By> [<Paid By>] [<DOB>]
// The lazy name group + the amount anchor resolve middle-initial ambiguity
// ("Edwards Mrs Linda M A M £12.54" → code "A", freq "M"). The £ is OPTIONAL —
// some Practice Plan statement templates print amounts with no currency symbol
// at all (confirmed on a March 2026 statement where every amount column,
// including the Summary page, is a bare number).
const COLLECTION_ROW_RE =
  /^(\d{4,10})\s+(.+?)\s+([A-Za-z]{1,6})\s+([MAQW])\s+(?:(\d{1,3}(?:\.\d+)?)\s*%?\s+)?£?([\d,]+\.\d{2})\s*(.*)$/;

const BREAKDOWN_ROW_RE = /^(\S{1,6})\s+(.+?)\s+([\d,]+\.\d{2})\s+(\d+)\s+(\d+)\s+(\d+)$/;

/**
 * Parse one Failed Collections / Cancelled Patients row. Tries the member
 * collection-row layout first (these sections usually share it), then falls
 * back to a loose `<PatientID> <rest>` parse that pulls out whatever £amounts
 * and DD/MM/YYYY dates are present. Never throws, never emits warnings — these
 * sections are informational and must not block a statement import.
 */
function parseStatementEventRow(
  line: string,
  eventType: PracticePlanStatementEventRow['eventType'],
  knownCodes: Set<string>,
  statementYear: number | null,
): PracticePlanStatementEventRow | null {
  // A statement-period date (failure/cancellation date) can't be a payer's
  // DOB — nobody born within a year of the statement pays a plan. Dates near
  // or after the statement year classify as event dates, older ones as DOB.
  const classifyDates = (dates: string[]): { dob: string | null; eventDate: string | null } => {
    let dob: string | null = null;
    let eventDate: string | null = null;
    for (const d of dates) {
      const iso = ukDateToISO(d);
      if (!iso) continue;
      const year = parseInt(iso.slice(0, 4), 10);
      if (statementYear != null && year >= statementYear - 1) eventDate = eventDate ?? iso;
      else dob = iso; // last non-recent date wins — DOB sits in the final column
    }
    return { dob, eventDate };
  };

  const strict = line.match(COLLECTION_ROW_RE);
  // Same guard as the collections parser: an unknown plan code means a
  // mis-split name token — fall back to the loose parse instead.
  if (strict && (knownCodes.size === 0 || knownCodes.has(strict[3].toLowerCase()))) {
    const [, ppPatientId, nameBlob, planCode, , , amount, tail] = strict;
    const { surname, title, given } = splitName(nameBlob);
    const { dob, eventDate } = classifyDates(tail.match(/\d{2}\/\d{2}\/\d{4}/g) ?? []);
    return {
      eventType, ppPatientId, surname, title, initial: given,
      dob, planCode, amount: parseAmount(amount), eventDate, rawLine: line,
    };
  }

  const loose = line.match(/^(\d{4,10})\s+(.+)$/);
  if (!loose) return null;
  const [, ppPatientId, rest] = loose;
  const amountMatch = rest.match(/£?([\d,]+\.\d{2})/);
  const { dob, eventDate } = classifyDates(rest.match(/\d{2}\/\d{2}\/\d{4}/g) ?? []);
  // The name runs up to the first data token (a £amount or a date).
  const cutCandidates = [rest.search(/£?[\d,]+\.\d{2}/), rest.search(/\d{2}\/\d{2}\/\d{4}/)]
    .filter(i => i >= 0);
  const nameEnd = cutCandidates.length > 0 ? Math.min(...cutCandidates) : rest.length;
  const nameBlob = rest.slice(0, nameEnd).trim();
  if (!nameBlob) return null;
  const { surname, title, given } = splitName(nameBlob);
  return {
    eventType, ppPatientId, surname, title, initial: given,
    dob,
    planCode: null,
    amount: amountMatch ? parseAmount(amountMatch[1]) : null,
    eventDate,
    rawLine: line,
  };
}

export function parsePracticePlanLines(allLines: string[], fileName: string): PracticePlanParseResult {
  const fullText = allLines.join('\n');
  const errors: string[] = [];

  // ── Statement month/year ("Statement for" then "July 2026") ──────────────
  let statementMonth: number | null = null;
  let statementYear: number | null = null;
  const stmt = fullText.match(/Statement\s+for\s*\n?\s*([A-Z][a-z]+)\s+(\d{4})/);
  if (stmt) {
    statementMonth = MONTHS[stmt[1].toLowerCase()] ?? null;
    statementYear = statementMonth ? parseInt(stmt[2], 10) : null;
  }
  if (!statementMonth) {
    errors.push('Could not read the statement month from the PDF — pick the month manually before importing.');
  }

  // ── Statement dentist (page header "… Dr Abygail Costello [90051252] …").
  // The char class excludes digits, so a leading "July 2026 " date prefix on
  // the page-header line can't be swallowed into the captured name.
  const dentistMatch = fullText.match(/([A-Z][a-zA-Z .'-]+?)\s*\[\d{4,}\]/);
  const treatingDentist = dentistMatch ? dentistMatch[1].trim() : '';

  // ── Expected totals from the Summary page (for reconciliation warnings) ──
  // e.g. "Existing Patient Collections 98 £2,895.34" / "New Patient Collections 0 £0.00"
  let expectedCount = 0;
  let expectedValue = 0;
  let haveExpected = false;
  for (const kind of ['New Patient Collections', 'Existing Patient Collections']) {
    const m = fullText.match(new RegExp(`^${kind}\\s+(\\d+)\\s+£?([\\d,]+\\.\\d{2})$`, 'm'));
    if (m) {
      expectedCount += parseInt(m[1], 10);
      expectedValue += parseAmount(m[2]);
      haveExpected = true;
    }
  }

  // ── Walk the lines with a section state machine ──────────────────────────
  type Section = 'none' | 'breakdown' | 'collections' | 'failed' | 'cancelled' | 'summary' | 'skip';
  let section: Section = 'none';
  const planBreakdown: PracticePlanBreakdownRow[] = [];
  const rows: ParsedMembershipRow[] = [];
  const failedCollections: PracticePlanStatementEventRow[] = [];
  const cancelledPatients: PracticePlanStatementEventRow[] = [];
  const summaryLines: PracticePlanSummaryLine[] = [];

  for (const line of allLines) {
    // Section headers. Headers must be EXACT — the Summary page has lines like
    // "New Patient Collections 0 £0.00" / "Failed Collections 2 £45.08" that
    // would otherwise flip the state mid-summary.
    if (/^Plan Breakdown$/i.test(line)) { section = 'breakdown'; continue; }
    if (/^(New|Existing) Patient Collections$/i.test(line)) { section = 'collections'; continue; }
    if (/^Failed Collections$/i.test(line)) { section = 'failed'; continue; }
    if (/^Cancelled Patients$/i.test(line)) { section = 'cancelled'; continue; }
    if (/^Summary$/i.test(line)) { section = 'summary'; continue; }
    // "Annual Payers" on some templates, "Annual Patients - May" / "Annual
    // Patients - Other Annuals" on others — match the whole family so annual
    // payer rows don't fall through into whatever section preceded them.
    if (/^(Annual Payers|Payments)$/i.test(line) || /^Annual Patients\b/i.test(line)) { section = 'skip'; continue; }
    if (/^Total Count:/i.test(line)) { section = 'none'; continue; }

    if (section === 'failed' || section === 'cancelled') {
      if (/^Patient ID\b/i.test(line) || /^Total\b/i.test(line)) continue;
      const knownCodes = new Set(planBreakdown.map(p => p.code.toLowerCase()));
      const ev = parseStatementEventRow(
        line,
        section === 'failed' ? 'failed_collection' : 'cancelled_patient',
        knownCodes,
        statementYear,
      );
      if (ev) (section === 'failed' ? failedCollections : cancelledPatients).push(ev);
      continue;
    }

    if (section === 'summary') {
      // "Label 12 £34.56" (count + value) or "Label £34.56" (value only).
      let m = line.match(/^([A-Za-z][A-Za-z .,'&/()-]*?)\s+(\d+)\s+(-)?£?([\d,]+\.\d{2})$/);
      if (m) {
        summaryLines.push({ label: m[1].trim(), count: parseInt(m[2], 10), value: (m[3] ? -1 : 1) * parseAmount(m[4]) });
        continue;
      }
      m = line.match(/^([A-Za-z][A-Za-z .,'&/()-]*?)\s+(-)?£?([\d,]+\.\d{2})$/);
      if (m) {
        summaryLines.push({ label: m[1].trim(), count: null, value: (m[2] ? -1 : 1) * parseAmount(m[3]) });
      }
      continue;
    }

    if (section === 'breakdown') {
      if (/^Totals\b/i.test(line)) { section = 'none'; continue; }
      if (/^Plan Code\b/i.test(line) || /^Current Patients$/i.test(line)) continue;
      const m = line.match(BREAKDOWN_ROW_RE);
      if (m) {
        planBreakdown.push({
          code: m[1],
          description: m[2].trim(),
          price: parseAmount(m[3]),
          monthly: parseInt(m[4], 10),
          annual: parseInt(m[5], 10),
          total: parseInt(m[6], 10),
        });
      }
      continue;
    }

    if (section !== 'collections') continue;
    if (/^Patient ID\b/i.test(line)) continue; // column header

    const m = line.match(COLLECTION_ROW_RE);
    if (!m) continue;
    const [, patientId, nameBlob, planCode, freq, disc, amount, tail] = m;

    // Validate the plan code against the breakdown when we have one — guards
    // against a mis-split name token being read as the code.
    if (planBreakdown.length > 0 && !planBreakdown.some(p => p.code.toLowerCase() === planCode.toLowerCase())) {
      errors.push(`Skipped row with unknown plan code "${planCode}": ${line}`);
      continue;
    }

    const { surname, title, given } = splitName(nameBlob);
    const dobMatch = tail.match(/(\d{2}\/\d{2}\/\d{4})\s*$/);
    const plan = planBreakdown.find(p => p.code.toLowerCase() === planCode.toLowerCase());

    rows.push({
      surname,
      initial: given,
      dob: dobMatch ? ukDateToISO(dobMatch[1]) : null,
      treating_dentist: treatingDentist,
      fee_category: plan?.description || planCode,
      discount_percent: disc ? parseFloat(disc) : 0,
      net_due: parseAmount(amount),
      // Practice Plan's own patient id — identity anchor for dedupe/replace.
      pay_grp_id: patientId,
      // NOT the Dentally legacy id — leave null so DB matching runs on DOB/surname.
      patient_id: null,
      title,
      pay_grp_size: null,
      multiple_payments: null,
      unpaid_payment: null,
      late_joiner: null,
      supplementary_insurance: null,
      implant_insurance: null,
      // Freq column: M = monthly, A = annual. An annual payer's collected
      // amount is not comparable to the plan's monthly list price — the
      // Practice Plan fee derivation must skip them. TEXT column (shared
      // with the Denplan sheet import), so 'Y'/null rather than a boolean.
      annual_payer: freq.toUpperCase() === 'A' ? 'Y' : null,
      explanatory_text: 'Practice Plan statement',
      source_facility_id: null,
    });
  }

  if (rows.length === 0) {
    errors.push('No member collection rows found — is this a Practice Plan monthly statement PDF?');
  } else if (haveExpected) {
    const value = Math.round(rows.reduce((s, r) => s + r.net_due, 0) * 100) / 100;
    if (rows.length !== expectedCount) {
      errors.push(`Parsed ${rows.length} member rows but the statement summary says ${expectedCount} — review before importing.`);
    }
    if (Math.abs(value - Math.round(expectedValue * 100) / 100) > 0.005) {
      errors.push(`Parsed total £${value.toFixed(2)} differs from the statement's Total Collected £${expectedValue.toFixed(2)} — review before importing.`);
    }
  }

  return {
    data: rows,
    errors,
    totalRows: rows.length,
    facilityId: null,
    fileName,
    statementMonth,
    statementYear,
    planBreakdown,
    failedCollections,
    cancelledPatients,
    summaryLines,
  };
}

/**
 * Rebuild reading-order text lines from one page's positioned text items:
 * group items sharing a y coordinate (±2.5pt) into one line, order items by x,
 * lines top-to-bottom (PDF y origin is bottom-left). Exported for the pdf.js
 * wrapper AND the Node-side sample test.
 */
export function itemsToLines(items: Array<{ str: string; x: number; y: number }>): string[] {
  const lines: Array<{ y: number; items: Array<{ str: string; x: number; y: number }> }> = [];
  for (const it of items) {
    if (it.str.trim() === '') continue;
    const line = lines.find(l => Math.abs(l.y - it.y) <= 2.5);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(l =>
    l.items.sort((a, b) => a.x - b.x).map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim(),
  );
}
