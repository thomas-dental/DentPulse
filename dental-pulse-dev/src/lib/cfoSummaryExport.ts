/**
 * CFO Summary export — Excel (.xlsx) and PDF (print), dependency-free.
 *
 * PDF includes the on-screen charts: each recharts <svg> is serialised with its
 * COMPUTED styles inlined (recharts colours come from CSS classes / CSS vars like
 * hsl(var(--primary)) that don't exist outside the app, so we bake the resolved
 * colours in) and embedded straight into the print window. Excel gets the full
 * underlying data (KPIs, weekly series, scenario impact, drivers) — the community
 * `xlsx` build can't embed images, so charts are PDF-only.
 */

import * as XLSX from 'xlsx';

export interface CfoKpi { label: string; value: string; sub?: string }
export interface CfoImpactRow { metric: string; base: string; scenario: string; delta: string }
export interface CfoDriver { label: string; total: number }
export interface CfoChart { title: string; svg: string; legend: { label: string; color: string }[] }
export interface CfoExceptionGroup { group: string; items: { title: string; detail: string }[] }

export interface CfoBrand {
  /** The product brand shown on the RIGHT of the masthead (DentPulse). */
  name: string;
  logoUrl?: string;
  tagline?: string;
  /** The customer's practice / company name, shown on the LEFT of the masthead. */
  companyName?: string;
  /** Icon for the print window's browser tab (overrides the app's default favicon). */
  faviconUrl?: string;
}

export interface CfoSummaryExportData {
  brand?: CfoBrand;
  title: string;
  period: string;
  asOf: string;
  thresholdLabel: string;
  scenarioLabel?: string;
  generatedOn: string;
  kpis: CfoKpi[];
  weekLabels: string[];
  series: {
    base: number[];
    scenario: number[];
    inflow: number[];
    outflow: number[];
    net: number[];
    threshold?: (number | null)[];
  };
  impact: CfoImpactRow[];
  topInflow: CfoDriver[];
  topOutflow: CfoDriver[];
  exceptions: CfoExceptionGroup[];
  interpretation: string[];
  charts: CfoChart[];
}

const round = (v: number) => Math.round(v);
const gbp = (v: number) => {
  const n = round(v);
  return (n < 0 ? '-£' : '£') + Math.abs(n).toLocaleString('en-GB');
};
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fileStem(data: CfoSummaryExportData): string {
  const raw = `cfo-summary_${data.period}`;
  return raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'cfo-summary';
}

// ── SVG serialisation ─────────────────────────────────────────────────────────
// Presentation properties whose computed value we bake onto every node so the
// serialised SVG renders identically outside the app (no CSS classes / vars).
const SVG_STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'color', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
];

/**
 * Clone a live recharts <svg> and inline its computed styles so it can be
 * embedded anywhere. Adds a viewBox (so it scales to the print page) if missing.
 * Returns '' if given nothing (chart not yet rendered).
 */
export function serializeChartSvg(svg: SVGSVGElement | null | undefined): string {
  if (!svg) return '';
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const origNodes: Element[] = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const cloneNodes: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < origNodes.length && i < cloneNodes.length; i++) {
    const cs = window.getComputedStyle(origNodes[i]);
    const el = cloneNodes[i] as SVGElement;
    for (const p of SVG_STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal') el.style.setProperty(p, v);
      else if (v === 'none' && (p === 'fill' || p === 'stroke')) el.style.setProperty(p, 'none');
    }
  }

  const w = svg.getAttribute('width') || String(svg.clientWidth || 800);
  const h = svg.getAttribute('height') || String(svg.clientHeight || 300);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '100%');
  clone.removeAttribute('height');
  clone.style.height = 'auto';
  return new XMLSerializer().serializeToString(clone);
}

