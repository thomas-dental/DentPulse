import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  GitCompareArrows,
  Info,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePractitionerHistoryList,
  type MonthlyTrend,
} from "@/hooks/usePractitionerHistory";
import {
  useAllProvidersNetProduction,
  tpiUnmappedAmount,
  filterNetProductionByStatus,
  personMatchesProductionStatus,
  PRODUCTION_PROVIDER_STATUS_OPTIONS,
  type ProductionProviderStatus,
} from "@/hooks/useAllProvidersNetProduction";
import { useAllProvidersWorkingHours } from "@/hooks/useAllProvidersWorkingHours";
import {
  CommonFilterDialog,
  CommonFilterValues,
} from "@/components/common/CommonFilterDialog";
import { CancelledAppointmentsDialog } from "@/components/practitioner-history/CancelledAppointmentsDialog";
import { ComparePractitionersDialog } from "@/components/practitioner-history/ComparePractitionersDialog";
import { useFilters } from "@/contexts/FilterContext";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

type SortKey =
  | "name"
  | "totalAppointments"
  | "completed"
  | "attended"
  | "cancelled"
  | "dna"
  | "totalRevenue"
  | "uniquePatients"
  | "totalTreatments"
  | "totalHoursMinutes";
type SortOrder = "asc" | "desc";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATUS_COLORS = {
  completed: "#22c55e",
  attended: "#3b82f6",
  cancelled: "#ef4444",
  dna: "#f59e0b",
};

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// Rounds to the nearest whole hour, rounding up once the leftover minutes
// reach the 30-minute mark (e.g. 7h 35m -> 8h, 7h 20m -> 7h).
const formatHoursRoundedToHour = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${remainder >= 30 ? h + 1 : h}h`;
};

const formatCurrencyRounded = (value: number): string =>
  `£${Math.round(value).toLocaleString("en-GB")}`;

const getInitials = (name: string): string => {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
};

type ChartGranularity = "weekly" | "monthly" | "quarterly";

// usePractitionerHistoryList always buckets its trend rows by day (see that
// hook) — the chart re-aggregates into week/month/quarter buckets here based
// on the toggle, using UTC math throughout to avoid local-timezone drift.
function bucketKey(
  dailyKey: string,
  granularity: ChartGranularity,
): { key: string; label: string } {
  const [y, m, d] = dailyKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));

  if (granularity === "monthly") {
    return {
      key: dailyKey.substring(0, 7),
      label: dt.toLocaleString("default", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    };
  }

  if (granularity === "quarterly") {
    const q = Math.floor(dt.getUTCMonth() / 3) + 1;
    return {
      key: `${dt.getUTCFullYear()}-Q${q}`,
      label: `Q${q} ${dt.getUTCFullYear()}`,
    };
  }

  // weekly — bucket to the Monday starting each ISO week
  const diffToMonday = (dt.getUTCDay() + 6) % 7;
  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() - diffToMonday);
  return {
    key: monday.toISOString().substring(0, 10),
    label: monday.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }),
  };
}

function bucketTrend(
  daily: MonthlyTrend[],
  granularity: ChartGranularity,
): MonthlyTrend[] {
  const map = new Map<string, MonthlyTrend>();
  for (const row of daily) {
    const { key, label } = bucketKey(row.month, granularity);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        month: key,
        monthLabel: label,
        attended: 0,
        cancelled: 0,
        completed: 0,
        dna: 0,
        revenue: 0,
      };
      map.set(key, bucket);
    }
    bucket.attended += row.attended;
    bucket.cancelled += row.cancelled;
    bucket.completed += row.completed;
    bucket.dna += row.dna;
    bucket.revenue += row.revenue;
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Same practitioner history report as the standalone /practitioner-history
 * page (PractitionerHistory.tsx), extracted so it can also be mounted as
 * the "Provider History" tab inside Insights. Deliberately not
 * shared/refactored into one source yet — the standalone page is gated
 * under the practitioner_history module, while this tab lives inside a
 * providers-gated page, so keeping them separate avoids widening access
 * before that's resolved.
 */
function classifyProviderTypeLabel(role: string | null | undefined): string {
  const r = (role || "").toLowerCase();
  if (
    r.includes("dentist") ||
    r.includes("dental surgeon") ||
    r.includes("principal dentist")
  ) {
    return "Associate";
  }
  if (r.includes("hygienist") || r.includes("hygiene")) return "Hygienist";
  if (r.includes("therapist") || r.includes("therapy")) return "Therapist";
  return "Other";
}

export function PractitionerHistoryPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const { dateRange, selectedLocationId } = useFilters();
  const { data, isLoading } = usePractitionerHistoryList();
  const practitioners = data?.practitioners ?? [];
  const monthlyTrend = data?.monthlyTrend ?? [];
  const practitionerTrendsMap = data?.practitionerTrendsMap;
  const totalUniquePatients = data?.totalUniquePatients ?? 0;

  // Same Active / All / Inactive control as Providers → Production Data.
  const [providerStatus, setProviderStatus] =
    useState<ProductionProviderStatus>("all");

  const statusFilteredPractitioners = useMemo(() => {
    if (providerStatus === "all") return practitioners;
    return practitioners.filter((p) =>
      p.isActive === (providerStatus === "active"),
    );
  }, [practitioners, providerStatus]);

  // Total Revenue / Total Hours cards reference the SAME sources as the
  // provider management pages — Net Production raw TPI total (Dentally
  // Practitioner Activity) and Working Hours (appointment_summary). One
  // org-wide fetch (not four role splits) avoids double-counting roles such
  // as "Dental Surgeon" that matched both Dentist and Other.
  const { data: allNetProduction } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
  );
  const { data: allWorkingHours } = useAllProvidersWorkingHours(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
  );
  const [revenueBreakdownView, setRevenueBreakdownView] = useState<
    "treatment" | "provider"
  >("treatment");

  const visibleProduction = useMemo(
    () =>
      filterNetProductionByStatus(allNetProduction?.providers, providerStatus),
    [allNetProduction, providerStatus],
  );

  const visibleHours = useMemo(
    () =>
      (allWorkingHours?.providers ?? []).filter((p) =>
        personMatchesProductionStatus(
          p.providerName,
          providerStatus,
          allNetProduction?.providers,
        ),
      ),
    [allWorkingHours, providerStatus, allNetProduction],
  );

  // `total` = private + membership + nhs (nhs already includes the DentPulse
  // NHS/MOS/UOA rate×count overlay) — this is what the headline card and its
  // breakdown popover must agree on. `rawTotal` is kept separately: it's the
  // unconditional Dentally-reconciling SUM(tpi_price), used only to detect
  // "Other plans" (production on payment plans not tagged Private/Membership/
  // NHS) via tpiUnmappedAmount — mixing the two here previously made the
  // headline silently diverge from Private+Membership+NHS whenever DentPulse-
  // sourced NHS/MOS/UOA income didn't match Dentally's own (often £0) TPI price.
  const netProductionTotals = useMemo(() => {
    return visibleProduction.reduce(
      (acc, p) => {
        acc.total += p.total;
        acc.rawTotal += p.totalRaw;
        acc.private += p.totalPrivate;
        acc.membership += p.totalMembership;
        acc.nhs += p.totalNhs;
        return acc;
      },
      { total: 0, rawTotal: 0, private: 0, membership: 0, nhs: 0 },
    );
  }, [visibleProduction]);

  // Per-practitioner Private/Membership/NHS split, keyed by provider id, for
  // the table's Revenue column tooltip — same net-production source as the
  // Total Revenue Generated card's breakdown above.
  const revenueBreakdownByProviderId = useMemo(() => {
    const map = new Map<
      string,
      { private: number; membership: number; nhs: number; rawTotal: number }
    >();
    for (const p of visibleProduction) {
      // Key by every raw providers.id folded into this person's group, not
      // just the arbitrarily-chosen representative — the roster row shown
      // in the table may point at a different (e.g. multi-location or
      // inactive-duplicate) id than the one useAllProvidersNetProduction
      // picked as representativeId, which silently missed the lookup below.
      for (const id of p.allProviderIds ?? [p.providerId]) {
        // Under "All locations" the same person appears once PER LOCATION
        // (useAllProvidersNetProduction deliberately doesn't merge those —
        // see its "do not re-merge across sites" comment), so most entries
        // are zero except at the location(s) they actually work. Sum rather
        // than overwrite, or whichever location's zero entry runs last
        // clobbers the real figure — this reproduced as the tooltip always
        // reading 0 under "All" while a single-location filter was correct.
        const existing = map.get(id);
        map.set(id, {
          private: (existing?.private ?? 0) + p.totalPrivate,
          membership: (existing?.membership ?? 0) + p.totalMembership,
          nhs: (existing?.nhs ?? 0) + p.totalNhs,
          rawTotal: (existing?.rawTotal ?? 0) + p.totalRaw,
        });
      }
    }
    return map;
  }, [visibleProduction]);

  const revenueByProviderType = useMemo(() => {
    const roleById = new Map(
      practitioners.map((p) => [p.id, p.role] as const),
    );
    const roleByName = new Map(
      practitioners.map((p) => [p.name.trim().toLowerCase(), p.role] as const),
    );
    const totals: Record<string, number> = {
      Associate: 0,
      Hygienist: 0,
      Therapist: 0,
      Other: 0,
    };
    for (const p of visibleProduction) {
      let role: string | undefined;
      for (const id of p.allProviderIds ?? [p.providerId]) {
        role = roleById.get(id);
        if (role) break;
      }
      if (!role) role = roleByName.get(p.providerName.trim().toLowerCase());
      // Use `total` (private + membership + nhs, overlay-inclusive), not
      // `totalRaw` — otherwise this "By provider" split silently sums to a
      // different figure than the headline / "By treatment" breakdown.
      totals[classifyProviderTypeLabel(role)] += p.total;
    }
    return [
      { label: "Associate", revenue: totals.Associate },
      { label: "Hygienist", revenue: totals.Hygienist },
      { label: "Therapist", revenue: totals.Therapist },
      { label: "Other", revenue: totals.Other },
    ];
  }, [visibleProduction, practitioners]);

  const workingHoursTotals = useMemo(() => {
    const roleById = new Map(
      practitioners.map((p) => [p.id, p.role] as const),
    );
    const roleByName = new Map(
      practitioners.map((p) => [p.name.trim().toLowerCase(), p.role] as const),
    );
    const totals: Record<string, number> = {
      Associate: 0,
      Hygienist: 0,
      Therapist: 0,
      Other: 0,
    };
    for (const p of visibleHours) {
      const role =
        roleById.get(p.providerId) ??
        roleByName.get(p.providerName.trim().toLowerCase());
      totals[classifyProviderTypeLabel(role)] += p.total;
    }
    const byProviderType = [
      { label: "Associate", hours: totals.Associate },
      { label: "Hygienist", hours: totals.Hygienist },
      { label: "Therapist", hours: totals.Therapist },
      { label: "Other", hours: totals.Other },
    ];
    const total = byProviderType.reduce((sum, t) => sum + t.hours, 0);
    return { total, byProviderType };
  }, [visibleHours, practitioners]);

  // Hours don't carry an isActive flag of their own — join each provider's
  // hours back to the practitioner roster (matched by provider id) to get
  // the active/inactive split for the tooltip breakdown.
  const workingHoursByStatus = useMemo(() => {
    const isActiveMap = new Map(practitioners.map((p) => [p.id, p.isActive]));
    const isActiveByName = new Map(
      practitioners.map((p) => [p.name.trim().toLowerCase(), p.isActive] as const),
    );
    for (const p of allNetProduction?.providers ?? []) {
      const key = p.providerName.trim().toLowerCase();
      isActiveByName.set(
        key,
        (isActiveByName.get(key) ?? false) || p.isActive,
      );
    }
    let active = 0;
    let inactive = 0;
    for (const p of visibleHours) {
      const isActive =
        isActiveMap.get(p.providerId) ??
        isActiveByName.get(p.providerName.trim().toLowerCase());
      if (isActive === false) inactive += p.total;
      else active += p.total;
    }
    return { active, inactive };
  }, [practitioners, visibleHours, allNetProduction]);
  const [chartPractitioner, setChartPractitioner] = useState<string>("all");
  const [chartGranularity, setChartGranularity] =
    useState<ChartGranularity>("monthly");
  const [cancelledDialogOpen, setCancelledDialogOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);

  // Filter chart data by selected practitioner, then re-bucket the (always
  // daily) trend rows into the selected granularity. "All" respects the
  // Active / Inactive / All filter so appointment bars stay in sync.
  const dailyChartData = useMemo(() => {
    if (chartPractitioner !== "all") {
      return practitionerTrendsMap?.get(chartPractitioner) ?? [];
    }
    if (providerStatus === "all") return monthlyTrend;
    const merged = new Map<string, MonthlyTrend>();
    for (const p of statusFilteredPractitioners) {
      for (const row of practitionerTrendsMap?.get(p.id) ?? []) {
        const existing = merged.get(row.month);
        if (!existing) {
          merged.set(row.month, { ...row });
          continue;
        }
        existing.attended += row.attended;
        existing.cancelled += row.cancelled;
        existing.completed += row.completed;
        existing.dna += row.dna;
        existing.revenue += row.revenue;
      }
    }
    return [...merged.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [
    chartPractitioner,
    providerStatus,
    monthlyTrend,
    practitionerTrendsMap,
    statusFilteredPractitioners,
  ]);
  const chartData = useMemo(
    () => bucketTrend(dailyChartData, chartGranularity),
    [dailyChartData, chartGranularity],
  );
  const chartPractitionerName =
    chartPractitioner === "all"
      ? "All Practitioners"
      : (statusFilteredPractitioners.find((p) => p.id === chartPractitioner)?.name ??
        "All Practitioners");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalRevenue");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tableFilters, setTableFilters] = useState<CommonFilterValues>({
    role: "",
    minRevenue: "",
    maxRevenue: "",
    minAppointments: "",
    maxAppointments: "",
  });

  const roleOptions = useMemo(
    () =>
      [...new Set(statusFilteredPractitioners.map((p) => p.role))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((role) => ({ label: role, value: role })),
    [statusFilteredPractitioners],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
    setCurrentPage(1);
  };

  const filtered = statusFilteredPractitioners
    .filter(
      (p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.role.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .filter((p) => {
      const role = (tableFilters.role as string) || "";
      if (role && p.role !== role) return false;

      const minRevenue = tableFilters.minRevenue as string;
      const maxRevenue = tableFilters.maxRevenue as string;
      if (minRevenue !== "" && p.totalRevenue < Number(minRevenue))
        return false;
      if (maxRevenue !== "" && p.totalRevenue > Number(maxRevenue))
        return false;

      const minAppointments = tableFilters.minAppointments as string;
      const maxAppointments = tableFilters.maxAppointments as string;
      if (
        minAppointments !== "" &&
        p.totalAppointments < Number(minAppointments)
      )
        return false;
      if (
        maxAppointments !== "" &&
        p.totalAppointments > Number(maxAppointments)
      )
        return false;

      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "totalAppointments":
          cmp = a.totalAppointments - b.totalAppointments;
          break;
        case "completed":
          cmp = a.completed - b.completed;
          break;
        case "cancelled":
          cmp = a.cancelled - b.cancelled;
          break;
        case "dna":
          cmp = a.dna - b.dna;
          break;
        case "totalRevenue":
          cmp = a.totalRevenue - b.totalRevenue;
          break;
        case "uniquePatients":
          cmp = a.uniquePatients - b.uniquePatients;
          break;
        case "attended":
          cmp = a.attended - b.attended;
          break;
        case "totalTreatments":
          cmp = a.treatmentCount - b.treatmentCount;
          break;
        case "totalHoursMinutes":
          cmp = a.totalHoursMinutes - b.totalHoursMinutes;
          break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // Reset page when search or pageSize changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };
  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  };

  // Summary metrics
  const totals = statusFilteredPractitioners.reduce(
    (acc, p) => ({
      appointments: acc.appointments + p.totalAppointments,
      completed: acc.completed + p.completed,
      cancelled: acc.cancelled + p.cancelled,
      dna: acc.dna + p.dna,
      patients: acc.patients + p.uniquePatients,
      treatments: acc.treatments + p.treatmentCount,
    }),
    {
      appointments: 0,
      completed: 0,
      cancelled: 0,
      dna: 0,
      patients: 0,
      treatments: 0,
    },
  );

  const SortHeader = ({
    label,
    sortKeyValue,
    className,
  }: {
    label: string;
    sortKeyValue: SortKey;
    className?: string;
  }) => (
    <th
      className={cn(
        "cursor-pointer hover:bg-muted/50 transition-colors",
        className,
      )}
      onClick={() => handleSort(sortKeyValue)}
    >
      <div className="flex items-center justify-center gap-1">
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading practitioner data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            Show Providers
          </span>
          <Select
            value={providerStatus}
            onValueChange={(next) => {
              setProviderStatus(next as ProductionProviderStatus);
              setChartPractitioner("all");
              setCurrentPage(1);
            }}
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
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Users className="w-4 h-4" />
              Practitioners
            </div>
            <p className="text-2xl font-bold">{statusFilteredPractitioners.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Treatments Completed
            </div>
            <p className="text-2xl font-bold text-green-600">
              {totals.completed.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-red-300 transition-colors"
          onClick={() => setCancelledDialogOpen(true)}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              Cancelled
            </div>
            <p className="text-2xl font-bold text-red-600">
              {totals.cancelled.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              DNA
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>Did Not Attend</TooltipContent>
              </UITooltip>
            </div>
            <p className="text-2xl font-bold text-amber-600">
              {totals.dna.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-muted-foreground text-sm mb-1">
              Number of Patients Treated
            </div>
            <p className="text-2xl font-bold">
              {totalUniquePatients.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-muted-foreground text-sm mb-1">
              Number of Treatments Performed
            </div>
            <p className="text-2xl font-bold">
              {totals.treatments.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-1">
              Total Hours Worked
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="p-3">
                  <div className="space-y-3 min-w-[160px]">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                        By provider type
                      </p>
                      {workingHoursTotals.byProviderType.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No data for this period
                        </p>
                      ) : (
                        workingHoursTotals.byProviderType.map(
                          ({ label, hours }) => (
                            <div
                              key={label}
                              className="flex justify-between gap-4 items-center"
                            >
                              <span className="text-xs text-slate-600">
                                {label}
                              </span>
                              <span className="text-xs font-bold text-slate-900">
                                {formatHours(Math.round(hours * 60))}
                              </span>
                            </div>
                          ),
                        )
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                        By status
                      </p>
                      <div className="flex justify-between gap-4 items-center">
                        <span className="text-xs text-slate-600">Active</span>
                        <span className="text-xs font-bold text-slate-900">
                          {formatHours(
                            Math.round(workingHoursByStatus.active * 60),
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4 items-center">
                        <span className="text-xs text-slate-600">
                          Inactive
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {formatHours(
                            Math.round(workingHoursByStatus.inactive * 60),
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </UITooltip>
            </div>
            <p className="text-2xl font-bold">
              {formatHoursRoundedToHour(
                Math.round(workingHoursTotals.total * 60),
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-1">
              Total Revenue Generated
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="Show revenue breakdown">
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="flex items-center gap-1 mb-2 rounded-md bg-muted p-0.5">
                    <button
                      type="button"
                      onClick={() => setRevenueBreakdownView("treatment")}
                      className={cn(
                        "flex-1 text-xs font-medium rounded-sm py-1 transition-colors",
                        revenueBreakdownView === "treatment"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      By treatment
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevenueBreakdownView("provider")}
                      className={cn(
                        "flex-1 text-xs font-medium rounded-sm py-1 transition-colors",
                        revenueBreakdownView === "provider"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      By provider
                    </button>
                  </div>
                  <div className="space-y-1">
                    {revenueBreakdownView === "treatment" ? (
                      <>
                        <div className="flex justify-between gap-4 items-center">
                          <span className="text-xs text-slate-600">
                            Private
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(netProductionTotals.private)}
                          </span>
                        </div>
                        {tpiUnmappedAmount(
                          netProductionTotals.rawTotal,
                          netProductionTotals.private,
                          netProductionTotals.membership,
                          netProductionTotals.nhs,
                        ) > 0.004 ? (
                          <div className="flex justify-between gap-4 items-center">
                            <span className="text-xs text-slate-600">
                              Other plans
                            </span>
                            <span className="text-xs font-bold text-slate-900">
                              {formatCurrency(
                                tpiUnmappedAmount(
                                  netProductionTotals.rawTotal,
                                  netProductionTotals.private,
                                  netProductionTotals.membership,
                                  netProductionTotals.nhs,
                                ),
                              )}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-4 items-center">
                          <span className="text-xs text-slate-600">
                            Membership
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(netProductionTotals.membership)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-center">
                          <span className="text-xs text-slate-600">NHS</span>
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(netProductionTotals.nhs)}
                          </span>
                        </div>
                      </>
                    ) : (
                      revenueByProviderType.map(({ label, revenue }) => (
                        <div
                          key={label}
                          className="flex justify-between gap-4 items-center"
                        >
                          <span className="text-xs text-slate-600">
                            {label}
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(revenue)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrencyRounded(netProductionTotals.total)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Appointment Status Chart with Practitioner Filter */}
      {monthlyTrend.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Appointment Status by{" "}
                {chartGranularity === "weekly"
                  ? "Week"
                  : chartGranularity === "quarterly"
                    ? "Quarter"
                    : "Month"}
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
                  {(["weekly", "monthly", "quarterly"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setChartGranularity(g)}
                      className={cn(
                        "text-xs font-medium rounded-sm px-2.5 py-1 capitalize transition-colors",
                        chartGranularity === g
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-8 gap-2 text-xs">
                      <Filter className="w-3.5 h-3.5" />
                      {chartPractitionerName}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-64 overflow-y-auto"
                  >
                    <DropdownMenuItem
                      onClick={() => setChartPractitioner("all")}
                    >
                      All Practitioners
                    </DropdownMenuItem>
                    {statusFilteredPractitioners.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => setChartPractitioner(p.id)}
                      >
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="completed"
                    name="Completed"
                    fill={STATUS_COLORS.completed}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="cancelled"
                    name="Cancelled"
                    fill={STATUS_COLORS.cancelled}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="dna"
                    name="DNA"
                    fill={STATUS_COLORS.dna}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">
                No appointment data for this practitioner
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search practitioners..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
          <SelectTrigger className="w-[70px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CommonFilterDialog
          title="Practitioner Filters"
          description="Filter practitioners by role, revenue and appointment count."
          triggerLabel="Filters"
          values={tableFilters}
          onApply={(next) => {
            setTableFilters(next);
            setCurrentPage(1);
          }}
          fields={[
            {
              id: "role",
              type: "select",
              label: "Role",
              options: roleOptions,
            },
            {
              id: "revenueRange",
              type: "numberRange",
              label: "Revenue Range",
              minKey: "minRevenue",
              maxKey: "maxRevenue",
              minPlaceholder: "Min revenue",
              maxPlaceholder: "Max revenue",
            },
            {
              id: "appointmentsRange",
              type: "numberRange",
              label: "Total Appointments Range",
              minKey: "minAppointments",
              maxKey: "maxAppointments",
              minPlaceholder: "Min appointments",
              maxPlaceholder: "Max appointments",
            },
          ]}
        />
        <Button
          variant="outline"
          className="h-9 gap-2"
          onClick={() => setCompareDialogOpen(true)}
        >
          <GitCompareArrows className="w-4 h-4" />
          Compare
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          {filtered.length} of {statusFilteredPractitioners.length} practitioners
        </div>
      </div>

      {/* Practitioner Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="bg-muted/50">
                <SortHeader label="Practitioner" sortKeyValue="name" />
                <SortHeader
                  label="Total Appts"
                  sortKeyValue="totalAppointments"
                />
                <SortHeader label="Completed" sortKeyValue="completed" />
                <SortHeader
                  label="Attended w/o patient"
                  sortKeyValue="attended"
                />
                <SortHeader label="Cancelled" sortKeyValue="cancelled" />
                <th
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleSort("dna")}
                >
                  <div className="flex items-center justify-center gap-1">
                    DNA
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Did Not Attend</TooltipContent>
                    </UITooltip>
                    {sortKey === "dna" ? (
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
                <SortHeader label="Patients" sortKeyValue="uniquePatients" />
                <SortHeader label="Treatments" sortKeyValue="totalTreatments" />
                <SortHeader label="Hours" sortKeyValue="totalHoursMinutes" />
                <th
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleSort("totalRevenue")}
                >
                  <div className="flex items-center justify-center gap-1">
                    Revenue
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Includes Private, Membership and NHS revenue — hover a
                        value for the split
                      </TooltipContent>
                    </UITooltip>
                    {sortKey === "totalRevenue" ? (
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
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate(`/practitioner-history/${p.id}`, {
                      state: {
                        from: `${location.pathname}${location.search}`,
                      },
                    })
                  }
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={p.photoUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {p.role}
                      </Badge>
                      {!p.isActive && (
                        <Badge variant="secondary" className="text-xs">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="font-medium text-center">
                    {p.totalAppointments.toLocaleString()}
                  </td>
                  <td className="text-center">
                    <span className="text-green-600 font-medium">
                      {p.completed.toLocaleString()}
                    </span>
                  </td>
                  <td className="text-center">
                    <span
                      className={cn(
                        "font-medium",
                        p.attended > 0 && "text-blue-600",
                      )}
                    >
                      {p.attended.toLocaleString()}
                    </span>
                  </td>
                  <td className="text-center">
                    <span
                      className={cn(
                        "font-medium",
                        p.cancelled > 0 &&
                          "text-red-600 cursor-pointer hover:underline",
                      )}
                      onClick={(e) => {
                        if (p.cancelled > 0) {
                          e.stopPropagation();
                          setCancelledDialogOpen(true);
                        }
                      }}
                    >
                      {p.cancelled.toLocaleString()}
                    </span>
                  </td>
                  <td className="text-center">
                    <span
                      className={cn(
                        "font-medium",
                        p.dna > 0 && "text-amber-600",
                      )}
                    >
                      {p.dna.toLocaleString()}
                    </span>
                  </td>
                  <td className="font-medium text-center">
                    {p.uniquePatients.toLocaleString()}
                  </td>
                  <td className="font-medium text-center">
                    {p.treatmentCount.toLocaleString()}
                  </td>
                  <td className="font-medium text-center">
                    {formatHours(p.totalHoursMinutes)}
                  </td>
                  <td className="font-medium text-center">
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">
                          {formatCurrency(p.totalRevenue)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="p-3">
                        <div className="space-y-1 min-w-[140px]">
                          {(() => {
                            const breakdown = revenueBreakdownByProviderId.get(
                              p.id,
                            );
                            if (!breakdown) {
                              return (
                                <p className="text-xs text-muted-foreground">
                                  No breakdown available
                                </p>
                              );
                            }
                            return (
                              <>
                                <div className="flex justify-between gap-4 items-center">
                                  <span className="text-xs text-slate-600">
                                    Private
                                  </span>
                                  <span className="text-xs font-bold text-slate-900">
                                    {formatCurrency(breakdown.private)}
                                  </span>
                                </div>
                                {tpiUnmappedAmount(
                                  breakdown.rawTotal,
                                  breakdown.private,
                                  breakdown.membership,
                                  breakdown.nhs,
                                ) > 0.004 ? (
                                  <div className="flex justify-between gap-4 items-center">
                                    <span className="text-xs text-slate-600">
                                      Other plans
                                    </span>
                                    <span className="text-xs font-bold text-slate-900">
                                      {formatCurrency(
                                        tpiUnmappedAmount(
                                          breakdown.rawTotal,
                                          breakdown.private,
                                          breakdown.membership,
                                          breakdown.nhs,
                                        ),
                                      )}
                                    </span>
                                  </div>
                                ) : null}
                                <div className="flex justify-between gap-4 items-center">
                                  <span className="text-xs text-slate-600">
                                    Membership
                                  </span>
                                  <span className="text-xs font-bold text-slate-900">
                                    {formatCurrency(breakdown.membership)}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-4 items-center">
                                  <span className="text-xs text-slate-600">
                                    NHS
                                  </span>
                                  <span className="text-xs font-bold text-slate-900">
                                    {formatCurrency(breakdown.nhs)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </TooltipContent>
                    </UITooltip>
                  </td>
                </tr>
              ))}
              {paginatedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No practitioners found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Showing{" "}
              {Math.min((currentPage - 1) * pageSize + 1, filtered.length)}–
              {Math.min(currentPage * pageSize, filtered.length)} of{" "}
              {filtered.length} practitioners
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(1)}
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm px-3">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Cancelled Appointments Dialog */}
      <CancelledAppointmentsDialog
        open={cancelledDialogOpen}
        onOpenChange={setCancelledDialogOpen}
        practitioners={statusFilteredPractitioners}
      />

      {/* Compare Practitioners Dialog */}
      <ComparePractitionersDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        practitioners={statusFilteredPractitioners}
      />
    </div>
  );
}
