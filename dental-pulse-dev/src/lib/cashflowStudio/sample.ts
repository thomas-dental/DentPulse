/**
 * Cash Flow Scenario Studio — sample dataset.
 *
 * A realistic Week-0 model for a mid-size omni-channel retailer, so the full
 * pipeline (builder → dashboard) is demoable without uploading files. Numbers
 * are tuned so base minimum cash dips below the $750K threshold mid-quarter
 * (a big inventory PO in Week 7 followed by tax + debt + payroll in Week 8),
 * which makes the scenario levers meaningful.
 */

import { finalizeModel, makeWeeks } from './buildModel';
import type { CashFlowModel, ExceptionRow, InputInventoryRow } from './types';

const K = (arr: number[]) => arr.map((v) => v * 1000);

export function buildSampleModel(): CashFlowModel {
  const today = new Date();
  const asOfDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  const weeks = makeWeeks(asOfDate);

  const receipts = {
    retailCard: K([420, 435, 410, 440, 455, 430, 415, 405, 460, 470, 445, 455, 480]),
    onlineMarketplace: K([190, 120, 200, 130, 210, 140, 205, 135, 215, 150, 220, 145, 225]),
    arCollections: K([310, 90, 140, 260, 80, 120, 340, 70, 110, 290, 85, 130, 360]),
    otherReceipts: K([15, 0, 10, 0, 20, 0, 12, 0, 18, 0, 10, 0, 25]),
  };

  const disbursements = {
    payrollBenefits: K([0, 380, 0, 380, 0, 380, 0, 380, 0, 380, 0, 380, 0]),
    inventoryVendorPayments: K([260, 180, 300, 150, 280, 200, 320, 170, 290, 210, 300, 180, 260]),
    operatingAP: K([120, 90, 140, 80, 160, 100, 130, 95, 150, 110, 140, 90, 120]),
    recurringPayments: K([45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45]),
    rentFacilities: K([150, 0, 0, 0, 150, 0, 0, 0, 150, 0, 0, 0, 150]),
    marketingDiscretionary: K([70, 55, 65, 50, 80, 60, 75, 55, 90, 65, 70, 50, 85]),
    tax: K([0, 0, 0, 0, 0, 0, 0, 520, 0, 0, 0, 0, 0]),
    debtService: K([0, 0, 0, 110, 0, 0, 0, 110, 0, 0, 0, 110, 0]),
    purchaseCommitments: K([0, 0, 0, 0, 0, 0, 650, 0, 0, 0, 0, 0, 0]),
    otherDisbursements: K([20, 15, 25, 10, 30, 15, 20, 12, 28, 18, 22, 10, 25]),
  };

  const inventory: InputInventoryRow[] = [
    {
      fileName: 'bank_transactions_export.csv',
      fileType: 'CSV',
      rowCount: 1842,
      dateRange: 'last 90 days',
      mainColumns: 'date, description, amount, running_balance',
      forecastUse: 'Opening cash + recurring/debt timing',
      usage: 'Used',
      issues: '2 duplicate references flagged',
    },
    {
      fileName: 'ar_aging.xlsx',
      fileType: 'Excel',
      rowCount: 312,
      dateRange: 'open invoices',
      mainColumns: 'customer, invoice, due_date, expected_date, amount, status',
      forecastUse: 'AR collections schedule',
      usage: 'Used',
      issues: '1 disputed invoice, 8 missing expected dates',
    },
    {
      fileName: 'ap_open_items.xlsx',
      fileType: 'Excel',
      rowCount: 268,
      dateRange: 'open bills',
      mainColumns: 'vendor, bill, due_date, amount, hold_flag',
      forecastUse: 'Operating AP + vendor payments',
      usage: 'Used',
      issues: '3 held bills excluded, 5 missing due dates',
    },
    {
      fileName: 'purchase_orders.csv',
      fileType: 'CSV',
      rowCount: 74,
      dateRange: 'open POs',
      mainColumns: 'po, vendor, status, expected_receipt, amount',
      forecastUse: 'Near-term purchase commitments',
      usage: 'Partially used',
      issues: '1 cancelled PO excluded; 1 large PO needs CFO review',
    },
    {
      fileName: 'payroll_calendar.csv',
      fileType: 'CSV',
      rowCount: 26,
      dateRange: 'next quarter',
      mainColumns: 'run_date, gross, benefits',
      forecastUse: 'Payroll and benefits timing',
      usage: 'Used',
      issues: 'none',
    },
  ];

  const exceptions: ExceptionRow[] = [
    {
      issueType: 'Large purchase commitment',
      sourceFile: 'purchase_orders.csv',
      sourceRef: 'PO-4471',
      amount: 650000,
      treatment: 'Included in Week 7 — largest single outflow',
      cfoReview: true,
      category: 'cfo',
    },
    {
      issueType: 'Disputed AR excluded',
      sourceFile: 'ar_aging.xlsx',
      sourceRef: 'INV-20933',
      amount: 128000,
      treatment: 'Excluded from base receipts (dispute unresolved)',
      cfoReview: true,
      category: 'cfo',
    },
    {
      issueType: 'Held AP excluded',
      sourceFile: 'ap_open_items.xlsx',
      sourceRef: '3 bills',
      amount: 214000,
      treatment: 'Excluded from base forecast pending release',
      cfoReview: true,
      category: 'cfo',
    },
    {
      issueType: 'Missing expected dates on AR',
      sourceFile: 'ar_aging.xlsx',
      sourceRef: '8 invoices',
      amount: 96000,
      treatment: 'Scheduled conservatively to due date',
      cfoReview: false,
      category: 'informational',
    },
    {
      issueType: 'Missing due dates on AP',
      sourceFile: 'ap_open_items.xlsx',
      sourceRef: '5 bills',
      amount: 61000,
      treatment: 'Not auto-scheduled — held for review',
      cfoReview: false,
      category: 'warning',
    },
    {
      issueType: 'Cancelled PO excluded',
      sourceFile: 'purchase_orders.csv',
      sourceRef: 'PO-4409',
      amount: 88000,
      treatment: 'Dropped before scheduling',
      cfoReview: false,
      category: 'informational',
    },
    {
      issueType: 'Duplicate bank references',
      sourceFile: 'bank_transactions_export.csv',
      sourceRef: '2 rows',
      treatment: 'De-duplicated before computing opening balance',
      cfoReview: false,
      category: 'warning',
    },
  ];

  return finalizeModel({
    title: 'Meridian Retail Co. — 13-Week Cash Flow',
    currencySymbol: '$',
    asOfDate,
    threshold: 750000,
    openingCash: 1500000,
    openingCashResolved: true,
    weeks,
    receipts,
    disbursements,
    assumptions: [
      'Card settlements land 2 business days after sale.',
      'Marketplace payouts follow each platform’s stated payout cadence.',
      'AR scheduled on expected date where present, else due date.',
      'Overdue AR with no expected date pulled conservatively to due date.',
      'Payroll on the published bi-weekly run dates.',
      'Rent and debt service on their fixed monthly dates.',
    ],
    excludedItems: [
      'Disputed AR (INV-20933) — dispute unresolved.',
      'Held AP (3 bills) — on hold flag.',
      'Cancelled PO (PO-4409) — cancelled status.',
    ],
    inventory,
    exceptions,
  });
}
