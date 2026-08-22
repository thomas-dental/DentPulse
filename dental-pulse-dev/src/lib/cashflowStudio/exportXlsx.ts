/**
 * Cash Flow Scenario Studio — workbook export.
 *
 * Writes the model-builder skill's deliverable: week0_13_week_cash_flow_forecast.xlsx
 * with the seven prescribed tabs (README, Input Inventory, Weekly Schedules,
 * 13-Week Forecast, Exceptions, Self-Check, CFO Summary).
 */

import * as XLSX from 'xlsx';
import { RECEIPT_KEYS, DISBURSEMENT_KEYS, type CashFlowModel } from './types';
import { computeBase } from './engine';

type Row = (string | number)[];

const money = (v: number) => Math.round(v);

export function exportModelToXlsx(model: CashFlowModel): void {
  const wb = XLSX.utils.book_new();
  const weekLabels = model.weeks.map((w) => w.label);
  const f = computeBase(model);

  // ── README ──
  const readme: Row[] = [
    ['Week-0 13-Week Cash Flow Forecast'],
    ['Model title', model.title],
    ['As-of date', model.asOfDate],
    ['Currency', model.currencySymbol],
    ['Cash threshold', money(model.threshold)],
    ['Status', model.isDraft ? 'DRAFT — CFO review required' : 'Ready for CFO review'],
    [],
    ['Scope: one entity, one bank account, one currency, 13 weekly periods.'],
    ['Not modelled: multi-entity, multi-currency, covenants, full audit trail.'],
    ['This workbook is a first-pass model. Verify Exceptions before decisions.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), 'README');

  // ── Input Inventory ──
  const inv: Row[] = [
    ['File', 'Type', 'Rows', 'Date range', 'Main columns', 'Forecast use', 'Usage', 'Issues'],
    ...model.inventory.map((r) => [
      r.fileName,
      r.fileType,
      r.rowCount,
      r.dateRange,
      r.mainColumns,
      r.forecastUse,
      r.usage,
      r.issues,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Input Inventory');

  // ── Weekly Schedules ──
  const sched: Row[] = [];
  sched.push(['Weekly Schedules', ...weekLabels]);
  sched.push(['INFLOWS']);
  for (const k of RECEIPT_KEYS) sched.push([model.labels.receipts[k], ...model.receipts[k].map(money)]);
  sched.push([]);
  sched.push(['OUTFLOWS']);
  for (const k of DISBURSEMENT_KEYS)
    sched.push([model.labels.disbursements[k], ...model.disbursements[k].map(money)]);
  sched.push([]);
  sched.push(['Key assumptions']);
  for (const a of model.assumptions) sched.push([a]);
  sched.push([]);
  sched.push(['Excluded items']);
  for (const x of model.excludedItems) sched.push([x]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sched), 'Weekly Schedules');

  // ── 13-Week Forecast ──
  const fc: Row[] = [];
  fc.push(['13-Week Forecast', ...weekLabels, 'Total']);
  fc.push(['Opening cash', ...f.openingByWeek.map(money), '']);
  for (const k of RECEIPT_KEYS)
    fc.push([model.labels.receipts[k], ...model.receipts[k].map(money), money(sum(model.receipts[k]))]);
  fc.push(['Total cash receipts', ...f.totalReceipts.map(money), money(sum(f.totalReceipts))]);
  for (const k of DISBURSEMENT_KEYS)
    fc.push([
      model.labels.disbursements[k],
      ...model.disbursements[k].map(money),
      money(sum(model.disbursements[k])),
    ]);
  fc.push([
    'Total cash disbursements',
    ...f.totalDisbursements.map(money),
    money(sum(f.totalDisbursements)),
  ]);
  fc.push(['Net cash flow', ...f.netCashFlow.map(money), money(sum(f.netCashFlow))]);
  fc.push(['Ending cash', ...f.endingCash.map(money), '']);
  fc.push(['Below cash threshold?', ...f.belowThreshold.map((b) => (b ? 'YES' : 'no')), '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fc), '13-Week Forecast');

  // ── Exceptions ──
  const exc: Row[] = [
    ['Issue type', 'Source file', 'Reference', 'Amount', 'Forecast treatment', 'CFO review'],
    ...model.exceptions.map((e) => [
      e.issueType,
      e.sourceFile,
      e.sourceRef ?? '',
      e.amount != null ? money(e.amount) : '',
      e.treatment,
      e.cfoReview ? 'YES' : 'No',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exc), 'Exceptions');

  // ── Self-Check ──
  const sc: Row[] = [
    ['Check', 'Status', 'Detail'],
    ...model.selfChecks.map((c) => [c.name, c.status, c.detail]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sc), 'Self-Check');

  // ── CFO Summary ──
  const s = model.cfoSummary;
  const cfo: Row[] = [
    ['CFO Summary'],
    ['As-of date', s.asOfDate],
    ['Opening cash', money(s.openingCash)],
    ['Ending cash (Week 13)', money(s.endingCash)],
    ['Minimum cash week', `Week ${s.minCashWeek}`],
    ['Minimum cash amount', money(s.minCashAmount)],
    ['Cash threshold', money(s.threshold)],
    ['Weeks below threshold', s.weeksBelowThreshold],
    ['Ready for CFO review', s.readyForReview ? 'Yes' : 'No — draft'],
    [],
    ['Biggest inflow risks', s.inflowRisks.join('; ')],
    ['Biggest outflow risks', s.outflowRisks.join('; ')],
    ['Most important exceptions', s.topExceptions.join('; ')],
    [],
    ['Summary', s.summaryText],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfo), 'CFO Summary');

  XLSX.writeFile(wb, 'week0_13_week_cash_flow_forecast.xlsx');
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
