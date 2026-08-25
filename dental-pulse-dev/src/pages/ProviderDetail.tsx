import React from "react";
import { Helmet } from "react-helmet-async";
import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipArrow,
} from "@/components/ui/tooltip";
import { ChevronsUpDown } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatAmount, parseAmount } from "@/lib/utils";
import {
  useSlidingScales,
  type SlidingScaleBand,
  type ScaleType,
} from "@/hooks/useSlidingScales";
import { getOpCostByPlatform } from "@/services/integrations/plCostService";
import {
  loadProviderCostInputs,
  type ProviderCostInputRow,
} from "@/lib/providerCostInputs";
import {
  resolveProviderCost,
  isProductionScaledBasis,
  type ResolvedProviderCost,
} from "@/lib/providerCostResolution";
import { useLocationChartOfAccounts } from "@/hooks/useLocationChartOfAccounts";
import {
  getEffectivePerHourRate,
  PER_HOUR_EMPLOYEE_UPLIFT_PERCENT,
} from "@/lib/payslipCalculations";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import type {
  ProviderCostSourceMethod,
  ProviderCostAccountPlatform,
} from "@/types/provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ProgressBar } from "@/components/dashboard/ProgressBar";
import { Loader2 } from "lucide-react";
import { useProviders } from "@/hooks/useProviders";
import { useProviderTypes } from "@/hooks/useProviderTypes";
import { useLocations } from "@/hooks/useLocations";
import { useSpecialties } from "@/hooks/useSpecialties";
import { useTreatments } from "@/hooks/useTreatments";
import { AccountMultiSelect } from "@/components/settings/AccountMultiSelect";
import { useProviderWorkingHours } from "@/hooks/useProviderWorkingHours";
import { useAllProvidersCounts } from "@/hooks/useAllProvidersCounts";
import { useProviderNetProduction } from "@/hooks/useProviderNetProduction";
import { useProductionMetrics } from "@/hooks/useProductionMetrics";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from "recharts";
import {
  ArrowLeft,
  Users,
  UserPlus,
  Calendar as CalendarIcon,
  TrendingUp,
  Target,
  Award,
  Star,
  MapPin,
  Mail,
  X,
  Check,
  CheckCheck,
  Plus,
  Minus,
  Info,
  Copy,
  AlertCircle,
  Banknote,
  Activity,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  providerPerformsNhs,
  providerPerformsMos,
  encodeProviderAdditionalOptions,
  type WorkingDayScheduleType,
  type WorkingDaySchedule,
  type ProviderWorkingDays,
  type ProviderEmploymentType,
  type Provider,
} from "@/types/provider";
import { PayslipTab } from "@/components/providers/PayslipTab";
import { ContractAttachmentsCard } from "@/components/providers/ContractAttachmentsCard";
import { ContractHistoryCard } from "@/components/providers/ContractHistoryCard";
import { SpecialTreatmentsCard } from "@/components/providers/SpecialTreatmentsCard";
import { SlidingScaleBandEditor } from "@/components/providers/SlidingScaleBandEditor";
import { useProviderContracts } from "@/hooks/useProviderContracts";
import {
  format,
  isAfter,
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
import {
  toLocalYMD,
  ukDayStartInstant,
  ukDayEndInstant,
} from "@/utils/dateRangeUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DatePicker, ConfigProvider } from "antd";
import dayjs from "dayjs";

// Mock data removed - now using dynamic data from database

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// Helper function to generate color from string (for dynamic provider types)
const getTypeColor = (
  type: string,
  providerTypes: Array<{ code: string; name: string }>,
) => {
  // Try to find provider type and use a consistent color based on index
  const typeIndex = providerTypes.findIndex((pt) => pt.code === type);
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

const WORKING_DAYS: { key: string; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

// Resolved start/end times baked into the schedule when a preset is picked,
// so anything reading working_days later doesn't need to know the mapping.
const WORKING_DAY_PRESET_TIMES: Record<
  "full-day" | "morning-half" | "afternoon-half",
  { start: string; end: string }
> = {
  "full-day": { start: "09:00", end: "17:00" },
  "morning-half": { start: "09:00", end: "13:00" },
  "afternoon-half": { start: "13:00", end: "17:00" },
};

const DEFAULT_WORKING_DAYS: ProviderWorkingDays = WORKING_DAYS.reduce(
  (acc, day) => {
    acc[day.key] = {
      type: "off",
      startTime: null,
      endTime: null,
      treatmentIds: [],
    };
    return acc;
  },
  {} as ProviderWorkingDays,
);

export default function ProviderDetail() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { showDecimals } = useOrganizationSettings();
  const {
    dateRange: globalDateRange,
    selectedDateRangeId,
    selectedLocationId,
  } = useFilters();
  const [selectedPeriod, setSelectedPeriod] = useState("mtd");
  const {
    getProvider,
    updateProvider,
    isUpdating,
    providers: allProviders,
    providersByType,
  } = useProviders();
  const { activeProviderTypes } = useProviderTypes();
  const { locations } = useLocations();
  const { activeSpecialties } = useSpecialties();
  const { treatments: allTreatments } = useTreatments({
    includeInactive: true,
  });
  const treatmentOptions = useMemo(
    () => allTreatments.map((t) => ({ value: t.id, label: t.treatment_name })),
    [allTreatments],
  );
  const {
    slidingScales,
    getScalesByType,
    saveSlidingScale,
    isSaving,
    savingVariables,
    isLoading: isLoadingScales,
  } = useSlidingScales(id);

  // Settings state
  const [providerSettings, setProviderSettings] = useState({
    revenueTarget: 0,
    patientsTarget: 0,
    utilisationTarget: 90,
    newPatientsTarget: 0,
    recallRateTarget: 80,
  });

  // Income Type Mapping state (single selection)
  const [incomeTypes, setIncomeTypes] = useState({
    membershipIncome: null as string | null,
    nhsIncome: null as string | null,
  });

  // Chart of Accounts state
  const [chartOfAccounts, setChartOfAccounts] = useState<any[]>([]);
  const [mappedOrganization, setMappedOrganization] = useState<any>(null);
  const [isLoadingCOA, setIsLoadingCOA] = useState(false);
  // IDs of accounts allowed in each provider income dropdown (from location settings)
  const [providerMembershipAccountIds, setProviderMembershipAccountIds] =
    useState<string[]>([]);
  const [providerNhsAccountIds, setProviderNhsAccountIds] = useState<string[]>(
    [],
  );

  // Multi-select popover state
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [nhsOpen, setNhsOpen] = useState(false);

  // Date picker popover state
  const [joiningDateOpen, setJoiningDateOpen] = useState(false);
  const [leavingDateOpen, setLeavingDateOpen] = useState(false);
  const [netProductionStartDateOpen, setNetProductionStartDateOpen] =
    useState(false);
  const [netProductionEndDateOpen, setNetProductionEndDateOpen] =
    useState(false);
  const [contractStartDateOpen, setContractStartDateOpen] = useState(false);
  const [contractEndDateOpen, setContractEndDateOpen] = useState(false);
  const [contractConfirmOpen, setContractConfirmOpen] = useState(false);
  const [contractConfirmAction, setContractConfirmAction] = useState<
    "new" | "update" | null
  >(null);

  // Edit provider form state
  const [editFormData, setEditFormData] = useState({
    providerCode: "",
    name: "",
    role: "",
    originalRole: "", // Store original role from database
    primaryChair: "",
    email: "",
    phone: "",
    performsNhsTreatments: false,
    performsMosTreatments: false,
    isPrincipalAssociate: false,
    splitSourceMethod: "flat-percentage",
    associateSplitPercentage: 50,
    labSplitPercentage: 50,
    perCaseRate: 0,
    perHourRate: 0,
    employmentType: "self-employed" as ProviderEmploymentType,
    workingDays: DEFAULT_WORKING_DAYS as ProviderWorkingDays,
    joiningDate: null as Date | null,
    leavingDate: null as Date | null,
    contractStartDate: null as Date | null,
    contractEndDate: null as Date | null,
    provider_type_id: null as string | null,
    specialty_id: null as string | null,
    location_id: null as string | null,
    membershipIncome: null as string | null,
    nhsIncome: null as string | null,
  });

  // Lab/Material Cost Configuration — only shown when this provider's
  // location is Associate Wise for the matching cost source.
  const [labCostConfig, setLabCostConfig] = useState({
    sourceMethod: "flat_percentage" as ProviderCostSourceMethod,
    percentage: 0,
    accountId: "",
    accountPlatform: "" as ProviderCostAccountPlatform | "",
  });
  const [materialCostConfig, setMaterialCostConfig] = useState({
    sourceMethod: "flat_percentage" as ProviderCostSourceMethod,
    percentage: 0,
    accountId: "",
    accountPlatform: "" as ProviderCostAccountPlatform | "",
  });
  const [materialSplitPercentage, setMaterialSplitPercentage] = useState(50);

  // Validation errors state
  const [validationErrors, setValidationErrors] = useState({
    providerCode: "",
    name: "",
    email: "",
    phone: "",
    primaryChair: "",
    joiningDate: "",
  });

  // Chart formula dialog state
  const [showRevenueTrendFormula, setShowRevenueTrendFormula] = useState(false);

  // KPI card formula dialog states
  const [showRevenueFormula, setShowRevenueFormula] = useState(false);
  const [showPatientsFormula, setShowPatientsFormula] = useState(false);
  const [showAvgPatientFormula, setShowAvgPatientFormula] = useState(false);
  const [showUtilisationFormula, setShowUtilisationFormula] = useState(false);
  const [showNewPatientsFormula, setShowNewPatientsFormula] = useState(false);
  const [showRecallRateFormula, setShowRecallRateFormula] = useState(false);
  const [showVsPriorYearFormula, setShowVsPriorYearFormula] = useState(false);
  const [showVsTargetFormula, setShowVsTargetFormula] = useState(false);
  const [showPerformanceRankFormula, setShowPerformanceRankFormula] =
    useState(false);

  // Recent Activity state (Performance tab)
  const [recentActivity, setRecentActivity] = useState<
    { treatment: string; patient: string; date: string; amount: number }[]
  >([]);
  const [isLoadingRecentActivity, setIsLoadingRecentActivity] = useState(false);

  // Monthly Data state - synced with global top filter
  const [netProductionDateRange, setNetProductionDateRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({
    from: globalDateRange.startDate,
    to: globalDateRange.endDate,
  });

  // Keep in sync when the global top filter changes
  useEffect(() => {
    setNetProductionDateRange({
      from: globalDateRange.startDate,
      to: globalDateRange.endDate,
    });
  }, [globalDateRange.startDate, globalDateRange.endDate]);
  const [netProductionData, setNetProductionData] = useState<any[]>([]);
  const [workingHoursData, setWorkingHoursData] = useState<any[]>([]);

  // Working Hours dialog state
  const [showWorkingHoursDialog, setShowWorkingHoursDialog] = useState(false);
  const [showFormulaDialog, setShowFormulaDialog] = useState(false);
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
  const [isLoadingDialogData, setIsLoadingDialogData] = useState(false);

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

  // Profit Goals Settings state
  const [profitGoalsDateRange, setProfitGoalsDateRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });
  const [planningMonth, setPlanningMonth] = useState<Date | null>(null);
  const [profitGoalsData, setProfitGoalsData] = useState<any[]>([]);
  const [expandedAssociate, setExpandedAssociate] = useState<string | null>(
    null,
  );

  // Profit Goals Calculations state
  const [profitGoalsMetrics, setProfitGoalsMetrics] = useState({
    // Operational Costs & Profit
    opCosts: 0, // Loaded from iplicit P&L via get_iplicit_pl_amount_cost_by_date
    targetProfitPercent: 0, // From Business Info: target_profit_percentage
    ocpspd: 0, // Calculated

    // Operational Schedule (from Business Info)
    weeksOpenPerYear: 0, // practice_weeks_per_year
    daysOpenPerWeek: 0, // practice_days_per_week
    openHoursPerDay: 8, // open_hours_per_day
    numSurgeries: 0, // surgeries
    workingDays: 0, // Calculated: business days in date range excluding holidays
    surgeryDaysPerYear: 0, // Calculated: workingDays * numSurgeries

    // Associate Available Schedule (from Business Info)
    assocWeeksPerYear: 0, // associates_weeks_per_year
    assocDaysPerWeek: 0, // associates_days_per_week
    assocDaysPerYear: 0, // Calculated: assocWeeksPerYear * assocDaysPerWeek

    // Practice & Associate Expenses (from Business Info)
    practiceCostMaterialsPercent: 0, // practice_cost_materials_percentage
    associateCostLabsPercent: 0, // associate_cost_labs_percentage
    associateCostLabSource: null as string | null, // 'flat_per_by_practice' | 'associate_wise'
    materialCostSource: null as string | null,
  });

  // Resolved per-provider lab/material cost — location-flat percentage unless
  // the location is Associate Wise AND this provider has been configured
  // with their own cost source (see src/lib/providerCostResolution.ts).
  const [resolvedProviderCosts, setResolvedProviderCosts] = useState<{
    lab: ResolvedProviderCost;
    material: ResolvedProviderCost;
  }>({
    lab: { amount: 0, basis: "location_percent" },
    material: { amount: 0, basis: "location_percent" },
  });

  // Associate-specific metrics for the table
  const [associateMetrics, setAssociateMetrics] = useState({
    avgDailyProduction: 510.96, // Will be calculated from actual data
    totalProduction: 5770.02, // Will be calculated from actual data
    associateSplitPercent: 30, // From provider table
    associateLabSplitPercent: 50, // From provider table
    workingDays: 11.29, // From date range
    // Calculated values
    associateNetPay: 0,
    costOfLabs: 0,
    avgLabCostPerMonth: 0,
    materialsCosts: 0,
    ocpspaContribution: 0,
    practicePL: 0,
    plPercentOnOCPSPD: 0,
    plOnRoomPerDay: 0,
  });

  // Planned metrics state
  const [plannedAvgDailyProduction, setPlannedAvgDailyProduction] =
    useState<number>(0);
  const [plannedInputValue, setPlannedInputValue] = useState<string>("0"); // Local state for input field
  const [plannedMetrics, setPlannedMetrics] = useState({
    plannedTotalProduction: 0,
    plannedAssociateNetPay: 0,
    plannedCostOfLabs: 0,
    plannedMaterials: 0,
    plannedPracticePL: 0,
  });

  // Planned Daily Production records state
  const [savedPlannedRecords, setSavedPlannedRecords] = useState<any[]>([]);
  const [isSavingPlanned, setIsSavingPlanned] = useState(false);

  // Sliding Scale state
  const [associateSlidingScale, setAssociateSlidingScale] = useState<
    SlidingScaleBand[]
  >([{ id: 1, band: "Band 1", start: 0, end: 0, percentage: 0 }]);
  const [labSlidingScale, setLabSlidingScale] = useState<SlidingScaleBand[]>([
    { id: 1, band: "Band 1", start: 0, end: 0, percentage: 0 },
  ]);
  const [newAssociateBandId, setNewAssociateBandId] = useState<number | null>(
    null,
  );
  const [newLabBandId, setNewLabBandId] = useState<number | null>(null);
  const [associateValidationErrors, setAssociateValidationErrors] = useState<{
    [key: number]: string;
  }>({});
  const [labValidationErrors, setLabValidationErrors] = useState<{
    [key: number]: string;
  }>({});
  const [isScalesInitialized, setIsScalesInitialized] = useState(false);

  // Lab/Material Cost sliding scale — a separate concept from the Associate
  // Lab Sliding Scale above (which drives the "Lab Deduction Split %"); these
  // bands apply progressively to the location's monthly lab/material bill.
  const [labCostSlidingScale, setLabCostSlidingScale] = useState<
    SlidingScaleBand[]
  >([{ id: 1, band: "Band 1", start: 0, end: 0, percentage: 0 }]);
  const [materialCostSlidingScale, setMaterialCostSlidingScale] = useState<
    SlidingScaleBand[]
  >([{ id: 1, band: "Band 1", start: 0, end: 0, percentage: 0 }]);
  const [newLabCostBandId, setNewLabCostBandId] = useState<number | null>(null);
  const [newMaterialCostBandId, setNewMaterialCostBandId] = useState<
    number | null
  >(null);
  const [labCostValidationErrors, setLabCostValidationErrors] = useState<{
    [key: number]: string;
  }>({});
  const [materialCostValidationErrors, setMaterialCostValidationErrors] =
    useState<{ [key: number]: string }>({});
  const [isCostScalesInitialized, setIsCostScalesInitialized] = useState(false);

  // Which sliding-scale band editor is open in the Contract Details modal —
  // mirrors fe-dentpulse-live's Contract Details "manage sliding scale" dialog
  // trigger next to the split/lab-cost/material-cost source selects.
  const [openSlidingScaleFor, setOpenSlidingScaleFor] = useState<
    "associate" | "labCost" | "materialCost" | null
  >(null);

  const handleSaveSlidingScale = (
    scaleType: ScaleType,
    bands: SlidingScaleBand[],
    errors: { [key: number]: string },
  ) => {
    if (!id) {
      toast.error("Error", { description: "Provider ID not found" });
      return;
    }
    if (Object.keys(errors).length > 0) {
      toast.error("Validation Error", {
        description: "Please fix validation errors before saving",
      });
      return;
    }
    saveSlidingScale({ providerId: id, scaleType, bands });
  };

  // Treatment Mix state
  const [treatmentMixData, setTreatmentMixData] = useState<
    { name: string; value: number; revenue: number; count: number }[]
  >([]);
  const [isLoadingTreatmentMix, setIsLoadingTreatmentMix] = useState(false);
  type TreatmentMixDateFilter =
    | "this-month"
    | "this-quarter"
    | "this-year"
    | "last-month"
    | "last-quarter"
    | "last-year"
    | "custom";
  const [treatmentMixFilter, setTreatmentMixFilter] =
    useState<TreatmentMixDateFilter>("this-year");
  const [treatmentMixCustomRange, setTreatmentMixCustomRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>({ from: null, to: null });

  // Fetch working hours from appointment_summary (Monthly Data tab display)
  const {
    data: workingHoursSummaryData,
    isLoading: isLoadingWorkingHours,
    refetch: refetchWorkingHours,
  } = useQuery({
    queryKey: [
      "appointment_summary",
      id,
      netProductionDateRange.from,
      netProductionDateRange.to,
      organizationId,
      selectedLocationId ?? "all",
    ],
    queryFn: async () => {
      if (!id || !organizationId) return null;
      const from = netProductionDateRange.from
        ? dayjs(netProductionDateRange.from)
            .startOf("month")
            .format("YYYY-MM-DD")
        : null;
      const to = netProductionDateRange.to
        ? dayjs(netProductionDateRange.to).endOf("month").format("YYYY-MM-DD")
        : null;
      if (!from || !to) return null;

      // Collect ALL external_ids (practitioner_ids) for the same person (same email = same person at multiple locations)
      const { data: thisProvider } = await (supabase as any)
        .from("providers")
        .select("email, name, external_id")
        .eq("id", id)
        .single();

      let allExternalIds: number[] = [];
      if (thisProvider?.external_id)
        allExternalIds.push(Number(thisProvider.external_id));

      if (thisProvider?.email) {
        const { data: siblings } = await (supabase as any)
          .from("providers")
          .select("external_id")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .ilike("email", thisProvider.email);
        for (const s of siblings ?? []) {
          if (s.external_id) {
            const extId = Number(s.external_id);
            if (!isNaN(extId) && !allExternalIds.includes(extId))
              allExternalIds.push(extId);
          }
        }
      }

      if (!allExternalIds.length) {
        // No external IDs — return empty but zero-filled months
        const monthMap = new Map<string, number>();
        let cur = dayjs(from).startOf("month");
        const endMonth = dayjs(to).startOf("month");
        while (!cur.isAfter(endMonth)) {
          monthMap.set(cur.format("MMM-YY"), 0);
          cur = cur.add(1, "month");
        }
        const monthlyHours = Array.from(monthMap.entries()).map(
          ([month, hours]) => ({ month, hours }),
        );
        return { monthlyHours, totalHours: 0 };
      }

      // Build month map (zero-fill full date range)
      const monthMap = new Map<string, number>();
      let cur = dayjs(from).startOf("month");
      const endMonth = dayjs(to).startOf("month");
      while (!cur.isAfter(endMonth)) {
        monthMap.set(cur.format("MMM-YY"), 0);
        cur = cur.add(1, "month");
      }

      if (selectedLocationId && selectedLocationId !== "all") {
        // Specific location: use RPC that filters by location_id (same as main Providers page)
        const { data: locationRows, error: locationError } = await (
          supabase as any
        ).rpc("get_provider_working_hours_by_location", {
          p_organization_id: organizationId,
          p_practitioner_ids: allExternalIds,
          p_location_id: selectedLocationId,
          p_from_date: from,
          p_to_date: to,
        });
        if (locationError) {
          console.error(
            "[WorkingHoursSummary location]",
            locationError.message,
          );
          return null;
        }
        for (const r of locationRows ?? []) {
          const label = dayjs(r.month).format("MMM-YY");
          if (monthMap.has(label))
            monthMap.set(
              label,
              (monthMap.get(label) ?? 0) +
                (Number(r.working_duration_hours) || 0),
            );
        }
      } else {
        // All locations: query appointment_summary by practitioner_id (same as main Providers page)
        const { data: rows, error } = await (supabase as any)
          .from("appointment_summary")
          .select("month, working_duration_hours")
          .eq("organization_id", organizationId)
          .in("practitioner_id", allExternalIds)
          .gte("month", from)
          .lte("month", to)
          .order("month");
        if (error) {
          console.error("[WorkingHoursSummary]", error.message);
          return null;
        }
        for (const r of rows ?? []) {
          const label = dayjs(r.month).format("MMM-YY");
          if (monthMap.has(label))
            monthMap.set(
              label,
              (monthMap.get(label) ?? 0) +
                (Number(r.working_duration_hours) || 0),
            );
        }
      }

      const monthlyHours = Array.from(monthMap.entries()).map(
        ([month, hours]) => ({
          month,
          hours: Math.round(hours * 10) / 10,
        }),
      );
      const totalHours = monthlyHours.reduce((s, m) => s + m.hours, 0);
      return { monthlyHours, totalHours: Math.round(totalHours * 10) / 10 };
    },
    enabled: !!id && !!organizationId,
  });
  // Keep the hook for Profit Goals calculations (unchanged)
  const { data: workingHoursApiData } = useProviderWorkingHours(
    id,
    netProductionDateRange.from,
    netProductionDateRange.to,
  );

  // Fetch working hours data for Profit Goals calculations (using profitGoalsDateRange).
  // practitionerId/locationId are filled in after `provider` is loaded (see below the provider query).
  // The hook skips the precision path until those values are available, then re-fetches automatically.
  const [profitGoalsPractitionerId, setProfitGoalsPractitionerId] = useState<
    number | null
  >(null);
  const {
    data: profitGoalsWorkingHoursData,
    isLoading: isLoadingProfitGoalsWorkingHours,
  } = useProviderWorkingHours(
    id,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
    profitGoalsPractitionerId,
    selectedLocationId || null,
  );

  /// Fetch net production data for Profit Goals calculations (using profitGoalsDateRange)
  const {
    data: profitGoalsNetProductionData,
    isLoading: isLoadingProfitGoalsNetProduction,
  } = useProviderNetProduction(
    id,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
    selectedLocationId,
  );

  // Fetch net production data from practitioner activity report (using netProductionDateRange for Overview tab)
  const { data: netProductionApiData, isLoading: isLoadingNetProduction } =
    useProviderNetProduction(
      id,
      netProductionDateRange.from,
      netProductionDateRange.to,
      selectedLocationId,
    );

  // Fetch net production for Revenue Trend chart — uses global top date filter
  const { data: revenueTrendData, isLoading: isLoadingRevenueTrend } =
    useProviderNetProduction(
      id,
      globalDateRange.startDate,
      globalDateRange.endDate,
      selectedLocationId,
    );

  // Fetch prior year net production (same range shifted back 1 year, for vs Prior Year card)
  const { data: priorYearData } = useProviderNetProduction(
    id,
    subYears(globalDateRange.startDate, 1),
    subYears(globalDateRange.endDate, 1),
    selectedLocationId,
  );

  // Fetch latest planned daily production for this provider (used for chart target line)
  const { data: latestPlannedProduction } = useQuery({
    queryKey: ["planned-daily-production", id, organizationId],
    queryFn: async () => {
      if (!id || !organizationId) return null;
      const { data, error } = await supabase
        .from("planned_daily_production")
        .select("average_daily_production")
        .eq("provider_id", id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error) return null;
      return Number(data?.average_daily_production) || 0;
    },
    enabled: !!id && !!organizationId,
  });

  // Fetch production metrics for rank card — same hook/RPC as Overview ranking table
  // (ranks by Avg Daily Production, consistent with Overview page)
  const currentProviderTypeCode =
    (allProviders ?? []).find((p) => p.id === id)?.provider_types?.code ?? null;
  const { data: productionMetricsData } = useProductionMetrics(
    globalDateRange.startDate,
    globalDateRange.endDate,
    currentProviderTypeCode,
    selectedLocationId,
  );

  // Debug logging for date range
  useEffect(() => {
    if (netProductionDateRange.from && netProductionDateRange.to) {
      console.log("[ProviderDetail] Net Production Date Range:", {
        from: format(netProductionDateRange.from, "yyyy-MM-dd"),
        to: format(netProductionDateRange.to, "yyyy-MM-dd"),
      });
    }
  }, [netProductionDateRange]);

  // Load financial month start and calculate profit goals dates
  useEffect(() => {
    const loadFinancialMonthAndCalculateDates = async () => {
      if (!organizationId) return;

      try {
        // Load financial_month_start from organization_settings
        const { data: settings } = await supabase
          .from("organization_settings")
          .select("financial_month_start")
          .eq("organization_id", organizationId)
          .single();

        const financialMonthStart = settings?.financial_month_start || 1; // Default to January if not set

        // Calculate dates
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // getMonth() returns 0-11

        // Calculate financial year start date
        let financialYearStartYear = currentYear;
        if (currentMonth < financialMonthStart) {
          // If current month is before financial start month, financial year started last calendar year
          financialYearStartYear = currentYear - 1;
        }
        const startDate = new Date(
          financialYearStartYear,
          financialMonthStart - 1,
          1,
        );

        // Calculate end date as last day of previous month
        const endDate = new Date(today.getFullYear(), today.getMonth(), 0); // Day 0 of current month = last day of previous month

        // When FY just started this month, endDate (last month) falls before startDate.
        // Fall back to the last complete FY start (one year earlier).
        const effectiveFrom =
          startDate > endDate
            ? new Date(financialYearStartYear - 1, financialMonthStart - 1, 1)
            : startDate;

        // Set planning month to current month
        const planningMonthDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          1,
        );

        // Update state
        setProfitGoalsDateRange({ from: effectiveFrom, to: endDate });
        setPlanningMonth(planningMonthDate);
      } catch (error) {
        console.error("[ProviderDetail] Error loading financial month:", error);
      }
    };

    loadFinancialMonthAndCalculateDates();
  }, [organizationId]);

  // Load business info and calculate profit goals metrics
  useEffect(() => {
    const loadBusinessInfoAndCalculate = async () => {
      if (
        !id ||
        !organizationId ||
        !profitGoalsDateRange.from ||
        !profitGoalsDateRange.to
      )
        return;

      try {
        // Business Settings now live on the provider's own location, not the organization
        const { data: providerLocation } = await supabase
          .from("providers")
          .select("location_id")
          .eq("id", id)
          .single();
        if (!providerLocation?.location_id) return;

        const { data: orgData, error } = await supabase
          .from("practice_locations")
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
            associate_cost_labs_percent,
            associate_cost_lab_source,
            material_cost_source
          `,
          )
          .eq("id", providerLocation.location_id)
          .single();

        if (!orgData) return;

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
          workingDays * (orgData.number_of_surgeries || 0);

        // Calculate associate days per year
        const assocDaysPerYear =
          (orgData.associate_weeks_per_year || 0) *
          (orgData.associate_days_per_week || 0);

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
            "[ProviderDetail] Error fetching P&L op costs:",
            plError,
          );
        }

        // Calculate OCPSPD (Op Costs Per Surgery Per Day)
        const ocpspd =
          surgeryDaysPerYear > 0 ? opCosts / surgeryDaysPerYear : 0;

        // Update state with all calculated metrics
        setProfitGoalsMetrics({
          opCosts,
          targetProfitPercent: orgData.target_profit_percent || 0,
          ocpspd,
          weeksOpenPerYear: orgData.week_open_per_year || 0,
          daysOpenPerWeek: orgData.days_open_per_week || 0,
          openHoursPerDay: orgData.open_hours_per_day || 8,
          numSurgeries: orgData.number_of_surgeries || 0,
          workingDays,
          surgeryDaysPerYear,
          assocWeeksPerYear: orgData.associate_weeks_per_year || 0,
          assocDaysPerWeek: orgData.associate_days_per_week || 0,
          assocDaysPerYear,
          practiceCostMaterialsPercent:
            orgData.practice_cost_materials_percent || 0,
          associateCostLabsPercent: orgData.associate_cost_labs_percent || 0,
          associateCostLabSource: orgData.associate_cost_lab_source,
          materialCostSource: orgData.material_cost_source,
        });
      } catch (error) {
        console.error("[ProviderDetail] Error loading business info:", error);
      }
    };

    loadBusinessInfoAndCalculate();
  }, [
    id,
    organizationId,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
    selectedLocationId,
  ]);

  // Reset initialization and invalidate cache when provider changes
  useEffect(() => {
    setIsScalesInitialized(false);
    // Invalidate queries to ensure fresh data
    queryClient.invalidateQueries({ queryKey: ["provider-net-production"] });
    queryClient.invalidateQueries({ queryKey: ["provider-working-hours"] });
  }, [id, queryClient]);

  // Update Edit Provider percentages from sliding scale data
  // ONLY when split method is 'sliding-scale', not 'flat-percentage'
  useEffect(() => {
    if (
      associateSlidingScale.length > 0 &&
      labSlidingScale.length > 0 &&
      isScalesInitialized
    ) {
      const lastAssociateBand =
        associateSlidingScale[associateSlidingScale.length - 1];
      const lastLabBand = labSlidingScale[labSlidingScale.length - 1];

      setEditFormData((prev) => ({
        ...prev,
        // Only update from sliding scale when method is 'sliding-scale'
        associateSplitPercentage:
          prev.splitSourceMethod === "sliding-scale"
            ? lastAssociateBand.percentage || prev.associateSplitPercentage
            : prev.associateSplitPercentage,
        // Only update from sliding scale when method is 'sliding-scale'
        labSplitPercentage:
          prev.splitSourceMethod === "sliding-scale"
            ? lastLabBand.percentage || prev.labSplitPercentage
            : prev.labSplitPercentage,
      }));
    }
  }, [associateSlidingScale, labSlidingScale, isScalesInitialized]);

  // Validate all rows helper function
  const validateAssociateRows = (scales: SlidingScaleBand[]) => {
    const errors: { [key: number]: string } = {};
    scales.forEach((band) => {
      if (band.end <= band.start) {
        errors[band.id] = "End must be greater than Start";
      }
    });
    setAssociateValidationErrors(errors);
  };

  const validateLabRows = (scales: SlidingScaleBand[]) => {
    const errors: { [key: number]: string } = {};
    scales.forEach((band) => {
      if (band.end <= band.start) {
        errors[band.id] = "End must be greater than Start";
      }
    });
    setLabValidationErrors(errors);
  };

  // Load sliding scales from database when data changes
  useEffect(() => {
    if (!isLoadingScales && slidingScales.length > 0 && !isScalesInitialized) {
      const associateScales = getScalesByType("sliding_scale");
      const labScales = getScalesByType("lab_sliding_scale");

      // Load associate scales if available
      if (associateScales.length > 0) {
        setAssociateSlidingScale(associateScales);
        validateAssociateRows(associateScales);
      }

      // Load lab scales if available
      if (labScales.length > 0) {
        setLabSlidingScale(labScales);
        validateLabRows(labScales);
      }

      // Mark as initialized only if we loaded data
      if (associateScales.length > 0 || labScales.length > 0) {
        setIsScalesInitialized(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingScales, slidingScales.length, isScalesInitialized]);

  // Load lab/material cost sliding scales from database when data changes
  useEffect(() => {
    if (
      !isLoadingScales &&
      slidingScales.length > 0 &&
      !isCostScalesInitialized
    ) {
      const labCostScales = getScalesByType("lab_cost_scale");
      const materialCostScales = getScalesByType("material_cost_scale");

      if (labCostScales.length > 0) {
        setLabCostSlidingScale(labCostScales);
        setLabCostValidationErrors(
          labCostScales.reduce(
            (errs, band) =>
              band.end <= band.start
                ? { ...errs, [band.id]: "End must be greater than Start" }
                : errs,
            {} as { [key: number]: string },
          ),
        );
      }
      if (materialCostScales.length > 0) {
        setMaterialCostSlidingScale(materialCostScales);
        setMaterialCostValidationErrors(
          materialCostScales.reduce(
            (errs, band) =>
              band.end <= band.start
                ? { ...errs, [band.id]: "End must be greater than Start" }
                : errs,
            {} as { [key: number]: string },
          ),
        );
      }
      if (labCostScales.length > 0 || materialCostScales.length > 0) {
        setIsCostScalesInitialized(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingScales, slidingScales.length, isCostScalesInitialized]);

  // Add Associate Modal state
  const [isAddAssociateOpen, setIsAddAssociateOpen] = useState(false);
  const [addAssociateForm, setAddAssociateForm] = useState({
    code: "",
    name: "",
    email: "",
    phoneNo: "",
    role: "",
    primaryChair: "",
    associateSplitSource: "",
    associateLabSplit: "50",
    nhsIncome: "",
    membershipIncome: "",
    joiningDate: null as Date | null,
    leavingDate: null as Date | null,
    performsNhsTreatments: false,
    performsMosTreatments: false,
  });
  const [addAssociateJoiningDateOpen, setAddAssociateJoiningDateOpen] =
    useState(false);
  const [addAssociateLeavingDateOpen, setAddAssociateLeavingDateOpen] =
    useState(false);
  const [isAddingSaving, setIsAddingSaving] = useState(false);

  const resetAddAssociateForm = () =>
    setAddAssociateForm({
      code: "",
      name: "",
      email: "",
      phoneNo: "",
      role: "",
      primaryChair: "",
      associateSplitSource: "",
      associateLabSplit: "50",
      nhsIncome: "",
      membershipIncome: "",
      joiningDate: null,
      leavingDate: null,
      performsNhsTreatments: false,
      performsMosTreatments: false,
    });

  const handleSaveNewProvider = async () => {
    if (!organizationId) {
      toast.error("Missing organization information");
      return;
    }
    if (!addAssociateForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!addAssociateForm.email.trim()) {
      toast.error("Email is required");
      return;
    }
    if (!addAssociateForm.joiningDate) {
      toast.error("Joining Date is required");
      return;
    }

    setIsAddingSaving(true);
    try {
      // Check email uniqueness within the org
      const { data: existing } = await (supabase as any)
        .from("providers")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("email", addAssociateForm.email.trim())
        .maybeSingle();

      if (existing) {
        toast.error("A provider with this email already exists");
        return;
      }

      const { error } = await (supabase as any).from("providers").insert({
        organization_id: organizationId,
        provider_code: addAssociateForm.code.trim() || null,
        name: addAssociateForm.name.trim(),
        email: addAssociateForm.email.trim(),
        phone: addAssociateForm.phoneNo.trim() || null,
        provider_role: addAssociateForm.role.trim() || null,
        primary_chair: addAssociateForm.primaryChair.trim() || null,
        split_source_method:
          addAssociateForm.associateSplitSource.trim() || null,
        lab_split_percentage: addAssociateForm.associateLabSplit
          ? Number(addAssociateForm.associateLabSplit)
          : null,
        nhs_income: addAssociateForm.nhsIncome || null,
        membership_income: addAssociateForm.membershipIncome || null,
        joining_date: format(addAssociateForm.joiningDate, "yyyy-MM-dd"),
        leaving_date: addAssociateForm.leavingDate
          ? format(addAssociateForm.leavingDate, "yyyy-MM-dd")
          : null,
        additional_options: encodeProviderAdditionalOptions(
          addAssociateForm.performsNhsTreatments,
          addAssociateForm.performsMosTreatments,
        ),
        provider_type_id: provider?.provider_type_id || null,
        location_id: provider?.location_id || null,
        is_active: true,
        revenue: 0,
        patients: 0,
        avg_rev_per_patient: 0,
        utilisation: 0,
        trend: 0,
      });

      if (error) throw error;

      toast.success("Provider added successfully");
      setIsAddAssociateOpen(false);
      resetAddAssociateForm();
    } catch (err: any) {
      console.error("[ProviderDetail] Error saving new provider:", err);
      toast.error(err.message || "Failed to add provider");
    } finally {
      setIsAddingSaving(false);
    }
  };

  // Helper function to get provider type label dynamically
  const getTypeLabel = (type: string) => {
    const providerType = activeProviderTypes.find((pt) => pt.code === type);
    return providerType?.name || type || "Provider";
  };

  // Dentists are referred to as "Associate" (matching the live app's terminology);
  // other types use their configured name, capitalized.
  const getSplitConfigLabel = (type: string) => {
    if (type === "dentist") return "Associate";
    const label = getTypeLabel(type);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  // Fetch provider data dynamically
  const {
    data: provider,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["provider", id],
    queryFn: () => getProvider(id!),
    enabled: !!id,
  });

  const {
    startNewContract,
    isStartingNewContract,
    syncCurrentContract,
    isSyncingCurrentContract,
  } = useProviderContracts(provider?.id);

  // Shared by both the "Add New Contract" and "Update Contract" confirm
  // dialogs — isNewContractFlow picks which of the two branches runs.
  const performContractSave = async (isNewContractFlow: boolean) => {
    if (!provider) {
      toast.error("Validation error", {
        description: "Unable to update provider",
      });
      return;
    }

    const previousContractStartDate =
      (provider as any).contract_start_date || null;

    if (isNewContractFlow) {
      if (!editFormData.contractStartDate) {
        toast.error("Validation error", {
          description: "Contract Start Date is required for a new contract",
        });
        return;
      }
      if (
        previousContractStartDate &&
        !isAfter(
          editFormData.contractStartDate,
          new Date(previousContractStartDate),
        )
      ) {
        toast.error("Validation error", {
          description:
            "New contract start date must be after the current contract's start date",
        });
        return;
      }
    }

    // Prepare lab split percentage fields based on split source method
    // (only 'sliding-scale' uses the separate sliding column; every
    // other method, including the per-case/per-hour ones, uses
    // the flat lab_split_percentage column).
    const labSplitUpdates =
      editFormData.splitSourceMethod === "sliding-scale"
        ? {
            lab_split_percentage_sliding: editFormData.labSplitPercentage,
          }
        : {
            lab_split_percentage: editFormData.labSplitPercentage,
          };

    // Snapshot of this save's contract fields, shared between
    // the "new contract" and the plain-edit sync paths below.
    const contractFieldsSnapshot = {
      splitSourceMethod: editFormData.splitSourceMethod,
      associateSplitPercentage: editFormData.associateSplitPercentage,
      labSplitPercentage:
        editFormData.splitSourceMethod === "sliding-scale"
          ? null
          : editFormData.labSplitPercentage,
      labSplitPercentageSliding:
        editFormData.splitSourceMethod === "sliding-scale"
          ? editFormData.labSplitPercentage
          : null,
      materialSplitPercentage: materialSplitPercentage,
      perCaseRate: editFormData.perCaseRate,
      perHourRate: editFormData.perHourRate,
      employmentType: editFormData.employmentType,
    };

    if (isNewContractFlow && editFormData.contractStartDate) {
      try {
        await startNewContract({
          providerId: provider.id,
          organizationId: organizationId!,
          newStartDate: format(editFormData.contractStartDate, "yyyy-MM-dd"),
          previousContractStartDate,
          previousFields: {
            splitSourceMethod:
              (provider as any).split_source_method || "flat-percentage",
            associateSplitPercentage:
              (provider as any).associate_split_percentage ?? null,
            labSplitPercentage:
              (provider as any).lab_split_percentage ?? null,
            labSplitPercentageSliding:
              (provider as any).lab_split_percentage_sliding ?? null,
            materialSplitPercentage:
              (provider as any).material_split_percentage ?? null,
            perCaseRate:
              (provider as any).associate_split_per_case_rate ?? null,
            perHourRate:
              (provider as any).associate_split_per_hour_rate ?? null,
            employmentType: (provider as any).employment_type ?? null,
          },
          newFields: contractFieldsSnapshot,
        });
      } catch {
        // Error already toasted inside useProviderContracts —
        // don't touch the live provider row when the
        // contract-history write failed.
        return;
      }
    } else {
      // Plain edit (no new contract period) — keep the
      // current open contract-history row's snapshot in sync
      // so "View All Contracts" doesn't go stale on every
      // regular save. Best-effort: a failure here shouldn't
      // block the actual provider update below.
      try {
        await syncCurrentContract({
          providerId: provider.id,
          organizationId: organizationId!,
          contractStartDate: editFormData.contractStartDate
            ? format(editFormData.contractStartDate, "yyyy-MM-dd")
            : previousContractStartDate,
          contractEndDate: editFormData.contractEndDate
            ? format(editFormData.contractEndDate, "yyyy-MM-dd")
            : null,
          fields: contractFieldsSnapshot,
        });
      } catch {
        // Already toasted inside useProviderContracts.
      }
    }

    updateProvider({
      id: provider.id,
      updates: {
        contract_start_date: editFormData.contractStartDate
          ? format(editFormData.contractStartDate, "yyyy-MM-dd")
          : null,
        contract_end_date: editFormData.contractEndDate
          ? format(editFormData.contractEndDate, "yyyy-MM-dd")
          : null,
        split_source_method: editFormData.splitSourceMethod,
        associate_split_percentage: editFormData.associateSplitPercentage,
        associate_split_per_case_rate: editFormData.perCaseRate,
        associate_split_per_hour_rate: editFormData.perHourRate,
        employment_type: editFormData.employmentType,
        material_split_percentage: materialSplitPercentage,
        lab_cost_source_method:
          profitGoalsMetrics.associateCostLabSource === "associate_wise"
            ? labCostConfig.sourceMethod
            : null,
        lab_cost_percentage:
          labCostConfig.sourceMethod === "flat_percentage"
            ? labCostConfig.percentage
            : null,
        lab_cost_account_id:
          labCostConfig.sourceMethod === "accounting_application"
            ? labCostConfig.accountId || null
            : null,
        lab_cost_account_platform:
          labCostConfig.sourceMethod === "accounting_application"
            ? labCostConfig.accountPlatform || null
            : null,
        material_cost_source_method:
          profitGoalsMetrics.materialCostSource === "associate_wise"
            ? materialCostConfig.sourceMethod
            : null,
        material_cost_percentage:
          materialCostConfig.sourceMethod === "flat_percentage"
            ? materialCostConfig.percentage
            : null,
        material_cost_account_id:
          materialCostConfig.sourceMethod === "accounting_application"
            ? materialCostConfig.accountId || null
            : null,
        material_cost_account_platform:
          materialCostConfig.sourceMethod === "accounting_application"
            ? materialCostConfig.accountPlatform || null
            : null,
        ...labSplitUpdates,
      },
    });
  };

  const requestNewContract = () => {
    if (!provider) {
      toast.error("Validation error", {
        description: "Unable to update provider",
      });
      return;
    }
    if (!editFormData.contractStartDate) {
      toast.error("Validation error", {
        description: "Contract Start Date is required to add a new contract",
      });
      return;
    }
    const previousContractStartDate =
      (provider as any).contract_start_date || null;
    if (
      previousContractStartDate &&
      !isAfter(
        editFormData.contractStartDate,
        new Date(previousContractStartDate),
      )
    ) {
      toast.error("Validation error", {
        description:
          "New contract start date must be after the current contract's start date",
      });
      return;
    }
    setContractConfirmAction("new");
    setContractConfirmOpen(true);
  };

  const requestUpdateContract = () => {
    if (!provider) {
      toast.error("Validation error", {
        description: "Unable to update provider",
      });
      return;
    }
    setContractConfirmAction("update");
    setContractConfirmOpen(true);
  };

  const { availableAccounts: locationAccountOptions } =
    useLocationChartOfAccounts(
      (provider as any)?.location_id ?? null,
      organizationId,
    );

  // Sync practitionerId from provider record so useProviderWorkingHours uses the precise RPC path.
  useEffect(() => {
    const extId = (provider as any)?.external_id;
    setProfitGoalsPractitionerId(extId ? Number(extId) : null);
  }, [(provider as any)?.external_id]);

  // NHS Count (uda_count) / MOS Count (mos_count) summary — reuses the same
  // org-wide-by-type query as the Providers list page, then picks out this
  // provider's row by external_id (robust to which sibling row within the
  // same email group ends up as the group's "representative" id).
  const providerTypeCapitalized = type
    ? type.charAt(0).toUpperCase() + type.slice(1)
    : null;
  const { data: allNhsCounts, isLoading: isLoadingAllNhsCounts } =
    useAllProvidersCounts(
      providerTypeCapitalized,
      netProductionDateRange.from,
      netProductionDateRange.to,
      "uda_count",
    );
  const { data: allMosCounts, isLoading: isLoadingAllMosCounts } =
    useAllProvidersCounts(
      providerTypeCapitalized,
      netProductionDateRange.from,
      netProductionDateRange.to,
      "mos_count",
    );
  const thisProviderExtId = (provider as any)?.external_id
    ? Number((provider as any).external_id)
    : null;
  const nhsCountSummary = useMemo(() => {
    if (!allNhsCounts || thisProviderExtId == null) return null;
    const row = allNhsCounts.providers.find((p) =>
      p.externalIds.includes(thisProviderExtId),
    );
    return {
      monthlyCounts: allNhsCounts.months.map((month) => ({
        month,
        count: row?.monthlyData[month] ?? 0,
      })),
      totalCount: row?.total ?? 0,
    };
  }, [allNhsCounts, thisProviderExtId]);
  const mosCountSummary = useMemo(() => {
    if (!allMosCounts || thisProviderExtId == null) return null;
    const row = allMosCounts.providers.find((p) =>
      p.externalIds.includes(thisProviderExtId),
    );
    return {
      monthlyCounts: allMosCounts.months.map((month) => ({
        month,
        count: row?.monthlyData[month] ?? 0,
      })),
      totalCount: row?.total ?? 0,
    };
  }, [allMosCounts, thisProviderExtId]);

  // KPI cards — driven by global top filter
  const kpiMtdStart = globalDateRange.startDate;
  const kpiMtdEnd = globalDateRange.endDate;
  // Pass the selected location so the Revenue KPI is SCOPED to it. The hook sums a
  // practitioner's production across ALL their per-site records (a multi-site dentist
  // has one external_id per site); without the location it summed every site (e.g.
  // Charles = Leiston £13,660.50 + Woodbridge £5,528.50), not just the selected one.
  const { data: kpiMtdProduction } = useProviderNetProduction(
    id,
    kpiMtdStart,
    kpiMtdEnd,
    selectedLocationId,
  );

  // ── Location-aware practitioner record for the single-record KPI tiles ────
  // A multi-site practitioner has one Dentally record (external_id) per site; the
  // record we loaded (from the deduped list) is the home site. When a specific
  // location is filtered, resolve THIS practitioner's record at that location so the
  // per-record KPIs (Patients, New Patients, Recall, Utilisation) reflect the
  // selected site — otherwise they showed the home site and never changed on switch.
  const specificLocation = !!selectedLocationId && selectedLocationId !== "all";
  const { data: kpiLocationRecord } = useQuery({
    queryKey: [
      "provider-detail-loc-record",
      organizationId,
      (provider as any)?.email,
      (provider as any)?.name,
      (provider as any)?.integration_id,
      selectedLocationId,
    ],
    enabled: !!organizationId && !!provider && specificLocation,
    queryFn: async () => {
      if ((provider as any)?.location_id === selectedLocationId)
        return provider;
      let q = (supabase as any)
        .from("providers")
        .select("id, name, external_id, integration_id, location_id, email")
        .eq("organization_id", organizationId)
        .eq("location_id", selectedLocationId);
      if ((provider as any)?.integration_id)
        q = q.eq("integration_id", (provider as any).integration_id);
      if ((provider as any)?.email) q = q.eq("email", (provider as any).email);
      else if ((provider as any)?.name)
        q = q.eq("name", (provider as any).name);
      const { data } = await q.limit(1);
      return data?.[0] ?? null;
    },
  });
  // Prefer the per-location record when we've resolved one; otherwise FALL BACK to the
  // clicked record so the tiles never blank to 0 while that lookup is loading (or if the
  // practitioner has no separate per-site record — the common single-site case). Only
  // apply p_location_id when we're actually using the resolved per-location external_id,
  // so a home external_id is never wrongly filtered down to 0.
  const resolvedLocExtId = (kpiLocationRecord as any)?.external_id ?? null;
  const useLocRecord = specificLocation && resolvedLocExtId != null;
  const kpiExtId = useLocRecord
    ? resolvedLocExtId
    : ((provider as any)?.external_id ?? null);
  const kpiLocationParam = useLocRecord ? selectedLocationId : null;

  const { data: kpiPatientCounts } = useQuery({
    queryKey: [
      "kpi-patient-count",
      organizationId,
      kpiExtId,
      kpiLocationParam ?? "all",
      format(kpiMtdStart, "yyyy-MM-dd"),
      format(kpiMtdEnd, "yyyy-MM-dd"),
    ],
    queryFn: async () => {
      if (!organizationId || kpiExtId == null)
        return { current: 0, recallRate: 0, newPatients: 0 };

      const { data, error } = await supabase.rpc("get_provider_kpi_patients", {
        p_organization_id: organizationId,
        p_practitioner_id: Number(kpiExtId),
        // UK-day bounds (not browser-local .toISOString()) so the window is the
        // practice's UK calendar day for any viewer. Identical for UK users.
        p_start_date: ukDayStartInstant(kpiMtdStart),
        p_end_date: ukDayEndInstant(kpiMtdEnd),
        p_location_id: kpiLocationParam,
      });

      if (error) throw error;
      const row = (data as any)?.[0] ?? {};
      return {
        current: Number(row.current_patients) || 0,
        newPatients: Number(row.new_patients) || 0,
        recallRate: Number(row.recall_rate) || 0,
      };
    },
    enabled: !!organizationId && kpiExtId != null,
  });

  // KPI — Utilisation via RPC (queries appointments directly, uses org hours/day)
  const { data: kpiUtilisation } = useQuery({
    queryKey: [
      "kpi-utilisation",
      organizationId,
      kpiExtId,
      kpiLocationParam ?? "all",
      format(kpiMtdStart, "yyyy-MM-dd"),
      format(kpiMtdEnd, "yyyy-MM-dd"),
    ],
    queryFn: async () => {
      if (!organizationId || !id)
        return { utilisation: 0, udaCount: null as number | null };

      if (kpiExtId == null) return { utilisation: 0, udaCount: null };

      const [utilisationResult, summaryResult] = await Promise.all([
        supabase.rpc("get_provider_utilisation", {
          p_organization_id: organizationId,
          p_practitioner_id: Number(kpiExtId),
          // UK-day bounds — see get_provider_kpi_patients above.
          p_start_date: ukDayStartInstant(kpiMtdStart),
          p_end_date: ukDayEndInstant(kpiMtdEnd),
          p_location_id: kpiLocationParam,
        }),
        // UDA count remains from appointment_summary (manually entered field)
        (supabase as any)
          .from("appointment_summary")
          .select("uda_count")
          .eq("organization_id", organizationId)
          .eq("provider_id", id)
          .gte("month", format(kpiMtdStart, "yyyy-MM-dd"))
          .lte("month", format(kpiMtdEnd, "yyyy-MM-dd")),
      ]);

      if (utilisationResult.error) throw utilisationResult.error;
      const udaCount =
        ((summaryResult.data as any[]) ?? []).reduce(
          (s: number, r: any) => s + (Number(r.uda_count) || 0),
          0,
        ) || null;

      return {
        utilisation: Number(utilisationResult.data) || 0,
        udaCount,
      };
    },
    enabled: !!organizationId && !!id && !!provider,
  });

  // Live breakdown behind the utilisation % — this provider's REAL appointment minutes,
  // working days and hours/day, so the "How Utilisation is Calculated" dialog shows the
  // actual figures, not just the formula. Matches get_provider_utilisation's filters
  // exactly, so the % reconciles with the tile.
  const { data: kpiUtilBreakdown } = useQuery({
    queryKey: [
      "kpi-util-breakdown",
      organizationId,
      kpiExtId,
      kpiLocationParam ?? "all",
      format(kpiMtdStart, "yyyy-MM-dd"),
      format(kpiMtdEnd, "yyyy-MM-dd"),
    ],
    enabled: !!organizationId && kpiExtId != null,
    queryFn: async () => {
      // Hours/day from the org setting (default 8).
      const { data: orgRow } = await (supabase as any)
        .from("organizations")
        .select("open_hours_per_day")
        .eq("id", organizationId)
        .single();
      const rawHours = Number((orgRow as any)?.open_hours_per_day);
      const hoursPerDay =
        Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 8;
      // Working days = Mon–Fri in the selected range (same as the RPC).
      let workingDays = 0;
      const cur = new Date(
        kpiMtdStart.getFullYear(),
        kpiMtdStart.getMonth(),
        kpiMtdStart.getDate(),
      );
      const end = new Date(
        kpiMtdEnd.getFullYear(),
        kpiMtdEnd.getMonth(),
        kpiMtdEnd.getDate(),
      );
      while (cur <= end) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) workingDays++;
        cur.setDate(cur.getDate() + 1);
      }
      // Total appointment minutes — identical filters to get_provider_utilisation.
      let totalMinutes = 0;
      let from = 0;
      const PAGE = 1000;
      for (;;) {
        let q = (supabase as any)
          .from("appointments")
          .select("apmt_duration")
          .eq("organization_id", organizationId)
          .eq("apmt_practitioner_id", Number(kpiExtId))
          .in("apmt_state", ["Completed", "Pending", "In surgery", "Confirmed"])
          .gte("apmt_start_time", ukDayStartInstant(kpiMtdStart))
          .lte("apmt_start_time", ukDayEndInstant(kpiMtdEnd))
          .not("apmt_duration", "is", null)
          .not("apmt_patient_id", "is", null)
          .is("deleted_at", null);
        if (kpiLocationParam) q = q.eq("location_id", kpiLocationParam);
        const { data } = await q.range(from, from + PAGE - 1);
        const rows = (data ?? []) as Array<{ apmt_duration: number | null }>;
        for (const r of rows) totalMinutes += Number(r.apmt_duration) || 0;
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      const denom = workingDays * hoursPerDay * 60;
      const pct =
        denom > 0
          ? Math.min(100, Math.round((totalMinutes / denom) * 1000) / 10)
          : 0;
      return { totalMinutes, workingDays, hoursPerDay, pct };
    },
  });

  // Compute treatment mix date range from filter
  const getTreatmentMixDateRange = () => {
    const now = new Date();
    if (
      treatmentMixFilter === "custom" &&
      treatmentMixCustomRange.from &&
      treatmentMixCustomRange.to
    )
      return {
        startDate: treatmentMixCustomRange.from,
        endDate: treatmentMixCustomRange.to,
      };
    switch (treatmentMixFilter) {
      case "this-month":
        return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
      case "this-quarter":
        return { startDate: startOfQuarter(now), endDate: endOfQuarter(now) };
      case "this-year":
        return { startDate: startOfYear(now), endDate: endOfYear(now) };
      case "last-month": {
        const d = subMonths(now, 1);
        return { startDate: startOfMonth(d), endDate: endOfMonth(d) };
      }
      case "last-quarter": {
        const d = subQuarters(now, 1);
        return { startDate: startOfQuarter(d), endDate: endOfQuarter(d) };
      }
      case "last-year": {
        const d = subYears(now, 1);
        return { startDate: startOfYear(d), endDate: endOfYear(d) };
      }
      default:
        return { startDate: startOfYear(now), endDate: endOfYear(now) };
    }
  };

  // Fetch treatment mix data using tpi_patient_nomenclature (treatment name from Dentally)
  useEffect(() => {
    const fetchTreatmentMix = async () => {
      if (!provider || !organizationId) return;
      const practitionerExtId = (provider as any).external_id;
      if (!practitionerExtId) return;

      const { startDate, endDate } = getTreatmentMixDateRange();
      // UK-day bounds for the tpi_completed_at window (Dentally stores UK-local
      // completions in UTC; e.g. a 1-Jun completion is 31-May 23:00Z). Browser-local
      // .toISOString() only lined these up for UK viewers; this works for any viewer.
      const fromDate = ukDayStartInstant(startDate);
      const toDate = ukDayEndInstant(endDate);

      setIsLoadingTreatmentMix(true);
      try {
        // Paginate to fetch all rows (Supabase default limit is 1000)
        const PAGE_SIZE = 1000;
        let allRows: any[] = [];
        let page = 0;
        while (true) {
          let query = (supabase as any)
            .from("treatment_plan_items")
            .select("tpi_patient_nomenclature, tpi_price")
            .eq("organization_id", organizationId)
            .eq("tpi_practitioner_id", Number(practitionerExtId))
            .eq("tpi_completed", true)
            .not("tpi_treatment_appointment_id", "is", null)
            .is("deleted_at", null);
          query = query
            .gte("tpi_completed_at", fromDate)
            .lte("tpi_completed_at", toDate);
          const { data: batch, error: batchError } = await query.range(
            page * PAGE_SIZE,
            (page + 1) * PAGE_SIZE - 1,
          );
          if (batchError) throw batchError;
          if (!batch || batch.length === 0) break;
          allRows = allRows.concat(batch);
          if (batch.length < PAGE_SIZE) break;
          page++;
        }
        const tpiRows = allRows;

        if (tpiRows.length === 0) {
          setTreatmentMixData([]);
          return;
        }

        // Group by treatment name (tpi_patient_nomenclature = treatment name from Dentally)
        const grouped: Record<string, { count: number; revenue: number }> = {};
        (tpiRows as any[]).forEach((row) => {
          const label = row.tpi_patient_nomenclature || "Unknown";
          if (!grouped[label]) grouped[label] = { count: 0, revenue: 0 };
          grouped[label].count += 1;
          grouped[label].revenue += Number(row.tpi_price) || 0;
        });

        const total = Object.values(grouped).reduce((s, g) => s + g.count, 0);
        setTreatmentMixData(
          Object.entries(grouped)
            .map(([name, g]) => ({
              name,
              value: total > 0 ? Math.round((g.count / total) * 100) : 0,
              revenue: Math.round(g.revenue * 100) / 100,
              count: g.count,
            }))
            .sort((a, b) => b.revenue - a.revenue),
        );
      } catch (err) {
        console.error("[TreatmentMix] Error:", err);
      } finally {
        setIsLoadingTreatmentMix(false);
      }
    };

    fetchTreatmentMix();
  }, [provider, organizationId, treatmentMixFilter, treatmentMixCustomRange]);

  // Fetch recent activity via RPC (dedup handled server-side)
  useEffect(() => {
    const fetchRecentActivity = async () => {
      if (!provider || !organizationId) return;
      const practitionerExtId = (provider as any).external_id;
      if (!practitionerExtId) return;
      setIsLoadingRecentActivity(true);
      try {
        const rpcParams: Record<string, unknown> = {
          p_organization_id: organizationId,
          p_practitioner_id: Number(practitionerExtId),
          p_limit: 10,
        };
        if (selectedLocationId) rpcParams.p_location_id = selectedLocationId;
        const { data, error } = await supabase.rpc(
          "get_provider_recent_activity",
          rpcParams,
        );
        if (error) throw error;
        setRecentActivity(
          (data ?? []).map((r: any) => ({
            treatment: r.treatment || "Treatment",
            patient: r.patient_name || "Unknown Patient",
            date: r.completed_at
              ? format(new Date(r.completed_at), "dd MMM yyyy")
              : "",
            amount: Number(r.amount) || 0,
          })),
        );
      } catch (err) {
        console.error("[RecentActivity] Error:", err);
      } finally {
        setIsLoadingRecentActivity(false);
      }
    };
    fetchRecentActivity();
  }, [provider, organizationId, selectedLocationId]);

  // Associates for the Working Hours dialog — filtered by provider_role to match the list page
  const dialogAssociates = useMemo(() => {
    const roleMap: Record<string, string[]> = {
      dentist: ["dentist", "dental surgeon", "principal dentist"],
      hygienist: ["hygienist", "dental hygienist", "hygiene"],
      therapist: ["therapist", "dental therapist", "therapy"],
    };
    const knownRoles = [
      ...roleMap.dentist,
      ...roleMap.hygienist,
      ...roleMap.therapist,
    ];
    const typeKey = type?.toLowerCase();
    const allowedRoles = typeKey ? roleMap[typeKey] : undefined;
    return allProviders.filter((p: any) => {
      const role = (p.provider_role ?? "").toLowerCase();
      if (typeKey === "other") return !knownRoles.includes(role);
      if (!allowedRoles) return true;
      if (!p.provider_role) return false;
      return allowedRoles.includes(role);
    });
  }, [allProviders, type]);

  // NHS / MOS count dialogs only show providers who opted into that treatment type.
  const nhsCountDialogAssociates = useMemo(
    () =>
      dialogAssociates.filter((p: any) =>
        providerPerformsNhs(p.additional_options),
      ),
    [dialogAssociates],
  );
  const mosCountDialogAssociates = useMemo(
    () =>
      dialogAssociates.filter((p: any) =>
        providerPerformsMos(p.additional_options),
      ),
    [dialogAssociates],
  );
  const countDialogAssociatesFor = (field: "uda_count" | "mos_count") =>
    field === "uda_count" ? nhsCountDialogAssociates : mosCountDialogAssociates;

  // Open Working Hours dialog in edit mode — load from appointment_summary
  const openEditDialog = async (monthLabel: string) => {
    const monthValue = dayjs(monthLabel, "MMM-YY").format("YYYY-MM");
    const monthDate = monthValue + "-01";

    setIsLoadingDialogData(true);
    setShowWorkingHoursDialog(true);

    try {
      // Build email → representative UUID map from dialogAssociates
      const emailToRepId = new Map<string, string>();
      for (const p of dialogAssociates) {
        const key = ((p as any).email ?? (p as any).name ?? "").toLowerCase();
        if (key && !emailToRepId.has(key)) emailToRepId.set(key, (p as any).id);
      }

      // Fetch ALL provider rows for this org to get complete email → external_ids mapping
      const { data: allOrgProviders } = await (supabase as any)
        .from("providers")
        .select("email, name, external_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("deleted_at", null);

      // Map: external_id → representative UUID (only for associates in the dialog)
      const extIdToRepId = new Map<number, string>();
      for (const p of allOrgProviders ?? []) {
        const key = ((p as any).email ?? (p as any).name ?? "").toLowerCase();
        const repId = emailToRepId.get(key);
        if (repId && (p as any).external_id) {
          extIdToRepId.set(Number((p as any).external_id), repId);
        }
      }

      const allExtIds = Array.from(extIdToRepId.keys());

      // Always load manual fields from appointment_summary (not location-filtered)
      const { data: summaryRows } = await (supabase as any)
        .from("appointment_summary")
        .select("practitioner_id, working_hours_per_day, uda_count")
        .eq("organization_id", organizationId)
        .eq("month", monthDate)
        .in("practitioner_id", allExtIds);

      const manualMap = new Map<
        string,
        { workingHoursPerDay: string; udaCount: string }
      >();
      for (const row of summaryRows ?? []) {
        const repId = extIdToRepId.get(Number(row.practitioner_id));
        if (!repId || manualMap.has(repId)) continue;
        manualMap.set(repId, {
          workingHoursPerDay:
            row.working_hours_per_day != null
              ? String(row.working_hours_per_day)
              : "",
          udaCount: row.uda_count != null ? String(row.uda_count) : "",
        });
      }

      // Load working duration — location-aware (matches the Working Hours table logic)
      const hoursMap = new Map<string, number>();
      const monthStart = dayjs(monthDate).startOf("month").format("YYYY-MM-DD");
      const monthEnd = dayjs(monthDate).endOf("month").format("YYYY-MM-DD");

      if (selectedLocationId && selectedLocationId !== "all") {
        // Specific location: use RPC (same as the Working Hours table)
        const { data: locationRows } = await (supabase as any).rpc(
          "get_provider_working_hours_by_location",
          {
            p_organization_id: organizationId,
            p_practitioner_ids: allExtIds,
            p_location_id: selectedLocationId,
            p_from_date: monthStart,
            p_to_date: monthEnd,
          },
        );
        for (const row of locationRows ?? []) {
          const repId = extIdToRepId.get(Number(row.practitioner_id));
          if (!repId) continue;
          hoursMap.set(
            repId,
            (hoursMap.get(repId) ?? 0) +
              (Number(row.working_duration_hours) || 0),
          );
        }
      } else {
        // All locations: sum from appointment_summary
        const { data: allRows } = await (supabase as any)
          .from("appointment_summary")
          .select("practitioner_id, working_duration_hours")
          .eq("organization_id", organizationId)
          .eq("month", monthDate)
          .in("practitioner_id", allExtIds);
        for (const row of allRows ?? []) {
          const repId = extIdToRepId.get(Number(row.practitioner_id));
          if (!repId) continue;
          hoursMap.set(
            repId,
            (hoursMap.get(repId) ?? 0) +
              (Number(row.working_duration_hours) || 0),
          );
        }
      }

      const rowData: Record<
        string,
        {
          workingDuration: string;
          workingHoursPerDay: string;
          udaCount: string;
        }
      > = {};
      for (const p of dialogAssociates) {
        const pid = (p as any).id;
        const total = hoursMap.get(pid) ?? 0;
        const dur = total > 0 ? String(Math.round(total * 10) / 10) : "";
        const manual = manualMap.get(pid);
        rowData[pid] = {
          workingDuration: dur,
          workingHoursPerDay: manual?.workingHoursPerDay ?? (dur ? "8" : ""),
          udaCount: manual?.udaCount ?? "",
        };
      }

      setWorkingHoursRows([{ month: monthValue, data: rowData }]);
    } finally {
      setIsLoadingDialogData(false);
    }
  };

  // Save working hours — upsert manual fields into appointment_summary
  const saveWorkingHours = async () => {
    if (!organizationId) return;

    const upsertRows: any[] = [];

    for (const row of workingHoursRows) {
      if (!row.month) continue;
      const monthDate = row.month + "-01";

      for (const associate of dialogAssociates) {
        const pid = associate.id;
        const extId = associate.external_id
          ? Number(associate.external_id)
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
      toast.error("Failed to save working hours. Please try again.");
      return;
    }

    toast.success("Working hours saved successfully.");
    refetchWorkingHours();
    setShowWorkingHoursDialog(false);
    setWorkingHoursRows([{ month: "", data: {} }]);
  };

  // NHS Count (uda_count) / MOS Count (mos_count) dialogs — same "add a month
  // row" pattern as Working Hours, each writing only its own single column so
  // neither clobbers Working Hours' own uda_count field or the other count's
  // column on save.
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
      const emailToRepId = new Map<string, string>();
      for (const p of associates) {
        const key = ((p as any).email ?? (p as any).name ?? "").toLowerCase();
        if (key && !emailToRepId.has(key)) emailToRepId.set(key, (p as any).id);
      }

      if (emailToRepId.size === 0) {
        setRows([{ month: monthValue, data: {} }]);
        return;
      }

      const { data: allOrgProviders } = await (supabase as any)
        .from("providers")
        .select("email, name, external_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("deleted_at", null);

      const extIdToRepId = new Map<number, string>();
      for (const p of allOrgProviders ?? []) {
        const key = ((p as any).email ?? (p as any).name ?? "").toLowerCase();
        const repId = emailToRepId.get(key);
        if (repId && (p as any).external_id) {
          extIdToRepId.set(Number((p as any).external_id), repId);
        }
      }

      const allExtIds = Array.from(extIdToRepId.keys());
      if (allExtIds.length === 0) {
        setRows([{ month: monthValue, data: {} }]);
        return;
      }
      const { data: summaryRows } = await (supabase as any)
        .from("appointment_summary")
        .select(`practitioner_id, ${field}`)
        .eq("organization_id", organizationId)
        .eq("month", monthDate)
        .in("practitioner_id", allExtIds);

      const rowData: Record<string, { count: string }> = {};
      for (const row of summaryRows ?? []) {
        const repId = extIdToRepId.get(Number(row.practitioner_id));
        if (!repId || rowData[repId]) continue;
        rowData[repId] = {
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
      for (const associate of associates) {
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
      queryKey: ["all-providers-counts", field],
    });
    setOpen(false);
    setRows([{ month: "", data: {} }]);
  };

  // Monthly Lab/Material Cost dialogs — a manually-entered fixed £ value per
  // month for this one provider, used when *_cost_source_method = 'monthly'.
  // Stored on provider_monthly_costs (keyed by provider_id, not the Dentally
  // practitioner_id appointment_summary uses), so it works for every provider
  // regardless of whether they have an external_id.
  const [showLabMonthlyDialog, setShowLabMonthlyDialog] = useState(false);
  const [labMonthlyRows, setLabMonthlyRows] = useState<
    { month: string; value: string }[]
  >([{ month: "", value: "" }]);
  const [isSavingLabMonthly, setIsSavingLabMonthly] = useState(false);
  const [showMaterialMonthlyDialog, setShowMaterialMonthlyDialog] =
    useState(false);
  const [materialMonthlyRows, setMaterialMonthlyRows] = useState<
    { month: string; value: string }[]
  >([{ month: "", value: "" }]);
  const [isSavingMaterialMonthly, setIsSavingMaterialMonthly] = useState(false);

  const openMonthlyCostDialog = async (
    field: "lab_cost_value" | "material_cost_value",
    setRows: (rows: { month: string; value: string }[]) => void,
    setOpen: (open: boolean) => void,
  ) => {
    setOpen(true);
    if (!provider || !organizationId) return;
    const { data } = await (supabase as any)
      .from("provider_monthly_costs")
      .select(`month, ${field}`)
      .eq("organization_id", organizationId)
      .eq("provider_id", provider.id)
      .order("month", { ascending: false });
    const rows = (data ?? [])
      .filter((r: any) => r[field] != null)
      .map((r: any) => ({
        month: String(r.month).slice(0, 7),
        value: String(r[field]),
      }));
    setRows(rows.length > 0 ? rows : [{ month: "", value: "" }]);
  };

  const saveMonthlyCostRows = async (
    rows: { month: string; value: string }[],
    field: "lab_cost_value" | "material_cost_value",
    setSaving: (v: boolean) => void,
    setOpen: (v: boolean) => void,
  ) => {
    if (!provider || !organizationId) return;
    setSaving(true);
    try {
      const records = rows
        .filter((r) => r.month)
        .map((r) => ({
          organization_id: organizationId,
          provider_id: provider.id,
          month: `${r.month}-01`,
          [field]: r.value ? Number(r.value) : null,
        }));
      if (records.length > 0) {
        const { error } = await (supabase as any)
          .from("provider_monthly_costs")
          .upsert(records, { onConflict: "organization_id,provider_id,month" });
        if (error) throw error;
      }
      toast.success("Monthly values saved successfully");
      setOpen(false);
    } catch (error: any) {
      console.error(
        "[ProviderDetail] Error saving monthly cost values:",
        error,
      );
      toast.error(error.message || "Failed to save monthly values");
    } finally {
      setSaving(false);
    }
  };

  const addMonthlyCostRow = (
    setRows: React.Dispatch<
      React.SetStateAction<{ month: string; value: string }[]>
    >,
  ) => {
    setRows((prev) => [...prev, { month: "", value: "" }]);
  };
  const removeMonthlyCostRow = (
    index: number,
    setRows: React.Dispatch<
      React.SetStateAction<{ month: string; value: string }[]>
    >,
  ) => {
    setRows((prev) =>
      prev.length === 1
        ? [{ month: "", value: "" }]
        : prev.filter((_, i) => i !== index),
    );
  };

  // Initialize settings when provider data loads
  useEffect(() => {
    if (provider) {
      setProviderSettings({
        revenueTarget: Number(provider.revenue) * 1.1,
        patientsTarget: provider.patients + 30,
        utilisationTarget: 90,
        newPatientsTarget: Math.floor(provider.patients * 0.12),
        recallRateTarget: 80,
      });
      // Initialize edit form
      const validRoles = ["dentist", "hygienist", "therapist"];
      const roleFromDb = provider.provider_role?.toLowerCase() || "";
      const isValidRole = validRoles.includes(roleFromDb);

      const splitMethod =
        (provider as any).split_source_method || "flat-percentage";
      // Load Lab Split Percentage based on Split Source Method
      // If sliding-scale: use lab_split_percentage_sliding from provider
      // If flat-percentage: use lab_split_percentage from provider (database field)
      const labSplitValue =
        splitMethod === "sliding-scale"
          ? (provider as any).lab_split_percentage_sliding || 0
          : (provider as any).lab_split_percentage || 50;

      setEditFormData({
        providerCode: (provider as any).provider_code || provider.name || "",
        name: provider.name || "",
        role: isValidRole ? roleFromDb : "other",
        originalRole: provider.provider_role || "", // Store original role from database
        primaryChair:
          (provider as any).primary_chair || provider.provider_role || "",
        email: provider.email || "",
        phone: provider.phone || "",
        performsNhsTreatments: providerPerformsNhs(
          (provider as any).additional_options,
        ),
        performsMosTreatments: providerPerformsMos(
          (provider as any).additional_options,
        ),
        isPrincipalAssociate: (provider as any).is_principal_associate || false,
        splitSourceMethod: splitMethod,
        associateSplitPercentage:
          (provider as any).associate_split_percentage || 50,
        labSplitPercentage: labSplitValue,
        perCaseRate: (provider as any).associate_split_per_case_rate || 0,
        perHourRate: (provider as any).associate_split_per_hour_rate || 0,
        employmentType: ((provider as any).employment_type ||
          "self-employed") as ProviderEmploymentType,
        workingDays: WORKING_DAYS.reduce((acc, day) => {
          const fromDb = (provider as any).working_days?.[day.key];
          acc[day.key] = fromDb
            ? {
                ...DEFAULT_WORKING_DAYS[day.key],
                ...fromDb,
                treatmentIds: fromDb.treatmentIds || [],
              }
            : DEFAULT_WORKING_DAYS[day.key];
          return acc;
        }, {} as ProviderWorkingDays),
        joiningDate: provider.joining_date
          ? new Date(provider.joining_date)
          : null,
        leavingDate: (provider as any).leaving_date
          ? new Date((provider as any).leaving_date)
          : null,
        contractStartDate: (provider as any).contract_start_date
          ? new Date((provider as any).contract_start_date)
          : null,
        contractEndDate: (provider as any).contract_end_date
          ? new Date((provider as any).contract_end_date)
          : null,
        provider_type_id: provider.provider_type_id,
        specialty_id: provider.specialty_id,
        location_id: provider.location_id,
        membershipIncome: null,
        nhsIncome: null,
      });

      setLabCostConfig({
        sourceMethod: ((provider as any).lab_cost_source_method ||
          "flat_percentage") as ProviderCostSourceMethod,
        percentage: (provider as any).lab_cost_percentage || 0,
        accountId: (provider as any).lab_cost_account_id || "",
        accountPlatform: ((provider as any).lab_cost_account_platform || "") as
          | ProviderCostAccountPlatform
          | "",
      });
      setMaterialCostConfig({
        sourceMethod: ((provider as any).material_cost_source_method ||
          "flat_percentage") as ProviderCostSourceMethod,
        percentage: (provider as any).material_cost_percentage || 0,
        accountId: (provider as any).material_cost_account_id || "",
        accountPlatform: ((provider as any).material_cost_account_platform ||
          "") as ProviderCostAccountPlatform | "",
      });
      setMaterialSplitPercentage(
        (provider as any).material_split_percentage ?? 50,
      );

      // Clear validation errors when loading provider data
      setValidationErrors({
        providerCode: "",
        name: "",
        email: "",
        phone: "",
        primaryChair: "",
        joiningDate: "",
      });

      // Load income type data from database
      const loadIncomeData = async () => {
        try {
          const { data, error } = await supabase
            .from("providers")
            .select("membership_income, nhs_income")
            .eq("id", provider.id)
            .single();

          if (error) throw error;

          const providerData = data as any;

          // Parse and set membership_income (single selection)
          if (providerData?.membership_income) {
            try {
              let accountId = null;
              const membershipValue = providerData.membership_income;

              // Check if it's a plain UUID string (new format) or needs parsing (old format)
              if (
                typeof membershipValue === "string" &&
                membershipValue.match(/^[0-9a-f-]{36}$/i)
              ) {
                accountId = membershipValue;
              } else {
                const parsed = JSON.parse(membershipValue);
                accountId = Array.isArray(parsed)
                  ? parsed[0] || null
                  : parsed || null;
              }

              setIncomeTypes((prev) => ({
                ...prev,
                membershipIncome: accountId,
              }));
            } catch (e) {
              console.error("Error parsing membership_income:", e);
            }
          }

          // Parse and set nhs_income (single selection)
          if (providerData?.nhs_income) {
            try {
              let accountId = null;
              const nhsValue = providerData.nhs_income;

              // Check if it's a plain UUID string (new format) or needs parsing (old format)
              if (
                typeof nhsValue === "string" &&
                nhsValue.match(/^[0-9a-f-]{36}$/i)
              ) {
                accountId = nhsValue;
              } else {
                const parsed = JSON.parse(nhsValue);
                accountId = Array.isArray(parsed)
                  ? parsed[0] || null
                  : parsed || null;
              }

              setIncomeTypes((prev) => ({
                ...prev,
                nhsIncome: accountId,
              }));
            } catch (e) {
              console.error("Error parsing nhs_income:", e);
            }
          }
        } catch (error) {
          console.error("Error loading income data:", error);
        }
      };

      loadIncomeData();
    }
  }, [provider]);

  // Dynamically update Lab Split Percentage when Split Source Method changes
  useEffect(() => {
    if (!provider) return;

    if (editFormData.splitSourceMethod === "flat-percentage") {
      // Load from provider database field (lab_split_percentage)
      const labSplitFlat = (provider as any).lab_split_percentage || 50;
      setEditFormData((prev) => ({
        ...prev,
        labSplitPercentage: labSplitFlat,
      }));
    } else if (editFormData.splitSourceMethod === "sliding-scale") {
      // Load from provider.lab_split_percentage_sliding
      const labSplitSliding =
        (provider as any).lab_split_percentage_sliding || 0;
      setEditFormData((prev) => ({
        ...prev,
        labSplitPercentage: labSplitSliding,
      }));
    }
  }, [editFormData.splitSourceMethod, provider]);

  // Calculate total production from net production data for Profit Goals
  const totalProduction = useMemo(() => {
    let total = 0;

    if (
      profitGoalsNetProductionData &&
      typeof profitGoalsNetProductionData === "object"
    ) {
      const data = profitGoalsNetProductionData as any;

      console.log("[ProviderDetail] profitGoalsNetProductionData:", {
        hasMonthlyProduction: !!data.monthlyProduction,
        monthlyProductionLength: data.monthlyProduction?.length,
        monthlyProduction: data.monthlyProduction,
        profitGoalsDateRange,
      });

      // If we have monthly production data and date range, filter by profit goals dates
      if (
        data.monthlyProduction &&
        Array.isArray(data.monthlyProduction) &&
        profitGoalsDateRange.from &&
        profitGoalsDateRange.to
      ) {
        const startDate = profitGoalsDateRange.from;
        const endDate = profitGoalsDateRange.to;

        console.log("[ProviderDetail] Filtering production data:", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          monthCount: data.monthlyProduction.length,
        });

        // Filter and sum only months within the profit goals date range
        total = data.monthlyProduction.reduce((sum: number, monthData: any) => {
          // Parse month string (e.g., "Apr-25" to date)
          const monthStr = monthData.month; // e.g., "Apr-25"
          const [monthName, year] = monthStr.split("-");
          const monthIndex = new Date(`${monthName} 1, 20${year}`).getMonth();
          const monthDate = new Date(2000 + parseInt(year), monthIndex, 1);

          const isInRange = monthDate >= startDate && monthDate <= endDate;
          console.log("[ProviderDetail] Month check:", {
            monthStr,
            monthDate: monthDate.toISOString(),
            amount: monthData.amount,
            isInRange,
            currentSum: sum,
          });

          // Check if this month is within the profit goals date range
          if (isInRange) {
            return sum + (monthData.amount || 0);
          }
          return sum;
        }, 0);

        console.log("[ProviderDetail] Final totalProduction:", total);
      } else {
        // Fallback to using totalProduction field if filtering not possible
        total = data.totalProduction || 0;
      }
    }

    return total;
  }, [profitGoalsNetProductionData, profitGoalsDateRange]);

  // Resolve this provider's lab/material cost — location flat percentage
  // unless their location is Associate Wise and they've been configured with
  // their own cost source (accounting application / sliding scale / monthly).
  useEffect(() => {
    const resolveCosts = async () => {
      if (
        !provider ||
        !organizationId ||
        !profitGoalsDateRange.from ||
        !profitGoalsDateRange.to
      )
        return;

      try {
        const row: ProviderCostInputRow = {
          id: provider.id,
          location_id: (provider as any).location_id ?? null,
          lab_cost_source_method:
            (provider as any).lab_cost_source_method ?? null,
          lab_cost_percentage: (provider as any).lab_cost_percentage ?? null,
          lab_cost_account_id: (provider as any).lab_cost_account_id ?? null,
          lab_cost_account_platform:
            (provider as any).lab_cost_account_platform ?? null,
          material_cost_source_method:
            (provider as any).material_cost_source_method ?? null,
          material_cost_percentage:
            (provider as any).material_cost_percentage ?? null,
          material_cost_account_id:
            (provider as any).material_cost_account_id ?? null,
          material_cost_account_platform:
            (provider as any).material_cost_account_platform ?? null,
        };

        const inputs = await loadProviderCostInputs({
          organizationId,
          providers: [row],
          dateFrom: profitGoalsDateRange.from,
          dateTo: profitGoalsDateRange.to,
        });

        const gate = row.location_id
          ? inputs.locationGateByLocationId.get(row.location_id)
          : undefined;
        const labGateActive =
          gate?.associate_cost_lab_source === "associate_wise";
        const materialGateActive =
          gate?.material_cost_source === "associate_wise";

        const lab = resolveProviderCost({
          sourceMethod: labGateActive ? row.lab_cost_source_method : null,
          flatPercentage: row.lab_cost_percentage,
          production: totalProduction,
          accountAmount:
            inputs.accountAmountByProviderId.get(provider.id)?.lab ?? null,
          monthlyValues:
            inputs.monthlyValuesByProviderId.get(provider.id)?.lab ?? [],
          monthlyBillByMonth: row.location_id
            ? (inputs.monthlyBillByLocationId.get(row.location_id)?.lab ?? [])
            : [],
          bands: inputs.bandsByProviderId.get(provider.id)?.lab ?? [],
          fallbackLocationPercent:
            gate?.associate_cost_labs_percent ??
            profitGoalsMetrics.associateCostLabsPercent,
        });

        const material = resolveProviderCost({
          sourceMethod: materialGateActive
            ? row.material_cost_source_method
            : null,
          flatPercentage: row.material_cost_percentage,
          production: totalProduction,
          accountAmount:
            inputs.accountAmountByProviderId.get(provider.id)?.material ?? null,
          monthlyValues:
            inputs.monthlyValuesByProviderId.get(provider.id)?.material ?? [],
          monthlyBillByMonth: row.location_id
            ? (inputs.monthlyBillByLocationId.get(row.location_id)?.material ??
              [])
            : [],
          bands: inputs.bandsByProviderId.get(provider.id)?.material ?? [],
          fallbackLocationPercent:
            gate?.practice_cost_materials_percent ??
            profitGoalsMetrics.practiceCostMaterialsPercent,
        });

        setResolvedProviderCosts({ lab, material });
      } catch (error) {
        console.error("[ProviderDetail] Error resolving provider cost:", error);
      }
    };

    resolveCosts();
  }, [
    provider,
    organizationId,
    totalProduction,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
    profitGoalsMetrics.associateCostLabsPercent,
    profitGoalsMetrics.practiceCostMaterialsPercent,
  ]);

  // Calculate associate-specific metrics based on Excel formulas
  useEffect(() => {
    if (!provider || !profitGoalsMetrics.assocDaysPerYear) {
      return;
    }

    // Get provider's split percentages
    const associateSplitPercent =
      (provider as any).associate_split_percentage || 30;
    const associateLabSplitPercent =
      editFormData.splitSourceMethod === "sliding-scale"
        ? (provider as any).lab_split_percentage_sliding || 0
        : (provider as any).lab_split_percentage || 50;

    // Calculate working days from working hours data (use profitGoalsWorkingHoursData for calculations)
    // Use totalHours directly — the hook already filters to the requested date range and returns
    // the raw unrounded sum. Summing the per-month rounded values accumulates rounding error.
    let totalWorkingHours = 0;

    if (
      profitGoalsWorkingHoursData &&
      typeof profitGoalsWorkingHoursData === "object"
    ) {
      const hoursData = profitGoalsWorkingHoursData as any;
      totalWorkingHours = hoursData.totalHours || 0;
    }

    // Get hours per day from business info (open_hours_per_day)
    const hoursPerDay = profitGoalsMetrics.openHoursPerDay || 8;
    const workingDays = hoursPerDay > 0 ? totalWorkingHours / hoursPerDay : 0;

    // Calculate average daily production based on working days
    const avgDailyProduction =
      workingDays > 0 ? totalProduction / workingDays : 0;

    // Cost of Labs / Materials come from the resolved provider cost — location
    // flat percentage × production, unless this provider's location is
    // Associate Wise and they've been configured with their own cost source
    // (accounting application / sliding scale / monthly all resolve to an
    // absolute £ figure rather than a percentage of production).
    const costOfLabs = resolvedProviderCosts.lab.amount;
    const materialsCosts = resolvedProviderCosts.material.amount;

    // Excel Formula: Associate Net Pay = (Total Production * Associate Split %) - (Cost of Labs * Associate Lab Split %)
    const associateGrossShare = totalProduction * (associateSplitPercent / 100);
    const labCostDeduction = costOfLabs * (associateLabSplitPercent / 100);
    const associateNetPay = associateGrossShare - labCostDeduction;

    // Calculate number of months in date range
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

    // Excel Formula: OCPSPA Contribution = OCPSPD * Working Days (not Assoc days/year)
    const ocpspaContribution = profitGoalsMetrics.ocpspd * workingDays;

    // Excel Formula: Practice P/L = Total Production - (Associate Net Pay + Cost of Labs + Materials + OCPSPD Contribution)
    const practicePL =
      totalProduction -
      (associateNetPay + costOfLabs + materialsCosts + ocpspaContribution);

    // Excel Formula: P/L % on OCPSPD = (Practice P/L / OCPSPD Contribution) * 100
    const plPercentOnOCPSPD =
      ocpspaContribution > 0 ? (practicePL / ocpspaContribution) * 100 : 0;

    // Excel Formula: P/L on Room /Day = Practice P/L / Working Days (not Assoc days/year)
    const plOnRoomPerDay = workingDays > 0 ? practicePL / workingDays : 0;

    setAssociateMetrics({
      avgDailyProduction,
      totalProduction,
      associateSplitPercent,
      associateLabSplitPercent,
      workingDays,
      associateNetPay,
      costOfLabs,
      avgLabCostPerMonth,
      materialsCosts,
      ocpspaContribution,
      practicePL,
      plPercentOnOCPSPD,
      plOnRoomPerDay,
    });
  }, [
    provider,
    profitGoalsMetrics,
    resolvedProviderCosts,
    editFormData.splitSourceMethod,
    profitGoalsNetProductionData,
    profitGoalsWorkingHoursData,
    profitGoalsDateRange.from,
    profitGoalsDateRange.to,
  ]);

  // Calculate planned metrics based on planned avg daily production input
  useEffect(() => {
    if (
      !associateMetrics.workingDays ||
      !profitGoalsMetrics.associateCostLabsPercent
    )
      return;

    // Calculate Planned Total Production = Planned Avg Daily Production × Working Days
    const plannedTotalProduction =
      plannedAvgDailyProduction * associateMetrics.workingDays;

    // Accounting-application / sliding-scale / monthly cost sources resolve to
    // an absolute £ figure, not a percentage of production — there's no
    // defined "planned" variant for those, so the planned figure is the same
    // actual resolved amount. Only a production-scaled basis (location flat
    // percentage, or a provider's own flat percentage) scales with planned
    // production, using the effective rate implied by the actual figures.
    const plannedCostOfLabs = isProductionScaledBasis(
      resolvedProviderCosts.lab.basis,
    )
      ? plannedTotalProduction *
        (totalProduction > 0
          ? resolvedProviderCosts.lab.amount / totalProduction
          : 0)
      : resolvedProviderCosts.lab.amount;
    const plannedMaterials = isProductionScaledBasis(
      resolvedProviderCosts.material.basis,
    )
      ? plannedTotalProduction *
        (totalProduction > 0
          ? resolvedProviderCosts.material.amount / totalProduction
          : 0)
      : resolvedProviderCosts.material.amount;

    // Calculate Planned Associate Net Pay using same formula as Actual
    const plannedAssociateGrossShare =
      plannedTotalProduction * (associateMetrics.associateSplitPercent / 100);
    const plannedLabCostDeduction =
      plannedCostOfLabs * (associateMetrics.associateLabSplitPercent / 100);
    const plannedAssociateNetPay =
      plannedAssociateGrossShare - plannedLabCostDeduction;

    // Calculate Planned Practice P/L
    // Formula: Planned Total Production - (ACTUAL Associate Net Pay + ACTUAL Cost of Labs + PLANNED Materials + ACTUAL OCPSPA)
    // Note: Materials use PLANNED value (based on planned production), not actual
    const plannedPracticePL =
      plannedTotalProduction -
      (associateMetrics.associateNetPay +
        associateMetrics.costOfLabs +
        plannedMaterials +
        associateMetrics.ocpspaContribution);

    setPlannedMetrics({
      plannedTotalProduction,
      plannedAssociateNetPay,
      plannedCostOfLabs,
      plannedMaterials,
      plannedPracticePL,
    });
  }, [
    plannedAvgDailyProduction,
    associateMetrics,
    profitGoalsMetrics,
    resolvedProviderCosts,
    totalProduction,
  ]);

  // Fetch Chart of Accounts — platform-aware (iplicit vs xero/generic)
  useEffect(() => {
    const fetchChartOfAccounts = async () => {
      if (!provider || !organizationId) return;

      setIsLoadingCOA(true);
      try {
        // Step 1: Determine which accounting platform is connected
        const { data: platformIntegrations } = await (supabase as any)
          .from("platform_integrations")
          .select("id, platform_name")
          .eq("organization_id", organizationId)
          .eq("is_connected", true)
          .limit(1)
          .maybeSingle();

        const platformName = platformIntegrations?.platform_name?.toLowerCase();

        // Step 2a: Iplicit — use dedicated iplicit_chart_of_accounts table
        if (platformName === "iplicit") {
          const { data: coaData, error: coaError } = await (supabase as any)
            .from("iplicit_chart_of_accounts")
            .select("id, code, name, account_type, account_id")
            .eq("organization_id", organizationId)
            .eq("is_active", true)
            .order("account_type", { ascending: true })
            .order("code", { ascending: true });

          if (coaError) {
            console.error(
              "Error fetching iplicit chart of accounts:",
              coaError,
            );
            setChartOfAccounts([]);
            return;
          }

          // Normalize to common shape used by the UI
          // native_id = platform account ID stored in providers.membership_income / nhs_income
          const normalized = (coaData || []).map((a: any) => ({
            id: a.id,
            native_id: a.account_id, // iplicit_profit_loss joins on account_id
            account_code: a.code,
            account_name: a.name,
            account_type: a.account_type,
          }));
          console.log(
            "Fetched iplicit chart of accounts:",
            normalized.length,
            "accounts",
          );
          setChartOfAccounts(normalized);
          return;
        }

        // Step 2b: Xero / QuickBooks / generic — use xero_chart_of_accounts
        // xero_chart_of_accounts.xero_tenant_id stores the row UUID from
        // platform_integration_organizations (not the Xero GUID string).
        let xeroTenantUUID: string | null = null;

        if (provider.location_id) {
          const { data: mappingData } = await (supabase as any)
            .from("platform_integration_organization_mapping")
            .select(
              `platform_integration_organizations:platform_integration_organizations_id (id, platform_org_id, platform_org_name, platform_name)`,
            )
            .eq("location_id", provider.location_id)
            .maybeSingle();

          if (mappingData?.platform_integration_organizations) {
            const platformOrg = mappingData.platform_integration_organizations;
            setMappedOrganization(platformOrg);
            xeroTenantUUID = platformOrg.id;
          }
        }

        if (!xeroTenantUUID) {
          const { data: orgMappings } = await (supabase as any)
            .from("platform_integration_organization_mapping")
            .select(
              `platform_integration_organizations:platform_integration_organizations_id (id, platform_org_id, platform_org_name, platform_name)`,
            )
            .eq("organization_id", organizationId)
            .limit(1)
            .maybeSingle();

          if (orgMappings?.platform_integration_organizations) {
            const platformOrg = orgMappings.platform_integration_organizations;
            setMappedOrganization(platformOrg);
            xeroTenantUUID = platformOrg.id;
          }
        }

        if (!xeroTenantUUID) {
          setChartOfAccounts([]);
          setMappedOrganization(null);
          return;
        }

        const { data: coaData, error: coaError } = await (supabase as any)
          .from("xero_chart_of_accounts")
          .select(
            "id, account_code, account_name, account_type, xero_account_id",
          )
          .eq("xero_tenant_id", xeroTenantUUID)
          .eq("is_active", true)
          .order("account_type", { ascending: true })
          .order("account_code", { ascending: true });

        if (coaError) {
          console.error("Error fetching chart of accounts:", coaError);
          setChartOfAccounts([]);
          return;
        }

        console.log(
          "Fetched chart of accounts:",
          coaData?.length || 0,
          "accounts",
        );
        // Normalize Xero CoA — native_id = xero_account_id (used in xero_profit_loss)
        const normalizedXero = (coaData || []).map((a: any) => ({
          ...a,
          native_id: a.xero_account_id,
        }));
        setChartOfAccounts(normalizedXero);

        // Fetch location's Provider Income account allow-lists so we can filter the dropdowns
        if (provider.location_id) {
          const { data: locData } = await (supabase as any)
            .from("practice_locations")
            .select(
              "provider_membership_income_accounts, provider_nhs_income_accounts",
            )
            .eq("id", provider.location_id)
            .maybeSingle();
          setProviderMembershipAccountIds(
            locData?.provider_membership_income_accounts ?? [],
          );
          setProviderNhsAccountIds(locData?.provider_nhs_income_accounts ?? []);
        }
      } catch (error) {
        console.error("Error in fetchChartOfAccounts:", error);
        setChartOfAccounts([]);
        setMappedOrganization(null);
      } finally {
        setIsLoadingCOA(false);
      }
    };

    fetchChartOfAccounts();
  }, [provider?.location_id, provider?.organization_id, organizationId]);

  // Fetch saved planned daily production records
  useEffect(() => {
    const fetchSavedPlannedRecords = async () => {
      if (!id || !organizationId) return;

      try {
        const { data, error } = await supabase
          .from("planned_daily_production")
          .select(
            `
            id,
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
          .eq("provider_id", id)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching planned production records:", error);
          return;
        }

        console.log("Fetched planned production records:", data);
        setSavedPlannedRecords(data || []);

        // Auto-populate input with most recent saved record
        if (data && data.length > 0) {
          const mostRecentRecord = data[0];
          const savedValue = Number(mostRecentRecord.average_daily_production);

          console.log("Loading most recent saved record:", {
            value: savedValue,
            createdAt: mostRecentRecord.created_at,
          });

          // Set both the actual value and the input display value
          setPlannedAvgDailyProduction(savedValue);
          setPlannedInputValue(String(savedValue));
        }
      } catch (error) {
        console.error("Error in fetchSavedPlannedRecords:", error);
      }
    };

    fetchSavedPlannedRecords();
  }, [id, organizationId]);

  // Save planned daily production record
  const savePlannedDailyProduction = async () => {
    if (!id || !organizationId) {
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

    if (plannedAvgDailyProduction < 0) {
      toast.error("Please enter a valid planned average daily production");
      return;
    }

    setIsSavingPlanned(true);

    try {
      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        toast.error("Failed to get user information");
        return;
      }

      // Prepare data to save
      const recordData = {
        organization_id: organizationId,
        provider_id: id,
        user_id: user.id,
        average_daily_production: plannedAvgDailyProduction,
        date_range_start: format(profitGoalsDateRange.from, "yyyy-MM-dd"),
        date_range_end: format(profitGoalsDateRange.to, "yyyy-MM-dd"),
        planning_month: format(planningMonth, "yyyy-MM-01"), // Store as first day of month
        planned_total_production: plannedMetrics.plannedTotalProduction,
        planned_associate_net_pay: plannedMetrics.plannedAssociateNetPay,
        planned_cost_of_labs: plannedMetrics.plannedCostOfLabs,
        planned_materials: plannedMetrics.plannedMaterials,
        planned_practice_pl: plannedMetrics.plannedPracticePL,
        working_days: associateMetrics.workingDays,
        created_by: user.id,
        created_by_email: user.email,
      };

      // Always insert new record (allow multiple saves)
      const { data, error } = await supabase
        .from("planned_daily_production")
        .insert(recordData)
        .select()
        .single();

      if (error) {
        console.error("Error saving planned production:", error);
        toast.error("Failed to save planned production");
        return;
      }

      toast.success("Planned production saved successfully");

      // Refresh the records list
      const { data: updatedRecords, error: fetchError } = await supabase
        .from("planned_daily_production")
        .select(
          `
          id,
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
        .eq("provider_id", id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (!fetchError && updatedRecords) {
        setSavedPlannedRecords(updatedRecords);
      }
    } catch (error) {
      console.error("Error in savePlannedDailyProduction:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSavingPlanned(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <MainLayout
        aiContext={{
          page: "provider-detail",
          providerId: id ?? null,
          providerType: type ?? null,
          status: "loading",
        }}
      >
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  // Error or not found state
  if (error || !provider) {
    return (
      <MainLayout
        aiContext={{
          page: "provider-detail",
          providerId: id ?? null,
          providerType: type ?? null,
          status: "not-found",
        }}
      >
        <div className="flex flex-col items-center justify-center h-64">
          <h2 className="text-xl font-semibold mb-2">Provider Not Found</h2>
          <p className="text-muted-foreground mb-4">
            The provider you're looking for doesn't exist or you don't have
            access.
          </p>
          <Button onClick={() => navigate(`/providers/${type || "dentist"}`)}>
            Back to Providers
          </Button>
        </div>
      </MainLayout>
    );
  }

  // Transform database provider to match UI structure
  const providerData = {
    id: provider.id,
    type: provider.provider_types?.code || "",
    name: provider.name,
    title: provider.provider_types?.name || "Provider",
    specialty: provider.specialties?.name || "General",
    location: "Location", // TODO: Fetch from practice
    email: provider.email || "",
    phone: provider.phone || "",
    // Local calendar date, not the UTC date — a created_at instant just after midnight
    // UK time would otherwise display the previous day. (created_at is a placeholder for
    // a real join date; keep the shown day in the viewer's local calendar regardless.)
    joinDate: toLocalYMD(new Date(provider.created_at)) ?? "",
    avatar: provider.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2),
    rating: 4.5, // TODO: Calculate from reviews
    kpis: {
      revenue: {
        current: kpiMtdProduction?.totalProduction ?? 0,
        target:
          Number(provider.revenue) > 0 ? Number(provider.revenue) / 12 : 0,
      },
      patients: {
        current: kpiPatientCounts?.current ?? 0,
        target: 0,
      },
      avgRevPerPatient: {
        current:
          (kpiPatientCounts?.current ?? 0) > 0
            ? (kpiMtdProduction?.totalProduction ?? 0) /
              (kpiPatientCounts?.current ?? 1)
            : 0,
        target: 0,
      },
      utilisation: {
        // Prefer the live breakdown (correct Europe/London working-days count) so the
        // headline matches the "How Utilisation is Calculated" tooltip. Falls back to
        // the RPC while the breakdown loads or if it can't be computed. Once migration
        // 20260721000003 is applied the RPC returns the same value.
        current: kpiUtilBreakdown?.pct ?? kpiUtilisation?.utilisation ?? 0,
        udaCount: kpiUtilisation?.udaCount ?? null,
        target: 90,
        prior: 0,
      },
      newPatients: {
        current: kpiPatientCounts?.newPatients ?? 0,
        target: 0,
        prior: 0,
      },
      recallRate: {
        current: kpiPatientCounts?.recallRate ?? 0,
        target: 80,
        prior: 0,
      },
    },
    // Mock data for charts (TODO: Fetch from actual data)
    monthlyRevenue: [
      {
        month: "Jul",
        actual: Number(provider.revenue) * 0.15,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.14,
      },
      {
        month: "Aug",
        actual: Number(provider.revenue) * 0.14,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.13,
      },
      {
        month: "Sep",
        actual: Number(provider.revenue) * 0.17,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.16,
      },
      {
        month: "Oct",
        actual: Number(provider.revenue) * 0.18,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.17,
      },
      {
        month: "Nov",
        actual: Number(provider.revenue) * 0.19,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.18,
      },
      {
        month: "Dec",
        actual: Number(provider.revenue) * 0.17,
        target: Number(provider.revenue) * 0.18,
        prior: Number(provider.revenue) * 0.17,
      },
    ],
    treatmentMix: [
      {
        name: "Examinations",
        value: 35,
        revenue: Number(provider.revenue) * 0.12,
      },
      { name: "Fillings", value: 25, revenue: Number(provider.revenue) * 0.17 },
      { name: "Crowns", value: 15, revenue: Number(provider.revenue) * 0.21 },
      {
        name: "Root Canal",
        value: 10,
        revenue: Number(provider.revenue) * 0.17,
      },
      {
        name: "Extractions",
        value: 8,
        revenue: Number(provider.revenue) * 0.06,
      },
      { name: "Other", value: 7, revenue: Number(provider.revenue) * 0.07 },
    ],
    weeklySchedule: [
      {
        day: "Mon",
        slots: 16,
        booked: Math.floor(16 * (Number(provider.utilisation) / 100)),
        utilisation: Number(provider.utilisation),
      },
      {
        day: "Tue",
        slots: 16,
        booked: Math.floor(16 * (Number(provider.utilisation) / 100)),
        utilisation: Number(provider.utilisation),
      },
      {
        day: "Wed",
        slots: 16,
        booked: Math.floor(16 * (Number(provider.utilisation) / 100)),
        utilisation: Number(provider.utilisation),
      },
      {
        day: "Thu",
        slots: 16,
        booked: Math.floor(16 * (Number(provider.utilisation) / 100)),
        utilisation: Number(provider.utilisation),
      },
      {
        day: "Fri",
        slots: 16,
        booked: Math.floor(16 * (Number(provider.utilisation) / 100)),
        utilisation: Number(provider.utilisation),
      },
    ],
    patientFeedback: {
      overall: 4.5,
      communication: 4.4,
      punctuality: 4.3,
      careQuality: 4.6,
      reviews: provider.patients,
    },
    recentActivity: [
      {
        date: new Date().toISOString().split("T")[0],
        type: "Crown",
        patient: "Patient A",
        revenue: 850,
      },
      {
        date: new Date().toISOString().split("T")[0],
        type: "Filling",
        patient: "Patient B",
        revenue: 120,
      },
      {
        date: new Date().toISOString().split("T")[0],
        type: "Examination",
        patient: "Patient C",
        revenue: 65,
      },
    ],
    goals: [
      { goal: "Increase revenue by 10%", progress: 75, status: "On Track" },
      {
        goal: "Reduce cancellation rate to <5%",
        progress: 85,
        status: "Achieved",
      },
      {
        goal: `Complete ${provider.patients + 30} patient exams`,
        progress: 90,
        status: "On Track",
      },
      {
        goal: "Maintain 90%+ utilisation",
        progress: Number(provider.utilisation),
        status: Number(provider.utilisation) >= 90 ? "Achieved" : "On Track",
      },
    ],
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      currencySign: "accounting",
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    }).format(value);
  };

  // Build AI context for chatbot — single provider deep-dive
  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined
      ? null
      : Math.round((Number(n) || 0) * 100) / 100;
  const selectedLocationName = selectedLocationId
    ? (locations.find((l: any) => l.id === selectedLocationId)?.name ??
      "Selected Location")
    : "All Locations";
  const providerLocationName = (provider as any)?.location_id
    ? (locations.find((l: any) => l.id === (provider as any).location_id)
        ?.name ?? null)
    : null;

  const compactNetProduction = (netProductionData || [])
    .slice(0, 60)
    .map((r: any) => ({
      month: r.month ?? r.label ?? null,
      netProduction: round2(r.netProduction ?? r.totalProduction ?? 0),
      workingDays: r.workingDays ?? null,
      workingHours: r.workingHours ?? null,
    }));

  const aiContextData = {
    page: "provider-detail",
    providerId: providerData.id,
    providerName: providerData.name,
    providerType: providerData.type,
    providerTitle: providerData.title,
    specialty: providerData.specialty,
    locationName: providerLocationName ?? selectedLocationName,
    selectedLocationName,
    period: {
      // Use LOCAL calendar date, not toISOString().slice — the range is built at local
      // midnight (startDate) / local end-of-day (endDate), and toISOString() converts to
      // UTC, rolling a UK/BST startDate back a day (June → 31 May). See toLocalYMD docstring.
      from: globalDateRange?.startDate
        ? toLocalYMD(globalDateRange.startDate)
        : null,
      to: globalDateRange?.endDate ? toLocalYMD(globalDateRange.endDate) : null,
      rangeId: selectedDateRangeId,
      selectedPeriod,
    },
    summary: {
      revenueCurrent: round2(providerData.kpis.revenue.current),
      revenueTarget: round2(providerData.kpis.revenue.target),
      patientsCurrent: providerData.kpis.patients.current,
      avgRevenuePerPatient: round2(providerData.kpis.avgRevPerPatient.current),
      utilisationPercent: round2(providerData.kpis.utilisation.current),
      utilisationTarget: providerData.kpis.utilisation.target,
      udaCount: providerData.kpis.utilisation.udaCount ?? null,
      newPatients: providerData.kpis.newPatients.current,
      recallRatePercent: round2(providerData.kpis.recallRate.current),
    },
    netProductionRowCount: netProductionData?.length ?? 0,
    netProduction: compactNetProduction,
    treatmentMix: (providerData.treatmentMix || []).map((t: any) => ({
      name: t.name,
      sharePercent: t.value,
      revenue: round2(t.revenue),
    })),
    weeklySchedule: (providerData.weeklySchedule || []).map((d: any) => ({
      day: d.day,
      slots: d.slots,
      booked: d.booked,
      utilisationPercent: d.utilisation,
    })),
    goals: (providerData.goals || []).map((g: any) => ({
      goal: g.goal,
      progressPercent: g.progress,
      status: g.status,
    })),
  };

  return (
    <MainLayout aiContext={aiContextData}>
      <Helmet>
        <title>Provider Profile & Performance</title>
        <meta
          name="description"
          content="Detailed provider information including production metrics, costs, sliding scales, and performance analytics."
        />
      </Helmet>
      <div className="space-y-6">
        {/* Back Button & Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/providers/${type || "dentist"}`)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <div
                className={`w-16 h-16 rounded-full bg-gradient-to-br ${getTypeColor(providerData.type, activeProviderTypes)} flex items-center justify-center text-white font-bold text-xl shadow-lg`}
              >
                {providerData.avatar}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {providerData.name}
                </h1>
                <div className="hidden items-center gap-3 mt-1">
                  <span className="text-muted-foreground">
                    {providerData.specialty}
                  </span>
                  <span className="flex items-center gap-1 text-amber-500">
                    <Star className="w-4 h-4 fill-current" />
                    {providerData.rating}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden md:flex flex-col items-end text-sm text-muted-foreground">
            {providerData.location && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {providerData.location}
              </div>
            )}
            {providerData.email && (
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                {providerData.email}
              </div>
            )}
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Revenue — click to drill into Practitioner Activity */}
          <div
            role="button"
            tabIndex={0}
            onClick={() =>
              navigate(`/providers/${type || "dentist"}/${id}/activity`)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                navigate(`/providers/${type || "dentist"}/${id}/activity`);
            }}
            title="View practitioner activity"
            className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Revenue
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRevenueFormula(true);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900 truncate">
                    {formatCurrency(providerData.kpis.revenue.current)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(kpiMtdStart, "MMM yyyy")}
                    {kpiMtdEnd.getMonth() !== kpiMtdStart.getMonth()
                      ? ` – ${format(kpiMtdEnd, "MMM yyyy")}`
                      : ""}
                  </p>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 shadow-md shadow-emerald-200 group-hover:scale-110 transition-transform duration-300">
                  <Banknote className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Patients */}
          <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Patients
                    </p>
                    <button
                      onClick={() => setShowPatientsFormula(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900">
                    {providerData.kpis.patients.current}
                  </p>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500 shadow-md shadow-blue-200 group-hover:scale-110 transition-transform duration-300">
                  <Users className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Avg/Patient */}
          <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-400 to-purple-600 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Avg / Patient
                    </p>
                    <button
                      onClick={() => setShowAvgPatientFormula(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900 truncate">
                    {formatCurrency(providerData.kpis.avgRevPerPatient.current)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    revenue per patient
                  </p>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500 shadow-md shadow-violet-200 group-hover:scale-110 transition-transform duration-300">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Utilisation */}
          <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 to-orange-500 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Utilisation
                    </p>
                    <button
                      onClick={() => setShowUtilisationFormula(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900">
                    {providerData.kpis.utilisation.current}%
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      value={providerData.kpis.utilisation.current}
                      max={100}
                      variant={
                        providerData.kpis.utilisation.current >= 90
                          ? "success"
                          : "warning"
                      }
                    />
                  </div>
                  {providerData.kpis.utilisation.udaCount != null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      UDA Goal: {providerData.kpis.utilisation.udaCount}
                    </p>
                  )}
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500 shadow-md shadow-amber-200 group-hover:scale-110 transition-transform duration-300">
                  <Activity className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* New Patients */}
          <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-400 to-cyan-500 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      New Patients
                    </p>
                    <button
                      onClick={() => setShowNewPatientsFormula(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900">
                    {providerData.kpis.newPatients.current}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    first visit this month
                  </p>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-500 shadow-md shadow-teal-200 group-hover:scale-110 transition-transform duration-300">
                  <UserPlus className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Recall Rate */}
          <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-400 to-pink-600 rounded-t-xl" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Recall Rate
                    </p>
                    <button
                      onClick={() => setShowRecallRateFormula(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="How is this calculated?"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900">
                    {providerData.kpis.recallRate.current}%
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      value={providerData.kpis.recallRate.current}
                      max={100}
                      variant={
                        providerData.kpis.recallRate.current >= 70
                          ? "success"
                          : "warning"
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    returning patients
                  </p>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-500 shadow-md shadow-rose-200 group-hover:scale-110 transition-transform duration-300">
                  <RefreshCw className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="edit-provider" className="space-y-6">
          <TabsList>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="edit-provider">Edit provider</TabsTrigger>
            <TabsTrigger value="contract-details">Contract details</TabsTrigger>
            <TabsTrigger value="schedule" className="hidden">
              Schedule
            </TabsTrigger>
            <TabsTrigger value="treatments" className="hidden">
              Treatment Mix
            </TabsTrigger>
            <TabsTrigger value="monthly-data">Monthly Data</TabsTrigger>
            <TabsTrigger value="profit-goals-data">
              Profit Goals Settings
            </TabsTrigger>
            <TabsTrigger value="payslip">Payslip</TabsTrigger>
            {/* Goals tab hidden — keep code, hide from UI */}
            <TabsTrigger value="goals" className="hidden">
              Goals
            </TabsTrigger>
          </TabsList>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            {/* Revenue Trend — live, outside Coming Soon */}
            {(() => {
              const avgDailyPlanned = latestPlannedProduction ?? 0;

              // Count Mon–Fri working days for a given year+month (0-based month)
              const workingDaysInMonth = (year: number, month: number) => {
                const days = new Date(year, month + 1, 0).getDate();
                let count = 0;
                for (let d = 1; d <= days; d++) {
                  const dow = new Date(year, month, d).getDay();
                  if (dow !== 0 && dow !== 6) count++;
                }
                return count;
              };

              const chartData = (revenueTrendData?.monthlyProduction ?? []).map(
                (mp) => {
                  // mp.month is "Jan-26", "Feb-26" etc. — parse to get year/month
                  const [mon, yr] = mp.month.split("-");
                  const monthIdx = [
                    "Jan",
                    "Feb",
                    "Mar",
                    "Apr",
                    "May",
                    "Jun",
                    "Jul",
                    "Aug",
                    "Sep",
                    "Oct",
                    "Nov",
                    "Dec",
                  ].indexOf(mon);
                  const year = 2000 + Number(yr);
                  const wdays =
                    monthIdx >= 0 ? workingDaysInMonth(year, monthIdx) : 22;
                  const target =
                    avgDailyPlanned > 0
                      ? Math.round(avgDailyPlanned * wdays * 100) / 100
                      : 0;
                  return { month: mp.month, actual: mp.amount, target };
                },
              );
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Revenue Trend chart */}
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-1.5">
                        <CardTitle>Revenue Trend (Actual vs Target)</CardTitle>
                        <button
                          onClick={() => setShowRevenueTrendFormula(true)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="How is this calculated?"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                        {isLoadingRevenueTrend && (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {isLoadingRevenueTrend ? (
                        <div className="h-64 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : chartData.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                          No production data for this period
                        </div>
                      ) : (
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--border))"
                              />
                              <XAxis
                                dataKey="month"
                                stroke="hsl(var(--muted-foreground))"
                                tick={{ fontSize: 12 }}
                              />
                              <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                tickFormatter={(v) =>
                                  `£${(v / 1000).toFixed(0)}k`
                                }
                              />
                              <RechartsTooltip
                                formatter={(value: number, name: string) => [
                                  formatCurrency(value),
                                  name === "actual" ? "Actual" : "Target",
                                ]}
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                }}
                              />
                              <Legend
                                formatter={(value) =>
                                  value === "actual" ? "Actual" : "Target"
                                }
                              />
                              <Bar
                                dataKey="actual"
                                name="actual"
                                fill="hsl(var(--chart-1))"
                                radius={[4, 4, 0, 0]}
                              />
                              {avgDailyPlanned > 0 && (
                                <Line
                                  type="monotone"
                                  dataKey="target"
                                  name="target"
                                  stroke="hsl(var(--chart-2))"
                                  strokeWidth={2}
                                  strokeDasharray="5 5"
                                  dot={false}
                                />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Recent Activity */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Recent Activity</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Latest completed treatments
                      </p>
                    </CardHeader>
                    <CardContent className="p-0">
                      {isLoadingRecentActivity ? (
                        <div className="h-64 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : recentActivity.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-sm text-muted-foreground px-6">
                          No recent activity found
                        </div>
                      ) : (
                        <div className="overflow-y-auto max-h-72">
                          {recentActivity.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between px-6 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm text-foreground truncate">
                                  {item.treatment}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {item.patient} · {item.date}
                                </div>
                              </div>
                              <div className="font-bold text-sm text-foreground ml-4 flex-shrink-0">
                                {formatCurrency(item.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Comparison Cards — live data */}
            {(() => {
              const actual = revenueTrendData?.totalProduction ?? 0;
              const prior = priorYearData?.totalProduction ?? 0;
              const monthCount = Math.max(
                1,
                (globalDateRange.endDate.getFullYear() -
                  globalDateRange.startDate.getFullYear()) *
                  12 +
                  (globalDateRange.endDate.getMonth() -
                    globalDateRange.startDate.getMonth()) +
                  1,
              );
              // Rank: use same get_production_metrics RPC as Overview ranking table
              const metricsRow = (productionMetricsData ?? []).find(
                (m) => m.provider_id === id,
              );
              const rank = metricsRow?.rank ?? null;
              const providerTypeLabel =
                provider?.provider_types?.name ?? "Provider";
              const sorted = productionMetricsData ?? [];

              // Period target = planned daily × actual days worked (matches Profit Goals Settings)
              const avgDailyPlanned = latestPlannedProduction ?? 0;
              const daysWorked = metricsRow?.days_worked ?? 0;
              const periodTarget =
                avgDailyPlanned > 0 && daysWorked > 0
                  ? Math.round(avgDailyPlanned * daysWorked * 100) / 100
                  : 0;
              const vsTarget = actual - periodTarget;
              const vsPrior = actual - prior;
              const priorPct =
                prior > 0 ? ((vsPrior / prior) * 100).toFixed(1) : null;
              const targetPct =
                periodTarget > 0
                  ? ((actual / periodTarget) * 100).toFixed(1)
                  : null;

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* vs Prior Year */}
                  <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-t-xl" />
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-1 mb-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                              vs Prior Year
                            </p>
                            <button
                              onClick={() => setShowVsPriorYearFormula(true)}
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="How is this calculated?"
                            >
                              <Info className="w-3 h-3" />
                            </button>
                          </div>
                          <p
                            className={`text-3xl font-extrabold truncate ${vsPrior >= 0 ? "text-gray-900" : "text-rose-500"}`}
                          >
                            {vsPrior >= 0 ? "+" : ""}
                            {formatCurrency(vsPrior)}
                          </p>
                          <p
                            className={`text-sm mt-1 ${vsPrior >= 0 ? "text-emerald-600" : "text-rose-500"}`}
                          >
                            {priorPct !== null
                              ? `${Number(priorPct) >= 0 ? "▲" : "▼"} ${Math.abs(Number(priorPct))}% vs same period last year`
                              : "No prior year data"}
                          </p>
                        </div>
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-500 shadow-md shadow-emerald-200 group-hover:scale-110 transition-transform duration-300">
                          <TrendingUp className="h-6 w-6 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* vs Target */}
                  <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-400 to-purple-600 rounded-t-xl" />
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-1 mb-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                              vs Target
                            </p>
                            <button
                              onClick={() => setShowVsTargetFormula(true)}
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="How is this calculated?"
                            >
                              <Info className="w-3 h-3" />
                            </button>
                          </div>
                          <p
                            className={`text-3xl font-extrabold truncate ${vsTarget >= 0 ? "text-gray-900" : "text-rose-500"}`}
                          >
                            {vsTarget >= 0 ? "+" : ""}
                            {formatCurrency(vsTarget)}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {targetPct !== null
                              ? `${targetPct}% of target (${formatCurrency(periodTarget)})`
                              : "No target set"}
                          </p>
                        </div>
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-violet-500 shadow-md shadow-violet-200 group-hover:scale-110 transition-transform duration-300">
                          <Target className="h-6 w-6 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Performance Rank */}
                  <div className="group relative overflow-hidden rounded-xl bg-white border border-border shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-400 to-pink-600 rounded-t-xl" />
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1 mb-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                              Performance Rank
                            </p>
                            <button
                              onClick={() =>
                                setShowPerformanceRankFormula(true)
                              }
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="How is this calculated?"
                            >
                              <Info className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-4xl font-extrabold text-gray-900">
                            {rank !== null ? `#${rank}` : "—"}
                          </p>
                        </div>
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-rose-500 shadow-md shadow-rose-200 group-hover:scale-110 transition-transform duration-300">
                          <Award className="h-6 w-6 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-6">
            <div className="relative">
              {/* Backdrop Overlay */}
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm z-0 rounded-lg" />
              {/* Coming Soon Label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="">
                  <h2 className="text-2xl font-bold text-foreground">
                    Coming Soon
                  </h2>
                </div>
              </div>
              {/* Content */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 opacity-30 pointer-events-none">
                <Card>
                  <CardHeader>
                    <CardTitle>Weekly Utilisation</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={providerData.weeklySchedule}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis
                            dataKey="day"
                            stroke="hsl(var(--muted-foreground))"
                          />
                          <YAxis stroke="hsl(var(--muted-foreground))" />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend />
                          <Bar
                            dataKey="slots"
                            name="Total Slots"
                            fill="hsl(var(--muted))"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="booked"
                            name="Booked"
                            fill="hsl(var(--chart-1))"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Daily Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {providerData.weeklySchedule.map((day: any) => (
                        <div key={day.day} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-foreground">
                              {day.day}
                            </span>
                            <span
                              className={`text-sm font-medium ${day.utilisation >= 90 ? "text-green-600" : day.utilisation >= 80 ? "text-amber-600" : "text-red-600"}`}
                            >
                              {day.utilisation.toFixed(1)}%
                            </span>
                          </div>
                          <ProgressBar
                            value={day.booked}
                            max={day.slots}
                            variant={
                              day.utilisation >= 90
                                ? "success"
                                : day.utilisation >= 80
                                  ? "warning"
                                  : "danger"
                            }
                          />
                          <div className="text-xs text-muted-foreground">
                            {day.booked} / {day.slots} slots booked
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Treatment Mix Tab */}
          <TabsContent value="treatments" className="space-y-6">
            {isLoadingTreatmentMix ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : treatmentMixData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                No completed treatment data found for this provider.
              </div>
            ) : (
              (() => {
                const CHART_COLORS = [
                  "#6366f1",
                  "#22c55e",
                  "#f59e0b",
                  "#ef4444",
                  "#06b6d4",
                  "#8b5cf6",
                  "#10b981",
                  "#f97316",
                  "#3b82f6",
                  "#ec4899",
                  "#84cc16",
                  "#14b8a6",
                  "#f43f5e",
                  "#a855f7",
                  "#0ea5e9",
                  "#eab308",
                  "#64748b",
                  "#d946ef",
                  "#2563eb",
                  "#16a34a",
                ];
                const totalRevenue = treatmentMixData.reduce(
                  (s, t) => s + t.revenue,
                  0,
                );
                const totalCount = treatmentMixData.reduce(
                  (s, t) => s + t.count,
                  0,
                );
                const maxRevenue = Math.max(
                  ...treatmentMixData.map((t) => t.revenue),
                );
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Donut chart — 2/5 width */}
                    <Card className="lg:col-span-2">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">
                              Treatment Distribution
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {treatmentMixData.length} categories ·{" "}
                              {totalCount} completed items
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                              <CalendarIcon className="w-3.5 h-3.5" />
                              <span>
                                {format(
                                  getTreatmentMixDateRange().startDate,
                                  "dd MMM yyyy",
                                )}{" "}
                                –{" "}
                                {format(
                                  getTreatmentMixDateRange().endDate,
                                  "dd MMM yyyy",
                                )}
                              </span>
                              {isLoadingTreatmentMix && (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              )}
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 -mt-1 -mr-1"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                >
                                  <circle cx="12" cy="5" r="1.5" />
                                  <circle cx="12" cy="12" r="1.5" />
                                  <circle cx="12" cy="19" r="1.5" />
                                </svg>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-[220px]"
                            >
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("this-month")
                                }
                              >
                                This Month
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("this-quarter")
                                }
                              >
                                This Quarter
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("this-year")
                                }
                              >
                                This Year
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("last-month")
                                }
                              >
                                Last Month
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("last-quarter")
                                }
                              >
                                Last Quarter
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setTreatmentMixFilter("last-year")
                                }
                              >
                                Last Year
                              </DropdownMenuItem>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <span className="flex-1">
                                    Custom Date Range
                                  </span>
                                  <CalendarIcon className="w-4 h-4" />
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="p-3 min-w-[300px]">
                                  <div className="flex flex-col gap-2">
                                    <Label className="text-sm text-muted-foreground">
                                      Select Date Range
                                    </Label>
                                    <ConfigProvider
                                      theme={{
                                        token: {
                                          colorPrimary: "hsl(244, 48%, 25%)",
                                        },
                                      }}
                                    >
                                      <DatePicker.RangePicker
                                        value={[
                                          treatmentMixCustomRange.from
                                            ? dayjs(
                                                treatmentMixCustomRange.from,
                                              )
                                            : null,
                                          treatmentMixCustomRange.to
                                            ? dayjs(treatmentMixCustomRange.to)
                                            : null,
                                        ]}
                                        onChange={(dates) => {
                                          if (dates && dates[0] && dates[1]) {
                                            setTreatmentMixCustomRange({
                                              from: dates[0].toDate(),
                                              to: dates[1].toDate(),
                                            });
                                            setTreatmentMixFilter("custom");
                                          }
                                        }}
                                        format="DD MMM YYYY"
                                        style={{ width: "100%" }}
                                      />
                                    </ConfigProvider>
                                  </div>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="relative h-72">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={treatmentMixData}
                                cx="50%"
                                cy="50%"
                                innerRadius={75}
                                outerRadius={110}
                                paddingAngle={1}
                                dataKey="value"
                              >
                                {treatmentMixData.map(
                                  (_: any, index: number) => (
                                    <Cell
                                      key={`cell-${index}`}
                                      fill={
                                        CHART_COLORS[
                                          index % CHART_COLORS.length
                                        ]
                                      }
                                    />
                                  ),
                                )}
                              </Pie>
                              <RechartsTooltip
                                formatter={(value: number, name: string) => [
                                  `${value}%`,
                                  name,
                                ]}
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          {/* Center label */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-xs text-muted-foreground">
                              Total Revenue
                            </span>
                            <span className="text-lg font-bold text-foreground">
                              {formatCurrency(totalRevenue)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Revenue list — 3/5 width, scrollable */}
                    <Card className="lg:col-span-3">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Revenue by Category
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Sorted by revenue · hover pie for details
                        </p>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-y-auto max-h-80 px-6 pb-4 space-y-2">
                          {treatmentMixData.map((treatment, idx) => (
                            <div
                              key={treatment.name}
                              className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0"
                            >
                              <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                                style={{
                                  backgroundColor:
                                    CHART_COLORS[idx % CHART_COLORS.length],
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {treatment.name}
                                  </span>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-xs text-muted-foreground">
                                      {treatment.count} items
                                    </span>
                                    <span className="text-sm font-bold text-foreground">
                                      {formatCurrency(treatment.revenue)}
                                    </span>
                                    <span className="text-xs text-muted-foreground w-8 text-right">
                                      {treatment.value}%
                                    </span>
                                  </div>
                                </div>
                                <div className="w-full bg-muted/40 rounded-full h-1.5">
                                  <div
                                    className="h-1.5 rounded-full transition-all"
                                    style={{
                                      width: `${maxRevenue > 0 ? (treatment.revenue / maxRevenue) * 100 : 0}%`,
                                      backgroundColor:
                                        CHART_COLORS[idx % CHART_COLORS.length],
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()
            )}
          </TabsContent>

          {/* Feedback Tab */}
          <TabsContent value="feedback" className="space-y-6">
            <div className="relative">
              {/* Backdrop Overlay */}
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm z-0 rounded-lg" />
              {/* Coming Soon Label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="">
                  <h2 className="text-2xl font-bold text-foreground">
                    Coming Soon
                  </h2>
                </div>
              </div>
              {/* Content */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 opacity-30 pointer-events-none">
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle>Overall Rating</CardTitle>
                  </CardHeader>
                  <CardContent className="text-center">
                    <div className="text-6xl font-bold text-foreground mb-2">
                      {providerData.patientFeedback.overall}
                    </div>
                    <div className="flex justify-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-6 h-6 ${star <= Math.round(providerData.patientFeedback.overall) ? "text-amber-500 fill-amber-500" : "text-muted"}`}
                        />
                      ))}
                    </div>
                    <div className="text-muted-foreground">
                      Based on {providerData.patientFeedback.reviews} reviews
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Rating Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground">
                            Communication
                          </span>
                          <span className="font-medium text-foreground">
                            {providerData.patientFeedback.communication}
                          </span>
                        </div>
                        <ProgressBar
                          value={providerData.patientFeedback.communication}
                          max={5}
                          variant="success"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground">
                            Punctuality
                          </span>
                          <span className="font-medium text-foreground">
                            {providerData.patientFeedback.punctuality}
                          </span>
                        </div>
                        <ProgressBar
                          value={providerData.patientFeedback.punctuality}
                          max={5}
                          variant="success"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground">
                            Care Quality
                          </span>
                          <span className="font-medium text-foreground">
                            {providerData.patientFeedback.careQuality}
                          </span>
                        </div>
                        <ProgressBar
                          value={providerData.patientFeedback.careQuality}
                          max={5}
                          variant="success"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Goals Tab */}
          <TabsContent value="goals" className="space-y-6">
            <div className="relative">
              {/* Backdrop Overlay */}
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm z-0 rounded-lg" />
              {/* Coming Soon Label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="">
                  <h2 className="text-2xl font-bold text-foreground">
                    Coming Soon
                  </h2>
                </div>
              </div>
              {/* Content */}
              <div className="opacity-30 pointer-events-none">
                <Card>
                  <CardHeader>
                    <CardTitle>Performance Goals</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {providerData.goals.map((goal: any, idx: number) => (
                        <div key={idx} className="p-4 bg-muted/30 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-foreground">
                              {goal.goal}
                            </span>
                            <Badge
                              variant={
                                goal.status === "Achieved"
                                  ? "default"
                                  : goal.status === "On Track"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {goal.status}
                            </Badge>
                          </div>
                          <ProgressBar
                            value={goal.progress}
                            max={100}
                            variant={
                              goal.progress >= 100
                                ? "success"
                                : goal.progress >= 70
                                  ? "default"
                                  : "warning"
                            }
                          />
                          <div className="text-xs text-muted-foreground mt-1">
                            {goal.progress}% complete
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Edit Provider Tab */}
          <TabsContent value="edit-provider" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-8">
                  {/* Basic Information */}
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-foreground">
                        Basic Information
                      </h3>
                      {/* Active Status Badge */}
                      {provider?.is_active && (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 font-medium px-3 py-1 flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Active
                        </Badge>
                      )}
                    </div>
                    {/* First Row: 4 fields */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="provider-code">
                          Provider Code <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="provider-code"
                            value={editFormData.providerCode}
                            onChange={(e) => {
                              setEditFormData({
                                ...editFormData,
                                providerCode: e.target.value,
                              });
                              if (validationErrors.providerCode) {
                                setValidationErrors({
                                  ...validationErrors,
                                  providerCode: "",
                                });
                              }
                            }}
                            className={`hover:border-sidebar focus-visible:ring-0 focus-visible:ring-offset-0 ${validationErrors.providerCode ? "border-red-500 pr-10" : ""}`}
                          />
                          {validationErrors.providerCode && (
                            <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                        {validationErrors.providerCode && (
                          <p className="text-sm text-red-500">
                            {validationErrors.providerCode}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="full-name">
                          Full Name <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="full-name"
                            value={editFormData.name}
                            onChange={(e) => {
                              setEditFormData({
                                ...editFormData,
                                name: e.target.value,
                              });
                              if (validationErrors.name) {
                                setValidationErrors({
                                  ...validationErrors,
                                  name: "",
                                });
                              }
                            }}
                            className={`hover:border-sidebar focus-visible:ring-0 focus-visible:ring-offset-0 ${validationErrors.name ? "border-red-500 pr-10" : ""}`}
                          />
                          {validationErrors.name && (
                            <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                        {validationErrors.name && (
                          <p className="text-sm text-red-500">
                            {validationErrors.name}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select
                          value={editFormData.role}
                          onValueChange={(value) =>
                            setEditFormData({ ...editFormData, role: value })
                          }
                        >
                          <SelectTrigger className="focus:ring-0 focus:ring-offset-0">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dentist">Dentist</SelectItem>
                            <SelectItem value="hygienist">Hygienist</SelectItem>
                            <SelectItem value="therapist">Therapist</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="primary-chair">
                          Primary Chair <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="primary-chair"
                            value={editFormData.primaryChair}
                            onChange={(e) => {
                              setEditFormData({
                                ...editFormData,
                                primaryChair: e.target.value,
                              });
                              if (validationErrors.primaryChair) {
                                setValidationErrors({
                                  ...validationErrors,
                                  primaryChair: "",
                                });
                              }
                            }}
                            className={`hover:border-sidebar focus-visible:ring-0 focus-visible:ring-offset-0 ${validationErrors.primaryChair ? "border-red-500 pr-10" : ""}`}
                          />
                          {validationErrors.primaryChair && (
                            <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                        {validationErrors.primaryChair && (
                          <p className="text-sm text-red-500">
                            {validationErrors.primaryChair}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Second Row: Email, Phone, Additional Options */}
                    {/* Additional Options (NHS/MOS treatment flags) only apply to
                        Dentist/Other -- Hygienists and Therapists don't hold NHS
                        contracts directly, so that column is dropped for them. */}
                    <div
                      className={`grid grid-cols-1 gap-4 ${type === "hygienist" || type === "therapist" ? "md:grid-cols-2" : "md:grid-cols-3"}`}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="email-address">Email Address</Label>
                        <div className="relative">
                          <Input
                            id="email-address"
                            type="email"
                            value={editFormData.email}
                            readOnly
                            className="hover:border-sidebar focus-visible:ring-0 focus-visible:ring-offset-0 bg-muted cursor-not-allowed text-muted-foreground"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Email cannot be changed.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone-number">
                          Phone Number <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="phone-number"
                            value={editFormData.phone}
                            onChange={(e) => {
                              setEditFormData({
                                ...editFormData,
                                phone: e.target.value,
                              });
                              if (validationErrors.phone) {
                                setValidationErrors({
                                  ...validationErrors,
                                  phone: "",
                                });
                              }
                            }}
                            className={`hover:border-sidebar focus-visible:ring-0 focus-visible:ring-offset-0 ${validationErrors.phone ? "border-red-500 pr-10" : ""}`}
                          />
                          {validationErrors.phone && (
                            <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                        {validationErrors.phone && (
                          <p className="text-sm text-red-500">
                            {validationErrors.phone}
                          </p>
                        )}
                      </div>
                      {type !== "hygienist" && type !== "therapist" && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">
                            Additional Options
                          </Label>
                          <div className="space-y-3 pt-1">
                            <div className="flex items-center justify-between gap-3">
                              <Label
                                htmlFor="performs-nhs"
                                className="font-normal cursor-pointer"
                              >
                                Does Perform NHS Treatments?
                              </Label>
                              <Switch
                                id="performs-nhs"
                                checked={editFormData.performsNhsTreatments}
                                onCheckedChange={(checked) =>
                                  setEditFormData({
                                    ...editFormData,
                                    performsNhsTreatments: checked,
                                  })
                                }
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <Label
                                htmlFor="performs-mos"
                                className="font-normal cursor-pointer"
                              >
                                Does Perform MOS Treatments?
                              </Label>
                              <Switch
                                id="performs-mos"
                                checked={editFormData.performsMosTreatments}
                                onCheckedChange={(checked) =>
                                  setEditFormData({
                                    ...editFormData,
                                    performsMosTreatments: checked,
                                  })
                                }
                              />
                            </div>
                            {type === "dentist" && (
                              <div className="flex items-center justify-between gap-3">
                                <Label
                                  htmlFor="is-principal-associate"
                                  className="font-normal cursor-pointer"
                                >
                                  Is Principal Associate?
                                </Label>
                                <Switch
                                  id="is-principal-associate"
                                  checked={editFormData.isPrincipalAssociate}
                                  onCheckedChange={(checked) =>
                                    setEditFormData({
                                      ...editFormData,
                                      isPrincipalAssociate: checked,
                                    })
                                  }
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Revenue Sources */}
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        Revenue Sources
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        To view Account list here, Select Platform Organization,
                        go to Settings → Platform Organizations → Select
                        organization and save.
                      </p>
                    </div>
                    <div className="space-y-4">
                      {/* Membership Income Section */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Membership Income
                        </Label>
                        {isLoadingCOA ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 h-10 border rounded-md px-3">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading accounts...
                          </div>
                        ) : chartOfAccounts.length > 0 ? (
                          <Popover
                            open={membershipOpen}
                            onOpenChange={setMembershipOpen}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={membershipOpen}
                                className="w-full justify-between font-normal hover:bg-white hover:text-foreground h-10"
                              >
                                {incomeTypes.membershipIncome ? (
                                  <span>
                                    {(() => {
                                      const account = chartOfAccounts.find(
                                        (acc) =>
                                          acc.native_id ===
                                          incomeTypes.membershipIncome,
                                      );
                                      return account
                                        ? `${account.account_code || ""} - ${account.account_name} - ${account.account_type}`
                                        : "Search accounts...";
                                    })()}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Search accounts...
                                  </span>
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-[400px] p-0"
                              align="start"
                            >
                              <Command
                                value={(() => {
                                  const a = chartOfAccounts.find(
                                    (acc) =>
                                      acc.native_id ===
                                      incomeTypes.membershipIncome,
                                  );
                                  return a
                                    ? `${a.account_code || ""} - ${a.account_name} - ${a.account_type}`
                                    : "";
                                })()}
                              >
                                <CommandInput placeholder="Search accounts..." />
                                <CommandList>
                                  <CommandEmpty>
                                    No accounts found.
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {chartOfAccounts.map((account) => {
                                      const isSelected =
                                        incomeTypes.membershipIncome ===
                                        account.native_id;
                                      const displayValue = `${account.account_code || ""} - ${account.account_name} - ${account.account_type}`;
                                      return (
                                        <CommandItem
                                          key={account.id}
                                          value={displayValue}
                                          onSelect={() => {
                                            setIncomeTypes({
                                              ...incomeTypes,
                                              membershipIncome: isSelected
                                                ? ""
                                                : account.native_id,
                                            });
                                            setMembershipOpen(false);
                                          }}
                                          className="aria-selected:bg-primary aria-selected:text-primary-foreground hover:bg-white hover:text-foreground"
                                        >
                                          <div className="flex items-center gap-2 w-full">
                                            <span className="font-mono text-xs">
                                              {account.account_code}
                                            </span>
                                            <span className="flex-1">
                                              {account.account_name}
                                            </span>
                                            <span className="text-xs opacity-70">
                                              {account.account_type}
                                            </span>
                                            {isSelected && (
                                              <Check className="w-4 h-4" />
                                            )}
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <Button
                            variant="outline"
                            disabled
                            className="w-full justify-between font-normal h-10 text-muted-foreground cursor-not-allowed"
                          >
                            <span>No accounts available</span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        )}
                      </div>

                      {/* NHS Income Section */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          NHS Income
                        </Label>
                        {isLoadingCOA ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 h-10 border rounded-md px-3">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading accounts...
                          </div>
                        ) : chartOfAccounts.length > 0 ? (
                          <Popover open={nhsOpen} onOpenChange={setNhsOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={nhsOpen}
                                className="w-full justify-between font-normal hover:bg-white hover:text-foreground h-10"
                              >
                                {incomeTypes.nhsIncome ? (
                                  <span>
                                    {(() => {
                                      const account = chartOfAccounts.find(
                                        (acc) =>
                                          acc.native_id ===
                                          incomeTypes.nhsIncome,
                                      );
                                      return account
                                        ? `${account.account_code || ""} - ${account.account_name} - ${account.account_type}`
                                        : "Search accounts...";
                                    })()}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Search accounts...
                                  </span>
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-[400px] p-0"
                              align="start"
                            >
                              <Command
                                value={(() => {
                                  const a = chartOfAccounts.find(
                                    (acc) =>
                                      acc.native_id === incomeTypes.nhsIncome,
                                  );
                                  return a
                                    ? `${a.account_code || ""} - ${a.account_name} - ${a.account_type}`
                                    : "";
                                })()}
                              >
                                <CommandInput placeholder="Search accounts..." />
                                <CommandList>
                                  <CommandEmpty>
                                    No accounts found.
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {chartOfAccounts.map((account) => {
                                      const isSelected =
                                        incomeTypes.nhsIncome ===
                                        account.native_id;
                                      const displayValue = `${account.account_code || ""} - ${account.account_name} - ${account.account_type}`;
                                      return (
                                        <CommandItem
                                          key={account.id}
                                          value={displayValue}
                                          onSelect={() => {
                                            setIncomeTypes({
                                              ...incomeTypes,
                                              nhsIncome: isSelected
                                                ? ""
                                                : account.native_id,
                                            });
                                            setNhsOpen(false);
                                          }}
                                          className="aria-selected:bg-primary aria-selected:text-primary-foreground hover:bg-white hover:text-foreground"
                                        >
                                          <div className="flex items-center gap-2 w-full">
                                            <span className="font-mono text-xs">
                                              {account.account_code}
                                            </span>
                                            <span className="flex-1">
                                              {account.account_name}
                                            </span>
                                            <span className="text-xs opacity-70">
                                              {account.account_type}
                                            </span>
                                            {isSelected && (
                                              <Check className="w-4 h-4" />
                                            )}
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <Button
                            variant="outline"
                            disabled
                            className="w-full justify-between font-normal h-10 text-muted-foreground cursor-not-allowed"
                          >
                            <span>No accounts available</span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Employment Information */}
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      Employment Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="joining-date">
                          Joining Date <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Popover
                            open={joiningDateOpen}
                            onOpenChange={setJoiningDateOpen}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={`w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground ${validationErrors.joiningDate ? "border-red-500" : ""}`}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {editFormData.joiningDate ? (
                                  format(editFormData.joiningDate, "dd-MM-yyyy")
                                ) : (
                                  <span>dd-mm-yyyy</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-0"
                              align="start"
                            >
                              <Calendar
                                mode="single"
                                selected={editFormData.joiningDate || undefined}
                                onSelect={(date) => {
                                  setEditFormData({
                                    ...editFormData,
                                    joiningDate: date || null,
                                  });
                                  setJoiningDateOpen(false);
                                  if (validationErrors.joiningDate) {
                                    setValidationErrors({
                                      ...validationErrors,
                                      joiningDate: "",
                                    });
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          {validationErrors.joiningDate && (
                            <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                        {validationErrors.joiningDate && (
                          <p className="text-sm text-red-500">
                            {validationErrors.joiningDate}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="leaving-date">Leaving Date</Label>
                        <Popover
                          open={leavingDateOpen}
                          onOpenChange={setLeavingDateOpen}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {editFormData.leavingDate ? (
                                format(editFormData.leavingDate, "dd-MM-yyyy")
                              ) : (
                                <span>dd-mm-yyyy</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={editFormData.leavingDate || undefined}
                              onSelect={(date) => {
                                setEditFormData({
                                  ...editFormData,
                                  leavingDate: date || null,
                                });
                                setLeavingDateOpen(false);
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>

                  {/* Working Days */}
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      Working Days
                    </h3>
                    <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
                      {WORKING_DAYS.map((day) => {
                        const schedule =
                          editFormData.workingDays[day.key] ??
                          DEFAULT_WORKING_DAYS[day.key];
                        const updateDay = (
                          patch: Partial<WorkingDaySchedule>,
                        ) => {
                          setEditFormData({
                            ...editFormData,
                            workingDays: {
                              ...editFormData.workingDays,
                              [day.key]: { ...schedule, ...patch },
                            },
                          });
                        };
                        return (
                          <div key={day.key} className="space-y-2 p-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <Label className="font-medium w-24 shrink-0">
                                {day.label}
                              </Label>
                              <div className="w-44">
                                <Select
                                  value={schedule.type}
                                  onValueChange={(
                                    value: WorkingDayScheduleType,
                                  ) => {
                                    const preset = (
                                      WORKING_DAY_PRESET_TIMES as any
                                    )[value];
                                    if (value === "custom") {
                                      updateDay({
                                        type: value,
                                        startTime:
                                          schedule.startTime || "09:00",
                                        endTime: schedule.endTime || "17:00",
                                      });
                                    } else if (preset) {
                                      updateDay({
                                        type: value,
                                        startTime: preset.start,
                                        endTime: preset.end,
                                      });
                                    } else {
                                      updateDay({
                                        type: value,
                                        startTime: null,
                                        endTime: null,
                                      });
                                    }
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="off">Off</SelectItem>
                                    <SelectItem value="full-day">
                                      Full Day
                                    </SelectItem>
                                    <SelectItem value="morning-half">
                                      Morning Half Day
                                    </SelectItem>
                                    <SelectItem value="afternoon-half">
                                      Afternoon Half Day
                                    </SelectItem>
                                    <SelectItem value="custom">
                                      Custom
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {schedule.type === "off" && (
                                <span className="text-sm text-muted-foreground">
                                  Not working
                                </span>
                              )}
                              {schedule.type === "custom" && (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="time"
                                    value={schedule.startTime ?? ""}
                                    onChange={(e) =>
                                      updateDay({ startTime: e.target.value })
                                    }
                                    className="w-32"
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    to
                                  </span>
                                  <Input
                                    type="time"
                                    value={schedule.endTime ?? ""}
                                    onChange={(e) =>
                                      updateDay({ endTime: e.target.value })
                                    }
                                    className="w-32"
                                  />
                                </div>
                              )}
                            </div>
                            {type !== "therapist" &&
                              type !== "hygienist" &&
                              schedule.type !== "off" && (
                                <div className="sm:pl-[112px]">
                                  <Label className="text-xs text-muted-foreground mb-1 block">
                                    Treatments Performed
                                  </Label>
                                  <AccountMultiSelect
                                    options={treatmentOptions}
                                    value={schedule.treatmentIds}
                                    onChange={(value) =>
                                      updateDay({ treatmentIds: value })
                                    }
                                    placeholder="Select treatments..."
                                    showSelected
                                  />
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                    {(type === "therapist" || type === "hygienist") && (
                      <div className="rounded-md border border-border/50 p-3">
                        <Label className="text-xs text-muted-foreground mb-1 block">
                          Treatments Performed
                        </Label>
                        <AccountMultiSelect
                          options={treatmentOptions}
                          value={
                            WORKING_DAYS.map(
                              (day) =>
                                editFormData.workingDays[day.key]
                                  ?.treatmentIds ?? [],
                            ).find((ids) => ids.length > 0) ?? []
                          }
                          onChange={(value) =>
                            setEditFormData({
                              ...editFormData,
                              workingDays: WORKING_DAYS.reduce((acc, day) => {
                                const schedule =
                                  editFormData.workingDays[day.key] ??
                                  DEFAULT_WORKING_DAYS[day.key];
                                acc[day.key] = {
                                  ...schedule,
                                  treatmentIds: value,
                                };
                                return acc;
                              }, {} as ProviderWorkingDays),
                            })
                          }
                          placeholder="Select treatments..."
                          showSelected
                        />
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Info className="w-4 h-4" />
                      <span>Required fields are marked with *</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigate(`/providers/${type || "dentist"}`)
                        }
                        className="gap-2 bg-gray-100 hover:bg-sidebar hover:text-sidebar-foreground text-gray-700 border-gray-300"
                      >
                        <X className="w-4 h-4" />
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          // Validate mandatory fields
                          if (!provider) {
                            toast.error("Validation error", {
                              description: "Unable to update provider",
                            });
                            return;
                          }

                          // Reset validation errors
                          const errors = {
                            providerCode: "",
                            name: "",
                            email: "",
                            phone: "",
                            primaryChair: "",
                            joiningDate: "",
                          };

                          let hasError = false;

                          if (!editFormData.providerCode.trim()) {
                            errors.providerCode = "Provider code is required";
                            hasError = true;
                          }

                          if (!editFormData.name.trim()) {
                            errors.name = "Full Name is required";
                            hasError = true;
                          }

                          if (!editFormData.email?.trim()) {
                            errors.email = "Email Value is required";
                            hasError = true;
                          }

                          if (!editFormData.phone?.trim()) {
                            errors.phone = "Phone number is required";
                            hasError = true;
                          }

                          if (!editFormData.primaryChair?.trim()) {
                            errors.primaryChair = "Primary Chair is required";
                            hasError = true;
                          }

                          if (!editFormData.joiningDate) {
                            errors.joiningDate = "Joining Date is required";
                            hasError = true;
                          }

                          setValidationErrors(errors);

                          if (hasError) {
                            return;
                          }
                          const roleToSave =
                            editFormData.role === "other"
                              ? editFormData.originalRole
                              : editFormData.role
                                ? editFormData.role.charAt(0).toUpperCase() +
                                  editFormData.role.slice(1)
                                : null;

                          updateProvider({
                            id: provider.id,
                            updates: {
                              provider_code: editFormData.providerCode,
                              name: editFormData.name,
                              email: editFormData.email || null,
                              phone: editFormData.phone || null,
                              provider_type_id: editFormData.provider_type_id,
                              specialty_id: editFormData.specialty_id,
                              location_id: editFormData.location_id,
                              provider_role: roleToSave,
                              primary_chair: editFormData.primaryChair || null,
                              additional_options:
                                encodeProviderAdditionalOptions(
                                  editFormData.performsNhsTreatments,
                                  editFormData.performsMosTreatments,
                                ),
                              is_principal_associate:
                                type === "dentist"
                                  ? editFormData.isPrincipalAssociate
                                  : false,
                              joining_date: editFormData.joiningDate
                                ? editFormData.joiningDate.toISOString()
                                : null,
                              leaving_date: editFormData.leavingDate
                                ? editFormData.leavingDate.toISOString()
                                : null,
                              membership_income: incomeTypes.membershipIncome,
                              nhs_income: incomeTypes.nhsIncome,
                              working_days: editFormData.workingDays,
                            },
                          });
                        }}
                        disabled={isUpdating}
                        className="gap-2  text-white"
                      >
                        {isUpdating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            Update Provider
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contract Details Tab */}
          <TabsContent value="contract-details" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4 rounded-md border border-border p-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    Contract Period
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contract-start-date">
                        Contract Start Date
                      </Label>
                      <Popover
                        open={contractStartDateOpen}
                        onOpenChange={setContractStartDateOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            id="contract-start-date"
                            variant="outline"
                            className="w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {editFormData.contractStartDate ? (
                              format(
                                editFormData.contractStartDate,
                                "dd-MM-yyyy",
                              )
                            ) : (
                              <span>dd-mm-yyyy</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={
                              editFormData.contractStartDate || undefined
                            }
                            onSelect={(date) => {
                              setEditFormData({
                                ...editFormData,
                                contractStartDate: date || null,
                              });
                              setContractStartDateOpen(false);
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contract-end-date">
                        Contract End Date
                      </Label>
                      <Popover
                        open={contractEndDateOpen}
                        onOpenChange={setContractEndDateOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            id="contract-end-date"
                            variant="outline"
                            className="w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {editFormData.contractEndDate ? (
                              format(editFormData.contractEndDate, "dd-MM-yyyy")
                            ) : (
                              <span>dd-mm-yyyy</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editFormData.contractEndDate || undefined}
                            onSelect={(date) => {
                              setEditFormData({
                                ...editFormData,
                                contractEndDate: date || null,
                              });
                              setContractEndDateOpen(false);
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="space-y-8">
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      {getSplitConfigLabel(type || "dentist")} Split
                      Configuration
                    </h3>
                    <div className="space-y-4">
                      <div
                        className={
                          editFormData.splitSourceMethod === "sliding-scale"
                            ? "grid grid-cols-1 md:grid-cols-1 gap-4"
                            : "grid grid-cols-1 md:grid-cols-2 gap-4"
                        }
                      >
                        <div className="space-y-2">
                          <Label htmlFor="contract-split-source-method">
                            Split Source Method
                          </Label>
                          <div className="flex items-center gap-2">
                            <Select
                              value={editFormData.splitSourceMethod}
                              onValueChange={(value) =>
                                setEditFormData({
                                  ...editFormData,
                                  splitSourceMethod: value,
                                })
                              }
                            >
                              <SelectTrigger className="focus:ring-0 focus:ring-offset-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="flat-percentage">
                                  Flat Percentage
                                </SelectItem>
                                <SelectItem value="sliding-scale">
                                  Sliding Scale
                                </SelectItem>
                                <SelectItem value="per-case">
                                  Per Case
                                </SelectItem>
                                <SelectItem value="per-hour">
                                  Per Hour
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {editFormData.splitSourceMethod ===
                              "sliding-scale" && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                title="Manage Sliding Scale Bands"
                                onClick={() =>
                                  setOpenSlidingScaleFor("associate")
                                }
                              >
                                <SlidersHorizontal className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {editFormData.splitSourceMethod ===
                          "flat-percentage" && (
                          <div className="space-y-2">
                            <Label htmlFor="contract-associate-split-percentage">
                              Split Percentage
                            </Label>
                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                              <Input
                                id="contract-associate-split-percentage"
                                type="number"
                                value={editFormData.associateSplitPercentage}
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    associateSplitPercentage: Number(
                                      e.target.value,
                                    ),
                                  })
                                }
                                placeholder="50"
                                className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                              />
                              <span className="px-3 text-sm text-muted-foreground">
                                %
                              </span>
                            </div>
                          </div>
                        )}
                        {editFormData.splitSourceMethod === "per-case" && (
                          <div className="space-y-2">
                            <Label htmlFor="contract-per-case-rate">
                              Rate Per Case
                            </Label>
                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                              <span className="px-3 text-sm text-muted-foreground">
                                £
                              </span>
                              <Input
                                id="contract-per-case-rate"
                                type="number"
                                value={editFormData.perCaseRate}
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    perCaseRate: Number(e.target.value),
                                  })
                                }
                                placeholder="0"
                                className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                              />
                            </div>
                          </div>
                        )}
                        {editFormData.splitSourceMethod === "per-hour" && (
                          <div className="space-y-2">
                            <Label>Employment Type</Label>
                            <RadioGroup
                              className="flex h-10 items-center gap-6 rounded-md border border-input bg-background px-3"
                              value={editFormData.employmentType}
                              onValueChange={(value) =>
                                setEditFormData({
                                  ...editFormData,
                                  employmentType:
                                    value as ProviderEmploymentType,
                                })
                              }
                            >
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="employee"
                                  id="contract-employment-type-employee"
                                />
                                <Label
                                  htmlFor="contract-employment-type-employee"
                                  className="font-normal cursor-pointer"
                                >
                                  Employee
                                </Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="self-employed"
                                  id="contract-employment-type-self-employed"
                                />
                                <Label
                                  htmlFor="contract-employment-type-self-employed"
                                  className="font-normal cursor-pointer"
                                >
                                  Self Employed
                                </Label>
                              </div>
                            </RadioGroup>
                          </div>
                        )}
                        {editFormData.splitSourceMethod === "per-hour" && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Label htmlFor="contract-per-hour-rate">
                                Rate Per Hour (Excluding NI)
                              </Label>
                              {editFormData.employmentType === "employee" && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-[220px] text-xs">
                                        Employment Type is Employee, so a{" "}
                                        {PER_HOUR_EMPLOYEE_UPLIFT_PERCENT}%
                                        uplift is automatically added to this
                                        rate when calculating payslips.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                              <span className="px-3 text-sm text-muted-foreground">
                                £
                              </span>
                              <Input
                                id="contract-per-hour-rate"
                                type="number"
                                value={editFormData.perHourRate}
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    perHourRate: Number(e.target.value),
                                  })
                                }
                                placeholder="0"
                                className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                              />
                            </div>
                          </div>
                        )}
                        {editFormData.splitSourceMethod === "per-hour" &&
                          editFormData.employmentType === "employee" && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5">
                                <Label htmlFor="contract-effective-rate">
                                  Effective Rate Per Hour
                                </Label>
                              </div>
                              <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50">
                                <span className="px-3 text-sm text-muted-foreground">
                                  £
                                </span>
                                <Input
                                  id="contract-effective-rate"
                                  type="text"
                                  value={getEffectivePerHourRate(
                                    editFormData.perHourRate,
                                    editFormData.employmentType,
                                  ).toFixed(2)}
                                  disabled
                                  className="h-full border-0 bg-transparent disabled:opacity-100 disabled:cursor-default"
                                />
                              </div>
                            </div>
                          )}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Label htmlFor="contract-lab-split-percentage">
                              Lab Split Percentage
                            </Label>
                          </div>
                          <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                            <Input
                              id="contract-lab-split-percentage"
                              type="number"
                              value={editFormData.labSplitPercentage}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  labSplitPercentage: Number(e.target.value),
                                })
                              }
                              placeholder="50"
                              className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                            <span className="px-3 text-sm text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Label htmlFor="contract-material-split-percentage">
                              Material Split Percentage
                            </Label>
                          </div>
                          <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                            <Input
                              id="contract-material-split-percentage"
                              type="number"
                              value={materialSplitPercentage}
                              onChange={(e) =>
                                setMaterialSplitPercentage(
                                  Number(e.target.value),
                                )
                              }
                              placeholder="50"
                              className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                            <span className="px-3 text-sm text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {profitGoalsMetrics.associateCostLabSource === "associate_wise" && (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      Lab Cost Configuration
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      This location sources lab cost per-provider. Configure how
                      this provider's lab cost is calculated.
                    </p>
                    <div
                      className={
                        labCostConfig.sourceMethod === "sliding_scale" ||
                        labCostConfig.sourceMethod === "monthly"
                          ? "grid grid-cols-1 gap-4"
                          : "grid grid-cols-1 md:grid-cols-2 gap-4"
                      }
                    >
                      <div className="space-y-2">
                        <Label htmlFor="lab-cost-source-method">
                          Lab Cost Source Method
                        </Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={labCostConfig.sourceMethod}
                            onValueChange={(value) =>
                              setLabCostConfig({
                                ...labCostConfig,
                                sourceMethod: value as ProviderCostSourceMethod,
                              })
                            }
                          >
                            <SelectTrigger id="lab-cost-source-method">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="flat_percentage">
                                Flat Percentage
                              </SelectItem>
                              <SelectItem value="accounting_application">
                                Accounting Application
                              </SelectItem>
                              <SelectItem value="sliding_scale">
                                Sliding Scale
                              </SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                            </SelectContent>
                          </Select>
                          {labCostConfig.sourceMethod === "sliding_scale" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="shrink-0"
                              title="Manage Sliding Scale Bands"
                              onClick={() => setOpenSlidingScaleFor("labCost")}
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </Button>
                          )}
                          {labCostConfig.sourceMethod === "monthly" && (
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              onClick={() =>
                                openMonthlyCostDialog(
                                  "lab_cost_value",
                                  setLabMonthlyRows,
                                  setShowLabMonthlyDialog,
                                )
                              }
                            >
                              Edit Monthly Values
                            </Button>
                          )}
                        </div>
                      </div>
                      {labCostConfig.sourceMethod === "flat_percentage" && (
                        <div className="space-y-2">
                          <Label htmlFor="lab-cost-percentage">
                            Lab Cost Percentage
                          </Label>
                          <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                            <Input
                              id="lab-cost-percentage"
                              type="number"
                              step="0.01"
                              value={labCostConfig.percentage}
                              onChange={(e) =>
                                setLabCostConfig({
                                  ...labCostConfig,
                                  percentage: Number(e.target.value),
                                })
                              }
                              placeholder="0"
                              className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                            <span className="px-3 text-sm text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                      )}
                      {labCostConfig.sourceMethod ===
                        "accounting_application" && (
                        <div className="space-y-2">
                          <Label htmlFor="lab-cost-account">
                            Associated Account
                          </Label>
                          <Select
                            value={labCostConfig.accountId}
                            onValueChange={(value) => {
                              const account = locationAccountOptions.find(
                                (a) => a.id === value,
                              );
                              setLabCostConfig({
                                ...labCostConfig,
                                accountId: value,
                                accountPlatform: account?.platform || "",
                              });
                            }}
                          >
                            <SelectTrigger id="lab-cost-account">
                              <SelectValue placeholder="Select account" />
                            </SelectTrigger>
                            <SelectContent>
                              {locationAccountOptions.length === 0 ? (
                                <div className="px-2 py-2 text-sm text-muted-foreground">
                                  No accounts available for this location
                                </div>
                              ) : (
                                locationAccountOptions.map((account) => (
                                  <SelectItem
                                    key={account.id}
                                    value={account.id}
                                  >
                                    {account.account_code} -{" "}
                                    {account.account_name}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {profitGoalsMetrics.materialCostSource === "associate_wise" && (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4 rounded-md border border-border p-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      Material Cost Configuration
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      This location sources material cost per-provider.
                      Configure how this provider's material cost is calculated.
                    </p>
                    <div
                      className={
                        materialCostConfig.sourceMethod === "sliding_scale" ||
                        materialCostConfig.sourceMethod === "monthly"
                          ? "grid grid-cols-1 gap-4"
                          : "grid grid-cols-1 md:grid-cols-2 gap-4"
                      }
                    >
                      <div className="space-y-2">
                        <Label htmlFor="material-cost-source-method">
                          Material Cost Source Method
                        </Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={materialCostConfig.sourceMethod}
                            onValueChange={(value) =>
                              setMaterialCostConfig({
                                ...materialCostConfig,
                                sourceMethod: value as ProviderCostSourceMethod,
                              })
                            }
                          >
                            <SelectTrigger id="material-cost-source-method">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="flat_percentage">
                                Flat Percentage
                              </SelectItem>
                              <SelectItem value="accounting_application">
                                Accounting Application
                              </SelectItem>
                              <SelectItem value="sliding_scale">
                                Sliding Scale
                              </SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                            </SelectContent>
                          </Select>
                          {materialCostConfig.sourceMethod ===
                            "sliding_scale" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="shrink-0"
                              title="Manage Sliding Scale Bands"
                              onClick={() =>
                                setOpenSlidingScaleFor("materialCost")
                              }
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </Button>
                          )}
                          {materialCostConfig.sourceMethod === "monthly" && (
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              onClick={() =>
                                openMonthlyCostDialog(
                                  "material_cost_value",
                                  setMaterialMonthlyRows,
                                  setShowMaterialMonthlyDialog,
                                )
                              }
                            >
                              Edit Monthly Values
                            </Button>
                          )}
                        </div>
                      </div>
                      {materialCostConfig.sourceMethod ===
                        "flat_percentage" && (
                        <div className="space-y-2">
                          <Label htmlFor="material-cost-percentage">
                            Material Cost Percentage
                          </Label>
                          <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                            <Input
                              id="material-cost-percentage"
                              type="number"
                              step="0.01"
                              value={materialCostConfig.percentage}
                              onChange={(e) =>
                                setMaterialCostConfig({
                                  ...materialCostConfig,
                                  percentage: Number(e.target.value),
                                })
                              }
                              placeholder="0"
                              className="h-full border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                            <span className="px-3 text-sm text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                      )}
                      {materialCostConfig.sourceMethod ===
                        "accounting_application" && (
                        <div className="space-y-2">
                          <Label htmlFor="material-cost-account">
                            Associated Account
                          </Label>
                          <Select
                            value={materialCostConfig.accountId}
                            onValueChange={(value) => {
                              const account = locationAccountOptions.find(
                                (a) => a.id === value,
                              );
                              setMaterialCostConfig({
                                ...materialCostConfig,
                                accountId: value,
                                accountPlatform: account?.platform || "",
                              });
                            }}
                          >
                            <SelectTrigger id="material-cost-account">
                              <SelectValue placeholder="Select account" />
                            </SelectTrigger>
                            <SelectContent>
                              {locationAccountOptions.length === 0 ? (
                                <div className="px-2 py-2 text-sm text-muted-foreground">
                                  No accounts available for this location
                                </div>
                              ) : (
                                locationAccountOptions.map((account) => (
                                  <SelectItem
                                    key={account.id}
                                    value={account.id}
                                  >
                                    {account.account_code} -{" "}
                                    {account.account_name}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <ContractAttachmentsCard providerId={provider?.id} />

            <ContractHistoryCard providerId={provider?.id} />

            {/* Footer */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="w-4 h-4" />
                <span>Configure how this provider's pay is calculated.</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/providers/${type || "dentist"}`)}
                  className="gap-2 bg-gray-100 hover:bg-sidebar hover:text-sidebar-foreground text-gray-700 border-gray-300"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestNewContract}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add New Contract
                </Button>
                <Button
                  onClick={requestUpdateContract}
                  disabled={
                    isUpdating || isStartingNewContract || isSyncingCurrentContract
                  }
                  className="gap-2 text-white"
                >
                  {isUpdating || isStartingNewContract || isSyncingCurrentContract ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Update Contract
                    </>
                  )}
                </Button>
              </div>
            </div>

            <AlertDialog
              open={contractConfirmOpen}
              onOpenChange={setContractConfirmOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {contractConfirmAction === "new"
                      ? "Add New Contract?"
                      : "Update Contract?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {contractConfirmAction === "new"
                      ? `This will end the current contract the day before ${
                          editFormData.contractStartDate
                            ? format(
                                editFormData.contractStartDate,
                                "dd-MM-yyyy",
                              )
                            : "the new start date"
                        }, and start a new contract from then using the values on this tab. Both periods will be logged to Contract History.`
                      : "This will update this provider's contract details with the values on this tab."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      performContractSave(contractConfirmAction === "new")
                    }
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <SpecialTreatmentsCard
              providerId={provider?.id}
              treatmentOptions={treatmentOptions}
            />
          </TabsContent>

          {/* Monthly Data Tab */}
          <TabsContent value="monthly-data" className="space-y-6">
            <div className="space-y-8">
              {/* Net Production Section */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-foreground">
                        Net Production
                      </h3>
                      <div className="flex items-center gap-4">
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
                              netProductionDateRange.from
                                ? dayjs(netProductionDateRange.from)
                                : null,
                              netProductionDateRange.to
                                ? dayjs(netProductionDateRange.to)
                                : null,
                            ]}
                            onChange={(dates) => {
                              if (dates && dates[0] && dates[1]) {
                                setNetProductionDateRange({
                                  from: dates[0].toDate(),
                                  to: dates[1].toDate(),
                                });
                              } else {
                                setNetProductionDateRange({
                                  from: null,
                                  to: null,
                                });
                              }
                            }}
                            format="DD-MM-YYYY"
                            placeholder={["Start date", "End date"]}
                            style={{ width: 300 }}
                          />
                        </ConfigProvider>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      {isLoadingNetProduction ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : netProductionApiData &&
                        netProductionApiData.monthlyProduction &&
                        netProductionApiData.monthlyProduction.length > 0 ? (
                        <TooltipProvider>
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-sidebar text-white">
                                <th className="text-left p-3 font-semibold text-sm">
                                  Name
                                </th>
                                {netProductionApiData.monthlyProduction.map(
                                  (mp) => (
                                    <th
                                      key={mp.month}
                                      className="text-right p-3 font-semibold text-sm"
                                    >
                                      {mp.month}
                                    </th>
                                  ),
                                )}
                                <th className="text-right p-3 font-semibold text-sm">
                                  Total
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-border hover:bg-muted/50">
                                <td className="p-3 font-medium">
                                  {netProductionApiData.providerName}
                                </td>
                                {netProductionApiData.monthlyProduction.map(
                                  (mp) => (
                                    <td
                                      key={mp.month}
                                      className="p-3 text-right"
                                    >
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span>
                                            {formatCurrency(mp.amount)}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                        >
                                          <TooltipArrow className="fill-white" />
                                          <div className="space-y-2.5">
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                Private
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.private)}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                Membership
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.membership)}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                NHS
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.nhs)}
                                              </span>
                                            </div>
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </td>
                                  ),
                                )}
                                <td className="p-3 text-right font-semibold">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        {formatCurrency(
                                          netProductionApiData.totalProduction,
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                    >
                                      <TooltipArrow className="fill-white" />
                                      <div className="space-y-2.5">
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            Private
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalPrivate,
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            Membership
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalMembership,
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            NHS
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalNhs,
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                              </tr>
                              <tr className="border-t-2 border-border bg-muted/30">
                                <td className="p-3 font-semibold">Total</td>
                                {netProductionApiData.monthlyProduction.map(
                                  (mp) => (
                                    <td
                                      key={mp.month}
                                      className="p-3 text-right font-semibold"
                                    >
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span>
                                            {formatCurrency(mp.amount)}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                        >
                                          <TooltipArrow className="fill-white" />
                                          <div className="space-y-2.5">
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                Private
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.private)}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                Membership
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.membership)}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-6 items-center">
                                              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                                NHS
                                              </span>
                                              <span className="text-sm font-bold text-slate-900">
                                                {formatCurrency(mp.nhs)}
                                              </span>
                                            </div>
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </td>
                                  ),
                                )}
                                <td className="p-3 text-right font-semibold">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        {formatCurrency(
                                          netProductionApiData.totalProduction,
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-xl p-4 rounded-lg"
                                    >
                                      <TooltipArrow className="fill-white" />
                                      <div className="space-y-2.5">
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            Private
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalPrivate,
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            Membership
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalMembership,
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6 items-center">
                                          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                                            NHS
                                          </span>
                                          <span className="text-sm font-bold text-slate-900">
                                            {formatCurrency(
                                              netProductionApiData.totalNhs,
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </TooltipProvider>
                      ) : !isLoadingNetProduction &&
                        netProductionDateRange.from &&
                        netProductionDateRange.to ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No net production data available for the selected date
                          range.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Working Hours Section */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-foreground">
                        Working Hours
                      </h3>
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
                    </div>
                    <div className="overflow-x-auto">
                      {isLoadingWorkingHours ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : workingHoursSummaryData &&
                        workingHoursSummaryData.monthlyHours.length > 0 ? (
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-sidebar text-white">
                              <th className="text-left p-3 font-semibold text-sm">
                                Name
                              </th>
                              {workingHoursSummaryData.monthlyHours.map(
                                (mh: any) => (
                                  <th
                                    key={mh.month}
                                    className="text-right p-3 font-semibold text-sm"
                                  >
                                    {mh.month}
                                  </th>
                                ),
                              )}
                              <th className="text-right p-3 font-semibold text-sm">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-border hover:bg-muted/50">
                              <td className="p-3 font-medium">
                                {provider?.name ?? ""}
                              </td>
                              {workingHoursSummaryData.monthlyHours.map(
                                (mh: any) => (
                                  <td
                                    key={mh.month}
                                    className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                    onClick={() => openEditDialog(mh.month)}
                                  >
                                    {mh.hours}
                                  </td>
                                ),
                              )}
                              <td className="p-3 text-right font-semibold">
                                {workingHoursSummaryData.totalHours}
                              </td>
                            </tr>
                            <tr className="border-t-2 border-border bg-muted/30">
                              <td className="p-3 font-semibold">Total</td>
                              {workingHoursSummaryData.monthlyHours.map(
                                (mh: any) => (
                                  <td
                                    key={mh.month}
                                    className="p-3 text-right font-semibold"
                                  >
                                    {mh.hours}
                                  </td>
                                ),
                              )}
                              <td className="p-3 text-right font-semibold">
                                {workingHoursSummaryData.totalHours}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : !isLoadingWorkingHours &&
                        netProductionDateRange.from &&
                        netProductionDateRange.to ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No working hours data available for the selected date
                          range.
                        </div>
                      ) : null}
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
                        NHS Count
                      </h3>
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
                    </div>
                    <div className="overflow-x-auto">
                      {isLoadingAllNhsCounts ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : nhsCountSummary &&
                        nhsCountSummary.monthlyCounts.length > 0 ? (
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-sidebar text-white">
                              <th className="text-left p-3 font-semibold text-sm">
                                Name
                              </th>
                              {nhsCountSummary.monthlyCounts.map((mc) => (
                                <th
                                  key={mc.month}
                                  className="text-right p-3 font-semibold text-sm"
                                >
                                  {mc.month}
                                </th>
                              ))}
                              <th className="text-right p-3 font-semibold text-sm">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-border hover:bg-muted/50">
                              <td className="p-3 font-medium">
                                {provider?.name ?? ""}
                              </td>
                              {nhsCountSummary.monthlyCounts.map((mc) => (
                                <td
                                  key={mc.month}
                                  className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                  onClick={() =>
                                    openCountEditDialog(
                                      mc.month,
                                      "uda_count",
                                      setNhsCountRows,
                                      setIsLoadingNhsCountDialog,
                                      setShowNhsCountDialog,
                                    )
                                  }
                                >
                                  {mc.count > 0 ? mc.count.toString() : "-"}
                                </td>
                              ))}
                              <td className="p-3 text-right font-semibold">
                                {nhsCountSummary.totalCount > 0
                                  ? nhsCountSummary.totalCount.toString()
                                  : "-"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : !isLoadingAllNhsCounts &&
                        netProductionDateRange.from &&
                        netProductionDateRange.to ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No NHS count data available for the selected date
                          range.
                        </div>
                      ) : null}
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
                        MOS Count
                      </h3>
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
                    </div>
                    <div className="overflow-x-auto">
                      {isLoadingAllMosCounts ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : mosCountSummary &&
                        mosCountSummary.monthlyCounts.length > 0 ? (
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-sidebar text-white">
                              <th className="text-left p-3 font-semibold text-sm">
                                Name
                              </th>
                              {mosCountSummary.monthlyCounts.map((mc) => (
                                <th
                                  key={mc.month}
                                  className="text-right p-3 font-semibold text-sm"
                                >
                                  {mc.month}
                                </th>
                              ))}
                              <th className="text-right p-3 font-semibold text-sm">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-border hover:bg-muted/50">
                              <td className="p-3 font-medium">
                                {provider?.name ?? ""}
                              </td>
                              {mosCountSummary.monthlyCounts.map((mc) => (
                                <td
                                  key={mc.month}
                                  className="p-3 text-right cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                                  onClick={() =>
                                    openCountEditDialog(
                                      mc.month,
                                      "mos_count",
                                      setMosCountRows,
                                      setIsLoadingMosCountDialog,
                                      setShowMosCountDialog,
                                    )
                                  }
                                >
                                  {mc.count > 0 ? mc.count.toString() : "-"}
                                </td>
                              ))}
                              <td className="p-3 text-right font-semibold">
                                {mosCountSummary.totalCount > 0
                                  ? mosCountSummary.totalCount.toString()
                                  : "-"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : !isLoadingAllMosCounts &&
                        netProductionDateRange.from &&
                        netProductionDateRange.to ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No MOS count data available for the selected date
                          range.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

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
                // Pull live data from state
                const plannedAvgDaily = plannedAvgDailyProduction;
                const workingDays = associateMetrics.workingDays;
                const assocSplit = associateMetrics.associateSplitPercent;
                const assocLabSplit = associateMetrics.associateLabSplitPercent;
                const ocpspd = profitGoalsMetrics.ocpspd;
                const actualTotal = associateMetrics.totalProduction;
                const assocNetPay = associateMetrics.associateNetPay;
                const costOfLabs = associateMetrics.costOfLabs;
                const matCost = associateMetrics.materialsCosts;
                // Effective rate implied by the resolved cost — matches the raw
                // location/provider percentage when the source is production-scaled,
                // and is just an informational "implied %" for absolute-£ sources
                // (accounting application / sliding scale / monthly).
                const labPct =
                  actualTotal > 0 ? (costOfLabs / actualTotal) * 100 : 0;
                const matPct =
                  actualTotal > 0 ? (matCost / actualTotal) * 100 : 0;
                const ocpspaContrib = associateMetrics.ocpspaContribution;
                const actualPL = associateMetrics.practicePL;
                const avgLabCostMonth = associateMetrics.avgLabCostPerMonth;
                const plOnRoomPerDay = associateMetrics.plOnRoomPerDay;
                const plPctOnOCPSPD = associateMetrics.plPercentOnOCPSPD;
                const plannedTotal = plannedMetrics.plannedTotalProduction;
                const plannedPL = plannedMetrics.plannedPracticePL;
                const plannedMaterials = plannedMetrics.plannedMaterials;

                const assocGross = actualTotal * (assocSplit / 100);
                const labDeduction =
                  actualTotal * (labPct / 100) * (assocLabSplit / 100);
                const actualAvgDaily =
                  workingDays > 0 ? actualTotal / workingDays : 0;
                const variance = actualTotal - plannedTotal;
                const actualPLPct =
                  actualTotal > 0 ? (actualPL / actualTotal) * 100 : 0;
                const plannedPLPct =
                  plannedTotal > 0 ? (plannedPL / plannedTotal) * 100 : 0;
                const numberOfMonths =
                  labPct > 0 && actualTotal > 0 && avgLabCostMonth > 0
                    ? Math.round(
                        (actualTotal * (labPct / 100)) / avgLabCostMonth,
                      )
                    : 1;

                const hasData = actualTotal > 0;
                const providerName = (provider as any)?.name ?? "";

                const fmtGBP = (n: number) =>
                  new Intl.NumberFormat("en-GB", {
                    style: "currency",
                    currency: "GBP",
                    minimumFractionDigits: 2,
                  }).format(Math.abs(n));
                const signed = (n: number) => `${n < 0 ? "−" : ""}${fmtGBP(n)}`;
                const pct = (n: number) => `${n.toFixed(0)}%`;
                const daysLong = (n: number) => n.toFixed(4);
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
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md ${hasData ? "bg-purple-50 text-purple-700 border border-purple-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}
                    >
                      <Info className="w-3 h-3 shrink-0" />
                      {hasData
                        ? `Using real data from: ${providerName}`
                        : "No production data available for the selected period"}
                    </div>

                    {/* INPUTS */}
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
                              `${workingDays.toFixed(2)} days`,
                              "bg-slate-100",
                            ],
                            [
                              "Associate Split %",
                              pct(assocSplit),
                              "bg-slate-100",
                            ],
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

                    {/* STEP CALCULATIONS */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                          {badge(1, "bg-purple-600")} Planned Total Production
                        </div>
                        <div className="text-slate-500 font-mono">
                          Planned Avg Daily × Working Days
                        </div>
                        <div className="mt-1.5 text-slate-400 font-mono">
                          {fmtGBP(plannedAvgDaily)} × {daysLong(workingDays)}{" "}
                          days
                        </div>
                        <div className="mt-1.5 pt-1.5 border-t border-blue-200 font-mono font-bold text-blue-700 text-sm">
                          = {fmtGBP(plannedTotal)}
                        </div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <div className="flex items-center gap-1.5 font-semibold text-purple-700 uppercase tracking-wide text-[10px] mb-2">
                          {badge(2, "bg-purple-600")} Avg Daily Production
                          (Actual)
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

                    {/* ASSOCIATE DEDUCTIONS */}
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
                      {/* Supplementary metrics */}
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

                    {/* P/L SUMMARY */}
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
                          Assoc & Lab deductions use Actual; Materials uses
                          Planned
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

              {/* Scrollable table area */}
              <div className="flex-1 overflow-auto">
                {isLoadingDialogData ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : null}
                {!isLoadingDialogData &&
                  (() => {
                    const associates = dialogAssociates;

                    const updateCell = (
                      rowIdx: number,
                      providerId: string,
                      field: string,
                      value: string,
                    ) => {
                      setWorkingHoursRows((prev) =>
                        prev.map((row, i) => {
                          if (i !== rowIdx) return row;
                          const existing = row.data[providerId] ?? {
                            workingDuration: "",
                            workingHoursPerDay: "",
                            udaCount: "",
                          };
                          const updated = { ...existing, [field]: value };
                          // Auto-set workingHoursPerDay to '8' when workingDuration gets a non-empty value
                          if (
                            field === "workingDuration" &&
                            value &&
                            !existing.workingHoursPerDay
                          ) {
                            updated.workingHoursPerDay = "8";
                          }
                          return {
                            ...row,
                            data: { ...row.data, [providerId]: updated },
                          };
                        }),
                      );
                    };

                    const addRow = () =>
                      setWorkingHoursRows((prev) => [
                        ...prev,
                        { month: "", data: {} },
                      ]);

                    const removeRow = (rowIdx: number) =>
                      setWorkingHoursRows((prev) =>
                        prev.length === 1
                          ? [{ month: "", data: {} }]
                          : prev.filter((_, i) => i !== rowIdx),
                      );

                    return (
                      <table
                        className="border-collapse text-sm"
                        style={{
                          minWidth: `${180 + associates.length * 360 + 80}px`,
                        }}
                      >
                        <thead className="sticky top-0 z-10">
                          {/* Row 1 — Month + Associate group headers + Actions */}
                          <tr>
                            <th
                              rowSpan={2}
                              className="sticky left-0 z-20 border border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[160px] min-w-[160px]"
                              style={{ background: "hsl(var(--muted))" }}
                            >
                              Month
                            </th>
                            {associates.map((p: any) => {
                              const fullName =
                                p?.name ??
                                `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
                              return (
                                <th
                                  key={p?.id ?? "current"}
                                  colSpan={3}
                                  className="border border-border px-3 py-3 text-center text-sm font-semibold whitespace-nowrap"
                                  style={{ background: "hsl(var(--muted))" }}
                                >
                                  {fullName || "—"}
                                </th>
                              );
                            })}
                            <th
                              rowSpan={2}
                              className="border border-border px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-[80px]"
                              style={{ background: "hsl(var(--muted))" }}
                            >
                              Actions
                            </th>
                          </tr>
                          {/* Row 2 — Sub-column labels per associate */}
                          <tr>
                            {associates.map((p: any) => (
                              <React.Fragment key={p?.id ?? "current"}>
                                <th
                                  className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                                  style={{
                                    background: "hsl(var(--muted) / 0.6)",
                                  }}
                                >
                                  Working Duration (Hours)
                                </th>
                                <th
                                  className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                                  style={{
                                    background: "hsl(var(--muted) / 0.6)",
                                  }}
                                >
                                  Working Hours Per Day
                                </th>
                                <th
                                  className="border border-border px-3 py-2 text-center text-[11px] font-medium whitespace-nowrap"
                                  style={{
                                    background: "hsl(var(--muted) / 0.6)",
                                  }}
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
                              {/* Month — sticky left */}
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
                              {/* Per-associate inputs */}
                              {associates.map((p: any) => {
                                const pid = p?.id ?? "current";
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
                                        type="text"
                                        inputMode="numeric"
                                        placeholder="0"
                                        value={cell.udaCount}
                                        onChange={(e) => {
                                          const val = e.target.value.replace(
                                            /[^0-9]/g,
                                            "",
                                          );
                                          updateCell(
                                            rowIdx,
                                            pid,
                                            "udaCount",
                                            val,
                                          );
                                        }}
                                        className="h-8 w-full min-w-[90px] rounded-md border border-input bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                      />
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                              {/* Actions */}
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
                  })()}
              </div>

              {/* Footer */}
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
                  onClick={saveWorkingHours}
                >
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={showNhsCountDialog}
            onOpenChange={setShowNhsCountDialog}
          >
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
                    const associates = nhsCountDialogAssociates;
                    if (associates.length === 0) {
                      return (
                        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                          No providers are flagged for NHS treatments. Enable
                          “Does Perform NHS Treatments?” on a provider’s Edit
                          page to include them here.
                        </div>
                      );
                    }
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
                      setNhsCountRows((prev) => [
                        ...prev,
                        { month: "", data: {} },
                      ]);
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

          <Dialog
            open={showMosCountDialog}
            onOpenChange={setShowMosCountDialog}
          >
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
                    const associates = mosCountDialogAssociates;
                    if (associates.length === 0) {
                      return (
                        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                          No providers are flagged for MOS treatments. Enable
                          “Does Perform MOS Treatments?” on a provider’s Edit
                          page to include them here.
                        </div>
                      );
                    }
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
                      setMosCountRows((prev) => [
                        ...prev,
                        { month: "", data: {} },
                      ]);
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

          {/* Lab Cost Monthly Values Dialog */}
          <Dialog
            open={showLabMonthlyDialog}
            onOpenChange={setShowLabMonthlyDialog}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Lab Cost — Monthly Values</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {labMonthlyRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <DatePicker
                      picker="month"
                      value={row.month ? dayjs(row.month) : null}
                      onChange={(date) =>
                        setLabMonthlyRows((prev) =>
                          prev.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  month: date ? date.format("YYYY-MM") : "",
                                }
                              : r,
                          ),
                        )
                      }
                      format="MMM YYYY"
                      style={{ height: "34px", flex: 1 }}
                      placeholder="Select month"
                    />
                    <div className="flex h-9 items-center rounded-md border border-input bg-background flex-1">
                      <span className="px-2 text-sm text-muted-foreground">
                        £
                      </span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={row.value}
                        onChange={(e) =>
                          setLabMonthlyRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, value: e.target.value } : r,
                            ),
                          )
                        }
                        className="h-full w-full border-0 bg-transparent px-1 text-sm focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => addMonthlyCostRow(setLabMonthlyRows)}
                      className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors shadow-sm flex-shrink-0"
                      title="Add row"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    {labMonthlyRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          removeMonthlyCostRow(idx, setLabMonthlyRows)
                        }
                        className="w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors shadow-sm flex-shrink-0"
                        title="Remove row"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowLabMonthlyDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    saveMonthlyCostRows(
                      labMonthlyRows,
                      "lab_cost_value",
                      setIsSavingLabMonthly,
                      setShowLabMonthlyDialog,
                    )
                  }
                  disabled={isSavingLabMonthly}
                >
                  {isSavingLabMonthly ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Material Cost Monthly Values Dialog */}
          <Dialog
            open={showMaterialMonthlyDialog}
            onOpenChange={setShowMaterialMonthlyDialog}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Material Cost — Monthly Values</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {materialMonthlyRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <DatePicker
                      picker="month"
                      value={row.month ? dayjs(row.month) : null}
                      onChange={(date) =>
                        setMaterialMonthlyRows((prev) =>
                          prev.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  month: date ? date.format("YYYY-MM") : "",
                                }
                              : r,
                          ),
                        )
                      }
                      format="MMM YYYY"
                      style={{ height: "34px", flex: 1 }}
                      placeholder="Select month"
                    />
                    <div className="flex h-9 items-center rounded-md border border-input bg-background flex-1">
                      <span className="px-2 text-sm text-muted-foreground">
                        £
                      </span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={row.value}
                        onChange={(e) =>
                          setMaterialMonthlyRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, value: e.target.value } : r,
                            ),
                          )
                        }
                        className="h-full w-full border-0 bg-transparent px-1 text-sm focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => addMonthlyCostRow(setMaterialMonthlyRows)}
                      className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors shadow-sm flex-shrink-0"
                      title="Add row"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    {materialMonthlyRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          removeMonthlyCostRow(idx, setMaterialMonthlyRows)
                        }
                        className="w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors shadow-sm flex-shrink-0"
                        title="Remove row"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowMaterialMonthlyDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    saveMonthlyCostRows(
                      materialMonthlyRows,
                      "material_cost_value",
                      setIsSavingMaterialMonthly,
                      setShowMaterialMonthlyDialog,
                    )
                  }
                  disabled={isSavingMaterialMonthly}
                >
                  {isSavingMaterialMonthly ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Profit Goals Settings Tab */}
          <TabsContent value="profit-goals-data" className="space-y-6">
            <div className="space-y-8">
              <h2 className="text-2xl font-bold text-foreground">
                Profit Goals Settings
              </h2>

              {/* Date Selection */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex gap-8">
                    <div>
                      <Label className="block mb-2">
                        Date Selection for Operations
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
                            profitGoalsDateRange.from
                              ? dayjs(profitGoalsDateRange.from)
                              : null,
                            profitGoalsDateRange.to
                              ? dayjs(profitGoalsDateRange.to)
                              : null,
                          ]}
                          onChange={(dates) => {
                            if (dates && dates[0] && dates[1]) {
                              setProfitGoalsDateRange({
                                from: dates[0].toDate(),
                                to: dates[1].toDate(),
                              });
                            }
                          }}
                          format="DD-MM-YYYY"
                          placeholder={["Start date", "End date"]}
                        />
                      </ConfigProvider>
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
                        {isLoadingProfitGoalsWorkingHours ||
                        isLoadingProfitGoalsNetProduction ? (
                          <tr>
                            <td colSpan={13} className="py-12 text-center">
                              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span className="text-sm">Loading...</span>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          (() => {
                            // When no planned Avg Daily Production has been set, Planned/Variance are unknown — show '-' instead of a misleading calculation
                            const isPlannedProductionSet =
                              plannedAvgDailyProduction > 0;
                            const varianceTotalProduction =
                              associateMetrics.totalProduction -
                              plannedMetrics.plannedTotalProduction;
                            const variancePracticePL =
                              associateMetrics.practicePL -
                              plannedMetrics.plannedPracticePL;
                            const actualPLPercent =
                              associateMetrics.totalProduction > 0
                                ? (associateMetrics.practicePL /
                                    associateMetrics.totalProduction) *
                                  100
                                : 0;
                            const plannedPLPercent =
                              plannedMetrics.plannedTotalProduction > 0
                                ? (plannedMetrics.plannedPracticePL /
                                    plannedMetrics.plannedTotalProduction) *
                                  100
                                : 0;
                            const variancePLPercent =
                              actualPLPercent - plannedPLPercent;

                            return (
                              <>
                                {/* Main Data Row */}
                                <tr
                                  className="border-b border-border hover:bg-muted/50 cursor-pointer"
                                  onClick={() =>
                                    setExpandedAssociate(
                                      expandedAssociate === providerData.id
                                        ? null
                                        : providerData.id,
                                    )
                                  }
                                >
                                  {/* Associate Cell - spans 2 rows when expanded */}
                                  <td
                                    className="p-3 font-medium align-middle !whitespace-normal"
                                    rowSpan={2}
                                  >
                                    <div className="flex items-center gap-2 w-[108px]">
                                      <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center transition-colors">
                                        {expandedAssociate ===
                                        providerData.id ? (
                                          <X className="w-3.5 h-3.5" />
                                        ) : (
                                          <Plus className="w-3.5 h-3.5" />
                                        )}
                                      </div>
                                      <span className="break-words min-w-0 flex-1">
                                        {providerData.name}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-3 text-right">
                                    {formatCurrency(
                                      associateMetrics.avgDailyProduction,
                                    )}
                                  </td>
                                  <td className="p-3 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-muted-foreground">
                                        £
                                      </span>
                                      <Input
                                        type="number"
                                        value={plannedInputValue}
                                        onChange={(e) =>
                                          setPlannedInputValue(e.target.value)
                                        }
                                        onBlur={(e) => {
                                          const value =
                                            Number(e.target.value) || 0;
                                          setPlannedAvgDailyProduction(value);
                                          setPlannedInputValue(String(value));
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            const value =
                                              Number(plannedInputValue) || 0;
                                            setPlannedAvgDailyProduction(value);
                                            setPlannedInputValue(String(value));
                                            e.currentTarget.blur();
                                          }
                                        }}
                                        className="w-28 h-10 text-right text-base hover:border-sidebar focus-visible:ring-sidebar"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  </td>
                                  <td className="p-3 text-right border-l border-border">
                                    {formatCurrency(
                                      associateMetrics.totalProduction,
                                    )}
                                  </td>
                                  <td className="p-3 text-right">
                                    {isPlannedProductionSet
                                      ? formatCurrency(
                                          plannedMetrics.plannedTotalProduction,
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
                                    {formatCurrency(
                                      associateMetrics.practicePL,
                                    )}
                                  </td>
                                  <td
                                    className={`p-3 text-right ${isPlannedProductionSet ? (plannedMetrics.plannedPracticePL < 0 ? "text-red-600" : "text-green-600") : ""}`}
                                  >
                                    {isPlannedProductionSet
                                      ? formatCurrency(
                                          plannedMetrics.plannedPracticePL,
                                        )
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
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        title="Clone Provider"
                                        className="h-8 w-8 hover:bg-sidebar hover:text-sidebar-foreground hidden"
                                        onClick={() => {
                                          resetAddAssociateForm();
                                          setAddAssociateForm((prev) => ({
                                            ...prev,
                                            associateSplitSource:
                                              (provider as any)
                                                ?.split_source_method ?? "",
                                            associateLabSplit:
                                              (provider as any)
                                                ?.lab_split_percentage != null
                                                ? String(
                                                    (provider as any)
                                                      .lab_split_percentage,
                                                  )
                                                : "50",
                                            nhsIncome:
                                              (provider as any)?.nhs_income ??
                                              "",
                                            membershipIncome:
                                              (provider as any)
                                                ?.membership_income ?? "",
                                          }));
                                          setIsAddAssociateOpen(true);
                                        }}
                                      >
                                        <Copy className="w-4 h-4" />
                                      </Button>
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-8 w-8 text-green-600 hover:bg-sidebar hover:text-sidebar-foreground"
                                              onClick={
                                                savePlannedDailyProduction
                                              }
                                              disabled={isSavingPlanned}
                                            >
                                              {isSavingPlanned ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                              ) : (
                                                <CheckCheck className="w-4 h-4" />
                                              )}
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Save Planned Daily Production</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </div>
                                  </td>
                                </tr>
                                {/* Expanded Details Row */}
                                <tr
                                  className={
                                    expandedAssociate === providerData.id
                                      ? "border-b border-border"
                                      : ""
                                  }
                                >
                                  <td colSpan={12} className="p-0">
                                    <div
                                      style={{
                                        maxHeight:
                                          expandedAssociate === providerData.id
                                            ? "200px"
                                            : "0px",
                                        opacity:
                                          expandedAssociate === providerData.id
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
                                                associateMetrics.associateNetPay,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {
                                                associateMetrics.associateSplitPercent
                                              }{" "}
                                              %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                associateMetrics.costOfLabs,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {
                                                associateMetrics.associateLabSplitPercent
                                              }{" "}
                                              %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                associateMetrics.avgLabCostPerMonth,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                associateMetrics.materialsCosts,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {associateMetrics.workingDays.toFixed(
                                                2,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                associateMetrics.ocpspaContribution,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {associateMetrics.plPercentOnOCPSPD.toFixed(
                                                0,
                                              )}{" "}
                                              %
                                            </td>
                                            <td className="px-3 pt-1 pb-3 text-sm font-semibold text-foreground text-center">
                                              {formatCurrency(
                                                associateMetrics.plOnRoomPerDay,
                                              )}
                                            </td>
                                            <td className="px-3 pt-1 pb-3"></td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              </>
                            );
                          })()
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
                        {savedPlannedRecords.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="p-8 text-center text-muted-foreground"
                            >
                              No records found
                            </td>
                          </tr>
                        ) : (
                          savedPlannedRecords.map((record, index) => (
                            <tr
                              key={record.id}
                              className="border-b border-border hover:bg-muted/50"
                            >
                              <td className="p-3 text-left">{index + 1}</td>
                              <td className="p-3 text-left">
                                {providerData.name}
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
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Payslip Tab */}
          <TabsContent value="payslip" className="space-y-6">
            <PayslipTab
              provider={provider as Provider | undefined}
              providerId={id!}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Sliding Scale Modal — opened from the Contract Details tab's split
          source selects, matching fe-dentpulse-live's Contract Details
          "manage sliding scale" dialog trigger next to each source select. */}
      <Dialog
        open={openSlidingScaleFor !== null}
        onOpenChange={(open) => !open && setOpenSlidingScaleFor(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {openSlidingScaleFor === "associate" && "Associate Sliding Scale"}
              {openSlidingScaleFor === "labCost" && "Lab Cost Sliding Scale"}
              {openSlidingScaleFor === "materialCost" &&
                "Material Cost Sliding Scale"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {openSlidingScaleFor === "associate" && (
              <>
                <SlidingScaleBandEditor
                  title="Associate Sliding Scale"
                  bands={associateSlidingScale}
                  setBands={setAssociateSlidingScale}
                  validationErrors={associateValidationErrors}
                  setValidationErrors={setAssociateValidationErrors}
                  newBandId={newAssociateBandId}
                  setNewBandId={setNewAssociateBandId}
                  isSaving={
                    isSaving && savingVariables?.scaleType === "sliding_scale"
                  }
                  onSave={() =>
                    handleSaveSlidingScale(
                      "sliding_scale",
                      associateSlidingScale,
                      associateValidationErrors,
                    )
                  }
                />
                {/* <SlidingScaleBandEditor
                  title="Associate Lab Sliding Scale"
                  bands={labSlidingScale}
                  setBands={setLabSlidingScale}
                  validationErrors={labValidationErrors}
                  setValidationErrors={setLabValidationErrors}
                  newBandId={newLabBandId}
                  setNewBandId={setNewLabBandId}
                  isSaving={
                    isSaving &&
                    savingVariables?.scaleType === "lab_sliding_scale"
                  }
                  onSave={() =>
                    handleSaveSlidingScale(
                      "lab_sliding_scale",
                      labSlidingScale,
                      labValidationErrors,
                    )
                  }
                /> */}
              </>
            )}
            {openSlidingScaleFor === "labCost" && (
              <SlidingScaleBandEditor
                title="Lab Cost Sliding Scale"
                bands={labCostSlidingScale}
                setBands={setLabCostSlidingScale}
                validationErrors={labCostValidationErrors}
                setValidationErrors={setLabCostValidationErrors}
                newBandId={newLabCostBandId}
                setNewBandId={setNewLabCostBandId}
                isSaving={
                  isSaving && savingVariables?.scaleType === "lab_cost_scale"
                }
                onSave={() =>
                  handleSaveSlidingScale(
                    "lab_cost_scale",
                    labCostSlidingScale,
                    labCostValidationErrors,
                  )
                }
              />
            )}
            {openSlidingScaleFor === "materialCost" && (
              <SlidingScaleBandEditor
                title="Material Cost Sliding Scale"
                bands={materialCostSlidingScale}
                setBands={setMaterialCostSlidingScale}
                validationErrors={materialCostValidationErrors}
                setValidationErrors={setMaterialCostValidationErrors}
                newBandId={newMaterialCostBandId}
                setNewBandId={setNewMaterialCostBandId}
                isSaving={
                  isSaving &&
                  savingVariables?.scaleType === "material_cost_scale"
                }
                onSave={() =>
                  handleSaveSlidingScale(
                    "material_cost_scale",
                    materialCostSlidingScale,
                    materialCostValidationErrors,
                  )
                }
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Associate Modal */}
      <Dialog open={isAddAssociateOpen} onOpenChange={setIsAddAssociateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b border-border">
            <DialogTitle>Add</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-6 mt-6">
            {/* Left Column */}
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="add-code">
                  Code<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-code"
                  placeholder="Code"
                  value={addAssociateForm.code}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      code: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-email">
                  Email<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-email"
                  type="email"
                  placeholder="Email address"
                  value={addAssociateForm.email}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      email: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-role">Role</Label>
                <Input
                  id="add-role"
                  placeholder="Role"
                  value={addAssociateForm.role}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      role: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-split-source">
                  Associate Split Source<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-split-source"
                  placeholder="Associate Split Source"
                  value={addAssociateForm.associateSplitSource}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      associateSplitSource: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-nhs-income">NHS Income</Label>
                <Select
                  value={addAssociateForm.nhsIncome}
                  onValueChange={(value) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      nhsIncome: value,
                    })
                  }
                >
                  <SelectTrigger className="focus:ring-0 focus:ring-offset-0">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="option1">Option 1</SelectItem>
                    <SelectItem value="option2">Option 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>
                  Joining Date<span className="text-red-500">*</span>
                </Label>
                <Popover
                  open={addAssociateJoiningDateOpen}
                  onOpenChange={setAddAssociateJoiningDateOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {addAssociateForm.joiningDate
                        ? format(addAssociateForm.joiningDate, "dd-MM-yyyy")
                        : "dd-mm-yyyy"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={addAssociateForm.joiningDate || undefined}
                      onSelect={(date) => {
                        setAddAssociateForm({
                          ...addAssociateForm,
                          joiningDate: date || null,
                        });
                        setAddAssociateJoiningDateOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="add-performs-nhs"
                    className="cursor-pointer font-normal"
                  >
                    Does Perform NHS Treatments?
                  </Label>
                  <Switch
                    id="add-performs-nhs"
                    checked={addAssociateForm.performsNhsTreatments}
                    onCheckedChange={(checked) =>
                      setAddAssociateForm({
                        ...addAssociateForm,
                        performsNhsTreatments: checked,
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="add-performs-mos"
                    className="cursor-pointer font-normal"
                  >
                    Does Perform MOS Treatments?
                  </Label>
                  <Switch
                    id="add-performs-mos"
                    checked={addAssociateForm.performsMosTreatments}
                    onCheckedChange={(checked) =>
                      setAddAssociateForm({
                        ...addAssociateForm,
                        performsMosTreatments: checked,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="add-name">
                  Name<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-name"
                  placeholder="Full name"
                  value={addAssociateForm.name}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      name: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-phone">
                  Phone No <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-phone"
                  placeholder="Phone number"
                  maxLength={15}
                  value={addAssociateForm.phoneNo}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      phoneNo: e.target.value.replace(/[^0-9+\s\-()]/g, ""),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-primary-chair">
                  Primary Chair<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-primary-chair"
                  placeholder="Primary Chair"
                  value={addAssociateForm.primaryChair}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      primaryChair: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-lab-split">Associate Lab Split</Label>
                <Input
                  id="add-lab-split"
                  placeholder="Lab Split %"
                  value={addAssociateForm.associateLabSplit}
                  onChange={(e) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      associateLabSplit: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-membership-income">Membership Income</Label>
                <Select
                  value={addAssociateForm.membershipIncome}
                  onValueChange={(value) =>
                    setAddAssociateForm({
                      ...addAssociateForm,
                      membershipIncome: value,
                    })
                  }
                >
                  <SelectTrigger className="focus:ring-0 focus:ring-offset-0">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="option1">Option 1</SelectItem>
                    <SelectItem value="option2">Option 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Leaving Date</Label>
                <Popover
                  open={addAssociateLeavingDateOpen}
                  onOpenChange={setAddAssociateLeavingDateOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal hover:bg-transparent hover:text-foreground"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {addAssociateForm.leavingDate
                        ? format(addAssociateForm.leavingDate, "dd-MM-yyyy")
                        : "dd-mm-yyyy"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={addAssociateForm.leavingDate || undefined}
                      onSelect={(date) => {
                        setAddAssociateForm({
                          ...addAssociateForm,
                          leavingDate: date || null,
                        });
                        setAddAssociateLeavingDateOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              className="bg-[hsl(244_48.2%_62%)] hover:bg-[hsl(244_48%_55%)]"
              onClick={handleSaveNewProvider}
              disabled={isAddingSaving}
            >
              {isAddingSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              className="bg-gray-500 hover:bg-gray-600 text-white"
              onClick={() => {
                setIsAddAssociateOpen(false);
                resetAddAssociateForm();
              }}
              disabled={isAddingSaving}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revenue Trend Chart Formula */}
      <Dialog
        open={showRevenueTrendFormula}
        onOpenChange={setShowRevenueTrendFormula}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-blue-500" />
              How Revenue Trend is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Actual (bars):
                </span>{" "}
                Sum of completed TPI amounts per month for this provider
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Target (dashed line):
                </span>{" "}
                Planned Avg Daily Production × Mon–Fri working days in each
                month — set in Profit Goals Settings
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Appointment status:
                </span>{" "}
                Completed TPIs only
              </li>
            </ul>
            {(latestPlannedProduction ?? 0) > 0 &&
              (() => {
                const monthlyData = revenueTrendData?.monthlyProduction ?? [];
                const lastMonth = monthlyData[monthlyData.length - 1];
                if (!lastMonth) return null;
                const [mon, yr] = lastMonth.month.split("-");
                const monthIdx = [
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec",
                ].indexOf(mon);
                const year = 2000 + Number(yr);
                const days = new Date(year, monthIdx + 1, 0).getDate();
                let wdays = 0;
                for (let d = 1; d <= days; d++) {
                  const dow = new Date(year, monthIdx, d).getDay();
                  if (dow !== 0 && dow !== 6) wdays++;
                }
                const planned = latestPlannedProduction ?? 0;
                const target = Math.round(planned * wdays * 100) / 100;
                const actual = lastMonth.amount;
                return (
                  <div className="bg-muted/50 border rounded-lg p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">
                      Example — {lastMonth.month}
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="bg-background rounded p-2 text-center flex-1">
                        <p className="text-muted-foreground mb-1">Actual</p>
                        <p className="font-bold text-foreground text-sm">
                          {formatCurrency(actual)}
                        </p>
                      </div>
                      <div className="bg-background rounded p-2 text-center flex-1">
                        <p className="text-muted-foreground mb-1">
                          {formatCurrency(planned)} × {wdays}d
                        </p>
                        <p className="font-bold text-foreground text-sm">
                          {formatCurrency(target)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Target = {formatCurrency(planned)} planned daily × {wdays}{" "}
                      working days in {lastMonth.month}
                    </p>
                  </div>
                );
              })()}
            {(!latestPlannedProduction || latestPlannedProduction === 0) && (
              <p className="text-xs text-muted-foreground italic">
                No planned production set — go to Profit Goals Settings to add
                one.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Revenue Formula */}
      <Dialog open={showRevenueFormula} onOpenChange={setShowRevenueFormula}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-emerald-500" />
              How Revenue is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
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
                  Date filter:
                </span>{" "}
                Appointment date falls within the selected range
              </li>
            </ul>
            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                Example
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">TPI total</p>
                  <p className="font-bold text-foreground">
                    {formatCurrency(providerData.kpis.revenue.current || 12000)}
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-emerald-100 rounded p-2 text-center">
                  <p className="text-emerald-700">Revenue</p>
                  <p className="font-bold text-emerald-800">
                    {formatCurrency(providerData.kpis.revenue.current || 12000)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Patients Formula */}
      <Dialog open={showPatientsFormula} onOpenChange={setShowPatientsFormula}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-blue-500" />
              How Patients is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                • <span className="text-foreground font-medium">Count:</span>{" "}
                Distinct patients with at least one Completed appointment
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Date filter:
                </span>{" "}
                Appointment date falls within the selected range
              </li>
              <li>
                • <span className="text-foreground font-medium">Excludes:</span>{" "}
                Admin/block slots (no patient attached)
              </li>
            </ul>
            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                Example
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">Distinct patient IDs</p>
                  <p className="font-bold text-foreground">
                    {providerData.kpis.patients.current || 195}
                  </p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-blue-100 rounded p-2 text-center">
                  <p className="text-blue-700">Patients</p>
                  <p className="font-bold text-blue-800">
                    {providerData.kpis.patients.current || 195}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Avg/Patient Formula */}
      <Dialog
        open={showAvgPatientFormula}
        onOpenChange={setShowAvgPatientFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-violet-500" />
              How Avg / Patient is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-center">
              <p className="text-xs text-violet-700 font-mono">Revenue</p>
              <div className="border-t border-violet-300 my-1" />
              <p className="text-xs text-violet-700 font-mono">
                Total Patients
              </p>
            </div>
            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                Example
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {formatCurrency(
                      providerData.kpis.revenue.current || 100000,
                    )}
                  </p>
                  <p className="font-bold text-foreground">revenue</p>
                </div>
                <span className="text-muted-foreground font-bold">÷</span>
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {providerData.kpis.patients.current || 195} patients
                  </p>
                  <p className="font-bold text-foreground">count</p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-violet-100 rounded p-2 text-center">
                  <p className="text-violet-700">Avg</p>
                  <p className="font-bold text-violet-800">
                    {formatCurrency(
                      providerData.kpis.avgRevPerPatient.current || 514,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Utilisation Formula */}
      <Dialog
        open={showUtilisationFormula}
        onOpenChange={setShowUtilisationFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-amber-500" />
              How Utilisation is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-xs text-amber-700 font-mono">
                Total Appointment Minutes
              </p>
              <div className="border-t border-amber-300 my-1" />
              <p className="text-xs text-amber-700 font-mono">
                Working Days × Hours/Day × 60
              </p>
              <p className="text-xs text-amber-600 mt-1">× 100</p>
            </div>
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

            {/* This provider's REAL numbers, computed live from the appointments. */}
            {kpiUtilBreakdown && kpiUtilBreakdown.workingDays > 0 && (
              <div className="bg-muted/50 border rounded-lg p-3">
                <p className="text-xs font-semibold text-foreground mb-2">
                  This period — {kpiUtilBreakdown.workingDays} working days,{" "}
                  {kpiUtilBreakdown.hoursPerDay} hrs/day
                </p>
                <div className="flex items-center gap-1 text-xs">
                  <div className="flex-1 bg-background rounded p-2 text-center">
                    <p className="text-muted-foreground">Total appt mins</p>
                    <p className="font-bold text-foreground">
                      {Math.round(
                        kpiUtilBreakdown.totalMinutes,
                      ).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      = {(kpiUtilBreakdown.totalMinutes / 60).toFixed(1)} hrs
                    </p>
                  </div>
                  <span className="text-muted-foreground font-bold">÷</span>
                  <div className="flex-1 bg-background rounded p-2 text-center">
                    <p className="text-muted-foreground">
                      {kpiUtilBreakdown.workingDays}×
                      {kpiUtilBreakdown.hoursPerDay}×60
                    </p>
                    <p className="font-bold text-foreground">
                      {(
                        kpiUtilBreakdown.workingDays *
                        kpiUtilBreakdown.hoursPerDay *
                        60
                      ).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-muted-foreground font-bold">
                    ×100 =
                  </span>
                  <div className="flex-1 bg-amber-100 rounded p-2 text-center">
                    <p className="text-amber-700 font-bold">
                      {kpiUtilBreakdown.pct}%
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Patients Formula */}
      <Dialog
        open={showNewPatientsFormula}
        onOpenChange={setShowNewPatientsFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-teal-500" />
              How New Patients is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                •{" "}
                <span className="text-foreground font-medium">Definition:</span>{" "}
                Patients who had their very first appointment in the selected
                period
              </li>
              <li>
                • <span className="text-foreground font-medium">Method:</span>{" "}
                Patients this period minus those who had any prior appointment
              </li>
              <li>
                • <span className="text-foreground font-medium">Excludes:</span>{" "}
                Returning patients who visited before
              </li>
            </ul>
            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                Example
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {providerData.kpis.patients.current || 195} patients
                  </p>
                  <p className="font-bold text-foreground">this period</p>
                </div>
                <span className="text-muted-foreground font-bold">−</span>
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {(providerData.kpis.patients.current || 195) -
                      (providerData.kpis.newPatients.current || 193)}{" "}
                    returning
                  </p>
                  <p className="font-bold text-foreground">prior visits</p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-teal-100 rounded p-2 text-center">
                  <p className="text-teal-700">New</p>
                  <p className="font-bold text-teal-800">
                    {providerData.kpis.newPatients.current || 193}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recall Rate Formula */}
      <Dialog
        open={showRecallRateFormula}
        onOpenChange={setShowRecallRateFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-rose-500" />
              How Recall Rate is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-center">
              <p className="text-xs text-rose-700 font-mono">
                Returning Patients (this period)
              </p>
              <div className="border-t border-rose-300 my-1" />
              <p className="text-xs text-rose-700 font-mono">
                Total Patients (this period)
              </p>
              <p className="text-xs text-rose-600 mt-1">× 100</p>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                •{" "}
                <span className="text-foreground font-medium">Returning:</span>{" "}
                Patients seen this period who also had a previous appointment
              </li>
              <li>
                • <span className="text-foreground font-medium">Target:</span>{" "}
                80% or above is considered healthy
              </li>
            </ul>
            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                Example
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {(providerData.kpis.patients.current || 195) -
                      (providerData.kpis.newPatients.current || 193)}{" "}
                    returning
                  </p>
                  <p className="font-bold text-foreground">patients</p>
                </div>
                <span className="text-muted-foreground font-bold">÷</span>
                <div className="flex-1 bg-background rounded p-2 text-center">
                  <p className="text-muted-foreground">
                    {providerData.kpis.patients.current || 195} total
                  </p>
                  <p className="font-bold text-foreground">×100</p>
                </div>
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex-1 bg-rose-100 rounded p-2 text-center">
                  <p className="text-rose-700">Rate</p>
                  <p className="font-bold text-rose-800">
                    {providerData.kpis.recallRate.current || 1}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* VS Prior Year Formula */}
      <Dialog
        open={showVsPriorYearFormula}
        onOpenChange={setShowVsPriorYearFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-emerald-500" />
              How VS Prior Year is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
              <p className="text-xs text-emerald-700 font-mono">
                Actual Revenue (this period)
              </p>
              <p className="text-xs text-emerald-600 my-1">−</p>
              <p className="text-xs text-emerald-700 font-mono">
                Actual Revenue (same period last year)
              </p>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                • <span className="text-foreground font-medium">Actual:</span>{" "}
                Sum of completed TPI amounts in the selected date range
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">Prior year:</span>{" "}
                Same start/end dates shifted back exactly 1 year
              </li>
              <li>
                • <span className="text-foreground font-medium">% change:</span>{" "}
                Difference ÷ prior year × 100
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>

      {/* VS Target Formula */}
      <Dialog open={showVsTargetFormula} onOpenChange={setShowVsTargetFormula}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-violet-500" />
              How VS Target is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-center">
              <p className="text-xs text-violet-700 font-mono">
                Actual Revenue (this period)
              </p>
              <p className="text-xs text-violet-600 my-1">−</p>
              <p className="text-xs text-violet-700 font-mono">
                Planned Daily Production × Mon–Fri working days
              </p>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                • <span className="text-foreground font-medium">Target:</span>{" "}
                Planned Avg Daily Production × actual days worked — matches
                Profit Goals Settings
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Days worked:
                </span>{" "}
                Total appointment hours ÷ org hours per day
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Planned daily:
                </span>{" "}
                Set in Profit Goals Settings for this provider
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">No target:</span>{" "}
                Shown as "No target set" if not configured
              </li>
            </ul>
            {(latestPlannedProduction ?? 0) > 0 &&
              (() => {
                const actual = revenueTrendData?.totalProduction ?? 0;
                const planned = latestPlannedProduction ?? 0;
                const metricsRow = (productionMetricsData ?? []).find(
                  (m) => m.provider_id === id,
                );
                const wdays = metricsRow?.days_worked ?? 0;
                const target = Math.round(planned * wdays * 100) / 100;
                const diff = actual - target;
                return (
                  <div className="bg-muted/50 border rounded-lg p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">
                      Example
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="bg-background rounded p-2 text-center flex-1">
                        <p className="text-muted-foreground mb-1">Actual</p>
                        <p className="font-bold text-foreground text-sm">
                          {formatCurrency(actual)}
                        </p>
                      </div>
                      <span className="text-muted-foreground font-bold text-base">
                        −
                      </span>
                      <div className="bg-background rounded p-2 text-center flex-1">
                        <p className="text-muted-foreground mb-1">
                          {formatCurrency(planned)} × {wdays.toFixed(2)} days
                        </p>
                        <p className="font-bold text-foreground text-sm">
                          {formatCurrency(target)}
                        </p>
                      </div>
                      <span className="text-muted-foreground font-bold text-base">
                        =
                      </span>
                      <div
                        className={`rounded p-2 text-center flex-1 ${diff >= 0 ? "bg-emerald-100" : "bg-rose-100"}`}
                      >
                        <p
                          className={`mb-1 ${diff >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                        >
                          Result
                        </p>
                        <p
                          className={`font-bold text-sm ${diff >= 0 ? "text-emerald-800" : "text-rose-800"}`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {formatCurrency(diff)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Performance Rank Formula */}
      <Dialog
        open={showPerformanceRankFormula}
        onOpenChange={setShowPerformanceRankFormula}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-rose-500" />
              How Performance Rank is Calculated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-center">
              <p className="text-xs text-rose-700 font-mono">
                Total Production ÷ Days Worked
              </p>
              <p className="text-xs text-rose-600 mt-1">
                = Avg Daily Production → ranked among all active providers of
                the same type
              </p>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Days worked:
                </span>{" "}
                Total appointment hours ÷ org hours per day
              </li>
              <li>
                • <span className="text-foreground font-medium">Scope:</span>{" "}
                Ranked within this provider's type (Dentist, Hygienist, etc.)
              </li>
              <li>
                •{" "}
                <span className="text-foreground font-medium">
                  Date filter:
                </span>{" "}
                Completed TPIs in the selected date range
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
