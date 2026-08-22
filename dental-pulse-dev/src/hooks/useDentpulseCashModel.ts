/**
 * useDentpulseCashModel — build a 13-week cash flow model from REAL DentPulse data.
 *
 * Follows the cash-flow-model-builder skill's method (opening cash → weekly
 * inflow/outflow schedules → roll-forward → exceptions → self-check → CFO
 * summary), but sources the inputs from live practice data instead of uploaded
 * files, and projects them forward per the skill's "repeat the trailing pattern
 * forward" rule:
 *
 *   Receipts  ← dentally_payments (real weekly patient takings), the trailing
 *               13-week actual pattern carried forward.
 *   Costs     ← the Profit (Expenses) P&L groups via the profit-benchmark engine
 *               (real trailing spend), levelled to a weekly run-rate.
 *   Opening   ← user-supplied bank balance (no live bank feed → flagged if 0,
 *               exactly as the skill treats an unclear opening balance).
 *
 * One profit-benchmark call + one paginated dentally_payments read, both scoped
 * to the selected organization + location, mirroring every other cashflow page.
 */

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { membershipProviderLabel } from '@/lib/membershipProviderLabel';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { getProfitBenchmark } from '@/services/profitBenchmarkService';
import { finalizeModel, makeWeeks } from '@/lib/cashflowStudio/buildModel';
import {
  WEEKS,
  RECEIPT_KEYS,
  DISBURSEMENT_KEYS,
  type CashFlowModel,
  type ExceptionRow,
  type InputInventoryRow,
  type ModelLabels,
  type ReceiptKey,
  type DisbursementKey,
  type WeekArray,
} from '@/lib/cashflowStudio/types';

// group_account_master ids for the Profit (Expenses) groups (see EXPENSE_GROUP
// in useCashflowForecast.ts). Duplicated here to keep this hook self-contained.
const G = {
  MATERIALS: 100,
  LAB_FEES: 101,
  HYGIENIST: 102,
  DENTIST: 103,
  THERAPIST: 104,
  STAFF: 105,
  MARKETING: 106,
  OPERATING_LEASE: 107,
  OTHER_FIXED: 108,
} as const;

const DENTAL_LABELS: ModelLabels = {
  receipts: {
    retailCard: 'Patient takings',
    onlineMarketplace: 'Membership & plan income',
    arCollections: 'Invoice collections (AR)',
    otherReceipts: 'Other income',
  },
  disbursements: {
    payrollBenefits: 'Staff & clinician pay',
    inventoryVendorPayments: 'Materials & lab fees',
    operatingAP: 'Supplier / operating bills',
    recurringPayments: 'Other fixed costs',
    rentFacilities: 'Rent & facilities',
    marketingDiscretionary: 'Marketing',
    tax: 'Tax',
    debtService: 'Debt service',
    purchaseCommitments: 'Capital / equipment',
    otherDisbursements: 'Other costs',
  },
};

const zeros = (): WeekArray => Array(WEEKS).fill(0);
const num = (v: unknown) => Number(v) || 0;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface DentpulseModelOptions {
  openingCash: number;
  threshold: number;
}

export interface DentpulseModelResult {
  model: CashFlowModel;
  warnings: string[];
}

