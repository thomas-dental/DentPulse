/**
 * Step 6 partial-data flags — keep distinct from generic "incomplete" messaging.
 * - missing_practitioner: invoice has no dominant practitioner (contribution excluded)
 * - missing_rate: practitioner exists but no effective-dated private-share rate configured
 */
export type PePractitionerDataGap = 'missing_practitioner' | 'missing_rate';

export type PractitionerRateHistoryEntry = {
  id: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  isCurrent: boolean;
};

export type PractitionerWithRates = {
  id: string;
  name: string;
  providerRole: string | null;
  isActive: boolean;
  externalId?: string | null;
  rateConfigured: boolean;
  currentRate: number | null;
  currentEffectiveFrom: string | null;
  /** From providers.lab_split_percentage — null when not configured. */
  labSplitPercentage?: number | null;
  history: PractitionerRateHistoryEntry[];
};

export type PractitionerRatesSortBy = 'name' | 'private_share' | 'role';
export type PractitionerRatesSortDir = 'asc' | 'desc';

export type PractitionerRatesSummary = {
  totalPractitioners: number;
  configuredCount: number;
  notConfiguredCount: number;
  hasMissingRate: boolean;
};

export type PractitionerRatesListResponse = {
  practitioners: PractitionerWithRates[];
  summary: PractitionerRatesSummary;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
};
