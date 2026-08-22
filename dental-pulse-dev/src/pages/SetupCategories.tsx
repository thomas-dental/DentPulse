import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { MainLayout } from "@/components/layout/MainLayout";
import type { ExpenseGroupOption } from "@/hooks/useProfitGroupExpense";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Save,
  Loader2,
  ListChecks,
  TrendingDown,
  Info,
  Calculator,
  Settings,
  Percent,
} from "lucide-react";

import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useLocationAccountingScope } from "@/hooks/useLocationAccountingScope";
import { useOrganization } from "@/hooks/useOrganization";
import { useSetupCategories } from "@/hooks/useSetupCategories";
import { useProfitGroupExpense } from "@/hooks/useProfitGroupExpense";
import { useCategoryWishList } from "@/hooks/useCategoryWishList";
import { useLocations } from "@/hooks/useLocations";
import {
  useEbitdaAccountMappings,
  type EbitdaAccountMappings,
} from "@/hooks/useEbitdaAccountMappings";
import {
  useLocationAccountSettings,
  useOrgExpenseFallback,
  type IncomeTypes,
  type LocationAccountSettings,
} from "@/hooks/useLocationAccountSettings";
import {
  useMembershipThresholds,
  useSaveMembershipThresholds,
  type MembershipStatusThresholds,
} from "@/hooks/useMembershipThresholds";
import { AccountMultiSelect } from "@/components/settings/AccountMultiSelect";
import { RevenueSettingsModal } from "@/components/settings/RevenueSettingsModal";
import {
  useRevenueSettings,
  type RevenueSettings,
} from "@/hooks/useRevenueSettings";
import { usePaymentPlans } from "@/hooks/usePaymentPlans";
import { supabase } from "@/integrations/supabase/client";
import { useFilters } from "@/contexts/FilterContext";
import {
  unionClinicianRoleAccounts,
} from "@/utils/clinicianCostAccounts";

import type {
  CategoryRangeVM,
  SaveCategoryRangePayload,
  SaveProfitGroupExpensePayload,
} from "@/types/setup-categories";

/** Org-level fallback only exists for these three (see useOrgExpenseFallback). */
const ORG_FALLBACK_EXPENSE_ROWS: { key: "labFees" | "staff" | "operatingLease"; label: string }[] = [
  { key: "labFees", label: "Lab Fees" },
  { key: "staff", label: "Staff Costs" },
  { key: "operatingLease", label: "Operating Lease" },
];

const EBITDA_BUCKETS: {
  key: keyof EbitdaAccountMappings;
  label: string;
  description: string;
}[] = [
  {
    key: "depreciation",
    label: "Depreciation",
    description:
      "Depreciation expense accounts added back when calculating EBITDA.",
  },
  {
    key: "amortisation",
    label: "Amortisation",
    description:
      "Amortisation expense accounts added back when calculating EBITDA.",
  },
  {
    key: "interest",
    label: "Interest Paid",
    description:
      "Interest / finance cost accounts added back when calculating EBITDA.",
  },
  {
    key: "tax",
    label: "Tax",
    description:
      "Corporation tax and other tax expense accounts added back for EBITDA.",
  },
];

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** e.g. "200 - Sales (REVENUE)" — account type helps map to cash-flow categories. */
function formatAccountOptionLabel(
  idRaw: string,
  codeRaw: string,
  nameRaw: string,
  typeRaw?: string | null,
  isActive: boolean = true,
): string {
  const id = String(idRaw || "").trim();
  const code = String(codeRaw || "").trim();
  const name = String(nameRaw || "").trim();
  const type = String(typeRaw || "")
    .trim()
    .toUpperCase();
  const showCode = !!code && code !== id && !isUuidLike(code);
  const base = showCode && name ? `${code} - ${name}` : name || code || id;
  const withType = !type || type === "OTHER" ? base : `${base} (${type})`;
  return isActive ? withType : `${withType} (Archived)`;
}

/** Cashflow layout pairs */
const CATEGORY_RANGE_PAIRS: {
  received: keyof CategoryRangeVM;
  receivedLabel: string;
  paid: (keyof CategoryRangeVM)[];
  paidLabels: string[];
}[] = [
  {
    received: "CFO",
    receivedLabel: "Cash Received From Operations",
    paid: ["DirectCost", "Overhead"],
    paidLabels: ["Direct Costs", "Overheads"],
  },
  {
    received: "CFI",
    receivedLabel: "Cash Received From Investing",
    paid: ["CFIPayment"],
    paidLabels: ["Cash Paid To Investing"],
  },
  {
    received: "CFF",
    receivedLabel: "Cash Received From Financing",
    paid: ["CFFPayment"],
    paidLabels: ["Cash Paid To Financing"],
  },
  {
    received: "IntraCompanyReceipt",
    receivedLabel: "Intra Company Receipts",
    paid: ["IntraCompanyPayment"],
    paidLabels: ["Intra Company Payments"],
  },
  {
    received: "IntraAccountReceipt",
    receivedLabel: "Intra Account Receipts",
    paid: ["IntraAccountPayment"],
    paidLabels: ["Intra Account Payments"],
  },
  {
    received: "TAXRefund",
    receivedLabel: "Tax Refund",
    paid: ["Compliance"],
    paidLabels: ["Compliance"],
  },
];

// Maps group_account_master.group_code (Revenue groups) to the matching
// revenue_settings income-level field, so a group whose Income Source is set
// to "By Provider" is hidden from account mapping here — that revenue is
// tracked per-associate elsewhere (e.g. the UDA/MOS contract goals tabs), not
// via a practice-wide account mapping.
const REVENUE_GROUP_LEVEL_KEY: Record<string, keyof RevenueSettings> = {
  PrivateIncome: "private_income_level",
  MembershipIncome: "membership_income_level",
  NHSIncome: "nhs_income_level",
  MOSIncome: "mos_income_level",
  UOAIncome: "uoa_income_level",
};

// Maps group_account_master.group_code (Revenue groups) to the matching
// revenue_settings Revenue Source field — decides which picker a group's
// mapping card shows: Chart-of-Accounts (accounting), Dentally payment plans
// (pms), or no picker at all (dentpulse — calculated automatically, no
// mapping needed). Mirrors fe-dentpulse-live's resolveCategories(incomeFrom).
const REVENUE_GROUP_FROM_KEY: Record<string, keyof RevenueSettings> = {
  PrivateIncome: "private_income_from",
  MembershipIncome: "membership_income_from",
  NHSIncome: "nhs_income_from",
  MOSIncome: "mos_income_from",
  UOAIncome: "uoa_income_from",
};

// Maps group_account_master.group_code (Revenue groups) to the matching
// LocationAccountSettings income key, so the Profit tab's group mappings can
// be mirrored into the legacy practice_locations columns that Dashboard,
// Cashflow Forecast, Provider Detail, and Profit Benchmark still read.
const REVENUE_GROUP_INCOME_KEY: Record<string, keyof IncomeTypes> = {
  PrivateIncome: "privateIncome",
  MembershipIncome: "membershipIncome",
  NHSIncome: "nhsIncome",
  MOSIncome: "mosIncome",
  UOAIncome: "uoaIncome",
};

/**
 * Derives the legacy costTypes / pnlAccounts / incomeTypes / incomeCoaTypes /
 * providerIncomeTypes.privateIncome columns from the Profit tab's Cost/
 * Expense/Revenue group mappings, so the Profit tab can be the single
 * editing surface while every other report keeps reading practice_locations
 * columns unchanged. Non-"practice"-level revenue rows (tracked per-associate
 * elsewhere) have no corresponding group and are carried over from `base`
 * untouched.
 */
