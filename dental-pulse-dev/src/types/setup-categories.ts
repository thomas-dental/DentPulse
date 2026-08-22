/**
 * Setup Categories types (reference: be-dentpulse SaveCategoryRangeVM, CategoryRangeVM, CategoryWishListVM)
 */

export interface CategoryRangeMaster {
  id: number;
  range_order: number | null;
  code: string | null;
  name: string | null;
  range_group: string | null;
  range_sub_group: string | null;
}

export interface CategoryWishListMaster {
  id: number;
  range_order: number | null;
  name: string | null;
  category_wish_list: string | null;
  sector_id: number;
}

export interface CategoryRangeVM {
  CFO: string[];
  Compliance: string[];
  TAXRefund: string[];
  CFI: string[];
  CFIPayment: string[];
  CFF: string[];
  CFFPayment: string[];
  IntraAccountReceipt: string[];
  IntraAccountPayment: string[];
  DirectCost: string[];
  Overhead: string[];
  IntraCompanyReceipt: string[];
  IntraCompanyPayment: string[];
  CashOrBank: string[];
}

export interface CategoryWishListVM {
  PeopleSalaries: string[];
  PerformersProductsBoughtToSold: string[];
  Marketing: string[];
  DebtAsAPer: string[];
  Premises: string[];
  OneOffExpense: string[];
  Advertise: string[];
}

export interface SaveCategoryRangePayload {
  categoryRange: CategoryRangeVM;
}

/** Pro GroupAccountMaster.GroupType: 1 = Revenue, 2 = Costs (COGS), 3 = Expenses */
export const GROUP_TYPE_REVENUE = 1;
export const GROUP_TYPE_COST = 2;
export const GROUP_TYPE_EXPENSE = 3;

export interface GroupAccountMaster {
  id: number;
  range_order: number | null;
  name: string;
  group_code: string;
  description: string | null;
  sector_id: number | null;
  group_type: number;
}

export interface ProfitGroupExpenseAssignment {
  groupAccountMasterId: number;
  name: string;
  accountIds: string[];
}

export interface SaveProfitGroupExpensePayload {
  groups: ProfitGroupExpenseAssignment[];
}

export const CATEGORY_RANGE_IDS = {
  CFO: 1,
  Compliance: 2,
  CFI: 3,
  CFIPayment: 4,
  CFF: 5,
  CFFPayment: 6,
  IntraAccountReceipt: 7,
  IntraAccountPayment: 8,
  DirectCost: 9,
  Overhead: 10,
  IntraCompanyReceipt: 11,
  IntraCompanyPayment: 12,
  TAXRefund: 13,
  CashOrBank: 14,
} as const;

/** Dental sector = 10 (be-dentpulse Enums.Sector.Dental) */
export const DENTAL_SECTOR_ID = 10;