// ── Excel ───────────────────────────────────────────────────────────────────
export function exportCfoSummaryXlsx(data: CfoSummaryExportData): void {
  const aoa: (string | number)[][] = [];
  const brand = data.brand ?? { name: 'DentPulse' };
  // Excel (community xlsx build) can't embed images or style cells — brand as a
  // full-width text masthead (rows merged across the sheet below for a clean header).
  const merges: XLSX.Range[] = [];
  const pushBanner = (text: string) => {
    aoa.push([text]);
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: 6 } });
  };
  // Masthead row: the customer's company on the LEFT, DentPulse on the RIGHT.
  aoa.push([brand.companyName || '', '', '', '', '', '', brand.name]);
  if (brand.tagline) aoa.push(['', '', '', '', '', '', brand.tagline]);
  aoa.push([]);
  pushBanner(data.title);
  aoa.push([`Period: ${data.period}`]);
  if (data.asOf) aoa.push([`As of: ${data.asOf}`]);
  aoa.push([`Threshold: ${data.thresholdLabel}`]);
  if (data.scenarioLabel) aoa.push([`Scenario: ${data.scenarioLabel}`]);
  aoa.push([`Generated: ${data.generatedOn}`]);
  aoa.push([]);

  // KPIs
  aoa.push(['Key metrics']);
  aoa.push(['Metric', 'Value', '']);
  data.kpis.forEach((k) => aoa.push([k.label, k.value, k.sub || '']));
  aoa.push([]);

  // Weekly series (the data behind the charts)
  aoa.push(['Weekly series']);
  const hasThr = !!data.series.threshold?.some((t) => t != null);
  aoa.push(['Week', 'Base closing cash', 'Scenario closing cash', 'Inflow', 'Outflow', 'Net cash flow', ...(hasThr ? ['Minimum balance'] : [])]);
  data.weekLabels.forEach((wl, i) => {
    const row: (string | number)[] = [
      wl,
      round(data.series.base[i] ?? 0),
      round(data.series.scenario[i] ?? 0),
      round(data.series.inflow[i] ?? 0),
      round(data.series.outflow[i] ?? 0),
      round(data.series.net[i] ?? 0),
    ];
    if (hasThr) row.push(data.series.threshold?.[i] == null ? '' : round(data.series.threshold![i] as number));
    aoa.push(row);
  });
  aoa.push([]);

  // Scenario impact
  aoa.push(['Scenario impact vs base']);
  aoa.push(['Metric', 'Base', 'Scenario', 'Delta']);
  data.impact.forEach((r) => aoa.push([r.metric, r.base, r.scenario, r.delta]));
  aoa.push([]);

  // Drivers
  aoa.push(['Biggest inflows']);
  data.topInflow.forEach((r) => aoa.push([r.label, round(r.total)]));
  aoa.push([]);
  aoa.push(['Biggest outflows']);
  data.topOutflow.forEach((r) => aoa.push([r.label, round(r.total)]));
  aoa.push([]);

  // Exceptions
  data.exceptions.forEach((g) => {
    aoa.push([g.group]);
    if (g.items.length === 0) aoa.push(['None']);
    g.items.forEach((it) => aoa.push([it.title, it.detail]));
    aoa.push([]);
  });

  // Interpretation
  if (data.interpretation.length) {
    aoa.push(['CFO interpretation']);
    data.interpretation.forEach((line) => aoa.push([line]));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  ws['!merges'] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CFO Summary');
  XLSX.writeFile(wb, `${fileStem(data)}.xlsx`);
}

