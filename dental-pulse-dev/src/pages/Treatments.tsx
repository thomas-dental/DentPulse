import { useState, useMemo, useEffect, useRef } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { MetricHelp } from '@/components/dashboard/MetricHelp';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { Badge } from '@/components/ui/badge';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TreatmentFilePreview } from '@/components/treatments/TreatmentFilePreview';
import { useTreatmentUploads } from '@/hooks/useTreatmentUploads';
import { TreatmentFileUpload } from '@/components/treatments/TreatmentFileUpload';
import { TreatmentCategoriesManagement } from '@/components/treatments/TreatmentCategoriesManagement';
import { TreatmentCategoryFormDialog } from '@/components/treatments/TreatmentCategoryFormDialog';
import { TreatmentsList } from '@/components/treatments/TreatmentsList';
import { AllTreatmentsProfitabilityTab } from '@/components/treatments/AllTreatmentsProfitabilityTab';
import { useLocations } from '@/hooks/useLocations';
import { useTreatmentCategories } from '@/hooks/useTreatmentCategories';
import { useMembershipPlanSummary } from '@/hooks/useMembershipPlanSummary';
import { useRevenueByType, buildRevenueChartsData } from '@/hooks/useRevenueByType';
import { useFilters } from '@/contexts/FilterContext';
import { useTreatments } from '@/hooks/useTreatments';
import { useTreatmentGoalStats } from '@/hooks/useTreatmentGoalStats';
import { useTreatmentGoalTargets } from '@/hooks/useTreatmentGoalTargets';
import { useImplantSurgeons } from '@/hooks/useImplantSurgeons';
import { useImplantSurgeonsByLocation } from '@/hooks/useImplantSurgeonsByLocation';
import { useInvisalignProviders } from '@/hooks/useInvisalignProviders';
import { useInvisalignByLocation } from '@/hooks/useInvisalignByLocation';
import { useImplantPipeline } from '@/hooks/useImplantPipeline';
import { useImplantByType } from '@/hooks/useImplantByType';
import { useImplantMonthlyTrends } from '@/hooks/useImplantMonthlyTrends';
import { useInvisalignMonthlyTrends } from '@/hooks/useInvisalignMonthlyTrends';
import { useInvisalignPipeline } from '@/hooks/useInvisalignPipeline';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, ComposedChart, Area } from 'recharts';
import { Stethoscope, Building, Users, TrendingUp, Target, Lightbulb, CheckCircle2, AlertCircle, ArrowUpRight, Upload, Plus, ChevronDown, Search, Loader2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format, startOfMonth, startOfYear } from 'date-fns';

// Mock treatment data
const nhsTreatments = [
  { code: 'Band 1', description: 'Check-up, scale & polish', count: 2450, revenue: 61250, avgValue: 25, trend: 2.1 },
  { code: 'Band 2', description: 'Fillings, extractions, root canal', count: 1820, revenue: 127400, avgValue: 70, trend: -1.5 },
  { code: 'Band 3', description: 'Crowns, bridges, dentures', count: 680, revenue: 177480, avgValue: 261, trend: 4.8 },
  { code: 'Urgent', description: 'Emergency appointments', count: 320, revenue: 7360, avgValue: 23, trend: 8.2 },
];

const privateTreatments = [
  { category: 'General Dentistry', treatments: ['Examinations', 'Fillings', 'Extractions'], count: 3200, revenue: 224000, avgValue: 70, trend: 3.5 },
  { category: 'Cosmetic', treatments: ['Whitening', 'Veneers', 'Bonding'], count: 890, revenue: 312650, avgValue: 351, trend: 8.2 },
  { category: 'Implants', treatments: ['Single implant', 'All-on-4', 'Bone grafts'], count: 145, revenue: 435000, avgValue: 3000, trend: 12.5 },
  { category: 'Orthodontics', treatments: ['Invisalign', 'Fixed braces', 'Retainers'], count: 280, revenue: 840000, avgValue: 3000, trend: 6.8 },
  { category: 'Endodontics', treatments: ['Root canal', 'Retreatment'], count: 420, revenue: 168000, avgValue: 400, trend: 1.2 },
];

// Invisalign specialty data
const invisalignData = {
  actual: { cases: 185, revenue: 647500, avgCaseValue: 3500, conversionRate: 42 },
  target: { cases: 240, revenue: 840000, avgCaseValue: 3500, conversionRate: 55 },
  byLocation: [
    { location: 'London Central', actual: 45, target: 60, revenue: 157500, conversion: 48, gap: -15 },
    { location: 'Manchester North', actual: 38, target: 50, revenue: 133000, conversion: 45, gap: -12 },
    { location: 'Birmingham East', actual: 32, target: 45, revenue: 112000, conversion: 40, gap: -13 },
    { location: 'Leeds Central', actual: 28, target: 35, revenue: 98000, conversion: 38, gap: -7 },
    { location: 'Bristol South', actual: 25, target: 30, revenue: 87500, conversion: 42, gap: -5 },
    { location: 'Edinburgh', actual: 17, target: 20, revenue: 59500, conversion: 35, gap: -3 },
  ],
  monthlyTrends: [
    { month: 'Jul', actual: 28, target: 40, consultations: 70, conversions: 28 },
    { month: 'Aug', actual: 25, target: 40, consultations: 62, conversions: 25 },
    { month: 'Sep', actual: 32, target: 40, consultations: 75, conversions: 32 },
    { month: 'Oct', actual: 35, target: 40, consultations: 80, conversions: 35 },
    { month: 'Nov', actual: 33, target: 40, consultations: 78, conversions: 33 },
    { month: 'Dec', actual: 32, target: 40, consultations: 76, conversions: 32 },
  ],
  pipeline: {
    consultationsBooked: 92,
    consultationsCompleted: 76,
    treatmentPlansPresented: 68,
    treatmentPlansAccepted: 32,
    inProgress: 145,
    completed: 40,
  },
  providers: [
    { name: 'Dr. Sarah Mitchell', cases: 48, revenue: 168000, conversion: 55, rating: 4.9 },
    { name: 'Dr. James Wong', cases: 42, revenue: 147000, conversion: 48, rating: 4.8 },
    { name: 'Dr. Emily Roberts', cases: 38, revenue: 133000, conversion: 45, rating: 4.7 },
    { name: 'Dr. Michael Chen', cases: 32, revenue: 112000, conversion: 40, rating: 4.6 },
    { name: 'Dr. Lisa Anderson', cases: 25, revenue: 87500, conversion: 38, rating: 4.5 },
  ],
};

const invisalignGrowthStrategies = [
  { strategy: 'Increase consultation bookings', impact: 'High', effort: 'Medium', potential: '+25 cases/quarter', status: 'In Progress' },
  { strategy: 'Improve conversion at consultation', impact: 'High', effort: 'Low', potential: '+18 cases/quarter', status: 'Planned' },
  { strategy: 'Launch social media campaign', impact: 'Medium', effort: 'Medium', potential: '+15 cases/quarter', status: 'Planned' },
  { strategy: 'Provider training programme', impact: 'High', effort: 'High', potential: '+20 cases/quarter', status: 'In Progress' },
  { strategy: 'Patient referral incentive', impact: 'Medium', effort: 'Low', potential: '+12 cases/quarter', status: 'Active' },
  { strategy: 'Open evening events', impact: 'Medium', effort: 'Medium', potential: '+10 cases/quarter', status: 'Completed' },
];

// Implant specialty data
const implantData = {
  actual: { cases: 145, revenue: 725000, avgCaseValue: 5000, conversionRate: 38 },
  target: { cases: 200, revenue: 1000000, avgCaseValue: 5000, conversionRate: 50 },
  byLocation: [
    { location: 'London Central', actual: 42, target: 55, revenue: 210000, conversion: 45, gap: -13 },
    { location: 'Manchester North', actual: 32, target: 45, revenue: 160000, conversion: 40, gap: -13 },
    { location: 'Birmingham East', actual: 28, target: 40, revenue: 140000, conversion: 38, gap: -12 },
    { location: 'Leeds Central', actual: 18, target: 25, revenue: 90000, conversion: 35, gap: -7 },
    { location: 'Bristol South', actual: 15, target: 20, revenue: 75000, conversion: 32, gap: -5 },
    { location: 'Edinburgh', actual: 10, target: 15, revenue: 50000, conversion: 30, gap: -5 },
  ],
  byType: [
    { type: 'Single Implant', actual: 85, target: 110, revenue: 255000, avgValue: 3000 },
    { type: 'Multiple Implants', actual: 35, target: 50, revenue: 245000, avgValue: 7000 },
    { type: 'All-on-4', actual: 18, target: 30, revenue: 180000, avgValue: 10000 },
    { type: 'Bone Grafts', actual: 7, target: 10, revenue: 45000, avgValue: 6428 },
  ],
  monthlyTrends: [
    { month: 'Jul', actual: 22, target: 33, consultations: 58, conversions: 22 },
    { month: 'Aug', actual: 20, target: 33, consultations: 52, conversions: 20 },
    { month: 'Sep', actual: 25, target: 33, consultations: 65, conversions: 25 },
    { month: 'Oct', actual: 28, target: 33, consultations: 72, conversions: 28 },
    { month: 'Nov', actual: 26, target: 33, consultations: 68, conversions: 26 },
    { month: 'Dec', actual: 24, target: 33, consultations: 62, conversions: 24 },
  ],
  pipeline: {
    consultationsBooked: 78,
    consultationsCompleted: 62,
    ctScansCompleted: 55,
    treatmentPlansPresented: 48,
    treatmentPlansAccepted: 24,
    surgeriesScheduled: 22,
    inProgress: 98,
    completed: 47,
  },
  providers: [
    { name: 'Dr. Richard Harris', cases: 45, revenue: 225000, conversion: 48, surgeries: 52 },
    { name: 'Dr. Amanda Foster', cases: 38, revenue: 190000, conversion: 42, surgeries: 44 },
    { name: 'Dr. David Thompson', cases: 32, revenue: 160000, conversion: 38, surgeries: 38 },
    { name: 'Dr. Claire Williams', cases: 30, revenue: 150000, conversion: 35, surgeries: 35 },
  ],
};

const implantGrowthStrategies = [
  { strategy: 'CT scanner investment', impact: 'High', effort: 'High', potential: '+30 cases/quarter', status: 'Planned' },
  { strategy: 'Specialist recruitment', impact: 'High', effort: 'High', potential: '+25 cases/quarter', status: 'In Progress' },
  { strategy: 'Patient finance options', impact: 'High', effort: 'Low', potential: '+20 cases/quarter', status: 'Active' },
  { strategy: 'GP referral programme', impact: 'Medium', effort: 'Medium', potential: '+15 cases/quarter', status: 'Planned' },
  { strategy: 'All-on-4 marketing push', impact: 'Medium', effort: 'Medium', potential: '+12 cases/quarter', status: 'In Progress' },
  { strategy: 'Patient testimonial videos', impact: 'Medium', effort: 'Low', potential: '+8 cases/quarter', status: 'Completed' },
];