function buildSyncedLocationAccountSettings(
  base: LocationAccountSettings,
  localExpenseGroups: Record<number, string[]>,
  costGroupOptions: ExpenseGroupOption[],
  expenseGroupOptions: ExpenseGroupOption[],
  revenueGroupOptions: ExpenseGroupOption[],
  revenueSettings: RevenueSettings,
): LocationAccountSettings {
  const accountsFor = (list: ExpenseGroupOption[], code: string): string[] => {
    const group = list.find((g) => g.group_code === code);
    return group ? localExpenseGroups[group.id] || [] : [];
  };
  const dedupe = (groups: ExpenseGroupOption[]): string[] =>
    Array.from(new Set(groups.flatMap((g) => localExpenseGroups[g.id] || [])));

  const incomeTypes: IncomeTypes = { ...base.incomeTypes };
  const incomeCoaTypes: IncomeTypes = { ...base.incomeCoaTypes };
  revenueGroupOptions.forEach((g) => {
    const levelKey = REVENUE_GROUP_LEVEL_KEY[g.group_code];
    const fromKey = REVENUE_GROUP_FROM_KEY[g.group_code];
    const incomeKey = REVENUE_GROUP_INCOME_KEY[g.group_code];
    if (!levelKey || !fromKey || !incomeKey) return;
    // Not shown/edited in the Profit tab when tracked "By Provider" — leave whatever was last saved.
    if (revenueSettings[levelKey] !== "practice") return;
    const accounts = localExpenseGroups[g.id] || [];
    const source = revenueSettings[fromKey];
    if (source === "pms") incomeTypes[incomeKey] = accounts;
    else if (source === "accounting") incomeCoaTypes[incomeKey] = accounts;
    // "dentpulse" — calculated automatically, no mapping to sync either way.
  });

  return {
    ...base,
    costTypes: {
      ...base.costTypes,
      labFees: accountsFor(costGroupOptions, "LabFees"),
      material: accountsFor(costGroupOptions, "Materials"),
      // Clinician Cost is derived — Hygienist + Dentist + Therapist — not a
      // separately mapped Setup Categories bucket.
      clinicianCost: unionClinicianRoleAccounts(localExpenseGroups, costGroupOptions),
      staff: accountsFor(expenseGroupOptions, "Staff"),
      operatingLease: accountsFor(expenseGroupOptions, "OperatingLease"),
      overhead: accountsFor(expenseGroupOptions, "OtherFixedCosts"),
      marketing: accountsFor(expenseGroupOptions, "Marketing"),
    },
    pnlAccounts: {
      // Exclude legacy ClinicianCost master so H/D/T accounts are not double-counted
      // when that master still has rows from older saves.
      costOfSales: dedupe(
        costGroupOptions.filter((g) => g.group_code !== "ClinicianCost"),
      ),
      administrativeCost: dedupe(expenseGroupOptions),
    },
    incomeTypes,
    incomeCoaTypes,
    // Provider Detail's per-provider private production (get_provider_net_production_monthly)
    // reads this column as PMS payment-plan IDs — it now always mirrors the
    // Private Income group's own mapping rather than being configured separately.
    providerIncomeTypes: {
      ...base.providerIncomeTypes,
      privateIncome: incomeTypes.privateIncome,
    },
  };
}

