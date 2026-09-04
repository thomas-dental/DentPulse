/**
 * PE Invoices — shared types (reads go through backend API).
 */

import type { PeAgingBucketId } from '@/lib/peInvoicesConstants';

export type PeAgedDebtBucket = {
  bucket: PeAgingBucketId;
  label: string;
  outstandingGbp: number;
  invoiceCount: number;
};

export type PeInvoiceListRow = {
  practiceId: string;
  practiceName: string;
  platformInvoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountGbp: number;
  outstandingGbp: number;
  daysPastDue: number;
  daysSinceRaised: number;
  agingBucket: PeAgingBucketId;
  status: string;
  isPaid: boolean;
  isOutstanding: boolean;
  isCashLeakage: boolean;
  patientId: number | null;
  dentallyPatientUuid: string | null;
  patientRecordId: string | null;
  patientName: string | null;
  onPaymentPlan: boolean;
  invoiceUuid: string | null;
  accountUuid: string | null;
  dentallyInvoiceUrl: string | null;
  locationId: string | null;
  locationName: string | null;
};

export type PeCollectionRatePracticeRow = {
  practiceId: string;
  practiceName: string;
  invoicedGbp: number;
  collectedGbp: number;
  collectionRate: number | null;
};

export type PeInvoicesSummary = {
  trailingMonths: number;
  trailingSince: string;
  cashLeakageWindowDays: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
  totalOutstandingGbp: number;
  overdue60PlusGbp: number;
  collectedTrailingGbp: number;
  invoicedTrailingGbp: number;
  collectionRate: number | null;
  onPaymentPlanOutstandingGbp: number;
  onPaymentPlanArrangementCount: number;
  agedBuckets: PeAgedDebtBucket[];
  invoiceListRows: PeInvoiceListRow[];
  collectionByPractice: PeCollectionRatePracticeRow[];
  rollupMode: 'location' | 'practice';
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  sortDir: 'asc' | 'desc';
};

export type PeInvoicesListParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
  statusFilter?: string;
  cashLeakageOnly?: boolean;
};

export type PeInvoicesHero = {
  trailingMonths: number;
  trailingSince: string;
  rollupMode: 'location' | 'practice';
  invoicedTrailingGbp: number;
  collectedTrailingGbp: number;
  collectionRate: number | null;
  totalOutstandingGbp: number;
  overdue60PlusGbp: number;
  onPaymentPlanOutstandingGbp: number;
  onPaymentPlanArrangementCount: number;
};

export type PeInvoicesAgedDebt = {
  trailingMonths: number;
  rollupMode: 'location' | 'practice';
  totalOutstandingGbp: number;
  agedBuckets: PeAgedDebtBucket[];
};

export type PeInvoicesCollectionByLocation = {
  trailingMonths: number;
  rollupMode: 'location' | 'practice';
  collectionByPractice: PeCollectionRatePracticeRow[];
};

export type PeInvoicesList = {
  trailingMonths: number;
  cashLeakageWindowDays: number;
  cashLeakageCount: number;
  cashLeakageGbp: number;
  rollupMode: 'location' | 'practice';
  invoiceListRows: PeInvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  sortDir: 'asc' | 'desc';
};
