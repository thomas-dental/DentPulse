import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { useMembershipProviderLabel } from "@/lib/membershipProviderLabel";
import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/useOrganization";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Calendar,
  Download,
  Loader2,
  AlertTriangle,
  Users,
  Filter,
  ChevronLeft,
  ChevronRight,
  Upload,
  Trash2,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  XCircle,
  Link2,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMembershipPerformance } from "@/hooks/useMembershipPerformance";
import type {
  PlanOverview,
  RiskSignal,
} from "@/hooks/useMembershipPerformance";
import {
  useMembershipUploadData,
  MONTH_NAMES,
} from "@/hooks/useMembershipUploadData";
import type {
  MembershipLocationGroup,
  MembershipUploadMember,
} from "@/hooks/useMembershipUploadData";
import { AccountMultiSelect } from "@/components/settings/AccountMultiSelect";
import {
  useMembershipThresholds,
  getStatusFromMargin,
} from "@/hooks/useMembershipThresholds";
import { MembershipStatementHealthCard } from "@/components/membership/MembershipStatementHealthCard";
import { MembershipTrendsSection } from "@/components/membership/MembershipTrendsSection";
import { PlanMappingDialog } from "@/components/membership/PlanMappingDialog";
import { useMembershipPlanMappings } from "@/hooks/useMembershipPlanMappings";
import { useMembershipAdditionalRevenue } from "@/hooks/useMembershipAdditionalRevenue";
import { MembershipInsightsTabs } from "@/components/membership/insights/MembershipInsightsTabs";