export default function SetupCategories() {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const [isRevenueSettingsOpen, setIsRevenueSettingsOpen] = useState(false);
  const { settings: revenueSettings } = useRevenueSettings(selectedLocationId);
  // PMS-side options for Revenue groups whose Revenue Source is set to "PMS".
  // Organization scope includes inactive Dentally plans and every site, so the
  // picker can group by location the same way as Dentally Payment Plans.
  const { paymentPlans } = usePaymentPlans(selectedLocationId, {
    scope: "organization",
  });
  const paymentPlanOptions = useMemo(() => {
    const UNASSIGNED = "Unassigned location";
    const selectedName =
      selectedLocationId && allAvailableLocations
        ? allAvailableLocations.find((l) => l.id === selectedLocationId)
            ?.location_name ?? null
        : null;

    const groupRank = (name: string) => {
      if (selectedName && name === selectedName) return 0;
      if (name === UNASSIGNED) return 2;
      return 1;
    };

    return paymentPlans
      .filter((p) => p.pp_id != null)
      .slice()
      .sort((a, b) => {
        const ga = a.locationName?.trim() || UNASSIGNED;
        const gb = b.locationName?.trim() || UNASSIGNED;
        const gr = groupRank(ga) - groupRank(gb);
        if (gr !== 0) return gr;
        if (ga !== gb) return ga.localeCompare(gb);
        const activeA = a.pp_is_active === false ? 1 : 0;
        const activeB = b.pp_is_active === false ? 1 : 0;
        if (activeA !== activeB) return activeA - activeB;
        return (a.pp_name || "").localeCompare(b.pp_name || "");
      })
      .map((p) => {
        const name = p.pp_name || `Plan #${p.pp_id}`;
        return {
          value: String(p.pp_id),
          label: p.pp_is_active === false ? `${name} (Inactive)` : name,
          group: p.locationName?.trim() || UNASSIGNED,
        };
      });
  }, [paymentPlans, selectedLocationId, allAvailableLocations]);
  const selectedLocationLabel = selectedLocationId
    ? (allAvailableLocations?.find((l) => l.id === selectedLocationId)
        ?.location_name ?? "the selected location")
    : "All Locations";
  const { scope: locationAccountingScope, isLoading: locationScopeLoading } =
    useLocationAccountingScope(organizationId, selectedLocationId);
  const isLocationScoped = !!selectedLocationId;
  /** Mappings are configured per location / accounting connection — not under All Locations. */
  const canEditMappings = isLocationScoped;

  /** Chart of accounts — include archived Xero/COA so historical P&L accounts remain mappable. */
  // Get all accounts first so we can determine an active platform integration id (if any)
  const { accounts: allAccounts, isLoading: allAccountsLoading } =
    useChartOfAccounts(undefined, true, null, true);

  const { data: iplicitIntegrationId } = useQuery({
    queryKey: ["setup-categories-iplicit-integration", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data } = await supabase
        .from("platform_integrations" as any)
        .select("id")
        .eq("organization_id", organizationId)
        .eq("platform_name", "iplicit")
        .maybeSingle();
      return (data as { id?: string | null } | null)?.id ?? null;
    },
    enabled: !!organizationId,
  });

  const { data: mappedIntegrationId } = useQuery({
    queryKey: ["setup-categories-mapped-integration", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("category_range_map" as any)
        .select("platform_integration_id")
        .eq("organization_id", organizationId)
        .not("platform_integration_id", "is", null);
      if (error) throw error;
      const ids = (
        (data || []) as Array<{ platform_integration_id?: string | null }>
      )
        .map((r) => r.platform_integration_id)
        .filter((id): id is string => !!id);
      if (!ids.length) return null;
      const counts = new Map<string, number>();
      ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    },
    enabled: !!organizationId,
  });

  const platformIntegrationId = useMemo(() => {
    if (isLocationScoped) {
      return locationAccountingScope.platformIntegrationId;
    }
    return (
      mappedIntegrationId ??
      iplicitIntegrationId ??
      allAccounts?.[0]?.platform_integration_id ??
      null
    );
  }, [
    isLocationScoped,
    locationAccountingScope.platformIntegrationId,
    mappedIntegrationId,
    iplicitIntegrationId,
    allAccounts,
  ]);

  const tenantOrgIdsForCoa = isLocationScoped
    ? locationAccountingScope.hasMapping
      ? locationAccountingScope.tenantOrgIds
      : []
    : null;

  // Fetch accounts scoped to the location's accounting software + tenant when a location is selected.
  // includeInactive: archived COA often still has journal history needed for Profit mapping.
  const { accounts, isLoading: accountsLoading } = useChartOfAccounts(
    platformIntegrationId,
    !isLocationScoped,
    tenantOrgIdsForCoa,
    true,
  );
  const hasAccounts = (accounts?.length ?? 0) > 0;
  const locationHasNoAccountingMapping =
    isLocationScoped &&
    !locationScopeLoading &&
    !locationAccountingScope.hasMapping;

  /** Category Range */
  const {
    categoryRange,
    isLoading: setupLoading,
    saveCategoryRange,
    isSaving,
    saveError,
  } = useSetupCategories(platformIntegrationId, selectedLocationId);

  /** Profit / Revenue + Cost + Expense Groups */
  const {
    revenueGroupOptions,
    costGroupOptions,
    expenseGroupOptions,
    profitGroupOptions,
    isLoading: expenseLoading,
    saveProfitGroupExpense,
    isSaving: expenseSaving,
    saveError: expenseSaveError,
  } = useProfitGroupExpense(platformIntegrationId, selectedLocationId);

  // Only show a Revenue group's account mapping card when its Income Source is
  // "By Practice" — "By Provider" groups are tracked per-associate elsewhere.
  const visibleRevenueGroupOptions = useMemo(
    () =>
      revenueGroupOptions.filter((g) => {
        const levelKey = REVENUE_GROUP_LEVEL_KEY[g.group_code];
        if (!levelKey) return true;
        return revenueSettings[levelKey] === "practice";
      }),
    [revenueGroupOptions, revenueSettings],
  );

  const {
    masters: wishListMasters,
    wishListGroups,
    isLoading: wishLoading,
    saveCategoryWishList,
    isSaving: wishSaving,
    saveError: wishSaveError,
  } = useCategoryWishList(platformIntegrationId, selectedLocationId);

  const {
    mappings: ebitdaMappingsRemote,
    isLoading: ebitdaLoading,
    save: saveEbitdaMappings,
    isSaving: ebitdaSaving,
    saveError: ebitdaSaveError,
  } = useEbitdaAccountMappings(selectedLocationId);

  /** Expense / Revenue / Provider Income / P&L account mappings (per location) */
  const {
    settings: locationAccountSettings,
    isLoading: locationAccountSettingsLoading,
    save: saveLocationAccountSettings,
    isSaving: locationAccountSettingsSaving,
    saveError: locationAccountSettingsSaveError,
  } = useLocationAccountSettings(selectedLocationId);

  /** Org-level fallback for Lab Fees / Staff Costs / Operating Lease — used only under "All Locations". */
  const {
    values: orgExpenseFallback,
    isLoading: orgExpenseFallbackLoading,
    save: saveOrgExpenseFallback,
    isSaving: orgExpenseFallbackSaving,
    saveError: orgExpenseFallbackSaveError,
  } = useOrgExpenseFallback();

  /** Membership Plan Status Thresholds — org-level, independent of location selection. */
  const orgMembershipThresholds = useMembershipThresholds();
  const {
    save: saveMembershipThresholds,
    isSaving: membershipThresholdsSaving,
    saveError: membershipThresholdsSaveError,
  } = useSaveMembershipThresholds();

  /** Local state */
  const [localCategoryRange, setLocalCategoryRange] =
    useState<CategoryRangeVM>(categoryRange);

  const [localExpenseGroups, setLocalExpenseGroups] = useState<
    Record<number, string[]>
  >({});

  const [localWishGroups, setLocalWishGroups] = useState<
    Record<number, string[]>
  >({});
  const [localEbitdaMappings, setLocalEbitdaMappings] =
    useState<EbitdaAccountMappings>({
      depreciation: [],
      amortisation: [],
      interest: [],
      tax: [],
    });
  const [isCategoryRangeDirty, setIsCategoryRangeDirty] = useState(false);
  const [isExpenseGroupsDirty, setIsExpenseGroupsDirty] = useState(false);
  const [isWishGroupsDirty, setIsWishGroupsDirty] = useState(false);
  const [isEbitdaDirty, setIsEbitdaDirty] = useState(false);

  useEffect(() => {
    setIsCategoryRangeDirty(false);
    setIsExpenseGroupsDirty(false);
    setIsWishGroupsDirty(false);
    setIsEbitdaDirty(false);
  }, [platformIntegrationId, selectedLocationId]);

  useEffect(() => {
    if (isEbitdaDirty) return;
    setLocalEbitdaMappings({
      depreciation: [...(ebitdaMappingsRemote.depreciation || [])],
      amortisation: [...(ebitdaMappingsRemote.amortisation || [])],
      interest: [...(ebitdaMappingsRemote.interest || [])],
      tax: [...(ebitdaMappingsRemote.tax || [])],
    });
  }, [ebitdaMappingsRemote, isEbitdaDirty]);

  // Org-level fallback (Lab Fees / Staff Costs / Operating Lease) — "All Locations" only.
  const [localOrgFallback, setLocalOrgFallback] = useState(orgExpenseFallback);
  const [isOrgFallbackDirty, setIsOrgFallbackDirty] = useState(false);

  useEffect(() => {
    if (isOrgFallbackDirty) return;
    setLocalOrgFallback(orgExpenseFallback);
  }, [orgExpenseFallback, isOrgFallbackDirty]);

  const updateOrgFallback = (key: "labFees" | "staff" | "operatingLease", value: string[]) => {
    setIsOrgFallbackDirty(true);
    setLocalOrgFallback((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveOrgFallback = async () => {
    try {
      await saveOrgExpenseFallback(localOrgFallback);
      setIsOrgFallbackDirty(false);
      toast.success("Organization default expense accounts saved.");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    }
  };

  // Membership Plan Status Thresholds — org-level, independent of location scoping.
  const [localMembershipThresholds, setLocalMembershipThresholds] =
    useState<MembershipStatusThresholds>(orgMembershipThresholds);
  const [isMembershipThresholdsDirty, setIsMembershipThresholdsDirty] = useState(false);

  useEffect(() => {
    if (isMembershipThresholdsDirty) return;
    setLocalMembershipThresholds(orgMembershipThresholds);
  }, [orgMembershipThresholds, isMembershipThresholdsDirty]);

  const handleSaveMembershipThresholds = async () => {
    try {
      await saveMembershipThresholds(localMembershipThresholds);
      setIsMembershipThresholdsDirty(false);
      toast.success("Membership plan status thresholds saved.");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    }
  };

  /** Account options */
  const liveAccountOptions = useMemo(
    () =>
      accounts?.map((a) => ({
        value: a.coa_account_id,
        label: formatAccountOptionLabel(
          a.coa_account_id,
          a.coa_account_code,
          a.coa_account_name,
          a.coa_account_type,
          a.coa_is_active !== false,
        ),
      })) ?? [],
    [accounts],
  );

  // Historical fallback — collect every account ID that already appears in the
  // saved category_range_map / group_account / wishlist tables and fetch their
  // names regardless of `is_active` / `coa_is_active`. Without this, prior
  // mappings disappear from the dropdowns whenever the live COA fetch returns
  // 0 rows (integration disconnected, swapped, or accounts archived) and the
  // user sees an empty page even though the mappings are still in the DB.
  const savedAccountIds = useMemo(() => {
    const set = new Set<string>();
    Object.values(categoryRange || {}).forEach((ids) => {
      (ids || []).forEach((id) => {
        if (id) set.add(String(id).trim());
      });
    });
    (profitGroupOptions || []).forEach((g) => {
      (g.accountIds || []).forEach((id) => {
        if (id) set.add(String(id).trim());
      });
    });
    Object.values(wishListGroups || {}).forEach((ids) => {
      (ids || []).forEach((id) => {
        if (id) set.add(String(id).trim());
      });
    });
    Object.values(ebitdaMappingsRemote || {}).forEach((ids) => {
      (ids || []).forEach((id) => {
        if (id) set.add(String(id).trim());
      });
    });
    return Array.from(set);
  }, [categoryRange, profitGroupOptions, wishListGroups, ebitdaMappingsRemote]);

  const { data: archivedAccountLabels } = useQuery({
    queryKey: [
      "setup-categories-archived-labels",
      organizationId,
      platformIntegrationId,
      tenantOrgIdsForCoa?.join(",") ?? "all",
      savedAccountIds.sort().join(","),
    ],
    enabled: !!organizationId && savedAccountIds.length > 0,
    queryFn: async () => {
      const labels = new Map<string, { value: string; label: string }>();
      if (!organizationId || savedAccountIds.length === 0) return labels;

      const addLabel = (
        idRaw: string,
        codeRaw: string,
        nameRaw: string,
        typeRaw?: string | null,
      ) => {
        const id = String(idRaw || "").trim();
        if (!id) return;
        labels.set(id, {
          value: id,
          label: formatAccountOptionLabel(idRaw, codeRaw, nameRaw, typeRaw),
        });
      };

      // 1) Legacy COA table — includes inactive rows too.
      let legacyQuery = supabase
        .from("platform_integration_chart_of_accounts" as any)
        .select(
          "coa_account_id, coa_account_code, coa_account_name, coa_account_type",
        )
        .eq("organization_id", organizationId)
        .in("coa_account_id", savedAccountIds);
      if (platformIntegrationId) {
        legacyQuery = legacyQuery.eq(
          "platform_integration_id",
          platformIntegrationId,
        );
      }
      if (tenantOrgIdsForCoa?.length) {
        legacyQuery = legacyQuery.in(
          "platform_integration_organization_id",
          tenantOrgIdsForCoa,
        );
      }
      const { data: legacyRows } = await legacyQuery;
      ((legacyRows as any[]) || []).forEach((r) => {
        addLabel(
          r.coa_account_id,
          r.coa_account_code,
          r.coa_account_name,
          r.coa_account_type,
        );
      });

      // 2) Xero dedicated COA table (active sync path for Xero tenants).
      const missingAfterLegacy = savedAccountIds.filter(
        (id) => !labels.has(id),
      );
      if (missingAfterLegacy.length > 0) {
        let xeroQuery = supabase
          .from("xero_chart_of_accounts" as any)
          .select(
            "xero_account_id, account_code, account_name, account_type, xero_tenant_id, platform_integration_id",
          )
          .eq("organization_id", organizationId)
          .in("xero_account_id", missingAfterLegacy);
        if (platformIntegrationId) {
          xeroQuery = xeroQuery.eq(
            "platform_integration_id",
            platformIntegrationId,
          );
        }
        const { data: xeroRows } = await xeroQuery;
        const { data: orgRows } = await supabase
          .from("platform_integration_organizations" as any)
          .select("id, platform_org_id")
          .eq("organization_id", organizationId);
        const tenantUuidToGuid = new Map<string, string>();
        (
          (orgRows || []) as Array<{
            id: string;
            platform_org_id: string | null;
          }>
        ).forEach((row) => {
          if (row.id && row.platform_org_id)
            tenantUuidToGuid.set(row.id, row.platform_org_id);
        });
        ((xeroRows || []) as any[]).forEach((r) => {
          const tenantId =
            tenantUuidToGuid.get(r.xero_tenant_id) ||
            r.platform_integration_organization_id ||
            r.xero_tenant_id;
          if (
            tenantOrgIdsForCoa?.length &&
            (!tenantId || !tenantOrgIdsForCoa.includes(tenantId))
          )
            return;
          addLabel(
            r.xero_account_id,
            r.account_code,
            r.account_name,
            r.account_type,
          );
        });
      }

      // 3) Canonical finance_accounts — match by canonical_account_code, all
      //    sources for this org, ignoring is_active. Won't double-add anything
      //    already labelled by step 1.
      const missing = savedAccountIds.filter((id) => !labels.has(id));
      if (missing.length > 0 && !tenantOrgIdsForCoa?.length) {
        let srcQuery = supabase
          .from("finance_data_sources" as any)
          .select("id")
          .eq("organization_id", organizationId);
        if (platformIntegrationId) {
          srcQuery = srcQuery.eq(
            "platform_integration_id",
            platformIntegrationId,
          );
        }
        const { data: srcRows } = await srcQuery;
        const srcIds = ((srcRows as any[]) || [])
          .map((s) => s.id)
          .filter(Boolean);
        if (srcIds.length > 0) {
          const { data: faRows } = await supabase
            .from("finance_accounts" as any)
            .select(
              "canonical_account_code, account_name, account_type, attributes_json",
            )
            .eq("organization_id", organizationId)
            .in("source_id", srcIds)
            .in("canonical_account_code", missing);
          ((faRows as any[]) || []).forEach((r) => {
            const id = String(r.canonical_account_code || "").trim();
            if (!id) return;
            const attrs = (r.attributes_json || {}) as Record<string, unknown>;
            const code = String(
              (attrs.coa_account_code as string) ||
                r.canonical_account_code ||
                "",
            ).trim();
            const name = String(r.account_name || "").trim();
            addLabel(id, code, name, r.account_type);
          });
        }
      }

      return labels;
    },
  });

  // Merge live + archived. Live options win on label (they're the freshest
  // copy); archived fills the gap so saved IDs aren't silently dropped.
  const accountOptions = useMemo(() => {
    const byValue = new Map<string, { value: string; label: string }>();
    (archivedAccountLabels?.values()
      ? Array.from(archivedAccountLabels.values())
      : []
    ).forEach((opt) => {
      byValue.set(opt.value, opt);
    });
    liveAccountOptions.forEach((opt) => byValue.set(opt.value, opt));
    return Array.from(byValue.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [liveAccountOptions, archivedAccountLabels]);

  // Some historical rows may store finance_accounts.id while current dropdown
  // uses coa_account_id (canonical/external id). Normalize loaded values so
  // previously saved mappings still resolve in the current UI options.
  const normalizeCategoryRangeIds = useMemo(() => {
    const aliasToValue = new Map<string, string>();
    (accounts || []).forEach((a) => {
      const canonicalValue = String(a.coa_account_id || "").trim();
      const internalId = String(a.id || "").trim();
      const accountCode = String(a.coa_account_code || "").trim();
      if (canonicalValue) {
        aliasToValue.set(canonicalValue, canonicalValue);
        if (internalId) aliasToValue.set(internalId, canonicalValue);
        if (accountCode) aliasToValue.set(accountCode, canonicalValue);
      }
    });

    return (input: CategoryRangeVM): CategoryRangeVM => {
      const next = { ...input } as CategoryRangeVM;
      (Object.keys(next) as (keyof CategoryRangeVM)[]).forEach((k) => {
        const mapped = (next[k] || []).map(
          (id) => aliasToValue.get(String(id).trim()) || String(id).trim(),
        );
        // keep order but remove duplicates caused by alias collapsing
        next[k] = mapped.filter((id, idx) => mapped.indexOf(id) === idx);
      });
      return next;
    };
  }, [accounts]);

  const normalizeAccountIdList = useMemo(() => {
    const aliasToValue = new Map<string, string>();
    (accounts || []).forEach((a) => {
      const canonicalValue = String(a.coa_account_id || "").trim();
      const internalId = String(a.id || "").trim();
      const accountCode = String(a.coa_account_code || "").trim();
      if (canonicalValue) {
        aliasToValue.set(canonicalValue, canonicalValue);
        if (internalId) aliasToValue.set(internalId, canonicalValue);
        if (accountCode) aliasToValue.set(accountCode, canonicalValue);
      }
    });

    return (ids: string[] = []) => {
      const mapped = ids.map(
        (id) => aliasToValue.get(String(id).trim()) || String(id).trim(),
      );
      return mapped.filter((id, idx) => mapped.indexOf(id) === idx);
    };
  }, [accounts]);

  /** Sync backend → local */
  useEffect(() => {
    if (isCategoryRangeDirty) return;
    setLocalCategoryRange(normalizeCategoryRangeIds(categoryRange));
  }, [categoryRange, normalizeCategoryRangeIds, isCategoryRangeDirty]);

  // useEffect(() => {
  //   const next: Record<number, string[]> = {};
  //   expenseGroupOptions.forEach((g) => {
  //     next[g.id] = g.accountIds || [];
  //   });

  //   // Only initialize local state on first load (when prev is empty), or merge in any new groups
  //   setLocalExpenseGroups((prev) => {
  //     const prevKeys = Object.keys(prev);
  //     if (prevKeys.length === 0) return next;

  //     // Merge new masters that didn't exist before, but do not overwrite existing selections
  //     let merged = { ...prev } as Record<number, string[]>;
  //     let added = false;
  //     Object.keys(next).forEach((k) => {
  //       const keyNum = Number(k);
  //       if (!Object.prototype.hasOwnProperty.call(prev, keyNum)) {
  //         merged[keyNum] = next[keyNum];
  //         added = true;
  //       }
  //     });
  //     return added ? merged : prev;
  //   });
  // }, [expenseGroupOptions]);
  useEffect(() => {
    if (isExpenseGroupsDirty) return;
    const next: Record<number, string[]> = {};
    profitGroupOptions.forEach((g) => {
      next[g.id] = normalizeAccountIdList(g.accountIds || []);
    });
    setLocalExpenseGroups(next);
  }, [profitGroupOptions, normalizeAccountIdList, isExpenseGroupsDirty]);

  // One-time-per-location carryover: groups the Setup Categories tabs used to
  // save into practice_locations directly (Expense Accounts / Revenue &
  // Provider Income / P&L Accounts, now removed) may already hold real
  // config that has no group_account rows yet. Prefill those still-empty
  // Profit tab groups from the legacy columns so an admin sees their
  // existing setup ready to review and save, rather than a blank tab.
  useEffect(() => {
    if (isExpenseGroupsDirty || locationAccountSettingsLoading) return;
    const legacyByCode: Record<string, string[]> = {
      LabFees: locationAccountSettings.costTypes.labFees,
      Materials: locationAccountSettings.costTypes.material,
      Staff: locationAccountSettings.costTypes.staff,
      OperatingLease: locationAccountSettings.costTypes.operatingLease,
      OtherFixedCosts: locationAccountSettings.costTypes.overhead,
      PrivateIncome:
        revenueSettings.private_income_from === "pms"
          ? locationAccountSettings.incomeTypes.privateIncome
          : locationAccountSettings.incomeCoaTypes.privateIncome,
      MembershipIncome:
        revenueSettings.membership_income_from === "pms"
          ? locationAccountSettings.incomeTypes.membershipIncome
          : locationAccountSettings.incomeCoaTypes.membershipIncome,
      NHSIncome:
        revenueSettings.nhs_income_from === "pms"
          ? locationAccountSettings.incomeTypes.nhsIncome
          : locationAccountSettings.incomeCoaTypes.nhsIncome,
      MOSIncome:
        revenueSettings.mos_income_from === "pms"
          ? locationAccountSettings.incomeTypes.mosIncome
          : locationAccountSettings.incomeCoaTypes.mosIncome,
    };

    setLocalExpenseGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      profitGroupOptions.forEach((g) => {
        if ((next[g.id] || []).length > 0) return;
        const legacy = legacyByCode[g.group_code];
        if (legacy && legacy.length > 0) {
          next[g.id] = normalizeAccountIdList(legacy);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [
    profitGroupOptions,
    locationAccountSettings,
    locationAccountSettingsLoading,
    revenueSettings,
    normalizeAccountIdList,
    isExpenseGroupsDirty,
  ]);
  useEffect(() => {
    if (isWishGroupsDirty) return;
    const next: Record<number, string[]> = {};
    wishListMasters.forEach((m) => {
      next[m.id] = normalizeAccountIdList(
        (wishListGroups && wishListGroups[m.id]) || [],
      );
    });
    setLocalWishGroups(next);
  }, [
    wishListMasters,
    wishListGroups,
    normalizeAccountIdList,
    isWishGroupsDirty,
  ]);

  const handleSaveWishList = async () => {
    if (!hasAccounts || !canEditMappings) return;
    try {
      await saveCategoryWishList({ groups: localWishGroups });
      setIsWishGroupsDirty(false);
      toast.success("Wishlist saved.");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    }
  };

  const handleSaveEbitda = async () => {
    if (!hasAccounts || !canEditMappings) return;
    try {
      await saveEbitdaMappings(localEbitdaMappings);
      setIsEbitdaDirty(false);
      toast.success("EBITDA account mappings saved.");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    }
  };

  /** Save handlers */
  const handleSaveCategoryRange = async () => {
    if (!hasAccounts || !canEditMappings) return;
    try {
      const payload: SaveCategoryRangePayload = {
        categoryRange: localCategoryRange,
      };
      await saveCategoryRange(payload);
      setIsCategoryRangeDirty(false);
      toast.success("Category range saved.");
    } catch (e) {
      toast.error("Save failed", {
        description: (e as Error).message,
      });
    }
  };

  const handleSaveExpense = async () => {
    if (!hasAccounts || !canEditMappings) return;
    try {
      const payload: SaveProfitGroupExpensePayload = {
        groups: profitGroupOptions.map((g) => ({
          groupAccountMasterId: g.id,
          name: g.name,
          // Clinician Cost is derived from Hygienist + Dentist + Therapist —
          // clear any legacy rows on the ClinicianCost master.
          accountIds:
            g.group_code === "ClinicianCost"
              ? []
              : localExpenseGroups[g.id] || [],
        })),
      };
      await saveProfitGroupExpense(payload);
      setIsExpenseGroupsDirty(false);

      // Keep the legacy practice_locations columns (still read directly by
      // Dashboard, Cost Impact, Cashflow Forecast, Provider Detail, and the
      // Profit & Loss Overview) in sync with what was just saved above.
      const syncedSettings = buildSyncedLocationAccountSettings(
        locationAccountSettings,
        localExpenseGroups,
        costGroupOptions,
        expenseGroupOptions,
        revenueGroupOptions,
        revenueSettings,
      );
      await saveLocationAccountSettings(syncedSettings);

      toast.success("Revenue, cost and expense groups saved.");
    } catch (e) {
      toast.error("Save failed", {
        description: (e as Error).message,
      });
    }
  };

  const isLoading =
    allAccountsLoading ||
    accountsLoading ||
    setupLoading ||
    locationScopeLoading;

  // Helper to get all selected account IDs across a category range
  const getAllSelectedInCategoryRange = useMemo(() => {
    const selected = new Set<string>();
    Object.values(localCategoryRange).forEach((accountIds) => {
      (accountIds || []).forEach((id) => selected.add(id));
    });
    return selected;
  }, [localCategoryRange]);

  // Filter options to exclude already selected accounts within category range
  const getFilteredCategoryRangeOptions = useMemo(() => {
    return accountOptions.filter(
      (opt) => !getAllSelectedInCategoryRange.has(opt.value),
    );
  }, [accountOptions, getAllSelectedInCategoryRange]);

  /** COA accounts not assigned to any Category Range section (Pro: Uncategorized Items). */
  const uncategorizedAccountOptions = getFilteredCategoryRangeOptions;

  // Helper to get all selected account IDs across Revenue / Cost / Expense
  // groups — same "assigned once" rule as Category Range. Only account-based
  // groups are unioned (revenue groups sourced from "accounting"); payment-plan
  // selections (source === "pms") and DentPulse-calculated groups (no mapping)
  // are excluded since they don't pull from accountOptions.
  const getAllSelectedInExpenseGroups = useMemo(() => {
    const accountBasedGroupIds = new Set<number>();
    visibleRevenueGroupOptions.forEach((g) => {
      const fromKey = REVENUE_GROUP_FROM_KEY[g.group_code];
      const source = fromKey ? revenueSettings[fromKey] : "accounting";
      if (source === "accounting") accountBasedGroupIds.add(g.id);
    });
    costGroupOptions
      .filter((g) => g.group_code !== "ClinicianCost")
      .forEach((g) => accountBasedGroupIds.add(g.id));
    expenseGroupOptions.forEach((g) => accountBasedGroupIds.add(g.id));

    const selected = new Set<string>();
    accountBasedGroupIds.forEach((id) => {
      (localExpenseGroups[id] || []).forEach((accId) => selected.add(accId));
    });
    return selected;
  }, [
    visibleRevenueGroupOptions,
    costGroupOptions,
    expenseGroupOptions,
    revenueSettings,
    localExpenseGroups,
  ]);

  // Filter options to exclude accounts already assigned to another Revenue /
  // Cost / Expense group.
  const getFilteredExpenseGroupOptions = useMemo(() => {
    return accountOptions.filter(
      (opt) => !getAllSelectedInExpenseGroups.has(opt.value),
    );
  }, [accountOptions, getAllSelectedInExpenseGroups]);

  // Helper to get all selected account IDs across the Wishlist groups
  const getAllSelectedInWishGroups = useMemo(() => {
    const selected = new Set<string>();
    Object.values(localWishGroups).forEach((accountIds) => {
      (accountIds || []).forEach((id) => selected.add(id));
    });
    return selected;
  }, [localWishGroups]);

  // Filter options to exclude already selected accounts within the Wishlist
  const getFilteredWishGroupOptions = useMemo(() => {
    return accountOptions.filter(
      (opt) => !getAllSelectedInWishGroups.has(opt.value),
    );
  }, [accountOptions, getAllSelectedInWishGroups]);

  // ExpenseGroupRow (memoized, defined at module scope)

  return (
    <MainLayout>
      <Helmet>
        <title>Account Categories Setup</title>
        <meta
          name="description"
          content="Configure chart of accounts category mappings and expense group classifications for reporting."
        />
      </Helmet>
      <div className="space-y-6">
        {/* PAGE HEADER */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Setup Categories</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Map your chart of accounts to cash flow categories and expense
            groups.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5" />
            <span>
              {selectedLocationId
                ? "Editing mappings for the selected location and its accounting connection. Cash flow reports use these location-specific mappings."
                : "Select a location in the top bar to configure mappings. Reports with All Locations combine each location’s individual setup automatically — there is no separate “All Locations” mapping to maintain."}
            </span>
          </div>

          {locationHasNoAccountingMapping && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <Info className="h-4 w-4 mt-0.5" />
              <span>
                This location is not mapped to an accounting organisation yet.
                Map it in <strong>Settings → Accounting Integrations</strong> to
                load its chart of accounts.
              </span>
            </div>
          )}

          {!locationHasNoAccountingMapping && !hasAccounts && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5" />
              <span>
                Please connect and sync your accounting integration (e.g. Xero)
                from <strong>Settings</strong> to enable configuration.
              </span>
            </div>
          )}
        </div>

        {(saveError ||
          expenseSaveError ||
          wishSaveError ||
          ebitdaSaveError ||
          locationAccountSettingsSaveError ||
          orgExpenseFallbackSaveError ||
          membershipThresholdsSaveError) && (
          <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
            {
              (
                saveError ||
                expenseSaveError ||
                wishSaveError ||
                (ebitdaSaveError as Error) ||
                (locationAccountSettingsSaveError as Error) ||
                (orgExpenseFallbackSaveError as Error) ||
                (membershipThresholdsSaveError as Error)
              )?.message
            }
          </div>
        )}

        <Tabs defaultValue="range" className="space-y-4">
          <TabsList className="h-auto flex flex-wrap justify-start gap-1">
            <TabsTrigger value="range" className="gap-2">
              <ListChecks className="h-4 w-4" />
              Category Range
            </TabsTrigger>
            <TabsTrigger value="profit" className="gap-2">
              <TrendingDown className="h-4 w-4" />
              Profit (Revenue &amp; Costs)
            </TabsTrigger>
            <TabsTrigger value="wishlist" className="gap-2">
              <ListChecks className="h-4 w-4" />
              Wishlist
            </TabsTrigger>
            <TabsTrigger value="ebitda" className="gap-2">
              <Calculator className="h-4 w-4" />
              EBITDA
            </TabsTrigger>
            <TabsTrigger value="membership-thresholds" className="gap-2">
              <Percent className="h-4 w-4" />
              Membership Thresholds
            </TabsTrigger>
          </TabsList>

          {/* ================= CATEGORY RANGE ================= */}
          <TabsContent value="range">
            <Card>
              <CardHeader>
                <CardTitle>Cash Flow – Received &amp; Paid</CardTitle>
                <CardDescription>
                  Assign accounts to each cash flow category.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* BANK */}
                {!isLoading && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <Label className="text-green-700">Bank</Label>
                    <AccountMultiSelect
                      showSelected
                      disabled={!hasAccounts || !canEditMappings}
                      options={
                        localCategoryRange.CashOrBank?.length
                          ? accountOptions.filter(
                              (opt) =>
                                !getAllSelectedInCategoryRange.has(
                                  opt.value,
                                ) ||
                                localCategoryRange.CashOrBank?.includes(
                                  opt.value,
                                ),
                            )
                          : getFilteredCategoryRangeOptions
                      }
                      value={localCategoryRange.CashOrBank || []}
                      onChange={(v) => {
                        setIsCategoryRangeDirty(true);
                        setLocalCategoryRange((p) => ({
                          ...p,
                          CashOrBank: v,
                        }));
                      }}
                    />
                  </div>
                )}

                {/* RECEIVED | PAID HEADER */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-3">
                  <div className="text-center font-semibold text-green-600">
                    Received
                  </div>
                  <div className="text-center font-semibold text-red-600">
                    Paid
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  CATEGORY_RANGE_PAIRS.map((pair) => (
                    <div
                      key={pair.received}
                      className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border p-4"
                    >
                      {/* RECEIVED */}
                      <div className="space-y-2">
                        <Label className="text-green-700">
                          {pair.receivedLabel}
                        </Label>
                        <AccountMultiSelect
                          showSelected
                          disabled={!hasAccounts || !canEditMappings}
                          options={
                            getAllSelectedInCategoryRange.has(
                              localCategoryRange[pair.received]?.[0] || "",
                            )
                              ? accountOptions.filter(
                                  (opt) =>
                                    !getAllSelectedInCategoryRange.has(
                                      opt.value,
                                    ) ||
                                    localCategoryRange[pair.received]?.includes(
                                      opt.value,
                                    ),
                                )
                              : getFilteredCategoryRangeOptions
                          }
                          value={localCategoryRange[pair.received] || []}
                          onChange={(v) => {
                            setIsCategoryRangeDirty(true);
                            setLocalCategoryRange((p) => ({
                              ...p,
                              [pair.received]: v,
                            }));
                          }}
                        />
                      </div>

                      {/* PAID */}
                      <div className="space-y-3">
                        {pair.paid.map((k, i) => (
                          <div key={k} className="space-y-2">
                            <Label className="text-red-700">
                              {pair.paidLabels[i]}
                            </Label>
                            <AccountMultiSelect
                              showSelected
                              disabled={!hasAccounts || !canEditMappings}
                              options={
                                localCategoryRange[k]?.length
                                  ? accountOptions.filter(
                                      (opt) =>
                                        !getAllSelectedInCategoryRange.has(
                                          opt.value,
                                        ) ||
                                        localCategoryRange[k]?.includes(
                                          opt.value,
                                        ),
                                    )
                                  : getFilteredCategoryRangeOptions
                              }
                              value={localCategoryRange[k] || []}
                              onChange={(v) => {
                                setIsCategoryRangeDirty(true);
                                setLocalCategoryRange((p) => ({
                                  ...p,
                                  [k]: v,
                                }));
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {/* Uncategorized COA — Pro parity: list accounts not in any section above */}
                {!isLoading && (
                  <div className="rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Label className="text-blue-700 dark:text-blue-300 text-base">
                          Uncategorized Items
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Chart of accounts not assigned to any Received or Paid
                          section above. Map them by selecting them in the
                          category dropdowns.
                        </p>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">
                        {uncategorizedAccountOptions.length} available
                      </span>
                    </div>
                    {uncategorizedAccountOptions.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        All chart of accounts are assigned.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto rounded-md border bg-background/80 p-3">
                        {uncategorizedAccountOptions.map((opt) => (
                          <span
                            key={opt.value}
                            className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2.5 py-1 text-sm text-foreground"
                            title={opt.value}
                          >
                            {opt.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveCategoryRange}
                    disabled={!hasAccounts || !canEditMappings || isSaving}
                    className="gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Category Range
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= PROFIT / COSTS + EXPENSES ================= */}
          <TabsContent value="profit">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>Revenue, Costs &amp; Expenses</CardTitle>
                  <CardDescription>
                    Map accounts to revenue (Private / Membership / NHS / MOS),
                    cost groups (COGS), and expense groups. This is the single
                    source of account mappings for Cost Impact, the Profit
                    &amp; Loss Overview, Cashflow Forecast, Provider Detail,
                    and Profit Benchmark.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsRevenueSettingsOpen(true)}
                  title="Revenue Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </CardHeader>

              <CardContent className="space-y-6">
                {!isLocationScoped ? (
                  <>
                    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      <Info className="h-4 w-4 mt-0.5" />
                      <span>
                        Organization default — used when a location has no override of its own. Overhead and Material have no organization-level default; select a location to configure them. Clinician Cost is Hygienist + Dentist + Therapist under Costs.
                      </span>
                    </div>
                    {orgExpenseFallbackLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading organization defaults...
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {ORG_FALLBACK_EXPENSE_ROWS.map((row) => (
                          <div key={row.key} className="border rounded-lg p-4 space-y-3">
                            <Label className="font-medium">{row.label}</Label>
                            <AccountMultiSelect
                              showSelected
                              disabled={!hasAccounts}
                              options={accountOptions}
                              value={localOrgFallback[row.key]}
                              onChange={(v) => updateOrgFallback(row.key, v)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveOrgFallback}
                        disabled={!hasAccounts || orgExpenseFallbackSaving}
                        className="gap-2"
                      >
                        {orgExpenseFallbackSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Organization Defaults
                      </Button>
                    </div>
                  </>
                ) : expenseLoading || locationAccountSettingsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading profit groups...
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        Revenue
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Private, membership, NHS, MOS, and UOA income accounts
                        that make up production income. Groups set to "By
                        Provider" in Revenue Settings are tracked per-associate
                        and don't need a mapping here.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {visibleRevenueGroupOptions.map((g) => {
                          const val = localExpenseGroups[g.id] || [];
                          const fromKey = REVENUE_GROUP_FROM_KEY[g.group_code];
                          const source = fromKey ? revenueSettings[fromKey] : "accounting";
                          return (
                            <div
                              key={g.id}
                              className="border rounded-lg p-4 space-y-3"
                            >
                              <Label className="font-medium">{g.name}</Label>
                              {source === "dentpulse" ? (
                                <p className="text-xs text-muted-foreground">
                                  Calculated automatically by DentPulse — no account mapping needed.
                                </p>
                              ) : source === "pms" ? (
                                <AccountMultiSelect
                                  showSelected
                                  disabled={!canEditMappings}
                                  options={paymentPlanOptions}
                                  value={val}
                                  placeholder="Select payment plans..."
                                  itemNoun="payment plan"
                                  onChange={(v) => {
                                    setIsExpenseGroupsDirty(true);
                                    setLocalExpenseGroups((p) => ({
                                      ...p,
                                      [g.id]: v,
                                    }));
                                  }}
                                />
                              ) : (
                                <AccountMultiSelect
                                  showSelected
                                  disabled={!hasAccounts || !canEditMappings}
                                  options={
                                    val.length
                                      ? accountOptions.filter(
                                          (opt) =>
                                            !getAllSelectedInExpenseGroups.has(
                                              opt.value,
                                            ) || val.includes(opt.value),
                                        )
                                      : getFilteredExpenseGroupOptions
                                  }
                                  value={val}
                                  onChange={(v) => {
                                    setIsExpenseGroupsDirty(true);
                                    setLocalExpenseGroups((p) => ({
                                      ...p,
                                      [g.id]: v,
                                    }));
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-border pt-6">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                        Costs
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Materials, lab fees, and clinician role costs (Hygienist, Dentist, Therapist).
                        Clinician Cost on Cost Impact is the sum of those three.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {costGroupOptions
                          .filter((g) => g.group_code !== "ClinicianCost")
                          .map((g) => {
                          const val = localExpenseGroups[g.id] || [];
                          return (
                            <div
                              key={g.id}
                              className="border rounded-lg p-4 space-y-3"
                            >
                              <Label className="font-medium">{g.name}</Label>
                              <AccountMultiSelect
                                showSelected
                                disabled={!hasAccounts || !canEditMappings}
                                options={
                                  val.length
                                    ? accountOptions.filter(
                                        (opt) =>
                                          !getAllSelectedInExpenseGroups.has(
                                            opt.value,
                                          ) || val.includes(opt.value),
                                      )
                                    : getFilteredExpenseGroupOptions
                                }
                                value={val}
                                onChange={(v) => {
                                  setIsExpenseGroupsDirty(true);
                                  setLocalExpenseGroups((p) => ({
                                    ...p,
                                    [g.id]: v,
                                  }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-border pt-6">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-500 dark:text-amber-400">
                        Expenses
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Staff, marketing, leases, and other fixed overheads (including overhead costs).
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {expenseGroupOptions.map((g) => {
                          const val = localExpenseGroups[g.id] || [];
                          return (
                            <div
                              key={g.id}
                              className="border rounded-lg p-4 space-y-3"
                            >
                              <Label className="font-medium">{g.name}</Label>
                              <AccountMultiSelect
                                showSelected
                                disabled={!hasAccounts || !canEditMappings}
                                options={
                                  val.length
                                    ? accountOptions.filter(
                                        (opt) =>
                                          !getAllSelectedInExpenseGroups.has(
                                            opt.value,
                                          ) || val.includes(opt.value),
                                      )
                                    : getFilteredExpenseGroupOptions
                                }
                                value={val}
                                onChange={(v) => {
                                  setIsExpenseGroupsDirty(true);
                                  setLocalExpenseGroups((p) => ({
                                    ...p,
                                    [g.id]: v,
                                  }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveExpense}
                        disabled={!hasAccounts || !canEditMappings || expenseSaving || locationAccountSettingsSaving}
                        className="gap-2"
                      >
                        {expenseSaving || locationAccountSettingsSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Revenue, Costs &amp; Expenses
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= WISHLIST ================= */}
          <TabsContent value="wishlist">
            <Card>
              <CardHeader>
                <CardTitle>Wishlist</CardTitle>
                <CardDescription>
                  Assign accounts to wishlist categories (people / marketing /
                  premises etc.). AR/AP account selectors are intentionally
                  excluded here.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {wishLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading wishlist groups...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {wishListMasters.map((m) => {
                      const val = localWishGroups[m.id] ?? [];
                      return (
                        <div
                          key={m.id}
                          className="border rounded-lg p-4 space-y-3"
                        >
                          <Label className="font-medium">{m.name}</Label>
                          <AccountMultiSelect
                            showSelected
                            disabled={!hasAccounts || !canEditMappings}
                            options={
                              val.length
                                ? accountOptions.filter(
                                    (opt) =>
                                      !getAllSelectedInWishGroups.has(
                                        opt.value,
                                      ) || val.includes(opt.value),
                                  )
                                : getFilteredWishGroupOptions
                            }
                            value={val}
                            onChange={(v) => {
                              setIsWishGroupsDirty(true);
                              setLocalWishGroups((p) => ({ ...p, [m.id]: v }));
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveWishList}
                    disabled={!hasAccounts || !canEditMappings || wishSaving}
                    className="gap-2"
                  >
                    {wishSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Wishlist
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= EBITDA ================= */}
          <TabsContent value="ebitda">
            <Card>
              <CardHeader>
                <CardTitle>EBITDA Add-backs</CardTitle>
                <CardDescription>
                  Map Chart of Accounts used to bridge Net Profit to EBITDA on
                  Profitability Analysis. Select accounts for Depreciation,
                  Amortisation, Interest Paid, and Tax — totals come from your
                  accounting app for the selected period.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ebitdaLoading || isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading EBITDA mappings...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {EBITDA_BUCKETS.map((bucket) => (
                      <div
                        key={bucket.key}
                        className="rounded-lg border p-4 space-y-2"
                      >
                        <Label className="text-base">{bucket.label}</Label>
                        <p className="text-xs text-muted-foreground">
                          {bucket.description}
                        </p>
                        <AccountMultiSelect
                          showSelected
                          disabled={!hasAccounts || !canEditMappings}
                          options={accountOptions}
                          value={localEbitdaMappings[bucket.key] || []}
                          onChange={(v) => {
                            setIsEbitdaDirty(true);
                            setLocalEbitdaMappings((prev) => ({
                              ...prev,
                              [bucket.key]: v,
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveEbitda}
                    disabled={!hasAccounts || !canEditMappings || ebitdaSaving}
                    className="gap-2"
                  >
                    {ebitdaSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save EBITDA
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= MEMBERSHIP THRESHOLDS ================= */}
          <TabsContent value="membership-thresholds">
            <Card>
              <CardHeader>
                <CardTitle>Membership Plan Status Thresholds</CardTitle>
                <CardDescription>
                  Set profit margin % thresholds to determine plan status (Profitable, At Risk, Loss-Making). Organization-level — applies across every location.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="border rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
                    <Label className="text-sm font-medium text-emerald-700 dark:text-emerald-400 block mb-1">
                      Profitable (&ge; %)
                    </Label>
                    <Input
                      type="number"
                      value={localMembershipThresholds.profitableMin}
                      onChange={(e) => {
                        setIsMembershipThresholdsDirty(true);
                        setLocalMembershipThresholds((prev) => ({
                          ...prev,
                          profitableMin: Number(e.target.value),
                        }));
                      }}
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Set the minimum profit margin % required to consider a membership plan financially healthy. Any plan with a margin at or above this value will be marked as Profitable.
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 italic">
                      e.g. Set to {localMembershipThresholds.profitableMin}% means the plan earns at least £{localMembershipThresholds.profitableMin} for every £100 collected after covering treatment costs.
                    </p>
                  </div>

                  <div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                    <Label className="text-sm font-medium text-amber-700 dark:text-amber-400 block mb-1">
                      At Risk (&ge; %)
                    </Label>
                    <Input
                      type="number"
                      value={localMembershipThresholds.atRiskMin}
                      onChange={(e) => {
                        setIsMembershipThresholdsDirty(true);
                        setLocalMembershipThresholds((prev) => ({
                          ...prev,
                          atRiskMin: Number(e.target.value),
                        }));
                      }}
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Plans that fall below the Profitable threshold but still have a non-negative margin will be marked as At Risk. This range signals the plan is breaking even or underperforming and needs attention.
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 italic">
                      e.g. A margin between {localMembershipThresholds.atRiskMin}% and {localMembershipThresholds.profitableMin - 0.01}% means the plan is covering costs but leaving little to no profit.
                    </p>
                  </div>

                  <div className="border rounded-lg p-3 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
                    <Label className="text-sm font-medium text-red-700 dark:text-red-400 block mb-1">
                      Loss-Making
                    </Label>
                    <Input
                      type="number"
                      value={localMembershipThresholds.atRiskMin}
                      disabled
                      className="h-9 bg-muted/50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      This threshold is automatically calculated. Any plan with a margin below {localMembershipThresholds.atRiskMin}% is marked as Loss-Making, meaning the cost of treating members exceeds the revenue collected from their plan fees.
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 italic">
                      e.g. A -5% margin means the practice is spending £5 more per £100 collected than it receives.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveMembershipThresholds}
                    disabled={membershipThresholdsSaving}
                    className="gap-2"
                  >
                    {membershipThresholdsSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Membership Thresholds
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <RevenueSettingsModal
        open={isRevenueSettingsOpen}
        onOpenChange={setIsRevenueSettingsOpen}
        locationId={selectedLocationId}
        locationLabel={selectedLocationLabel}
      />
    </MainLayout>
  );
}