export function useDentpulseCashModel() {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();

  const load = useCallback(
    async (opts: DentpulseModelOptions): Promise<DentpulseModelResult> => {
      if (!organizationId) throw new Error('No organization selected — sign in and pick an organization first.');
      const warnings: string[] = [];

      // ── Calendar: forward 13 Monday-weeks from this week's Monday; the trailing
      //    13 completed weeks are the actual baseline we repeat forward. ──
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dow = today.getDay(); // 0 Sun..6 Sat
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - ((dow + 6) % 7));
      const trailingStart = new Date(thisMonday);
      trailingStart.setDate(thisMonday.getDate() - WEEKS * 7);
      const trailingEnd = new Date(thisMonday);
      trailingEnd.setDate(thisMonday.getDate() - 1);
      const weeks = makeWeeks(ymd(thisMonday));

      // Location name for the title.
      let locationName = 'All locations';
      if (selectedLocationId) {
        try {
          const { data } = await (supabase as any)
            .from('practice_locations')
            .select('name')
            .eq('id', selectedLocationId)
            .single();
          if (data?.name) locationName = String(data.name);
        } catch {
          /* non-fatal */
        }
      }

      // ── Receipts: real weekly takings from dentally_payments (trailing 13w). ──
      const takings = zeros();
      const trailingStartMs = trailingStart.getTime();
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      let takingsRows = 0;
      try {
        const PAGE = 1000;
        let from = 0;
        // dp_dated_on < trailingEnd + 1 day (inclusive of the last trailing day)
        const upper = new Date(trailingEnd);
        upper.setDate(trailingEnd.getDate() + 1);
        while (true) {
          let q = (supabase as any)
            .from('dentally_payments')
            .select('dp_amount, dp_dated_on')
            .eq('organization_id', organizationId)
            .eq('dp_deleted', false)
            .not('dp_dated_on', 'is', null)
            .gte('dp_dated_on', ymd(trailingStart))
            .lt('dp_dated_on', ymd(upper));
          if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
          const { data, error } = await q.range(from, from + PAGE - 1);
          if (error) throw error;
          const rows = (data ?? []) as Array<{ dp_amount: number | string | null; dp_dated_on: string | null }>;
          for (const p of rows) {
            const d = (p.dp_dated_on || '').substring(0, 10);
            if (!d) continue;
            const [yy, mm, dd] = d.split('-').map(Number);
            const ms = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
            let idx = Math.floor((ms - trailingStartMs) / WEEK_MS);
            if (idx < 0) idx = 0;
            if (idx > WEEKS - 1) idx = WEEKS - 1;
            takings[idx] += num(p.dp_amount);
            takingsRows++;
          }
          if (rows.length < PAGE) break;
          from += PAGE;
        }
      } catch (e) {
        warnings.push(`Could not read patient takings: ${(e as Error).message}`);
      }
      if (takingsRows === 0) warnings.push('No patient takings found in the trailing 13 weeks for this scope.');

      // ── Costs: real trailing spend by Profit (Expenses) group. ──
      const groupTotals: Record<number, number> = {};
      let benchmarkOk = false;
      try {
        const resp = await getProfitBenchmark(organizationId, {
          fromDate: ymd(trailingStart),
          toDate: ymd(trailingEnd),
          locationId: selectedLocationId ?? null,
        });
        for (const r of resp.rows) {
          if (r.isProfitRow) continue;
          if (r.groupAccountMasterId == null) continue;
          groupTotals[r.groupAccountMasterId] =
            (groupTotals[r.groupAccountMasterId] ?? 0) + Math.abs(num(r.actualAmount));
        }
        benchmarkOk = Object.keys(groupTotals).length > 0;
      } catch (e) {
        warnings.push(`Could not read P&L costs (profit-benchmark): ${(e as Error).message}`);
      }
      if (!benchmarkOk) warnings.push('No P&L cost data returned — outflows will read low. Check Setup Categories → Profit (Expenses).');

      // Trailing total → level weekly run-rate, carried flat across all 13 weeks.
      const perWeek = (...ids: number[]) => {
        const total = ids.reduce((s, id) => s + (groupTotals[id] ?? 0), 0);
        return total / WEEKS;
      };

      const receipts = Object.fromEntries(RECEIPT_KEYS.map((k) => [k, zeros()])) as Record<ReceiptKey, WeekArray>;
      // Repeat the trailing weekly takings pattern forward.
      receipts.retailCard = [...takings];

      const disbursements = Object.fromEntries(
        DISBURSEMENT_KEYS.map((k) => [k, zeros()]),
      ) as Record<DisbursementKey, WeekArray>;
      const fill = (key: DisbursementKey, weekly: number) => {
        disbursements[key] = Array(WEEKS).fill(weekly);
      };
      fill('payrollBenefits', perWeek(G.STAFF, G.DENTIST, G.HYGIENIST, G.THERAPIST));
      fill('inventoryVendorPayments', perWeek(G.MATERIALS, G.LAB_FEES));
      fill('rentFacilities', perWeek(G.OPERATING_LEASE));
      fill('marketingDiscretionary', perWeek(G.MARKETING));
      fill('recurringPayments', perWeek(G.OTHER_FIXED));

      // ── Exceptions + self-check inputs (skill semantics). ──
      const exceptions: ExceptionRow[] = [];
      const openingResolved = opts.openingCash > 0;
      if (!openingResolved) {
        exceptions.push({
          issueType: 'Opening cash not set',
          sourceFile: 'bank balance',
          treatment: 'Enter your current bank balance — ending cash is meaningless without it.',
          cfoReview: true,
          category: 'cfo',
        });
      }
      if (!benchmarkOk) {
        exceptions.push({
          issueType: 'P&L cost groups unavailable',
          sourceFile: 'profit-benchmark',
          treatment: 'Outflows understated. Map Setup Categories → Profit (Expenses).',
          cfoReview: true,
          category: 'warning',
        });
      }

      const inventory: InputInventoryRow[] = [
        {
          fileName: 'dentally_payments (Dentally takings)',
          fileType: 'DentPulse table',
          rowCount: takingsRows,
          dateRange: `${ymd(trailingStart)} → ${ymd(trailingEnd)}`,
          mainColumns: 'dp_amount, dp_dated_on, location_id',
          forecastUse: 'Weekly patient takings (receipts)',
          usage: takingsRows > 0 ? 'Used' : 'Not used',
          issues: takingsRows > 0 ? 'none' : 'no rows in scope',
        },
        {
          fileName: 'Profit (Expenses) P&L — profit-benchmark',
          fileType: 'DentPulse engine',
          rowCount: Object.keys(groupTotals).length,
          dateRange: `${ymd(trailingStart)} → ${ymd(trailingEnd)}`,
          mainColumns: 'group_account_master_id, actualAmount',
          forecastUse: 'Weekly cost run-rate (disbursements)',
          usage: benchmarkOk ? 'Used' : 'Not used',
          issues: benchmarkOk ? 'none' : 'no cost groups returned',
        },
      ];

      const model = finalizeModel({
        title: `DentPulse — ${locationName} (13-Week Cash Flow)`,
        currencySymbol: '£',
        asOfDate: ymd(thisMonday),
        threshold: opts.threshold,
        openingCash: opts.openingCash,
        openingCashResolved: openingResolved,
        weeks,
        receipts,
        disbursements,
        labels: DENTAL_LABELS,
        assumptions: [
          'Receipts = real Dentally patient takings; the trailing 13-week weekly pattern is carried forward.',
          'Costs = real trailing P&L spend (Profit → Expenses groups), levelled to an even weekly run-rate.',
          'Opening cash is the bank balance you entered (no live bank feed).',
          `NHS and ${membershipProviderLabel(organizationId)} cash are included only insofar as they appear in Dentally takings.`,
        ],
        excludedItems: [],
        inventory,
        exceptions,
      });

      return { model, warnings };
    },
    [organizationId, selectedLocationId],
  );

  return { load, organizationId, hasOrg: !!organizationId };
}
