import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChartDateFilter,
  calculateDateRangeFromFilter,
  getDateFilterLabel,
  type DateFilterType,
  type CustomRange,
} from "@/components/ui/chart-date-filter";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipArrow,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import {
  Users,
  TrendingUp,
  Heart,
  PoundSterling,
  BarChart3,
  List,
  Download,
  Target,
  Loader2,
  Mail,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Phone,
  Calendar as CalendarIcon,
  Edit,
  Trash2,
  MoreVertical,
  SlidersHorizontal,
  X,
  Plus,
  Minus,
  CheckCheck,
  Copy,
  Info,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Area,
} from "recharts";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useProviders } from "@/hooks/useProviders";
import {
  providerPerformsNhs,
  providerPerformsMos,
  type Provider,
} from "@/types/provider";
import { useLocations } from "@/hooks/useLocations";
import { useProviderTypes } from "@/hooks/useProviderTypes";
import { useProductionMetrics } from "@/hooks/useProductionMetrics";
import { useProfitMetrics } from "@/hooks/useProfitMetrics";
import { useAssociatePerformanceMetrics } from "@/hooks/useAssociatePerformanceMetrics";
import {
  useAllProvidersNetProduction,
  tpiUnmappedAmount,
  type ProviderMonthlyProduction,
} from "@/hooks/useAllProvidersNetProduction";
import { useAllProvidersWorkingHours } from "@/hooks/useAllProvidersWorkingHours";
import {
  useAllProvidersCounts,
  type ProviderMonthlyCount,
} from "@/hooks/useAllProvidersCounts";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useFilters } from "@/contexts/FilterContext";
import { EntitySyncButton } from "@/components/sync/EntitySyncButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subMonths,
  subQuarters,
  subYears,
} from "date-fns";
import { DatePicker, ConfigProvider } from "antd";
import dayjs from "dayjs";
import "antd/dist/reset.css";
import { supabase } from "@/integrations/supabase/client";
import { getOpCostByPlatform } from "@/services/integrations/plCostService";
import { resolveBusinessInfoLocationId } from "@/lib/businessInfoLocation";
import {
  loadProviderCostInputs,
  type ProviderCostInputRow,
  type ProviderCostInputsResult,
} from "@/lib/providerCostInputs";
import {
  resolveProviderCost,
  isProductionScaledBasis,
} from "@/lib/providerCostResolution";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  CommonFilterValues,
  buildColumnVisibilityDefaults,
} from "../common/CommonFilterDialog";

interface ProvidersManagementProps {
  providerType: "Dentist" | "Therapist" | "Hygienist" | "Other";
}

const providerTypeToCardKey: Record<string, string> = {
  Dentist: "dentist_tab",
  Therapist: "therapist_tab",
  Hygienist: "hygienist_tab",
  Other: "other_tab",
};

const PRODUCTION_TREATMENT_TYPE_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "membership", label: "Membership" },
  { value: "nhs", label: "NHS" },
];

type ProductionProviderStatus = "all" | "active" | "inactive";

const PRODUCTION_PROVIDER_STATUS_OPTIONS: {
  value: ProductionProviderStatus;
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "inactive", label: "Inactive" },
];

function providerMatchesManagementType(
  provider: Provider,
  providerType: ProvidersManagementProps["providerType"],
): boolean {
  if (!provider.provider_role) return false;
  const role = provider.provider_role.toLowerCase();
  if (providerType === "Dentist") {
    return (
      role === "dentist" ||
      role === "dental surgeon" ||
      role === "principal dentist"
    );
  }
  if (providerType === "Hygienist") {
    return (
      role === "hygienist" ||
      role === "dental hygienist" ||
      role === "hygiene"
    );
  }
  if (providerType === "Therapist") {
    return (
      role === "therapist" ||
      role === "dental therapist" ||
      role === "therapy"
    );
  }
  return ![
    "dentist",
    "dental surgeon",
    "principal dentist",
    "hygienist",
    "dental hygienist",
    "hygiene",
    "therapist",
    "dental therapist",
    "therapy",
  ].includes(role);
}

function productionStatusMatches(
  isActive: boolean,
  status: ProductionProviderStatus,
): boolean {
  if (status === "all") return true;
  if (status === "active") return isActive;
  return !isActive;
}

function productionPersonKey(name: string): string {
  return name.trim().toLowerCase();
}

function personNameMatchesStatus(
  name: string,
  status: ProductionProviderStatus,
  roster: Provider[],
): boolean {
  const rows = roster.filter(
    (p) => productionPersonKey(p.name) === productionPersonKey(name),
  );
  // Keep fetched rows we cannot classify — dropping them made NHS/MOS look empty
  // when names did not line up with the roster.
  if (rows.length === 0) return true;
  return productionStatusMatches(
    rows.some((p) => p.is_active !== false),
    status,
  );
}

function emptyCountMonths(months: string[]): { [month: string]: number } {
  const monthlyData: { [month: string]: number } = {};
  for (const month of months) monthlyData[month] = 0;
  return monthlyData;
}

function visibleCountProvidersForStatus(
  countData: { providers: ProviderMonthlyCount[]; months: string[] } | undefined,
  roster: Provider[],
  status: ProductionProviderStatus,
  fallbackMonths: string[],
): ProviderMonthlyCount[] {
  const months =
    countData?.months && countData.months.length > 0
      ? countData.months
      : fallbackMonths;
  const merged = new Map<string, ProviderMonthlyCount>();

  for (const row of countData?.providers ?? []) {
    const key = productionPersonKey(row.providerName);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...row,
        monthlyData: { ...row.monthlyData },
      });
      continue;
    }
    const monthlyData = { ...existing.monthlyData };
    for (const month of months) {
      monthlyData[month] =
        (monthlyData[month] || 0) + (row.monthlyData[month] || 0);
    }
    merged.set(key, {
      ...existing,
      monthlyData,
      total: existing.total + row.total,
      externalIds: [
        ...new Set([...(existing.externalIds ?? []), ...(row.externalIds ?? [])]),
      ],
    });
  }

  const result: ProviderMonthlyCount[] = [];
  for (const row of merged.values()) {
    if (personNameMatchesStatus(row.providerName, status, roster)) {
      result.push(row);
    }
  }

  const covered = new Set(
    result.map((row) => productionPersonKey(row.providerName)),
  );
  const missingByKey = new Map<string, Provider>();
  for (const provider of roster) {
    if (!productionStatusMatches(provider.is_active !== false, status)) continue;
    const key = productionPersonKey(provider.name);
    if (covered.has(key)) continue;
    const existing = missingByKey.get(key);
    if (!existing || (provider.is_active && !existing.is_active)) {
      missingByKey.set(key, provider);
    }
  }

  for (const provider of missingByKey.values()) {
    const externalId =
      provider.external_id != null &&
      Number.isFinite(Number(provider.external_id))
        ? Number(provider.external_id)
        : null;
    result.push({
      providerId: provider.id,
      externalIds: externalId != null ? [externalId] : [],
      providerName: provider.name,
      monthlyData: emptyCountMonths(months),
      total: 0,
    });
  }

  return result.sort((a, b) =>
    a.providerName.localeCompare(b.providerName),
  );
}

function mergeProductionBreakdown(
  a?: ProviderMonthlyProduction["monthlyData"][string],
  b?: ProviderMonthlyProduction["monthlyData"][string],
): ProviderMonthlyProduction["monthlyData"][string] {
  return {
    amount: (a?.amount ?? 0) + (b?.amount ?? 0),
    private: (a?.private ?? 0) + (b?.private ?? 0),
    membership: (a?.membership ?? 0) + (b?.membership ?? 0),
    nhs: (a?.nhs ?? 0) + (b?.nhs ?? 0),
    rawTotal: (a?.rawTotal ?? 0) + (b?.rawTotal ?? 0),
  };
}

function ProductionIncomeBreakdown({
  privateAmt,
  membershipAmt,
  nhsAmt,
  rawTotal,
  formatCurrency,
}: {
  privateAmt: number;
  membershipAmt: number;
  nhsAmt: number;
  rawTotal: number;
  formatCurrency: (value: number) => string;
}) {
  const other = tpiUnmappedAmount(rawTotal, privateAmt);
  const row = (label: string, value: number) => (
    <div className="flex justify-between gap-6 items-center">
      <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm font-bold text-slate-900">
        {formatCurrency(value)}
      </span>
    </div>
  );
  return (
    <div className="space-y-2.5">
      {row("Private", privateAmt)}
      {other > 0.004 ? row("Other plans", other) : null}
      {row("Membership", membershipAmt)}
      {row("NHS", nhsAmt)}
    </div>
  );
}

function foldProductionPerson(
  existing: ProviderMonthlyProduction | undefined,
  incoming: ProviderMonthlyProduction,
  months: string[],
): ProviderMonthlyProduction {
  if (!existing) {
    return {
      ...incoming,
      monthlyData: { ...incoming.monthlyData },
      allProviderIds: [
        ...(incoming.allProviderIds ?? [incoming.providerId]),
      ],
      externalIds: [...(incoming.externalIds ?? [])],
    };
  }

  const monthlyData = { ...existing.monthlyData };
  for (const month of months) {
    monthlyData[month] = mergeProductionBreakdown(
      monthlyData[month],
      incoming.monthlyData[month],
    );
  }

  const preferIncoming =
    incoming.isActive && !existing.isActive
      ? true
      : incoming.isActive === existing.isActive &&
        incoming.total > existing.total;

  return {
    ...existing,
    providerId: preferIncoming ? incoming.providerId : existing.providerId,
    providerName: preferIncoming ? incoming.providerName : existing.providerName,
    locationId: preferIncoming ? incoming.locationId : existing.locationId,
    isActive: existing.isActive || incoming.isActive,
    allProviderIds: [
      ...new Set([
        ...existing.allProviderIds,
        ...(incoming.allProviderIds ?? []),
        incoming.providerId,
      ]),
    ],
    externalIds: [
      ...new Set([...existing.externalIds, ...(incoming.externalIds ?? [])]),
    ],
    monthlyData,
    total: existing.total + incoming.total,
    totalPrivate: existing.totalPrivate + incoming.totalPrivate,
    totalMembership: existing.totalMembership + incoming.totalMembership,
    totalNhs: existing.totalNhs + incoming.totalNhs,
    totalNhsRaw: existing.totalNhsRaw + incoming.totalNhsRaw,
    totalRaw: existing.totalRaw + incoming.totalRaw,
  };
}

function ProductionProviderStatusSelect({
  value,
  onChange,
  label,
}: {
  value: ProductionProviderStatus;
  onChange: (value: ProductionProviderStatus) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as ProductionProviderStatus)}
      >
        <SelectTrigger className="h-9 w-[130px] font-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUCTION_PROVIDER_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Display-only relabelling — "Dentist" reads as "Associate" in the UI.
// providerType itself must stay "Dentist" everywhere else: role filtering,
// RPC params (p_provider_type), permission card keys, and route segments
// (/providers/dentist) all key off the literal "Dentist" value.
const providerTypeDisplayLabel: Record<string, string> = {
  Dentist: "Associate",
};

const steps = [
  { value: "overview", label: "Overview", icon: BarChart3 },
  { value: "list", label: "List", icon: List },
  { value: "upload", label: "Production Data", icon: Download },
  { value: "profit-goals", label: "Profit Goals Settings", icon: Target },
];

// Mock data for revenue trends - this should come from your API
const revenueTrends = [
  { month: "Jul", revenue: 145000, patients: 420, utilisation: 85 },
  { month: "Aug", revenue: 142000, patients: 410, utilisation: 83 },
  { month: "Sep", revenue: 148000, patients: 435, utilisation: 87 },
  { month: "Oct", revenue: 150000, patients: 445, utilisation: 89 },
  { month: "Nov", revenue: 152000, patients: 450, utilisation: 90 },
  { month: "Dec", revenue: 155000, patients: 460, utilisation: 92 },
];

// Mock data for provider performance comparison
const providerPerformance = [
  { name: "Provider 1", revenue: 45000, patients: 120, utilisation: 92 },
  { name: "Provider 2", revenue: 38000, patients: 105, utilisation: 85 },
  { name: "Provider 3", revenue: 42000, patients: 115, utilisation: 88 },
  { name: "Provider 4", revenue: 30000, patients: 90, utilisation: 78 },
];

type SortKey =
  | "name"
  | "revenue"
  | "patients"
  | "avgRevPerPatient"
  | "utilisation";
type SortOrder = "asc" | "desc";
type DateFilterOption =
  | "this-month"
  | "this-quarter"
  | "this-year"
  | "last-month"
  | "last-quarter"
  | "last-year"
  | "custom";

// Mock ranking data
const mockProductionRankings = [
  {
    dentist: "Luke Fisher-Brown",
    production: 259287,
    avgDailyProduction: 2346,
    rank: 1,
  },
  {
    dentist: "Felicity Borrie",
    production: 26852,
    avgDailyProduction: 1977,
    rank: 2,
  },
  {
    dentist: "Rachel Ross",
    production: 89898,
    avgDailyProduction: 1696,
    rank: 3,
  },
  {
    dentist: "David Bianchi",
    production: 102172,
    avgDailyProduction: 1047,
    rank: 4,
  },
  {
    dentist: "Jennifer Bianchi",
    production: 87701,
    avgDailyProduction: 967,
    rank: 5,
  },
  {
    dentist: "Stuart Fleming",
    production: 103474,
    avgDailyProduction: 884,
    rank: 6,
  },
  {
    dentist: "Rachel Hygiene",
    production: 7340,
    avgDailyProduction: 546,
    rank: 7,
  },
];

const mockProfitRankings = [
  {
    dentist: "Felicity Borrie",
    periodicProfit: 1681,
    profitPerDay: 3430,
    profitPercent: 40.0,
    rank: 1,
  },
  {
    dentist: "Luke Fisher-Brown",
    periodicProfit: 4307,
    profitPerDay: 1347,
    profitPercent: 40.0,
    rank: 2,
  },
  {
    dentist: "Rachel Ross",
    periodicProfit: 1120,
    profitPerDay: 943,
    profitPercent: 40.0,
    rank: 3,
  },
  {
    dentist: "Rachel Hygiene",
    periodicProfit: 210,
    profitPerDay: 373,
    profitPercent: 40.0,
    rank: 4,
  },
  {
    dentist: "Stuart Fleming",
    periodicProfit: 916,
    profitPerDay: 278,
    profitPercent: 40.0,
    rank: 5,
  },
  {
    dentist: "David Bianchi",
    periodicProfit: 489,
    profitPerDay: 259,
    profitPercent: 40.0,
    rank: 6,
  },
  {
    dentist: "Jennifer Bianchi",
    periodicProfit: 365,
    profitPerDay: 222,
    profitPercent: 40.0,
    rank: 7,
  },
];

const mockAssociateProfitRankings = [
  {
    dentist: "Luke Fisher-Brown",
    targetGap: 767,
    performancePercent: 130,
    rank: 1,
  },
  {
    dentist: "Jennifer Bianchi",
    targetGap: -945,
    performancePercent: 37,
    rank: 2,
  },
  { dentist: "Rachel Hygiene", targetGap: 933, performancePercent: 0, rank: 3 },
  { dentist: "Rachel Ross", targetGap: 2357, performancePercent: 0, rank: 4 },
  { dentist: "Stuart Fleming", targetGap: 696, performancePercent: 0, rank: 5 },
  { dentist: "David Bianchi", targetGap: 648, performancePercent: 0, rank: 6 },
  {
    dentist: "Felicity Borrie",
    targetGap: 8576,
    performancePercent: 0,
    rank: 7,
  },
];

const mockUdaProfitRankings = [
  { dentist: "Rachel Hygiene", actual: 0, target: 0, rank: 1 },
  { dentist: "Luke Fisher-Brown", actual: 0, target: 0, rank: 2 },
  { dentist: "Rachel Ross", actual: 0, target: 0, rank: 3 },
  { dentist: "Jennifer Bianchi", actual: 0, target: 0, rank: 4 },
  { dentist: "Stuart Fleming", actual: 0, target: 0, rank: 5 },
  { dentist: "Felicity Borrie", actual: 0, target: 0, rank: 6 },
  { dentist: "David Bianchi", actual: 0, target: 0, rank: 7 },
];

// Always-whole-number variant — used for KPI summary tiles that should never show decimals.
const formatCurrencyRound = (value: number): string => {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    currencySign: "accounting",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const SPLIT_METHOD_LABEL: Record<string, string> = {
  "flat-percentage": "Flat Percentage",
  "sliding-scale": "Sliding Scale",
  "per-case": "Per Case",
  "per-hour": "Per Hour",
};

function getSplitMethodLabel(method: string | null | undefined): string {
  const key = method || "flat-percentage";
  return SPLIT_METHOD_LABEL[key] ?? key;
}

function formatSplitPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `${value}%`;
}

function formatSplitGbpRate(
  value: number | null | undefined,
  suffix: string,
): string | null {
  if (value === null || value === undefined) return null;
  return `£${value}${suffix}`;
}

function getAssociateSplitRate(provider: Provider): string | null {
  switch (provider.split_source_method) {
    case "per-case":
      return formatSplitGbpRate(provider.associate_split_per_case_rate, "/case");
    case "per-hour":
      return formatSplitGbpRate(provider.associate_split_per_hour_rate, "/hr");
    default:
      return formatSplitPercent(provider.associate_split_percentage);
  }
}

function getLabSplitRate(provider: Provider): string | null {
  if (provider.split_source_method === "sliding-scale") {
    return formatSplitPercent(
      provider.lab_split_percentage_sliding ?? provider.lab_split_percentage,
    );
  }
  return formatSplitPercent(provider.lab_split_percentage);
}

function ContractSplitCell({
  method,
  rate,
}: {
  method: string;
  rate: string | null;
}) {
  return (
    <td className="text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {method}
        </span>
        <span className="text-sm font-medium">{rate ?? "—"}</span>
      </div>
    </td>
  );
}

const columnVisibilityOptions = [
  { id: "showEmailColumn", label: "Email" },
  { id: "showPhoneColumn", label: "Phone No" },
  { id: "showJoiningDateColumn", label: "Joining Date" },
  { id: "showLeavingDateColumn", label: "Leaving Date" },
] as const;