// ── PDF (print) ───────────────────────────────────────────────────────────────
export function exportCfoSummaryPdf(data: CfoSummaryExportData): void {
  const kpis = data.kpis
    .map((k) => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v">${esc(k.value)}</div>${k.sub ? `<div class="kpi-s">${esc(k.sub)}</div>` : ''}</div>`)
    .join('');

  const charts = data.charts
    .filter((c) => c.svg)
    .map((c) => {
      const legend = c.legend
        .map((l) => `<span class="lg"><span class="sw" style="background:${esc(l.color)}"></span>${esc(l.label)}</span>`)
        .join('');
      return `<div class="chart"><div class="chart-t">${esc(c.title)}</div><div class="chart-svg">${c.svg}</div><div class="legend">${legend}</div></div>`;
    })
    .join('');

  const impact = data.impact
    .map((r) => `<tr><td class="lbl">${esc(r.metric)}</td><td>${esc(r.base)}</td><td>${esc(r.scenario)}</td><td>${esc(r.delta)}</td></tr>`)
    .join('');

  const driverRows = (rows: CfoDriver[]) =>
    rows.length
      ? rows.map((r) => `<tr><td class="lbl">${esc(r.label)}</td><td>${gbp(r.total)}</td></tr>`).join('')
      : '<tr><td class="lbl" colspan="2">No data.</td></tr>';

  const exceptions = data.exceptions
    .map((g) => {
      const items = g.items.length
        ? g.items.map((it) => `<li><b>${esc(it.title)}</b> — ${esc(it.detail)}</li>`).join('')
        : '<li class="muted">None.</li>';
      return `<div class="exc"><div class="exc-t">${esc(g.group)}</div><ul>${items}</ul></div>`;
    })
    .join('');

  const interp = data.interpretation.map((p) => `<p>${esc(p)}</p>`).join('');

  const brand = data.brand ?? { name: 'DentPulse' };
  // Masthead: the customer's company on the LEFT, the DentPulse brand on the RIGHT.
  const brandMark = brand.logoUrl
    ? `<img class="brand-logo" src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" crossorigin="anonymous" />`
    : `<div class="brand-name">${esc(brand.name)}</div>`;
  const header = `
    <div class="masthead">
      <div class="masthead-l">
        ${brand.companyName ? `<div class="company-name">${esc(brand.companyName)}</div>` : ''}
        <div class="report-name">${esc(data.title)}</div>
        <div class="report-sub">${esc(data.asOf ? `As of ${data.asOf} · ` : '')}${esc(data.period)}</div>
        <div class="report-sub">Threshold ${esc(data.thresholdLabel)} · Generated ${esc(data.generatedOn)}</div>
      </div>
      <div class="masthead-r">
        ${brandMark}
        ${brand.tagline ? `<div class="brand-tagline">${esc(brand.tagline)}</div>` : ''}
      </div>
    </div>`;

  // Pin the tab icon so the print/PDF window doesn't fall back to the origin's
  // default /favicon.ico (which is the old scaffold icon).
  const faviconTag = brand.faviconUrl
    ? `<link rel="icon" type="image/x-icon" href="${esc(brand.faviconUrl)}" />`
    : '<link rel="icon" href="data:," />';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
${faviconTag}
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 24px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Branded header band in the DentPulse system colour so the (light) logo and
     title read clearly on export — a white header hid the light logo. */
  .masthead { display: flex; align-items: center; justify-content: space-between; gap: 20px;
    background: linear-gradient(135deg, #4f46e5 0%, #6d5ef0 100%); color: #fff;
    padding: 18px 22px; border-radius: 10px; margin-bottom: 16px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .masthead-l { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .company-name { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -.01em; }
  .brand-logo { height: 40px; width: auto; object-fit: contain; }
  .brand-name { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -.01em; }
  .brand-tagline { font-size: 11px; color: rgba(255,255,255,.85); letter-spacing: .02em; margin-top: 4px; }
  .masthead-r { text-align: right; display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
  .report-name { font-size: 15px; font-weight: 700; color: #fff; }
  .report-sub { font-size: 10px; color: rgba(255,255,255,.82); margin-top: 2px; }
  .scenario { display: inline-block; margin: 10px 0 4px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 11px; font-weight: 600; }
  h2 { font-size: 13px; margin: 18px 0 8px; color: #1e293b; border-left: 3px solid #4f46e5; padding-left: 8px; }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #94a3b8;
    display: flex; justify-content: space-between; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .kpi-l { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .kpi-v { font-size: 15px; font-weight: 700; margin-top: 2px; }
  .kpi-s { font-size: 9px; color: #6b7280; }
  .chart { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-top: 12px; page-break-inside: avoid; }
  .chart-t { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  .chart-svg svg { width: 100%; height: auto; }
  .legend { margin-top: 4px; font-size: 10px; color: #444; }
  .legend .lg { display: inline-flex; align-items: center; margin-right: 14px; }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; margin-top: 6px; }
  th, td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: right; }
  th { background: #f5f6f8; font-weight: 600; }
  td.lbl, th.lbl { text-align: left; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .exc { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .exc-t { font-size: 11px; font-weight: 700; margin-bottom: 4px; }
  .exc ul { margin: 0; padding-left: 16px; }
  .exc li { font-size: 10px; margin-bottom: 3px; }
  .muted { color: #6b7280; list-style: none; margin-left: -16px; }
  .interp p { font-size: 11px; color: #333; margin: 4px 0; }
  @media print { body { margin: 10mm; } @page { size: A4 portrait; margin: 10mm; } }
</style></head><body>
  ${header}
  ${data.scenarioLabel ? `<div class="scenario">Scenario: ${esc(data.scenarioLabel)}</div>` : ''}

  <div class="kpis">${kpis}</div>

  ${charts}

  <h2>Scenario impact vs base</h2>
  <table><thead><tr><th class="lbl">Metric</th><th>Base</th><th>Scenario</th><th>Delta</th></tr></thead><tbody>${impact}</tbody></table>

  <h2>Top drivers</h2>
  <div class="cols">
    <table><thead><tr><th class="lbl">Biggest inflows</th><th>13-wk total</th></tr></thead><tbody>${driverRows(data.topInflow)}</tbody></table>
    <table><thead><tr><th class="lbl">Biggest outflows</th><th>13-wk total</th></tr></thead><tbody>${driverRows(data.topOutflow)}</tbody></table>
  </div>

  <h2>CFO review</h2>
  <div class="cols" style="grid-template-columns: 1fr 1fr 1fr;">${exceptions}</div>

  <h2>CFO interpretation</h2>
  <div class="interp">${interp}</div>

  <div class="foot">
    <span>${esc(brand.name)} — 13-Week Cash Flow Forecast</span>
    <span>Generated ${esc(data.generatedOn)}</span>
  </div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  let printed = false;
  const printOnce = () => {
    if (printed) return;
    printed = true;
    try { win.print(); } catch { /* window closed by the user */ }
  };
  // Wait for the remote logo (and charts) to paint before printing; fall back on a
  // timer so a slow/blocked logo never leaves the export hanging.
  const logoImg = win.document.querySelector('img.brand-logo') as HTMLImageElement | null;
  if (logoImg && !logoImg.complete) {
    logoImg.addEventListener('load', () => setTimeout(printOnce, 200));
    logoImg.addEventListener('error', () => setTimeout(printOnce, 200));
  }
  win.onload = () => setTimeout(printOnce, 250);
  setTimeout(printOnce, 1500);
}
