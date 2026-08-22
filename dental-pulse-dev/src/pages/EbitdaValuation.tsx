import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Info, Pencil, Check, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEbitdaValuation } from "@/hooks/useEbitdaValuation";
import { usePermissions } from "@/hooks/usePermissions";
import { useTabPermissions } from "@/hooks/useTabPermissions";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import {
  DEFAULT_QUALITY_WEIGHTS,
  type QualityWeights,
} from "@/utils/ebitda/qualityScore";
import { ExitCockpitContent } from "./ExitCockpit";
import { DueDiligenceContent } from "./DueDiligence";
import { GroupHeatmapContent } from "./GroupHeatmap";
import { GeneratePdfContent } from "./GeneratePdf";

const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;

const MERGED_TABS = [
  "enterprise-overview",
  "exit-cockpit",
  "due-diligence",
  "group-heatmap",
] as const;
type MergedTab = (typeof MERGED_TABS)[number];

// ─── WEIGHT KEY MAPPING ───

const LABEL_TO_WEIGHT_KEY: Record<string, keyof QualityWeights> = {
  "Revenue Predictability": "revenue_predictability",
  "Associate Dependency": "associate_dependency",
  "Chair Stability": "chair_stability",
  "Treatment Mix": "treatment_mix",
  "Cash Conversion": "cash_conversion",
  "NHS Delivery": "nhs_delivery",
};

// ─── INFO DESCRIPTIONS ───

const MULTIPLE_INFO: Record<
  string,
  { description: string; calculation: string }
> = {
  "Base Market": {
    description: "Starting valuation multiple for UK dental practices.",
    calculation: "Default: 5.8× (configurable in settings)",
  },
  "+ Scale": {
    description:
      "Premium for larger practices — higher revenue = more attractive to buyers.",
    calculation: "Revenue > £5M → +0.3× | > £3M → +0.2× | > £1M → +0.1×",
  },
  "+ Chair": {
    description:
      "Premium for high chair utilisation — busy chairs = efficient practice.",
    calculation: "Utilisation > 80% → +0.2× | > 70% → +0.1×",
  },
  "+ Reporting": {
    description:
      "Premium for having accounting software (Xero/Iplicit) connected — gives buyers confidence in the numbers.",
    calculation: "GL data connected → +0.1×",
  },
  "+ Debt Mgmt": {
    description: "Premium for low debt relative to earnings.",
    calculation: "Net Debt / EBITDA < 1.5 → +0.1×",
  },
  "− Assoc. Dep.": {
    description:
      "Penalty when too much revenue depends on one associate — if they leave, revenue drops.",
    calculation: "Top provider > 40% → -0.4× | > 30% → -0.3× | > 20% → -0.2×",
  },
  "− Mgmt Depth": {
    description:
      "Fixed penalty — assumes limited management team beyond the principal.",
    calculation: "Always applied: -0.3×",
  },
  "− NHS Risk": {
    description:
      "Penalty for under-delivering on NHS UDA contract — risk of clawback.",
    calculation:
      "UDA < 92% → -0.3× | < 96% → -0.2× | < 100% → -0.1× | No NHS → no penalty",
  },
  "− Standards": {
    description:
      "Fixed penalty for standardisation risk — no SOPs or compliance framework detected.",
    calculation: "Always applied: -0.2×",
  },
  "− Leverage": {
    description: "Fixed penalty for financial leverage risk.",
    calculation: "Always applied: -0.2×",
  },
  "− Qual. Drag": {
    description:
      "Penalty based on EBITDA Quality Score — lower quality earnings = lower multiple.",
    calculation:
      "Score < 65 → -0.3× | < 75 → -0.2× | < 85 → -0.1× | 85+ → no penalty",
  },
};

const QUALITY_INFO_STATIC: Record<
  string,
  { description: string; calculation: string }
> = {
  "Revenue Predictability": {
    description:
      "How consistent is monthly revenue? High variation = unpredictable earnings.",
    calculation:
      "Score = 100 - (Coefficient of Variation × 200). CV = StdDev / Mean of last 12 months revenue.",
  },
  "Associate Dependency": {
    description:
      "How much revenue depends on the top associate? High concentration = risky.",
    calculation: "Score = 100 - (Top Provider Revenue % × 1.5).",
  },
  "Chair Stability": {
    description:
      "Average chair utilisation across all locations. Low utilisation = wasted capacity.",
    calculation: "Score = Average Utilisation %.",
  },
  "Treatment Mix": {
    description:
      "Percentage of revenue from private treatments. Higher private = better margins.",
    calculation: "Score = Private Revenue %.",
  },
  "Cash Conversion": {
    description:
      "How many invoices are actually paid? High paid rate = healthy cash flow.",
    calculation: "Score = (Paid Invoices / Total Invoices) × 100.",
  },
  "NHS Delivery": {
    description:
      "UDA delivery rate against NHS contract target. Under-delivery risks clawback.",
    calculation:
      "Score = UDA Delivery %. No NHS contract → default 65 (neutral).",
  },
};

