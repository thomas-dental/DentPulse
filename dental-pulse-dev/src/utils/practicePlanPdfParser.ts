/**
 * Practice Plan statement PDF parser.
 *
 * Practice Plan (practiceplan.co.uk, part of the Wesleyan Group) issues each
 * dentist a monthly "Statement for <Month> <Year>" PDF instead of a member
 * spreadsheet. The statement contains:
 *   - a Summary page (collection counts + values),
 *   - a "Plan Breakdown" table (plan code → description, price, member counts),
 *   - "Existing/New Patient Collections" tables — one row per paying member:
 *       Patient ID | Name | Plans | Freq | Disc | Amount | By | Paid By | D.O.B
 *   - "Failed Collections" and "Cancelled Patients" sections — not collected
 *     revenue, but the only visibility the practice gets of DD failures and
 *     plan cancellations, so they are parsed into event rows (persisted to
 *     membership_statement_events). "Annual Payers" stays skipped.
 *
 * The collection rows are converted into the SAME ParsedMembershipRow shape the
 * Denplan Excel/CSV upload produces, so the whole existing pipeline (patient
 * matching, preview, import into membership_upload_members, plan summaries)
 * works unchanged:
 *   - fee_category   = plan description from the Plan Breakdown (fallback: code)
 *   - net_due        = collected Amount
 *   - pay_grp_id     = Practice Plan patient id — the row's stable identity for
 *                      dedupe / replace-on-reimport. It is NOT stored in
 *                      patient_id: that column joins patients.legacy_id
 *                      (Dentally ids), and a non-matching value there would get
 *                      the row dropped from the saved view.
 *   - patient DB match happens downstream via DOB + surname (as for Denplan).
 *
 * This module is the pdf.js wrapper; the text-level parsing lives in
 * practicePlanPdfParser.core.ts (pure, Node-testable against sample PDFs).
 */
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToLines, parsePracticePlanLines, type PracticePlanParseResult } from './practicePlanPdfParser.core';

export type {
  PracticePlanParseResult,
  PracticePlanBreakdownRow,
  PracticePlanStatementEventRow,
  PracticePlanSummaryLine,
} from './practicePlanPdfParser.core';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

export async function parsePracticePlanPdf(file: File): Promise<PracticePlanParseResult> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const allLines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      allLines.push(...itemsToLines(
        (content.items as any[])
          .filter(it => typeof it.str === 'string')
          .map(it => ({ str: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number })),
      ));
    }
    return parsePracticePlanLines(allLines, file.name);
  } finally {
    doc.destroy();
  }
}
