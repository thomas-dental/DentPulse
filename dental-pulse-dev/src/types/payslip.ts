export type PayslipStatus = 'draft' | 'posted';

export type PayslipIncomeLineType = 'income' | 'deduction';

/** Fixed set of gross-fee/deduction lines used by the Gross Fees & Deductions tab. */
export type PayslipIncomeLineKey =
  | 'private_fees'
  | 'membership_fees'
  | 'nhs_fees'
  | 'bad_debts'
  | 'other_deductions';

export type PayslipAdjustmentType = 'addition' | 'deduction';

export interface Payslip {
  id: string;
  organization_id: string;
  provider_id: string;
  provider_name: string;
  month_ending: string; // 'YYYY-MM-DD'
  statement_date: string; // 'YYYY-MM-DD'
  nhs_schedule: string | null;
  udas: number | null;
  status: PayslipStatus;
  gross_fees_total: number;
  gross_deductions_total: number;
  total_gross_fees: number;
  associate_split_percentage: number | null;
  associate_split_amount: number | null;
  pay_band_associate_share_total: number;
  labs_total: number;
  associate_lab_split_percentage: number | null;
  associate_lab_split_amount: number | null;
  associate_lab_share_total: number;
  additions_total: number;
  deductions_total: number;
  net_pay: number;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayslipIncomeLine {
  id: string;
  payslip_id: string;
  line_type: PayslipIncomeLineType;
  line_key: PayslipIncomeLineKey | string;
  label: string;
  display_order: number;
  amount: number;
}

export interface PayslipBandLine {
  id: string;
  payslip_id: string;
  band_order: number;
  band_name: string;
  start_value: number;
  end_value: number | null;
  associate_percentage: number;
  gross_band_amount: number;
  associate_amount: number;
}

export interface PayslipAdjustmentLine {
  id: string;
  payslip_id: string;
  adjustment_type: PayslipAdjustmentType;
  label: string;
  display_order: number;
  amount: number;
}

export interface PayslipWithLines extends Payslip {
  income_lines: PayslipIncomeLine[];
  pay_band_lines: PayslipBandLine[];
  lab_band_lines: PayslipBandLine[];
  adjustment_lines: PayslipAdjustmentLine[];
}

/** Payload shape accepted by useSavePayslipMutation — header fields + the 4 line arrays. */
export interface PayslipSavePayload {
  id?: string;
  provider_id: string;
  provider_name: string;
  month_ending: string;
  statement_date: string;
  nhs_schedule?: string | null;
  udas?: number | null;
  status: PayslipStatus;
  gross_fees_total: number;
  gross_deductions_total: number;
  total_gross_fees: number;
  associate_split_percentage: number | null;
  associate_split_amount: number | null;
  pay_band_associate_share_total: number;
  labs_total: number;
  associate_lab_split_percentage: number | null;
  associate_lab_split_amount: number | null;
  associate_lab_share_total: number;
  additions_total: number;
  deductions_total: number;
  net_pay: number;
  income_lines: Omit<PayslipIncomeLine, 'id' | 'payslip_id'>[];
  pay_band_lines: Omit<PayslipBandLine, 'id' | 'payslip_id'>[];
  lab_band_lines: Omit<PayslipBandLine, 'id' | 'payslip_id'>[];
  adjustment_lines: Omit<PayslipAdjustmentLine, 'id' | 'payslip_id'>[];
}

export const PAYSLIP_INCOME_LINE_LABELS: Record<PayslipIncomeLineKey, string> = {
  private_fees: 'Private Fees',
  membership_fees: 'Membership Fees',
  nhs_fees: 'NHS Fees',
  bad_debts: 'Bad Debts',
  other_deductions: 'Other Deductions',
};