// Invisalign KPI Cards Component - Displays dynamic totals
function InvisalignKPICards({ enabled = true }: { enabled?: boolean }) {
  // Get date range from global filter
  const { dateRange, selectedDateRangeId } = useFilters();
  const { selectedLocationId, selectedRegionId } = useFilters();

  // Debug: Log date range changes
  useEffect(() => {
    if (enabled) {
      console.log('[InvisalignKPICards] Date range changed:', {
        rangeId: selectedDateRangeId,
        startDate: dateRange.startDate.toISOString(),
        endDate: dateRange.endDate.toISOString()
      });
    }
  }, [dateRange, selectedDateRangeId, enabled]);

  // Format currency helper
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const { data: invisalignProviders, isLoading: isLoadingProviders, isError: isErrorProviders } = useInvisalignProviders(enabled ? dateRange.startDate : null, enabled ? dateRange.endDate : null, enabled);
  const { data: locationData, isLoading: isLoadingLocations, isError: isErrorLocations } = useInvisalignByLocation(enabled);

  // Get targets from treatment_goal_targets for "Smilelign" category
  // Query for current month targets using 'M-YYYY' format (e.g., '1-2026')
  const { organizationId } = useOrganization();
  const now = new Date();
  // Format as 'M-YYYY' (e.g., '1-2026' for January 2026)
  const currentMonthStr = `${now.getMonth() + 1}-${now.getFullYear()}`;

  const { data: smilelignTargetData, isLoading: isLoadingTargets } = useQuery({
    queryKey: ['invisalign_target', organizationId, 'Smilelign', currentMonthStr],
    queryFn: async () => {
      if (!organizationId) return null;

      console.log('[InvisalignKPICards] Querying for target:', {
        organizationId,
        categoryName: 'Smilelign',
        periodDate: currentMonthStr,
        periodType: 'month',
      });

      // Query for "Smilelign" category, current month, organization-wide (no location/region filter)
      const { data, error } = await (supabase as any)
        .from('treatment_goal_targets')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('category_name', 'Smilelign')
        .eq('period_type', 'month')
        .eq('period_date', currentMonthStr)
        .is('location_id', null)
        .is('region_id', null)
        .maybeSingle();

      if (error) {
        console.error('[InvisalignKPICards] Error fetching target:', error);
        return null;
      }

      if (!data) {
        console.warn('[InvisalignKPICards] No target found for:', {
          categoryName: 'Smilelign',
          periodDate: currentMonthStr,
          organizationId,
        });
        // Try to find any target for this category (fallback to most recent)
        // Order by updated_at to get the most recently updated target
        const { data: fallbackData } = await (supabase as any)
          .from('treatment_goal_targets')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('category_name', 'Smilelign')
          .eq('period_type', 'month')
          .is('location_id', null)
          .is('region_id', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackData) {
          console.log('[InvisalignKPICards] Found fallback target from different period:', fallbackData.period_date);
        }
        return fallbackData || null;
      }

      return data;
    },
    enabled: enabled && !!organizationId,
  });

  // Extract target values
  const targetData = new Map();
  if (smilelignTargetData) {
    targetData.set('Smilelign', {
      unitTarget: smilelignTargetData.unit_target ?? 0,
      avgAmountTarget: smilelignTargetData.avg_amount_target ?? 0,
    });
  }

  // Debug: Log target data
  useEffect(() => {
    if (!isLoadingTargets && enabled) {
      console.log('[InvisalignKPICards] Target data loaded:', {
        currentMonth: currentMonthStr,
        smilelignTargetData,
        smilelignTarget: targetData.get('Smilelign'),
        periodDate: smilelignTargetData?.period_date,
      });
    }
  }, [smilelignTargetData, isLoadingTargets, enabled, targetData, currentMonthStr]);

  // Calculate dynamic totals from providers data
  const actualCases = invisalignProviders?.reduce((sum, provider) => {
    const cases = Number(provider?.cases) || 0;
    return sum + (isNaN(cases) ? 0 : cases);
  }, 0) ?? 0;

  const actualRevenue = invisalignProviders?.reduce((sum, provider) => {
    const revenue = Number(provider?.revenue) || 0;
    return sum + (isNaN(revenue) ? 0 : revenue);
  }, 0) ?? 0;

  // Calculate weighted average conversion rate from providers (weighted by cases)
  // This gives more weight to providers with more cases
  const totalCasesForConversion = invisalignProviders?.reduce((sum, p) => {
    const cases = Number(p?.cases) || 0;
    return sum + (isNaN(cases) ? 0 : cases);
  }, 0) ?? 0;

  const weightedConversion = invisalignProviders && totalCasesForConversion > 0
    ? invisalignProviders.reduce((sum, p) => {
      const conversion = Number(p?.conversion) || 0;
      const cases = Number(p?.cases) || 0;
      return sum + (isNaN(conversion) || isNaN(cases) ? 0 : conversion * cases);
    }, 0) / totalCasesForConversion
    : 0;
  const actualConversionRate = isNaN(weightedConversion) ? 0 : Math.round(weightedConversion * 10) / 10;

  // Calculate average case value
  const actualAvgCaseValue = actualCases > 0 && !isNaN(actualRevenue) && !isNaN(actualCases)
    ? actualRevenue / actualCases
    : 0;

  // Get targets from treatment_goal_targets for "Smilelign" category
  const smilelignTarget = targetData.get('Smilelign');
  const targetCases = smilelignTarget?.unitTarget ?? 0;
  const targetRevenue = smilelignTarget?.avgAmountTarget ?? 0;
  const targetConversionRate = 0;

  // Calculate gaps
  const casesGap = actualCases - targetCases;
  const conversionGap = actualConversionRate - targetConversionRate;

  const isLoading = isLoadingProviders || isLoadingLocations || isLoadingTargets;
  const hasError = isErrorProviders || isErrorLocations;
  const hasNoData = !isLoading && !hasError && (!invisalignProviders || invisalignProviders.length === 0);

  const displayCases = actualCases;
  const displayRevenue = actualRevenue;
  const displayConversion = actualConversionRate;
  const displayAvgCaseValue = actualAvgCaseValue;
  const displayCasesGap = casesGap;
  const displayConversionGap = conversionGap;

  return (
    <>
      {hasNoData && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">No Invisalign data available for the selected period. Completed treatments will appear here once synced from Dentally.</p>
        </div>
      )}
      <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-xl p-6 border border-blue-500/20">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <span className="text-2xl">💎</span> Invisalign Programme
            </h2>
            <p className="text-muted-foreground mt-1">End-to-end performance tracking and growth strategies</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Target Achievement</div>
              <div className="text-2xl font-bold text-foreground">
                {targetCases > 0 ? ((displayCases / targetCases) * 100).toFixed(0) : 0}%
              </div>
            </div>
            <div className="w-24">
              <ProgressBar
                value={displayCases}
                max={targetCases}
                variant={displayCases >= targetCases * 0.8 ? 'success' : 'warning'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Invisalign KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Target className="w-4 h-4" />
              <span>Cases (Actual vs Target)</span>
            </div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{displayCases}</span>
                  <span className="text-muted-foreground">/ {targetCases}</span>
                </div>
                <div className="text-sm text-destructive mt-1">
                  Gap: {displayCasesGap} cases
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Revenue (Actual vs Target)</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{formatCurrency(displayRevenue)}</span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Target: {formatCurrency(targetRevenue)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Conversion Rate</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{displayConversion.toFixed(1)}%</span>
                  <span className="text-muted-foreground">/ {targetConversionRate}%</span>
                </div>
                <div className="text-sm text-destructive mt-1">
                  Gap: {displayConversionGap.toFixed(1)}%
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Avg Case Value</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold text-foreground">{formatCurrency(displayAvgCaseValue)}</div>
                <TrendIndicator value={6.8} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// Implant By Type Card Component - Displays dynamic performance by implant type
function ImplantByTypeCard({ enabled = true }: { enabled?: boolean }) {
  const { data: implantByTypeData, isLoading, isError, error } = useImplantByType(enabled);

  // Format currency helper
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const hasRealData = implantByTypeData && implantByTypeData.length > 0;
  const hasNoData = !isLoading && !isError && !hasRealData;

  const chartData = hasRealData ? implantByTypeData : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Implant Type</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading implant type performance data...
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No implant type data available for the selected period.
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load implant type performance data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="type" width={100} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="actual" name="Actual" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="target" name="Target" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {chartData.map((type) => (
                <div key={type.type} className="text-xs p-2 bg-muted/30 rounded">
                  <div className="font-medium text-foreground">{type.type}</div>
                  <div className="text-muted-foreground">{formatCurrency(type.revenue)} • Avg: {formatCurrency(type.avgValue)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-2">No implant type performance data found.</p>
            <p className="text-sm mb-2">
              Make sure treatments have type_of_treatment = "implant" set in Treatment Settings.
            </p>
          </div>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="type" width={100} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="actual" name="Actual" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="target" name="Target" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {chartData.map((type) => (
                <div key={type.type} className="text-xs p-2 bg-muted/30 rounded">
                  <div className="font-medium text-foreground">{type.type}</div>
                  <div className="text-muted-foreground">{formatCurrency(type.revenue)} • Avg: {formatCurrency(type.avgValue)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Implant Monthly Trend Card Component - Displays dynamic monthly trends
function ImplantMonthlyTrendCard({ enabled = true }: { enabled?: boolean }) {
  const { data: monthlyTrendsData, isLoading, isError, error } = useImplantMonthlyTrends(enabled);

  const hasRealData = monthlyTrendsData && monthlyTrendsData.length > 0;
  const chartData = hasRealData ? monthlyTrendsData : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Performance Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading monthly trend data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load monthly trend data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No implant monthly trend data available for the selected period.
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-2">No monthly trend data found.</p>
            <p className="text-sm mb-2">
              Make sure treatments have type_of_treatment = "implant" set in Treatment Settings.
            </p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="consultations" name="Consultations" fill="hsl(var(--chart-3))" fillOpacity={0.2} stroke="hsl(var(--chart-3))" />
                <Bar dataKey="actual" name="Actual Cases" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="target" name="Target" stroke="hsl(var(--chart-2))" strokeWidth={2} strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Implant Pipeline Card Component - Displays dynamic pipeline data
function ImplantPipelineCard({ enabled = true }: { enabled?: boolean }) {
  const { data: pipelineData, isLoading, isError, error } = useImplantPipeline(enabled);

  // Calculate month-to-date date range for display
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const formatDateRange = () => {
    const start = startOfMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = endOfMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const consultationsBooked = pipelineData?.consultationsBooked || 0;
  const consultationsCompleted = pipelineData?.consultationsCompleted || 0;
  const ctScansCompleted = pipelineData?.ctScansCompleted || 0;
  const treatmentPlansPresented = pipelineData?.treatmentPlansPresented || 0;
  const treatmentPlansAccepted = pipelineData?.treatmentPlansAccepted || 0;
  const surgeriesScheduled = pipelineData?.surgeriesScheduled || 0;
  const inProgress = pipelineData?.inProgress || 0;
  const completed = pipelineData?.completed || 0;
  const hasNoData = !isLoading && !isError && !pipelineData;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Surgical Pipeline</CardTitle>
          <span className="text-xs text-muted-foreground">
            MTD: {formatDateRange()} | All Time: Cumulative
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading pipeline data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load pipeline data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No implant pipeline data available for the selected period.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Consultations Booked</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-foreground">{consultationsBooked}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Consultations Completed</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-foreground">{consultationsCompleted}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">CT Scans Completed</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-foreground">{ctScansCompleted}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Treatment Plans Presented</span>
                <span className="text-xs text-muted-foreground block">(All Time)</span>
              </div>
              <span className="font-bold text-foreground">{treatmentPlansPresented}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div>
                <span className="text-sm font-medium text-foreground">Plans Accepted</span>
                <span className="text-xs text-muted-foreground block">(All Time)</span>
              </div>
              <span className="font-bold text-amber-600">{treatmentPlansAccepted}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div>
                <span className="text-sm font-medium text-foreground">Surgeries Scheduled</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-green-600">{surgeriesScheduled}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="text-center p-3 bg-amber-500/10 rounded-lg">
                <div className="text-2xl font-bold text-amber-600">{inProgress}</div>
                <div className="text-xs text-muted-foreground">In Progress</div>
                <div className="text-xs text-muted-foreground">(All Time)</div>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{completed}</div>
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-xs text-muted-foreground">(All Time)</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Implant KPI Cards Component - Displays dynamic totals
function ImplantKPICards({ enabled = true }: { enabled?: boolean }) {
  // Get date range from global filter
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();

  // Format currency helper
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const { data: implantSurgeons, isLoading: isLoadingSurgeons, isError: isErrorSurgeons } = useImplantSurgeons(dateRange.startDate, dateRange.endDate, enabled);

  // Get targets from treatment_goal_targets for "Implants - Luke" category
  // Query for current month targets using 'M-YYYY' format (e.g., '1-2026')
  const { organizationId } = useOrganization();
  const now = new Date();
  // Format as 'M-YYYY' (e.g., '1-2026' for January 2026)
  const currentMonthStr = `${now.getMonth() + 1}-${now.getFullYear()}`;

  const { data: implantsTargetData, isLoading: isLoadingTargets } = useQuery({
    queryKey: ['implant_target', organizationId, 'Implants - Luke', currentMonthStr],
    queryFn: async () => {
      if (!organizationId) return null;

      console.log('[ImplantKPICards] Querying for target:', {
        organizationId,
        categoryName: 'Implants - Luke',
        periodDate: currentMonthStr,
        periodType: 'month',
      });

      // Query for "Implants - Luke" category, current month, organization-wide (no location/region filter)
      const { data, error } = await (supabase as any)
        .from('treatment_goal_targets')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('category_name', 'Implants - Luke')
        .eq('period_type', 'month')
        .eq('period_date', currentMonthStr)
        .is('location_id', null)
        .is('region_id', null)
        .maybeSingle();

      if (error) {
        console.error('[ImplantKPICards] Error fetching target:', error);
        return null;
      }

      if (!data) {
        console.warn('[ImplantKPICards] No target found for:', {
          categoryName: 'Implants - Luke',
          periodDate: currentMonthStr,
          organizationId,
        });
        // Try to find any target for this category (fallback to most recent)
        // Order by updated_at to get the most recently updated target
        const { data: fallbackData } = await (supabase as any)
          .from('treatment_goal_targets')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('category_name', 'Implants - Luke')
          .eq('period_type', 'month')
          .is('location_id', null)
          .is('region_id', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackData) {
          console.log('[ImplantKPICards] Found fallback target from different period:', fallbackData.period_date);
        }
        return fallbackData || null;
      }

      return data;
    },
    enabled: !!organizationId,
  });

  // Extract target values
  const targetData = new Map();
  if (implantsTargetData) {
    targetData.set('Implants - Luke', {
      unitTarget: implantsTargetData.unit_target ?? 0,
      avgAmountTarget: implantsTargetData.avg_amount_target ?? 0,
    });
  }

  // Debug: Log target data
  useEffect(() => {
    if (!isLoadingTargets) {
      console.log('[ImplantKPICards] Target data loaded:', {
        currentMonth: currentMonthStr,
        implantsTargetData,
        implantsTarget: targetData.get('Implants - Luke'),
        periodDate: implantsTargetData?.period_date,
      });
    }
  }, [implantsTargetData, isLoadingTargets, targetData, currentMonthStr]);

  // Calculate dynamic totals from surgeons data
  const actualCases = implantSurgeons?.reduce((sum, surgeon) => {
    const cases = Number(surgeon?.cases) || 0;
    return sum + (isNaN(cases) ? 0 : cases);
  }, 0) ?? 0;

  const actualRevenue = implantSurgeons?.reduce((sum, surgeon) => {
    const revenue = Number(surgeon?.revenue) || 0;
    return sum + (isNaN(revenue) ? 0 : revenue);
  }, 0) ?? 0;

  // Calculate weighted average conversion rate from surgeons (weighted by cases)
  // This gives more weight to surgeons with more cases
  const totalCasesForConversion = implantSurgeons?.reduce((sum, s) => {
    const cases = Number(s?.cases) || 0;
    return sum + (isNaN(cases) ? 0 : cases);
  }, 0) ?? 0;

  const weightedConversion = implantSurgeons && totalCasesForConversion > 0
    ? implantSurgeons.reduce((sum, s) => {
      const conversion = Number(s?.conversion) || 0;
      const cases = Number(s?.cases) || 0;
      return sum + (isNaN(conversion) || isNaN(cases) ? 0 : conversion * cases);
    }, 0) / totalCasesForConversion
    : 0;
  const actualConversionRate = isNaN(weightedConversion) ? 0 : Math.round(weightedConversion * 10) / 10;

  // Calculate average case value
  const actualAvgCaseValue = actualCases > 0 && !isNaN(actualRevenue) && !isNaN(actualCases)
    ? actualRevenue / actualCases
    : 0;

  // Get targets from treatment_goal_targets for "Implants - Luke" category
  const implantsTarget = targetData.get('Implants - Luke');
  const targetCases = implantsTarget?.unitTarget ?? 0;
  // avgAmountTarget is the total revenue target, not average per unit
  const targetRevenue = implantsTarget?.avgAmountTarget ?? 0;
  const targetConversionRate = 0;

  // Calculate gaps
  const casesGap = actualCases - targetCases;
  const conversionGap = actualConversionRate - targetConversionRate;

  const isLoading = isLoadingSurgeons || isLoadingTargets;
  const hasError = isErrorSurgeons;
  const hasNoData = !isLoading && !hasError && (!implantSurgeons || implantSurgeons.length === 0);

  const displayCases = actualCases;
  const displayRevenue = actualRevenue;
  const displayConversion = actualConversionRate;
  const displayAvgCaseValue = actualAvgCaseValue;
  const displayCasesGap = casesGap;
  const displayConversionGap = conversionGap;

  return (
    <>
      {hasNoData && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">No implant data available for the selected period. Completed treatments will appear here once synced from Dentally.</p>
        </div>
      )}
      <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 rounded-xl p-6 border border-amber-500/20">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <span className="text-2xl">🦷</span> Dental Implant Programme
            </h2>
            <p className="text-muted-foreground mt-1">Surgical implant performance and growth opportunities</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Target Achievement</div>
              <div className="text-2xl font-bold text-foreground">
                {targetCases > 0 ? ((displayCases / targetCases) * 100).toFixed(0) : 0}%
              </div>
            </div>
            <div className="w-24">
              <ProgressBar
                value={displayCases}
                max={targetCases}
                variant={displayCases >= targetCases * 0.8 ? 'success' : 'warning'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Implant KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Target className="w-4 h-4" />
              <span>Cases (Actual vs Target)</span>
            </div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{displayCases}</span>
                  <span className="text-muted-foreground">/ {targetCases}</span>
                </div>
                <div className="text-sm text-destructive mt-1">
                  Gap: {displayCasesGap} cases
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Revenue (Actual vs Target)</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{formatCurrency(displayRevenue)}</span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Target: {formatCurrency(targetRevenue)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Conversion Rate</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{displayConversion.toFixed(1)}%</span>
                  <span className="text-muted-foreground">/ {targetConversionRate}%</span>
                </div>
                <div className="text-sm text-destructive mt-1">
                  Gap: {displayConversionGap.toFixed(1)}%
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">Avg Case Value</div>
            {isLoading ? (
              <div className="py-4">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold text-foreground">{formatCurrency(displayAvgCaseValue)}</div>
                <TrendIndicator value={12.5} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// Invisalign Monthly Trend Card Component - Displays dynamic monthly trends
function InvisalignMonthlyTrendCard({ enabled = true }: { enabled?: boolean }) {
  const { data: monthlyTrendsData, isLoading, isError, error } = useInvisalignMonthlyTrends(enabled);

  const hasRealData = monthlyTrendsData && monthlyTrendsData.length > 0;
  const chartData = hasRealData ? monthlyTrendsData : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Performance vs Target</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading monthly trend data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load monthly trend data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No Invisalign monthly trend data available for the selected period.
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-2">No monthly trend data found.</p>
            <p className="text-sm mb-2">
              Make sure treatments have type_of_treatment = "invisalign" set in Treatment Settings.
            </p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="consultations" name="Consultations" fill="hsl(var(--chart-3))" fillOpacity={0.2} stroke="hsl(var(--chart-3))" />
                <Bar dataKey="actual" name="Actual Cases" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="target" name="Target" stroke="hsl(var(--chart-2))" strokeWidth={2} strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Invisalign Pipeline Card Component - Displays dynamic pipeline data
function InvisalignPipelineCard({ enabled = true }: { enabled?: boolean }) {
  const { data: pipelineData, isLoading, isError, error } = useInvisalignPipeline(enabled);

  // Calculate month-to-date date range for display
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const formatDateRange = () => {
    const start = startOfMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = endOfMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const consultationsBooked = pipelineData?.consultationsBooked || 0;
  const consultationsCompleted = pipelineData?.consultationsCompleted || 0;
  const treatmentPlansPresented = pipelineData?.treatmentPlansPresented || 0;
  const treatmentPlansAccepted = pipelineData?.treatmentPlansAccepted || 0;
  const inProgress = pipelineData?.inProgress || 0;
  const completed = pipelineData?.completed || 0;
  const hasNoData = !isLoading && !isError && !pipelineData;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sales Pipeline</CardTitle>
          <span className="text-xs text-muted-foreground">
            MTD: {formatDateRange()} | All Time: Cumulative
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading pipeline data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load pipeline data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No Invisalign pipeline data available for the selected period.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Consultations Booked</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-foreground">{consultationsBooked}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Consultations Completed</span>
                <span className="text-xs text-muted-foreground block">(Month to Date)</span>
              </div>
              <span className="font-bold text-foreground">{consultationsCompleted}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">Treatment Plans Presented</span>
                <span className="text-xs text-muted-foreground block">(All Time)</span>
              </div>
              <span className="font-bold text-foreground">{treatmentPlansPresented}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div>
                <span className="text-sm font-medium text-foreground">Plans Accepted (This Month)</span>
                <span className="text-xs text-muted-foreground block">(All Time)</span>
              </div>
              <span className="font-bold text-blue-600">{treatmentPlansAccepted}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="text-center p-3 bg-amber-500/10 rounded-lg">
                <div className="text-2xl font-bold text-amber-600">{inProgress}</div>
                <div className="text-xs text-muted-foreground">In Progress</div>
                <div className="text-xs text-muted-foreground">(All Time)</div>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{completed}</div>
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-xs text-muted-foreground">(All Time)</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Invisalign Location Performance Card Component
function InvisalignLocationPerformanceCard({ enabled = true }: { enabled?: boolean }) {
  const { data: locationData, isLoading, isError, error } = useInvisalignByLocation(enabled);
  const { allAvailableLocations: allLocations } = useLocations();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const hasRealData = locationData && locationData.length > 0;
  const locations = hasRealData ? locationData : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Location</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading location performance data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load location performance data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No Invisalign location performance data available for the selected period.
          </div>
        ) : locations.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-2">No location performance data found.</p>
            <p className="text-sm mb-2">
              {allLocations.length === 0
                ? 'No locations found. Please sync locations from Dentally in Settings.'
                : 'No invisalign treatment plan items found for the current month.'}
            </p>
            {allLocations.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Found {allLocations.length} location(s) in database. Check browser console (F12) for diagnostics.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 font-medium text-muted-foreground">Location</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Actual</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Target</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Gap</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Conversion</th>
                  <th className="py-3 font-medium text-muted-foreground w-32">Progress</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => (
                  <tr key={loc.locationId} className="border-b border-border/50">
                    <td className="py-3 font-medium text-foreground">{loc.location}</td>
                    <td className="py-3 text-right text-foreground">{loc.actual}</td>
                    <td className="py-3 text-right text-muted-foreground">{loc.target}</td>
                    <td className="py-3 text-right text-destructive font-medium">{loc.gap}</td>
                    <td className="py-3 text-right text-foreground">{formatCurrency(loc.revenue)}</td>
                    <td className="py-3 text-right text-foreground">{loc.conversion}%</td>
                    <td className="py-3">
                      <ProgressBar value={loc.actual} max={loc.target} variant={loc.actual >= loc.target * 0.8 ? 'success' : 'warning'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Invisalign Providers Card Component - Displays dynamic invisalign provider data
function InvisalignProvidersCard({ enabled = true }: { enabled?: boolean }) {
  // Get date range from global filter
  const { dateRange } = useFilters();

  const { data: invisalignProviders, isLoading, isError, error } = useInvisalignProviders(enabled ? dateRange.startDate : null, enabled ? dateRange.endDate : null, enabled);

  // Format date range for display
  const formatDateRange = () => {
    const start = dateRange.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = dateRange.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const hasRealData = invisalignProviders && invisalignProviders.length > 0;
  const providers = hasRealData ? invisalignProviders : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Top Providers</CardTitle>
          <span className="text-xs text-muted-foreground">
            ({formatDateRange()})
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading invisalign providers data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load invisalign providers data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No Invisalign provider data available for the selected period.
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((provider, idx) => (
              <div key={provider.providerId} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{provider.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {provider.cases} cases • {provider.conversion}% conversion
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-foreground">
                    {formatCurrency(provider.revenue)}
                  </div>
                  {provider.rating && (
                    <div className="text-xs text-amber-500">⭐ {provider.rating}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Implant Location Performance Card Component
function ImplantLocationPerformanceCard({ enabled = true }: { enabled?: boolean }) {
  const { data: locationData, isLoading, isError, error } = useImplantSurgeonsByLocation(enabled);
  const { allAvailableLocations: allLocations } = useLocations();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Debug logging
  console.log('[ImplantLocationPerformanceCard] State:', {
    isLoading,
    isError,
    locationDataLength: locationData?.length || 0,
    allLocationsLength: allLocations?.length || 0,
    locationData: locationData,
  });

  const hasRealData = locationData && locationData.length > 0;
  const locations = hasRealData ? locationData : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Location</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading location performance data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load location performance data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No implant location performance data available for the selected period.
          </div>
        ) : locations.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-2">No location performance data found.</p>
            <p className="text-sm mb-2">
              {allLocations.length === 0
                ? 'No locations found. Please sync locations from Dentally in Settings.'
                : 'No implant treatment plan items found for the current month.'}
            </p>
            {allLocations.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Found {allLocations.length} location(s) in database. Check browser console (F12) for diagnostics.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 font-medium text-muted-foreground">Location</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Actual</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Target</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Gap</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 font-medium text-muted-foreground">Conversion</th>
                  <th className="py-3 font-medium text-muted-foreground w-32">Progress</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => (
                  <tr key={loc.locationId} className="border-b border-border/50">
                    <td className="py-3 font-medium text-foreground">{loc.location}</td>
                    <td className="py-3 text-right text-foreground">{loc.actual}</td>
                    <td className="py-3 text-right text-muted-foreground">{loc.target}</td>
                    <td className="py-3 text-right text-destructive font-medium">{loc.gap}</td>
                    <td className="py-3 text-right text-foreground">{formatCurrency(loc.revenue)}</td>
                    <td className="py-3 text-right text-foreground">{loc.conversion}%</td>
                    <td className="py-3">
                      <ProgressBar value={loc.actual} max={loc.target} variant={loc.actual >= loc.target * 0.8 ? 'success' : 'warning'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Implant Surgeons Card Component - Displays dynamic implant surgeon data
function ImplantSurgeonsCard({ enabled = true }: { enabled?: boolean }) {
  // Get date range from global filter
  const { dateRange } = useFilters();

  const { data: implantSurgeons, isLoading, isError, error } = useImplantSurgeons(dateRange.startDate, dateRange.endDate, enabled);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Format date range for display
  const formatDateRange = () => {
    const start = dateRange.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = dateRange.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const hasRealData = implantSurgeons && implantSurgeons.length > 0;
  const surgeons = hasRealData ? implantSurgeons : [];
  const hasNoData = !isLoading && !isError && !hasRealData;

  // Debug logging
  console.log('[ImplantSurgeonsCard] State:', {
    isLoading,
    isError,
    hasRealData,
    implantSurgeonsLength: implantSurgeons?.length || 0,
    implantSurgeons: implantSurgeons,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Implant Surgeons</CardTitle>
          <span className="text-xs text-muted-foreground">
            ({formatDateRange()})
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading implant surgeons data...
          </div>
        ) : isError ? (
          <div className="py-8 text-center text-destructive text-sm">
            Could not load implant surgeons data.
            {error?.message && <span className="block mt-2 text-muted-foreground">{error.message}</span>}
          </div>
        ) : hasNoData ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            No implant surgeon data available for the selected period.
          </div>
        ) : surgeons.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <div className="mb-4">
              <p className="font-medium mb-2">No implant surgeons data found.</p>
              <p className="text-sm mb-3">Check the browser console (F12) for detailed diagnostics.</p>
              <p className="text-sm mb-3">To see real data, you need:</p>
              <ul className="mt-2 text-xs text-left inline-block space-y-1">
                <li>✓ Treatments with <code className="bg-muted px-1 rounded">type_of_treatment = 'implant'</code> <strong>AND</strong> <code className="bg-muted px-1 rounded">external_id</code> (from Dentally sync)</li>
                <li>✓ Invoice line items with <code className="bg-muted px-1 rounded">treatment_id</code> matching treatment <code className="bg-muted px-1 rounded">external_id</code></li>
                <li>✓ Providers with <code className="bg-muted px-1 rounded">external_id</code> matching invoice line item <code className="bg-muted px-1 rounded">practitioner_id</code></li>
                <li>✓ Treatment plan items linked via <code className="bg-muted px-1 rounded">treatment_plan_item_id</code></li>
              </ul>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="mt-2"
            >
              {showDiagnostics ? 'Hide' : 'Show'} Data Requirements
            </Button>
            {showDiagnostics && (
              <div className="mt-4 p-4 bg-muted/50 rounded-lg text-left text-xs space-y-2">
                <div>
                  <strong>Step 1:</strong> Go to <strong>"Treatment Settings"</strong> tab above
                  <br />
                  <span className="text-muted-foreground">→ Select "Implant" as treatment type</span>
                  <br />
                  <span className="text-muted-foreground">→ Select treatments and click "Save Treatment Type"</span>
                  <br />
                  <span className="text-muted-foreground text-amber-600">⚠️ Treatments must have <code className="bg-background px-1 rounded">external_id</code> from Dentally sync</span>
                </div>
                <div>
                  <strong>Step 2:</strong> Sync treatments from Dentally (if missing external_id)
                  <br />
                  <span className="text-muted-foreground">→ Run Dentally sync for treatments to populate <code className="bg-background px-1 rounded">external_id</code></span>
                  <br />
                  <span className="text-muted-foreground">→ The <code className="bg-background px-1 rounded">external_id</code> is used to match invoice line items</span>
                </div>
                <div>
                  <strong>Step 3:</strong> Ensure providers are synced from Dentally
                  <br />
                  <span className="text-muted-foreground">→ Providers need <code className="bg-background px-1 rounded">external_id</code> field populated</span>
                  <br />
                  <span className="text-muted-foreground">→ Provider <code className="bg-background px-1 rounded">external_id</code> must match invoice line item <code className="bg-background px-1 rounded">practitioner_id</code></span>
                </div>
                <div>
                  <strong>Step 4:</strong> Sync invoices from Dentally
                  <br />
                  <span className="text-muted-foreground">→ Invoice line items must have <code className="bg-background px-1 rounded">treatment_id</code> matching treatment <code className="bg-background px-1 rounded">external_id</code></span>
                  <br />
                  <span className="text-muted-foreground">→ Invoice line items must have <code className="bg-background px-1 rounded">practitioner_id</code> matching provider <code className="bg-background px-1 rounded">external_id</code></span>
                </div>
                <div>
                  <strong>Step 5:</strong> Link treatments via invoice line items
                  <br />
                  <span className="text-muted-foreground">→ Invoice line items connect <code className="bg-background px-1 rounded">treatment_id</code> to <code className="bg-background px-1 rounded">treatment_plan_item_id</code></span>
                  <br />
                  <span className="text-muted-foreground">→ Treatment plan items must have <code className="bg-background px-1 rounded">tpi_completed = true</code> for cases count</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {surgeons.map((surgeon, idx) => (
              <div key={surgeon.providerId} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{surgeon.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {surgeon.cases} cases • {surgeon.surgeries} surgeries • {surgeon.conversion}% conversion
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-foreground">
                    {formatCurrency(surgeon.revenue)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Year Picker Component
function MonthPicker({
  selectedDate,
  onSelect,
  currentYear,
  onYearChange,
  minYear = 2020,
  maxYear = 2030,
}: {
  selectedDate: Date | null;
  onSelect: (date: Date) => void;
  currentYear: number;
  onYearChange: (year: number) => void;
  minYear?: number;
  maxYear?: number;
}) {
  const months = [
    { value: 0, label: 'Jan' },
    { value: 1, label: 'Feb' },
    { value: 2, label: 'Mar' },
    { value: 3, label: 'Apr' },
    { value: 4, label: 'May' },
    { value: 5, label: 'Jun' },
    { value: 6, label: 'Jul' },
    { value: 7, label: 'Aug' },
    { value: 8, label: 'Sep' },
    { value: 9, label: 'Oct' },
    { value: 10, label: 'Nov' },
    { value: 11, label: 'Dec' },
  ];

  const selectedMonth = selectedDate?.getMonth() ?? null;
  const selectedYear = selectedDate?.getFullYear() ?? null;
  const isYearDisabled = (year: number) => year < minYear || year > maxYear;

  const handlePreviousYear = () => {
    if (!isYearDisabled(currentYear - 1)) {
      onYearChange(currentYear - 1);
    }
  };

  const handleNextYear = () => {
    if (!isYearDisabled(currentYear + 1)) {
      onYearChange(currentYear + 1);
    }
  };

  const handleMonthSelect = (month: number) => {
    const newDate = startOfMonth(new Date(currentYear, month, 1));
    onSelect(newDate);
  };

  const isMonthSelected = (month: number) => {
    return month === selectedMonth && currentYear === selectedYear;
  };

  return (
    <div className="p-4 w-[280px]">
      {/* Year Navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePreviousYear}
          className="h-8 w-8"
          disabled={isYearDisabled(currentYear - 1)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">
          {currentYear}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNextYear}
          className="h-8 w-8"
          disabled={isYearDisabled(currentYear + 1)}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Month Grid */}
      <div className="grid grid-cols-3 gap-2">
        {months.map((month) => {
          const selected = isMonthSelected(month.value);

          return (
            <Button
              key={month.value}
              variant={selected ? "default" : "outline"}
              className={cn(
                "h-10 w-full",
                selected && "bg-primary text-primary-foreground"
              )}
              onClick={() => handleMonthSelect(month.value)}
            >
              {month.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function YearPicker({
  selectedYear,
  onSelect,
  decade,
  onDecadeChange,
  minYear = 2020,
  maxYear = 2030,
}: {
  selectedYear: number;
  onSelect: (year: number) => void;
  decade: number;
  onDecadeChange: (decade: number) => void;
  minYear?: number;
  maxYear?: number;
}) {
  const years = [];
  for (let year = decade - 1; year <= decade + 10; year++) {
    years.push(year);
  }

  const isYearDisabled = (year: number) => year < minYear || year > maxYear;
  const isYearSelected = (year: number) => year === selectedYear;

  return (
    <div className="p-4 w-[280px]">
      {/* Decade Navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDecadeChange(decade - 10)}
          className="h-8 w-8"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">
          {decade}-{decade + 9}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDecadeChange(decade + 10)}
          className="h-8 w-8"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Year Grid */}
      <div className="grid grid-cols-3 gap-2">
        {years.map((year) => {
          const disabled = isYearDisabled(year);
          const selected = isYearSelected(year);

          return (
            <Button
              key={year}
              variant={selected ? "default" : "outline"}
              className={cn(
                "h-10 w-full",
                disabled && "opacity-50 cursor-not-allowed",
                selected && "bg-primary text-primary-foreground"
              )}
              onClick={() => {
                if (!disabled) {
                  onSelect(year);
                }
              }}
              disabled={disabled}
            >
              {year}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface TreatmentsProps {
  defaultTab?: string;
}

export default function Treatments({ defaultTab }: TreatmentsProps) {
  const { can } = usePermissions();
  const { showDecimals } = useOrganizationSettings();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<any>(null);
  const [selectedTreatmentType, setSelectedTreatmentType] = useState<string>('all');
  const [selectedTypeOfTreatment, setSelectedTypeOfTreatment] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<string>(defaultTab || 'treatments');

  // Treatment Settings state
  const [treatmentTypeSetting, setTreatmentTypeSetting] = useState<string>('');
  const [selectedTreatments, setSelectedTreatments] = useState<string[]>([]);
  const [treatmentSelectOpen, setTreatmentSelectOpen] = useState(false);
  const [treatmentSearchQuery, setTreatmentSearchQuery] = useState<string>('');
  const [isSavingTreatmentTypes, setIsSavingTreatmentTypes] = useState(false);
  const [treatmentSettingsDialogOpen, setTreatmentSettingsDialogOpen] = useState(false);
  const [editingTreatmentType, setEditingTreatmentType] = useState<string | null>(null); // Track which type we're editing
  const hasLoadedTreatmentsRef = useRef<string>(''); // Track which type we've loaded
  const treatmentDropdownRef = useRef<HTMLDivElement>(null);
  // Pagination state for treatment settings tables (per treatment type)
  const [treatmentSettingsPages, setTreatmentSettingsPages] = useState<Record<string, number>>({});
  const [isAutoMapping, setIsAutoMapping] = useState(false);
  const hasAutoMappedRef = useRef<string>(''); // Track if auto-map already ran for current treatments

  // Get filters first (needed for hooks below)
  const { selectedRegionId, selectedLocationId, setSelectedLocationId, dateRange: filterDateRange } = useFilters();

  // Treatment Goal Settings state
  const [periodType, setPeriodType] = useState<'month' | 'year'>('month');

  // Initialize dates based on period type
  const getDefaultActualPeriod = (type: 'month' | 'year'): Date => {
    const date = new Date();
    if (type === 'month') {
      // Current month
      date.setDate(1); // First day of the month
    } else {
      // Current year
      date.setMonth(0); // January
      date.setDate(1); // First day of the year
    }
    return date;
  };

  const getDefaultPlanningPeriod = (type: 'month' | 'year'): Date | null => {
    // No pre-selection - user must select Target Period
    return null;
  };

  const [actualPeriod, setActualPeriod] = useState<Date>(() => getDefaultActualPeriod('month'));
  const [planningPeriod, setPlanningPeriod] = useState<Date | null>(() => getDefaultPlanningPeriod('month'));
  // Load targets for the PLANNING period (Target Period) - this is what the user selects
  // Targets are saved for the Target Period that the user selects
  // Only query when planningPeriod is selected
  const { targets: loadedTargets, isLoading: isLoadingTargets, saveTargets, isSaving } = useTreatmentGoalTargets({
    period: planningPeriod || new Date(), // Use planningPeriod (Target Period) for saving targets, fallback to current date if null
    periodType,
    locationId: selectedLocationId,
    regionId: selectedRegionId,
  });

  const [goalTargets, setGoalTargets] = useState<Record<string, { unitTarget: number; avgAmountTarget: number }>>({});

  // Load targets when they're fetched from the database or when planningPeriod changes
  // Reset goalTargets when planningPeriod changes to load new targets for the new period
  useEffect(() => {
    // Reset goalTargets when planningPeriod changes to ensure we load fresh targets for the new period
    setGoalTargets({});
  }, [planningPeriod, periodType, selectedLocationId, selectedRegionId]);

  // Load targets when they're fetched from the database
  useEffect(() => {
    if (!isLoadingTargets && loadedTargets.size > 0) {
      // Load targets from database for the current actualPeriod
      setGoalTargets((prev) => {
        // If goalTargets is empty, load from database
        if (Object.keys(prev).length === 0) {
          const targetsObj: Record<string, { unitTarget: number; avgAmountTarget: number }> = {};
          loadedTargets.forEach((target, categoryName) => {
            targetsObj[categoryName] = target;
          });
          return targetsObj;
        }
        // Otherwise, merge with existing - only add new categories that don't exist
        const merged = { ...prev };
        loadedTargets.forEach((target, categoryName) => {
          if (!merged[categoryName]) {
            merged[categoryName] = target;
          }
        });
        return merged;
      });
    } else if (!isLoadingTargets && loadedTargets.size === 0 && Object.keys(goalTargets).length === 0) {
      // Only reset to empty if no targets found AND goalTargets is already empty
      setGoalTargets({});
    }
  }, [loadedTargets, isLoadingTargets]);

  // Handle save targets
  // IMPORTANT: This saves targets for the PLANNING PERIOD (Target Period) that the user selects
  // The saveTargets function from useTreatmentGoalTargets uses planningPeriod (passed via hook)
  const handleSaveTargets = async () => {
    if (!planningPeriod) {
      toast.error('Please select a Target Period before saving targets');
      return;
    }

    try {
      // Filter out null/empty targets - only save targets that have been explicitly set
      const targetsToSave: Record<string, { unitTarget: number; avgAmountTarget: number }> = {};
      Object.entries(goalTargets).forEach(([categoryName, target]) => {
        // Only include targets that have at least one non-null value
        if (target.unitTarget !== null && target.unitTarget !== undefined) {
          targetsToSave[categoryName] = {
            unitTarget: target.unitTarget,
            avgAmountTarget: target.avgAmountTarget ?? 0,
          };
        } else if (target.avgAmountTarget !== null && target.avgAmountTarget !== undefined) {
          targetsToSave[categoryName] = {
            unitTarget: 0,
            avgAmountTarget: target.avgAmountTarget,
          };
        }
      });

      console.log('[Treatments] Saving targets for planning period (Target Period):', {
        planningPeriod: format(planningPeriod, periodType === 'month' ? 'yyyy-MM' : 'yyyy'),
        periodType,
        targetsToSave,
      });
      await saveTargets(targetsToSave);
    } catch (error) {
      console.error('Failed to save targets:', error);
    }
  };
  const [actualPeriodOpen, setActualPeriodOpen] = useState(false);
  const [planningPeriodOpen, setPlanningPeriodOpen] = useState(false);
  const [actualYearDecade, setActualYearDecade] = useState(() => {
    const year = new Date().getFullYear();
    return Math.floor(year / 10) * 10;
  });
  const [planningYearDecade, setPlanningYearDecade] = useState(() => {
    const year = new Date().getFullYear();
    return Math.floor(year / 10) * 10;
  });
  const [actualMonthYear, setActualMonthYear] = useState(() => new Date().getFullYear());
  const [planningMonthYear, setPlanningMonthYear] = useState(() => new Date().getFullYear());

  const { uploadFile, processUpload } = useTreatmentUploads();
  const { regions, locations } = useLocations();
  const {
    categories,
    isLoading: isLoadingCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating,
    isUpdating,
    isDeleting,
  } = useTreatmentCategories();

  // Always load membership data - revenue overview cards depend on it regardless of active tab
  const isMembershipTabActive = activeTab === 'membership';
  const { data: membershipSummary, isLoading: isMembershipLoading, isError: isMembershipError, error: membershipError } = useMembershipPlanSummary(true);

  // Prefetch all tab data so it's ready when user switches tabs
  const isInvisalignTabActive = true;
  const isImplantTabActive = true;
  // useRevenueByType provides NHS/Private revenue from treatment-level classification (nhs_treatment_cat field)
  const { data: revenueByTypeData, isLoading: isRevenueLoading, isError: isRevenueError, error: revenueError } = useRevenueByType();

  // Log revenue query issues for debugging
  if (isRevenueError) {
    console.error('[Treatments] Revenue query error:', revenueError);
  }

  // Fetch all treatments for the multi-select dropdown
  const { treatments: allTreatments = [], isLoading: isLoadingTreatments, updateTreatment, batchUpdateTypeOfTreatment } = useTreatments({});

  // Store treatments length to avoid accessing allTreatments.length in dependency array
  const allTreatmentsLength = Array.isArray(allTreatments) ? allTreatments.length : 0;

  // Close treatment dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (treatmentDropdownRef.current && !treatmentDropdownRef.current.contains(event.target as Node)) {
        setTreatmentSelectOpen(false);
      }
    };
    if (treatmentSelectOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [treatmentSelectOpen]);

  // Auto-load assigned treatments when treatment type is selected manually
  // This only runs when user selects a type from dropdown (not when edit button is clicked)
  useEffect(() => {
    // Only run when dialog is open, treatment type is set, and treatments are loaded
    if (!treatmentSettingsDialogOpen || !treatmentTypeSetting || !allTreatments || allTreatments.length === 0) {
      return;
    }

    // Prevent loading if we've already loaded for this type
    const cacheKey = `${treatmentTypeSetting}-${allTreatments.length}`;
    if (hasLoadedTreatmentsRef.current === cacheKey) {
      return;
    }

    // Only auto-load if treatments are empty (user manually selected a type)
    // Don't override if treatments are already set (from edit button)
    if (selectedTreatments.length === 0) {
      try {
        // First, find treatments already assigned to this type_of_treatment
        let matchedIds = allTreatments
          .filter((treatment) => treatment?.type_of_treatment === treatmentTypeSetting)
          .map((treatment) => treatment.id)
          .filter(Boolean);

        // If none already assigned, fall back to matching by category name
        // e.g., selecting "implant" type will auto-select treatments in "Implants - Luke" category
        // Map treatment types to additional category keywords they should match
        const categoryKeywords: Record<string, string[]> = {
          invisalign: ['invisalign', 'smilelign'],
        };
        if (matchedIds.length === 0) {
          const typeLower = treatmentTypeSetting.toLowerCase();
          const keywords = categoryKeywords[typeLower] || [typeLower];
          matchedIds = allTreatments
            .filter((treatment) => {
              const categoryName = treatment?.category?.name?.toLowerCase() || '';
              return keywords.some((kw) => categoryName.includes(kw));
            })
            .map((treatment) => treatment.id)
            .filter(Boolean);
        }

        if (matchedIds.length > 0) {
          setSelectedTreatments(matchedIds);
          hasLoadedTreatmentsRef.current = cacheKey;
        }
      } catch (error) {
        console.error('Error loading treatments with type:', error);
      }
    }
    // Use length value instead of accessing allTreatments.length to avoid initialization issues
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentTypeSetting, treatmentSettingsDialogOpen, allTreatmentsLength]);

  // Auto-map treatment types based on treatment name, category, and fields
  const autoMapTreatmentType = (treatment: typeof allTreatments[0]): string => {
    const name = (treatment.treatment_name || '').toLowerCase();
    const desc = (treatment.description || '').toLowerCase();
    const categoryName = (treatment.category?.name || '').toLowerCase();
    const nomenclature = (treatment.nomenclature || '').toLowerCase();
    const patientDesc = (treatment.patient_description || '').toLowerCase();
    const searchText = `${name} ${desc} ${categoryName} ${nomenclature} ${patientDesc}`;

    // Priority 1: Implant keywords
    const implantKeywords = ['implant', 'bone graft', 'bone-graft', 'sinus lift', 'sinus-lift', 'abutment', 'all-on-4', 'all on 4', 'all-on-6', 'all on 6', 'implantology', 'osseointegr'];
    if (implantKeywords.some(kw => searchText.includes(kw))) {
      return 'implant';
    }

    // Priority 2: Invisalign keywords
    const invisalignKeywords = ['invisalign', 'aligner', 'smilelign', 'clear aligner', 'clear-aligner'];
    if (invisalignKeywords.some(kw => searchText.includes(kw))) {
      return 'invisalign';
    }

    // Priority 3: NHS - check treatment_type and nhs_treatment_cat
    if (treatment.treatment_type === 'nhs' || (treatment.nhs_treatment_cat && treatment.nhs_treatment_cat.trim() !== '')) {
      return 'nhs';
    }

    // Priority 4: Private (remaining private treatments)
    if (treatment.treatment_type === 'private') {
      return 'private';
    }

    // Fallback
    return 'other';
  };

  // Auto-map all unmapped treatments when treatment settings tab is active
  useEffect(() => {
    if (activeTab !== 'treatment-settings') return;
    if (!allTreatments || allTreatments.length === 0) return;
    if (isLoadingTreatments || isAutoMapping) return;

    // Check if we already ran auto-map for this set of treatments
    const cacheKey = `automap-${allTreatments.length}`;
    if (hasAutoMappedRef.current === cacheKey) return;

    // Find unmapped treatments
    const unmappedTreatments = allTreatments.filter(
      (t) => !t.type_of_treatment || t.type_of_treatment.trim() === ''
    );

    if (unmappedTreatments.length === 0) {
      hasAutoMappedRef.current = cacheKey;
      return;
    }

    // Run auto-mapping
    const runAutoMap = async () => {
      setIsAutoMapping(true);
      try {
        // Group unmapped treatments by their auto-detected type
        const typeGroups: Record<string, string[]> = {};
        unmappedTreatments.forEach((treatment) => {
          const detectedType = autoMapTreatmentType(treatment);
          if (!typeGroups[detectedType]) {
            typeGroups[detectedType] = [];
          }
          typeGroups[detectedType].push(treatment.id);
        });

        // Batch update each group
        for (const [type, ids] of Object.entries(typeGroups)) {
          if (ids.length > 0) {
            await batchUpdateTypeOfTreatment({
              treatmentIds: ids,
              typeOfTreatment: type,
            });
          }
        }

        hasAutoMappedRef.current = cacheKey;

        const summary = Object.entries(typeGroups)
          .map(([type, ids]) => `${ids.length} ${type}`)
          .join(', ');
        toast.success(`Auto-mapped ${unmappedTreatments.length} treatments`, {
          description: summary,
        });
      } catch (error: any) {
        console.error('Auto-map error:', error);
        toast.error('Failed to auto-map treatments');
      } finally {
        setIsAutoMapping(false);
      }
    };

    runAutoMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, allTreatmentsLength, isLoadingTreatments]);

  // Manual "Re-Map All" handler - re-maps ALL treatments (including already mapped ones)
  const handleAutoMapAll = async () => {
    if (!allTreatments || allTreatments.length === 0) return;

    setIsAutoMapping(true);
    try {
      const typeGroups: Record<string, string[]> = {};
      allTreatments.forEach((treatment) => {
        const detectedType = autoMapTreatmentType(treatment);
        if (!typeGroups[detectedType]) {
          typeGroups[detectedType] = [];
        }
        typeGroups[detectedType].push(treatment.id);
      });

      for (const [type, ids] of Object.entries(typeGroups)) {
        if (ids.length > 0) {
          await batchUpdateTypeOfTreatment({
            treatmentIds: ids,
            typeOfTreatment: type,
          });
        }
      }

      // Update cache so auto-effect doesn't re-run
      hasAutoMappedRef.current = `automap-${allTreatments.length}`;

      const summary = Object.entries(typeGroups)
        .map(([type, ids]) => `${ids.length} ${type}`)
        .join(', ');
      toast.success(`Re-mapped ${allTreatments.length} treatments`, {
        description: summary,
      });
    } catch (error: any) {
      console.error('Auto-map error:', error);
      toast.error('Failed to re-map treatments');
    } finally {
      setIsAutoMapping(false);
    }
  };

  // Fetch dynamic treatment goal stats for the actual period
  const { data: actualPeriodStats = [], isLoading: isLoadingActualStats, isError: isErrorActualStats, error: errorActualStats } = useTreatmentGoalStats({
    period: actualPeriod, // Actual Month (Current Month)
    periodType,
    locationId: selectedLocationId ?? undefined,
  });

  // Convert stats array to map for easy lookup
  const categoryStats = useMemo(() => {
    const statsMap: Record<string, { unitActual: number; totalRevenue: number; avgAmountActual: number }> = {};

    actualPeriodStats.forEach((stat) => {
      statsMap[stat.categoryName] = {
        unitActual: stat.unitActual,
        totalRevenue: stat.totalRevenue,
        avgAmountActual: stat.avgAmountActual,
      };
    });

    return statsMap;
  }, [actualPeriodStats]);

  // Get all unique category names from both actual stats and all treatments/categories
  const categoryNames = useMemo(() => {
    const names = new Set<string>();

    // Add categories from actual stats
    actualPeriodStats.forEach((stat) => {
      names.add(stat.categoryName);
    });

    // Add categories from treatments
    allTreatments.forEach((treatment) => {
      const categoryName = treatment.category?.name || 'Uncategorized';
      names.add(categoryName);
    });

    // Also include categories that might not have treatments yet
    categories.forEach((category) => {
      names.add(category.name);
    });

    return Array.from(names).sort();
  }, [actualPeriodStats, allTreatments, categories]);

  const formatCurrency = (value: number) => formatCurrencyBase(value, showDecimals);
  // Summary-tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) => formatCurrencyBase(value, false);

  // Revenue from invoices (platform_integration_invoices).
  // NHS = sum(nhs_amount), Total = sum(total_amount).
  // Membership revenue comes from useMembershipPlanSummary (payment-plan-based).
  // Private = Total invoice revenue - NHS - Membership (avoids double-counting).
  const nhsRevenueForDisplay = revenueByTypeData?.nhsRevenue ?? 0;
  const membershipRevenueForDisplay = membershipSummary?.membershipOnlyRevenue ?? 0;
  const totalInvoiceRevenue = revenueByTypeData?.totalTpiRevenue ?? 0;
  const privateRevenueForDisplay = Math.max(0, totalInvoiceRevenue - nhsRevenueForDisplay - membershipRevenueForDisplay);

  const { revenueByType, monthlyTrends, totalRevenue } = buildRevenueChartsData(
    nhsRevenueForDisplay,
    privateRevenueForDisplay,
    membershipRevenueForDisplay
  );

  const correctedTotalRevenue = totalInvoiceRevenue;
  const correctedNhsPercent = correctedTotalRevenue > 0 ? ((nhsRevenueForDisplay / correctedTotalRevenue) * 100).toFixed(1) + '%' : '0%';
  const correctedPrivatePercent = correctedTotalRevenue > 0 ? ((privateRevenueForDisplay / correctedTotalRevenue) * 100).toFixed(1) + '%' : '0%';
  const correctedMembershipPercent = correctedTotalRevenue > 0 ? ((membershipRevenueForDisplay / correctedTotalRevenue) * 100).toFixed(1) + '%' : '0%';

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const selectedLocationNameForAI = selectedLocationId
    ? (locations.find((l: any) => l.id === selectedLocationId)?.location_name ?? 'Selected Location')
    : 'All Locations';

  // Per-category rows from in-scope categoryStats
  const categoryRows = categoryNames
    .map((name) => {
      const stats = categoryStats[name] || { unitActual: 0, totalRevenue: 0, avgAmountActual: 0 };
      return {
        category: name,
        units: stats.unitActual,
        revenue: round2(stats.totalRevenue),
        avgAmount: round2(stats.avgAmountActual),
      };
    })
    .filter((r) => r.units > 0 || r.revenue > 0)
    .slice(0, 50);

  // Derive invisalign/implant cases by category name match (in-scope only)
  const matchByKeywords = (kws: string[]) =>
    categoryRows.filter((r) => {
      const lc = r.category.toLowerCase();
      return kws.some((k) => lc.includes(k));
    });

  const invisalignRows = matchByKeywords(['invisalign', 'aligner', 'smilelign']);
  const implantRows = matchByKeywords(['implant']);

  const invisalignCases = invisalignRows.reduce((s, r) => s + r.units, 0);
  const implantCases = implantRows.reduce((s, r) => s + r.units, 0);

  const membershipRowsForAI = (membershipSummary?.rows ?? []).slice(0, 50).map((m: any) => ({
    plan: m.plan_name ?? m.name ?? null,
    members: m.member_count ?? m.members ?? 0,
    monthlyRevenue: round2(m.monthly_revenue ?? m.revenue ?? 0),
  }));

  const treatmentsData = {
    nhsRevenue: round2(nhsRevenueForDisplay),
    privateRevenue: round2(privateRevenueForDisplay),
    membershipRevenue: round2(membershipRevenueForDisplay),
    totalRevenue: round2(correctedTotalRevenue),
    nhsPercent: correctedNhsPercent,
    privatePercent: correctedPrivatePercent,
    membershipPercent: correctedMembershipPercent,
    membershipMembers: membershipSummary?.totalMembers ?? 0,
    avgMemberValue: round2(membershipSummary?.avgMemberValue ?? 0),
    invisalignCases,
    implantCases,
    selectedLocationName: selectedLocationNameForAI,
    period: {
      from: filterDateRange.startDate.toISOString().slice(0, 10),
      to: filterDateRange.endDate.toISOString().slice(0, 10),
    },
    rows: {
      categories: categoryRows,
      membershipPlans: membershipRowsForAI,
    },
    rankings: {
      topCategoriesByRevenue: [...categoryRows].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      topCategoriesByVolume: [...categoryRows].sort((a, b) => b.units - a.units).slice(0, 10),
      nhsVsPrivateSplit: {
        nhs: round2(nhsRevenueForDisplay),
        private: round2(privateRevenueForDisplay),
        membership: round2(membershipRevenueForDisplay),
      },
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'treatments', data: treatmentsData }}>
      <Helmet>
        <title>Treatment Analytics</title>
        <meta name="description" content="Analyze treatment data, revenue by treatment type, membership plans, and treatment trends across locations." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Treatment Analysis</h1>
            <p className="text-muted-foreground mt-1">NHS, Private, and Membership income breakdown</p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={selectedLocationId ?? 'all'}
              onValueChange={(value) => {
                setSelectedLocationId(value === 'all' ? null : value);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.location_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {can('treatments', 'add', 'setup_treatments_tab') && (
              <Button
                onClick={() => {
                  setSelectedCategory(null);
                  setCategoryFormOpen(true);
                }}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Treatment Category
              </Button>
            )}
            {/* Upload Modal - Wider Width */}
            {can('treatments', 'import', 'setup_treatments_tab') && (
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Files
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-w-[40vw] w-[40vw]"
                style={{ maxWidth: '40vw', width: '40vw' } as React.CSSProperties}
              >
                <DialogHeader>
                  <DialogTitle>Upload Treatment Data</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-hidden min-h-0">
                  <TreatmentFileUpload
                    practiceId={null}
                    locationId={null}
                    onFileSelected={(file) => {
                      setSelectedFile(file);
                      setUploadDialogOpen(false);
                      setPreviewDialogOpen(true);
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
            )}

            {/* Preview Modal - Full Width */}
            <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
              <DialogContent
                className="full-width-dialog max-h-[90vh] overflow-hidden !flex !flex-col p-6"
                style={{ maxWidth: '98vw', width: '98vw' } as React.CSSProperties}
              >
                <DialogHeader>
                  <DialogTitle>Preview Treatment Data</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-hidden min-h-0">
                  {selectedFile && (
                    <TreatmentFilePreview
                      file={selectedFile}
                      onProcess={async (file: File) => {
                        try {
                          await uploadFile(file, null, selectedLocationId);
                          await processUpload(file, null, selectedLocationId, selectedRegionId);
                          setPreviewDialogOpen(false);
                          setSelectedFile(null);
                        } catch (error: any) {
                          console.error('Process error:', error);
                          throw error;
                        }
                      }}
                      onCancel={() => {
                        setPreviewDialogOpen(false);
                        setSelectedFile(null);
                      }}
                      categoryId={null}
                      locationId={selectedLocationId}
                      regionId={selectedRegionId}
                    />
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Treatment Category Form Dialog */}
        <TreatmentCategoryFormDialog
          open={categoryFormOpen}
          onOpenChange={setCategoryFormOpen}
          category={selectedCategory}
          locations={locations || []}
          regions={regions || []}
          onSubmit={async (data) => {
            try {
              if (selectedCategory) {
                await updateCategory({ ...data, id: selectedCategory.id });
              } else {
                await createCategory(data as Omit<import('@/types/treatment-category').TreatmentCategoryInsert, 'organization_id' | 'created_by'>);
              }
              setCategoryFormOpen(false);
              setSelectedCategory(null);
            } catch (error) {
              console.error('Error submitting category form:', error);
            }
          }}
          isLoading={isCreating || isUpdating}
        />

        {/* AI Summary */}
        <AISummaryCard page="treatments" data={treatmentsData} />

        {/* Summary Cards — dynamic from treatments + membership (Supabase) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Building className="w-4 h-4" />
                <span>NHS Revenue</span>
                <MetricHelp title="NHS Revenue">
                  Revenue from completed NHS treatments in the selected period. The
                  percentage shows NHS as a share of total treatment revenue.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrencyWhole(treatmentsData.nhsRevenue)}</div>
              <div className="text-xs text-muted-foreground">{treatmentsData.nhsPercent} of total</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Stethoscope className="w-4 h-4" />
                <span>Private Revenue</span>
                <MetricHelp title="Private Revenue">
                  Revenue from completed private (fee-per-item) treatments in the
                  selected period. The percentage shows private as a share of total
                  treatment revenue.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrencyWhole(treatmentsData.privateRevenue)}</div>
              <div className="text-xs text-muted-foreground">{treatmentsData.privatePercent} of total</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="w-4 h-4" />
                <span>Membership Revenue</span>
                <MetricHelp title="Membership Revenue">
                  Revenue from patient membership/plan subscriptions in the selected
                  period. The percentage shows membership as a share of total
                  treatment revenue.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrencyWhole(treatmentsData.membershipRevenue)}</div>
              <div className="text-xs text-muted-foreground">{correctedMembershipPercent} of total</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                <span>Total Revenue</span>
                <MetricHelp title="Total Revenue = NHS + Private + Membership">
                  All treatment revenue in the selected period — NHS, private and
                  membership income added together.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrencyWhole(correctedTotalRevenue)}</div>
              {correctedTotalRevenue > 0 ? (
                <div className="text-xs text-muted-foreground">NHS + Private + Membership</div>
              ) : (
                <div className="text-xs text-muted-foreground">No data yet</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Revenue Mix Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex items-center justify-center">
                {totalRevenue > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueByType.filter((d) => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                      >
                        {revenueByType.filter((d) => d.value > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center px-4">
                    No revenue data yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex items-center justify-center">
                {totalRevenue > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `£${(v / 1000000).toFixed(1)}M`} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="nhs" name="NHS" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="private" name="Private" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="membership" name="Membership" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center px-4">
                    No revenue data yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Treatment Tabs */}
        <Tabs defaultValue="treatments" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="treatments">Treatments</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="invisalign">Invisalign</TabsTrigger>
            <TabsTrigger value="implants">Implants</TabsTrigger>
            <TabsTrigger value="profitability">Profitability By Treatment</TabsTrigger>
            <TabsTrigger value="treatment-settings">Treatment Settings</TabsTrigger>
            <TabsTrigger value="treatment-goals">Treatments Goal Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="treatments" className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={selectedTreatmentType} onValueChange={(value) => {
                setSelectedTreatmentType(value);
                // Reset specialty filter when treatment type changes to avoid empty results from conflicting filters
                setSelectedTypeOfTreatment('all');
              }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="nhs">NHS</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedTypeOfTreatment} onValueChange={(value) => {
                setSelectedTypeOfTreatment(value);
                // Reset treatment type filter when specialty changes to avoid empty results from conflicting filters
                setSelectedTreatmentType('all');
              }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Specialties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Specialties</SelectItem>
                  <SelectItem value="invisalign">Invisalign</SelectItem>
                  <SelectItem value="implant">Implant</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TreatmentsList
              treatmentType={selectedTreatmentType === 'all' ? null : selectedTreatmentType as 'nhs' | 'private'}
              typeOfTreatment={selectedTypeOfTreatment === 'all' ? null : selectedTypeOfTreatment}
              categoryId={selectedCategoryFilter === 'all' ? null : selectedCategoryFilter}
            />
          </TabsContent>

          <TabsContent value="categories">
            <TreatmentCategoriesManagement
              categories={categories}
              locations={locations || []}
              regions={regions || []}
              onCreate={createCategory}
              onUpdate={updateCategory}
              onDelete={deleteCategory}
              isLoading={isLoadingCategories || isCreating || isUpdating || isDeleting}
            />
          </TabsContent>

          {/* MEMBERSHIP TAB — data from Supabase payment_plans table (pp_name, fee) + patients.pt_payment_plan_id for member counts */}
          <TabsContent value="membership" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Membership Plans</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isMembershipLoading ? (
                      <div className="py-8 text-center text-muted-foreground">Loading membership plans...</div>
                    ) : isMembershipError ? (
                      <div className="py-8 text-center text-destructive text-sm">
                        Could not load membership plans.
                        {membershipError?.message && <span className="block mt-2 text-muted-foreground">{membershipError.message}</span>}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Plan</th>
                              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Members</th>
                              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Revenue</th>
                              <th className="text-right py-3 px-4 font-medium text-muted-foreground">% of Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(membershipSummary?.rows ?? []).map((row) => {
                              const total = membershipSummary?.totalMonthlyRevenue ?? 0;
                              const percentOfTotal = total > 0 ? ((row.monthlyRevenue / total) * 100).toFixed(1) : '0.0';
                              return (
                                <tr key={row.planId} className="border-b border-border/50 hover:bg-muted/30">
                                  <td className="py-3 px-4 font-medium">{row.planName}</td>
                                  <td className="text-right py-3 px-4">{row.members.toLocaleString()}</td>
                                  <td className="text-right py-3 px-4">{formatCurrency(row.monthlyRevenue)}</td>
                                  <td className="text-right py-3 px-4">{percentOfTotal}%</td>
                                </tr>
                              );
                            })}
                            {(membershipSummary?.rows?.length ?? 0) === 0 && (
                              <tr>
                                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                                  No membership plans returned. Data is loaded from the <code className="text-xs bg-muted px-1 rounded">payment_plans</code> table. If you have rows in Supabase, Row Level Security may be hiding them — ensure your user has a row in <code className="text-xs bg-muted px-1 rounded">user_roles</code> for the organization that owns the plans.
                                </td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot>
                            <tr className="bg-muted/30 font-semibold">
                              <td className="py-3 px-4">Total</td>
                              <td className="text-right py-3 px-4">{(membershipSummary?.totalMembers ?? 0).toLocaleString()}</td>
                              <td className="text-right py-3 px-4">{formatCurrency(membershipSummary?.totalMonthlyRevenue ?? 0)}</td>
                              <td className="text-right py-3 px-4">100%</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle>Membership Health</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="pt-1 space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Members</span>
                        <span className="font-medium">{(membershipSummary?.totalMembers ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Revenue</span>
                        <span className="font-medium">{formatCurrency(membershipSummary?.totalMonthlyRevenue ?? 0)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-border">
                        <span className="text-muted-foreground">Avg Member Value</span>
                        <span className="font-medium">{formatCurrency(membershipSummary?.avgMemberValue ?? 0)}/mo</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* INVISALIGN SPECIALTY TAB */}
          <TabsContent value="invisalign" className="space-y-6">
            <InvisalignKPICards enabled={isInvisalignTabActive} />

            {/* Invisalign Charts & Pipeline */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Trend Chart */}
              <InvisalignMonthlyTrendCard enabled={isInvisalignTabActive} />

              {/* Pipeline */}
              <InvisalignPipelineCard enabled={isInvisalignTabActive} />
            </div>

            {/* By Location */}
            <InvisalignLocationPerformanceCard enabled={isInvisalignTabActive} />

            {/* Growth Strategies */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-amber-500" />
                    Growth Strategies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {invisalignGrowthStrategies.map((strategy) => (
                      <div key={strategy.strategy} className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-medium text-foreground">{strategy.strategy}</div>
                            <div className="flex items-center gap-3 mt-1 text-xs">
                              <span className={`px-2 py-0.5 rounded ${strategy.impact === 'High' ? 'bg-green-500/20 text-green-600' : 'bg-amber-500/20 text-amber-600'}`}>
                                {strategy.impact} Impact
                              </span>
                              <span className="text-muted-foreground">{strategy.effort} Effort</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant={
                              strategy.status === 'Active' ? 'default' :
                                strategy.status === 'In Progress' ? 'secondary' :
                                  strategy.status === 'Completed' ? 'outline' : 'secondary'
                            }>
                              {strategy.status}
                            </Badge>
                            <div className="text-sm font-medium text-green-600 mt-1">{strategy.potential}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <InvisalignProvidersCard enabled={isInvisalignTabActive} />
            </div>
          </TabsContent>

          {/* IMPLANTS SPECIALTY TAB */}
          <TabsContent value="implants" className="space-y-6">
            <ImplantKPICards enabled={isImplantTabActive} />

            {/* Implant Charts & Pipeline */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Type */}
              <ImplantByTypeCard enabled={isImplantTabActive} />

              {/* Surgical Pipeline */}
              <ImplantPipelineCard enabled={isImplantTabActive} />
            </div>

            {/* Monthly Trend */}
            <ImplantMonthlyTrendCard enabled={isImplantTabActive} />

            {/* By Location */}
            <ImplantLocationPerformanceCard enabled={isImplantTabActive} />

            {/* Growth Strategies & Providers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-green-500" />
                    Growth Strategies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {implantGrowthStrategies.map((strategy) => (
                      <div key={strategy.strategy} className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-medium text-foreground">{strategy.strategy}</div>
                            <div className="flex items-center gap-3 mt-1 text-xs">
                              <span className={`px-2 py-0.5 rounded ${strategy.impact === 'High' ? 'bg-green-500/20 text-green-600' : 'bg-amber-500/20 text-amber-600'}`}>
                                {strategy.impact} Impact
                              </span>
                              <span className="text-muted-foreground">{strategy.effort} Effort</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant={
                              strategy.status === 'Active' ? 'default' :
                                strategy.status === 'In Progress' ? 'secondary' :
                                  strategy.status === 'Completed' ? 'outline' : 'secondary'
                            }>
                              {strategy.status}
                            </Badge>
                            <div className="text-sm font-medium text-green-600 mt-1">{strategy.potential}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <ImplantSurgeonsCard enabled={isImplantTabActive} />
            </div>
          </TabsContent>

          <TabsContent value="profitability">
            <AllTreatmentsProfitabilityTab />
          </TabsContent>

          {/* TREATMENT SETTINGS TAB */}
          <TabsContent value="treatment-settings" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Treatment Settings</CardTitle>
                  <div className="flex items-center gap-2">
                    {can('treatments', 'update', 'setup_treatments_tab') && (
                      <Button
                        variant="outline"
                        onClick={handleAutoMapAll}
                        disabled={isAutoMapping || isLoadingTreatments || !allTreatments || allTreatments.length === 0}
                        className="gap-2"
                      >
                        {isAutoMapping ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Lightbulb className="w-4 h-4" />
                        )}
                        {isAutoMapping ? 'Mapping...' : 'Auto-Map All'}
                      </Button>
                    )}
                    {can('treatments', 'add', 'setup_treatments_tab') && (
                      <Button
                        onClick={() => {
                          // Reset to add mode
                          setEditingTreatmentType(null);
                          setTreatmentTypeSetting('');
                          setSelectedTreatments([]);
                          setTreatmentSearchQuery('');
                          setTreatmentSelectOpen(false);
                          hasLoadedTreatmentsRef.current = ''; // Reset cache
                          setTreatmentSettingsDialogOpen(true);
                        }}
                        className="gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Assign Treatment Type
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingTreatments || isAutoMapping ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    {isAutoMapping && (
                      <p className="text-sm text-muted-foreground">Auto-mapping treatments...</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {(() => {
                      // Filter treatments that have type_of_treatment assigned
                      if (!allTreatments || allTreatments.length === 0) {
                        return (
                          <div className="text-center py-12 text-muted-foreground">
                            <p>No treatments found. Start by assigning treatment types.</p>
                          </div>
                        );
                      }
                      const treatmentsWithType = allTreatments.filter(
                        (treatment) => treatment && treatment.type_of_treatment && treatment.type_of_treatment.trim() !== ''
                      );

                      // Group treatments by type_of_treatment (only those with assigned types)
                      const groupedTreatments = treatmentsWithType.reduce((acc, treatment) => {
                        const type = treatment.type_of_treatment!;
                        if (!acc[type]) {
                          acc[type] = [];
                        }
                        acc[type].push(treatment);
                        return acc;
                      }, {} as Record<string, typeof allTreatments>);

                      const treatmentTypeLabels: Record<string, string> = {
                        implant: 'Implant',
                        invisalign: 'Invisalign',
                        private: 'Private',
                        nhs: 'NHS',
                        other: 'Other',
                      };

                      const sortedTypes = Object.keys(groupedTreatments).sort((a, b) => {
                        return a.localeCompare(b);
                      });

                      if (sortedTypes.length === 0) {
                        return (
                          <div className="text-center py-12 text-muted-foreground">
                            <p>No treatments with assigned types found. Start by assigning treatment types.</p>
                          </div>
                        );
                      }

                      return sortedTypes.map((type) => {
                        const itemsPerPage = 10;
                        const currentPage = treatmentSettingsPages[type] || 1;
                        const totalPages = Math.ceil(groupedTreatments[type].length / itemsPerPage);
                        const startIndex = (currentPage - 1) * itemsPerPage;
                        const endIndex = startIndex + itemsPerPage;
                        const paginatedTreatments = groupedTreatments[type].slice(startIndex, endIndex);

                        const handlePageChange = (page: number) => {
                          setTreatmentSettingsPages((prev) => ({
                            ...prev,
                            [type]: page,
                          }));
                        };

                        const getPageNumbers = () => {
                          const pages: (number | string)[] = [];
                          const maxVisiblePages = 5;

                          if (totalPages <= maxVisiblePages) {
                            for (let i = 1; i <= totalPages; i++) {
                              pages.push(i);
                            }
                          } else {
                            pages.push(1);

                            if (currentPage > 3) {
                              pages.push('ellipsis-start');
                            }

                            const start = Math.max(2, currentPage - 1);
                            const end = Math.min(totalPages - 1, currentPage + 1);

                            for (let i = start; i <= end; i++) {
                              pages.push(i);
                            }

                            if (currentPage < totalPages - 2) {
                              pages.push('ellipsis-end');
                            }

                            pages.push(totalPages);
                          }

                          return pages;
                        };

                        return (
                          <div key={type} className="space-y-3">
                            <div className="flex items-center gap-2">
                              <h3 className="text-lg font-semibold text-foreground">
                                {treatmentTypeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1)}
                              </h3>
                              <Badge variant="secondary" className="text-xs">
                                {groupedTreatments[type].length} treatment{groupedTreatments[type].length !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                            <div className="border rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Treatment Name</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-right">Duration</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {paginatedTreatments.map((treatment) => (
                                    <TableRow key={treatment.id}>
                                      <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                          {treatment.treatment_name}
                                          {treatment.external_id && (
                                            <Badge variant="outline" className="text-xs">Dentally</Badge>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-muted-foreground">
                                        {treatment.treatment_code || '-'}
                                      </TableCell>
                                      <TableCell>
                                        {treatment.category?.name ? (
                                          <Badge variant="outline">{treatment.category.name}</Badge>
                                        ) : (
                                          '-'
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant={treatment.treatment_type === 'nhs' ? 'secondary' : 'default'}
                                        >
                                          {treatment.treatment_type.toUpperCase()}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {formatCurrency(treatment.private_price || treatment.nhs_price || treatment.price)}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {treatment.duration_minutes ? `${treatment.duration_minutes} min` : '-'}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            {totalPages > 1 && (
                              <Pagination className="mt-4">
                                <PaginationContent>
                                  <PaginationItem>
                                    <Button
                                      variant="ghost"
                                      size="default"
                                      onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                                      disabled={currentPage === 1}
                                      className="gap-1 pl-2.5"
                                    >
                                      <ChevronLeft className="h-4 w-4" />
                                      <span>Previous</span>
                                    </Button>
                                  </PaginationItem>
                                  {getPageNumbers().map((page, index) => {
                                    if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                                      return (
                                        <PaginationItem key={`ellipsis-${index}`}>
                                          <PaginationEllipsis />
                                        </PaginationItem>
                                      );
                                    }
                                    return (
                                      <PaginationItem key={page}>
                                        <Button
                                          variant={currentPage === page ? 'outline' : 'ghost'}
                                          size="icon"
                                          onClick={() => handlePageChange(page as number)}
                                          className="h-9 w-9"
                                        >
                                          {page}
                                        </Button>
                                      </PaginationItem>
                                    );
                                  })}
                                  <PaginationItem>
                                    <Button
                                      variant="ghost"
                                      size="default"
                                      onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                                      disabled={currentPage === totalPages}
                                      className="gap-1 pr-2.5"
                                    >
                                      <span>Next</span>
                                      <ChevronRight className="h-4 w-4" />
                                    </Button>
                                  </PaginationItem>
                                </PaginationContent>
                              </Pagination>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Treatment Settings Form Dialog */}
            <Dialog
              open={treatmentSettingsDialogOpen}
              onOpenChange={(open) => {
                setTreatmentSettingsDialogOpen(open);
                if (!open) {
                  // Reset state when dialog closes
                  setEditingTreatmentType(null);
                  setTreatmentTypeSetting('');
                  setSelectedTreatments([]);
                  setTreatmentSearchQuery('');
                  setTreatmentSelectOpen(false);
                  hasLoadedTreatmentsRef.current = ''; // Reset cache
                }
              }}
            >
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>
                    {editingTreatmentType ? 'Edit Treatment Type' : 'Assign Treatment Type'}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  {/* First Dropdown - Treatment Type Selector */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Treatment Type</label>
                    <Select
                      value={treatmentTypeSetting}
                      onValueChange={(value) => {
                        setTreatmentTypeSetting(value);
                        // Reset selected treatments - useEffect will auto-load if treatments exist for this type
                        setSelectedTreatments([]);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a treatment type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="implant">Implant</SelectItem>
                        <SelectItem value="invisalign">Invisalign</SelectItem>
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="nhs">NHS</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Second Dropdown - Treatment Selector (Multi-select with Tags) */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Select Treatments</label>

                    {/* Selected Treatments as Tags */}
                    {selectedTreatments.length > 0 && (
                      <div className="flex flex-wrap gap-1 p-1.5 max-h-[100px] overflow-y-auto border rounded-md bg-background">
                        {selectedTreatments.map((treatmentId) => {
                          const treatment = allTreatments.find((t) => t.id === treatmentId);
                          if (!treatment) return null;
                          return (
                            <Badge
                              key={treatmentId}
                              variant="secondary"
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium h-6"
                            >
                              <span className="truncate max-w-[150px]">
                                {treatment.treatment_name}
                                {treatment.treatment_code && (
                                  <span className="text-muted-foreground ml-0.5">({treatment.treatment_code})</span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTreatments((prev) => prev.filter((id) => id !== treatmentId));
                                }}
                                className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                                aria-label={`Remove ${treatment.treatment_name}`}
                              >
                                <X className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* Search Input and Dropdown */}
                    <div className="relative" ref={treatmentDropdownRef}>
                      <div className="flex items-center border rounded-md bg-background">
                        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search treatments..."
                          value={treatmentSearchQuery}
                          onChange={(e) => {
                            setTreatmentSearchQuery(e.target.value);
                            setTreatmentSelectOpen(true);
                          }}
                          onFocus={() => setTreatmentSelectOpen(true)}
                          className="flex h-10 w-full rounded-md border-0 bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!treatmentTypeSetting || isLoadingTreatments}
                        />
                        <button
                          type="button"
                          onClick={() => setTreatmentSelectOpen(!treatmentSelectOpen)}
                          className="absolute right-2 p-1 hover:bg-accent rounded-sm"
                          disabled={!treatmentTypeSetting || isLoadingTreatments}
                        >
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", treatmentSelectOpen && "rotate-180")} />
                        </button>
                      </div>
                      {treatmentSelectOpen && (
                        <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-md">
                          <div
                            className="overflow-y-auto overflow-x-hidden p-1"
                            style={{ maxHeight: '200px' }}
                          >
                            {isLoadingTreatments ? (
                              <div className="py-4 text-center text-sm text-muted-foreground">Loading treatments...</div>
                            ) : !allTreatments || allTreatments.length === 0 ? (
                              <div className="py-4 text-center text-sm text-muted-foreground">No treatments available</div>
                            ) : (() => {
                              const filtered = allTreatments.filter((treatment) => {
                                if (selectedTreatments.includes(treatment.id)) return false;
                                if (!treatmentSearchQuery) return true;
                                const query = treatmentSearchQuery.toLowerCase();
                                return (
                                  treatment.treatment_name?.toLowerCase().includes(query) ||
                                  treatment.treatment_code?.toLowerCase().includes(query) ||
                                  treatment.description?.toLowerCase().includes(query)
                                );
                              });
                              if (filtered.length === 0) {
                                return (
                                  <div className="py-4 text-center text-sm text-muted-foreground">
                                    {treatmentSearchQuery ? 'No treatments found.' : 'All treatments are selected'}
                                  </div>
                                );
                              }
                              return filtered.map((treatment) => (
                                <div
                                  key={treatment.id}
                                  className="flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-accent cursor-pointer"
                                  onClick={() => {
                                    setSelectedTreatments((prev) => [...prev, treatment.id]);
                                  }}
                                >
                                  <div className="flex-1">
                                    <div className="text-sm font-medium">
                                      {treatment.treatment_name}
                                    </div>
                                    {treatment.treatment_code && (
                                      <div className="text-xs text-muted-foreground">
                                        {treatment.treatment_code}
                                      </div>
                                    )}
                                  </div>
                                  <Plus className="h-4 w-4 text-muted-foreground" />
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {selectedTreatments.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {selectedTreatments.length} treatment{selectedTreatments.length > 1 ? 's' : ''} selected
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No treatments selected
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTreatmentSettingsDialogOpen(false);
                      setEditingTreatmentType(null);
                      setTreatmentTypeSetting('');
                      setSelectedTreatments([]);
                      setTreatmentSearchQuery('');
                      setTreatmentSelectOpen(false);
                      hasLoadedTreatmentsRef.current = ''; // Reset cache
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!treatmentTypeSetting) {
                        toast.error('Please select a treatment type');
                        return;
                      }
                      if (selectedTreatments.length === 0) {
                        toast.error('Please select at least one treatment');
                        return;
                      }

                      setIsSavingTreatmentTypes(true);
                      try {
                        // Save the type_of_treatment (e.g., 'implant', 'invisalign', 'private', 'nhs', 'other')
                        // This is separate from treatment_type which is for billing ('private' or 'nhs')

                        // Find all treatments that currently have this treatment type assigned
                        const previouslyAssignedTreatments = allTreatments
                          .filter((treatment) =>
                            treatment.type_of_treatment === treatmentTypeSetting
                          )
                          .map((treatment) => treatment.id);

                        // Find treatments that were previously assigned but are no longer selected
                        const treatmentsToDeselect = previouslyAssignedTreatments.filter(
                          (id) => !selectedTreatments.includes(id)
                        );

                        // Batch update selected treatments with the type_of_treatment
                        // Uses a single query per group instead of N parallel mutations to avoid AbortError
                        if (selectedTreatments.length > 0) {
                          await batchUpdateTypeOfTreatment({
                            treatmentIds: selectedTreatments,
                            typeOfTreatment: treatmentTypeSetting,
                          });
                        }

                        // Batch set type_of_treatment to null for deselected treatments
                        if (treatmentsToDeselect.length > 0) {
                          await batchUpdateTypeOfTreatment({
                            treatmentIds: treatmentsToDeselect,
                            typeOfTreatment: null,
                          });
                        }

                        const updatedCount = selectedTreatments.length;
                        const deselectedCount = treatmentsToDeselect.length;
                        let message = '';
                        if (updatedCount > 0 && deselectedCount > 0) {
                          message = `Successfully updated ${updatedCount} treatment${updatedCount > 1 ? 's' : ''} and removed type from ${deselectedCount} treatment${deselectedCount > 1 ? 's' : ''}`;
                        } else if (updatedCount > 0) {
                          message = `Successfully updated ${updatedCount} treatment${updatedCount > 1 ? 's' : ''} with type of treatment "${treatmentTypeSetting}"`;
                        } else if (deselectedCount > 0) {
                          message = `Successfully removed type from ${deselectedCount} treatment${deselectedCount > 1 ? 's' : ''}`;
                        }

                        if (message) {
                          toast.success(message);
                        }

                        // Clear selections and close dialog after successful save
                        setEditingTreatmentType(null);
                        setSelectedTreatments([]);
                        setTreatmentSearchQuery('');
                        setTreatmentTypeSetting('');
                        setTreatmentSelectOpen(false);
                        hasLoadedTreatmentsRef.current = ''; // Reset cache
                        setTreatmentSettingsDialogOpen(false);
                      } catch (error: any) {
                        console.error('Error updating treatments:', error);
                        toast.error(`Failed to update treatments: ${error.message || 'Unknown error'}`);
                      } finally {
                        setIsSavingTreatmentTypes(false);
                      }
                    }}
                    disabled={isSavingTreatmentTypes || !treatmentTypeSetting || selectedTreatments.length === 0}
                  >
                    {isSavingTreatmentTypes ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : editingTreatmentType ? (
                      'Save Changes'
                    ) : (
                      'Save Treatment Type'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* TREATMENT GOALS SETTINGS TAB */}
          <TabsContent value="treatment-goals" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profit Goals Settings</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Date Selection Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Period Type</label>
                    <Select value={periodType} onValueChange={(value: 'month' | 'year') => {
                      setPeriodType(value);
                      // Update dates to defaults for the new period type
                      const newActualPeriod = getDefaultActualPeriod(value);
                      const newPlanningPeriod = getDefaultPlanningPeriod(value);
                      setActualPeriod(newActualPeriod);
                      setPlanningPeriod(newPlanningPeriod);
                      // Update decade when period type changes to year
                      if (value === 'year') {
                        setActualYearDecade(Math.floor(newActualPeriod.getFullYear() / 10) * 10);
                        if (newPlanningPeriod) {
                          setPlanningYearDecade(Math.floor(newPlanningPeriod.getFullYear() / 10) * 10);
                        }
                      } else {
                        // Update month year when period type changes to month
                        setActualMonthYear(newActualPeriod.getFullYear());
                        if (newPlanningPeriod) {
                          setPlanningMonthYear(newPlanningPeriod.getFullYear());
                        } else {
                          setPlanningMonthYear(new Date().getFullYear());
                        }
                      }
                    }}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="month">Month</SelectItem>
                        <SelectItem value="year">Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Actual {periodType === 'month' ? 'Month' : 'Year'}
                    </label>
                    <Popover open={actualPeriodOpen} onOpenChange={(open) => {
                      setActualPeriodOpen(open);
                      if (open && periodType === 'month') {
                        setActualMonthYear(actualPeriod.getFullYear());
                      }
                    }}>
                      <div className="relative w-full">
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal h-10 pl-9 pr-8 bg-background hover:bg-background",
                              !actualPeriod && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <span className="pl-5">
                              {actualPeriod ? (
                                periodType === 'month'
                                  ? format(actualPeriod, "yyyy-MM")
                                  : format(actualPeriod, "yyyy")
                              ) : (
                                <span className="text-muted-foreground">
                                  Pick a {periodType === 'month' ? 'month' : 'year'}
                                </span>
                              )}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        {actualPeriod && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-transparent z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActualPeriod(new Date());
                              setActualPeriodOpen(false);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <PopoverContent className="w-auto p-0" align="start">
                        {periodType === 'year' ? (
                          <YearPicker
                            selectedYear={actualPeriod.getFullYear()}
                            onSelect={(year) => {
                              const newDate = startOfYear(new Date(year, 0, 1));
                              setActualPeriod(newDate);
                              setActualYearDecade(Math.floor(year / 10) * 10);
                              setActualPeriodOpen(false);
                            }}
                            decade={actualYearDecade}
                            onDecadeChange={setActualYearDecade}
                            minYear={2020}
                            maxYear={2030}
                          />
                        ) : (
                          <MonthPicker
                            selectedDate={actualPeriod}
                            onSelect={(date) => {
                              setActualPeriod(date);
                              setActualMonthYear(date.getFullYear());
                              setActualPeriodOpen(false);
                            }}
                            currentYear={actualMonthYear}
                            onYearChange={(year) => {
                              setActualMonthYear(year);
                              // Update the selected date to the same month in the new year
                              const newDate = startOfMonth(new Date(year, actualPeriod.getMonth(), 1));
                              setActualPeriod(newDate);
                            }}
                            minYear={2020}
                            maxYear={2030}
                          />
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Target Period
                    </label>
                    <Popover open={planningPeriodOpen} onOpenChange={(open) => {
                      setPlanningPeriodOpen(open);
                      if (open && periodType === 'month' && planningPeriod) {
                        setPlanningMonthYear(planningPeriod.getFullYear());
                      } else if (open && periodType === 'month' && !planningPeriod) {
                        setPlanningMonthYear(new Date().getFullYear());
                      }
                    }}>
                      <div className="relative w-full">
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal h-10 pl-9 pr-8 bg-background hover:bg-background",
                              !planningPeriod && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <span className="pl-5">
                              {planningPeriod ? (
                                periodType === 'month'
                                  ? format(planningPeriod, "yyyy-MM")
                                  : format(planningPeriod, "yyyy")
                              ) : (
                                <span className="text-muted-foreground">
                                  Pick a {periodType === 'month' ? 'month' : 'year'}
                                </span>
                              )}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        {planningPeriod && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-transparent z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlanningPeriod(null);
                              setPlanningPeriodOpen(false);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <PopoverContent className="w-auto p-0" align="start">
                        {periodType === 'year' ? (
                          <YearPicker
                            selectedYear={planningPeriod?.getFullYear() ?? new Date().getFullYear()}
                            onSelect={(year) => {
                              const newDate = startOfYear(new Date(year, 0, 1));
                              setPlanningPeriod(newDate);
                              setPlanningYearDecade(Math.floor(year / 10) * 10);
                              setPlanningPeriodOpen(false);
                            }}
                            decade={planningYearDecade}
                            onDecadeChange={setPlanningYearDecade}
                            minYear={2020}
                            maxYear={2030}
                          />
                        ) : (
                          <MonthPicker
                            selectedDate={planningPeriod}
                            onSelect={(date) => {
                              setPlanningPeriod(date);
                              setPlanningMonthYear(date.getFullYear());
                              setPlanningPeriodOpen(false);
                            }}
                            currentYear={planningMonthYear}
                            onYearChange={(year) => {
                              setPlanningMonthYear(year);
                              // Update the selected date to the same month in the new year
                              if (planningPeriod) {
                                const newDate = startOfMonth(new Date(year, planningPeriod.getMonth(), 1));
                                setPlanningPeriod(newDate);
                              }
                            }}
                            minYear={2020}
                            maxYear={2030}
                          />
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Action Buttons */}
                {can('treatments', 'update', 'profit_goals_tab') && (
                  <div className="flex justify-end gap-2 mb-4">
                    <Button
                      onClick={handleSaveTargets}
                      disabled={isSaving || isLoadingTargets}
                      className="gap-2"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Save Targets
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Treatment Goals Table */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Treatment Grouping</TableHead>
                        <TableHead className="text-right">Unit Actual</TableHead>
                        <TableHead className="text-right">Unit Target</TableHead>
                        <TableHead className="text-right">Avg Treatment Amount Actual</TableHead>
                        <TableHead className="text-right">Avg Treatment Amount Target</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoadingActualStats ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center gap-2">
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading treatment data...
                              </div>
                              <p className="text-xs text-muted-foreground mt-2">
                                This may take a moment while we fetch your data...
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : isErrorActualStats ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center gap-2">
                              <AlertCircle className="h-5 w-5 text-destructive" />
                              <p className="text-sm font-medium">Error loading treatment data</p>
                              <p className="text-xs text-muted-foreground">
                                {errorActualStats instanceof Error ? errorActualStats.message : 'An error occurred while loading data. Please try refreshing the page.'}
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : categoryNames.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            No treatment categories found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        categoryNames.map((categoryName) => {
                          const stats = categoryStats[categoryName] || { unitActual: 0, totalRevenue: 0, avgAmountActual: 0 };
                          // Use loaded targets if available, otherwise use local state
                          const loadedTarget = loadedTargets.get(categoryName);
                          // Merge goalTargets with loadedTargets to ensure we have the latest values
                          const currentTarget = goalTargets[categoryName];
                          // Only use targets if they exist in database or local state
                          // If no target is set, show empty (not 0)
                          // Priority: currentTarget (user edits) > loadedTarget (from DB) > null
                          const targets = currentTarget || loadedTarget || null;

                          // Debug: Log target values for this category
                          if (categoryName === 'Smilelign' || categoryName === 'Implants - Luke') {
                            console.log(`[Treatments] Target for ${categoryName}:`, {
                              loadedTarget,
                              currentTarget,
                              finalTargets: targets,
                              avgAmountTarget: targets?.avgAmountTarget,
                            });
                          }

                          return (
                            <TableRow key={categoryName}>
                              <TableCell className="font-medium">{categoryName}</TableCell>
                              <TableCell className="text-right">{stats.unitActual.toLocaleString()}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  value={targets?.unitTarget !== undefined && targets.unitTarget !== null ? targets.unitTarget : ''}
                                  onChange={(e) => {
                                    const inputValue = e.target.value;
                                    // Store the raw input value - allow empty string and partial numbers
                                    const numValue = inputValue === '' ? null : parseFloat(inputValue);
                                    // Only update if we have a valid number or empty string
                                    if (inputValue === '' || !isNaN(numValue as number)) {
                                      setGoalTargets((prev) => {
                                        const existing = prev[categoryName];
                                        return {
                                          ...prev,
                                          [categoryName]: {
                                            unitTarget: numValue,
                                            avgAmountTarget: existing?.avgAmountTarget ?? loadedTarget?.avgAmountTarget ?? null,
                                          },
                                        };
                                      });
                                    }
                                  }}
                                  onBlur={(e) => {
                                    // On blur, keep empty if empty, or set to 0 if invalid
                                    const value = e.target.value === '' ? null : (parseFloat(e.target.value) || null);
                                    setGoalTargets((prev) => {
                                      const existing = prev[categoryName];
                                      return {
                                        ...prev,
                                        [categoryName]: {
                                          unitTarget: value,
                                          avgAmountTarget: existing?.avgAmountTarget ?? loadedTarget?.avgAmountTarget ?? null,
                                        },
                                      };
                                    });
                                  }}
                                  className="w-20 text-right"
                                  min="0"
                                  step="1"
                                  placeholder=""
                                  disabled={!can('treatments', 'update', 'profit_goals_tab')}
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(stats.avgAmountActual)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-muted-foreground">£</span>
                                  <Input
                                    type="number"
                                    value={targets?.avgAmountTarget !== undefined && targets.avgAmountTarget !== null ? targets.avgAmountTarget : ''}
                                    onChange={(e) => {
                                      const inputValue = e.target.value;
                                      // Store the raw input value - allow empty string and partial numbers
                                      const numValue = inputValue === '' ? null : parseFloat(inputValue);
                                      // Only update if we have a valid number or empty string
                                      if (inputValue === '' || !isNaN(numValue as number)) {
                                        setGoalTargets((prev) => {
                                          const existing = prev[categoryName];
                                          return {
                                            ...prev,
                                            [categoryName]: {
                                              unitTarget: existing?.unitTarget ?? loadedTarget?.unitTarget ?? null,
                                              avgAmountTarget: numValue,
                                            },
                                          };
                                        });
                                      }
                                    }}
                                    onBlur={(e) => {
                                      // On blur, keep empty if empty, or set to null if invalid
                                      const value = e.target.value === '' ? null : (parseFloat(e.target.value) || null);
                                      setGoalTargets((prev) => {
                                        const existing = prev[categoryName];
                                        return {
                                          ...prev,
                                          [categoryName]: {
                                            unitTarget: existing?.unitTarget ?? loadedTarget?.unitTarget ?? null,
                                            avgAmountTarget: value,
                                          },
                                        };
                                      });
                                    }}
                                    className="w-24 text-right"
                                    min="0"
                                    step="0.01"
                                    placeholder=""
                                    disabled={!can('treatments', 'update', 'profit_goals_tab')}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