function buildQualityInfo(
  inputs: import("@/utils/ebitda/qualityScore").QualityScoreInputs | null,
): Record<string, { description: string; calculation: string }> {
  if (!inputs) return QUALITY_INFO_STATIC;
  const monthCount = inputs.monthlyRevenues.length;
  const mean =
    monthCount > 0
      ? inputs.monthlyRevenues.reduce((s, v) => s + v, 0) / monthCount
      : 0;
  const variance =
    monthCount > 1
      ? inputs.monthlyRevenues.reduce((s, v) => s + (v - mean) ** 2, 0) /
        monthCount
      : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const cvPct = Math.round(cv * 100);
  const revScore = Math.max(0, Math.min(100, Math.round(100 - cv * 200)));
  const topPct = Math.round(inputs.topProviderRevenuePct);
  const assocScore = Math.max(
    0,
    Math.min(100, Math.round(100 - inputs.topProviderRevenuePct * 1.5)),
  );
  const chairPct = Math.round(inputs.avgUtilisationPct);
  const privatePct = Math.round(inputs.privateRevenuePct);
  const paidPct = Math.round(inputs.paidInvoiceRate * 100);
  const udaPct =
    inputs.udaDeliveryPct != null ? Math.round(inputs.udaDeliveryPct) : null;

  return {
    "Revenue Predictability": {
      description:
        "How consistent is monthly revenue? High variation = unpredictable earnings.",
      calculation: `CV = ${cvPct}% (from ${monthCount} months). Score = 100 − (${cvPct}% × 2) = ${revScore}.`,
    },
    "Associate Dependency": {
      description:
        "How much revenue depends on the top associate? High concentration = risky.",
      calculation: `Top provider = ${topPct}% of revenue. Score = 100 − (${topPct} × 1.5) = ${assocScore}.`,
    },
    "Chair Stability": {
      description:
        "Average chair utilisation across all locations. Low utilisation = wasted capacity.",
      calculation: `Avg utilisation = ${chairPct}%. Score = ${chairPct}.`,
    },
    "Treatment Mix": {
      description:
        "Percentage of revenue from private treatments. Higher private = better margins.",
      calculation: `Private revenue = ${privatePct}% of total. Score = ${privatePct}.`,
    },
    "Cash Conversion": {
      description:
        "How many invoices are actually paid? High paid rate = healthy cash flow.",
      calculation: `Paid rate = ${paidPct}%. Score = ${paidPct}.`,
    },
    "NHS Delivery": {
      description:
        "UDA delivery rate against NHS contract target. Under-delivery risks clawback.",
      calculation:
        udaPct != null
          ? `UDA delivery = ${udaPct}%. Score = ${udaPct}.`
          : "No NHS contract → default score 65 (neutral).",
    },
  };
}

// ─── HELPERS ───
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatCompact = formatCurrency;

const scoreColor = (v: number) =>
  v >= 80 ? "text-success" : v >= 60 ? "text-warning" : "text-danger";
const scoreBg = (v: number) =>
  v >= 80 ? "bg-success" : v >= 60 ? "bg-warning" : "bg-danger";
const scoreHsl = (v: number) =>
  v >= 80
    ? "hsl(var(--success))"
    : v >= 60
      ? "hsl(var(--warning))"
      : "hsl(var(--danger))";
const statusColors = {
  green: { dot: "bg-success", tag: "bg-success-muted text-success" },
  amber: { dot: "bg-warning", tag: "bg-warning-muted text-warning" },
  red: { dot: "bg-danger", tag: "bg-danger-muted text-danger" },
};

// ─── COMPONENTS ───