function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  // Accept YYYY-MM-DD or anything Date can parse
  const m = String(dob)
    .slice(0, 10)
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let birth: Date;
  if (m) {
    birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    birth = new Date(dob);
  }
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 150 ? age : null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(0)}k`;
  return formatCurrency(amount);
}

/** One figure on a plan card: sentence-case label (+ optional info tooltip),
 *  value, optional caption. Labels reserve a fixed two-line height so a
 *  wrapping label (e.g. "Additional income") doesn't push its value out of
 *  line with a neighbouring one-line label in the same grid row. */
function PlanStat({
  label,
  tooltip,
  value,
  valueClassName,
  caption,
}: {
  label: string;
  tooltip?: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  caption?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1 min-h-[2rem]">
        <span className="text-muted-foreground text-xs leading-tight">
          {label}
        </span>
        {tooltip && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0 cursor-default" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px]">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className={cn("font-bold text-lg break-words", valueClassName)}>
        {value}
      </div>
      {caption && (
        <span className="text-xs text-muted-foreground">{caption}</span>
      )}
    </div>
  );
}

function TrendIndicator({ value, label }: { value: number; label?: string }) {
  if (value === 0)
    return <span className="text-sm text-muted-foreground">-- {label}</span>;
  const isUp = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        isUp ? "text-emerald-600" : "text-red-500",
      )}
    >
      <span className="text-base">{isUp ? "↗" : "↘"}</span>
      <span className="font-medium">
        {isUp ? "+" : ""}
        {value.toFixed(1)}%
      </span>
      {label && (
        <span className="text-muted-foreground font-normal">{label}</span>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: PlanOverview["status"] }) {
  const config = {
    Profitable:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    "At Risk":
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    "Loss-Making":
      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  };
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
        config[status],
      )}
    >
      {status}
    </span>
  );
}

function MarginImpactBadge({
  impact,
}: {
  impact: "Healthy" | "Watch" | "Concern";
}) {
  const config = {
    Healthy: "text-emerald-600",
    Watch: "text-amber-600",
    Concern: "text-red-600",
  };
  return (
    <span className={cn("text-sm font-medium", config[impact])}>{impact}</span>
  );
}

function PlanCard({
  plan,
  onClick,
}: {
  plan: PlanOverview;
  onClick?: () => void;
}) {
  const borderColor =
    plan.status === "Profitable"
      ? "border-t-emerald-500"
      : plan.status === "At Risk"
        ? "border-t-amber-500"
        : "border-t-red-500";

  return (
    <Card
      className={cn(
        "border-t-4 transition-shadow",
        borderColor,
        onClick && "cursor-pointer hover:shadow-md",
      )}
      onClick={onClick}
    >
      <CardContent className="pt-5 pb-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: plan.color }}
            />
            <span className="font-semibold">{plan.planName}</span>
          </div>
          <StatusBadge status={plan.status} />
        </div>

        {/* Members + Tenure */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {plan.members} members
          </span>
          <span>Avg {plan.avgTenureMonths} months</span>
        </div>

        {/* Revenue / Costs */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Revenue
            </span>
            <div className="font-bold text-lg">
              {formatCurrency(plan.revenuePerMonth)}
            </div>
            <span className="text-xs text-muted-foreground">/ month</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Costs
            </span>
            <div className="font-bold text-lg">
              {formatCurrency(plan.costsPerMonth)}
            </div>
            <span className="text-xs text-muted-foreground">/ month</span>
          </div>
        </div>

        {/* Net Profit / Utilisation */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Net Profit
            </span>
            <div
              className={cn(
                "font-bold text-lg",
                plan.netProfit >= 0 ? "text-foreground" : "text-red-600",
              )}
            >
              {plan.netProfit < 0
                ? `${formatCurrency(Math.abs(plan.netProfit))} loss`
                : formatCurrency(plan.netProfit)}
            </div>
            <span className="text-xs text-muted-foreground">
              ({plan.netProfitPct}%)
            </span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Utilisation
            </span>
            <div className="font-bold text-lg">{plan.utilisation}%</div>
            <span className="text-xs text-muted-foreground">
              of benefits used
            </span>
          </div>
        </div>

        {/* Benefit utilisation bar */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Benefit utilisation</span>
            <span>{plan.utilisation}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                plan.utilisation >= 90
                  ? "bg-red-500"
                  : plan.utilisation >= 70
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{ width: `${Math.min(plan.utilisation, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RiskSignalCard({ signal }: { signal: RiskSignal }) {
  const isCritical = signal.severity === "Critical";
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        isCritical
          ? "border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle
          className={cn(
            "w-4 h-4",
            isCritical ? "text-red-500" : "text-amber-500",
          )}
        />
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: signal.color }}
        />
        <span className="font-semibold">{signal.planName}</span>
        {isCritical && (
          <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-semibold">
            Critical
          </span>
        )}
      </div>
      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-6">
        {signal.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function MembershipPerformance() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  // Membership provider display name (Denplan default; Practice Plan for The Old Surgery)
  const providerLabel = useMembershipProviderLabel();
  const {
    summary,
    planOverviews,
    treatmentConsumption,
    riskSignals,
    isLoading,
    hasCostData,
  } = useMembershipPerformance();
  const thresholds = useMembershipThresholds();

  const {
    members: uploadedMembers,
    planSummary: uploadPlanSummary,
    totalRevenue: uploadTotalRevenue,
    totalMembers: uploadTotalMembers,
    isLoading: isUploadLoading,
    hasAnyUpload,
    uploadSource,
    membersError,
    refetchMembers,
    displayMonth,
    isShowingFallbackMonth,
    isShowingFallbackLocation,
    selectedMonth,
    selectedYear,
    previewRows,
    previewPlanSummary,
    previewTotalRevenue,
    previewTotalMembers,
    parseErrors,
    validSurnames,
    surnamePatientIdMap,
    isValidating,
    handleFileSelect,
    cancelPreview,
    importMonth,
    importYear,
    setImportMonth,
    setImportYear,
    importLocationId,
    setImportLocationId,
    practiceLocations,
    confirmImport,
    isImporting,
    clearData,
    isClearing,
    availablePlans,
    feeCategoryPlanMap,
    setFeeCategoryPlan,
    unmappedFeeCategories,
    rowPlanMatches,
    membersByLocation,
    isLocationSplitFetching,
    isImportSummaryOpen,
    openImportSummary,
    closeImportSummary,
    detectedFacilities,
    upsertFacilityMapping,
    deleteFacilityMapping,
    isSavingFacilityMapping,
    allActivePlans,
  } = useMembershipUploadData();

  // Practice Plan statement plan → Dentally payment plan(s), for resolving
  // "Additional Revenue" below (same table the Plan Mapping dialog writes).
  const { mappings: planMappings } = useMembershipPlanMappings();

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate hidden input for Practice Plan statement PDFs — both inputs feed
  // the same handleFileChange; the hook routes parsing by file extension.
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Statement plan ↔ Dentally payment plan mapping settings dialog
  const [planMappingOpen, setPlanMappingOpen] = useState(false);
  // Practice Plan statement fee-categories are plans in their own right (no
  // payment_plans row) — the mapping dialog assigns each a Dentally plan.
  const statementPlanLabels = useMemo(
    () =>
      uploadPlanSummary
        .filter((p) => p.is_practice_plan)
        .map((p) => p.fee_category),
    [uploadPlanSummary],
  );

  // ── Upload source: a ONE-TIME choice ─────────────────────────────────────
  // The first-visit chooser asks which source the practice has — a membership
  // plan sheet (Excel/CSV) or a Practice Plan monthly statement (PDF). Once
  // known, the Upload button opens the matching file picker DIRECTLY and the
  // chooser never reappears. The source is derived from already-uploaded data
  // (uploadSource, from the DB) and, before the first import completes, from
  // the choice made in the popup (persisted per-org in localStorage).
  type UploadSource = "practice-plan" | "sheet";
  const sourceStorageKey = organizationId
    ? `membership-upload-source:${organizationId}`
    : null;
  const [chosenSource, setChosenSource] = useState<UploadSource | null>(null);
  useEffect(() => {
    if (!sourceStorageKey) return;
    const stored = localStorage.getItem(sourceStorageKey);
    setChosenSource(
      stored === "practice-plan" || stored === "sheet" ? stored : null,
    );
  }, [sourceStorageKey]);
  const effectiveSource: UploadSource | null = uploadSource ?? chosenSource;

  const [uploadChooserDismissed, setUploadChooserDismissed] = useState(false);
  const [chooserManuallyOpen, setChooserManuallyOpen] = useState(false);
  const showUploadChooser =
    chooserManuallyOpen ||
    (hasAnyUpload === false &&
      !effectiveSource &&
      !uploadChooserDismissed &&
      !previewRows &&
      !isValidating);
  const closeUploadChooser = () => {
    setUploadChooserDismissed(true);
    setChooserManuallyOpen(false);
  };

  const openSourcePicker = (source: UploadSource) => {
    (source === "practice-plan" ? pdfInputRef : fileInputRef).current?.click();
  };
  // Popup choice → remember it and open the right picker straight away.
  const pickSource = (source: UploadSource) => {
    setChosenSource(source);
    if (sourceStorageKey) localStorage.setItem(sourceStorageKey, source);
    closeUploadChooser();
    openSourcePicker(source);
  };
  // Upload button: direct picker when the source is known; otherwise (org has
  // no data and never chose) fall back to the chooser.
  const handleUploadClick = () => {
    if (effectiveSource) openSourcePicker(effectiveSource);
    else setChooserManuallyOpen(true);
  };

  // Denplan facility mapping — inline editor state. Only one facility is
  // editable at a time to keep the preview dialog compact.
  const [editingFacilityId, setEditingFacilityId] = useState<string | null>(
    null,
  );
  const [facilityForm, setFacilityForm] = useState<{
    product_name: string;
    dentist_name: string;
    payment_plan_ids: string[];
  }>({ product_name: "", dentist_name: "", payment_plan_ids: [] });

  const openFacilityEditor = (facilityId: string) => {
    const existing = detectedFacilities.find(
      (f) => f.facility_id === facilityId,
    )?.mapping;
    setFacilityForm({
      product_name: existing?.product_name ?? "",
      dentist_name: existing?.dentist_name ?? "",
      payment_plan_ids: existing?.payment_plan_ids ?? [],
    });
    setEditingFacilityId(facilityId);
  };

  const saveFacilityEditor = () => {
    if (!editingFacilityId || !facilityForm.product_name.trim()) return;
    upsertFacilityMapping({
      facility_id: editingFacilityId,
      product_name: facilityForm.product_name.trim(),
      dentist_name: facilityForm.dentist_name.trim() || null,
      payment_plan_ids: facilityForm.payment_plan_ids,
    });
    setEditingFacilityId(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      handleFileSelect(files);
      e.target.value = "";
    }
  };

  // Only show plans from uploaded sheet — match to DB plan via the per-row
  // fee_category → plan mapping chosen at import time. Falls back to
  // fee_category name match for legacy rows without a mapping.
  const mergedPlanOverviews = useMemo(() => {
    if (uploadPlanSummary.length === 0)
      return [] as Array<
        PlanOverview & { feeCategory: string; mappedPlanName: string | null }
      >;

    // DB plan lookups — by id and by lowercased name
    const dbPlanById = new Map<string, PlanOverview>();
    const dbPlanByName = new Map<string, PlanOverview>();
    for (const p of planOverviews) {
      dbPlanById.set(p.planId, p);
      dbPlanByName.set(p.planName.toLowerCase(), p);
    }

    return uploadPlanSummary.map((ps) => {
      const matched =
        (ps.mapped_plan_id ? dbPlanById.get(ps.mapped_plan_id) : undefined) ??
        (ps.mapped_plan_name
          ? dbPlanByName.get(ps.mapped_plan_name.toLowerCase())
          : undefined) ??
        dbPlanByName.get(ps.fee_category.toLowerCase());

      const revenuePerMonth = Math.round(ps.total_net_due);
      const costsPerMonth = matched?.costsPerMonth ?? 0;
      const netProfit = revenuePerMonth - costsPerMonth;
      const netProfitPct =
        revenuePerMonth > 0 ? (netProfit / revenuePerMonth) * 100 : 0;
      const utilisation =
        revenuePerMonth > 0
          ? Math.min(100, Math.round((costsPerMonth / revenuePerMonth) * 100))
          : 0;
      const status = getStatusFromMargin(netProfitPct, thresholds);

      return {
        planId: matched?.planId ?? ps.fee_category,
        planName: ps.fee_category,
        feeCategory: ps.fee_category,
        mappedPlanName: ps.mapped_plan_name ?? matched?.planName ?? null,
        color: matched?.color ?? "#8b5cf6",
        members: ps.members,
        avgTenureMonths: matched?.avgTenureMonths ?? 0,
        revenuePerMonth,
        costsPerMonth,
        netProfit: Math.round(netProfit),
        netProfitPct: Math.round(netProfitPct),
        utilisation,
        monthlyFee: matched?.monthlyFee ?? 0,
        status,
      };
    });
  }, [planOverviews, uploadPlanSummary, thresholds]);

  // Additional Revenue — the extra treatment revenue each plan's members
  // generate beyond their subscription, sourced from Dentally (same figure
  // Practitioner Activity's Price total shows when filtered to that
  // Payment Plan). Practice Plan statement cards resolve their Dentally
  // plan(s) via the Plan Mapping dialog (membership_plan_mappings); regular
  // sheet-upload cards already carry their own resolved plan.
  const planPaymentPlanIdsByLabel = useMemo(() => {
    const byLabel: Record<string, string[]> = {};
    for (const ps of uploadPlanSummary) {
      if (ps.is_practice_plan) {
        const mapping = planMappings.find((m) => m.plan_label === ps.fee_category);
        byLabel[ps.fee_category] = mapping?.payment_plan_ids ?? [];
      } else {
        const matched = mergedPlanOverviews.find(
          (p) => p.feeCategory === ps.fee_category,
        );
        byLabel[ps.fee_category] = ps.mapped_plan_id
          ? [ps.mapped_plan_id]
          : matched?.planId
            ? [matched.planId]
            : [];
      }
    }
    return byLabel;
  }, [uploadPlanSummary, planMappings, mergedPlanOverviews]);

  const { data: additionalRevenueByLabel, isLoading: isLoadingAdditionalRevenue } =
    useMembershipAdditionalRevenue(planPaymentPlanIdsByLabel);

  // Summary driven entirely by uploaded data + TPI costs
  const mergedSummary = useMemo(() => {
    if (uploadPlanSummary.length === 0) {
      return {
        ...summary,
        totalMembers: 0,
        monthlyRevenue: 0,
        monthlyCosts: 0,
        netProfit: 0,
        avgMarginPct: 0,
      };
    }
    const totalMembers = uploadTotalMembers;
    const monthlyRevenue = Math.round(uploadTotalRevenue);
    const monthlyCosts = mergedPlanOverviews.reduce(
      (s, p) => s + p.costsPerMonth,
      0,
    );
    const netProfit = monthlyRevenue - monthlyCosts;
    const avgMarginPct =
      monthlyRevenue > 0 ? (netProfit / monthlyRevenue) * 100 : 0;
    return {
      ...summary,
      totalMembers,
      monthlyRevenue: Math.round(monthlyRevenue),
      monthlyCosts: Math.round(monthlyCosts),
      netProfit: Math.round(netProfit),
      avgMarginPct: Math.round(avgMarginPct),
    };
  }, [
    mergedPlanOverviews,
    summary,
    uploadPlanSummary,
    uploadTotalMembers,
    uploadTotalRevenue,
  ]);

  // Plan-wise summary from actual treatment consumption data
  // "Treatment cost" to the plan = TPI prices (revenuePerUnit) of treatments consumed by members
  // "Plan revenue" = subscription fees (from upload net_due, or members × monthlyFee)
  const planSimpleBreakdown = useMemo(() => {
    // Build per-plan aggregates from treatmentConsumption (only rows with actual TPI data)
    const byPlan = new Map<
      string,
      { treatmentCost: number; chairTimeHrs: number; treatmentCount: number }
    >();
    for (const tc of treatmentConsumption) {
      if (tc.treatmentCount === 0) continue;
      const existing = byPlan.get(tc.plan) ?? {
        treatmentCost: 0,
        chairTimeHrs: 0,
        treatmentCount: 0,
      };
      // revenuePerUnit = tpi_price per unit — this is the cost TO the plan (value of treatments given to members)
      existing.treatmentCost += tc.revenuePerUnit * tc.treatmentCount;
      existing.chairTimeHrs += tc.totalDurationMinutes / 60;
      existing.treatmentCount += tc.treatmentCount;
      byPlan.set(tc.plan, existing);
    }

    // Merge with planOverviews for subscription revenue + uploaded revenue
    const planMap = new Map<string, PlanOverview>();
    for (const p of planOverviews) planMap.set(p.planName, p);

    // Use uploaded plan revenue (net_due) when available, otherwise subscription fees
    // Track revenue by display label (fee_category) and the DB plan name to
    // join against treatment consumption.
    const uploadRevenueByLabel = new Map<string, number>();
    const labelToDbPlanName = new Map<string, string | null>();
    for (const ps of uploadPlanSummary) {
      uploadRevenueByLabel.set(ps.fee_category, ps.total_net_due);
      labelToDbPlanName.set(ps.fee_category, ps.mapped_plan_name ?? null);
    }

    const result: Array<{
      plan: string;
      treatmentCost: number;
      planRevenue: number;
      chairTimeHrs: number;
      treatmentCount: number;
    }> = [];

    // Only show plans from the uploaded sheet. When no upload data exists
    // the chart stays empty — matches the "No data uploaded yet" empty state
    // on the Plan Revenue card above.
    const allPlanNames = new Set<string>();
    for (const ps of uploadPlanSummary) allPlanNames.add(ps.fee_category);

    for (const planName of allPlanNames) {
      // If this label is an uploaded fee_category, look up treatment data
      // via its mapped DB plan name; otherwise the label IS the DB plan name.
      const dbKey = labelToDbPlanName.get(planName) ?? planName;
      const agg = byPlan.get(dbKey);
      const overview = planMap.get(dbKey);
      const uploadRevenue = uploadRevenueByLabel.get(planName);
      const subscriptionFees =
        (overview?.members ?? 0) * (overview?.monthlyFee ?? 0);
      const revenue = uploadRevenue ?? subscriptionFees;

      result.push({
        plan: planName,
        treatmentCost: -Math.round(agg?.treatmentCost ?? 0), // negative for left side (cost to plan)
        planRevenue: Math.round(revenue), // positive for right side
        chairTimeHrs: Math.round((agg?.chairTimeHrs ?? 0) * 10) / 10,
        treatmentCount: agg?.treatmentCount ?? 0,
      });
    }

    return result;
  }, [treatmentConsumption, planOverviews, uploadPlanSummary]);

  // Use upload-based detailed breakdown when available

  // Preview pagination
  const [previewPage, setPreviewPage] = useState(1);
  const PREVIEW_PAGE_SIZE = 10;
  const previewTotalPages = previewRows
    ? Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE))
    : 1;
  const paginatedPreview = previewRows
    ? previewRows.slice(
        (previewPage - 1) * PREVIEW_PAGE_SIZE,
        previewPage * PREVIEW_PAGE_SIZE,
      )
    : [];

  const [consumptionPlanFilter, setConsumptionPlanFilter] =
    useState<string>("all");
  const [consumptionPage, setConsumptionPage] = useState(1);
  const [consumptionPageSize, setConsumptionPageSize] = useState(10);

  // Only show data for plans that exist in the uploaded sheet
  const uploadedPlanNames = useMemo(() => {
    return new Set(uploadPlanSummary.map((p) => p.fee_category));
  }, [uploadPlanSummary]);

  const filteredRiskSignals = useMemo(() => {
    if (uploadedPlanNames.size === 0) return [];
    return riskSignals.filter((s) => uploadedPlanNames.has(s.planName));
  }, [riskSignals, uploadedPlanNames]);

  const filteredConsumption = useMemo(() => {
    // Filter to uploaded plans only, then apply plan dropdown filter
    const uploadFiltered =
      uploadedPlanNames.size > 0
        ? treatmentConsumption.filter((t) => uploadedPlanNames.has(t.plan))
        : [];
    const rows =
      consumptionPlanFilter === "all"
        ? uploadFiltered
        : uploadFiltered.filter(
            (t) => t.plan === consumptionPlanFilter && t.treatmentCount > 0,
          );

    // Aggregate by treatment name+code so each unique treatment appears once
    const map = new Map<
      string,
      {
        treatment: string;
        treatmentCode: string;
        categoryName: string;
        treatmentCountSum: number;
        planMembersSum: number;
        totalCostSum: number;
        revenueSum: number;
        marginSum: number;
        materialCostSum: number;
        labBillSum: number;
        therapistPaySum: number;
        operatingCostSum: number;
        associatePaySum: number;
        financeFeeSum: number;
        durationMinutesSum: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.treatment}::${row.treatmentCode}`;
      const existing = map.get(key);
      if (existing) {
        existing.treatmentCountSum += row.treatmentCount;
        existing.planMembersSum += row.planMembers;
        existing.totalCostSum += row.costPerUnit * row.treatmentCount;
        existing.revenueSum += row.revenuePerUnit * row.treatmentCount;
        existing.marginSum += row.totalMargin;
        existing.materialCostSum += row.materialCost * row.treatmentCount;
        existing.labBillSum += row.labBill * row.treatmentCount;
        existing.therapistPaySum += row.therapistPay * row.treatmentCount;
        existing.operatingCostSum += row.operatingCost * row.treatmentCount;
        existing.associatePaySum += row.associatePay * row.treatmentCount;
        existing.financeFeeSum += row.financeFee * row.treatmentCount;
        existing.durationMinutesSum += row.durationMinutes * row.treatmentCount;
      } else {
        map.set(key, {
          treatment: row.treatment,
          treatmentCode: row.treatmentCode,
          categoryName: row.categoryName,
          treatmentCountSum: row.treatmentCount,
          planMembersSum: row.planMembers,
          totalCostSum: row.costPerUnit * row.treatmentCount,
          revenueSum: row.revenuePerUnit * row.treatmentCount,
          marginSum: row.totalMargin,
          materialCostSum: row.materialCost * row.treatmentCount,
          labBillSum: row.labBill * row.treatmentCount,
          therapistPaySum: row.therapistPay * row.treatmentCount,
          operatingCostSum: row.operatingCost * row.treatmentCount,
          associatePaySum: row.associatePay * row.treatmentCount,
          financeFeeSum: row.financeFee * row.treatmentCount,
          durationMinutesSum: row.durationMinutes * row.treatmentCount,
        });
      }
    }

    return Array.from(map.values()).map((item) => {
      const avgUsagePerMember =
        item.planMembersSum > 0
          ? +(item.treatmentCountSum / item.planMembersSum).toFixed(1)
          : 0;
      const costPerUnit =
        item.treatmentCountSum > 0
          ? item.totalCostSum / item.treatmentCountSum
          : 0;
      const revenuePerUnit =
        item.treatmentCountSum > 0
          ? item.revenueSum / item.treatmentCountSum
          : 0;
      const marginPerUnit = revenuePerUnit - costPerUnit;
      const marginPct =
        revenuePerUnit > 0
          ? (marginPerUnit / revenuePerUnit) * 100
          : costPerUnit > 0
            ? -100
            : 0;
      const marginImpact: "Healthy" | "Watch" | "Concern" =
        marginPct < 0 ? "Concern" : marginPct <= 20 ? "Watch" : "Healthy";
      const count = item.treatmentCountSum;
      return {
        treatment: item.treatment,
        treatmentCode: item.treatmentCode,
        categoryName: item.categoryName,
        treatmentCount: count,
        planMembers: item.planMembersSum,
        avgUsagePerMember,
        costPerUnit: Math.round(costPerUnit * 100) / 100,
        revenuePerUnit: Math.round(revenuePerUnit * 100) / 100,
        marginPerUnit: Math.round(marginPerUnit * 100) / 100,
        totalMargin: Math.round(item.marginSum),
        marginPct: Math.round(marginPct),
        marginImpact,
        // Individual cost components (per unit)
        materialCost:
          count > 0
            ? Math.round((item.materialCostSum / count) * 100) / 100
            : 0,
        labBill:
          count > 0 ? Math.round((item.labBillSum / count) * 100) / 100 : 0,
        therapistPay:
          count > 0
            ? Math.round((item.therapistPaySum / count) * 100) / 100
            : 0,
        operatingCost:
          count > 0
            ? Math.round((item.operatingCostSum / count) * 100) / 100
            : 0,
        associatePay:
          count > 0
            ? Math.round((item.associatePaySum / count) * 100) / 100
            : 0,
        financeFee:
          count > 0 ? Math.round((item.financeFeeSum / count) * 100) / 100 : 0,
        durationMinutes:
          count > 0 ? Math.round(item.durationMinutesSum / count) : 0,
        totalDurationMinutes: Math.round(item.durationMinutesSum),
      };
    });
  }, [treatmentConsumption, consumptionPlanFilter]);

  const totalConsumptionPages = Math.max(
    1,
    Math.ceil(filteredConsumption.length / consumptionPageSize),
  );
  const safePage = Math.min(consumptionPage, totalConsumptionPages);
  const paginatedConsumption = filteredConsumption.slice(
    (safePage - 1) * consumptionPageSize,
    safePage * consumptionPageSize,
  );

  const summaryCards = [
    {
      label: "TOTAL MEMBERS",
      value: mergedSummary.totalMembers.toLocaleString(),
      trend: mergedSummary.membersTrend,
      trendLabel: "vs last year",
      color: "text-foreground",
    },
    {
      label: "MONTHLY REVENUE",
      value: formatCurrency(mergedSummary.monthlyRevenue),
      trend: mergedSummary.revenueTrend,
      trendLabel: "vs last year",
      color: "text-foreground",
    },
    {
      label: "MONTHLY COSTS",
      value: formatCurrency(mergedSummary.monthlyCosts),
      trend: mergedSummary.costsTrend,
      trendLabel: hasCostData ? "vs last year" : "no accounting platform connected",
      color: "text-foreground",
    },
    {
      label: "NET PROFIT",
      value: formatCurrency(mergedSummary.netProfit),
      trend: 0,
      trendLabel: hasCostData ? `${mergedSummary.avgMarginPct}% avg margin` : "costs unavailable — revenue only",
      color: mergedSummary.netProfit >= 0 ? "text-emerald-600" : "text-red-600",
    },
  ];

  // Build AI context — compact plan rows, top/bottom by retention/profit
  const aiPlans = (mergedPlanOverviews || []).slice(0, 60).map((p) => ({
    planName: p.planName,
    feeCategory: (p as any).feeCategory ?? p.planName,
    mappedPlanName: (p as any).mappedPlanName ?? null,
    members: p.members,
    monthlyRevenue: Math.round(p.revenuePerMonth || 0),
    monthlyCosts: Math.round(p.costsPerMonth || 0),
    netProfit: Math.round(p.netProfit || 0),
    netProfitPercent: p.netProfitPct,
    utilisationPercent: p.utilisation,
    avgTenureMonths: p.avgTenureMonths,
    monthlyFee: p.monthlyFee,
    status: p.status,
  }));
  const topPlansByProfit = [...aiPlans]
    .sort((a, b) => b.netProfit - a.netProfit)
    .slice(0, 10);
  const bottomPlansByProfit = [...aiPlans]
    .sort((a, b) => a.netProfit - b.netProfit)
    .slice(0, 10);
  const topPlansByMembers = [...aiPlans]
    .sort((a, b) => b.members - a.members)
    .slice(0, 10);

  const aiTreatmentConsumption = (filteredConsumption || [])
    .slice(0, 60)
    .map((t) => ({
      treatment: t.treatment,
      category: t.categoryName,
      treatmentCount: t.treatmentCount,
      revenuePerUnit: t.revenuePerUnit,
      costPerUnit: t.costPerUnit,
      marginPerUnit: t.marginPerUnit,
      marginPercent: t.marginPct,
      marginImpact: t.marginImpact,
      avgUsagePerMember: t.avgUsagePerMember,
    }));

  const aiContextData = {
    page: "membership-performance",
    selectedLocationName: "All Locations",
    period: {
      month: selectedMonth ?? null,
      year: selectedYear ?? null,
    },
    summary: {
      totalMembers: mergedSummary.totalMembers,
      monthlyRevenue: mergedSummary.monthlyRevenue,
      monthlyCosts: mergedSummary.monthlyCosts,
      netProfit: mergedSummary.netProfit,
      avgMarginPercent: mergedSummary.avgMarginPct,
    },
    planCount: mergedPlanOverviews?.length ?? 0,
    plans: aiPlans,
    topPlansByProfit,
    bottomPlansByProfit,
    topPlansByMembers,
    treatmentConsumptionCount: filteredConsumption?.length ?? 0,
    treatmentConsumption: aiTreatmentConsumption,
    riskSignals: (filteredRiskSignals || []).slice(0, 20).map((r) => ({
      planName: r.planName,
      severity: r.severity,
      items: r.items?.slice(0, 10) ?? [],
    })),
  };

  if (isLoading) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <Helmet>
          <title>Membership | DentPulse</title>
        </Helmet>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>Membership Performance | DentPulse</title>
      </Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">
              Treatment
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Membership</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Membership Performance</h1>
              <p className="text-muted-foreground">
                Plan-wise revenue, costs, profitability and utilisation analysis
              </p>
            </div>
            {/* <Link to="/treatments/membership/comparison">
              <Button variant="outline" size="sm" className="gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Compare Months
              </Button>
            </Link> */}
          </div>
        </div>

        <MembershipInsightsTabs
          planRevenueContent={
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <Card
              key={card.label}
              className="bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800"
            >
              <CardContent className="pt-4 pb-3">
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                  {card.label}
                </span>
                <div className={cn("text-2xl font-bold mt-1", card.color)}>
                  {card.value}
                </div>
                <TrendIndicator value={card.trend} label={card.trendLabel} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Practice Plan statement health — collected vs failed vs cancelled.
            Renders nothing unless a PP statement is stored for the shown month. */}
        <PlanMappingDialog
          open={planMappingOpen}
          onOpenChange={setPlanMappingOpen}
          statementPlanLabels={statementPlanLabels}
          providerLabel={providerLabel}
        />

        <MembershipTrendsSection
          month={displayMonth.month}
          year={displayMonth.year}
        />

        <MembershipStatementHealthCard
          month={displayMonth.month}
          year={displayMonth.year}
          monthLabel={`${MONTH_NAMES[displayMonth.month - 1]} ${displayMonth.year}`}
          providerLabel={providerLabel}
        />

        {/* Membership Excel Upload & Plan-wise Revenue */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Membership Plan Revenue
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Upload your membership Excel/CSV or Practice Plan PDF statement
                to see plan-wise total revenue
              </p>
            </div>
            <div className="flex items-center gap-2">
              {statementPlanLabels.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setPlanMappingOpen(true)}
                  title={`Map each ${providerLabel} statement plan to its Dentally payment plan`}
                >
                  <Link2 className="w-4 h-4" />
                  Plan Mapping
                </Button>
              )}
              {membersByLocation.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={openImportSummary}
                >
                  <Users className="w-4 h-4" />
                  View by Location
                </Button>
              )}
              {uploadedMembers.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-red-600 hover:text-red-700"
                  onClick={() => clearData()}
                  disabled={isClearing}
                >
                  {isClearing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Clear
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleUploadClick}
                disabled={isValidating}
                title={
                  uploadedMembers.length > 0
                    ? effectiveSource === "practice-plan"
                      ? "Add another dentist's statement for this month — merges with what's already uploaded, doesn't replace it"
                      : "Add more rows for this month — merges with what's already uploaded, doesn't replace it"
                    : effectiveSource === "practice-plan"
                      ? "Upload a Practice Plan statement (PDF)"
                      : effectiveSource === "sheet"
                        ? "Upload a membership plan sheet (Excel/CSV)"
                        : "Choose which membership data to upload"
                }
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {isValidating
                  ? "Reading file…"
                  : uploadedMembers.length > 0
                    ? "Upload another"
                    : effectiveSource === "practice-plan"
                      ? "Upload PDF"
                      : effectiveSource === "sheet"
                        ? "Upload Excel"
                        : "Upload"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <input
                ref={pdfInputRef}
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isUploadLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : membersError ? (
              // A failed load must NOT masquerade as "no data uploaded" — that
              // hid a real fetch failure behind an innocent-looking empty state.
              <div className="text-center py-8 space-y-3">
                <div className="text-sm text-red-600 dark:text-red-400">
                  Couldn't load saved membership data:{" "}
                  {membersError.message || String(membersError)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchMembers()}
                >
                  Retry
                </Button>
              </div>
            ) : uploadPlanSummary.length > 0 ? (
              <div className="space-y-4">
                {(isShowingFallbackMonth || isShowingFallbackLocation) && (
                  // The header filters don't match where/when the data was
                  // uploaded — the page fell back so the numbers stay visible;
                  // say exactly what is on screen.
                  <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-2.5 text-sm text-blue-800 dark:text-blue-300">
                    Showing{" "}
                    <strong>
                      {MONTH_NAMES[displayMonth.month - 1]} {displayMonth.year}
                    </strong>{" "}
                    membership data
                    {isShowingFallbackMonth && (
                      <>
                        {" "}
                        — the latest uploaded month (nothing is uploaded for the
                        period selected in the top bar)
                      </>
                    )}
                    {isShowingFallbackLocation && (
                      <>
                        {isShowingFallbackMonth ? "; it is" : " —"} saved under{" "}
                        <strong>
                          {membersByLocation
                            .map((g) => g.locationName)
                            .join(", ") || "another location"}
                        </strong>
                        , not the location selected in the top bar
                      </>
                    )}
                    .
                  </div>
                )}
                {/* Plan-wise breakdown cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {uploadPlanSummary.map((plan) => {
                    const avgPerMember =
                      plan.members > 0 ? plan.total_net_due / plan.members : 0;
                    const matched = mergedPlanOverviews.find(
                      (p) => p.feeCategory === plan.fee_category,
                    );
                    const costs = matched?.costsPerMonth ?? 0;
                    const hasAdditionalRevenueMapping =
                      (planPaymentPlanIdsByLabel[plan.fee_category]?.length ?? 0) > 0;
                    const additionalRevenue =
                      additionalRevenueByLabel[plan.fee_category] ?? 0;
                    const mappedPlanName =
                      matched?.mappedPlanName ?? plan.mapped_plan_name ?? null;
                    const utilisation =
                      matched?.utilisation ??
                      (plan.total_net_due > 0
                        ? Math.min(
                            100,
                            Math.round((costs / plan.total_net_due) * 100),
                          )
                        : 0);
                    const netProfit = plan.total_net_due - costs;
                    const netProfitPct =
                      plan.total_net_due > 0
                        ? (netProfit / plan.total_net_due) * 100
                        : 0;
                    const status = getStatusFromMargin(
                      netProfitPct,
                      thresholds,
                    );
                    const borderColor =
                      status === "Profitable"
                        ? "border-t-emerald-500"
                        : status === "At Risk"
                          ? "border-t-amber-500"
                          : "border-t-red-500";
                    return (
                      <Card
                        key={plan.fee_category}
                        className={cn(
                          "border-t-4 transition-shadow hover:shadow-md",
                          !plan.is_practice_plan && "cursor-pointer",
                          borderColor,
                        )}
                        // The drill-down page resolves plans via mapped_plan_id
                        // (a Dentally payment plan). Practice Plan statement
                        // groups are the statement's own plans with no Dentally
                        // counterpart, so navigating would land on an empty
                        // detail view — keep those cards non-clickable.
                        onClick={
                          plan.is_practice_plan
                            ? undefined
                            : () =>
                                navigate(
                                  `/treatments/membership/${encodeURIComponent(plan.fee_category.toLowerCase().replace(/\s+/g, "-"))}`,
                                )
                        }
                      >
                        <CardContent className="pt-5 pb-4 space-y-4">
                          {/* Plan name + Status */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                              <div className="min-w-0">
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="font-semibold truncate cursor-default">
                                        {plan.fee_category}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      {plan.fee_category}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                {!mappedPlanName && !plan.is_practice_plan && (
                                  <span className="text-xs text-amber-600 dark:text-amber-400">
                                    Unmapped (no DB plan match)
                                  </span>
                                )}
                              </div>
                            </div>
                            <StatusBadge status={status} />
                          </div>

                          {/* Discount */}
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{plan.avg_discount}% avg discount</span>
                          </div>

                          {/* Members / Revenue — the card's primary figures */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            <PlanStat
                              label="Members"
                              value={plan.members}
                              valueClassName="text-xl"
                            />
                            <PlanStat
                              label="Revenue"
                              value={formatCurrency(plan.total_net_due)}
                              valueClassName="text-xl"
                              caption="net due"
                            />
                          </div>

                          {/* Additional income / Costs / Avg per member /
                              Utilisation — even 2x2 so no cell is left
                              stranded alone in a half-empty row. */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <PlanStat
                              label="Additional income"
                              tooltip="Extra treatments beyond membership, via Dentally"
                              value={
                                isLoadingAdditionalRevenue ? (
                                  <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Loading…
                                  </span>
                                ) : hasAdditionalRevenueMapping ? (
                                  formatCurrency(additionalRevenue)
                                ) : plan.is_practice_plan ? (
                                  <button
                                    type="button"
                                    className="text-sm font-normal text-primary hover:underline"
                                    onClick={() => setPlanMappingOpen(true)}
                                  >
                                    Map this plan
                                  </button>
                                ) : (
                                  <span className="text-sm font-normal text-muted-foreground">
                                    Not linked
                                  </span>
                                )
                              }
                            />
                            <PlanStat
                              label="Costs"
                              value={formatCurrency(costs)}
                              caption="treatment cost"
                            />
                            <PlanStat
                              label="Avg / member"
                              value={formatCurrency(avgPerMember)}
                              caption="per member"
                            />
                            <PlanStat
                              label="Utilisation"
                              value={`${utilisation}%`}
                              caption="of benefits used"
                            />
                          </div>

                          {/* Utilisation bar */}
                          <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                              <span>Benefit utilisation</span>
                              <span>{utilisation}%</span>
                            </div>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  utilisation >= 90
                                    ? "bg-red-500"
                                    : utilisation >= 70
                                      ? "bg-amber-500"
                                      : "bg-emerald-500",
                                )}
                                style={{ width: `${utilisation}%` }}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ) : membersByLocation.length > 0 ? (
              // Rows for this month DO exist — just not under the location
              // selected in the header (this org has two near-identically
              // named locations). Say so instead of pretending no data exists.
              <div className="text-center py-8 space-y-3">
                <div className="text-sm text-muted-foreground">
                  {membersByLocation.reduce((s, g) => s + g.members.length, 0)}{" "}
                  members are saved for {MONTH_NAMES[displayMonth.month - 1]}{" "}
                  {displayMonth.year} under a different location than the one
                  selected in the top bar (
                  {membersByLocation.map((g) => g.locationName).join(", ")}).
                  Switch the Location filter above, or view them by location.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={openImportSummary}
                >
                  <Users className="w-4 h-4" />
                  View by Location
                </Button>
              </div>
            ) : hasAnyUpload ? (
              // Practice Plan doesn't fall back to another month's data (see
              // resolveEffectivePairs) — a month with no statement uploaded
              // shows as empty here instead of quietly borrowing another
              // month's figures.
              <div className="text-center py-8 text-sm text-muted-foreground">
                No{" "}
                {effectiveSource === "practice-plan"
                  ? "Practice Plan statement"
                  : "membership"}{" "}
                data uploaded for{" "}
                <strong>
                  {MONTH_NAMES[displayMonth.month - 1]} {displayMonth.year}
                </strong>
                . Pick a different month above, or use the{" "}
                <strong>Upload</strong> button to add one.
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No data uploaded yet. Use the <strong>Upload</strong> button
                above to import a membership sheet (Excel/CSV) or a Practice
                Plan statement (PDF).
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plan Overview — commented out for now
        <div>
          <h2 className="text-lg font-semibold mb-4">Plan Overview</h2>
          {mergedPlanOverviews.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {mergedPlanOverviews.map(plan => {
                const slug = encodeURIComponent(plan.planName.toLowerCase().replace(/\s+/g, '-'));
                return (
                  <PlanCard
                    key={plan.planId}
                    plan={plan}
                    onClick={() => navigate(`/treatments/membership/${slug}`)}
                  />
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No membership plans found
              </CardContent>
            </Card>
          )}
        </div>
        */}

        {/* Revenue vs Cost Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">
              Revenue vs Cost Breakdown
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Stacked view of income sources and cost drivers per plan
            </p>
          </CardHeader>
          <CardContent>
            {planSimpleBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(280, planSimpleBreakdown.length * 80)}
                >
                  <BarChart
                    data={planSimpleBreakdown}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                    stackOffset="sign"
                    barSize={28}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCompact(Math.abs(v))}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                    />
                    <YAxis
                      type="category"
                      dataKey="plan"
                      width={70}
                      axisLine={false}
                      tickLine={false}
                      fontSize={13}
                      fontWeight={500}
                    />
                    <RechartsTooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = planSimpleBreakdown.find(
                          (r) => r.plan === label,
                        );
                        const upload = uploadPlanSummary.find(
                          (p) => p.fee_category === label,
                        );
                        const matched = mergedPlanOverviews.find(
                          (p) =>
                            p.planName.toLowerCase() ===
                            (label as string).toLowerCase(),
                        );
                        const costs = matched?.costsPerMonth ?? 0;
                        const revenue = upload?.total_net_due ?? 0;
                        const netProfit = revenue - costs;
                        const avgPerMember =
                          upload && upload.members > 0
                            ? upload.total_net_due / upload.members
                            : 0;
                        const utilisation =
                          matched?.utilisation ??
                          (revenue > 0
                            ? Math.min(100, Math.round((costs / revenue) * 100))
                            : 0);
                        // Count distinct treatment types with actual usage for this plan
                        const distinctTreatments = treatmentConsumption.filter(
                          (t) => t.plan === label && t.treatmentCount > 0,
                        ).length;
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md text-sm space-y-1">
                            <p className="font-semibold">{label}</p>
                            {payload.map((entry: any, i: number) => (
                              <div key={i} className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: entry.color }}
                                />
                                <span className="text-muted-foreground">
                                  {entry.name}:
                                </span>
                                <span className="font-medium">
                                  {formatCurrency(Math.abs(entry.value))}
                                </span>
                              </div>
                            ))}
                            <div className="border-t pt-1 mt-1 space-y-0.5">
                              {upload && (
                                <>
                                  <div className="text-muted-foreground">
                                    <span>Members: </span>
                                    <span className="font-medium text-foreground">
                                      {upload.members}
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    <span>Avg Discount: </span>
                                    <span className="font-medium text-foreground">
                                      {upload.avg_discount}%
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    <span>Avg / Member: </span>
                                    <span className="font-medium text-foreground">
                                      {formatCurrency(avgPerMember)}
                                    </span>
                                  </div>
                                </>
                              )}
                              <div className="text-muted-foreground">
                                <span>No. of Treatments: </span>
                                <span className="font-medium text-foreground">
                                  {distinctTreatments}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                <span>Utilisation: </span>
                                <span className="font-medium text-foreground">
                                  {utilisation}%
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                <span>Net Profit: </span>
                                <span
                                  className={cn(
                                    "font-medium",
                                    netProfit >= 0
                                      ? "text-emerald-600"
                                      : "text-red-600",
                                  )}
                                >
                                  {formatCurrency(netProfit)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value: string) => (
                        <span className="text-muted-foreground">{value}</span>
                      )}
                    />
                    {/* Cost (negative = extends LEFT from center) */}
                    <Bar
                      dataKey="treatmentCost"
                      name="Treatment Cost"
                      stackId="stack"
                      fill="#ef4444"
                    />
                    {/* Revenue (positive = extends RIGHT from center) */}
                    <Bar
                      dataKey="planRevenue"
                      name="Plan Revenue"
                      stackId="stack"
                      fill="#1e3a5f"
                    />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-12 mt-2 text-xs text-muted-foreground border-t pt-3">
                  <div>
                    <span className="font-semibold text-foreground">
                      Revenue
                    </span>
                    <div className="flex gap-4 mt-1.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: "#1e3a5f" }}
                        />{" "}
                        Plan Revenue
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Cost</span>
                    <div className="flex gap-4 mt-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-red-500" />{" "}
                        Treatment Cost
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                No breakdown data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Treatment Consumption by Plan */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">
                Treatment Consumption by Plan
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Which treatments are being consumed and their margin impact
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select
                value={consumptionPlanFilter}
                onValueChange={(v) => {
                  setConsumptionPlanFilter(v);
                  setConsumptionPage(1);
                }}
              >
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  {mergedPlanOverviews.map((p) => (
                    <SelectItem key={p.planId} value={p.planName}>
                      {p.planName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {filteredConsumption.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Treatment</TableHead>
                      <TableHead className="text-right">
                        Avg Usage / Member
                      </TableHead>
                      <TableHead className="text-right">Cost / Unit</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right pr-6">
                        Margin Impact
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedConsumption.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-6">
                          <div className="font-medium">
                            {row.treatment}
                            {row.treatmentCode ? ` (${row.treatmentCode})` : ""}
                          </div>
                          {row.categoryName && (
                            <div className="text-xs text-muted-foreground">
                              {row.categoryName}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.avgUsagePerMember}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.costPerUnit)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.costPerUnit * row.treatmentCount)}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <MarginImpactBadge impact={row.marginImpact} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex items-center justify-between px-6 pt-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Show</span>
                    <Select
                      value={String(consumptionPageSize)}
                      onValueChange={(v) => {
                        setConsumptionPageSize(Number(v));
                        setConsumptionPage(1);
                      }}
                    >
                      <SelectTrigger className="w-[70px] h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                    <span>records</span>
                    <span className="ml-2 text-xs">
                      Showing {(safePage - 1) * consumptionPageSize + 1}–
                      {Math.min(
                        safePage * consumptionPageSize,
                        filteredConsumption.length,
                      )}{" "}
                      of {filteredConsumption.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={safePage <= 1}
                      onClick={() =>
                        setConsumptionPage((p) => Math.max(1, p - 1))
                      }
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    {(() => {
                      const pages: (number | string)[] = [];
                      if (totalConsumptionPages <= 7) {
                        for (let i = 1; i <= totalConsumptionPages; i++)
                          pages.push(i);
                      } else {
                        pages.push(1);
                        if (safePage > 3) pages.push("...");
                        const start = Math.max(2, safePage - 1);
                        const end = Math.min(
                          totalConsumptionPages - 1,
                          safePage + 1,
                        );
                        for (let i = start; i <= end; i++) pages.push(i);
                        if (safePage < totalConsumptionPages - 2)
                          pages.push("...");
                        pages.push(totalConsumptionPages);
                      }
                      return pages.map((page, idx) =>
                        typeof page === "string" ? (
                          <span
                            key={`ellipsis-${idx}`}
                            className="px-1 text-sm text-muted-foreground"
                          >
                            ...
                          </span>
                        ) : (
                          <Button
                            key={page}
                            variant={page === safePage ? "default" : "outline"}
                            size="icon"
                            className="h-8 w-8 text-sm"
                            onClick={() => setConsumptionPage(page)}
                          >
                            {page}
                          </Button>
                        ),
                      );
                    })()}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={safePage >= totalConsumptionPages}
                      onClick={() =>
                        setConsumptionPage((p) =>
                          Math.min(totalConsumptionPages, p + 1),
                        )
                      }
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                {uploadPlanSummary.length === 0
                  ? "Upload membership data to see treatment consumption"
                  : "No consumption data available"}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Over-Utilisation & Risk Signals — only uploaded plans */}
        {filteredRiskSignals.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold">
                Over-Utilisation & Risk Signals
              </h2>
            </div>
            <div className="space-y-3">
              {filteredRiskSignals.map((signal, i) => (
                <RiskSignalCard key={i} signal={signal} />
              ))}
            </div>
          </div>
        )}
            </>
          }
        />
      </div>

      {/* Full-screen overlay shown while we parse the file and look up
          patients in the DB — keeps the user from clicking around while
          the preview popup is being prepared. */}
      {isValidating && !previewRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-lg border bg-card px-6 py-5 shadow-lg flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <div>
              <div className="text-sm font-medium">
                Reading membership file…
              </div>
              <div className="text-xs text-muted-foreground">
                Matching rows against your patients
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Dialog — shown after file is parsed, before saving */}
      <Dialog
        open={!!previewRows}
        onOpenChange={(open) => {
          if (!open) cancelPreview();
        }}
      >
        <DialogContent className="max-w-6xl max-h-[95vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Preview Membership Data
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Review the parsed data before importing.{" "}
              {previewRows?.length ?? 0} rows found.
              {isValidating && (
                <span className="ml-2 text-blue-600">
                  Validating surnames...
                </span>
              )}
              {!isValidating &&
                previewRows &&
                previewRows.length > 0 &&
                (() => {
                  const matchedCount = rowPlanMatches.filter(
                    (m) => !!m?.pt_id,
                  ).length;
                  const notMatched = previewRows.length - matchedCount;
                  return (
                    <span className="ml-2">
                      <span className="text-emerald-600">
                        {matchedCount} matched
                      </span>
                      {notMatched > 0 && (
                        <span className="text-red-500 ml-1.5">
                          {notMatched} not found
                        </span>
                      )}
                    </span>
                  );
                })()}
            </p>
          </DialogHeader>

          {/* Month/Year selector for import */}
          <div className="flex items-center gap-3 pb-2 border-b">
            <span className="text-sm font-medium">Import for:</span>
            <Select
              value={String(importMonth)}
              onValueChange={(v) => setImportMonth(Number(v))}
            >
              <SelectTrigger className="w-[130px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(importYear)}
              onValueChange={(v) => setImportYear(Number(v))}
            >
              <SelectTrigger className="w-[90px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm font-medium ml-2">Location:</span>
            <Select
              value={importLocationId ?? ""}
              onValueChange={(v) => setImportLocationId(v || null)}
            >
              <SelectTrigger className="w-[220px] h-8 text-sm">
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {practiceLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!importLocationId && (
              <span className="text-xs text-amber-600">
                Required — the {providerLabel} file is tagged to this location
              </span>
            )}
          </div>

          {/* Denplan Facility Mappings — one panel per uploaded CSV. Maps the
              facility id in the filename (e.g. "256891a") to a product/plan
              so rows from that file inherit the correct plan override. */}
          {detectedFacilities.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  {providerLabel} Facilities Detected
                  <Badge variant="secondary" className="text-xs">
                    {
                      detectedFacilities.filter(
                        (f) => f.mapping?.payment_plan_id,
                      ).length
                    }
                    /{detectedFacilities.length} mapped
                  </Badge>
                </h4>
                <span className="text-xs text-muted-foreground">
                  Unmapped facilities fall back to each patient's assigned plan.
                </span>
              </div>
              <div className="space-y-1.5">
                {detectedFacilities.map((f) => {
                  const isEditing = editingFacilityId === f.facility_id;
                  const mappedPlanIds = f.mapping?.payment_plan_ids ?? [];
                  const mappedPlanNames = mappedPlanIds
                    .map((id) => allActivePlans.find((p) => p.id === id)?.name)
                    .filter((n): n is string => !!n);
                  return (
                    <div
                      key={f.facility_id}
                      className="rounded border bg-background px-3 py-2"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="outline" className="font-mono text-xs">
                          {f.facility_id}
                        </Badge>
                        <span
                          className="text-xs text-muted-foreground truncate max-w-[320px]"
                          title={f.file_names.join(", ")}
                        >
                          {f.file_names.length === 1
                            ? f.file_names[0]
                            : `${f.file_names.length} files`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {f.row_count} row{f.row_count === 1 ? "" : "s"}
                        </span>
                        <div className="flex-1" />
                        {f.mapping ? (
                          <div className="flex items-center gap-2 text-xs max-w-[50%]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                            <span className="font-medium">
                              {f.mapping.product_name}
                            </span>
                            {mappedPlanNames.length > 0 ? (
                              <span
                                className="text-muted-foreground truncate"
                                title={mappedPlanNames.join(", ")}
                              >
                                →{" "}
                                {mappedPlanNames.length === 1
                                  ? mappedPlanNames[0]
                                  : `${mappedPlanNames.length} plans`}
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">
                                (no plan set)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" /> Unmapped
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant={f.mapping ? "ghost" : "default"}
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            isEditing
                              ? setEditingFacilityId(null)
                              : openFacilityEditor(f.facility_id)
                          }
                        >
                          {isEditing ? "Cancel" : f.mapping ? "Edit" : "Map"}
                        </Button>
                        {f.mapping && !isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                            onClick={() =>
                              f.mapping && deleteFacilityMapping(f.mapping.id)
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      {isEditing && (
                        <div className="mt-2 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Input
                              placeholder={`Product name (e.g. ${providerLabel} Care)`}
                              value={facilityForm.product_name}
                              onChange={(e) =>
                                setFacilityForm((prev) => ({
                                  ...prev,
                                  product_name: e.target.value,
                                }))
                              }
                              className="h-8 text-sm"
                            />
                            <Input
                              placeholder="Dentist name (optional)"
                              value={facilityForm.dentist_name}
                              onChange={(e) =>
                                setFacilityForm((prev) => ({
                                  ...prev,
                                  dentist_name: e.target.value,
                                }))
                              }
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <AccountMultiSelect
                                options={allActivePlans.map((p) => ({
                                  value: p.id,
                                  label: p.name,
                                }))}
                                value={facilityForm.payment_plan_ids}
                                onChange={(ids) =>
                                  setFacilityForm((prev) => ({
                                    ...prev,
                                    payment_plan_ids: ids,
                                  }))
                                }
                                placeholder="Map to one or more plans…"
                                showSelected
                              />
                            </div>
                            <Button
                              size="sm"
                              className="h-10 text-xs flex-shrink-0"
                              disabled={
                                !facilityForm.product_name.trim() ||
                                isSavingFacilityMapping
                              }
                              onClick={saveFacilityEditor}
                            >
                              {isSavingFacilityMapping ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                "Save"
                              )}
                            </Button>
                          </div>
                          {facilityForm.payment_plan_ids.length > 1 && (
                            <p className="text-[11px] text-muted-foreground">
                              When multiple plans are mapped, each row is
                              assigned to the plan whose name best matches its
                              fee category.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto space-y-4">
            {/* Plan-wise summary */}
            {previewPlanSummary.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
                  <CardContent className="pt-3 pb-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                      Total Revenue
                    </span>
                    <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(previewTotalRevenue)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <CardContent className="pt-3 pb-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                      Total Members
                    </span>
                    <div className="text-xl font-bold text-blue-700 dark:text-blue-400">
                      {previewTotalMembers}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800">
                  <CardContent className="pt-3 pb-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                      Plans
                    </span>
                    <div className="text-xl font-bold">
                      {previewPlanSummary.length}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Plan breakdown. Plan is auto-resolved from the matched
                patient's pt_payment_plan_id — the manual "Map to Plan"
                dropdown has been disabled for now. */}
            {previewPlanSummary.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Plan-wise Summary
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="h-9 pl-3">Plan</TableHead>
                        <TableHead className="h-9 text-right">
                          Members
                        </TableHead>
                        <TableHead className="h-9 text-right">
                          Avg Discount %
                        </TableHead>
                        <TableHead className="h-9 text-right pr-3">
                          Total Revenue
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewPlanSummary.map((p) => (
                        <TableRow key={p.fee_category} className="border-t">
                          <TableCell className="py-2 pl-3 font-medium">
                            {p.fee_category}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            {p.members}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            {p.avg_discount}%
                          </TableCell>
                          <TableCell className="py-2 pr-3 text-right font-semibold">
                            {formatCurrency(p.total_net_due)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t bg-muted/40 font-semibold">
                        <TableCell className="py-2 pl-3">Total</TableCell>
                        <TableCell className="py-2 text-right">
                          {previewTotalMembers}
                        </TableCell>
                        <TableCell className="py-2 text-right text-muted-foreground">
                          —
                        </TableCell>
                        <TableCell className="py-2 pr-3 text-right">
                          {formatCurrency(previewTotalRevenue)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Manual mapping UI — commented out. Restore this block to
                re-enable user-driven fee_category → plan mapping.
            <Select onValueChange={(v) => setFeeCategoryPlan('...', v || null)}>
              ...availablePlans, feeCategoryPlanMap, unmappedFeeCategories...
            </Select>
            */}

            {/* Row-level preview */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Row Data</h4>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">#</TableHead>
                      <TableHead>Patient ID</TableHead>
                      <TableHead>Surname</TableHead>
                      <TableHead>Initial</TableHead>
                      <TableHead>DoB</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                      <TableHead>Treating Dentist</TableHead>
                      <TableHead>Fee Category</TableHead>
                      <TableHead>Matched Plan</TableHead>
                      <TableHead className="text-right">Pay Grp Size</TableHead>
                      <TableHead className="text-right">Discount %</TableHead>
                      <TableHead className="text-right pr-3">Net Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedPreview.map((row, i) => {
                      const absoluteIdx =
                        (previewPage - 1) * PREVIEW_PAGE_SIZE + i;
                      const match = rowPlanMatches[absoluteIdx];
                      const dobForAge = match?.dob || row.dob || null;
                      const age = computeAge(dobForAge);
                      return (
                        <TableRow key={i}>
                          <TableCell className="pl-3 text-muted-foreground text-xs">
                            {absoluteIdx + 1}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {match?.pt_id ||
                              surnamePatientIdMap.get(
                                row.surname.toLowerCase(),
                              ) ||
                              "-"}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              {validSurnames.has(row.surname.toLowerCase()) ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              )}
                              {row.title ? `${row.title} ` : ""}
                              {row.surname}
                            </span>
                          </TableCell>
                          <TableCell>{row.initial}</TableCell>
                          <TableCell className="text-xs">
                            {row.dob || match?.dob || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {age != null ? (
                              age
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{row.treating_dentist}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.fee_category}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {match?.plan_name ? (
                              <Badge variant="secondary">
                                {match.plan_name}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.pay_grp_size ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.discount_percent}%
                          </TableCell>
                          <TableCell className="text-right pr-3 font-medium">
                            {formatCurrency(row.net_due)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Preview pagination */}
              {previewTotalPages > 1 && (
                <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
                  <span>
                    Showing {(previewPage - 1) * PREVIEW_PAGE_SIZE + 1}–
                    {Math.min(
                      previewPage * PREVIEW_PAGE_SIZE,
                      previewRows?.length ?? 0,
                    )}{" "}
                    of {previewRows?.length ?? 0}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={previewPage <= 1}
                      onClick={() => setPreviewPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="px-2 text-xs">
                      Page {previewPage} / {previewTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={previewPage >= previewTotalPages}
                      onClick={() => setPreviewPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Parse warnings */}
            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {parseErrors.length} warning(s)
                  </span>
                </div>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5 ml-6 max-h-24 overflow-auto">
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={cancelPreview}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmImport}
              disabled={
                isImporting ||
                unmappedFeeCategories.length > 0 ||
                !importLocationId
              }
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Confirm Import — {MONTH_NAMES[importMonth - 1]} {importYear} (
              {previewRows?.filter((r) =>
                validSurnames.has(r.surname.toLowerCase()),
              ).length ?? 0}{" "}
              matched rows)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* First-visit upload chooser — a ONE-TIME question, shown only while
          the org has NO membership data and NO remembered choice. Picking an
          option is remembered (per-org localStorage now, and derived from the
          uploaded data itself after the first import) so the Upload button
          opens the right file picker directly from then on. */}
      <Dialog
        open={showUploadChooser}
        onOpenChange={(open) => {
          if (!open) closeUploadChooser();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Which membership data do you want to upload?
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              No membership data has been uploaded yet. Pick the format your
              plan provider gives you — you'll only be asked once, and the
              Upload button will use this choice from now on.
            </p>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <button
              type="button"
              className="border border-border rounded-lg p-4 text-left hover:border-primary/60 hover:bg-muted/40 transition-colors"
              onClick={() => pickSource("sheet")}
            >
              <FileSpreadsheet className="w-6 h-6 mb-2 text-primary" />
              <div className="font-semibold text-sm mb-1">
                Membership plan sheet
              </div>
              <div className="text-xs text-muted-foreground">
                Excel/CSV member listing exported by your plan provider (e.g. a
                Denplan members export).
              </div>
            </button>
            <button
              type="button"
              className="border border-border rounded-lg p-4 text-left hover:border-primary/60 hover:bg-muted/40 transition-colors"
              onClick={() => pickSource("practice-plan")}
            >
              <FileText className="w-6 h-6 mb-2 text-primary" />
              <div className="font-semibold text-sm mb-1">
                Practice Plan statement
              </div>
              <div className="text-xs text-muted-foreground">
                The monthly "Statement for …" PDF from Practice Plan — member
                collections are read from it automatically.
              </div>
            </button>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={closeUploadChooser}>
              Maybe later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location-split modal — auto-opens after Confirm Import and
          re-openable via the "View by Location" button on the card header.
          Shows one tab per location found (named from practice_locations)
          plus an "Unassigned" tab for rows whose patient couldn't be matched
          in the DB. */}
      <Dialog
        open={isImportSummaryOpen}
        onOpenChange={(open) => {
          if (!open) closeImportSummary();
        }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Imported Members by Location —{" "}
              {MONTH_NAMES[displayMonth.month - 1]} {displayMonth.year}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Members are split by each patient's home location from the
              database. Rows whose patient could not be matched appear under{" "}
              <strong>Unassigned</strong>.
            </p>
          </DialogHeader>
          {membersByLocation.length === 0 && isLocationSplitFetching ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading imported members…
            </div>
          ) : membersByLocation.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              No imported members for this month.
            </div>
          ) : (
            <Tabs
              defaultValue={membersByLocation[0].locationId ?? "__unassigned__"}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <TabsList className="flex-wrap h-auto justify-start">
                {membersByLocation.map((g) => (
                  <TabsTrigger
                    key={g.locationId ?? "__unassigned__"}
                    value={g.locationId ?? "__unassigned__"}
                    className="gap-2"
                  >
                    {g.locationName}
                    <Badge variant="secondary" className="text-xs">
                      {g.members.length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              {membersByLocation.map((g) => (
                <TabsContent
                  key={g.locationId ?? "__unassigned__"}
                  value={g.locationId ?? "__unassigned__"}
                  className="flex-1 overflow-auto mt-3"
                >
                  <LocationMembersPanel group={g} />
                </TabsContent>
              ))}
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeImportSummary}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

const MEMBERS_PAGE_SIZE = 10;

function LocationMembersPanel({ group }: { group: MembershipLocationGroup }) {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("__all__");
  const [page, setPage] = useState(1);

  // Practice Plan statement rows: the member's plan IS the statement's own
  // plan (fee_category) — show that, and hide the Denplan-specific columns
  // (Dentally mapped plan, pay-group size), which read as noise/mislabels
  // ("NHS" next to a Practice Plan member) there.
  const isPracticePlan =
    group.members.length > 0 &&
    group.members.every(
      (m) => m.explanatory_text === "Practice Plan statement",
    );
  const rowPlanName = (m: MembershipUploadMember) =>
    isPracticePlan ? m.fee_category : m.mapped_plan_name;

  const planOptions = useMemo(() => {
    const set = new Set<string>();
    group.members.forEach((m) => {
      const p = rowPlanName(m);
      if (p) set.add(p);
    });
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.members, isPracticePlan]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return group.members.filter((m) => {
      if (planFilter !== "__all__") {
        const plan = rowPlanName(m);
        if (planFilter === "__unmapped__") {
          if (plan) return false;
        } else if (plan !== planFilter) {
          return false;
        }
      }
      if (!q) return true;
      const hay = [
        m.title,
        m.initial,
        m.surname,
        m.fee_category,
        m.mapped_plan_name,
        m.dob,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.members, search, planFilter, isPracticePlan]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / MEMBERS_PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const pagedMembers = filtered.slice(
    (currentPage - 1) * MEMBERS_PAGE_SIZE,
    currentPage * MEMBERS_PAGE_SIZE,
  );
  const filteredNetDue = filtered.reduce(
    (sum, m) => sum + Number(m.net_due || 0),
    0,
  );

  const resetPage = () => setPage(1);

  const formatDob = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <Input
          placeholder="Search member, plan, fee category…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          className="h-8 w-64"
        />
        <Select
          value={planFilter}
          onValueChange={(v) => {
            setPlanFilter(v);
            resetPage();
          }}
        >
          <SelectTrigger className="h-8 w-56">
            <SelectValue placeholder="All plans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All plans</SelectItem>
            {!isPracticePlan && (
              <SelectItem value="__unmapped__">Unmapped</SelectItem>
            )}
            {planOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {filtered.length} of {group.members.length} member
            {group.members.length === 1 ? "" : "s"}
          </span>
          <span className="font-medium">
            Total net due: £{filteredNetDue.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden">
        <Table className="border-collapse [&_th]:border [&_td]:border [&_th]:border-border [&_td]:border-border">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>DoB</TableHead>
              <TableHead className="text-right">Age</TableHead>
              {!isPracticePlan && (
                <TableHead className="text-right">Pay Grp Size</TableHead>
              )}
              <TableHead>{isPracticePlan ? "Plan" : "Fee Category"}</TableHead>
              {!isPracticePlan && <TableHead>Mapped Plan</TableHead>}
              <TableHead className="text-right">Discount %</TableHead>
              <TableHead className="text-right">Net Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedMembers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isPracticePlan ? 6 : 8}
                  className="text-center text-sm text-muted-foreground py-6"
                >
                  No members match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              pagedMembers.map((m) => {
                const initialLetter = m.initial
                  ? `${m.initial.charAt(0).toUpperCase()}.`
                  : "";
                const memberLabel =
                  [m.title, initialLetter, m.surname]
                    .filter(Boolean)
                    .join(" ") || m.surname;
                let age: number | null = null;
                if (m.dob) {
                  const d = new Date(m.dob);
                  if (!isNaN(d.getTime())) {
                    const now = new Date();
                    age = now.getFullYear() - d.getFullYear();
                    const mDiff = now.getMonth() - d.getMonth();
                    if (
                      mDiff < 0 ||
                      (mDiff === 0 && now.getDate() < d.getDate())
                    )
                      age -= 1;
                  }
                }
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{memberLabel}</TableCell>
                    <TableCell>{formatDob(m.dob)}</TableCell>
                    <TableCell className="text-right">{age ?? "—"}</TableCell>
                    {!isPracticePlan && (
                      <TableCell className="text-right">
                        {m.pay_grp_size ?? "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      {isPracticePlan ? (
                        <Badge variant="outline">{m.fee_category}</Badge>
                      ) : (
                        m.fee_category
                      )}
                    </TableCell>
                    {!isPracticePlan && (
                      <TableCell>
                        {m.mapped_plan_name ? (
                          <Badge variant="outline">{m.mapped_plan_name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {m.discount_percent}%
                    </TableCell>
                    <TableCell className="text-right">
                      £{m.net_due.toFixed(2)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {filtered.length > MEMBERS_PAGE_SIZE && (
        <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground px-1">
          <span>
            Showing {(currentPage - 1) * MEMBERS_PAGE_SIZE + 1}–
            {Math.min(currentPage * MEMBERS_PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="px-2 text-xs">
              Page {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
