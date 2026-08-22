/**
 * Shared data contracts for Cash Flow Statement.
 */

/** Transaction row for "Transactions to Review" tab */
export interface TransactionToReview {
  id: string;
  date: string;
  transactionType: string;
  transactionLink?: string;
  name: string;
  memoOrDescription: string;
  location: string;
  split: string;
  debit: string;
  credit: string;
  balance: string;
}

/** Column value in statement table */
export interface ColData {
  column: string;
  value: number;
}

/** Row in statement (line item with values per month) */
export interface RowData {
  id?: string;
  name: string;
  colData: ColData[];
}

/** Group of rows under a sub-header */
export interface RowDataSet {
  id: number;
  header: string;
  rowData: RowData[];
  total?: RowData;
}

/** Sub-group (e.g. Operating Activities rows) */
export interface SubGroupDataSet {
  rowHeader: string;
  rowDataSet: RowDataSet[];
  total?: RowData;
}

/** Top-level group (Operating, Investing, Financing) */
export interface TableGroupDataSet {
  type: string;
  subGroupDataSet: SubGroupDataSet[];
  total?: RowData;
}

/** Cashflow report view model (matches backend CashflowReportVM) */
export interface CashflowReportVM {
  currencySymbol: string;
  columns: string[];
  tableGroupDataSet: TableGroupDataSet[];
  totalRowDataSet: RowData[];
}