function InfoButton({
  info,
}: {
  info: { description: string; calculation: string };
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          className="flex-shrink-0 text-muted-foreground/50 hover:text-primary transition-colors"
          type="button"
        >
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="w-[300px] p-3 shadow-lg border bg-popover z-[100]"
      >
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">
          {info.description}
        </p>
        <p className="text-[10px] text-muted-foreground font-mono leading-relaxed whitespace-normal break-words">
          {info.calculation}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreBar({
  label,
  value,
  weight,
  onWeightClick,
  infoOverride,
}: {
  label: string;
  value: number;
  weight: number;
  onWeightClick?: () => void;
  infoOverride?: { description: string; calculation: string };
}) {
  const info = infoOverride ?? QUALITY_INFO_STATIC[label];
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-muted-foreground w-[145px] flex-shrink-0 flex items-center gap-1 whitespace-nowrap overflow-hidden">
        <span className="truncate">{label}</span>
        {info && <InfoButton info={info} />}
      </span>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            scoreBg(value),
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span
        className={cn(
          "text-[11px] font-bold w-6 text-right tabular-nums",
          scoreColor(value),
        )}
      >
        {value}
      </span>
      {value < 60 && (
        <div className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
      )}
      <button
        onClick={onWeightClick}
        className="text-[9px] text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors px-1 py-0.5 rounded cursor-pointer tabular-nums"
        type="button"
        title="Click to adjust weight"
      >
        {Math.round(weight * 100)}%
      </button>
    </div>
  );
}

function WaterfallRow({
  label,
  value,
  type,
  baseValue,
}: {
  label: string;
  value: number;
  type: "base" | "positive" | "negative";
  baseValue: number;
}) {
  const maxVal = baseValue || 5.8;
  const width = (Math.abs(value) / maxVal) * 80;
  const color =
    type === "base"
      ? "bg-foreground"
      : type === "positive"
        ? "bg-success"
        : "bg-danger";
  const textColor =
    type === "base"
      ? "text-foreground"
      : type === "positive"
        ? "text-success"
        : "text-danger";
  const displayVal =
    type === "base" ? `${value}×` : `${value > 0 ? "+" : ""}${value}×`;
  const info = MULTIPLE_INFO[label];

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[11.5px] text-muted-foreground flex-1 flex items-center gap-1">
        {label}
        {info && <InfoButton info={info} />}
      </span>
      <div className="w-[90px] flex items-center">
        <div
          className={cn("h-2.5 rounded-sm min-w-[3px]", color)}
          style={{ width: `${width}px`, opacity: type === "base" ? 1 : 0.8 }}
        />
      </div>
      <span
        className={cn(
          "text-[11.5px] font-bold w-10 text-right tabular-nums",
          textColor,
        )}
      >
        {displayVal}
      </span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-6 w-56 mb-2" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      {/* EBITDA Stack Card */}
      <Card className="overflow-hidden">
        <div className="px-4 py-2 border-b border-border">
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="px-4 py-2 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between py-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
          <div className="border-t border-border pt-2 flex justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </Card>

      {/* 3 Column Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-28 mb-3" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>

      {/* Value Progression */}
      <Card className="p-4">
        <Skeleton className="h-3 w-36 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center space-y-2">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-4 w-20 mx-auto" />
            </div>
          ))}
        </div>
      </Card>

      {/* Quality + Multiple row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Card className="p-4">
          <Skeleton className="h-3 w-28 mb-3" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <Skeleton className="h-3 w-32 mb-3" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───

export default function EbitdaValuation() {
  const { valuation: d, isLoading, settingsApi } = useEbitdaValuation();
  const { can } = usePermissions();
  const { selectedLocationId, dateRange } = useFilters();
  const { allAvailableLocations } = useLocations();
  const selectedLocationName = selectedLocationId
    ? (allAvailableLocations?.find((l) => l.id === selectedLocationId)
        ?.location_name ?? "Selected location")
    : "All locations";

  const aiContextData = useMemo(() => {
    if (!d) return { page: "ebitda-valuation", selectedLocationName };
    return {
      page: "ebitda-valuation",
      selectedLocationName,
      period: {
        startDate: dateRange.startDate.toISOString().slice(0, 10),
        endDate: dateRange.endDate.toISOString().slice(0, 10),
      },
      dataSource: d.dataSource,
      totalRevenue: r2(d.totalRevenue),
      reportedEBITDA: r2(d.reportedEBITDA),
      adjustedEBITDA: r2(d.adjustedEBITDA),
      sustainableEBITDA: r2(d.sustainableEBITDA),
      sustainabilityImpact: r2(d.sustainability.totalImpact),
      multiple: r2(d.multiple.finalMultiple),
      enterpriseValue: r2(d.enterpriseValue),
      netDebt: r2(d.netDebt),
      equityValue: r2(d.equityValue),
      qualityScore: d.quality.finalScore,
      qualityScores: d.quality.scores.map((s) => ({
        label: s.label,
        value: s.value,
        weight: r2(s.weight),
      })),
      multipleWaterfall: d.multiple.waterfall.map((w) => ({
        label: w.label,
        value: r2(w.value),
        type: w.type,
      })),
      keyDrivers: d.keyDrivers.map((k) => ({
        label: k.label,
        actual: k.actual,
        status: k.status,
        color: k.color,
      })),
      valueProgression: {
        baseline: {
          value: r2(d.valueProgression.baseline.value),
          ebitda: r2(d.valueProgression.baseline.ebitda),
          multiple: r2(d.valueProgression.baseline.multiple),
        },
        optimised: {
          value: r2(d.valueProgression.optimised.value),
          ebitda: r2(d.valueProgression.optimised.ebitda),
          multiple: r2(d.valueProgression.optimised.multiple),
        },
        opportunity: r2(d.valueProgression.opportunity),
      },
    };
  }, [d, selectedLocationName, dateRange]);

  const canUpdateQuality = can(
    "ebitda_to_value",
    "update",
    "quality_score_tab",
  );
  const canUpdateMultiple = can(
    "ebitda_to_value",
    "update",
    "multiple_engine_tab",
  );
  const [editingBase, setEditingBase] = useState(false);
  const [baseInput, setBaseInput] = useState("");
  const [editingWeights, setEditingWeights] = useState(false);
  const [weightInputs, setWeightInputs] = useState<QualityWeights>(
    DEFAULT_QUALITY_WEIGHTS,
  );

  const { tabs: ebitdaTabs, canViewTab } = useTabPermissions("ebitda_to_value");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");

  const mergedDefaultTab = useMemo<MergedTab | undefined>(
    () =>
      MERGED_TABS.find((t) => ebitdaTabs.find((et) => et.key === t)?.visible),
    [ebitdaTabs],
  );

  const resolveInitialTab = (): MergedTab => {
    if (
      tabFromUrl &&
      (MERGED_TABS as readonly string[]).includes(tabFromUrl) &&
      canViewTab(tabFromUrl)
    ) {
      return tabFromUrl as MergedTab;
    }
    return mergedDefaultTab ?? "enterprise-overview";
  };
  const [activeTab, setActiveTab] = useState<MergedTab>(resolveInitialTab);

  useEffect(() => {
    if (
      tabFromUrl &&
      tabFromUrl !== activeTab &&
      (MERGED_TABS as readonly string[]).includes(tabFromUrl) &&
      canViewTab(tabFromUrl)
    ) {
      setActiveTab(tabFromUrl as MergedTab);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (mergedDefaultTab && !canViewTab(activeTab)) {
      setActiveTab(mergedDefaultTab);
    }
  }, [mergedDefaultTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as MergedTab);
    setSearchParams({ tab }, { replace: true });
  };

  if (isLoading || !d) {
    return (
      <MainLayout>
        <Helmet>
          <title>EBITDA-to-Value | DentPulse</title>
        </Helmet>
        <LoadingSkeleton />
      </MainLayout>
    );
  }

  const qualityScore = d.quality.finalScore;
  const qualityHsl = scoreHsl(qualityScore);
  const qualityLabel =
    qualityScore >= 80
      ? "Premium"
      : qualityScore >= 65
        ? "Amber Risk"
        : qualityScore >= 50
          ? "Moderate Risk"
          : "High Risk";
  const belowTargetCount = d.quality.scores.filter((s) => s.value < 75).length;
  const qualityInfoDynamic = buildQualityInfo(d.qualityInputs);

  // Gauge calculations
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (qualityScore / 100) * circumference;

  // Base multiple for waterfall bar widths
  const baseMultipleValue =
    d.multiple.waterfall.length > 0 ? d.multiple.waterfall[0].value : 5.8;

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>EBITDA-to-Value | DentPulse</title>
        <meta
          name="description"
          content="Enterprise value overview with EBITDA quality scoring and valuation analysis"
        />
      </Helmet>

      <TooltipProvider>
        <div className="space-y-4">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Enterprise Value Overview
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                EBITDA-to-Value™ analysis
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canViewTab("generate-pdf") && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Download Business Valuation Report
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[90vw] max-h-[90vh] flex flex-col gap-0 p-0">
                    <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
                      <DialogTitle className="text-lg font-semibold">
                        Download Business Valuation Report
                      </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-auto">
                      <GeneratePdfContent />
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="space-y-4"
          >
            <TabsList>
              {canViewTab("enterprise-overview") && (
                <TabsTrigger value="enterprise-overview">Overview</TabsTrigger>
              )}
              {canViewTab("due-diligence") && (
                <TabsTrigger value="due-diligence">Due Diligence</TabsTrigger>
              )}
              {canViewTab("group-heatmap") && (
                <TabsTrigger value="group-heatmap">Group Heatmap</TabsTrigger>
              )}
              {canViewTab("exit-cockpit") && (
                <TabsTrigger value="exit-cockpit">Exit Cockpit™</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="enterprise-overview" className="space-y-4">
              {/* ZONE 1: EBITDA Stack */}
              <Card className="overflow-hidden">
                {/* Header */}
                <div className="px-4 py-2 border-b border-border flex items-center gap-1.5">
                  <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                    EBITDA Stack
                  </span>
                  <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">
                    {d.dataSource}
                  </span>
                </div>

                {/* All rows in one tight table */}
                <div className="px-4 py-3 text-sm">
                  {/* Revenue — Profitability Production Income */}
                  <div className="flex justify-between py-1.5">
                    <span className="text-foreground font-bold text-base">
                      Revenue
                      <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                        (Production Income)
                      </span>
                    </span>
                    <span className="tabular-nums font-bold text-base">
                      {formatCurrency(d.totalRevenue)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 pl-4">
                    <span className="text-muted-foreground">
                      Costs of Treatment Delivery
                    </span>
                    <span className="tabular-nums text-danger">
                      -{formatCurrency(d.treatmentCost)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 pl-4">
                    <span className="text-muted-foreground">
                      Expenses to Run Your Business
                    </span>
                    <span className="tabular-nums text-danger">
                      -{formatCurrency(d.operatingExpense)}
                    </span>
                  </div>

                  {/* Net Profit */}
                  <div className="flex justify-between py-2 mt-1.5 border-t border-border/60">
                    <span className="font-semibold text-foreground flex items-center gap-1">
                      Profit
                      <InfoButton
                        info={{
                          description:
                            "Same Actual Profit as Profitability — Production Income minus Costs of Treatment Delivery and Expenses to Run Your Business.",
                          calculation: `Revenue (${formatCurrency(d.totalRevenue)}) − Cost (${formatCurrency(d.treatmentCost)}) − Expense (${formatCurrency(d.operatingExpense)}) = ${formatCurrency(d.netProfit)}`,
                        }}
                      />
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(d.netProfit)}
                    </span>
                  </div>

                  {/* EBITDA Impact add-backs */}
                  {(d.ebitdaImpact.depreciation > 0 ||
                    d.ebitdaImpact.amortisation > 0 ||
                    d.ebitdaImpact.interest > 0 ||
                    d.ebitdaImpact.tax > 0) && (
                    <>
                      {d.ebitdaImpact.depreciation > 0 && (
                        <div className="flex justify-between py-1 pl-4">
                          <span className="text-muted-foreground">
                            + Depreciation
                          </span>
                          <span className="tabular-nums text-emerald-600">
                            +{formatCurrency(d.ebitdaImpact.depreciation)}
                          </span>
                        </div>
                      )}
                      {d.ebitdaImpact.amortisation > 0 && (
                        <div className="flex justify-between py-1 pl-4">
                          <span className="text-muted-foreground">
                            + Amortisation
                          </span>
                          <span className="tabular-nums text-emerald-600">
                            +{formatCurrency(d.ebitdaImpact.amortisation)}
                          </span>
                        </div>
                      )}
                      {d.ebitdaImpact.interest > 0 && (
                        <div className="flex justify-between py-1 pl-4">
                          <span className="text-muted-foreground">
                            + Interest
                          </span>
                          <span className="tabular-nums text-emerald-600">
                            +{formatCurrency(d.ebitdaImpact.interest)}
                          </span>
                        </div>
                      )}
                      {d.ebitdaImpact.tax > 0 && (
                        <div className="flex justify-between py-1 pl-4">
                          <span className="text-muted-foreground">+ Tax</span>
                          <span className="tabular-nums text-emerald-600">
                            +{formatCurrency(d.ebitdaImpact.tax)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {d.ebitdaImpact.total === 0 && (
                    <div className="flex justify-between py-1 pl-4">
                      <span className="text-muted-foreground text-[11px]">
                        EBITDA Impact
                        <span className="ml-1 text-muted-foreground/70">
                          (map D/A/I/T in Setup Categories → EBITDA)
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCurrency(0)}
                      </span>
                    </div>
                  )}

                  {/* Reported EBITDA */}
                  <div className="flex justify-between py-2 mt-1.5 border-t border-foreground/15">
                    <span className="font-bold text-foreground flex items-center gap-1">
                      Reported EBITDA
                      <InfoButton
                        info={{
                          description:
                            "Matches Profitability → EBITDA Impact: Profit plus Depreciation, Amortisation, Interest and Tax add-backs from Setup Categories.",
                          calculation: `Profit (${formatCurrency(d.netProfit)}) + EBITDA Impact (${formatCurrency(d.ebitdaImpact.total)}) = ${formatCurrency(d.reportedEBITDA)}`,
                        }}
                      />
                    </span>
                    <span className="font-bold tabular-nums text-foreground text-base">
                      {formatCurrency(d.reportedEBITDA)}
                    </span>
                  </div>

                  {/* Normalisation */}
                  {d.normalisationItems.length > 0 &&
                    d.normalisationItems.map((item, i) => (
                      <div key={i} className="flex justify-between py-1 pl-4">
                        <span className="text-muted-foreground">
                          {item.label}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            item.value > 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {item.value > 0 ? "+" : ""}
                          {formatCurrency(item.value)}
                        </span>
                      </div>
                    ))}
                  {d.normalisationItems.length === 0 && (
                    <div className="flex justify-between py-0.5 pl-3">
                      <span className="text-muted-foreground/50 italic text-[11px]">
                        No normalisation adjustments
                      </span>
                      <span className="text-muted-foreground/50 tabular-nums">
                        —
                      </span>
                    </div>
                  )}

                  {/* Adjusted EBITDA */}
                  <div className="flex justify-between py-2 mt-1.5 border-t border-foreground/15">
                    <span className="font-bold text-foreground flex items-center gap-1">
                      Adjusted EBITDA
                      <InfoButton
                        info={{
                          description:
                            "Reported EBITDA plus any normalisation adjustments (one-off items added back or removed to reflect recurring earnings).",
                          calculation: `Reported EBITDA (${formatCurrency(d.reportedEBITDA)}) ${d.netAdjustments >= 0 ? "+" : "−"} Normalisation (${formatCurrency(Math.abs(d.netAdjustments))}) = ${formatCurrency(d.adjustedEBITDA)}`,
                        }}
                      />
                    </span>
                    <span className="font-bold tabular-nums text-foreground text-base">
                      {formatCurrency(d.adjustedEBITDA)}
                    </span>
                  </div>

                  {/* Sustainability Haircuts */}
                  {d.sustainability.items.map((item, i) => (
                    <div key={i} className="pl-4 py-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          {item.label}
                          {item.confidence && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-warning-muted text-warning leading-none">
                              {item.confidence}
                            </span>
                          )}
                          <InfoButton
                            info={{
                              description: item.confidence
                                ? `Confidence-weighted adjustment. The raw amount is multiplied by the confidence percentage to produce a risk-adjusted value.`
                                : item.label.includes("departure")
                                  ? "Risk of the top-earning associate leaving, which would remove their revenue contribution."
                                  : item.label.includes("Utilisation")
                                    ? "Potential revenue gain from increasing chair utilisation to target levels."
                                    : item.label.includes("ramp")
                                      ? "Expected revenue from a new associate ramping up, weighted by confidence."
                                      : item.label.includes("clawback") ||
                                          item.label.includes("UDA")
                                        ? "Risk of NHS clawback due to under-delivery of UDA targets."
                                        : item.label.includes("downtime")
                                          ? "Revenue lost due to chairs sitting idle below full utilisation."
                                          : "Manual sustainability adjustment entered by the user.",
                              calculation:
                                item.description || "Manual adjustment",
                            }}
                          />
                        </span>
                        <span
                          className={cn(
                            "tabular-nums font-medium flex-shrink-0 ml-2",
                            item.value > 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {item.value > 0 ? "+" : ""}
                          {formatCurrency(item.value)}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-[9.5px] text-muted-foreground/50 font-mono mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  ))}
                  {d.sustainability.items.length === 0 && (
                    <div className="flex justify-between py-0.5 pl-3">
                      <span className="text-muted-foreground/50 italic text-[11px]">
                        No sustainability haircuts
                      </span>
                      <span className="text-muted-foreground/50 tabular-nums">
                        —
                      </span>
                    </div>
                  )}

                  {/* Sustainable EBITDA */}
                  <div className="flex justify-between py-2.5 mt-1.5 border-t-2 border-foreground/20">
                    <span className="font-bold text-base text-foreground flex items-center gap-1">
                      Sustainable EBITDA
                      <InfoButton
                        info={{
                          description:
                            "Adjusted EBITDA after sustainability haircuts — risk-adjusted deductions for associate departure, chair downtime, NHS clawback, etc. This is what a buyer would use for valuation.",
                          calculation: `Adjusted EBITDA (${formatCurrency(d.adjustedEBITDA)}) ${d.sustainability.totalImpact >= 0 ? "+" : "−"} Sustainability (${formatCurrency(Math.abs(d.sustainability.totalImpact))}) = ${formatCurrency(d.sustainableEBITDA)}`,
                        }}
                      />
                    </span>
                    <span className="font-bold text-lg tabular-nums text-foreground">
                      {formatCurrency(d.sustainableEBITDA)}
                    </span>
                  </div>
                </div>

                {/* Anchor bar — 3 cards */}
                <div className="bg-primary grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 px-5 py-5">
                  <Card className="px-6 py-5 text-center flex flex-col items-center justify-center bg-white border-white/80">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-1.5">
                      Sustainable EBITDA™
                    </span>
                    <span className="text-[44px] font-bold text-foreground tabular-nums leading-none tracking-tight">
                      {formatCompact(d.sustainableEBITDA)}
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Risk-adjusted earnings
                    </p>
                  </Card>
                  <span className="text-xl font-bold text-white/50">×</span>
                  <Card className="px-6 py-5 text-center flex flex-col items-center justify-center bg-white border-white/80">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-1.5">
                      Multiple
                    </span>
                    <span className="text-[44px] font-bold text-foreground tabular-nums leading-none tracking-tight">
                      {d.multiple.finalMultiple}×
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Risk-adjusted buyer view
                    </p>
                  </Card>
                  <span className="text-xl font-bold text-white/50">=</span>
                  <Card className="px-6 py-5 text-center flex flex-col items-center justify-center bg-white border-2 border-primary">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-primary mb-1.5">
                      Enterprise Value
                    </span>
                    <span className="text-[44px] font-bold text-primary tabular-nums leading-none tracking-tight">
                      {formatCompact(d.enterpriseValue)}
                    </span>
                    <p className="text-[11px] text-primary/70 mt-1">
                      Sustainable EBITDA™ × Multiple
                    </p>
                  </Card>
                </div>
              </Card>

              {/* ZONE 2: Three Column Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
                {/* Enterprise Value Card */}
                <Card className="p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                      Enterprise Value
                    </span>
                    <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">
                      DentPulse model
                    </span>
                  </div>
                  <div className="text-[44px] font-bold text-foreground leading-none tabular-nums tracking-tight">
                    {formatCompact(d.enterpriseValue)}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground mt-1.5">
                    Sustainable EBITDA™ {formatCompact(d.sustainableEBITDA)} ×{" "}
                    {d.multiple.finalMultiple}× multiple
                  </p>
                  <div className="mt-3.5 pt-3 border-t border-border space-y-0">
                    <div className="flex justify-between items-baseline py-1.5 border-b border-border">
                      <span className="text-xs text-muted-foreground">
                        Enterprise Value
                      </span>
                      <span className="text-xs font-semibold tabular-nums">
                        {formatCurrency(d.enterpriseValue)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5 border-b border-border">
                      <span className="text-xs text-muted-foreground">
                        Less: Net Debt
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-danger">
                        {d.netDebt > 0 ? "-" : ""}
                        {formatCurrency(d.netDebt)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5">
                      <span className="text-xs font-semibold">
                        Equity Value
                      </span>
                      <span className="text-[15px] font-bold tabular-nums text-primary">
                        {formatCurrency(d.equityValue)}
                      </span>
                    </div>
                  </div>
                  <div className="text-[9px] text-muted-foreground font-mono mt-2.5 leading-relaxed">
                    {formatCurrency(d.enterpriseValue)} −{" "}
                    {formatCurrency(d.netDebt)} ={" "}
                    {formatCurrency(d.equityValue)} equity
                  </div>
                </Card>

                {/* Quality Score Card */}
                <Card className="p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                      EBITDA Quality Score™
                    </span>
                    <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">
                      DentPulse model
                    </span>
                  </div>
                  <div className="flex items-center gap-3.5 mb-3">
                    {/* Gauge */}
                    <div className="relative w-[86px] h-[86px] flex-shrink-0">
                      <svg width="86" height="86" viewBox="0 0 86 86">
                        <circle
                          cx="43"
                          cy="43"
                          r={radius}
                          fill="none"
                          stroke="hsl(var(--border))"
                          strokeWidth="7"
                        />
                        <circle
                          cx="43"
                          cy="43"
                          r={radius}
                          fill="none"
                          stroke={qualityHsl}
                          strokeWidth="7"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={dashOffset}
                          transform="rotate(-90 43 43)"
                          className="transition-all duration-700"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span
                          className="text-xl font-bold tabular-nums"
                          style={{ color: qualityHsl }}
                        >
                          {qualityScore}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          /100
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      <div
                        className="font-semibold mb-0.5"
                        style={{ color: qualityHsl }}
                      >
                        {qualityLabel}
                      </div>
                      <div>Investor threshold: 75+</div>
                      <div>
                        {belowTargetCount} sub-score
                        {belowTargetCount !== 1 ? "s" : ""} below target
                      </div>
                      <div className="mt-1 italic">
                        Investor view of earnings reliability
                      </div>
                    </div>
                  </div>
                  {/* Score bars */}
                  <div>
                    {d.quality.scores.map((s) => (
                      <ScoreBar
                        key={s.label}
                        label={s.label}
                        value={s.value}
                        weight={s.weight}
                        infoOverride={qualityInfoDynamic[s.label]}
                        onWeightClick={() => {
                          if (!editingWeights) {
                            setWeightInputs(
                              settingsApi.current.quality_weights,
                            );
                            setEditingWeights(true);
                          }
                        }}
                      />
                    ))}
                  </div>
                  {/* Weight editing inline */}
                  <div className="mt-3 pt-2 border-t border-border">
                    {!editingWeights ? (
                      canUpdateQuality ? (
                        <button
                          onClick={() => {
                            setWeightInputs(
                              settingsApi.current.quality_weights,
                            );
                            setEditingWeights(true);
                          }}
                          className="relative flex items-center gap-1.5 text-[10px] font-medium text-primary hover:text-primary/80 px-2.5 py-1.5 rounded-md overflow-hidden transition-colors"
                          type="button"
                        >
                          {/* Spinning border gradient */}
                          <span className="absolute inset-0 rounded-md overflow-hidden">
                            <span
                              className="absolute animate-spin"
                              style={{
                                inset: "-1000%",
                                background:
                                  "conic-gradient(hsl(var(--primary)), transparent 20%, hsl(var(--primary)))",
                                animationDuration: "3s",
                              }}
                            />
                          </span>
                          <span className="absolute inset-[1.5px] rounded-[5px] bg-background" />
                          <Pencil className="w-2.5 h-2.5 relative z-10" />
                          <span className="relative z-10">Adjust weights</span>
                          <span className="relative z-10 text-[9px] text-muted-foreground font-normal">
                            (must total 100%)
                          </span>
                        </button>
                      ) : null
                    ) : (
                      <div className="space-y-1.5">
                        {d.quality.scores.map((s) => {
                          const key = LABEL_TO_WEIGHT_KEY[s.label];
                          if (!key) return null;
                          return (
                            <div
                              key={s.label}
                              className="flex items-center gap-1.5"
                            >
                              <span className="text-[10px] text-muted-foreground flex-1 truncate">
                                {s.label}
                              </span>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="100"
                                value={Math.round(weightInputs[key] * 100)}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setWeightInputs((prev) => ({
                                    ...prev,
                                    [key]: val / 100,
                                  }));
                                }}
                                className="w-11 h-5 text-[10px] text-right border border-border rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <span className="text-[10px] text-muted-foreground">
                                %
                              </span>
                            </div>
                          );
                        })}
                        {(() => {
                          const total = Object.values(weightInputs).reduce(
                            (s, v) => s + v,
                            0,
                          );
                          const totalPct = Math.round(total * 100);
                          const isValid = totalPct === 100;
                          return (
                            <div className="flex items-center justify-between pt-1.5">
                              <span
                                className={cn(
                                  "text-[10px] font-semibold",
                                  isValid ? "text-success" : "text-danger",
                                )}
                              >
                                Total: {totalPct}%
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => setEditingWeights(false)}
                                  className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
                                  type="button"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    if (isValid) {
                                      settingsApi.update({
                                        quality_weights: weightInputs,
                                      });
                                      setEditingWeights(false);
                                    }
                                  }}
                                  disabled={!isValid}
                                  className={cn(
                                    "text-[10px] px-2 py-0.5 rounded font-medium",
                                    isValid
                                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                      : "bg-muted text-muted-foreground cursor-not-allowed",
                                  )}
                                  type="button"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </Card>

                {/* Valuation Multiple Card */}
                <Card className="p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                      Valuation Multiple
                    </span>
                    <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">
                      DentPulse model
                    </span>
                  </div>
                  <div>
                    {d.multiple.waterfall.map((item) =>
                      item.type === "base" ? (
                        <div
                          key={item.label}
                          className="flex items-center gap-2 py-1"
                        >
                          <span className="text-[11.5px] text-muted-foreground flex-1 flex items-center gap-1">
                            {item.label}
                            {MULTIPLE_INFO[item.label] && (
                              <InfoButton info={MULTIPLE_INFO[item.label]} />
                            )}
                            {!editingBase ? (
                              <button
                                onClick={() => {
                                  setBaseInput(String(item.value));
                                  setEditingBase(true);
                                }}
                                className="text-muted-foreground/40 hover:text-primary transition-colors"
                                type="button"
                                title="Edit base multiple"
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                            ) : null}
                          </span>
                          {editingBase ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.1"
                                  min="3.0"
                                  max="8.0"
                                  value={baseInput}
                                  onChange={(e) => setBaseInput(e.target.value)}
                                  className="w-14 h-6 text-[11.5px] font-bold text-right tabular-nums border border-border rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = parseFloat(baseInput);
                                      if (
                                        !isNaN(val) &&
                                        val >= 3.0 &&
                                        val <= 8.0
                                      ) {
                                        settingsApi.update({
                                          base_multiple:
                                            Math.round(val * 10) / 10,
                                        });
                                      }
                                      setEditingBase(false);
                                    } else if (e.key === "Escape") {
                                      setEditingBase(false);
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const val = parseFloat(baseInput);
                                    if (
                                      !isNaN(val) &&
                                      val >= 3.0 &&
                                      val <= 8.0
                                    ) {
                                      settingsApi.update({
                                        base_multiple:
                                          Math.round(val * 10) / 10,
                                      });
                                    }
                                    setEditingBase(false);
                                  }}
                                  className="text-success hover:text-success/80"
                                  type="button"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => setEditingBase(false)}
                                  className="text-danger hover:text-danger/80"
                                  type="button"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="mt-1.5 p-1.5 bg-muted/50 rounded border border-border/50">
                                <div className="text-[7.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                  Also updates
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1 text-[8.5px]">
                                    <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                    <span className="text-muted-foreground">
                                      Below
                                    </span>
                                    <span className="text-muted-foreground/40">
                                      &rarr;
                                    </span>
                                    <span className="font-medium text-foreground">
                                      Final Multiple
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[8.5px]">
                                    <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                    <span className="text-muted-foreground">
                                      Left card
                                    </span>
                                    <span className="text-muted-foreground/40">
                                      &rarr;
                                    </span>
                                    <span className="font-medium text-foreground">
                                      Enterprise Value &amp; Equity Value
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[8.5px]">
                                    <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                    <span className="text-muted-foreground">
                                      Multiple Engine
                                    </span>
                                    <span className="text-muted-foreground/40">
                                      &rarr;
                                    </span>
                                    <span className="font-medium text-foreground">
                                      Base Market &amp; Waterfall
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[8.5px]">
                                    <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                    <span className="text-muted-foreground">
                                      Value Progression
                                    </span>
                                    <span className="text-muted-foreground/40">
                                      &rarr;
                                    </span>
                                    <span className="font-medium text-foreground">
                                      Baseline &amp; Optimised
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="w-[90px] flex items-center">
                                <div
                                  className={cn(
                                    "h-2.5 rounded-sm min-w-[3px] bg-foreground",
                                  )}
                                  style={{
                                    width: `${(Math.abs(item.value) / (baseMultipleValue || 5.8)) * 80}px`,
                                  }}
                                />
                              </div>
                              <span className="text-[11.5px] font-bold w-10 text-right tabular-nums text-foreground">
                                {item.value}×
                              </span>
                            </>
                          )}
                        </div>
                      ) : (
                        <WaterfallRow
                          key={item.label}
                          label={item.label}
                          value={item.value}
                          type={item.type}
                          baseValue={baseMultipleValue}
                        />
                      ),
                    )}
                    {/* Final Multiple */}
                    <div className="flex items-center gap-2 py-1.5 border-t border-border mt-1 pt-2">
                      <span className="text-[11.5px] font-bold text-foreground flex-1">
                        Final Multiple
                      </span>
                      <div className="w-[90px] flex items-center">
                        <div
                          className="h-2.5 rounded-sm bg-primary"
                          style={{
                            width: `${(d.multiple.finalMultiple / baseMultipleValue) * 80}px`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold w-10 text-right tabular-nums text-primary">
                        {d.multiple.finalMultiple}×
                      </span>
                    </div>
                  </div>
                  <p className="text-[9.5px] text-muted-foreground italic mt-2.5 pt-2 border-t border-border">
                    "Multiple is not given. It is earned."
                  </p>
                </Card>
              </div>

              {/* ZONE 3: Value Progression + Key Drivers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {/* Value Progression */}
                <Card className="overflow-hidden">
                  <div className="px-4 py-2 border-b border-border">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                      Value Progression
                    </span>
                  </div>

                  {/* Baseline vs Optimised comparison */}
                  <div className="px-4 py-3">
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-0 items-center mb-3">
                      {/* Baseline */}
                      <div className="text-center">
                        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                          Today
                        </div>
                        <div className="text-[20px] font-bold text-foreground tabular-nums leading-tight">
                          {formatCompact(d.valueProgression.baseline.value)}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatCompact(d.valueProgression.baseline.ebitda)} ×{" "}
                          {d.valueProgression.baseline.multiple}×
                        </div>
                      </div>
                      {/* Arrow */}
                      <div className="flex flex-col items-center px-3">
                        <div className="text-[10px] font-bold text-success">
                          +{formatCompact(d.valueProgression.opportunity)}
                        </div>
                        <div className="text-muted-foreground/40 text-lg leading-none">
                          &rarr;
                        </div>
                      </div>
                      {/* Optimised */}
                      <div className="text-center">
                        <div className="text-[9px] font-bold text-primary uppercase tracking-wider mb-1">
                          Optimised
                        </div>
                        <div className="text-[20px] font-bold text-primary tabular-nums leading-tight">
                          {formatCompact(d.valueProgression.optimised.value)}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatCompact(d.valueProgression.optimised.ebitda)} ×{" "}
                          {d.valueProgression.optimised.multiple}×
                        </div>
                      </div>
                    </div>

                    {/* Value impact breakdown — adds up to opportunity */}
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center justify-between text-[11px] py-1 px-2 bg-muted/50 rounded-md">
                        <span className="text-muted-foreground flex items-center gap-1">
                          EBITDA uplift{" "}
                          <span className="text-[9px] opacity-60">
                            (+{formatCompact(d.valueProgression.ebitdaGain)} ×{" "}
                            {d.valueProgression.baseline.multiple}×)
                          </span>
                          <InfoButton
                            info={{
                              description:
                                "Value gained from improving sustainable EBITDA through operational improvements (chair utilisation, associate dependency, treatment mix), while keeping the current multiple constant.",
                              calculation: `Optimised EBITDA = Current EBITDA (${formatCurrency(d.valueProgression.baseline.ebitda)}) × (1 + improvement%). EBITDA Gain = Optimised (${formatCurrency(d.valueProgression.optimised.ebitda)}) − Current (${formatCurrency(d.valueProgression.baseline.ebitda)}) = ${formatCurrency(d.valueProgression.ebitdaGain)}. EBITDA Uplift = ${formatCurrency(d.valueProgression.ebitdaGain)} × ${d.valueProgression.baseline.multiple}× (current multiple) = ${formatCurrency(d.valueProgression.ebitdaValueImpact)}.`,
                            }}
                          />
                        </span>
                        <span className="font-semibold text-success tabular-nums">
                          +{formatCompact(d.valueProgression.ebitdaValueImpact)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] py-1 px-2 bg-muted/50 rounded-md">
                        <span className="text-muted-foreground flex items-center gap-1">
                          Multiple uplift{" "}
                          <span className="text-[9px] opacity-60">
                            ({formatCompact(d.valueProgression.baseline.ebitda)}{" "}
                            × +{d.valueProgression.multipleGain}×)
                          </span>
                          <InfoButton
                            info={{
                              description:
                                "Value gained from improving the quality score (by hitting targets on chair utilisation, associate dependency, private mix, cash conversion, NHS delivery), which increases the valuation multiple applied to the current EBITDA.",
                              calculation: `Multiple Gain = Optimised Multiple (${d.valueProgression.optimised.multiple}×) − Current Multiple (${d.valueProgression.baseline.multiple}×) = +${d.valueProgression.multipleGain}×. Multiple Uplift = Current EBITDA (${formatCurrency(d.valueProgression.baseline.ebitda)}) × ${d.valueProgression.multipleGain}× = ${formatCurrency(d.valueProgression.multipleValueImpact)}.`,
                            }}
                          />
                        </span>
                        <span className="font-semibold text-success tabular-nums">
                          +
                          {formatCompact(
                            d.valueProgression.multipleValueImpact,
                          )}
                        </span>
                      </div>
                      {d.valueProgression.combinedEffect > 0 && (
                        <div className="flex items-center justify-between text-[11px] py-1 px-2 bg-muted/50 rounded-md">
                          <span className="text-muted-foreground flex items-center gap-1">
                            Cross-product bonus{" "}
                            <span className="text-[9px] opacity-60">
                              (+{formatCompact(d.valueProgression.ebitdaGain)} ×
                              +{d.valueProgression.multipleGain}×)
                            </span>
                            <InfoButton
                              info={{
                                description:
                                  "When both EBITDA and the multiple improve at the same time, the extra EBITDA also gets multiplied by the higher multiple. This bonus only exists because both improved together.",
                                calculation: `EBITDA Gain (${formatCurrency(d.valueProgression.ebitdaGain)}) × Multiple Gain (${d.valueProgression.multipleGain}×) = ${formatCurrency(d.valueProgression.combinedEffect)}. Total = EBITDA Uplift (${formatCurrency(d.valueProgression.ebitdaValueImpact)}) + Multiple Uplift (${formatCurrency(d.valueProgression.multipleValueImpact)}) + Cross-product (${formatCurrency(d.valueProgression.combinedEffect)}) = ${formatCurrency(d.valueProgression.opportunity)}.`,
                              }}
                            />
                          </span>
                          <span className="font-semibold text-success tabular-nums">
                            +{formatCompact(d.valueProgression.combinedEffect)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[11px] py-1 px-2 bg-foreground rounded-md">
                        <span className="font-semibold text-background">
                          Total Opportunity
                        </span>
                        <span className="font-bold text-background tabular-nums">
                          +{formatCompact(d.valueProgression.opportunity)}
                        </span>
                      </div>
                    </div>

                    {/* What needs to improve */}
                    {d.valueProgression.drivers.length > 0 && (
                      <div>
                        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                          How to get there
                        </div>
                        <div className="space-y-0">
                          {d.valueProgression.drivers.map((driver) => (
                            <div
                              key={driver.label}
                              className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-b-0"
                            >
                              <div className="w-1 h-1 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <span className="font-medium text-foreground">
                                    {driver.label}
                                  </span>
                                  <span className="text-muted-foreground/50">
                                    {driver.from}
                                  </span>
                                  <span className="text-muted-foreground/30">
                                    &rarr;
                                  </span>
                                  <span className="font-semibold text-primary">
                                    {driver.to}
                                  </span>
                                </div>
                                <p className="text-[9.5px] text-muted-foreground/60 leading-snug">
                                  {driver.impact}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Key Value Drivers */}
                <Card className="overflow-hidden">
                  <div className="px-4 py-2 border-b border-border">
                    <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                      Key Value Drivers
                    </span>
                  </div>
                  <div className="px-4 py-1 text-[12px]">
                    {d.keyDrivers.map((driver) => (
                      <div
                        key={driver.label}
                        className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "w-1.5 h-1.5 rounded-full flex-shrink-0",
                              statusColors[driver.color].dot,
                            )}
                          />
                          <div>
                            <div className="font-medium text-foreground">
                              {driver.label}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {driver.description}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
                          <span className="font-semibold tabular-nums text-foreground">
                            {driver.actual}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full min-w-[70px] text-center",
                              statusColors[driver.color].tag,
                            )}
                          >
                            {driver.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Data Traceability Strip */}
              <div className="flex flex-wrap gap-4 p-2.5 px-3.5 bg-muted/50 rounded-lg border border-border text-[10.5px] text-muted-foreground">
                <span>
                  <strong className="text-foreground/70">EBITDA</strong> →{" "}
                  {d.dataSource}
                </span>
                <span>
                  <strong className="text-foreground/70">PMS</strong> → Dentally
                </span>
                <span>
                  <strong className="text-foreground/70">Adjustments</strong> →{" "}
                  {d.normalisationItems.length > 0
                    ? "Finance Team"
                    : "None configured"}
                </span>
                <span>
                  <strong className="text-foreground/70">Multiple</strong> →
                  DentPulse Model
                </span>
              </div>
            </TabsContent>

            <TabsContent value="exit-cockpit" className="space-y-4">
              <ExitCockpitContent />
            </TabsContent>

            <TabsContent value="due-diligence" className="space-y-4">
              <DueDiligenceContent />
            </TabsContent>

            <TabsContent value="group-heatmap" className="space-y-4">
              <GroupHeatmapContent />
            </TabsContent>
          </Tabs>
        </div>
      </TooltipProvider>
    </MainLayout>
  );
}
