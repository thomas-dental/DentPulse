/**
 * 13-Week Cash Flow Forecast — Excel (.xlsx) and PDF (print) export.
 *
 * The page builds a `ForecastExportData` snapshot from the SAME displayed values
 * the table shows (scenario-aware, override-aware), so an export always matches
 * what's on screen. Excel uses the already-bundled `xlsx`; PDF opens a clean,
 * print-styled window and triggers the browser's Save-as-PDF (no extra deps).
 */

import * as XLSX from 'xlsx';

export interface ForecastExportRow {
  label: string;
  values: number[];       // one per week
  indent?: boolean;       // child row (visual only)
  strong?: boolean;       // subtotal / total row
}

export interface ForecastExportSection {
  title: string;
  rows: ForecastExportRow[];
}

export interface ForecastExportData {
  title: string;          // "13-Week Cash Flow Forecast"
  scope: string;          // location / region label
  period: string;         // date-range label
  scenario?: string;      // e.g. "Best case (+20%)" — omitted for base case
  generatedOn: string;    // human date the file was produced
  weekLabels: string[];   // one per week, e.g. "29 Jun"
  sections: ForecastExportSection[];
}

const round = (v: number) => Math.round(v);
const poundsCell = (v: number) => round(v); // numeric for Excel; formatted for PDF

// A filesystem-safe file stem from the scope + period.
function fileStem(data: ForecastExportData): string {
  const raw = `13-week-forecast_${data.scope}_${data.period}`;
  return raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'forecast';
}

// ── Excel ────────────────────────────────────────────────────────────────────
export function exportForecastXlsx(data: ForecastExportData): void {
  const aoa: (string | number)[][] = [];
  aoa.push([data.title]);
  aoa.push([`Location: ${data.scope}`]);
  aoa.push([`Period: ${data.period}`]);
  if (data.scenario) aoa.push([`Scenario: ${data.scenario}`]);
  aoa.push([`Generated: ${data.generatedOn}`]);
  aoa.push([]);

  const header = ['', ...data.weekLabels, 'Total'];
  aoa.push(header);

  for (const section of data.sections) {
    aoa.push([section.title]);
    for (const row of section.rows) {
      const total = row.values.reduce((s, v) => s + v, 0);
      aoa.push([(row.indent ? '   ' : '') + row.label, ...row.values.map(poundsCell), poundsCell(total)]);
    }
    aoa.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, ...data.weekLabels.map(() => ({ wch: 11 })), { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Forecast');
  XLSX.writeFile(wb, `${fileStem(data)}.xlsx`);
}

// ── PDF (print) ────────────────────────────────────────────────────────────────
const gbp = (v: number) => {
  const n = round(v);
  return (n < 0 ? '-£' : '£') + Math.abs(n).toLocaleString('en-GB');
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function exportForecastPdf(data: ForecastExportData): void {
  const th = ['<th class="lbl"></th>', ...data.weekLabels.map((w) => `<th>${esc(w)}</th>`), '<th>Total</th>'].join('');

  const body = data.sections
    .map((section) => {
      const secHeader = `<tr class="section"><td class="lbl" colspan="${data.weekLabels.length + 2}">${esc(section.title)}</td></tr>`;
      const rows = section.rows
        .map((row) => {
          const total = row.values.reduce((s, v) => s + v, 0);
          const cls = `${row.strong ? 'strong' : ''} ${row.indent ? 'indent' : ''}`.trim();
          const cells = row.values.map((v) => `<td>${v === 0 ? '' : gbp(v)}</td>`).join('');
          return `<tr class="${cls}"><td class="lbl">${esc(row.label)}</td>${cells}<td>${gbp(total)}</td></tr>`;
        })
        .join('');
      return secHeader + rows;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 2px; }
  .scenario { display: inline-block; margin: 6px 0 10px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 11px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #e2e2e2; padding: 3px 5px; text-align: right; white-space: nowrap; }
  th { background: #f5f6f8; font-weight: 600; }
  td.lbl, th.lbl { text-align: left; }
  tr.section td { background: #eef2ff; font-weight: 700; text-align: left; color: #1e293b; }
  tr.strong td { font-weight: 700; background: #fafafa; }
  tr.indent td.lbl { padding-left: 16px; color: #444; }
  @media print { body { margin: 8mm; } @page { size: A4 landscape; margin: 8mm; } }
</style></head><body>
  <h1>${esc(data.title)}</h1>
  <div class="meta">${esc(data.scope)} · ${esc(data.period)}</div>
  <div class="meta">Generated ${esc(data.generatedOn)}</div>
  ${data.scenario ? `<div class="scenario">Scenario: ${esc(data.scenario)}</div>` : ''}
  <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Open the print dialog exactly ONCE — a guard stops the onload handler and the
  // safety-net timeout from both firing (which popped the dialog a second time).
  let printed = false;
  const printOnce = () => {
    if (printed) return;
    printed = true;
    try { win.print(); } catch { /* window closed by the user */ }
  };
  // Give the new document a tick to lay out, then print; the timeout is only a
  // fallback for browsers where `onload` doesn't fire on a written document.
  win.onload = () => setTimeout(printOnce, 150);
  setTimeout(printOnce, 500);
}