export function ProvidersManagement({
  providerType,
}: ProvidersManagementProps) {
  const { can } = usePermissions();
  const { showDecimals } = useOrganizationSettings();
  // Helper function to format currency — respects the org's Show Decimals setting.
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      currencySign: "accounting",
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    }).format(value);
  };
  const cardKey = providerTypeToCardKey[providerType] || "dentist_tab";
  const displayProviderType =
    providerTypeDisplayLabel[providerType] || providerType;
  const productionShowProvidersLabel =
    displayProviderType === "Other"
      ? "Show Providers"
      : `Show ${displayProviderType}s`;
  const [activeTab, setActiveTab] = useState("overview");

  // Formula breakdown dialog state
  const [showFormulaDialog, setShowFormulaDialog] = useState(false);

  // Working Hours dialog state
  const [showWorkingHoursDialog, setShowWorkingHoursDialog] = useState(false);
  const [workingHoursRows, setWorkingHoursRows] = useState<
    {
      month: string;
      data: Record<
        string,
        {
          workingDuration: string;
          workingHoursPerDay: string;
          udaCount: string;
        }
      >;
    }[]
  >([{ month: "", data: {} }]);
  const [isLoadingWHDialog, setIsLoadingWHDialog] = useState(false);

  // NHS Count / MOS Count dialog state — same "add a month row" pattern as
  // Working Hours, but each edits a single appointment_summary column
  // (uda_count for NHS, mos_count for MOS).
  const [showNhsCountDialog, setShowNhsCountDialog] = useState(false);
  const [nhsCountRows, setNhsCountRows] = useState<
    { month: string; data: Record<string, { count: string }> }[]
  >([{ month: "", data: {} }]);
  const [isLoadingNhsCountDialog, setIsLoadingNhsCountDialog] = useState(false);

  const [showMosCountDialog, setShowMosCountDialog] = useState(false);
  const [mosCountRows, setMosCountRows] = useState<
    { month: string; data: Record<string, { count: string }> }[]
  >([{ month: "", data: {} }]);
  const [isLoadingMosCountDialog, setIsLoadingMosCountDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [globalDateFilter, setGlobalDateFilter] =
    useState<DateFilterOption>("this-month");
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [customStartDateOpen, setCustomStartDateOpen] = useState(false);
  const [customEndDateOpen, setCustomEndDateOpen] = useState(false);

  // Individual chart date filters
  const [productionDateFilter, setProductionDateFilter] =
    useState<DateFilterOption>("this-month");
  const [productionCustomRange, setProductionCustomRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [productionStartOpen, setProductionStartOpen] = useState(false);
  const [productionEndOpen, setProductionEndOpen] = useState(false);

  const [profitDateFilter, setProfitDateFilter] =
    useState<DateFilterOption>("this-month");
  const [profitCustomRange, setProfitCustomRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [profitStartOpen, setProfitStartOpen] = useState(false);
  const [profitEndOpen, setProfitEndOpen] = useState(false);

  const [associateDateFilter, setAssociateDateFilter] =
    useState<DateFilterOption>("this-month");
  const [associateCustomRange, setAssociateCustomRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [associateStartOpen, setAssociateStartOpen] = useState(false);
  const [associateEndOpen, setAssociateEndOpen] = useState(false);

  const [udaDateFilter, setUdaDateFilter] =
    useState<DateFilterOption>("this-month");
  const [udaCustomRange, setUdaCustomRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [udaStartOpen, setUdaStartOpen] = useState(false);
  const [udaEndOpen, setUdaEndOpen] = useState(false);

  // Production Data tab date filter - default to current month
  const [productionDataDateFilter, setProductionDataDateFilter] =
    useState<DateFilterType>("custom");
  const [productionDataCustomRange, setProductionDataCustomRange] =
    useState<CustomRange>(() => {
      const now = new Date();
      return {
        from: startOfMonth(now),
        to: endOfMonth(now),
      };
    });
  // Show the actual selected dates for a custom range instead of the generic
  // "Custom Range" label, so the trigger always reflects what's applied.
  const productionDataDateFilterLabel =
    productionDataDateFilter === "custom" &&
    productionDataCustomRange.from &&
    productionDataCustomRange.to
      ? `${format(productionDataCustomRange.from, "dd-MM-yyyy")} → ${format(productionDataCustomRange.to, "dd-MM-yyyy")}`
      : getDateFilterLabel(productionDataDateFilter);
  const productionDataDateRange = useMemo(() => {
    const r = calculateDateRangeFromFilter(
      productionDataDateFilter,
      productionDataCustomRange,
    );
    return { from: r.startDate, to: r.endDate };
  }, [productionDataDateFilter, productionDataCustomRange]);

  // Net Production table — Treatment Type (empty = All). Draft copies only
  // apply on Search. Provider Active/All/Inactive is a screen-level control.
  const [productionTreatmentTypes, setProductionTreatmentTypes] = useState<
    string[]
  >([]);
  const [productionTreatmentTypesDraft, setProductionTreatmentTypesDraft] =
    useState<string[]>([]);
  const [productionProviderStatus, setProductionProviderStatus] =
    useState<ProductionProviderStatus>("active");
  const [isProductionFilterOpen, setIsProductionFilterOpen] = useState(false);
  const productionFilterCount = productionTreatmentTypes.length;

  // Profit Goals Settings state - Will be set from business info
  const [profitGoalsDateFilter, setProfitGoalsDateFilter] =
    useState<DateFilterType>("custom");
  const [profitGoalsCustomRange, setProfitGoalsCustomRange] =
    useState<CustomRange>({ from: null, to: null });
  // Show the actual selected dates for a custom range instead of the generic
  // "Custom Range" label, so the trigger always reflects what's applied.
  const profitGoalsDateFilterLabel =
    profitGoalsDateFilter === "custom" &&
    profitGoalsCustomRange.from &&
    profitGoalsCustomRange.to
      ? `${format(profitGoalsCustomRange.from, "dd-MM-yyyy")} → ${format(profitGoalsCustomRange.to, "dd-MM-yyyy")}`
      : getDateFilterLabel(profitGoalsDateFilter);
  // Only "custom" is resolved via the raw picked range so downstream code can
  // keep gating on from/to being non-null until business info has loaded.
  const profitGoalsDateRange = useMemo(() => {
    if (profitGoalsDateFilter === "custom") {
      return {
        from: profitGoalsCustomRange.from,
        to: profitGoalsCustomRange.to,
      };
    }
    const r = calculateDateRangeFromFilter(
      profitGoalsDateFilter,
      profitGoalsCustomRange,
    );
    return { from: r.startDate, to: r.endDate };
  }, [profitGoalsDateFilter, profitGoalsCustomRange]);
  const [planningMonth, setPlanningMonth] = useState<Date | null>(null);
  const [expandedAssociate, setExpandedAssociate] = useState<string | null>(
    null,
  );

  // Formula breakdown dialog states
  const [showProductionFormula, setShowProductionFormula] = useState(false);
  const [showProfitFormula, setShowProfitFormula] = useState(false);
  const [showAssociateFormula, setShowAssociateFormula] = useState(false);
  const [showUtilisationFormula, setShowUtilisationFormula] = useState(false);

  const [financialMonthStart, setFinancialMonthStart] = useState<number | null>(
    null,
  );
  const [organizationData, setOrganizationData] = useState<any>(null);
  const [profitGoalsMetrics, setProfitGoalsMetrics] = useState({
    opCosts: 0, // Loaded from connected accounting platform via plCostService
    targetProfitPercent: 0,
    ocpspd: 0,
    weeksOpenPerYear: 0,
    daysOpenPerWeek: 0,
    openHoursPerDay: 8,
    numSurgeries: 0,
    workingDays: 0,
    surgeryDaysPerYear: 0,
    assocWeeksPerYear: 0,
    assocDaysPerWeek: 0,
    assocDaysPerYear: 0,
    practiceCostMaterialsPercent: 0,
    associateCostLabsPercent: 0,
  });
  const [providersPlannedProduction, setProvidersPlannedProduction] = useState<{
    [providerId: string]: number;
  }>({});
  const [providersPlannedInput, setProvidersPlannedInput] = useState<{
    [providerId: string]: string;
  }>({});
  const [allSavedPlannedRecords, setAllSavedPlannedRecords] = useState<any[]>(
    [],
  );

  // UDA Overview chart state — the "UDA Goals Settings" tab itself now lives in
  // <UdaContractGoalsPanel> (one instance per NHS/MOS sub-tab, each with its own
  // FY/contract-value/targets state). This chart only ever reads NHS yearly
  // targets/actuals, so it keeps its own minimal, NHS-scoped copy.
  const [udaSelectedFY, setUdaSelectedFY] = useState<number>(
    new Date().getFullYear(),
  );
  const [udaYearlyTargets, setUdaYearlyTargets] = useState<
    Record<string, string>
  >({});
  const [udaYearlyActuals, setUdaYearlyActuals] = useState<
    Record<string, number>
  >({});

  const navigate = useNavigate();
  const { user } = useAuth();
  const [tableFilters, setTableFilters] = useState<CommonFilterValues>({
    search: "",
    minRevenue: "",
    maxRevenue: "",
    joiningFrom: "",
    joiningTo: "",
    sortBy: "revenue",
    sortOrder: "desc",
    // Default: active providers only. List tab "Show inactive" clears this.
    onlyActive: true,
    ...buildColumnVisibilityDefaults([...columnVisibilityOptions], true),
  });

  // Fetch providers and provider types (include inactive so the List can toggle them in)
  const {
    providers,
    isLoading,
    refetch: refetchProviders,
  } = useProviders(undefined, undefined, { includeInactive: true });
  const { activeProviderTypes } = useProviderTypes();
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of allAvailableLocations) {
      map.set(loc.id, loc.location_name);
    }
    return map;
  }, [allAvailableLocations]);

  const LOCATION_CHIP_STYLES = [
    {
      chip: "bg-violet-50 border border-violet-200 text-violet-700",
      dot: "bg-violet-500",
    },
    {
      chip: "bg-emerald-50 border border-emerald-200 text-emerald-700",
      dot: "bg-emerald-500",
    },
    {
      chip: "bg-blue-50 border border-blue-200 text-blue-700",
      dot: "bg-blue-500",
    },
    {
      chip: "bg-amber-50 border border-amber-200 text-amber-700",
      dot: "bg-amber-500",
    },
    {
      chip: "bg-rose-50 border border-rose-200 text-rose-700",
      dot: "bg-rose-500",
    },
    {
      chip: "bg-cyan-50 border border-cyan-200 text-cyan-700",
      dot: "bg-cyan-500",
    },
    {
      chip: "bg-orange-50 border border-orange-200 text-orange-700",
      dot: "bg-orange-500",
    },
    {
      chip: "bg-teal-50 border border-teal-200 text-teal-700",
      dot: "bg-teal-500",
    },
    {
      chip: "bg-pink-50 border border-pink-200 text-pink-700",
      dot: "bg-pink-500",
    },
    {
      chip: "bg-indigo-50 border border-indigo-200 text-indigo-700",
      dot: "bg-indigo-500",
    },
  ];

  const locationColorMap = useMemo(() => {
    const map = new Map<string, { chip: string; dot: string }>();
    allAvailableLocations.forEach((loc, idx) => {
      map.set(loc.id, LOCATION_CHIP_STYLES[idx % LOCATION_CHIP_STYLES.length]);
    });
    return map;
  }, [allAvailableLocations]);
  const {
    selectedLocationId,
    dateRange: globalDateRange,
    selectedDateRangeId,
    customDateRange: filterContextCustomDateRange,
  } = useFilters();

  // Sync local globalDateFilter from the header's FilterContext whenever it changes
  useEffect(() => {
    const mapped = selectedDateRangeId as DateFilterOption;
    setGlobalDateFilter(mapped);
    if (
      selectedDateRangeId === "custom" &&
      filterContextCustomDateRange.from &&
      filterContextCustomDateRange.to
    ) {
      setCustomDateRange(filterContextCustomDateRange);
    }
  }, [selectedDateRangeId, filterContextCustomDateRange]);

  // Sync individual chart filters with global filter when global changes
  useEffect(() => {
    setProductionDateFilter(globalDateFilter);
    setProductionCustomRange(customDateRange);
    setProfitDateFilter(globalDateFilter);
    setProfitCustomRange(customDateRange);
    setAssociateDateFilter(globalDateFilter);
    setAssociateCustomRange(customDateRange);
    setUdaDateFilter(globalDateFilter);
    setUdaCustomRange(customDateRange);
  }, [globalDateFilter, customDateRange]);

  // Sync Production Data tab date picker with the global date range from FilterContext
  useEffect(() => {
    setProductionDataDateFilter("custom");
    setProductionDataCustomRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate.getTime(), globalDateRange.endDate.getTime()]);

  // Sync Profit Goals Settings' "Date Selection for Operations" with the
  // global date range from FilterContext too — same pattern as Production
  // Data above. The user can still narrow/change it locally afterward.
  useEffect(() => {
    setProfitGoalsDateFilter("custom");
    setProfitGoalsCustomRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate.getTime(), globalDateRange.endDate.getTime()]);

  // Calculate date range for production metrics
  const getDateRange = (
    filter: DateFilterOption,
    customRange: { from: Date | null; to: Date | null },
  ) => {
    const now = new Date();

    if (filter === "custom" && customRange.from && customRange.to) {
      return { startDate: customRange.from, endDate: customRange.to };
    }

    switch (filter) {
      case "this-month":
        return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
      case "this-quarter":
        return { startDate: startOfQuarter(now), endDate: endOfQuarter(now) };
      case "this-year":
        return { startDate: startOfYear(now), endDate: endOfYear(now) };
      case "last-month":
        const lastMonth = subMonths(now, 1);
        return {
          startDate: startOfMonth(lastMonth),
          endDate: endOfMonth(lastMonth),
        };
      case "last-quarter":
        const lastQuarter = subQuarters(now, 1);
        return {
          startDate: startOfQuarter(lastQuarter),
          endDate: endOfQuarter(lastQuarter),
        };
      case "last-year":
        const lastYear = subYears(now, 1);
        return {
          startDate: startOfYear(lastYear),
          endDate: endOfYear(lastYear),
        };
      default:
        return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
    }
  };

  // Get date range for production chart (synced with global, but can be overridden)
  const productionDateRange = getDateRange(
    productionDateFilter,
    productionCustomRange,
  );

  // Fetch production metrics from database
  const { data: productionMetrics, isLoading: isLoadingProduction } =
    useProductionMetrics(
      productionDateRange.startDate,
      productionDateRange.endDate,
      providerType,
      selectedLocationId,
    );

  // Fetch net production for the same date range to show consistent values in ranking table
  const { data: overviewNetProduction } = useAllProvidersNetProduction(
    providerType,
    productionDateRange.startDate,
    productionDateRange.endDate,
    selectedLocationId,
  );

  // Build provider name → net production total map. SUM rather than overwrite:
  // Dentally sync leaves behind inactive duplicate provider records (distinct
  // email, e.g. an "import+..." placeholder) that share the same real display
  // name as the active record — e.g. a real "Aurea Bond" plus a leftover
  // inactive duplicate also named "Aurea Bond". overviewNetProduction.providers
  // is grouped by email, so both appear as separate entries with the same
  // name; `.set()` silently let the duplicate's £0 clobber the real total.
  const overviewNetProductionMap = useMemo(() => {
    const map = new Map<string, number>();
    (overviewNetProduction?.providers || []).forEach((p) => {
      const key = p.providerName.toLowerCase();
      map.set(key, (map.get(key) ?? 0) + p.totalRaw);
    });
    return map;
  }, [overviewNetProduction]);

  const totalNetProduction = useMemo(() => {
    return (overviewNetProduction?.providers || []).reduce(
      (sum, p) => sum + p.totalRaw,
      0,
    );
  }, [overviewNetProduction]);

  // Transform production metrics for chart (show top 10 providers)
  const productionChartData = (productionMetrics || [])
    .slice(0, 10)
    .map((metric) => ({
      name: metric.provider_name
        .split(" ")
        .map((n, i) => (i === 0 ? n : n[0]))
        .join(" "), // Shorten name for chart
      production:
        overviewNetProductionMap.get(metric.provider_name.toLowerCase()) ??
        metric.production_amount,
      daysWorked: metric.days_worked,
    }));

  // Calculate totals for production
  const totalProduction = (productionMetrics || []).reduce(
    (sum, m) =>
      sum +
      (overviewNetProductionMap.get(m.provider_name.toLowerCase()) ??
        m.production_amount),
    0,
  );
  const totalAvgDailyProduction = useMemo(() => {
    return (productionMetrics || []).reduce((sum, m) => {
      const netProd =
        overviewNetProductionMap.get(m.provider_name.toLowerCase()) ??
        m.production_amount;
      const days = Number(m.days_worked);
      return sum + (days > 0 ? netProd / days : 0);
    }, 0);
  }, [productionMetrics, overviewNetProductionMap]);

  // Ranking rows. `rank` from chart_get_production_metrics is ordered by an
  // avg_daily_production the table never shows. Rank here off the same
  // Dentally-matching raw totals the Production cell displays.
  const rankingRows = useMemo(() => {
    return (productionMetrics || [])
      .map((row) => {
        const production =
          overviewNetProductionMap.get(row.provider_name.toLowerCase()) ??
          row.production_amount;
        const days = Number(row.days_worked);
        return {
          providerId: row.provider_id,
          providerName: row.provider_name,
          production,
          avgDailyProduction: days > 0 ? production / days : 0,
        };
      })
      .filter((row) => row.production > 0)
      .sort((a, b) => b.avgDailyProduction - a.avgDailyProduction)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }, [productionMetrics, overviewNetProductionMap]);

  // Get date range for profit chart (synced with global, but can be overridden)
  const profitDateRange = getDateRange(profitDateFilter, profitCustomRange);

  // Fetch profit metrics from database
  const { data: profitMetrics, isLoading: isLoadingProfit } = useProfitMetrics({
    startDate: profitDateRange.startDate,
    endDate: profitDateRange.endDate,
    organizationId: organizationId || "",
    providerType: providerType,
    locationId: selectedLocationId,
  });

  // Calculate totals for profit
  const totalPeriodicProfit = (profitMetrics || []).reduce(
    (sum, m) => sum + m.periodic_profit,
    0,
  );
  const totalPlPerDay = (profitMetrics || []).reduce(
    (sum, m) => sum + m.pl_per_day,
    0,
  );

  // Get date range for associate performance chart (synced with global, but can be overridden)
  const associateDateRange = getDateRange(
    associateDateFilter,
    associateCustomRange,
  );

  // Get date range for UDA Profit Performance chart
  const udaDateRange = getDateRange(udaDateFilter, udaCustomRange);

  // Fetch associate performance metrics from database
  const { data: associateMetrics, isLoading: isLoadingAssociate } =
    useAssociatePerformanceMetrics({
      startDate: associateDateRange.startDate,
      endDate: associateDateRange.endDate,
      organizationId: organizationId || "",
      providerType: providerType,
      locationId: selectedLocationId,
    });

  // Transform associate metrics for chart (show top 10 providers)
  const associateChartData = (associateMetrics || [])
    .slice(0, 10)
    .map((metric) => ({
      name: metric.provider_name
        .split(" ")
        .map((n, i) => (i === 0 ? n : n[0]))
        .join(" "), // Shorten name for chart
      actual: metric.daily_production,
      target: metric.planning_avg_daily_production,
      performance: metric.performance_percent || 0,
    }));

  // Calculate totals for associate performance
  const totalTargetGap = (associateMetrics || []).reduce(
    (sum, m) => sum + m.target_gap,
    0,
  );

  // Ranking table: ordered ascending by Target Gap (most behind target first),
  // rank recomputed to match — independent of the chart's performance-based order.
  const associateRankingRows = useMemo(() => {
    return [...(associateMetrics || [])]
      .sort((a, b) => a.target_gap - b.target_gap)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }, [associateMetrics]);

  const queryClient = useQueryClient();

  // Fetch all providers monthly net production data
  const {
    data: allProvidersProduction,
    isLoading: isLoadingAllProduction,
    isError: isProductionError,
    refetch: refetchAllProduction,
  } = useAllProvidersNetProduction(
      providerType,
      productionDataDateRange.from,
      productionDataDateRange.to,
      selectedLocationId,
    );

  // Net Production table — Dentally-matching raw TPI total when no payer
  // filter is set. Private / Membership / NHS filters still use the mapped
  // buckets (those need not sum to the Dentally figure).
  const getFilteredMonthAmount = (monthData: {
    amount: number;
    private: number;
    membership: number;
    nhs: number;
    rawTotal?: number;
  }) => {
    if (productionTreatmentTypes.length === 0) {
      return monthData.rawTotal ?? monthData.amount;
    }
    return productionTreatmentTypes.reduce(
      (sum, type) => sum + (monthData[type as keyof typeof monthData] || 0),
      0,
    );
  };

  const getFilteredProviderTotal = (provider: {
    total: number;
    totalRaw?: number;
    totalPrivate: number;
    totalMembership: number;
    totalNhs: number;
  }) => {
    if (productionTreatmentTypes.length === 0) {
      return provider.totalRaw ?? provider.total;
    }
    let sum = 0;
    if (productionTreatmentTypes.includes("private"))
      sum += provider.totalPrivate;
    if (productionTreatmentTypes.includes("membership"))
      sum += provider.totalMembership;
    if (productionTreatmentTypes.includes("nhs")) sum += provider.totalNhs;
    return sum;
  };

  const productionRoster = useMemo(
    () =>
      providers.filter((provider) => {
        if (!providerMatchesManagementType(provider, providerType)) return false;
        if (!selectedLocationId || selectedLocationId === "all") return true;
        return (
          provider.location_id === selectedLocationId ||
          provider.practice_id === selectedLocationId
        );
      }),
    [providers, providerType, selectedLocationId],
  );

  const visibleProductionProviders = useMemo(() => {
    const months = allProvidersProduction?.months ?? [];
    const productionList = allProvidersProduction?.providers ?? [];

    const folded = new Map<string, ProviderMonthlyProduction>();
    for (const row of productionList) {
      const key = productionPersonKey(row.providerName);
      folded.set(key, foldProductionPerson(folded.get(key), row, months));
    }

    for (const [key, row] of [...folded.entries()]) {
      if (
        !productionStatusMatches(
          row.isActive !== false,
          productionProviderStatus,
        )
      ) {
        folded.delete(key);
      }
    }

    const coveredIds = new Set<string>();
    for (const row of folded.values()) {
      coveredIds.add(row.providerId);
      for (const id of row.allProviderIds ?? []) coveredIds.add(id);
    }

    const emptyMonthlyData = (): ProviderMonthlyProduction["monthlyData"] => {
      const map: ProviderMonthlyProduction["monthlyData"] = {};
      for (const month of months) {
        map[month] = {
          amount: 0,
          private: 0,
          membership: 0,
          nhs: 0,
          rawTotal: 0,
        };
      }
      return map;
    };

    const missingByKey = new Map<string, Provider>();
    for (const provider of productionRoster) {
      if (
        !productionStatusMatches(
          provider.is_active !== false,
          productionProviderStatus,
        )
      ) {
        continue;
      }
      const nameKey = productionPersonKey(provider.name);
      if (folded.has(nameKey) || coveredIds.has(provider.id)) continue;
      const existing = missingByKey.get(nameKey);
      if (!existing || (provider.is_active && !existing.is_active)) {
        missingByKey.set(nameKey, provider);
      }
    }

    for (const provider of missingByKey.values()) {
      const externalId =
        provider.external_id != null &&
        Number.isFinite(Number(provider.external_id))
          ? Number(provider.external_id)
          : null;
      folded.set(productionPersonKey(provider.name), {
        providerId: provider.id,
        allProviderIds: [provider.id],
        externalId,
        externalIds: externalId != null ? [externalId] : [],
        providerName: provider.name,
        locationId: provider.location_id,
        monthlyData: emptyMonthlyData(),
        total: 0,
        totalPrivate: 0,
        totalMembership: 0,
        totalNhs: 0,
        totalNhsRaw: 0,
        totalRaw: 0,
        isActive: provider.is_active !== false,
      });
    }

    return [...folded.values()].sort((a, b) =>
      a.providerName.localeCompare(b.providerName),
    );
  }, [allProvidersProduction, productionProviderStatus, productionRoster]);

  // Fetch all providers monthly working hours data
  const {
    data: allProvidersHours,
    isLoading: isLoadingAllHours,
    isFetching: isFetchingAllHours,
  } = useAllProvidersWorkingHours(
    providerType,
    productionDataDateRange.from,
    productionDataDateRange.to,
    selectedLocationId,
  );
  const isLoadingWorkingHoursTable = isLoadingAllHours || isFetchingAllHours;

  // Fetch all providers NHS Count (uda_count) and MOS Count (mos_count) —
  // manually entered, no location dimension on appointment_summary, so unlike
  // working hours these aren't location-filtered.
  const { data: allProvidersNhsCounts, isLoading: isLoadingNhsCounts } =
    useAllProvidersCounts(
      providerType,
      productionDataDateRange.from,
      productionDataDateRange.to,
      "uda_count",
    );
  const { data: allProvidersMosCounts, isLoading: isLoadingMosCounts } =
    useAllProvidersCounts(
      providerType,
      productionDataDateRange.from,
      productionDataDateRange.to,
      "mos_count",
    );

  const visibleHoursProviders = useMemo(() => {
    return (allProvidersHours?.providers ?? []).filter(
      (provider) =>
        provider.total > 0 &&
        personNameMatchesStatus(
          provider.providerName,
          productionProviderStatus,
          productionRoster,
        ),
    );
  }, [allProvidersHours, productionProviderStatus, productionRoster]);

  const visibleNhsCountProviders = useMemo(
    () =>
      visibleCountProvidersForStatus(
        allProvidersNhsCounts,
        productionRoster,
        productionProviderStatus,
        allProvidersHours?.months ?? allProvidersProduction?.months ?? [],
      ),
    [
      allProvidersNhsCounts,
      productionRoster,
      productionProviderStatus,
      allProvidersHours?.months,
      allProvidersProduction?.months,
    ],
  );

  const visibleMosCountProviders = useMemo(
    () =>
      visibleCountProvidersForStatus(
        allProvidersMosCounts,
        productionRoster,
        productionProviderStatus,
        allProvidersHours?.months ?? allProvidersProduction?.months ?? [],
      ),
    [
      allProvidersMosCounts,
      productionRoster,
      productionProviderStatus,
      allProvidersHours?.months,
      allProvidersProduction?.months,
    ],
  );

  const nhsCountMonths =
    allProvidersNhsCounts?.months?.length
      ? allProvidersNhsCounts.months
      : (allProvidersHours?.months ?? allProvidersProduction?.months ?? []);
  const mosCountMonths =
    allProvidersMosCounts?.months?.length
      ? allProvidersMosCounts.months
      : (allProvidersHours?.months ?? allProvidersProduction?.months ?? []);

  // Fetch profit goals data - net production for all providers
  const {
    data: profitGoalsAllProduction,
    isLoading: isLoadingProfitGoalsProduction,
  } = useAllProvidersNetProduction(
    providerType,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
    selectedLocationId,
  );

  // Fetch profit goals data - working hours for all providers
  const { data: profitGoalsAllHours, isLoading: isLoadingProfitGoalsHours } =
    useAllProvidersWorkingHours(
      providerType,
      profitGoalsDateRange.from,
      profitGoalsDateRange.to,
      selectedLocationId,
    );

  // Fetch organization settings and business info
  useEffect(() => {
    const fetchBusinessInfo = async () => {
      if (!organizationId) return;

      try {
        // Fetch financial_month_start from organization_settings
        const { data: orgSettings, error: orgError } = await supabase
          .from("organization_settings")
          .select("financial_month_start")
          .eq("organization_id", organizationId)
          .maybeSingle();

        if (orgError) {
          console.error(
            "[ProvidersManagement] Error fetching organization settings:",
            orgError,
          );
        }

        // Business Settings now live per-location — scope by the top-bar
        // location filter, falling back to the org's primary location.
        const businessInfoLocationId = await resolveBusinessInfoLocationId(
          organizationId,
          selectedLocationId,
        );

        let orgData: any = null;
        if (businessInfoLocationId) {
          const { data, error: orgDataError } = await supabase
            .from("practice_locations" as any)
            .select(
              `
              target_profit_percent,
              week_open_per_year,
              days_open_per_week,
              open_hours_per_day,
              number_of_surgeries,
              associate_weeks_per_year,
              associate_days_per_week,
              practice_cost_materials_percent,
              associate_cost_labs_percent
            `,
            )
            .eq("id", businessInfoLocationId)
            .single();

          if (orgDataError) {
            console.error(
              "[ProvidersManagement] Error fetching location business settings:",
              orgDataError,
            );
          }
          orgData = data;
        }

        // Store business info for later calculations
        if (orgData) {
          setOrganizationData(orgData);
        }

        // Set financial month start and calculate default date range from organization settings
        const financialMonth = orgSettings?.financial_month_start || 4; // Default to April (month 4) if not set
        setFinancialMonthStart(financialMonth);

        // Sync UDA FY selector to current financial year start year
        const nowForUda = new Date();
        const curMonthForUda = nowForUda.getMonth() + 1;
        setUdaSelectedFY(
          curMonthForUda < financialMonth
            ? nowForUda.getFullYear() - 1
            : nowForUda.getFullYear(),
        );

        // Profit Goals Settings' own date range is synced from the top-nav
        // date filter (see the effect below) — no longer defaulted here.

        // Set planning month to current month
        setPlanningMonth(startOfMonth(new Date()));
      } catch (error) {
        console.error(
          "[ProvidersManagement] Error in fetchBusinessInfo:",
          error,
        );
      }
    };

    fetchBusinessInfo();
  }, [organizationId, selectedLocationId]);

  // Calculate profit goals metrics when organization data or date range changes
  useEffect(() => {
    const calculateMetrics = async () => {
      if (
        !organizationData ||
        !profitGoalsDateRange.from ||
        !profitGoalsDateRange.to
      )
        return;

      // Helper function to calculate business days (Mon-Fri) between two dates
      const calculateWorkingDays = (
        startDate: Date,
        endDate: Date,
        holidays: number,
      ) => {
        let count = 0;
        const current = new Date(startDate);

        while (current <= endDate) {
          const dayOfWeek = current.getDay();
          // Count only Monday (1) through Friday (5)
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            count++;
          }
          current.setDate(current.getDate() + 1);
        }

        // Subtract holidays
        return count - (holidays || 0);
      };

      // Calculate working days (using 0 holidays for now as field doesn't exist)
      const workingDays = calculateWorkingDays(
        profitGoalsDateRange.from,
        profitGoalsDateRange.to,
        0, // TODO: Add number_of_holidays field to organizations table
      );

      // Calculate surgery days per year
      const surgeryDaysPerYear =
        workingDays * (organizationData.number_of_surgeries || 0);

      // Calculate associate days per year
      const assocDaysPerYear =
        (organizationData.associate_weeks_per_year || 0) *
        (organizationData.associate_days_per_week || 0);

      // Fetch Op Costs from the connected accounting platform (iplicit / xero / quickbooks)
      // Use local date formatting to avoid UTC timezone shifting (toISOString() can shift date by -1 day)
      const toLocalDateStr = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const startDateStr = toLocalDateStr(profitGoalsDateRange.from);
      const endDateStr = toLocalDateStr(profitGoalsDateRange.to);
      let opCosts = 0;
      try {
        const { amount } = await getOpCostByPlatform(
          organizationId,
          startDateStr,
          endDateStr,
          "TC",
          selectedLocationId,
        );
        if (amount != null) opCosts = amount;
      } catch (plError) {
        console.error(
          "[ProvidersManagement] Error fetching P&L op costs:",
          plError,
        );
      }

      const targetProfitPercent = organizationData.target_profit_percent || 0;
      const ocpspd = surgeryDaysPerYear > 0 ? opCosts / surgeryDaysPerYear : 0;

      // Update state with all calculated metrics
      setProfitGoalsMetrics({
        opCosts,
        targetProfitPercent,
        ocpspd,
        weeksOpenPerYear: organizationData.week_open_per_year || 0,
        daysOpenPerWeek: organizationData.days_open_per_week || 0,
        openHoursPerDay: organizationData.open_hours_per_day || 8,
        numSurgeries: organizationData.number_of_surgeries || 0,
        workingDays,
        surgeryDaysPerYear,
        assocWeeksPerYear: organizationData.associate_weeks_per_year || 0,
        assocDaysPerWeek: organizationData.associate_days_per_week || 0,
        assocDaysPerYear,
        practiceCostMaterialsPercent:
          organizationData.practice_cost_materials_percent || 0,
        associateCostLabsPercent:
          organizationData.associate_cost_labs_percent || 0,
      });
    };

    calculateMetrics();
  }, [
    organizationData,
    profitGoalsDateRange,
    organizationId,
    selectedLocationId,
  ]);

  // Handle sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      const nextOrder = sortOrder === "asc" ? "desc" : "asc";
      setSortOrder(nextOrder);
      setTableFilters((prev) => ({
        ...prev,
        sortBy: key,
        sortOrder: nextOrder,
      }));
    } else {
      setSortKey(key);
      setSortOrder("desc");
      setTableFilters((prev) => ({ ...prev, sortBy: key, sortOrder: "desc" }));
    }
  };

  // const producedProviderNames = new Set(
  //   (rankingRows || []).map((r) => r.providerName.trim().toLowerCase()),
  // );

  // Management list: filter by provider type, search, optional home location,
  // and active/inactive — never by production for the period.
  const filteredProviders = providers
    .filter((provider) => {
      const matchesType = providerMatchesManagementType(provider, providerType);

      const effectiveSearch = String(
        tableFilters.search || searchQuery || "",
      ).toLowerCase();
      const matchesSearch =
        provider.name.toLowerCase().includes(effectiveSearch) ||
        (provider.email &&
          provider.email.toLowerCase().includes(effectiveSearch)) ||
        (provider.specialties?.name &&
          provider.specialties.name.toLowerCase().includes(effectiveSearch)) ||
        (provider.provider_role &&
          provider.provider_role.toLowerCase().includes(effectiveSearch));

      const minRevenue =
        tableFilters.minRevenue !== "" ? Number(tableFilters.minRevenue) : null;
      const maxRevenue =
        tableFilters.maxRevenue !== "" ? Number(tableFilters.maxRevenue) : null;
      const providerRevenue = Number(provider.revenue || 0);
      const matchesMinRevenue =
        minRevenue === null || providerRevenue >= minRevenue;
      const matchesMaxRevenue =
        maxRevenue === null || providerRevenue <= maxRevenue;

      const fromDate = tableFilters.joiningFrom
        ? new Date(String(tableFilters.joiningFrom))
        : null;
      const toDate = tableFilters.joiningTo
        ? new Date(String(tableFilters.joiningTo))
        : null;
      const providerDate = provider.joining_date
        ? new Date(provider.joining_date)
        : null;
      const matchesFromDate =
        !fromDate || (providerDate !== null && providerDate >= fromDate);
      const matchesToDate =
        !toDate || (providerDate !== null && providerDate <= toDate);

      // Default: active only. "Show inactive" clears onlyActive → active + inactive.
      const matchesActive = !tableFilters.onlyActive || provider.is_active;

      // Optional home-location scope from the top bar (not production-based).
      const matchesLocation =
        !selectedLocationId ||
        selectedLocationId === "all" ||
        provider.location_id === selectedLocationId ||
        provider.practice_id === selectedLocationId;

      return (
        matchesType &&
        matchesSearch &&
        matchesMinRevenue &&
        matchesMaxRevenue &&
        matchesFromDate &&
        matchesToDate &&
        matchesActive &&
        matchesLocation
      );
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "revenue":
          comparison = Number(b.revenue || 0) - Number(a.revenue || 0);
          break;
        case "patients":
          comparison = (b.patients || 0) - (a.patients || 0);
          break;
        case "avgRevPerPatient":
          comparison =
            Number(b.avg_rev_per_patient || 0) -
            Number(a.avg_rev_per_patient || 0);
          break;
        case "utilisation":
          comparison = Number(b.utilisation || 0) - Number(a.utilisation || 0);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  // Stable string key for the current filtered provider set — used as an
  // effect dependency instead of the filteredProviders array itself, which
  // is a new reference every render (not memoized) and would otherwise
  // re-trigger the cost-inputs fetch below on every render.
  const filteredProviderIdsKey = filteredProviders
    .map((p) => p.id)
    .sort()
    .join(",");

  // Per-provider lab/material cost sourcing — batched once for every
  // provider currently shown, resolved per-provider inside providersMetrics.
  const [providerCostInputsData, setProviderCostInputsData] =
    useState<ProviderCostInputsResult | null>(null);
  useEffect(() => {
    const load = async () => {
      if (
        !organizationId ||
        filteredProviders.length === 0 ||
        !profitGoalsDateRange.from ||
        !profitGoalsDateRange.to
      ) {
        setProviderCostInputsData(null);
        return;
      }
      try {
        const rows: ProviderCostInputRow[] = filteredProviders.map((p) => ({
          id: p.id,
          location_id: (p as any).location_id ?? null,
          lab_cost_source_method: (p as any).lab_cost_source_method ?? null,
          lab_cost_percentage: (p as any).lab_cost_percentage ?? null,
          lab_cost_account_id: (p as any).lab_cost_account_id ?? null,
          lab_cost_account_platform:
            (p as any).lab_cost_account_platform ?? null,
          material_cost_source_method:
            (p as any).material_cost_source_method ?? null,
          material_cost_percentage: (p as any).material_cost_percentage ?? null,
          material_cost_account_id: (p as any).material_cost_account_id ?? null,
          material_cost_account_platform:
            (p as any).material_cost_account_platform ?? null,
        }));
        const result = await loadProviderCostInputs({
          organizationId,
          providers: rows,
          dateFrom: profitGoalsDateRange.from,
          dateTo: profitGoalsDateRange.to,
        });
        setProviderCostInputsData(result);
      } catch (error) {
        console.error(
          "[ProvidersManagement] Error loading provider cost inputs:",
          error,
        );
        setProviderCostInputsData(null);
      }
    };
    load();
  }, [
    organizationId,
    filteredProviderIdsKey,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
  ]);

  // Fetch saved planned production records for all providers
  useEffect(() => {
    const fetchPlannedRecords = async () => {
      if (!organizationId || providers.length === 0) return;

      try {
        // Get all provider IDs
        const providerIds = providers.map((p) => p.id);

        // Initialize all providers with 0
        const plannedByProvider: { [key: string]: number } = {};
        const plannedInputByProvider: { [key: string]: string } = {};

        providerIds.forEach((id) => {
          plannedByProvider[id] = 0;
          plannedInputByProvider[id] = "0";
        });

        // Fetch ALL planned production records for all providers
        const { data, error } = await supabase
          .from("planned_daily_production")
          .select(
            `
            id,
            provider_id,
            average_daily_production,
            date_range_start,
            date_range_end,
            planning_month,
            planned_total_production,
            planned_associate_net_pay,
            planned_cost_of_labs,
            planned_materials,
            planned_practice_pl,
            working_days,
            notes,
            created_at,
            created_by,
            created_by_email
          `,
          )
          .eq("organization_id", organizationId)
          .in("provider_id", providerIds)
          .order("created_at", { ascending: false });

        if (error) {
          console.error(
            "[ProvidersManagement] Error fetching planned production records:",
            error,
          );
        }

        // Store all records for the table
        if (data && data.length > 0) {
          setAllSavedPlannedRecords(data);

          // Get most recent record for each provider to populate inputs
          const processedProviders = new Set<string>();

          data.forEach((record) => {
            if (!processedProviders.has(record.provider_id)) {
              const savedValue = Number(record.average_daily_production) || 0;
              plannedByProvider[record.provider_id] = savedValue;
              plannedInputByProvider[record.provider_id] = String(savedValue);
              processedProviders.add(record.provider_id);
            }
          });

          console.log(
            "[ProvidersManagement] Loaded planned production for providers:",
            plannedByProvider,
          );
        }

        // Update both states
        setProvidersPlannedProduction(plannedByProvider);
        setProvidersPlannedInput(plannedInputByProvider);
      } catch (error) {
        console.error(
          "[ProvidersManagement] Error in fetchPlannedRecords:",
          error,
        );
      }
    };

    fetchPlannedRecords();
  }, [organizationId, providers]);

  // Calculate metrics for each provider (for Profit Goals tab)
  const providersMetrics = useMemo(() => {
    if (
      !profitGoalsAllProduction?.providers ||
      !profitGoalsAllHours?.providers ||
      !profitGoalsMetrics.assocDaysPerYear
    ) {
      return [];
    }

    return filteredProviders.map((provider) => {
      // Match by any of the provider's external_ids — useProviders deduplicates by email
      // and may pick a different "first" row than useAllProvidersNetProduction, causing
      // provider.external_id to differ from the stored externalId. Checking all externalIds
      // in the hook result ensures the match always succeeds for multi-location providers.
      const providerExtId = provider.external_id
        ? Number(provider.external_id)
        : null;
      const productionData =
        profitGoalsAllProduction.providers.find(
          (p) =>
            providerExtId !== null && p.externalIds.includes(providerExtId),
        ) ??
        profitGoalsAllProduction.providers.find(
          (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
        );
      const hoursData =
        profitGoalsAllHours.providers.find(
          (p) =>
            providerExtId !== null && p.externalIds.includes(providerExtId),
        ) ??
        profitGoalsAllHours.providers.find(
          (p) => p.providerName.toLowerCase() === provider.name.toLowerCase(),
        );

      const totalProduction = productionData?.total || 0;
      // Use totalExact (unrounded) when available — avoids 1dp rounding before the
      // hours→days division, matching Overview's single-query SUM/60/hours_per_day.
      const totalWorkingHours = hoursData?.totalExact ?? hoursData?.total ?? 0;

      // Calculate working days
      const hoursPerDay = profitGoalsMetrics.openHoursPerDay || 8;
      const workingDays = hoursPerDay > 0 ? totalWorkingHours / hoursPerDay : 0;

      // Calculate average daily production
      const avgDailyProduction =
        workingDays > 0 ? totalProduction / workingDays : 0;

      // Get provider's split percentages
      const associateSplitPercent =
        (provider as any).associate_split_percentage || 30;
      const associateLabSplitPercent =
        (provider as any).lab_split_percentage || 50;

      // Resolve this provider's own lab/material cost — location flat
      // percentage unless their location is Associate Wise and they've been
      // configured with their own cost source.
      const providerLocationId = (provider as any).location_id ?? null;
      const gate = providerLocationId
        ? providerCostInputsData?.locationGateByLocationId.get(
            providerLocationId,
          )
        : undefined;
      const labGateActive =
        gate?.associate_cost_lab_source === "associate_wise";
      const materialGateActive =
        gate?.material_cost_source === "associate_wise";
      const labResolved = resolveProviderCost({
        sourceMethod: labGateActive
          ? ((provider as any).lab_cost_source_method ?? null)
          : null,
        flatPercentage: (provider as any).lab_cost_percentage ?? null,
        production: totalProduction,
        accountAmount:
          providerCostInputsData?.accountAmountByProviderId.get(provider.id)
            ?.lab ?? null,
        monthlyValues:
          providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)
            ?.lab ?? [],
        monthlyBillByMonth: providerLocationId
          ? (providerCostInputsData?.monthlyBillByLocationId.get(
              providerLocationId,
            )?.lab ?? [])
          : [],
        bands:
          providerCostInputsData?.bandsByProviderId.get(provider.id)?.lab ?? [],
        fallbackLocationPercent:
          gate?.associate_cost_labs_percent ??
          profitGoalsMetrics.associateCostLabsPercent,
      });
      const materialResolved = resolveProviderCost({
        sourceMethod: materialGateActive
          ? ((provider as any).material_cost_source_method ?? null)
          : null,
        flatPercentage: (provider as any).material_cost_percentage ?? null,
        production: totalProduction,
        accountAmount:
          providerCostInputsData?.accountAmountByProviderId.get(provider.id)
            ?.material ?? null,
        monthlyValues:
          providerCostInputsData?.monthlyValuesByProviderId.get(provider.id)
            ?.material ?? [],
        monthlyBillByMonth: providerLocationId
          ? (providerCostInputsData?.monthlyBillByLocationId.get(
              providerLocationId,
            )?.material ?? [])
          : [],
        bands:
          providerCostInputsData?.bandsByProviderId.get(provider.id)
            ?.material ?? [],
        fallbackLocationPercent:
          gate?.practice_cost_materials_percent ??
          profitGoalsMetrics.practiceCostMaterialsPercent,
      });

      const costOfLabs = labResolved.amount;
      const materialsCosts = materialResolved.amount;

      // Calculate associate metrics
      const associateGrossShare =
        totalProduction * (associateSplitPercent / 100);
      const labCostDeduction = costOfLabs * (associateLabSplitPercent / 100);
      const associateNetPay = associateGrossShare - labCostDeduction;

      // Calculate number of months
      const startDate = profitGoalsDateRange.from;
      const endDate = profitGoalsDateRange.to;
      const numberOfMonths =
        startDate && endDate
          ? (endDate.getFullYear() - startDate.getFullYear()) * 12 +
            (endDate.getMonth() - startDate.getMonth()) +
            1
          : 12;
      const avgLabCostPerMonth =
        numberOfMonths > 0 ? costOfLabs / numberOfMonths : 0;

      const ocpspaContribution = profitGoalsMetrics.ocpspd * workingDays;
      const practicePL =
        totalProduction -
        (associateNetPay + costOfLabs + materialsCosts + ocpspaContribution);
      const plPercentOnOCPSPD =
        ocpspaContribution > 0 ? (practicePL / ocpspaContribution) * 100 : 0;
      const plOnRoomPerDay = workingDays > 0 ? practicePL / workingDays : 0;

      // Get planned values
      const plannedAvgDaily = providersPlannedProduction[provider.id] || 0;
      const plannedTotalProduction = plannedAvgDaily * workingDays;
      // Absolute-£ sources (accounting application / sliding scale / monthly)
      // have no defined "planned" variant that scales with planned production
      // — the actual resolved figure is the honest number to use as the plan too.
      const plannedCostOfLabs = isProductionScaledBasis(labResolved.basis)
        ? plannedTotalProduction *
          (totalProduction > 0 ? costOfLabs / totalProduction : 0)
        : costOfLabs;
      const plannedMaterials = isProductionScaledBasis(materialResolved.basis)
        ? plannedTotalProduction *
          (totalProduction > 0 ? materialsCosts / totalProduction : 0)
        : materialsCosts;
      const plannedAssociateGrossShare =
        plannedTotalProduction * (associateSplitPercent / 100);
      const plannedLabCostDeduction =
        plannedCostOfLabs * (associateLabSplitPercent / 100);
      const plannedAssociateNetPay =
        plannedAssociateGrossShare - plannedLabCostDeduction;
      const plannedPracticePL =
        plannedTotalProduction -
        (associateNetPay + costOfLabs + plannedMaterials + ocpspaContribution);

      return {
        provider,
        avgDailyProduction,
        totalProduction,
        workingDays,
        associateSplitPercent,
        associateLabSplitPercent,
        associateNetPay,
        costOfLabs,
        avgLabCostPerMonth,
        materialsCosts,
        ocpspaContribution,
        practicePL,
        plPercentOnOCPSPD,
        plOnRoomPerDay,
        plannedAvgDaily,
        plannedTotalProduction,
        plannedAssociateNetPay,
        plannedCostOfLabs,
        plannedMaterials,
        plannedPracticePL,
      };
    });
  }, [
    filteredProviders,
    profitGoalsAllProduction,
    profitGoalsAllHours,
    profitGoalsMetrics,
    profitGoalsDateRange,
    providersPlannedProduction,
    providerCostInputsData,
  ]);

  // Copy planned production value to clipboard
  const copyPlannedValue = async (providerId: string) => {
    const plannedValue = providersPlannedInput[providerId] || "0";
    try {
      await navigator.clipboard.writeText(plannedValue);
      toast.success("Planned value copied to clipboard");
    } catch (error) {
      console.error("[ProvidersManagement] Error copying to clipboard:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  // Save planned daily production for a provider
  const savePlannedDailyProduction = async (providerId: string) => {
    if (!organizationId || !user) {
      toast.error("Missing required information");
      return;
    }

    if (!profitGoalsDateRange.from || !profitGoalsDateRange.to) {
      toast.error("Please select date range for operations");
      return;
    }

    if (!planningMonth) {
      toast.error("Please select planning month");
      return;
    }

    const plannedValue = providersPlannedProduction[providerId] ?? 0;
    if (plannedValue < 0) {
      toast.error("Please enter a valid planned daily production value");
      return;
    }

    try {
      const providerMetrics = providersMetrics.find(
        (pm) => pm.provider.id === providerId,
      );
      if (!providerMetrics) {
        toast.error("Provider metrics not found");
        return;
      }

      const recordData = {
        organization_id: organizationId,
        provider_id: providerId,
        user_id: user.id,
        average_daily_production: plannedValue,
        date_range_start: format(profitGoalsDateRange.from, "yyyy-MM-dd"),
        date_range_end: format(profitGoalsDateRange.to, "yyyy-MM-dd"),
        planning_month: format(planningMonth, "yyyy-MM-01"),
        planned_total_production: providerMetrics.plannedTotalProduction,
        planned_associate_net_pay: providerMetrics.plannedAssociateNetPay,
        planned_cost_of_labs: providerMetrics.plannedCostOfLabs,
        planned_materials: providerMetrics.plannedMaterials,
        planned_practice_pl: providerMetrics.plannedPracticePL,
        working_days: providerMetrics.workingDays,
        created_by: user.id,
        created_by_email: user.email,
      };

      const { error } = await supabase
        .from("planned_daily_production")
        .insert(recordData);

      if (error) {
        console.error(
          "[ProvidersManagement] Error saving planned production:",
          error,
        );
        toast.error("Failed to save planned production");
        return;
      }

      toast.success("Planned daily production saved successfully");

      // Refresh all saved records
      const providerIds = providers.map((p) => p.id);
      const { data: updatedRecords, error: fetchError } = await supabase
        .from("planned_daily_production")
        .select(
          `
          id,
          provider_id,
          average_daily_production,
          date_range_start,
          date_range_end,
          planning_month,
          planned_total_production,
          planned_associate_net_pay,
          planned_cost_of_labs,
          planned_materials,
          planned_practice_pl,
          working_days,
          notes,
          created_at,
          created_by,
          created_by_email
        `,
        )
        .eq("organization_id", organizationId)
        .in("provider_id", providerIds)
        .order("created_at", { ascending: false });

      if (!fetchError && updatedRecords) {
        setAllSavedPlannedRecords(updatedRecords);
      }
    } catch (error) {
      console.error(
        "[ProvidersManagement] Error in savePlannedDailyProduction:",
        error,
      );
      toast.error("An unexpected error occurred");
    }
  };

  // ── UDA Targets: load NHS yearly targets for the overview chart ──────────
  useEffect(() => {
    const loadYearlyTargets = async () => {
      if (!organizationId || !financialMonthStart) return;
      const fyStart = new Date(
        udaSelectedFY,
        (financialMonthStart || 4) - 1,
        1,
      );
      const periodStr = format(fyStart, "yyyy-MM-dd");
      const { data } = await (supabase as any)
        .from("uda_targets")
        .select("provider_id, uda_target")
        .eq("organization_id", organizationId)
        .eq("period_type", "yearly")
        .eq("period", periodStr)
        .eq("contract_type", "NHS");
      if (data) {
        const targets: Record<string, string> = {};
        data.forEach((row: any) => {
          targets[row.provider_id] = String(row.uda_target);
        });
        setUdaYearlyTargets(targets);
      }
    };
    loadYearlyTargets();
  }, [organizationId, udaSelectedFY, financialMonthStart]);

  // ── UDA Actuals: load yearly (sum uda_count across selected date range per provider) ─
  useEffect(() => {
    const loadYearlyActuals = async () => {
      if (!organizationId) return;
      const { data } = await (supabase as any)
        .from("appointment_summary")
        .select("provider_id, uda_count")
        .eq("organization_id", organizationId)
        .gte("month", format(udaDateRange.startDate, "yyyy-MM-dd"))
        .lte("month", format(udaDateRange.endDate, "yyyy-MM-dd"))
        .in(
          "provider_id",
          filteredProviders.map((p) => p.id),
        );
      if (data) {
        const actuals: Record<string, number> = {};
        data.forEach((row: any) => {
          actuals[row.provider_id] =
            (actuals[row.provider_id] || 0) + (row.uda_count || 0);
        });
        setUdaYearlyActuals(actuals);
      }
    };
    loadYearlyActuals();
  }, [organizationId, udaDateFilter, udaCustomRange, filteredProviders.length]);

  // ── UDA Chart: combine yearly actuals + targets per provider ─────────────
  const udaChartData = useMemo(() => {
    // Merge providers with the same name (multiple locations) by summing actuals/targets
    const mergedMap = new Map<
      string,
      {
        providerId: string;
        name: string;
        fullName: string;
        actual: number;
        target: number;
      }
    >();
    for (const p of filteredProviders) {
      const key = p.name?.toLowerCase() ?? "";
      const actual = udaYearlyActuals[p.id] ?? 0;
      const target = parseInt(udaYearlyTargets[p.id] || "0") || 0;
      if (!mergedMap.has(key)) {
        const nameParts = p.name?.split(" ") ?? ["?"];
        const shortName =
          nameParts.length >= 2
            ? `${nameParts[0].charAt(0)}. ${nameParts[nameParts.length - 1]}`
            : p.name;
        mergedMap.set(key, {
          providerId: p.id,
          name: shortName,
          fullName: p.name,
          actual,
          target,
        });
      } else {
        const existing = mergedMap.get(key)!;
        existing.actual += actual;
        existing.target += target;
      }
    }
    return Array.from(mergedMap.values()).sort((a, b) => b.actual - a.actual);
  }, [filteredProviders, udaYearlyActuals, udaYearlyTargets]);

  const udaRankings = useMemo(() => {
    return udaChartData.map((row, idx) => ({ ...row, rank: idx + 1 }));
  }, [udaChartData]);

  const udaHasData = useMemo(() => {
    return udaChartData.some((row) => row.actual > 0 || row.target > 0);
  }, [udaChartData]);

  // Calculate aggregate data for overview
  const totalRevenue = filteredProviders.reduce(
    (sum, p) => sum + Number(p.revenue || 0),
    0,
  );

  // Total Patients: distinct patients from completed appointments for active providers of this type
  const [totalPatients, setTotalPatients] = useState(0);
  useEffect(() => {
    const fetchTotalPatients = async () => {
      if (!organizationId) {
        setTotalPatients(0);
        return;
      }
      const { data, error } = await (supabase as any).rpc(
        "get_total_distinct_patients",
        {
          p_organization_id: organizationId,
          p_start_date: format(
            productionDateRange.startDate,
            "yyyy-MM-dd'T'00:00:00",
          ),
          p_end_date: format(
            productionDateRange.endDate,
            "yyyy-MM-dd'T'23:59:59",
          ),
          p_provider_type: providerType,
          p_location_id:
            selectedLocationId && selectedLocationId !== "all"
              ? selectedLocationId
              : null,
        },
      );
      if (!error && data != null) {
        setTotalPatients(data as number);
      }
    };
    fetchTotalPatients();
  }, [
    organizationId,
    providerType,
    productionDateRange.startDate.getTime(),
    productionDateRange.endDate.getTime(),
    selectedLocationId,
  ]);
  // Avg Utilisation: total apmt duration / available chair time × 100
  const [avgUtilisation, setAvgUtilisation] = useState(0);
  // Real inputs behind the % — populated from get_avg_utilisation_breakdown so the
  // formula help dialog shows THIS period's actual numbers, not a static example.
  const [utilisationBreakdown, setUtilisationBreakdown] = useState<{
    totalMinutes: number;
    providerCount: number;
    workingDays: number;
    hoursPerDay: number;
  } | null>(null);

  useEffect(() => {
    const fetchAvgUtilisation = async () => {
      if (!organizationId) {
        setAvgUtilisation(0);
        setUtilisationBreakdown(null);
        return;
      }

      const params = {
        p_organization_id: organizationId,
        p_start_date: format(
          productionDateRange.startDate,
          "yyyy-MM-dd'T'00:00:00",
        ),
        p_end_date: format(
          productionDateRange.endDate,
          "yyyy-MM-dd'T'23:59:59",
        ),
        p_provider_type: providerType,
        p_location_id:
          selectedLocationId && selectedLocationId !== "all"
            ? selectedLocationId
            : null,
      };

      // Prefer the breakdown RPC (returns the % PLUS its formula inputs). Fall back to
      // the number-only get_avg_utilisation if the breakdown fn isn't deployed yet, so
      // the tile keeps working before the migration is applied.
      const { data: bd, error: bdErr } = await (supabase as any).rpc(
        "get_avg_utilisation_breakdown",
        params,
      );
      const row = Array.isArray(bd) ? bd[0] : bd;
      if (!bdErr && row) {
        setAvgUtilisation(Number(row.utilisation) || 0);
        setUtilisationBreakdown({
          totalMinutes: Number(row.total_minutes) || 0,
          providerCount: Number(row.provider_count) || 0,
          workingDays: Number(row.working_days) || 0,
          hoursPerDay: Number(row.hours_per_day) || 0,
        });
        return;
      }

      const { data } = await (supabase as any).rpc(
        "get_avg_utilisation",
        params,
      );
      setAvgUtilisation(typeof data === "number" ? data : 0);
      setUtilisationBreakdown(null);
    };
    fetchAvgUtilisation();
  }, [
    organizationId,
    providerType,
    productionDateRange.startDate.getTime(),
    productionDateRange.endDate.getTime(),
    selectedLocationId,
  ]);

  // Align the utilisation to the SAME provider set as the "Total Dentists" tile
  // (rankingRows = producers, production > 0). The RPC counts everyone with a booked
  // appointment, so a practitioner with appointments but £0 production (e.g. an
  // exam-only locum) inflated the tooltip's count above the tile — 8 vs 7 at
  // Woodbridge. Recompute the % over the producer count so the card, its number and
  // the formula tooltip all agree. Falls back to the RPC count when there are no
  // ranked producers yet (e.g. loading) so utilisation never divides by zero.
  const alignedUtil = useMemo(() => {
    const b = utilisationBreakdown;
    if (!b || b.workingDays <= 0 || b.hoursPerDay <= 0) {
      return {
        providerCount: b?.providerCount ?? 0,
        totalMinutes: b?.totalMinutes ?? 0,
        workingDays: b?.workingDays ?? 0,
        hoursPerDay: b?.hoursPerDay ?? 0,
        pct: avgUtilisation,
      };
    }
    const producers =
      rankingRows.length > 0 ? rankingRows.length : b.providerCount;
    const denom = producers * b.workingDays * b.hoursPerDay * 60;
    const pct =
      denom > 0
        ? Math.min(100, Math.round((b.totalMinutes / denom) * 1000) / 10)
        : 0;
    return {
      providerCount: producers,
      totalMinutes: b.totalMinutes,
      workingDays: b.workingDays,
      hoursPerDay: b.hoursPerDay,
      pct,
    };
  }, [utilisationBreakdown, rankingRows.length, avgUtilisation]);

  // Helper function to get color for provider type
  const getTypeColor = (type: string) => {
    const typeIndex = activeProviderTypes.findIndex((pt) => pt.code === type);
    if (typeIndex >= 0) {
      const colors = [
        "from-blue-500 to-indigo-600",
        "from-purple-500 to-pink-600",
        "from-teal-500 to-cyan-600",
        "from-orange-500 to-red-600",
        "from-green-500 to-emerald-600",
        "from-pink-500 to-rose-600",
      ];
      return colors[typeIndex % colors.length];
    }
    return "from-gray-500 to-gray-600";
  };

  const formatRank = (rank: number) => {
    const suffix = ["th", "st", "nd", "rd"];
    const v = rank % 100;
    return {
      number: rank,
      suffix: suffix[(v - 20) % 10] || suffix[v] || suffix[0],
    };
  };

  const handleProviderClick = (providerId: string, providerType?: string) => {
    const type = providerType ? providerType.toLowerCase() : "other";
    navigate(`/providers/${type}/${providerId}`);
  };

  // Associates filtered by role for Working Hours dialog
  const whDialogAssociates = useMemo(() => {
    const roleMap: Record<string, string[]> = {
      Dentist: ["dentist", "dental surgeon", "principal dentist"],
      Hygienist: ["hygienist", "dental hygienist", "hygiene"],
      Therapist: ["therapist", "dental therapist", "therapy"],
    };
    const allowed = roleMap[providerType];
    return providers.filter((p: any) => {
      if (!allowed) return true;
      if (!p.provider_role) return false;
      return allowed.includes(p.provider_role.toLowerCase());
    });
  }, [providers, providerType]);

  // NHS / MOS count dialogs only show providers who opted into that treatment type.
  const nhsCountDialogAssociates = useMemo(
    () =>
      whDialogAssociates.filter((p: any) =>
        providerPerformsNhs(p.additional_options),
      ),
    [whDialogAssociates],
  );
  const mosCountDialogAssociates = useMemo(
    () =>
      whDialogAssociates.filter((p: any) =>
        providerPerformsMos(p.additional_options),
      ),
    [whDialogAssociates],
  );

  const countDialogAssociatesFor = (field: "uda_count" | "mos_count") =>
    field === "uda_count" ? nhsCountDialogAssociates : mosCountDialogAssociates;

  const openWHEditDialog = async (monthLabel: string) => {
    const monthValue = dayjs(monthLabel, "MMM-YY").format("YYYY-MM");
    const monthDate = monthValue + "-01";
    setIsLoadingWHDialog(true);
    setShowWorkingHoursDialog(true);
    try {
      const providerIds = whDialogAssociates
        .map((p: any) => p.id)
        .filter(Boolean);
      const { data: summaryRows } = await (supabase as any)
        .from("appointment_summary")
        .select(
          "provider_id, working_duration_hours, working_hours_per_day, uda_count",
        )
        .eq("organization_id", organizationId)
        .eq("month", monthDate)
        .in("provider_id", providerIds);

      const rowData: Record<
        string,
        {
          workingDuration: string;
          workingHoursPerDay: string;
          udaCount: string;
        }
      > = {};
      for (const row of summaryRows ?? []) {
        const dur =
          row.working_duration_hours > 0
            ? String(row.working_duration_hours)
            : "";
        rowData[row.provider_id] = {
          workingDuration: dur,
          workingHoursPerDay:
            row.working_hours_per_day != null
              ? String(row.working_hours_per_day)
              : dur
                ? "8"
                : "",
          udaCount: row.uda_count != null ? String(row.uda_count) : "",
        };
      }

      // Override workingDuration with live hook data (correctly summed across all locations)
      // Match each associate by externalIds[] so multi-location providers show the combined total
      if (allProvidersHours) {
        for (const associate of whDialogAssociates) {
          const pid = (associate as any).id;
          const extId = (associate as any).external_id
            ? Number((associate as any).external_id)
            : null;
          if (!extId) continue;
          const hookProvider = allProvidersHours.providers.find((p) =>
            p.externalIds.includes(extId),
          );
          if (hookProvider) {
            const liveHours = hookProvider.monthlyData[monthLabel];
            if (liveHours != null && liveHours > 0) {
              const existing = rowData[pid] ?? {
                workingDuration: "",
                workingHoursPerDay: "",
                udaCount: "",
              };
              rowData[pid] = {
                ...existing,
                workingDuration: String(liveHours),
              };
            }
          }
        }
      }

      setWorkingHoursRows([{ month: monthValue, data: rowData }]);
    } finally {
      setIsLoadingWHDialog(false);
    }
  };

  const saveWHWorkingHours = async () => {
    if (!organizationId) return;
    const upsertRows: any[] = [];
    for (const row of workingHoursRows) {
      if (!row.month) continue;
      const monthDate = row.month + "-01";
      for (const associate of whDialogAssociates) {
        const pid = (associate as any).id;
        const extId = (associate as any).external_id
          ? Number((associate as any).external_id)
          : null;
        if (!extId) continue;
        const cell = row.data[pid] ?? {
          workingDuration: "",
          workingHoursPerDay: "",
          udaCount: "",
        };
        upsertRows.push({
          organization_id: organizationId,
          practitioner_id: extId,
          provider_id: pid,
          month: monthDate,
          working_duration_hours: cell.workingDuration
            ? Number(cell.workingDuration)
            : 0,
          working_hours_per_day: cell.workingHoursPerDay
            ? Number(cell.workingHoursPerDay)
            : null,
          uda_count: cell.udaCount ? Number(cell.udaCount) : null,
        });
      }
    }
    if (upsertRows.length === 0) {
      setShowWorkingHoursDialog(false);
      return;
    }
    const { error } = await (supabase as any)
      .from("appointment_summary")
      .upsert(upsertRows, {
        onConflict: "organization_id,practitioner_id,month",
      });
    if (error) {
      console.error("[WorkingHours] Save error:", error.message);
      toast.error("Failed to save working hours.");
      return;
    }
    toast.success("Working hours saved successfully.");
    queryClient.invalidateQueries({
      queryKey: ["all-providers-working-hours"],
    });
    // This dialog also writes uda_count — keep Production Data + UDA Goals in sync.
    queryClient.invalidateQueries({
      queryKey: ["all-providers-counts-v2", "uda_count"],
    });
    queryClient.invalidateQueries({ queryKey: ["uda-actuals"] });
    setShowWorkingHoursDialog(false);
    setWorkingHoursRows([{ month: "", data: {} }]);
  };

  // NHS Count (uda_count) and MOS Count (mos_count) dialogs — same "add a
  // month row" pattern as Working Hours, but each writes only its own single
  // column so neither clobbers Working Hours' own uda_count field or the
  // other count's column on save.
  const openCountEditDialog = async (
    monthLabel: string,
    field: "uda_count" | "mos_count",
    setRows: typeof setNhsCountRows,
    setLoading: typeof setIsLoadingNhsCountDialog,
    setOpen: typeof setShowNhsCountDialog,
  ) => {
    const monthValue = dayjs(monthLabel, "MMM-YY").format("YYYY-MM");
    const monthDate = monthValue + "-01";
    setLoading(true);
    setOpen(true);
    try {
      const associates = countDialogAssociatesFor(field);
      const providerIds = associates.map((p: any) => p.id).filter(Boolean);
      if (providerIds.length === 0) {
        setRows([{ month: monthValue, data: {} }]);
        return;
      }
      const { data: summaryRows } = await (supabase as any)
        .from("appointment_summary")
        .select(`provider_id, ${field}`)
        .eq("organization_id", organizationId)
        .eq("month", monthDate)
        .in("provider_id", providerIds);

      const rowData: Record<string, { count: string }> = {};
      for (const row of summaryRows ?? []) {
        rowData[row.provider_id] = {
          count: row[field] != null ? String(row[field]) : "",
        };
      }
      setRows([{ month: monthValue, data: rowData }]);
    } finally {
      setLoading(false);
    }
  };

  const saveCountRows = async (
    rows: typeof nhsCountRows,
    field: "uda_count" | "mos_count",
    setOpen: typeof setShowNhsCountDialog,
    setRows: typeof setNhsCountRows,
    successMessage: string,
  ) => {
    if (!organizationId) return;
    const associates = countDialogAssociatesFor(field);
    const upsertRows: any[] = [];
    for (const row of rows) {
      if (!row.month) continue;
      const monthDate = row.month + "-01";
      for (const associate of whDialogAssociates) {
        const pid = (associate as any).id;
        const extId = (associate as any).external_id
          ? Number((associate as any).external_id)
          : null;
        if (!extId) continue;
        // Skip associates never touched in this dialog session — writing a row
        // for them here would upsert-null their existing count for this month.
        if (!(pid in row.data)) continue;
        const cell = row.data[pid];
        upsertRows.push({
          organization_id: organizationId,
          practitioner_id: extId,
          provider_id: pid,
          month: monthDate,
          [field]: cell.count ? Number(cell.count) : null,
        });
      }
    }
    if (upsertRows.length === 0) {
      setOpen(false);
      return;
    }
    const { error } = await (supabase as any)
      .from("appointment_summary")
      .upsert(upsertRows, {
        onConflict: "organization_id,practitioner_id,month",
      });
    if (error) {
      console.error(`[${field}] Save error:`, error.message);
      toast.error("Failed to save.");
      return;
    }
    toast.success(successMessage);
    queryClient.invalidateQueries({
      queryKey: ["all-providers-counts-v2", field],
    });
    // Also refresh any remaining uda-actuals consumers.
    queryClient.invalidateQueries({ queryKey: ["uda-actuals"] });
    setOpen(false);
    setRows([{ month: "", data: {} }]);
  };

  const showEmailColumn = Boolean(tableFilters.showEmailColumn);
  const showPhoneColumn = Boolean(tableFilters.showPhoneColumn);
  const showJoiningDateColumn = Boolean(tableFilters.showJoiningDateColumn);
  const showLeavingDateColumn = Boolean(tableFilters.showLeavingDateColumn);

  // Sort header component
  const SortHeader = ({
    label,
    sortKeyValue,
  }: {
    label: string;
    sortKeyValue: SortKey;
  }) => (
    <th
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => handleSort(sortKeyValue)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sortKeyValue ? (
          sortOrder === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </div>
    </th>
  );

  return (
    <MainLayout
      userRole="admin"
      aiContext={{
        page: `providers-${providerType?.toLowerCase()}`,
        providerType,
      }}
    >
      <div className="space-y-6 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {displayProviderType} Management
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage {displayProviderType.toLowerCase()} data and settings
              </p>
            </div>
          </div>
          <EntitySyncButton
            entityAlias="practitioners"
            entityLabel="Providers"
            additionalEntities={[
              { alias: "appointments", label: "Appointments" },
              { alias: "treatment_plan_items", label: "Treatment Plan Items" },
              // DISABLED: Invoice sync causes rate limit issues - sync invoices separately
              // { alias: 'invoices', label: 'Invoices' }
            ]}
          />
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList>
            {steps.map((step) => {
              const StepIcon = step.icon;
              return (
                <TabsTrigger
                  key={step.value}
                  value={step.value}
                  className="gap-2"
                >
                  <StepIcon className="w-4 h-4" />
                  {step.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Global Filter */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Overview</h2>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 px-3 py-1.5 rounded-full shadow-sm">
                  <CalendarIcon className="w-3.5 h-3.5 text-violet-500" />
                  {(() => {
                    const now = new Date();
                    switch (globalDateFilter) {
                      case "this-month":
                        return format(now, "MMMM yyyy");
                      case "last-month":
                        return format(subMonths(now, 1), "MMMM yyyy");
                      case "this-quarter":
                        return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
                      case "last-quarter": {
                        const d = subQuarters(now, 1);
                        return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
                      }
                      case "this-year":
                        return `${now.getFullYear()}`;
                      case "last-year":
                        return `${now.getFullYear() - 1}`;
                      case "custom": {
                        const { startDate, endDate } = getDateRange(
                          globalDateFilter,
                          customDateRange,
                        );
                        return `${format(startDate, "d MMM")} – ${format(endDate, "d MMM yyyy")}`;
                      }
                      default:
                        return format(now, "MMMM yyyy");
                    }
                  })()}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <SlidersHorizontal className="w-4 h-4" />
                      Filter
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[220px]">
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("this-month")}
                    >
                      This Month
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("this-quarter")}
                    >
                      This Quarter
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("this-year")}
                    >
                      This Year
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("last-month")}
                    >
                      Last Month
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("last-quarter")}
                    >
                      Last Quarter
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setGlobalDateFilter("last-year")}
                    >
                      Last Year
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <span className="flex-1">Custom Date Range</span>
                        <CalendarIcon className="w-4 h-4" />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="p-3 min-w-[320px]">
                        <div className="flex flex-col gap-2">
                          <Label className="text-sm text-muted-foreground">
                            Select Date Range
                          </Label>
                          <ConfigProvider
                            theme={{
                              token: {
                                colorPrimary: "hsl(244, 48%, 25%)",
                                colorPrimaryBg: "#e6f4ff",
                                colorPrimaryBgHover: "#bae0ff",
                              },
                            }}
                          >
                            <DatePicker.RangePicker
                              value={[
                                customDateRange.from
                                  ? dayjs(customDateRange.from)
                                  : null,
                                customDateRange.to
                                  ? dayjs(customDateRange.to)
                                  : null,
                              ]}
                              onChange={(dates) => {
                                if (dates && dates[0] && dates[1]) {
                                  setCustomDateRange({
                                    from: dates[0].toDate(),
                                    to: dates[1].toDate(),
                                  });
                                  setGlobalDateFilter("custom");
                                } else {
                                  setCustomDateRange({ from: null, to: null });
                                }
                              }}
                              format="DD-MM-YYYY"
                              placeholder={["Start date", "End date"]}
                              style={{ width: "100%" }}
                            />
                          </ConfigProvider>
                        </div>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Total Dentists */}
              <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-400 to-purple-600 rounded-t-xl" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                        Total {displayProviderType}s
                      </p>
                      {/* Count the providers who actually PRODUCED at the selected
                          location (same set as the Ranking below), not those merely
                          based here — so the tile always agrees with the list. A
                          Woodbridge-based dentist who treated at Leiston counts here. */}
                      <p className="text-4xl font-extrabold text-gray-900">
                        {rankingRows.length}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Produced in this period
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500 shadow-md shadow-violet-200 group-hover:scale-110 transition-transform duration-300">
                      <Users className="h-6 w-6 text-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Total Revenue */}
              <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-t-xl" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                        Total Revenue
                      </p>
                      <p className="text-3xl font-extrabold text-gray-900 truncate">
                        {formatCurrencyRound(totalNetProduction || totalProduction)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {format(productionDateRange.startDate, "d MMM yyyy")} –{" "}
                        {format(productionDateRange.endDate, "d MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-500 shadow-md shadow-emerald-200 group-hover:scale-110 transition-transform duration-300">
                      <PoundSterling className="h-6 w-6 text-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Total Patients */}
              <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-400 to-pink-600 rounded-t-xl" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                        Total Patients
                      </p>
                      <p className="text-4xl font-extrabold text-gray-900">
                        {totalPatients}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {format(productionDateRange.startDate, "d MMM yyyy")} –{" "}
                        {format(productionDateRange.endDate, "d MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 shadow-md shadow-rose-200 group-hover:scale-110 transition-transform duration-300">
                      <Heart className="h-6 w-6 text-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Avg Utilisation */}
              <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 to-orange-500 rounded-t-xl" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1 mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                          Avg Utilisation
                        </p>
                        <button
                          onClick={() => setShowUtilisationFormula(true)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="View formula"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-4xl font-extrabold text-gray-900">
                        {Math.round(alignedUtil.pct)}%
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {format(productionDateRange.startDate, "d MMM yyyy")} –{" "}
                        {format(productionDateRange.endDate, "d MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 shadow-md shadow-amber-200 group-hover:scale-110 transition-transform duration-300">
                      <TrendingUp className="h-6 w-6 text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts with Rankings Grid */}
            <div className="grid grid-cols-1 gap-6">
              {/* Production Chart with Ranking */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-lg">Production</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarIcon className="w-3.5 h-3.5" />
                        {format(
                          productionDateRange.startDate,
                          "dd-MM-yyyy",
                        )} – {format(productionDateRange.endDate, "dd-MM-yyyy")}
                      </span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("this-month")}
                      >
                        This Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("this-quarter")}
                      >
                        This Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("this-year")}
                      >
                        This Year
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("last-month")}
                      >
                        Last Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("last-quarter")}
                      >
                        Last Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProductionDateFilter("last-year")}
                      >
                        Last Year
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <span className="flex-1">Custom Date Range</span>
                          <CalendarIcon className="w-4 h-4" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="p-3 min-w-[320px]">
                          <div className="flex flex-col gap-2">
                            <Label className="text-sm text-muted-foreground">
                              Select Date Range
                            </Label>
                            <ConfigProvider
                              theme={{
                                token: {
                                  colorPrimary: "hsl(244, 48%, 25%)",
                                  colorPrimaryBg: "#e6f4ff",
                                  colorPrimaryBgHover: "#bae0ff",
                                },
                              }}
                            >
                              <DatePicker.RangePicker
                                value={[
                                  productionCustomRange.from
                                    ? dayjs(productionCustomRange.from)
                                    : null,
                                  productionCustomRange.to
                                    ? dayjs(productionCustomRange.to)
                                    : null,
                                ]}
                                onChange={(dates) => {
                                  if (dates && dates[0] && dates[1]) {
                                    setProductionCustomRange({
                                      from: dates[0].toDate(),
                                      to: dates[1].toDate(),
                                    });
                                    setProductionDateFilter("custom");
                                  } else {
                                    setProductionCustomRange({
                                      from: null,
                                      to: null,
                                    });
                                  }
                                }}
                                format="DD-MM-YYYY"
                                placeholder={["Start date", "End date"]}
                                style={{ width: "100%" }}
                              />
                            </ConfigProvider>
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  {isLoadingProduction ? (
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Chart */}
                      <div className="h-[400px]">
                        {productionChartData.length === 0 ? (
                          <div className="flex items-center justify-center h-full">
                            <p className="text-sm text-muted-foreground">
                              No data available
                            </p>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={productionChartData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--border))"
                                opacity={0.3}
                              />
                              <XAxis
                                dataKey="name"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={11}
                                angle={-35}
                                textAnchor="end"
                                height={80}
                              />
                              <YAxis
                                yAxisId="left"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickFormatter={(v) =>
                                  `£${(v / 1000).toFixed(0)}k`
                                }
                                label={{
                                  value: "Production Amount",
                                  angle: -90,
                                  position: "insideLeft",
                                  style: {
                                    textAnchor: "middle",
                                    fill: "hsl(var(--muted-foreground))",
                                    fontSize: 14,
                                  },
                                }}
                              />
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                label={{
                                  value: "Days Worked",
                                  angle: 90,
                                  position: "insideRight",
                                  style: {
                                    textAnchor: "middle",
                                    fill: "hsl(var(--muted-foreground))",
                                    fontSize: 14,
                                  },
                                }}
                              />
                              <Tooltip
                                formatter={(value: number, name: string) => {
                                  if (name === "Production Amount")
                                    return formatCurrency(value);
                                  return `${Number(value).toFixed(2)} days`;
                                }}
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                }}
                              />
                              <Legend
                                wrapperStyle={{ paddingTop: "20px" }}
                                iconType="circle"
                              />
                              <Bar
                                yAxisId="left"
                                dataKey="production"
                                name="Production Amount"
                                fill="#10b981"
                                radius={[6, 6, 0, 0]}
                              />
                              <Bar
                                yAxisId="right"
                                dataKey="daysWorked"
                                name="Days Worked"
                                fill="#8b5cf6"
                                radius={[6, 6, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      {/* Ranking Table */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <h3 className="font-semibold">Ranking</h3>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowProductionFormula(true)}
                            title="View formula breakdown"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div
                          className={`overflow-x-auto${(productionMetrics || []).length > 10 ? " overflow-y-auto max-h-[420px]" : ""}`}
                        >
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background z-10">
                              <tr className="border-b">
                                <th className="text-left py-2 px-2 font-medium">
                                  {displayProviderType}
                                </th>
                                <th className="text-right py-2 px-2 font-medium">
                                  Production
                                </th>
                                <th className="text-right py-2 px-2 font-medium">
                                  Avg Daily Production
                                </th>
                                <th className="text-center py-2 px-2 font-medium">
                                  Rank
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rankingRows.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={4}
                                    className="py-8 text-center text-sm text-muted-foreground"
                                  >
                                    No data available
                                  </td>
                                </tr>
                              )}
                              {rankingRows.map((row) => {
                                const { number, suffix } = formatRank(row.rank);
                                return (
                                  <tr
                                    key={row.providerId}
                                    className="border-b hover:bg-muted/50"
                                  >
                                    <td className="py-3 px-2">
                                      {row.providerName}
                                    </td>
                                    <td className="py-3 px-2 text-right font-semibold text-primary">
                                      {formatCurrency(row.production)}
                                    </td>
                                    <td className="py-3 px-2 text-right font-semibold text-success">
                                      {formatCurrency(row.avgDailyProduction)}
                                    </td>
                                    <td className="py-3 px-2 text-center">
                                      <span className="font-semibold">
                                        {number}
                                      </span>
                                      <sup className="text-xs">{suffix}</sup>
                                    </td>
                                  </tr>
                                );
                              })}
                              {rankingRows.length > 0 && (
                                <tr className="border-t-2 font-semibold">
                                  <td className="py-3 px-2">Total</td>
                                  <td className="py-3 px-2 text-right text-primary">
                                    {formatCurrency(
                                      totalNetProduction || totalProduction,
                                    )}
                                  </td>
                                  <td className="py-3 px-2 text-right text-success">
                                    {formatCurrency(totalAvgDailyProduction)}
                                  </td>
                                  <td className="py-3 px-2"></td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Profit Chart with Ranking */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-lg">Profit</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarIcon className="w-3.5 h-3.5" />
                        {format(profitDateRange.startDate, "dd-MM-yyyy")} –{" "}
                        {format(profitDateRange.endDate, "dd-MM-yyyy")}
                      </span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("this-month")}
                      >
                        This Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("this-quarter")}
                      >
                        This Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("this-year")}
                      >
                        This Year
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("last-month")}
                      >
                        Last Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("last-quarter")}
                      >
                        Last Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProfitDateFilter("last-year")}
                      >
                        Last Year
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <span className="flex-1">Custom Date Range</span>
                          <CalendarIcon className="w-4 h-4" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="p-3 min-w-[320px]">
                          <div className="flex flex-col gap-2">
                            <Label className="text-sm text-muted-foreground">
                              Select Date Range
                            </Label>
                            <ConfigProvider
                              theme={{
                                token: {
                                  colorPrimary: "hsl(244, 48%, 25%)",
                                  colorPrimaryBg: "#e6f4ff",
                                  colorPrimaryBgHover: "#bae0ff",
                                },
                              }}
                            >
                              <DatePicker.RangePicker
                                value={[
                                  profitCustomRange.from
                                    ? dayjs(profitCustomRange.from)
                                    : null,
                                  profitCustomRange.to
                                    ? dayjs(profitCustomRange.to)
                                    : null,
                                ]}
                                onChange={(dates) => {
                                  if (dates && dates[0] && dates[1]) {
                                    setProfitCustomRange({
                                      from: dates[0].toDate(),
                                      to: dates[1].toDate(),
                                    });
                                    setProfitDateFilter("custom");
                                  } else {
                                    setProfitCustomRange({
                                      from: null,
                                      to: null,
                                    });
                                  }
                                }}
                                format="DD-MM-YYYY"
                                placeholder={["Start date", "End date"]}
                                style={{ width: "100%" }}
                              />
                            </ConfigProvider>
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  {isLoadingProfit ? (
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Chart */}
                      <div className="h-[400px]">
                        {(profitMetrics || []).length === 0 ? (
                          <div className="flex items-center justify-center h-full">
                            <p className="text-sm text-muted-foreground">
                              No data available
                            </p>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={(profitMetrics || [])
                                .slice(0, 10)
                                .map((metric) => ({
                                  name: metric.provider_name
                                    .split(" ")
                                    .map((n, i) => (i === 0 ? n : n[0]))
                                    .join(" "),
                                  periodicProfit: metric.periodic_profit,
                                  plPerDay: metric.pl_per_day,
                                }))}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--border))"
                                opacity={0.3}
                              />
                              <XAxis
                                dataKey="name"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={11}
                                angle={-35}
                                textAnchor="end"
                                height={80}
                              />
                              <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickFormatter={(v) =>
                                  `£${(v / 1000).toFixed(0)}k`
                                }
                                label={{
                                  value: "Profit",
                                  angle: -90,
                                  position: "insideLeft",
                                  style: {
                                    textAnchor: "middle",
                                    fill: "hsl(var(--muted-foreground))",
                                    fontSize: 14,
                                  },
                                }}
                              />
                              <Tooltip
                                formatter={(value: number) =>
                                  formatCurrency(value)
                                }
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                }}
                              />
                              <Legend
                                wrapperStyle={{ paddingTop: "20px" }}
                                iconType="circle"
                              />
                              <Bar
                                dataKey="periodicProfit"
                                name="Periodic Profit"
                                fill="#3b82f6"
                                radius={[6, 6, 0, 0]}
                              />
                              <Bar
                                dataKey="plPerDay"
                                name="P/L Per Day"
                                fill="#f97316"
                                radius={[6, 6, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      {/* Ranking Table */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <h3 className="font-semibold">Ranking</h3>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowProfitFormula(true)}
                            title="View formula breakdown"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div
                          className={`overflow-x-auto${(profitMetrics || []).length > 10 ? " overflow-y-auto max-h-[420px]" : ""}`}
                        >
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background z-10">
                              <tr className="border-b">
                                <th className="text-left py-2 px-2 font-medium">
                                  {displayProviderType}
                                </th>
                                <th className="text-right py-2 px-2 font-medium">
                                  Periodic Profit
                                </th>
                                <th className="text-right py-2 px-2 font-medium">
                                  P/L Per Day
                                </th>
                                <th className="text-right py-2 px-2 font-medium">
                                  Profit %
                                </th>
                                <th className="text-center py-2 px-2 font-medium">
                                  Rank
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {(profitMetrics || []).length === 0 && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="py-8 text-center text-sm text-muted-foreground"
                                  >
                                    No data available
                                  </td>
                                </tr>
                              )}
                              {(profitMetrics || []).map((row) => {
                                const { number, suffix } = formatRank(row.rank);
                                return (
                                  <tr
                                    key={row.provider_id}
                                    className="border-b hover:bg-muted/50"
                                  >
                                    <td className="py-3 px-2">
                                      {row.provider_name}
                                    </td>
                                    <td
                                      className={cn(
                                        "py-3 px-2 text-right font-semibold",
                                        row.periodic_profit < 0
                                          ? "text-destructive"
                                          : "text-success",
                                      )}
                                    >
                                      {formatCurrency(row.periodic_profit)}
                                    </td>
                                    <td
                                      className={cn(
                                        "py-3 px-2 text-right font-semibold",
                                        row.pl_per_day < 0
                                          ? "text-destructive"
                                          : "text-success",
                                      )}
                                    >
                                      {formatCurrency(row.pl_per_day)}
                                    </td>
                                    <td className="py-3 px-2 text-right font-semibold text-foreground">
                                      {row.profit_percent.toFixed(2)}%
                                    </td>
                                    <td className="py-3 px-2 text-center">
                                      <span className="font-semibold">
                                        {number}
                                      </span>
                                      <sup className="text-xs">{suffix}</sup>
                                    </td>
                                  </tr>
                                );
                              })}
                              {(profitMetrics || []).length > 0 && (
                                <tr className="border-t-2 font-semibold">
                                  <td className="py-3 px-2">Total</td>
                                  <td
                                    className={cn(
                                      "py-3 px-2 text-right",
                                      totalPeriodicProfit < 0
                                        ? "text-destructive"
                                        : "text-success",
                                    )}
                                  >
                                    {formatCurrency(totalPeriodicProfit)}
                                  </td>
                                  <td
                                    className={cn(
                                      "py-3 px-2 text-right",
                                      totalPlPerDay < 0
                                        ? "text-destructive"
                                        : "text-success",
                                    )}
                                  >
                                    {formatCurrency(totalPlPerDay)}
                                  </td>
                                  <td className="py-3 px-2"></td>
                                  <td className="py-3 px-2"></td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Associate Profit Performance */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-lg">
                      Associate Profit Performance (Actual vs Target)
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarIcon className="w-3.5 h-3.5" />
                        {format(
                          associateDateRange.startDate,
                          "dd-MM-yyyy",
                        )} – {format(associateDateRange.endDate, "dd-MM-yyyy")}
                      </span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("this-month")}
                      >
                        This Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("this-quarter")}
                      >
                        This Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("this-year")}
                      >
                        This Year
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("last-month")}
                      >
                        Last Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("last-quarter")}
                      >
                        Last Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAssociateDateFilter("last-year")}
                      >
                        Last Year
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <span className="flex-1">Custom Date Range</span>
                          <CalendarIcon className="w-4 h-4" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="p-3 min-w-[320px]">
                          <div className="flex flex-col gap-2">
                            <Label className="text-sm text-muted-foreground">
                              Select Date Range
                            </Label>
                            <ConfigProvider
                              theme={{
                                token: {
                                  colorPrimary: "hsl(244, 48%, 25%)",
                                  colorPrimaryBg: "#e6f4ff",
                                  colorPrimaryBgHover: "#bae0ff",
                                },
                              }}
                            >
                              <DatePicker.RangePicker
                                value={[
                                  associateCustomRange.from
                                    ? dayjs(associateCustomRange.from)
                                    : null,
                                  associateCustomRange.to
                                    ? dayjs(associateCustomRange.to)
                                    : null,
                                ]}
                                onChange={(dates) => {
                                  if (dates && dates[0] && dates[1]) {
                                    setAssociateCustomRange({
                                      from: dates[0].toDate(),
                                      to: dates[1].toDate(),
                                    });
                                    setAssociateDateFilter("custom");
                                  } else {
                                    setAssociateCustomRange({
                                      from: null,
                                      to: null,
                                    });
                                  }
                                }}
                                format="DD-MM-YYYY"
                                placeholder={["Start date", "End date"]}
                                style={{ width: "100%" }}
                              />
                            </ConfigProvider>
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart */}
                    <div className="h-[400px]">
                      {isLoadingAssociate ? (
                        <div className="flex items-center justify-center h-full">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : (associateChartData || []).length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-muted-foreground">
                            No data available
                          </p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={associateChartData}>
                            <defs>
                              <linearGradient
                                id="actualGradient"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="5%"
                                  stopColor="#7c3aed"
                                  stopOpacity={0.8}
                                />
                                <stop
                                  offset="95%"
                                  stopColor="#7c3aed"
                                  stopOpacity={0.2}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="hsl(var(--border))"
                              opacity={0.3}
                            />
                            <XAxis
                              dataKey="name"
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              angle={-35}
                              textAnchor="end"
                              height={80}
                            />
                            <YAxis
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={12}
                              tickFormatter={(v) =>
                                `£${(v / 1000).toFixed(0)}k`
                              }
                              label={{
                                value: "Daily Production",
                                angle: -90,
                                position: "insideLeft",
                                style: {
                                  textAnchor: "middle",
                                  fill: "hsl(var(--muted-foreground))",
                                  fontSize: 14,
                                },
                              }}
                            />
                            <Tooltip
                              formatter={(value: number, name: string) =>
                                name === "Performance (%)"
                                  ? `${value}%`
                                  : formatCurrency(value)
                              }
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                              }}
                            />
                            <Legend
                              wrapperStyle={{ paddingTop: "20px" }}
                              iconType="circle"
                            />
                            <Area
                              type="monotone"
                              dataKey="actual"
                              name="Daily Production"
                              fill="url(#actualGradient)"
                              stroke="#7c3aed"
                              strokeWidth={3}
                            />
                            <Bar
                              dataKey="target"
                              name="Planning Average Daily Production"
                              fill="#06b6d4"
                              radius={[6, 6, 0, 0]}
                            />
                            <Line
                              type="monotone"
                              dataKey="performance"
                              name="Performance (%)"
                              stroke="#f97316"
                              strokeWidth={3}
                              dot={{ fill: "#f97316", r: 5 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    {/* Ranking Table */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <h3 className="font-semibold">Ranking</h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowAssociateFormula(true)}
                          title="View formula breakdown"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div
                        className={`overflow-x-auto${associateRankingRows.length > 10 ? " overflow-y-auto max-h-[420px]" : ""}`}
                      >
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium">
                                {displayProviderType}
                              </th>
                              <th className="text-right py-2 px-2 font-medium">
                                Target Gap
                              </th>
                              <th className="text-right py-2 px-2 font-medium">
                                Performance %
                              </th>
                              <th className="text-center py-2 px-2 font-medium">
                                Rank
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {isLoadingAssociate ? (
                              <tr>
                                <td colSpan={4} className="py-8 text-center">
                                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                                </td>
                              </tr>
                            ) : associateRankingRows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="py-8 text-center text-muted-foreground"
                                >
                                  No data available
                                </td>
                              </tr>
                            ) : (
                              <>
                                {associateRankingRows.map((row) => {
                                  const { number, suffix } = formatRank(
                                    row.rank,
                                  );
                                  return (
                                    <tr
                                      key={row.provider_id}
                                      className="border-b hover:bg-muted/50"
                                    >
                                      <td className="py-3 px-2">
                                        {row.provider_name}
                                      </td>
                                      <td
                                        className={cn(
                                          "py-3 px-2 text-right font-semibold",
                                          row.target_gap >= 0
                                            ? "text-success"
                                            : "text-destructive",
                                        )}
                                      >
                                        {formatCurrencyRound(row.target_gap)}
                                      </td>
                                      <td className="py-3 px-2 text-right">
                                        {row.performance_percent !== null &&
                                        row.performance_percent > 0
                                          ? `${row.performance_percent}%`
                                          : "-"}
                                      </td>
                                      <td className="py-3 px-2 text-center">
                                        <span className="font-semibold">
                                          {number}
                                        </span>
                                        <sup className="text-xs">{suffix}</sup>
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="border-t-2 font-semibold">
                                  <td className="py-3 px-2">Total</td>
                                  <td
                                    className={cn(
                                      "py-3 px-2 text-right",
                                      totalTargetGap >= 0
                                        ? "text-success"
                                        : "text-destructive",
                                    )}
                                  >
                                    {formatCurrencyRound(totalTargetGap)}
                                  </td>
                                  <td className="py-3 px-2"></td>
                                  <td className="py-3 px-2"></td>
                                </tr>
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* UDA Profit Performance */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-lg">
                      UDA Profit Performance (Actual vs Target)
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarIcon className="w-3.5 h-3.5" />
                        {format(udaDateRange.startDate, "dd-MM-yyyy")} –{" "}
                        {format(udaDateRange.endDate, "dd-MM-yyyy")}
                      </span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("this-month")}
                      >
                        This Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("this-quarter")}
                      >
                        This Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("this-year")}
                      >
                        This Year
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("last-month")}
                      >
                        Last Month
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("last-quarter")}
                      >
                        Last Quarter
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setUdaDateFilter("last-year")}
                      >
                        Last Year
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <span className="flex-1">Custom Date Range</span>
                          <CalendarIcon className="w-4 h-4" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="p-3 min-w-[320px]">
                          <div className="flex flex-col gap-2">
                            <Label className="text-sm text-muted-foreground">
                              Select Date Range
                            </Label>
                            <ConfigProvider
                              theme={{
                                token: {
                                  colorPrimary: "hsl(244, 48%, 25%)",
                                  colorPrimaryBg: "#e6f4ff",
                                  colorPrimaryBgHover: "#bae0ff",
                                },
                              }}
                            >
                              <DatePicker.RangePicker
                                value={[
                                  udaCustomRange.from
                                    ? dayjs(udaCustomRange.from)
                                    : null,
                                  udaCustomRange.to
                                    ? dayjs(udaCustomRange.to)
                                    : null,
                                ]}
                                onChange={(dates) => {
                                  if (dates && dates[0] && dates[1]) {
                                    setUdaCustomRange({
                                      from: dates[0].toDate(),
                                      to: dates[1].toDate(),
                                    });
                                    setUdaDateFilter("custom");
                                  } else {
                                    setUdaCustomRange({ from: null, to: null });
                                  }
                                }}
                                format="DD-MM-YYYY"
                                placeholder={["Start date", "End date"]}
                                style={{ width: "100%" }}
                              />
                            </ConfigProvider>
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart */}
                    <div className="h-[400px]">
                      {!udaHasData ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-muted-foreground">
                            No data available
                          </p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={udaChartData}>
                            <defs>
                              <linearGradient
                                id="udaActualGradient"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="5%"
                                  stopColor="#f59e0b"
                                  stopOpacity={0.8}
                                />
                                <stop
                                  offset="95%"
                                  stopColor="#f59e0b"
                                  stopOpacity={0.1}
                                />
                              </linearGradient>
                              <linearGradient
                                id="udaTargetGradient"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="5%"
                                  stopColor="#14b8a6"
                                  stopOpacity={0.6}
                                />
                                <stop
                                  offset="95%"
                                  stopColor="#14b8a6"
                                  stopOpacity={0.05}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="hsl(var(--border))"
                              opacity={0.3}
                            />
                            <XAxis
                              dataKey="name"
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              angle={-35}
                              textAnchor="end"
                              height={80}
                            />
                            <YAxis
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={12}
                              label={{
                                value: "Actual",
                                angle: -90,
                                position: "insideLeft",
                                style: {
                                  textAnchor: "middle",
                                  fill: "hsl(var(--muted-foreground))",
                                  fontSize: 14,
                                },
                              }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                              }}
                            />
                            <Legend
                              wrapperStyle={{ paddingTop: "20px" }}
                              iconType="circle"
                            />
                            <Area
                              type="monotone"
                              dataKey="actual"
                              name="Actual"
                              fill="url(#udaActualGradient)"
                              stroke="#f59e0b"
                              strokeWidth={3}
                            />
                            <Area
                              type="monotone"
                              dataKey="target"
                              name="Target"
                              fill="url(#udaTargetGradient)"
                              stroke="#14b8a6"
                              strokeWidth={2}
                              strokeDasharray="5 5"
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    {/* Ranking Table */}
                    <div>
                      <h3 className="font-semibold mb-4">Ranking</h3>
                      <div
                        className={`overflow-x-auto${udaRankings.length > 10 ? " overflow-y-auto max-h-[420px]" : ""}`}
                      >
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium">
                                {displayProviderType}
                              </th>
                              <th className="text-right py-2 px-2 font-medium">
                                Actual
                              </th>
                              <th className="text-right py-2 px-2 font-medium">
                                Target
                              </th>
                              <th className="text-center py-2 px-2 font-medium">
                                Rank
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {!udaHasData ? (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="py-8 text-center text-sm text-muted-foreground"
                                >
                                  No data available
                                </td>
                              </tr>
                            ) : (
                              <>
                                {udaRankings.map((row) => {
                                  const { number, suffix } = formatRank(
                                    row.rank,
                                  );
                                  return (
                                    <tr
                                      key={row.providerId}
                                      className="border-b hover:bg-muted/50"
                                    >
                                      <td className="py-3 px-2">
                                        {row.fullName}
                                      </td>
                                      <td className="py-3 px-2 text-right font-semibold text-primary">
                                        {row.actual}
                                      </td>
                                      <td className="py-3 px-2 text-right font-semibold text-success">
                                        {row.target}
                                      </td>
                                      <td className="py-3 px-2 text-center">
                                        <span className="font-semibold">
                                          {number}
                                        </span>
                                        <sup className="text-xs">{suffix}</sup>
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="border-t-2 font-semibold">
                                  <td className="py-3 px-2">Total</td>
                                  <td className="py-3 px-2 text-right text-primary">
                                    {udaRankings.reduce(
                                      (s, r) => s + r.actual,
                                      0,
                                    )}
                                  </td>
                                  <td className="py-3 px-2 text-right text-success">
                                    {udaRankings.reduce(
                                      (s, r) => s + r.target,
                                      0,
                                    )}
                                  </td>
                                  <td className="py-3 px-2"></td>
                                </tr>
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* List Tab */}
          <TabsContent value="list" className="space-y-4">
            {/* Search Bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={`Search ${displayProviderType.toLowerCase()}s...`}
                  value={searchQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchQuery(value);
                    setTableFilters((prev) => ({ ...prev, search: value }));
                  }}
                  className="pl-9 h-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-inactive-providers"
                  checked={!tableFilters.onlyActive}
                  onCheckedChange={(checked) =>
                    setTableFilters((prev) => ({
                      ...prev,
                      onlyActive: checked !== true,
                    }))
                  }
                />
                <Label
                  htmlFor="show-inactive-providers"
                  className="text-sm font-normal text-muted-foreground cursor-pointer"
                >
                  Show inactive
                </Label>
              </div>

              <div className="ml-auto text-sm text-muted-foreground">
                Showing {filteredProviders.length}{" "}
                {displayProviderType.toLowerCase()}
                {filteredProviders.length !== 1 ? "s" : ""}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProviders.length === 0 ? (
              <Card>
                <CardContent className="pt-8">
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">
                      No {displayProviderType.toLowerCase()} providers found
                    </p>
                    <p className="text-sm mt-2">
                      {searchQuery
                        ? "Try adjusting your search"
                        : `Add ${displayProviderType.toLowerCase()} providers to get started`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="bg-muted/50">
                        <SortHeader label="Name" sortKeyValue="name" />
                        {showEmailColumn && <th>Email</th>}
                        {showPhoneColumn && <th>Phone No</th>}
                        <th className="text-center">Split</th>
                        <th className="text-center">Lab Split</th>
                        {showJoiningDateColumn && <th>Joining Date</th>}
                        {showLeavingDateColumn && <th>Leaving Date</th>}
                        <th className="text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProviders.map((provider, index) => {
                        const avatar = provider.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2);
                        const typeColor = getTypeColor(
                          provider.provider_types?.code || "",
                        );

                        return (
                          <tr key={provider.id}>
                            <td className="!text-left">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${typeColor} flex items-center justify-center text-white font-bold text-sm shadow flex-shrink-0`}
                                >
                                  {avatar}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p
                                      className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors leading-tight"
                                      onClick={() =>
                                        handleProviderClick(
                                          provider.id,
                                          providerType,
                                        )
                                      }
                                    >
                                      {provider.name}
                                    </p>
                                    {!provider.is_active && (
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                                      >
                                        Inactive
                                      </Badge>
                                    )}
                                  </div>
                                  {(() => {
                                    // When a specific location is selected, the List is scoped to providers
                                    // who PRODUCED there this period (matching the Overview + Ranking). Show
                                    // THAT location on every row — a cross-location producer (e.g. based at
                                    // Woodbridge but who worked at Leiston) otherwise displayed a misleading
                                    // "Woodbridge" badge in the Leiston view. With no location / "all",
                                    // fall back to each provider's own home location.
                                    const badgeLocationId =
                                      selectedLocationId &&
                                      selectedLocationId !== "all"
                                        ? selectedLocationId
                                        : provider.location_id;
                                    if (
                                      !badgeLocationId ||
                                      !locationMap.get(badgeLocationId)
                                    )
                                      return null;
                                    const style = locationColorMap.get(
                                      badgeLocationId,
                                    ) ?? { chip: "", dot: "bg-gray-400" };
                                    return (
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`}
                                        />
                                        <span className="text-[11px] text-muted-foreground">
                                          {locationMap.get(badgeLocationId)}
                                        </span>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </td>
                            {showEmailColumn && (
                              <td>
                                {provider.email && (
                                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    <Mail className="w-3 h-3" />
                                    {provider.email}
                                  </div>
                                )}
                              </td>
                            )}
                            {showPhoneColumn && (
                              <td>
                                {provider.phone && (
                                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    <Phone className="w-3 h-3" />
                                    {provider.phone}
                                  </div>
                                )}
                              </td>
                            )}
                            <ContractSplitCell
                              method={getSplitMethodLabel(
                                provider.split_source_method,
                              )}
                              rate={getAssociateSplitRate(provider)}
                            />
                            <ContractSplitCell
                              method={getSplitMethodLabel(
                                provider.split_source_method,
                              )}
                              rate={getLabSplitRate(provider)}
                            />
                            {showJoiningDateColumn && (
                              <td>
                                {provider.joining_date && (
                                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    <CalendarIcon className="w-3 h-3" />
                                    {new Date(
                                      provider.joining_date,
                                    ).toLocaleDateString("en-GB")}
                                  </div>
                                )}
                              </td>
                            )}
                            {showLeavingDateColumn && <td></td>}
                            <td>
                              <div className="flex items-center justify-center gap-2">
                                {can("providers", "update", cardKey) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                                    onClick={() =>
                                      handleProviderClick(
                                        provider.id,
                                        providerType,
                                      )
                                    }
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                )}
                                {can("providers", "delete", cardKey) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // TODO: Implement delete functionality
                                      console.log(
                                        "Delete provider:",
                                        provider.id,
                                      );
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Production Data Tab */}
          <TabsContent value="upload" className="space-y-6">
            {/* Net Production Section */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-foreground">
                      {displayProviderType} Net Production
                    </h3>
                    <div className="flex items-center gap-2">
                      <ProductionProviderStatusSelect
                        value={productionProviderStatus}
                        onChange={setProductionProviderStatus}
                        label={productionShowProvidersLabel}
                      />
                      <ChartDateFilter
                        filter={productionDataDateFilter}
                        onFilterChange={setProductionDataDateFilter}
                        customRange={productionDataCustomRange}
                        onCustomRangeChange={setProductionDataCustomRange}
                        align="end"
                        trigger={
                          <Button
                            variant="outline"
                            className="h-9 gap-2 font-normal"
                          >
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">
                              {productionDataDateFilterLabel}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-2"
                        onClick={() => {
                          setProductionTreatmentTypesDraft(
                            productionTreatmentTypes,
                          );
                          setIsProductionFilterOpen(true);
                        }}
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        Filters
                        {productionFilterCount > 0 ? (
                          <Badge variant="secondary">
                            {productionFilterCount}
                          </Badge>
                        ) : null}
                      </Button>
                    </div>
                  </div>
                  <div
                    className="overflow-x-auto"
                    style={
                      visibleProductionProviders.length > 10
                        ? { maxHeight: "520px", overflowY: "auto" }
                        : undefined
                    }
                  >
                    {isLoadingAllProduction ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : isProductionError ? (
                      <div className="text-center text-muted-foreground py-8 space-y-3">
                        <p>Production data failed to load for this date range.</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => refetchAllProduction()}
                        >
                          Retry
                        </Button>
                      </div>
                    ) : !allProvidersProduction ||
                      visibleProductionProviders.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No production data available
                      </div>
                    ) : (
                      <TooltipProvider>
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-sidebar text-white">
                              <th className="text-left p-3 font-semibold text-sm">
                                Name
                              </th>
                              {allProvidersProduction.months.map((month) => (
                                <th
                                  key={month}
                                  className="text-right p-3 font-semibold text-sm"
                                >
                                  {month}
                                </th>
                              ))}
                              <th className="text-right p-3 font-semibold text-sm">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleProductionProviders.map((provider) => (
                                <tr
                                  key={provider.providerId}
                                  className="border-b border-border hover:bg-muted/50"
                                >
                                  <td className="p-3 font-medium">
                                    {provider.providerName}
                                  </td>
                                  {allProvidersProduction.months.map(
                                    (month) => {
                                      const monthData = provider.monthlyData[
                                        month
                                      ] || {
                                        amount: 0,
                                        private: 0,
                                        membership: 0,
                                        nhs: 0,
                                        rawTotal: 0,
                                      };
                                      return (
                                        <td
                                          key={month}
                                          className="p-3 text-right"
                                        >
                                          <UITooltip>
                                            <TooltipTrigger asChild>
                                              <span className="cursor-default">
                                                {formatCurrency(
                                                  getFilteredMonthAmount(
                                                    monthData,
                                                  ),
                                                )}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent
                                              side="top"
                                              className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                            >
                                              <TooltipArrow className="fill-white" />
                                              <ProductionIncomeBreakdown
                                                privateAmt={monthData.private}
                                                membershipAmt={monthData.membership}
                                                nhsAmt={monthData.nhs}
                                                rawTotal={monthData.rawTotal}
                                                formatCurrency={formatCurrency}
                                              />
                                            </TooltipContent>
                                          </UITooltip>
                                        </td>
                                      );
                                    },
                                  )}
                                  <td className="p-3 text-right font-semibold">
                                    <UITooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-default">
                                          {formatCurrency(
                                            getFilteredProviderTotal(provider),
                                          )}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                      >
                                        <TooltipArrow className="fill-white" />
                                        <ProductionIncomeBreakdown
                                          privateAmt={provider.totalPrivate}
                                          membershipAmt={provider.totalMembership}
                                          nhsAmt={provider.totalNhs}
                                          rawTotal={provider.totalRaw}
                                          formatCurrency={formatCurrency}
                                        />
                                      </TooltipContent>
                                    </UITooltip>
                                  </td>
                                </tr>
                              ))}
                            {/* Total Row */}
                            <tr className="border-t-2 border-border bg-muted/30">
                              <td className="p-3 font-semibold">Total</td>
                              {allProvidersProduction.months.map((month) => {
                                const monthTotals =
                                  visibleProductionProviders.reduce(
                                    (acc, provider) => {
                                      const monthData = provider.monthlyData[
                                        month
                                      ] || {
                                        amount: 0,
                                        private: 0,
                                        membership: 0,
                                        nhs: 0,
                                        rawTotal: 0,
                                      };
                                      return {
                                        amount: acc.amount + monthData.amount,
                                        private:
                                          acc.private + monthData.private,
                                        membership:
                                          acc.membership + monthData.membership,
                                        nhs: acc.nhs + monthData.nhs,
                                        rawTotal:
                                          acc.rawTotal + monthData.rawTotal,
                                      };
                                    },
                                    {
                                      amount: 0,
                                      private: 0,
                                      membership: 0,
                                      nhs: 0,
                                      rawTotal: 0,
                                    },
                                  );
                                return (
                                  <td
                                    key={month}
                                    className="p-3 text-right font-semibold"
                                  >
                                    <UITooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-default">
                                          {formatCurrency(
                                            getFilteredMonthAmount(monthTotals),
                                          )}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                      >
                                        <TooltipArrow className="fill-white" />
                                        <ProductionIncomeBreakdown
                                          privateAmt={monthTotals.private}
                                          membershipAmt={monthTotals.membership}
                                          nhsAmt={monthTotals.nhs}
                                          rawTotal={monthTotals.rawTotal}
                                          formatCurrency={formatCurrency}
                                        />
                                      </TooltipContent>
                                    </UITooltip>
                                  </td>
                                );
                              })}
                              <td className="p-3 text-right font-semibold">
                                <UITooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-default">
                                      {formatCurrency(
                                        visibleProductionProviders.reduce(
                                          (sum, provider) =>
                                            sum +
                                            getFilteredProviderTotal(provider),
                                          0,
                                        ),
                                      )}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                  >
                                    <TooltipArrow className="fill-white" />
                                    <ProductionIncomeBreakdown
                                      privateAmt={visibleProductionProviders.reduce(
                                        (sum, provider) =>
                                          sum + provider.totalPrivate,
                                        0,
                                      )}
                                      membershipAmt={visibleProductionProviders.reduce(
                                        (sum, provider) =>
                                          sum + provider.totalMembership,
                                        0,
                                      )}
                                      nhsAmt={visibleProductionProviders.reduce(
                                        (sum, provider) =>
                                          sum + provider.totalNhs,
                                        0,
                                      )}
                                      rawTotal={visibleProductionProviders.reduce(
                                        (sum, provider) =>
                                          sum + provider.totalRaw,
                                        0,
                                      )}
                                      formatCurrency={formatCurrency}
                                    />
                                  </TooltipContent>
                                </UITooltip>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Net Production — Filter Options dialog */}
            <Dialog
              open={isProductionFilterOpen}
              onOpenChange={setIsProductionFilterOpen}
            >
              <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                  <DialogTitle>Filter Options</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">
                      Treatment Type
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between font-normal"
                        >
                          <span className="truncate">
                            {productionTreatmentTypesDraft.length === 0
                              ? "All"
                              : productionTreatmentTypesDraft
                                  .map(
                                    (t) =>
                                      PRODUCTION_TREATMENT_TYPE_OPTIONS.find(
                                        (o) => o.value === t,
                                      )?.label,
                                  )
                                  .join(", ")}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[--radix-popover-trigger-width] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder="Search treatment type..." />
                          <CommandEmpty>No treatment type found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="All"
                              onSelect={() =>
                                setProductionTreatmentTypesDraft([])
                              }
                              className="cursor-pointer"
                            >
                              <Checkbox
                                checked={
                                  productionTreatmentTypesDraft.length === 0
                                }
                                tabIndex={-1}
                                className="mr-2 pointer-events-none"
                                aria-hidden="true"
                              />
                              <span>All</span>
                            </CommandItem>
                            {PRODUCTION_TREATMENT_TYPE_OPTIONS.map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() =>
                                  setProductionTreatmentTypesDraft((prev) =>
                                    prev.includes(opt.value)
                                      ? prev.filter((v) => v !== opt.value)
                                      : [...prev, opt.value],
                                  )
                                }
                                className="cursor-pointer"
                              >
                                <Checkbox
                                  checked={productionTreatmentTypesDraft.includes(
                                    opt.value,
                                  )}
                                  tabIndex={-1}
                                  className="mr-2 pointer-events-none"
                                  aria-hidden="true"
                                />
                                <span>{opt.label}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setProductionTreatmentTypes(
                        productionTreatmentTypesDraft,
                      );
                      setIsProductionFilterOpen(false);
                    }}
                    className="gap-2"
                  >
                    <Search className="h-4 w-4" />
                    Search
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setProductionTreatmentTypesDraft([]);
                      setProductionTreatmentTypes([]);
                    }}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Working Hours Section */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-foreground">
                      {displayProviderType} Working Hours
                    </h3>
                    <div className="flex items-center gap-2">
                      {can("providers", "add", cardKey) && (
                        <Button
                          className="bg-sidebar hover:bg-sidebar hover:text-sidebar-foreground text-white gap-2"
                          onClick={() => {
                            setWorkingHoursRows([{ month: "", data: {} }]);
                            setShowWorkingHoursDialog(true);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                          Add Working Hours
                        </Button>
                      )}
                    </div>
                  </div>
                  <div
                    className="overflow-x-auto"
                    style={
                      visibleHoursProviders.length > 10
                        ? { maxHeight: "520px", overflowY: "auto" }
                        : undefined
                    }
                  >
                    {isLoadingWorkingHoursTable ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : !allProvidersHours ||
                      visibleHoursProviders.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No working hours data available
                      </div>
                    ) : (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-sidebar text-white">
                            <th className="text-left p-3 font-semibold text-sm">
                              Name
                            </th>
                            {allProvidersHours.months.map((month) => (
                              <th
                                key={month}
                                className="text-right p-3 font-semibold text-sm"
                              >
                                {month}
                              </th>
                            ))}
                            <th className="text-right p-3 font-semibold text-sm">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleHoursProviders.map((provider) => (
                              <tr
                                key={provider.providerId}
                                className="border-b border-border hover:bg-muted/50 cursor-pointer"
                                onClick={() =>
                                  handleProviderClick(
                                    provider.providerId,
                                    providerType,
                                  )
                                }
                              >
                                <td className="p-3 font-medium">
                                  {provider.providerName}
                                </td>
                                {allProvidersHours.months.map((month) => {
                                  const hours = provider.monthlyData[month];
                                  return (
                                    <td
                                      key={month}
                                      className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openWHEditDialog(month);
                                      }}
                                    >
                                      {hours > 0
                                        ? Number.isInteger(hours)
                                          ? hours.toString()
                                          : hours.toFixed(1)
                                        : "-"}
                                    </td>
                                  );
                                })}
                                <td className="p-3 text-right font-semibold">
                                  {provider.total > 0
                                    ? Number.isInteger(provider.total)
                                      ? provider.total.toString()
                                      : provider.total.toFixed(1)
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          {/* Total Row */}
                          <tr className="border-t-2 border-border bg-muted/30">
                            <td className="p-3 font-semibold">Total</td>
                            {allProvidersHours.months.map((month) => {
                              const monthTotal =
                                visibleHoursProviders.reduce(
                                  (sum, provider) =>
                                    sum + (provider.monthlyData[month] || 0),
                                  0,
                                );
                              return (
                                <td
                                  key={month}
                                  className="p-3 text-right font-semibold"
                                >
                                  {monthTotal > 0
                                    ? Number.isInteger(monthTotal)
                                      ? monthTotal.toString()
                                      : monthTotal.toFixed(1)
                                    : "-"}
                                </td>
                              );
                            })}
                            <td className="p-3 text-right font-semibold">
                              {(() => {
                                const grandTotal =
                                  visibleHoursProviders.reduce(
                                    (sum, provider) => sum + provider.total,
                                    0,
                                  );
                                return Number.isInteger(grandTotal)
                                  ? grandTotal.toString()
                                  : grandTotal.toFixed(1);
                              })()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* NHS Count Section */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-foreground">
                      {displayProviderType} NHS UDA Completed
                    </h3>
                    <div className="flex items-center gap-2">
                      {can("providers", "add", cardKey) && (
                        <Button
                          className="bg-sidebar hover:bg-sidebar hover:text-sidebar-foreground text-white gap-2"
                          onClick={() => {
                            setNhsCountRows([{ month: "", data: {} }]);
                            setShowNhsCountDialog(true);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                          Add NHS Count
                        </Button>
                      )}
                    </div>
                  </div>
                  <div
                    className="overflow-x-auto"
                    style={
                      visibleNhsCountProviders.length > 10
                        ? { maxHeight: "520px", overflowY: "auto" }
                        : undefined
                    }
                  >
                    {isLoadingNhsCounts ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : visibleNhsCountProviders.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No NHS count data available
                      </div>
                    ) : (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-sidebar text-white">
                            <th className="text-left p-3 font-semibold text-sm">
                              Name
                            </th>
                            {nhsCountMonths.map((month) => (
                              <th
                                key={month}
                                className="text-right p-3 font-semibold text-sm"
                              >
                                {month}
                              </th>
                            ))}
                            <th className="text-right p-3 font-semibold text-sm">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleNhsCountProviders.map((provider) => (
                              <tr
                                key={provider.providerId}
                                className="border-b border-border hover:bg-muted/50 cursor-pointer"
                                onClick={() =>
                                  handleProviderClick(
                                    provider.providerId,
                                    providerType,
                                  )
                                }
                              >
                                <td className="p-3 font-medium">
                                  {provider.providerName}
                                </td>
                                {nhsCountMonths.map((month) => {
                                  const count = provider.monthlyData[month];
                                  return (
                                    <td
                                      key={month}
                                      className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openCountEditDialog(
                                          month,
                                          "uda_count",
                                          setNhsCountRows,
                                          setIsLoadingNhsCountDialog,
                                          setShowNhsCountDialog,
                                        );
                                      }}
                                    >
                                      {count > 0 ? count.toString() : "-"}
                                    </td>
                                  );
                                })}
                                <td className="p-3 text-right font-semibold">
                                  {provider.total > 0
                                    ? provider.total.toString()
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          <tr className="border-t-2 border-border bg-muted/30">
                            <td className="p-3 font-semibold">Total</td>
                            {nhsCountMonths.map((month) => {
                              const monthTotal =
                                visibleNhsCountProviders.reduce(
                                  (sum, provider) =>
                                    sum + (provider.monthlyData[month] || 0),
                                  0,
                                );
                              return (
                                <td
                                  key={month}
                                  className="p-3 text-right font-semibold"
                                >
                                  {monthTotal > 0 ? monthTotal.toString() : "-"}
                                </td>
                              );
                            })}
                            <td className="p-3 text-right font-semibold">
                              {(() => {
                                const grandTotal =
                                  visibleNhsCountProviders.reduce(
                                    (sum, provider) => sum + provider.total,
                                    0,
                                  );
                                return grandTotal > 0
                                  ? grandTotal.toString()
                                  : "-";
                              })()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* MOS Count Section */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-foreground">
                      {displayProviderType} MOS UDA Completed
                    </h3>
                    <div className="flex items-center gap-2">
                      {can("providers", "add", cardKey) && (
                        <Button
                          className="bg-sidebar hover:bg-sidebar hover:text-sidebar-foreground text-white gap-2"
                          onClick={() => {
                            setMosCountRows([{ month: "", data: {} }]);
                            setShowMosCountDialog(true);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                          Add MOS Count
                        </Button>
                      )}
                    </div>
                  </div>
                  <div
                    className="overflow-x-auto"
                    style={
                      visibleMosCountProviders.length > 10
                        ? { maxHeight: "520px", overflowY: "auto" }
                        : undefined
                    }
                  >
                    {isLoadingMosCounts ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : visibleMosCountProviders.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No MOS count data available
                      </div>
                    ) : (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-sidebar text-white">
                            <th className="text-left p-3 font-semibold text-sm">
                              Name
                            </th>
                            {mosCountMonths.map((month) => (
                              <th
                                key={month}
                                className="text-right p-3 font-semibold text-sm"
                              >
                                {month}
                              </th>
                            ))}
                            <th className="text-right p-3 font-semibold text-sm">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleMosCountProviders.map((provider) => (
                              <tr
                                key={provider.providerId}
                                className="border-b border-border hover:bg-muted/50 cursor-pointer"
                                onClick={() =>
                                  handleProviderClick(
                                    provider.providerId,
                                    providerType,
                                  )
                                }
                              >
                                <td className="p-3 font-medium">
                                  {provider.providerName}
                                </td>
                                {mosCountMonths.map((month) => {
                                  const count = provider.monthlyData[month];
                                  return (
                                    <td
                                      key={month}
                                      className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openCountEditDialog(
                                          month,
                                          "mos_count",
                                          setMosCountRows,
                                          setIsLoadingMosCountDialog,
                                          setShowMosCountDialog,
                                        );
                                      }}
                                    >
                                      {count > 0 ? count.toString() : "-"}
                                    </td>
                                  );
                                })}
                                <td className="p-3 text-right font-semibold">
                                  {provider.total > 0
                                    ? provider.total.toString()
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          <tr className="border-t-2 border-border bg-muted/30">
                            <td className="p-3 font-semibold">Total</td>
                            {mosCountMonths.map((month) => {
                              const monthTotal =
                                visibleMosCountProviders.reduce(
                                  (sum, provider) =>
                                    sum + (provider.monthlyData[month] || 0),
                                  0,
                                );
                              return (
                                <td
                                  key={month}
                                  className="p-3 text-right font-semibold"
                                >
                                  {monthTotal > 0 ? monthTotal.toString() : "-"}
                                </td>
                              );
                            })}
                            <td className="p-3 text-right font-semibold">
                              {(() => {
                                const grandTotal =
                                  visibleMosCountProviders.reduce(
                                    (sum, provider) => sum + provider.total,
                                    0,
                                  );
                                return grandTotal > 0
                                  ? grandTotal.toString()
                                  : "-";
                              })()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Profit Goals Tab */}
          <TabsContent value="profit-goals" className="space-y-6">
            <div className="space-y-8">
              <h2 className="text-2xl font-bold text-foreground">
                Profit Goals Settings - {displayProviderType}
              </h2>

              {/* Date Selection */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex gap-8">
                    <div>
                      <Label className="block mb-2">
                        Date Selection for Operations
                      </Label>
                      <ChartDateFilter
                        filter={profitGoalsDateFilter}
                        onFilterChange={setProfitGoalsDateFilter}
                        customRange={profitGoalsCustomRange}
                        onCustomRangeChange={setProfitGoalsCustomRange}
                        align="start"
                        trigger={
                          <Button
                            variant="outline"
                            className="h-9 gap-2 font-normal"
                          >
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">
                              {profitGoalsDateFilterLabel}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        }
                      />
                    </div>
                    <div>
                      <Label className="block mb-2">Planning Month</Label>
                      <ConfigProvider
                        theme={{
                          token: {
                            colorPrimary: "hsl(244, 48%, 25%)",
                            colorPrimaryBg: "#e6f4ff",
                            colorPrimaryBgHover: "#bae0ff",
                          },
                        }}
                      >
                        <DatePicker
                          value={planningMonth ? dayjs(planningMonth) : null}
                          onChange={(date) => {
                            setPlanningMonth(date ? date.toDate() : null);
                          }}
                          picker="month"
                          format="YYYY-MM"
                          placeholder="Select month"
                        />
                      </ConfigProvider>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Details Label */}
              <div className="flex items-center gap-3">
                <Info className="w-4 h-4 text-purple-600" />
                <Label className="text-base font-semibold">Details</Label>
                <button
                  onClick={() => setShowFormulaDialog(true)}
                  className="text-xs text-purple-600 hover:text-purple-800 hover:underline font-medium"
                >
                  View Formula Breakdown
                </button>
              </div>

              {/* Information Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Operational Costs & Profit
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Op costs:
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(profitGoalsMetrics.opCosts)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Target % Profit:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.targetProfitPercent}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold">OCPSPD:</span>
                      <span className="font-semibold">
                        {formatCurrency(profitGoalsMetrics.ocpspd)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Operational Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Weeks open/year:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.weeksOpenPerYear}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Days open/week:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.daysOpenPerWeek}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        # Surgeries:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.numSurgeries}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Working days:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.workingDays}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold">
                        Surgery days/year:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.surgeryDaysPerYear}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Associate Available Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Assoc weeks/year:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.assocWeeksPerYear}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Days/week:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.assocDaysPerWeek}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold">
                        Assoc days/year:
                      </span>
                      <span className="font-semibold">
                        {profitGoalsMetrics.assocDaysPerYear}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Practice & Associate Expenses
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">
                          Practice Costs
                        </span>
                        <span className="text-xs text-muted-foreground">
                          (Materials %):
                        </span>
                      </div>
                      <span className="font-semibold">
                        {profitGoalsMetrics.practiceCostMaterialsPercent}%
                      </span>
                    </div>
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">
                          Practice/Associate Costs
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Lab Cost %:
                        </span>
                      </div>
                      <span className="font-semibold">
                        {profitGoalsMetrics.associateCostLabsPercent}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Table */}
              <Card>
                <CardContent className="pt-6">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead>
                        {/* Top-level Category Headers */}
                        <tr>
                          <th className="bg-transparent"></th>
                          <td colSpan={2} className="text-center p-0">
                            <div className="bg-[#e8f4fc] dark:bg-blue-900/30 text-[#5b7a99] dark:text-blue-200 rounded-t-lg px-3 py-2 text-xs font-medium">
                              Avg Daily Production
                            </div>
                          </td>
                          <td colSpan={3} className="text-center p-0">
                            <div className="bg-[#e6f5ee] dark:bg-green-900/30 text-[#4a8c6f] dark:text-green-200 rounded-t-lg px-3 py-2 text-xs font-medium">
                              Total Production
                            </div>
                          </td>
                          <td colSpan={3} className="text-center p-0">
                            <div className="bg-[#f3e8f5] dark:bg-purple-900/30 text-[#8b5a9e] dark:text-purple-200 rounded-t-lg px-3 py-2 text-xs font-medium">
                              Practice P/L: Periodic Overview
                            </div>
                          </td>
                          <td colSpan={3} className="text-center p-0">
                            <div className="bg-[#fdf5e6] dark:bg-amber-900/30 text-[#a08050] dark:text-amber-200 rounded-t-lg px-3 py-2 text-xs font-medium">
                              P/L %: Actual vs. Planned (Period Summary)
                            </div>
                          </td>
                        </tr>
                        {/* Sub-header Row */}
                        <tr className="bg-sidebar text-white">
                          <th className="text-left p-3 font-medium text-sm w-28">
                            Associate
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Actual
                          </th>
                          <th className="text-center p-3 font-medium text-sm border-r border-white/20">
                            Planned
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Actual
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Planned
                          </th>
                          <th className="text-right p-3 font-medium text-sm border-r border-white/20">
                            Variance
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Actual
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Planned
                          </th>
                          <th className="text-right p-3 font-medium text-sm border-r border-white/20">
                            Variance
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Actual
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Planned
                          </th>
                          <th className="text-right p-3 font-medium text-sm">
                            Variance
                          </th>
                          <th className="text-center p-3 font-medium text-sm">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoadingProfitGoalsProduction ||
                        isLoadingProfitGoalsHours ? (
                          <tr>
                            <td colSpan={13} className="py-12 text-center">
                              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span className="text-sm">Loading...</span>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          providersMetrics.map((pm) => {
                            // When no planned Avg Daily Production has been set, Planned/Variance are unknown — show "-" instead of a misleading calculation
                            const isPlannedProductionSet =
                              pm.plannedAvgDaily > 0;
                            const varianceTotalProduction =
                              pm.totalProduction - pm.plannedTotalProduction;
                            const variancePracticePL =
                              pm.practicePL - pm.plannedPracticePL;
                            const actualPLPercent =
                              pm.totalProduction > 0
                                ? (pm.practicePL / pm.totalProduction) * 100
                                : 0;
                            const plannedPLPercent =
                              pm.plannedTotalProduction > 0
                                ? (pm.plannedPracticePL /
                                    pm.plannedTotalProduction) *
                                  100
                                : 0;
                            const variancePLPercent =
                              actualPLPercent - plannedPLPercent;

                            return (
                              // key must sit on the mapped TOP-LEVEL element; a shorthand <>
                              // fragment can't hold one, so use React.Fragment with the key.
                              <React.Fragment key={pm.provider.id}>
                                {/* Main Data Row */}
                                <tr
                                  className="border-b border-border hover:bg-muted/50 cursor-pointer"
                                  onClick={() =>
                                    setExpandedAssociate(
                                      expandedAssociate === pm.provider.id
                                        ? null
                                        : pm.provider.id,
                                    )
                                  }
                                >
                                  {/* Associate Cell */}
                                  <td
                                    className="p-3 font-medium align-middle !whitespace-normal"
                                    rowSpan={2}
                                  >
                                    <div className="flex items-center gap-2 w-[108px]">
                                      <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                                        {expandedAssociate ===
                                        pm.provider.id ? (
                                          <X className="w-3.5 h-3.5" />
                                        ) : (
                                          <Plus className="w-3.5 h-3.5" />
                                        )}
                                      </div>
                                      <span className="break-words min-w-0 flex-1">
                                        {pm.provider.name}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-3 text-right">
                                    {formatCurrency(pm.avgDailyProduction)}
                                  </td>
                                  <td className="p-3 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-muted-foreground">
                                        £
                                      </span>
                                      <Input
                                        type="number"
                                        value={
                                          providersPlannedInput[
                                            pm.provider.id
                                          ] || ""
                                        }
                                        onChange={(e) =>
                                          setProvidersPlannedInput((prev) => ({
                                            ...prev,
                                            [pm.provider.id]: e.target.value,
                                          }))
                                        }
                                        onBlur={(e) => {
                                          const value =
                                            Number(e.target.value) || 0;
                                          setProvidersPlannedProduction(
                                            (prev) => ({
                                              ...prev,
                                              [pm.provider.id]: value,
                                            }),
                                          );
                                          setProvidersPlannedInput((prev) => ({
                                            ...prev,
                                            [pm.provider.id]: String(value),
                                          }));
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            const value =
                                              Number(
                                                providersPlannedInput[
                                                  pm.provider.id
                                                ],
                                              ) || 0;
                                            setProvidersPlannedProduction(
                                              (prev) => ({
                                                ...prev,
                                                [pm.provider.id]: value,
                                              }),
                                            );
                                            setProvidersPlannedInput(
                                              (prev) => ({
                                                ...prev,
                                                [pm.provider.id]: String(value),
                                              }),
                                            );
                                            e.currentTarget.blur();
                                          }
                                        }}
                                        className="w-28 h-10 text-right text-base hover:border-sidebar focus-visible:ring-sidebar"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  </td>
                                  <td className="p-3 text-right border-l border-border">
                                    {formatCurrency(pm.totalProduction)}
                                  </td>
                                  <td className="p-3 text-right">
                                    {isPlannedProductionSet
                                      ? formatCurrency(
                                          pm.plannedTotalProduction,
                                        )
                                      : "-"}
                                  </td>
                                  <td
                                    className={`p-3 text-right font-semibold ${isPlannedProductionSet ? (varianceTotalProduction >= 0 ? "text-green-600" : "text-red-600") : ""}`}
                                  >
                                    {isPlannedProductionSet
                                      ? formatCurrency(varianceTotalProduction)
                                      : "-"}
                                  </td>
                                  <td className="p-3 text-right border-l border-border">
                                    {formatCurrency(pm.practicePL)}
                                  </td>
                                  <td
                                    className={`p-3 text-right ${isPlannedProductionSet ? (pm.plannedPracticePL < 0 ? "text-red-600" : "text-green-600") : ""}`}
                                  >
                                    {isPlannedProductionSet
                                      ? formatCurrency(pm.plannedPracticePL)
                                      : "-"}
                                  </td>
                                  <td
                                    className={`p-3 text-right font-semibold ${isPlannedProductionSet ? (variancePracticePL >= 0 ? "text-green-600" : "text-red-600") : ""}`}
                                  >
                                    {isPlannedProductionSet
                                      ? formatCurrency(variancePracticePL)
                                      : "-"}
                                  </td>
                                  <td className="p-3 text-right border-l border-border">
                                    {actualPLPercent.toFixed(2)} %
                                  </td>
                                  <td className="p-3 text-right">
                                    {isPlannedProductionSet
                                      ? `${plannedPLPercent.toFixed(2)} %`
                                      : "-"}
                                  </td>
                                  <td
                                    className={`p-3 text-right font-semibold ${isPlannedProductionSet ? (variancePLPercent >= 0 ? "text-green-600" : "text-red-600") : ""}`}
                                  >
                                    {isPlannedProductionSet
                                      ? `${variancePLPercent.toFixed(2)} %`
                                      : "-"}
                                  </td>
                                  <td
                                    className="p-3 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-center gap-1">
                                      <TooltipProvider>
                                        <UITooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-8 w-8 hover:bg-sidebar hover:text-sidebar-foreground hidden"
                                              onClick={() =>
                                                copyPlannedValue(pm.provider.id)
                                              }
                                            >
                                              <Copy className="w-4 h-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Copy Planned Value</p>
                                          </TooltipContent>
                                        </UITooltip>
                                      </TooltipProvider>
                                      <TooltipProvider>
                                        <UITooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-8 w-8 text-green-600 hover:bg-sidebar hover:text-sidebar-foreground"
                                              onClick={() =>
                                                savePlannedDailyProduction(
                                                  pm.provider.id,
                                                )
                                              }
                                            >
                                              <CheckCheck className="w-4 h-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Save Planned Daily Production</p>
                                          </TooltipContent>
                                        </UITooltip>
                                      </TooltipProvider>
                                    </div>
                                  </td>
                                </tr>
                                {/* Expanded Details Row */}
                                <tr
                                  key={`${pm.provider.id}-expanded`}
                                  className={
                                    expandedAssociate === pm.provider.id
                                      ? "border-b border-border"
                                      : ""
                                  }
                                >
                                  <td colSpan={12} className="p-0">
                                    <div
                                      style={{
                                        maxHeight:
                                          expandedAssociate === pm.provider.id
                                            ? "200px"
                                            : "0px",
                                        opacity:
                                          expandedAssociate === pm.provider.id
                                            ? 1
                                            : 0,
                                        overflow: "hidden",
                                        transition:
                                          "max-height 0.3s ease, opacity 0.3s ease",
                                      }}
                                    >
                                      {/* Inner Table for Details */}
                                      <table className="w-full">
                                        <thead>
                                          <tr>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Associate
                                              <br />
                                              Net Pay
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Associate Split
                                              <br />
                                              (%)
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Cost
                                              <br />
                                              of Labs
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Associate Lab Split
                                              <br />
                                              (%)
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Avg Lab Cost
                                              <br />
                                              /month
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Materials
                                              <br />
                                              Costs
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              Working
                                              <br />
                                              Days
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              OCPSPA
                                              <br />
                                              Contribution
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              P/L % on
                                              <br />
                                              OCPSPD
                                            </th>
                                            <th className="px-3 pt-2 pb-1 text-xs font-normal text-muted-foreground text-center">
                                              P/L on Room /<br />
                                              Day
                                            </th>
                                            <th className="px-3 pt-2 pb-1"></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                pm.associateNetPay,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {pm.associateSplitPercent} %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(pm.costOfLabs)}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {pm.associateLabSplitPercent} %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                pm.avgLabCostPerMonth,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                pm.materialsCosts,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {pm.workingDays.toFixed(2)}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                pm.ocpspaContribution,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {pm.plPercentOnOCPSPD.toFixed(0)}{" "}
                                              %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                pm.plOnRoomPerDay,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3"></td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Planned Daily Production */}
              <Card>
                <CardHeader>
                  <CardTitle>Planned Daily Production</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-sidebar text-white">
                          <th className="text-left p-3 font-semibold text-sm">
                            #
                          </th>
                          <th className="text-left p-3 font-semibold text-sm">
                            Name
                          </th>
                          <th className="text-right p-3 font-semibold text-sm">
                            Average Daily Production
                          </th>
                          <th className="text-left p-3 font-semibold text-sm">
                            created Date
                          </th>
                          <th className="text-left p-3 font-semibold text-sm">
                            created By
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Filter records to only show current provider type
                          const filteredProviderIds = filteredProviders.map(
                            (p) => p.id,
                          );
                          const filteredRecords = allSavedPlannedRecords.filter(
                            (record) =>
                              filteredProviderIds.includes(record.provider_id),
                          );

                          if (filteredRecords.length === 0) {
                            return (
                              <tr>
                                <td
                                  colSpan={5}
                                  className="p-8 text-center text-muted-foreground"
                                >
                                  No records found
                                </td>
                              </tr>
                            );
                          }

                          return filteredRecords.map((record, index) => {
                            const provider = providers.find(
                              (p) => p.id === record.provider_id,
                            );
                            return (
                              <tr
                                key={record.id}
                                className="border-b border-border hover:bg-muted/50"
                              >
                                <td className="p-3 text-left">{index + 1}</td>
                                <td className="p-3 text-left">
                                  {provider?.name || "Unknown"}
                                </td>
                                <td className="p-3 text-right font-semibold">
                                  {formatCurrency(
                                    record.average_daily_production,
                                  )}
                                </td>
                                <td className="p-3 text-left">
                                  {format(
                                    new Date(record.created_at),
                                    "MMM dd, yyyy hh:mm a",
                                  )}
                                </td>
                                <td className="p-3 text-left">
                                  {record.created_by_email || "Unknown"}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      {/* Profit Goals Formula Breakdown Dialog */}
      <Dialog open={showFormulaDialog} onOpenChange={setShowFormulaDialog}>
        <DialogContent className="max-w-[95vw] w-[1100px] max-h-[92vh] overflow-y-auto">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-purple-600" />
              Profit Goals — Formula Breakdown
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const row =
              providersMetrics.find((r: any) => r.totalProduction > 0) ||
              providersMetrics[0] ||
              null;
            const isDummy = !row || row.totalProduction === 0;
            const providerName: string = isDummy
              ? ""
              : ((row as any).provider?.name ?? "");

            const plannedAvgDaily = isDummy
              ? 2500
              : (row as any).plannedAvgDaily || 0;
            const workingDays = isDummy ? 25 : (row as any).workingDays;
            const assocSplit = isDummy
              ? 50
              : (row as any).associateSplitPercent;
            const assocLabSplit = isDummy
              ? 50
              : (row as any).associateLabSplitPercent;
            const actualTotal = isDummy ? 60000 : (row as any).totalProduction;
            // Effective rate implied by the row's actually-resolved cost — matches
            // the raw location/provider percentage for production-scaled sources,
            // and is just an informational "implied %" for absolute-£ sources
            // (accounting application / sliding scale / monthly), so the formula
            // below reproduces the same £ figures shown in the table.
            const labPct = isDummy
              ? 10
              : actualTotal > 0
                ? ((row as any).costOfLabs / actualTotal) * 100
                : 0;
            const matPct = isDummy
              ? 5
              : actualTotal > 0
                ? ((row as any).materialsCosts / actualTotal) * 100
                : 0;
            const ocpspd = isDummy ? 85 : profitGoalsMetrics.ocpspd;
            const avgLabCostMonth = isDummy
              ? 500
              : (row as any).avgLabCostPerMonth;
            const numberOfMonths = isDummy
              ? 12
              : profitGoalsDateRange.from && profitGoalsDateRange.to
                ? (profitGoalsDateRange.to.getFullYear() -
                    profitGoalsDateRange.from.getFullYear()) *
                    12 +
                  (profitGoalsDateRange.to.getMonth() -
                    profitGoalsDateRange.from.getMonth()) +
                  1
                : 1;
            const plOnRoomPerDay = isDummy ? 800 : (row as any).plOnRoomPerDay;
            const plPctOnOCPSPD = isDummy
              ? 900
              : (row as any).plPercentOnOCPSPD;

            const actualAvgDaily =
              workingDays > 0 ? actualTotal / workingDays : 0;
            const plannedTotal = plannedAvgDaily * workingDays;
            const assocGross = actualTotal * (assocSplit / 100);
            const labDeduction =
              actualTotal * (labPct / 100) * (assocLabSplit / 100);
            const assocNetPay = assocGross - labDeduction;
            const costOfLabs = actualTotal * (labPct / 100);
            const matCost = actualTotal * (matPct / 100);
            // Use the row's own resolved planned materials figure — correctly
            // handles absolute-£ cost sources, which don't scale with planned
            // production the way a flat percentage does.
            const plannedMaterials = isDummy
              ? plannedTotal * (matPct / 100)
              : (row as any).plannedMaterials;
            const ocpspaContrib = ocpspd * workingDays;
            // Use row's pre-computed plannedPracticePL so popup matches table exactly
            const plannedPL = isDummy
              ? plannedTotal -
                assocNetPay -
                costOfLabs -
                plannedMaterials -
                ocpspaContrib
              : (row as any).plannedPracticePL;
            const actualPL = isDummy
              ? actualTotal - assocNetPay - costOfLabs - matCost - ocpspaContrib
              : (row as any).practicePL;
            const variance = actualTotal - plannedTotal;
            const actualPLPct =
              actualTotal > 0 ? (actualPL / actualTotal) * 100 : 0;
            const plannedPLPct =
              plannedTotal > 0 ? (plannedPL / plannedTotal) * 100 : 0;

            const fmtGBP = (n: number) =>
              new Intl.NumberFormat("en-GB", {
                style: "currency",
                currency: "GBP",
                minimumFractionDigits: 2,
              }).format(Math.abs(n));
            const signed = (n: number) =>
              n < 0 ? `(${fmtGBP(n)})` : fmtGBP(n);
            const pct = (n: number) => `${n.toFixed(0)}%`;
            const days = (n: number) => n.toFixed(2); // short form for chips
            const daysLong = (n: number) => n.toFixed(4); // full precision for formula verification
            const badge = (n: number, color: string) => (
              <span
                className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${color} text-white text-[9px] font-bold shrink-0`}
              >
                {n}
              </span>
            );

            return (
              <div className="space-y-3 text-xs">
                {/* Banner */}
                <div
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md ${isDummy ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}
                >
                  <Info className="w-3 h-3 shrink-0" />
                  {isDummy
                    ? "Showing example values — no provider data available yet"
                    : `Using real data from: ${providerName} (first active provider)`}
                </div>

                {/* ── INPUTS ── compact chip grid */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                    Inputs
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        [
                          "Planned Avg Daily",
                          fmtGBP(plannedAvgDaily),
                          "bg-slate-100",
                        ],
                        [
                          "Working Days (Actual)",
                          `${days(workingDays)} days`,
                          "bg-slate-100",
                        ],
                        ["Associate Split %", pct(assocSplit), "bg-slate-100"],
                        [
                          "Associate Lab Split %",
                          pct(assocLabSplit),
                          "bg-slate-100",
                        ],
                        ["Lab Cost %", pct(labPct), "bg-slate-100"],
                        ["Materials %", pct(matPct), "bg-slate-100"],
                        ["OCPSPD", fmtGBP(ocpspd), "bg-slate-100"],
                        [
                          "Actual Total Prod.",
                          fmtGBP(actualTotal),
                          "bg-purple-50 border border-purple-200",
                        ],
                      ] as [string, string, string][]
                    ).map(([label, val, cls]) => (
                      <div
                        key={label}
                        className={`rounded-md px-2.5 py-2 flex items-center justify-between gap-2 ${cls}`}
                      >
                        <span className="text-slate-500 text-[10px] leading-tight">
                          {label}
                        </span>
                        <span className="font-mono font-bold text-slate-800 text-[11px] whitespace-nowrap">
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── STEP CALCULATIONS ── */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Step 1 */}
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      {badge(1, "bg-purple-600")} Planned Total Production
                    </div>
                    <div className="text-slate-500 font-mono">
                      Planned Avg Daily × Working Days
                    </div>
                    <div className="mt-1.5 text-slate-400 font-mono">
                      {fmtGBP(plannedAvgDaily)} × {daysLong(workingDays)} days
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-blue-200 font-mono font-bold text-blue-700 text-sm">
                      = {fmtGBP(plannedTotal)}
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      {badge(2, "bg-purple-600")} Avg Daily Production (Actual)
                    </div>
                    <div className="text-slate-500 font-mono">
                      Actual Total ÷ Working Days
                    </div>
                    <div className="mt-1.5 text-slate-400 font-mono">
                      {fmtGBP(actualTotal)} ÷ {daysLong(workingDays)} days
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-blue-200 font-mono font-bold text-blue-700 text-sm">
                      = {fmtGBP(actualAvgDaily)}
                    </div>
                  </div>
                  {/* OCPSPA */}
                  <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                    <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      {badge(6, "bg-purple-600")} OCPSPA Contribution
                    </div>
                    <div className="text-slate-500 font-mono">
                      OCPSPD × Working Days (Actual)
                    </div>
                    <div className="mt-1.5 text-slate-400 font-mono">
                      {fmtGBP(ocpspd)} × {daysLong(workingDays)} days
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-green-200 font-mono font-bold text-green-700 text-sm">
                      = {fmtGBP(ocpspaContrib)}
                    </div>
                  </div>
                </div>

                {/* ── ASSOCIATE DEDUCTIONS ── */}
                <div>
                  <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-1.5">
                    Associate Deductions — from Actual Total Production (
                    {fmtGBP(actualTotal)})
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                      <div className="flex items-center gap-1 font-medium text-slate-700 mb-1">
                        {badge(3, "bg-amber-500")} Assoc. Gross Share
                      </div>
                      <div className="text-slate-400 font-mono">
                        Actual × Assoc Split %
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {fmtGBP(actualTotal)} × {pct(assocSplit)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-amber-200 font-mono font-bold text-amber-700">
                        = {fmtGBP(assocGross)}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                      <div className="flex items-center gap-1 font-medium text-slate-700 mb-1">
                        {badge(4, "bg-amber-500")} Lab Cost Deduction
                      </div>
                      <div className="text-slate-400 font-mono">
                        Actual × Lab % × Lab Split %
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {fmtGBP(actualTotal)} × {pct(labPct)} ×{" "}
                        {pct(assocLabSplit)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-amber-200 font-mono font-bold text-amber-700">
                        = {fmtGBP(labDeduction)}
                      </div>
                    </div>
                    <div className="bg-amber-100 rounded-lg p-2.5 border border-amber-300">
                      <div className="font-medium text-slate-700 mb-1">
                        ★ Associate Net Pay
                      </div>
                      <div className="text-slate-400 font-mono">
                        Gross Share − Lab Deduction
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {fmtGBP(assocGross)} − {fmtGBP(labDeduction)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-amber-300 font-mono font-bold text-amber-800">
                        = {fmtGBP(assocNetPay)}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                      <div className="flex items-center gap-1 font-medium text-slate-700 mb-1">
                        {badge(5, "bg-amber-500")} Cost of Labs (Total)
                      </div>
                      <div className="text-slate-400 font-mono">
                        Actual × Lab Cost %
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {fmtGBP(actualTotal)} × {pct(labPct)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-amber-200 font-mono font-bold text-amber-700">
                        = {fmtGBP(costOfLabs)}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                      <div className="font-medium text-slate-700 mb-1">
                        Materials Cost
                      </div>
                      <div className="text-slate-400 font-mono">
                        Actual × Materials %
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {fmtGBP(actualTotal)} × {pct(matPct)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-amber-200 font-mono font-bold text-amber-700">
                        = {fmtGBP(matCost)}
                      </div>
                    </div>
                  </div>
                  {/* Supplementary metrics row */}
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                      <div className="font-medium text-slate-700 mb-0.5">
                        Avg Lab Cost / Month
                      </div>
                      <div className="text-slate-400 font-mono">
                        (Actual Total ÷ Months in range) × Lab Cost %
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        ({fmtGBP(actualTotal)} ÷ {numberOfMonths} mo) ×{" "}
                        {pct(labPct)}
                      </div>
                      <div className="mt-1 pt-1 border-t border-blue-200 font-mono font-bold text-blue-700">
                        = {fmtGBP(avgLabCostMonth)}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                      <div className="font-medium text-slate-700 mb-0.5">
                        P/L on Room / Day
                      </div>
                      <div className="text-slate-400 font-mono">
                        Actual P/L ÷ Working Days
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {signed(actualPL)} ÷ {daysLong(workingDays)} days
                      </div>
                      <div
                        className={`mt-1 pt-1 border-t border-blue-200 font-mono font-bold ${plOnRoomPerDay >= 0 ? "text-blue-700" : "text-red-600"}`}
                      >
                        = {signed(plOnRoomPerDay)}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                      <div className="font-medium text-slate-700 mb-0.5">
                        P/L % on OCPSPD
                      </div>
                      <div className="text-slate-400 font-mono">
                        (Actual P/L ÷ OCPSPA Contribution) × 100
                      </div>
                      <div className="mt-1 text-slate-400 font-mono">
                        {signed(actualPL)} ÷ {fmtGBP(ocpspaContrib)} × 100
                      </div>
                      <div
                        className={`mt-1 pt-1 border-t border-blue-200 font-mono font-bold ${plPctOnOCPSPD >= 0 ? "text-blue-700" : "text-red-600"}`}
                      >
                        = {plPctOnOCPSPD.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── P/L SUMMARY ── */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-rose-50 rounded-lg p-3 border border-rose-100">
                    <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      {badge(6, "bg-purple-600")} Planned Practice P/L
                    </div>
                    <div className="font-mono space-y-0.5 leading-5">
                      <div className="text-slate-700 font-semibold">
                        {fmtGBP(plannedTotal)}{" "}
                        <span className="text-slate-400 font-normal text-[10px]">
                          (Planned Total)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(assocNetPay)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Assoc Net Pay — actual)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(costOfLabs)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Cost of Labs — actual)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(plannedMaterials)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Materials — planned)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(ocpspaContrib)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (OCPSPA)
                        </span>
                      </div>
                    </div>
                    <div className="text-slate-400 text-[10px] italic mt-1">
                      Assoc & Lab deductions use Actual; Materials uses Planned
                    </div>
                    <div
                      className={`mt-1.5 pt-1.5 border-t border-rose-200 font-mono font-bold text-sm ${plannedPL >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      = {signed(plannedPL)}
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <div className="font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      Actual Practice P/L
                    </div>
                    <div className="font-mono space-y-0.5 leading-5">
                      <div className="text-slate-700 font-semibold">
                        {fmtGBP(actualTotal)}{" "}
                        <span className="text-slate-400 font-normal text-[10px]">
                          (Actual Total)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(assocNetPay)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Assoc Net Pay)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(costOfLabs)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Cost of Labs)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(matCost)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (Materials)
                        </span>
                      </div>
                      <div className="text-slate-500">
                        − {fmtGBP(ocpspaContrib)}{" "}
                        <span className="text-slate-400 text-[10px]">
                          (OCPSPA)
                        </span>
                      </div>
                    </div>
                    <div
                      className={`mt-1.5 pt-1.5 border-t border-slate-200 font-mono font-bold text-sm ${actualPL >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      = {signed(actualPL)}
                    </div>
                    <div className="mt-1 text-slate-500">
                      Variance:{" "}
                      <span
                        className={`font-semibold ${variance >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {signed(variance)}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <div className="font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                      P/L % (Actual vs. Planned)
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="font-medium text-slate-600">
                          Actual P/L %
                        </div>
                        <div className="font-mono text-slate-400 mt-0.5">
                          (Actual P/L ÷ Actual Total) × 100
                        </div>
                        <div className="font-mono text-slate-400">
                          {signed(actualPL)} ÷ {fmtGBP(actualTotal)} × 100
                        </div>
                        <div
                          className={`font-mono font-bold text-base mt-0.5 ${actualPLPct >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {actualPLPct.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-slate-600">
                          Planned P/L %
                        </div>
                        <div className="font-mono text-slate-400 mt-0.5">
                          (Planned P/L ÷ Planned Total) × 100
                        </div>
                        <div className="font-mono text-slate-400">
                          {signed(plannedPL)} ÷ {fmtGBP(plannedTotal)} × 100
                        </div>
                        <div
                          className={`font-mono font-bold text-base mt-0.5 ${plannedPLPct >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {plannedPLPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Associates Working Hours Dialog */}
      <Dialog
        open={showWorkingHoursDialog}
        onOpenChange={setShowWorkingHoursDialog}
      >
        <DialogContent className="sm:max-w-[90vw] max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-lg font-semibold">
              Associates Working Hours
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {isLoadingWHDialog ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              !isLoadingWHDialog &&
              (() => {
                const associates = whDialogAssociates;
                const updateCell = (
                  rowIdx: number,
                  pid: string,
                  field: string,
                  value: string,
                ) => {
                  setWorkingHoursRows((prev) =>
                    prev.map((row, i) => {
                      if (i !== rowIdx) return row;
                      const existing = row.data[pid] ?? {
                        workingDuration: "",
                        workingHoursPerDay: "",
                        udaCount: "",
                      };
                      const updated = { ...existing, [field]: value };
                      if (
                        field === "workingDuration" &&
                        value &&
                        !existing.workingHoursPerDay
                      )
                        updated.workingHoursPerDay = "8";
                      return { ...row, data: { ...row.data, [pid]: updated } };
                    }),
                  );
                };
                const addRow = () =>
                  setWorkingHoursRows((prev) => [
                    ...prev,
                    { month: "", data: {} },
                  ]);
                const removeRow = (idx: number) =>
                  setWorkingHoursRows((prev) =>
                    prev.length === 1
                      ? [{ month: "", data: {} }]
                      : prev.filter((_, i) => i !== idx),
                  );
                return (
                  <table
                    className="border-collapse text-sm"
                    style={{
                      minWidth: `${180 + associates.length * 360 + 80}px`,
                    }}
                  >
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th
                          rowSpan={2}
                          className="sticky left-0 z-20 border border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[160px] min-w-[160px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Month
                        </th>
                        {associates.map((p: any) => (
                          <th
                            key={p.id}
                            colSpan={3}
                            className="border border-border px-3 py-3 text-center text-sm font-semibold whitespace-nowrap"
                            style={{ background: "hsl(var(--muted))" }}
                          >
                            {p.name}
                          </th>
                        ))}
                        <th
                          rowSpan={2}
                          className="border border-border px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[80px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Actions
                        </th>
                      </tr>
                      <tr>
                        {associates.map((p: any) => (
                          <React.Fragment key={p.id}>
                            <th
                              className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                              style={{ background: "hsl(var(--muted) / 0.6)" }}
                            >
                              Working Duration (Hours)
                            </th>
                            <th
                              className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                              style={{ background: "hsl(var(--muted) / 0.6)" }}
                            >
                              Working Hours Per Day
                            </th>
                            <th
                              className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                              style={{ background: "hsl(var(--muted) / 0.6)" }}
                            >
                              UDA Count
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workingHoursRows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className="group hover:bg-muted/20 transition-colors"
                        >
                          <td
                            className="sticky left-0 z-10 border border-border px-3 py-2"
                            style={{ background: "hsl(var(--background))" }}
                          >
                            <DatePicker
                              picker="month"
                              value={row.month ? dayjs(row.month) : null}
                              onChange={(date) =>
                                setWorkingHoursRows((prev) =>
                                  prev.map((r, i) =>
                                    i === rowIdx
                                      ? {
                                          ...r,
                                          month: date
                                            ? date.format("YYYY-MM")
                                            : "",
                                        }
                                      : r,
                                  ),
                                )
                              }
                              format="MMM YYYY"
                              style={{ width: "100%", height: "34px" }}
                              placeholder="Select month"
                            />
                          </td>
                          {associates.map((p: any) => {
                            const pid = p.id;
                            const cell = row.data[pid] ?? {
                              workingDuration: "",
                              workingHoursPerDay: "",
                              udaCount: "",
                            };
                            return (
                              <React.Fragment key={pid}>
                                <td className="border border-border px-2 py-2">
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={cell.workingDuration}
                                    onChange={(e) =>
                                      updateCell(
                                        rowIdx,
                                        pid,
                                        "workingDuration",
                                        e.target.value,
                                      )
                                    }
                                    className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                  />
                                </td>
                                <td className="border border-border px-2 py-2">
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={cell.workingHoursPerDay}
                                    onChange={(e) =>
                                      updateCell(
                                        rowIdx,
                                        pid,
                                        "workingHoursPerDay",
                                        e.target.value,
                                      )
                                    }
                                    className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                  />
                                </td>
                                <td className="border border-border px-2 py-2">
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={cell.udaCount}
                                    onChange={(e) =>
                                      updateCell(
                                        rowIdx,
                                        pid,
                                        "udaCount",
                                        e.target.value,
                                      )
                                    }
                                    className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                  />
                                </td>
                              </React.Fragment>
                            );
                          })}
                          <td className="border border-border px-2 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={addRow}
                                className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors shadow-sm"
                                title="Add row"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              {workingHoursRows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeRow(rowIdx)}
                                  className="w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors shadow-sm"
                                  title="Remove row"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowWorkingHoursDialog(false);
                setWorkingHoursRows([{ month: "", data: {} }]);
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-sidebar hover:bg-sidebar/90 text-white px-8"
              onClick={saveWHWorkingHours}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNhsCountDialog} onOpenChange={setShowNhsCountDialog}>
        <DialogContent className="sm:max-w-[90vw] max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-lg font-semibold">
              Associates NHS Count
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {isLoadingNhsCountDialog ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              !isLoadingNhsCountDialog &&
              (() => {
                const associates = whDialogAssociates;
                const updateCell = (
                  rowIdx: number,
                  pid: string,
                  value: string,
                ) => {
                  setNhsCountRows((prev) =>
                    prev.map((row, i) =>
                      i !== rowIdx
                        ? row
                        : {
                            ...row,
                            data: { ...row.data, [pid]: { count: value } },
                          },
                    ),
                  );
                };
                const addRow = () =>
                  setNhsCountRows((prev) => [...prev, { month: "", data: {} }]);
                const removeRow = (idx: number) =>
                  setNhsCountRows((prev) =>
                    prev.length === 1
                      ? [{ month: "", data: {} }]
                      : prev.filter((_, i) => i !== idx),
                  );
                return (
                  <table
                    className="border-collapse text-sm"
                    style={{
                      minWidth: `${180 + associates.length * 120 + 80}px`,
                    }}
                  >
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th
                          className="sticky left-0 z-20 border border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[160px] min-w-[160px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Month
                        </th>
                        {associates.map((p: any) => (
                          <th
                            key={p.id}
                            className="border border-border px-3 py-3 text-center text-sm font-semibold whitespace-nowrap"
                            style={{ background: "hsl(var(--muted))" }}
                          >
                            {p.name}
                          </th>
                        ))}
                        <th
                          className="border border-border px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[80px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {nhsCountRows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className="group hover:bg-muted/20 transition-colors"
                        >
                          <td
                            className="sticky left-0 z-10 border border-border px-3 py-2"
                            style={{ background: "hsl(var(--background))" }}
                          >
                            <DatePicker
                              picker="month"
                              value={row.month ? dayjs(row.month) : null}
                              onChange={(date) =>
                                setNhsCountRows((prev) =>
                                  prev.map((r, i) =>
                                    i === rowIdx
                                      ? {
                                          ...r,
                                          month: date
                                            ? date.format("YYYY-MM")
                                            : "",
                                        }
                                      : r,
                                  ),
                                )
                              }
                              format="MMM YYYY"
                              style={{ width: "100%", height: "34px" }}
                              placeholder="Select month"
                            />
                          </td>
                          {associates.map((p: any) => {
                            const pid = p.id;
                            const cell = row.data[pid] ?? { count: "" };
                            return (
                              <td
                                key={pid}
                                className="border border-border px-2 py-2"
                              >
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={cell.count}
                                  onChange={(e) =>
                                    updateCell(rowIdx, pid, e.target.value)
                                  }
                                  className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                            );
                          })}
                          <td className="border border-border px-2 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={addRow}
                                className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors shadow-sm"
                                title="Add row"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              {nhsCountRows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeRow(rowIdx)}
                                  className="w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors shadow-sm"
                                  title="Remove row"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowNhsCountDialog(false);
                setNhsCountRows([{ month: "", data: {} }]);
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-sidebar hover:bg-sidebar/90 text-white px-8"
              onClick={() =>
                saveCountRows(
                  nhsCountRows,
                  "uda_count",
                  setShowNhsCountDialog,
                  setNhsCountRows,
                  "NHS count saved successfully.",
                )
              }
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showMosCountDialog} onOpenChange={setShowMosCountDialog}>
        <DialogContent className="sm:max-w-[90vw] max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-lg font-semibold">
              Associates MOS Count
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {isLoadingMosCountDialog ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              !isLoadingMosCountDialog &&
              (() => {
                const associates = whDialogAssociates;
                const updateCell = (
                  rowIdx: number,
                  pid: string,
                  value: string,
                ) => {
                  setMosCountRows((prev) =>
                    prev.map((row, i) =>
                      i !== rowIdx
                        ? row
                        : {
                            ...row,
                            data: { ...row.data, [pid]: { count: value } },
                          },
                    ),
                  );
                };
                const addRow = () =>
                  setMosCountRows((prev) => [...prev, { month: "", data: {} }]);
                const removeRow = (idx: number) =>
                  setMosCountRows((prev) =>
                    prev.length === 1
                      ? [{ month: "", data: {} }]
                      : prev.filter((_, i) => i !== idx),
                  );
                return (
                  <table
                    className="border-collapse text-sm"
                    style={{
                      minWidth: `${180 + associates.length * 120 + 80}px`,
                    }}
                  >
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th
                          className="sticky left-0 z-20 border border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[160px] min-w-[160px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Month
                        </th>
                        {associates.map((p: any) => (
                          <th
                            key={p.id}
                            className="border border-border px-3 py-3 text-center text-sm font-semibold whitespace-nowrap"
                            style={{ background: "hsl(var(--muted))" }}
                          >
                            {p.name}
                          </th>
                        ))}
                        <th
                          className="border border-border px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[80px]"
                          style={{ background: "hsl(var(--muted))" }}
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mosCountRows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className="group hover:bg-muted/20 transition-colors"
                        >
                          <td
                            className="sticky left-0 z-10 border border-border px-3 py-2"
                            style={{ background: "hsl(var(--background))" }}
                          >
                            <DatePicker
                              picker="month"
                              value={row.month ? dayjs(row.month) : null}
                              onChange={(date) =>
                                setMosCountRows((prev) =>
                                  prev.map((r, i) =>
                                    i === rowIdx
                                      ? {
                                          ...r,
                                          month: date
                                            ? date.format("YYYY-MM")
                                            : "",
                                        }
                                      : r,
                                  ),
                                )
                              }
                              format="MMM YYYY"
                              style={{ width: "100%", height: "34px" }}
                              placeholder="Select month"
                            />
                          </td>
                          {associates.map((p: any) => {
                            const pid = p.id;
                            const cell = row.data[pid] ?? { count: "" };
                            return (
                              <td
                                key={pid}
                                className="border border-border px-2 py-2"
                              >
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={cell.count}
                                  onChange={(e) =>
                                    updateCell(rowIdx, pid, e.target.value)
                                  }
                                  className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                            );
                          })}
                          <td className="border border-border px-2 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={addRow}
                                className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors shadow-sm"
                                title="Add row"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              {mosCountRows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeRow(rowIdx)}
                                  className="w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors shadow-sm"
                                  title="Remove row"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowMosCountDialog(false);
                setMosCountRows([{ month: "", data: {} }]);
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-sidebar hover:bg-sidebar/90 text-white px-8"
              onClick={() =>
                saveCountRows(
                  mosCountRows,
                  "mos_count",
                  setShowMosCountDialog,
                  setMosCountRows,
                  "MOS count saved successfully.",
                )
              }
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Production Chart Formula Breakdown */}
      <Dialog
        open={showProductionFormula}
        onOpenChange={setShowProductionFormula}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="w-4 h-4 text-blue-500" />
              How Production is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {/* Horizontal step flow */}
            <div className="flex items-stretch gap-2">
              <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Step 1</p>
                <p className="font-semibold text-foreground text-xs">
                  Production Amount
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Sum of all TPI amounts in the date range
                </p>
              </div>
              <div className="flex items-center text-muted-foreground font-bold text-lg">
                ÷
              </div>
              <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Step 2</p>
                <p className="font-semibold text-foreground text-xs">
                  Days Worked
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Appt Hours ÷ Hours/Day (org setting)
                </p>
              </div>
              <div className="flex items-center text-muted-foreground font-bold text-lg">
                =
              </div>
              <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-500 mb-1">Result</p>
                <p className="font-semibold text-blue-800 text-xs">
                  Avg Daily Production
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Ranking by this (highest = 1st)
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Appointments counted:{" "}
              <span className="font-medium text-foreground">
                Completed, Pending, In Surgery, Confirmed
              </span>
            </p>
            {/* Example */}
            {(() => {
              const ex = (productionMetrics || [])[0];
              if (!ex) return null;
              const exNetProd =
                overviewNetProductionMap.get(ex.provider_name.toLowerCase()) ??
                ex.production_amount;
              const exDays = Number(ex.days_worked);
              const exAvgDaily = exDays > 0 ? exNetProd / exDays : 0;
              return (
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Example — {ex.provider_name}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex-1 bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">Production</p>
                      <p className="font-bold text-foreground">
                        £
                        {exNetProd.toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                    <span className="text-muted-foreground font-bold">÷</span>
                    <div className="flex-1 bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">
                        {exDays.toFixed(1)} days
                      </p>
                      <p className="font-bold text-foreground">worked</p>
                    </div>
                    <span className="text-muted-foreground font-bold">=</span>
                    <div className="flex-1 bg-blue-100 rounded p-2 text-center">
                      <p className="text-blue-600">Avg Daily</p>
                      <p className="font-bold text-blue-800">
                        £
                        {exAvgDaily.toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Avg Utilisation Formula Breakdown */}
      <Dialog
        open={showUtilisationFormula}
        onOpenChange={setShowUtilisationFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-amber-500" />
              Avg Utilisation Formula
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {/* Formula */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-xs text-amber-700 font-mono">
                Total Appt Minutes
              </p>
              <div className="border-t border-amber-300 my-1" />
              <p className="text-xs text-amber-700 font-mono">
                Providers × Working Days × Hours/Day × 60
              </p>
              <p className="text-xs text-amber-600 mt-1">× 100</p>
            </div>
            {/* Key facts */}
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Appointment status:
                </span>{" "}
                Completed, Pending, In Surgery, Confirmed
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Working days:
                </span>{" "}
                Mon–Fri in the selected date range
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">Hours/Day:</span>{" "}
                From org setting (default 8)
              </li>
            </ul>
            {/* This period's ACTUAL numbers (from get_avg_utilisation_breakdown). Falls
                back to a worked example only if the breakdown RPC isn't available. */}
            {utilisationBreakdown &&
            alignedUtil.providerCount > 0 &&
            alignedUtil.workingDays > 0 ? (
              (() => {
                // Use alignedUtil so the count matches the "Total Dentists" tile (producers)
                // and the % is recomputed on that same count — card and tooltip stay in step.
                const {
                  totalMinutes,
                  providerCount,
                  workingDays,
                  hoursPerDay,
                  pct,
                } = alignedUtil;
                const denominator =
                  providerCount * workingDays * hoursPerDay * 60;
                const typeLabel = (
                  displayProviderType || "provider"
                ).toLowerCase();
                return (
                  <div className="bg-muted/50 border rounded-lg p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">
                      This period — {providerCount} {typeLabel}
                      {providerCount === 1 ? "" : "s"}, {workingDays} working
                      days, {hoursPerDay} hrs/day
                    </p>
                    <div className="flex items-center gap-1 text-xs">
                      <div className="flex-1 bg-background rounded p-2 text-center">
                        <p className="text-muted-foreground">Total appt mins</p>
                        <p className="font-bold text-foreground">
                          {Math.round(totalMinutes).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          = {(totalMinutes / 60).toFixed(1)} hrs
                        </p>
                      </div>
                      <span className="text-muted-foreground font-bold">÷</span>
                      <div className="flex-1 bg-background rounded p-2 text-center">
                        <p className="text-muted-foreground">
                          {providerCount}×{workingDays}×{hoursPerDay}×60
                        </p>
                        <p className="font-bold text-foreground">
                          {denominator.toLocaleString()}
                        </p>
                      </div>
                      <span className="text-muted-foreground font-bold">
                        ×100 =
                      </span>
                      <div className="flex-1 bg-amber-100 rounded p-2 text-center">
                        <p className="text-amber-700 font-bold">{pct}%</p>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="bg-muted/50 border rounded-lg p-3">
                <p className="text-xs font-semibold text-foreground mb-2">
                  Example — 3{" "}
                  {(displayProviderType || "provider").toLowerCase()}s, 20
                  working days, 8 hrs/day
                </p>
                <div className="flex items-center gap-1 text-xs">
                  <div className="flex-1 bg-background rounded p-2 text-center">
                    <p className="text-muted-foreground">Total appt mins</p>
                    <p className="font-bold text-foreground">2,880</p>
                  </div>
                  <span className="text-muted-foreground font-bold">÷</span>
                  <div className="flex-1 bg-background rounded p-2 text-center">
                    <p className="text-muted-foreground">3×20×8×60</p>
                    <p className="font-bold text-foreground">28,800</p>
                  </div>
                  <span className="text-muted-foreground font-bold">
                    ×100 =
                  </span>
                  <div className="flex-1 bg-amber-100 rounded p-2 text-center">
                    <p className="text-amber-700 font-bold">10%</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Profit Chart Formula Breakdown */}
      <Dialog open={showProfitFormula} onOpenChange={setShowProfitFormula}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="w-4 h-4 text-blue-500" />
              How Profit is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {/* Row 1: Periodic Profit */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                Periodic Profit
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-foreground">
                    Production
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    TPI total for period
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">−</span>
                <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-foreground">
                    Associate Pay
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Production × Split %
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-blue-800">
                    Periodic Profit
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">
                    Practice keeps this
                  </p>
                </div>
              </div>
            </div>
            {/* Row 2: P/L Per Day & Profit % */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  P/L Per Day
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Periodic Profit</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-xs">
                    ÷
                  </span>
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Days Worked</p>
                    <p className="text-xs text-muted-foreground">
                      Hrs ÷ Hrs/Day
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Profit %
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Periodic Profit</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-xs">
                    ÷
                  </span>
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Production</p>
                    <p className="text-xs text-muted-foreground">× 100</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Example */}
            {(() => {
              const ex = (profitMetrics || [])[0];
              if (!ex) return null;
              const exNetProd =
                overviewNetProductionMap.get(ex.provider_name.toLowerCase()) ??
                (productionMetrics || []).find(
                  (p) => p.provider_name === ex.provider_name,
                )?.production_amount ??
                0;
              const exDays =
                Number(ex.pl_per_day) !== 0
                  ? Math.abs(Number(ex.periodic_profit) / Number(ex.pl_per_day))
                  : 0;
              return (
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Example — {ex.provider_name}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">
                        £
                        {exNetProd.toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        production
                      </p>
                      <p className="font-bold text-foreground">
                        Profit = {formatCurrency(Number(ex.periodic_profit))}
                      </p>
                    </div>
                    <div className="bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">
                        ÷ {exDays.toFixed(1)} days
                      </p>
                      <p className="font-bold text-foreground">
                        P/L Day = {formatCurrency(Number(ex.pl_per_day))}
                      </p>
                    </div>
                    <div className="bg-blue-100 rounded p-2 text-center">
                      <p className="text-blue-600">÷ production × 100</p>
                      <p className="font-bold text-blue-800">
                        Profit % = {Number(ex.profit_percent).toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Associate Profit Performance Formula Breakdown */}
      <Dialog
        open={showAssociateFormula}
        onOpenChange={setShowAssociateFormula}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="w-4 h-4 text-blue-500" />
              How Associate Performance is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {/* Step 1: Daily Production */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                Step 1 — Actual Daily Production
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-foreground">
                    Total Production
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sum of TPI amounts
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">÷</span>
                <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-foreground">
                    Days Worked
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Appt Hours ÷ Hrs/Day
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="font-semibold text-xs text-blue-800">
                    Daily Production
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">Actual £/day</p>
                </div>
              </div>
            </div>
            {/* Step 2: Target Gap & Performance */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Target Gap
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Actual</p>
                    <p className="text-xs text-muted-foreground">£/day</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-xs">
                    −
                  </span>
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Planned</p>
                    <p className="text-xs text-muted-foreground">from Goals</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 px-1">
                  🟢 Positive = above target &nbsp; 🔴 Negative = below
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Performance %
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Actual</p>
                    <p className="text-xs text-muted-foreground">£/day</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-xs">
                    ÷
                  </span>
                  <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                    <p className="font-semibold text-xs">Planned</p>
                    <p className="text-xs text-muted-foreground">× 100</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 px-1">
                  100% = on target. Only shown if target set.
                </p>
              </div>
            </div>
            {/* Example */}
            {(() => {
              const ex = associateMetrics?.[0];
              if (!ex) return null;
              const gapPositive = ex.target_gap >= 0;
              return (
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Example — {ex.provider_name}
                  </p>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">Daily production</p>
                      <p className="font-bold text-foreground">
                        £
                        {Number(ex.daily_production).toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                    <div className="bg-background rounded p-2 text-center">
                      <p className="text-muted-foreground">Planned target</p>
                      <p className="font-bold text-foreground">
                        £
                        {Number(
                          ex.planning_avg_daily_production,
                        ).toLocaleString("en-GB", { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div
                      className={`${gapPositive ? "bg-green-50" : "bg-red-50"} rounded p-2 text-center`}
                    >
                      <p className="text-muted-foreground">Target gap</p>
                      <p
                        className={`font-bold ${gapPositive ? "text-green-700" : "text-red-700"}`}
                      >
                        {gapPositive ? "+" : ""}£
                        {Number(ex.target_gap).toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                    <div className="bg-blue-100 rounded p-2 text-center">
                      <p className="text-blue-600 text-muted-foreground">
                        £
                        {Number(ex.daily_production).toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        ÷ £
                        {Number(
                          ex.planning_avg_daily_production,
                        ).toLocaleString("en-GB", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        ×100
                      </p>
                      <p className="font-bold text-blue-800">
                        {ex.performance_percent != null
                          ? `= ${ex.performance_percent}%`
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
