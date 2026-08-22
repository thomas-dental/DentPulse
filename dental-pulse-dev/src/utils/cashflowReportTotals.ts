import type { CashflowReportVM, ColData, RowData } from '@/data/preparingCashflowStatementData';

export const CASHFLOW_TOTAL_COLUMN = 'Total';

function monthColData(colData: ColData[]): ColData[] {
  return colData.filter((c) => c.column !== CASHFLOW_TOTAL_COLUMN);
}

/** Row total rules aligned with DentPulse V2.0 CashflowService. */
export function cashflowRowTotalValue(colData: ColData[], rowName?: string): number {
  const months = monthColData(colData);
  if (rowName === 'Opening Balance') return months[0]?.value ?? 0;
  if (rowName === 'Closing Balance') return months[months.length - 1]?.value ?? 0;
  return months.reduce((sum, c) => sum + (c.value ?? 0), 0);
}

export function withCashflowRowTotal(colData: ColData[], rowName?: string): ColData[] {
  const months = monthColData(colData);
  return [...months, { column: CASHFLOW_TOTAL_COLUMN, value: cashflowRowTotalValue(months, rowName) }];
}

function mapRow(row: RowData): RowData {
  return { ...row, colData: withCashflowRowTotal(row.colData, row.name) };
}

/** Append a trailing Total column to every row when the API/archive payload omits it. */
export function enrichCashflowReportWithTotalColumn(report: CashflowReportVM): CashflowReportVM {
  if (report.columns.includes(CASHFLOW_TOTAL_COLUMN)) return report;

  const monthColumns = report.columns.filter((c) => c !== CASHFLOW_TOTAL_COLUMN);

  return {
    ...report,
    columns: [...monthColumns, CASHFLOW_TOTAL_COLUMN],
    totalRowDataSet: report.totalRowDataSet.map(mapRow),
    tableGroupDataSet: report.tableGroupDataSet.map((group) => ({
      ...group,
      total: group.total ? mapRow(group.total) : undefined,
      subGroupDataSet: group.subGroupDataSet.map((sub) => ({
        ...sub,
        total: sub.total ? mapRow(sub.total) : undefined,
        rowDataSet: sub.rowDataSet.map((rowSet) => ({
          ...rowSet,
          rowData: rowSet.rowData.map(mapRow),
          total: rowSet.total ? mapRow(rowSet.total) : undefined,
        })),
      })),
    })),
  };
}
