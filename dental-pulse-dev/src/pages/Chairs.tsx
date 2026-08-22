import { useState, useMemo, useEffect } from 'react';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { useLocations } from '@/hooks/useLocations';
import { useChairMetrics } from '@/hooks/useChairMetrics';
import { useChairSettings, CHAIR_SETTINGS_DEFAULTS } from '@/hooks/useChairSettings';
import { useHourlyChairMetrics } from '@/hooks/useHourlyChairMetrics';
import { usePractitionerChairMetrics } from '@/hooks/usePractitionerChairMetrics';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useLocationIncomeAccountingTotals } from '@/hooks/useLocationIncomeAccountingTotals';
import { composeProductionIncome } from '@/utils/profitBenchmarkActual';
import { useWeeklyChairPattern } from '@/hooks/useWeeklyChairPattern';
import { useMonthlyChairTrends } from '@/hooks/useMonthlyChairTrends';
import { format } from 'date-fns';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ReferenceLine } from 'recharts';
import { useFilters } from '@/contexts/FilterContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, Cell } from 'recharts';
import { Armchair, Clock, TrendingUp, AlertTriangle, Settings, Loader2, Info, Banknote, Gauge } from 'lucide-react';
import { Tooltip as UITooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/usePermissions';
import { ChairRecoveryGoalTab } from '@/components/chairs/ChairRecoveryGoalTab';
import { ChairEfficiencyEngineTab } from '@/components/chairs/ChairEfficiencyEngineTab';



function ChairSettingsTable({ form, onChange, disabled }: {
  form: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const rows: { key: string; label: string; min?: number; max?: number; step?: number; prefix?: string; placeholder?: string }[] = [
    { key: 'number_of_chairs', label: 'Number of Chairs', min: 0 },
    { key: 'industry_benchmark_occupancy', label: 'Industry Benchmark Occupancy (%)', min: 0, max: 100, step: 0.1, placeholder: '-' },
    { key: 'benchmark_revenue_per_chair_per_hour', label: 'Benchmark Revenue Per Chair Per Hour (\u00A3)', min: 0, step: 1, prefix: '\u00A3' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left py-3 px-6 font-medium text-white bg-primary rounded-tl-lg">Variable</th>
            <th className="text-left py-3 px-6 font-medium text-white bg-primary rounded-tr-lg w-[200px]">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/50">
              <td className="py-1 px-6 text-sm">{row.label}</td>
              <td className="py-1 px-6">
                <div className="flex items-center">
                  {row.prefix && (
                    <span className="flex items-center h-10 text-sm text-muted-foreground border border-r-0 rounded-l-md px-2 bg-muted">{row.prefix}</span>
                  )}
                  <Input
                    type="number"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    placeholder={row.placeholder ?? String(CHAIR_SETTINGS_DEFAULTS[row.key as keyof typeof CHAIR_SETTINGS_DEFAULTS] ?? '')}
                    value={form[row.key] ?? ''}
                    onChange={(e) => onChange(row.key, e.target.value)}
                    disabled={disabled}
                    className={row.prefix ? 'w-[100px] text-center rounded-l-none' : 'w-[120px] text-center'}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Read-only view of the practice's per-weekday operating hours, synced from
// Dentally onto practice_locations.operating_hours. Shown alongside the
// editable Chair Settings so users can see the source of "available hours".
function PracticeWorkingHours({ operatingHours }: { operatingHours: unknown }) {
  const days: Array<[string, string]> = [
    ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'],
    ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'],
    ['sunday', 'Sunday'],
  ];
  const oh = operatingHours && typeof operatingHours === 'object'
    ? (operatingHours as Record<string, { open?: string; close?: string; closed?: boolean }>)
    : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left py-3 px-6 font-medium text-white bg-primary rounded-tl-lg">Day</th>
            <th className="text-left py-3 px-6 font-medium text-white bg-primary rounded-tr-lg w-[200px]">Working Hours</th>
          </tr>
        </thead>
        <tbody>
          {days.map(([key, label]) => {
            const d = oh ? oh[key] : null;
            let text: string;
            if (!oh) text = 'Not synced from Dentally';
            else if (!d || d.closed || !d.open || !d.close) text = 'Closed';
            else text = `${d.open} – ${d.close}`;
            const isOpen = text.includes('–');
            return (
              <tr key={key} className="border-b border-border/50">
                <td className="py-2 px-6 text-sm">{label}</td>
                <td className={`py-2 px-6 text-sm ${isOpen ? 'font-medium' : 'text-muted-foreground'}`}>
                  {text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Chairs() {
  const { can } = usePermissions();
  const { canViewTab, defaultTab } = useTabPermissions('chairs');
  const [activeTab, setActiveTab] = useState(defaultTab || 'overview');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const { selectedLocationId, dateRange } = useFilters();
  const { locations: dynamicLocations } = useLocations();
  const { allSettings, getSettingsForLocation, saveSettings, isSaving: isSavingSettings } = useChairSettings();
  // Per-location form state: { [locationId]: { field: value } }
  const [settingsForms, setSettingsForms] = useState<Record<string, Record<string, string>>>({});
  const [savingSettingsLocationId, setSavingSettingsLocationId] = useState<string | null>(null);

  // Get form values for a location (saved values → defaults)
  const getFormForLocation = (locationId: string): Record<string, string> => {
    if (settingsForms[locationId]) return settingsForms[locationId];
    const saved = getSettingsForLocation(locationId);
    if (saved) {
      return {
        number_of_chairs: String(saved.number_of_chairs),
        clinic_opening_hours_per_day: String(saved.clinic_opening_hours_per_day),
        clinic_working_weeks_per_year: String(saved.clinic_working_weeks_per_year),
        clinic_working_days_per_year: String(saved.clinic_working_days_per_year),
        clinic_working_days_per_week: String(saved.clinic_working_days_per_week),
        industry_benchmark_occupancy: saved.industry_benchmark_occupancy != null ? String(saved.industry_benchmark_occupancy) : '',
        benchmark_revenue_per_chair_per_hour: String(saved.benchmark_revenue_per_chair_per_hour),
      };
    }
    return {
      number_of_chairs: String(CHAIR_SETTINGS_DEFAULTS.number_of_chairs),
      clinic_opening_hours_per_day: String(CHAIR_SETTINGS_DEFAULTS.clinic_opening_hours_per_day),
      clinic_working_weeks_per_year: String(CHAIR_SETTINGS_DEFAULTS.clinic_working_weeks_per_year),
      clinic_working_days_per_year: String(CHAIR_SETTINGS_DEFAULTS.clinic_working_days_per_year),
      clinic_working_days_per_week: String(CHAIR_SETTINGS_DEFAULTS.clinic_working_days_per_week),
      industry_benchmark_occupancy: '',
      benchmark_revenue_per_chair_per_hour: String(CHAIR_SETTINGS_DEFAULTS.benchmark_revenue_per_chair_per_hour),
    };
  };

  const handleSettingsFieldChange = (locationId: string, key: string, value: string) => {
    setSettingsForms(prev => ({
      ...prev,
      [locationId]: { ...getFormForLocation(locationId), ...prev[locationId], [key]: value },
    }));
  };

  const handleSettingsSave = (locationId: string) => {
    const form = { ...getFormForLocation(locationId), ...settingsForms[locationId] };
    setSavingSettingsLocationId(locationId);
    saveSettings(
      {
        location_id: locationId,
        number_of_chairs: form.number_of_chairs ? parseInt(form.number_of_chairs, 10) : CHAIR_SETTINGS_DEFAULTS.number_of_chairs,
        clinic_opening_hours_per_day: form.clinic_opening_hours_per_day ? parseFloat(form.clinic_opening_hours_per_day) : CHAIR_SETTINGS_DEFAULTS.clinic_opening_hours_per_day,
        clinic_working_weeks_per_year: form.clinic_working_weeks_per_year ? parseInt(form.clinic_working_weeks_per_year, 10) : CHAIR_SETTINGS_DEFAULTS.clinic_working_weeks_per_year,
        clinic_working_days_per_year: form.clinic_working_days_per_year ? parseInt(form.clinic_working_days_per_year, 10) : CHAIR_SETTINGS_DEFAULTS.clinic_working_days_per_year,
        clinic_working_days_per_week: form.clinic_working_days_per_week ? parseInt(form.clinic_working_days_per_week, 10) : CHAIR_SETTINGS_DEFAULTS.clinic_working_days_per_week,
        industry_benchmark_occupancy: form.industry_benchmark_occupancy ? parseFloat(form.industry_benchmark_occupancy) : null,
        benchmark_revenue_per_chair_per_hour: form.benchmark_revenue_per_chair_per_hour ? parseFloat(form.benchmark_revenue_per_chair_per_hour) : CHAIR_SETTINGS_DEFAULTS.benchmark_revenue_per_chair_per_hour,
      },
      {
        onSettled: () => {
          setSavingSettingsLocationId(null);
          setSettingsForms(prev => {
            const next = { ...prev };
            delete next[locationId];
            return next;
          });
        },
      }
    );
  };

  const { data: chairMetrics = [], isLoading: metricsLoading } = useChairMetrics({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const { data: hourlyData = [], isLoading: hourlyLoading } = useHourlyChairMetrics({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    locationId: selectedLocationId,
  });

  const { data: practitionerData = [], isLoading: practitionerLoading } = usePractitionerChairMetrics({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    locationId: selectedLocationId,
  });

  const { data: weeklyPatternData = [], isLoading: weeklyLoading } = useWeeklyChairPattern({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    locationId: selectedLocationId,
  });

  // Same Production Income as Profit Benchmark (Private + Membership + NHS).
  const locationIdForIncome =
    selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
      ? selectedLocationId
      : null;
  const fromDateStr = format(dateRange.startDate, 'yyyy-MM-dd');
  const toDateStr = format(dateRange.endDate, 'yyyy-MM-dd');
  const periodMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const prevStart = new Date(dateRange.startDate.getTime() - periodMs);
  const prevEnd = new Date(dateRange.startDate.getTime() - 1);
  const prevFromStr = format(prevStart, 'yyyy-MM-dd');
  const prevToStr = format(prevEnd, 'yyyy-MM-dd');

  const { data: providerProduction } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    locationIdForIncome,
  );
  const { data: accountingIncome } = useLocationIncomeAccountingTotals(
    fromDateStr,
    toDateStr,
    locationIdForIncome,
  );
  const { data: prevProviderProduction } = useAllProvidersNetProduction(
    null,
    prevStart,
    prevEnd,
    locationIdForIncome,
  );
  const { data: prevAccountingIncome } = useLocationIncomeAccountingTotals(
    prevFromStr,
    prevToStr,
    locationIdForIncome,
  );

  const productionIncomeRevenue = useMemo(
    () =>
      composeProductionIncome(
        providerProduction?.providers ?? [],
        accountingIncome,
      ),
    [providerProduction, accountingIncome],
  );
  const prevProductionIncome = useMemo(
    () =>
      composeProductionIncome(
        prevProviderProduction?.providers ?? [],
        prevAccountingIncome,
      ),
    [prevProviderProduction, prevAccountingIncome],
  );
  const revenueTrendPct = useMemo(() => {
    if (prevProductionIncome <= 0) return 0;
    return Math.round(((productionIncomeRevenue / prevProductionIncome) - 1) * 1000) / 10;
  }, [productionIncomeRevenue, prevProductionIncome]);

  // Monthly trends always shows last 12 months for meaningful trend line
  const monthlyRange = useMemo(() => {
    const end = dateRange.endDate;
    const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    return { start, end };
  }, [dateRange.endDate]);

  const { data: monthlyTrendsData = [], isLoading: monthlyLoading } = useMonthlyChairTrends({
    startDate: monthlyRange.start,
    endDate: monthlyRange.end,
    locationId: selectedLocationId,
  });

  // Build location data from real metrics
  const availableLocations = useMemo(() => {
    if (chairMetrics.length > 0) {
      return chairMetrics.map(m => ({
        locationId: m.location_id,
        location: m.location_name,
        chairs: m.chairs_count,
        occupancy: Number(m.occupancy_pct),
        utilisation: Number(m.utilisation_pct),
        revenuePerChair: Number(m.revenue_per_chair),
        trend: Number(m.trend_pct),
        benchmarkOccupancy: m.benchmark_occupancy != null ? Number(m.benchmark_occupancy) : null,
        benchmarkRevPerHour: Number(m.benchmark_revenue_per_chair_per_hour),
        hoursPerDay: Number(m.clinic_opening_hours_per_day),
        daysPerWeek: Number(m.clinic_working_days_per_week),
      }));
    }
    if (dynamicLocations && dynamicLocations.length > 0) {
      return dynamicLocations.map(loc => ({
        locationId: loc.id,
        location: loc.location_name,
        chairs: (loc as any).chairs_count || 0,
        occupancy: 0,
        utilisation: 0,
        revenuePerChair: 0,
        trend: 0,
        benchmarkOccupancy: null as number | null,
        benchmarkRevPerHour: CHAIR_SETTINGS_DEFAULTS.benchmark_revenue_per_chair_per_hour,
        hoursPerDay: CHAIR_SETTINGS_DEFAULTS.clinic_opening_hours_per_day,
        daysPerWeek: CHAIR_SETTINGS_DEFAULTS.clinic_working_days_per_week,
      }));
    }
    return [];
  }, [chairMetrics, dynamicLocations]);

  // Filter by global location selector
  const filteredLocations = selectedLocationId
    ? availableLocations.filter(l => l.locationId === selectedLocationId)
    : availableLocations;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalChairs = filteredLocations.reduce((sum, loc) => sum + loc.chairs, 0);

  // Dentally site id for the selected location. practice_locations.api_record_unique_id
  // holds the Dentally site UUID (see src/types/location.ts). When "All Locations"
  // is active there is no single site to scope to, so we disable the deep-link
  // rather than open Dentally with no site filter.
  const dentallySiteId: string | null = useMemo(() => {
    if (!selectedLocationId || !dynamicLocations) return null;
    const loc = dynamicLocations.find((l) => l.id === selectedLocationId);
    return loc?.api_record_unique_id ?? null;
  }, [selectedLocationId, dynamicLocations]);

  // Total Chairs tile click → opens Dentally's Appointments report scoped
  // to the active date filter + selected location. Format dates from local
  // components — the range Dates are local-midnight (FilterContext), so
  // toISOString() would shift them a day west of UTC.
  const openDentallyChairsReport = () => {
    if (!dentallySiteId) return;
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const after = fmt(dateRange.startDate);
    const before = fmt(dateRange.endDate);
    window.open(
      `https://app.dentally.co/reports/appointments?after=${after}&before=${before}&siteId=${dentallySiteId}`,
      '_blank',
      'noopener,noreferrer',
    );
  };
  // Sum NON-cancelled / NON-DNA hours & appts (total_appointments) so the card
  // reconciles with Dentally's "Appointments per Month" report (its "Number of
  // appointments" counts every attended/pending appointment, not just Status =
  // Completed). Client-chosen 2026-07-15 — includes the handful of past 'pending'
  // appointments Dentally counts. (Was completed_appointments only, which matched
  // Dentally's Status=Completed *list* but ran 2 short of the per-month report.)
  // Sum the RAW hours and round only once at display (below). Rounding each
  // practitioner to 1 decimal BEFORE summing (the old parseFloat(...toFixed(1)))
  // dropped a fraction per practitioner every month, accumulating into a ~minutes
  // gap vs Dentally over a long range.
  const totalCompletedHours = practitionerData.reduce(
    (sum, p) => sum + p.total_hours, 0
  );
  const totalAppointmentCount = practitionerData.reduce(
    (sum, p) => sum + p.total_appointments, 0
  );

  // Breakdown totals from chairMetrics for KPI cards
  const filteredMetrics = useMemo(() => {
    return chairMetrics.filter(m => !selectedLocationId || m.location_id === selectedLocationId);
  }, [chairMetrics, selectedLocationId]);

  const totalAvailableHours = useMemo(() =>
    filteredMetrics.reduce((sum, m) => sum + Number(m.available_hours), 0),
    [filteredMetrics]
  );
  const totalTreatmentHours = useMemo(() =>
    filteredMetrics.reduce((sum, m) => sum + Number(m.treatment_hours ?? 0), 0),
    [filteredMetrics]
  );
  const totalApptHours = useMemo(() =>
    filteredMetrics.reduce((sum, m) => sum + Number(m.completed_hours), 0),
    [filteredMetrics]
  );
  // Avg Occupancy = total appointment hrs / total available chair hrs.
  // Computed the same way the tooltip shows so the big number and the
  // tooltip math always agree (a simple average of per-location % would
  // skew with location size and diverge from the totalled ratio).
  const avgOccupancy = totalAvailableHours > 0
    ? (totalApptHours / totalAvailableHours) * 100
    : 0;
  // Avg Utilisation across locations = a chair-hour-WEIGHTED average of each
  // location's utilisation, NOT a plain average of the percentages. A plain average
  // (the old code) is wrong for "All": it ignores location size and diverges from the
  // per-location figures — the cause of the "All doesn't match, per-location does" bug
  // (and it collapsed toward 0 whenever the RPC returned a zero-utilisation location
  // row). For a single location this equals that location's own utilisation exactly.
  const avgUtilisation = totalAvailableHours > 0
    ? filteredMetrics.reduce((sum, m) => sum + Number(m.utilisation_pct) * Number(m.available_hours), 0) / totalAvailableHours
    : 0;
  // Avg Revenue/Chair = Profit Benchmark Production Income ÷ chairs.
  const avgRevenuePerChair = totalChairs > 0 ? productionIncomeRevenue / totalChairs : 0;
  const avgTrend = filteredLocations.length > 0 ? filteredLocations.reduce((sum, loc) => sum + loc.trend, 0) / filteredLocations.length : 0;

  // Revenue per chair-hour = Production Income ÷ available chair-hours.
  const revenuePerChairHour = totalAvailableHours > 0
    ? productionIncomeRevenue / totalAvailableHours
    : 0;

  // Benchmark values from settings (average across filtered locations)
  const avgBenchmarkOccupancy = useMemo(() => {
    const withBenchmark = filteredLocations.filter(l => l.benchmarkOccupancy != null);
    if (withBenchmark.length === 0) return null;
    return withBenchmark.reduce((sum, l) => sum + (l.benchmarkOccupancy ?? 0), 0) / withBenchmark.length;
  }, [filteredLocations]);

  const avgBenchmarkRevPerHour = useMemo(() => {
    if (filteredLocations.length === 0) return CHAIR_SETTINGS_DEFAULTS.benchmark_revenue_per_chair_per_hour;
    return filteredLocations.reduce((sum, l) => sum + l.benchmarkRevPerHour, 0) / filteredLocations.length;
  }, [filteredLocations]);

  // Bound the chart to the practice's CLINIC OPENING HOURS: an hour is shown
  // only if the clinic is open then (capacity_minutes > 0 — the RPC derives
  // capacity from each location's Dentally operating_hours). This drops empty
  // out-of-hours slots (e.g. a stray 07:00). Fallback to hours-with-activity
  // only if no capacity is configured, so the chart never goes blank.
  const filteredHourlyData = useMemo(() => {
    if (hourlyData.length === 0) return [];
    let openHours = hourlyData.filter(h => Number(h.capacity_minutes) > 0);
    if (openHours.length === 0) {
      openHours = hourlyData.filter(h =>
        Number(h.total_appointments) > 0 || Number(h.utilisation_pct) > 0
      );
    }
    if (openHours.length === 0) return [];
    return openHours
      .slice()
      .sort((a, b) => a.hour_slot - b.hour_slot)
      .map(h => ({
        hour: h.hour_label,
        utilisation: Number(h.utilisation_pct),
        appointments: Number(h.total_appointments),
      }));
  }, [hourlyData]);

  // Identify peak and low hours from real data
  const { peakHours, lowHours, peakPct, lowPct } = useMemo(() => {
    const withData = filteredHourlyData.filter(h => h.utilisation > 0);
    if (withData.length === 0) return { peakHours: '-', lowHours: '-', peakPct: 0, lowPct: 0 };
    const sorted = [...withData].sort((a, b) => b.utilisation - a.utilisation);
    const avgUtil = withData.reduce((s, h) => s + h.utilisation, 0) / withData.length;
    // Peak = above average, Low = below average (take top/bottom 3 by
    // utilisation, but DISPLAY them in chronological order so the hour list
    // reads naturally — e.g. "10:00, 11:00, 12:00", not "11:00, 12:00, 10:00").
    const peak = sorted.filter(h => h.utilisation > avgUtil).slice(0, 3);
    const low  = sorted.filter(h => h.utilisation < avgUtil).slice(-3); // 3 lowest
    const byHour = (a: { hour: string }, b: { hour: string }) => a.hour.localeCompare(b.hour);
    return {
      peakHours: peak.length > 0 ? [...peak].sort(byHour).map(h => h.hour).join(', ') : '-',
      lowHours:  low.length  > 0 ? [...low].sort(byHour).map(h => h.hour).join(', ')  : '-',
      // Keep the headline % as the true extreme of each selected set
      // (independent of the chronological display order).
      peakPct: peak.length > 0 ? Math.round(Math.max(...peak.map(h => h.utilisation))) : 0,
      lowPct:  low.length  > 0 ? Math.round(Math.min(...low.map(h => h.utilisation)))  : 0,
    };
  }, [filteredHourlyData]);

  // Weekly pattern chart data (filter out days with no available hours = clinic closed)
  const weeklyChartData = useMemo(() => {
    return weeklyPatternData
      .filter(d => d.available_hours > 0)
      .map(d => ({
        day: d.day_name,
        occupancy: Number(d.occupancy_pct),
        utilisation: Number(d.utilisation_pct),
      }));
  }, [weeklyPatternData]);

  // Monthly trends chart data
  const monthlyChartData = useMemo(() => {
    return monthlyTrendsData
      .filter(d => d.available_hours > 0)
      .map(d => ({
        month: d.month_label,
        occupancy: Number(d.occupancy_pct),
        utilisation: Number(d.utilisation_pct),
      }));
  }, [monthlyTrendsData]);

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const selectedLocationName = selectedLocationId
    ? (dynamicLocations?.find((l) => l.id === selectedLocationId)?.location_name ?? 'Selected Location')
    : 'All Locations';

  const locationRows = filteredLocations.map((loc) => ({
    location: loc.location,
    chairs: loc.chairs,
    occupancyPct: round2(loc.occupancy),
    utilisationPct: round2(loc.utilisation),
    revenuePerChair: Math.round(loc.revenuePerChair),
    trendPct: round2(loc.trend),
    benchmarkOccupancy: loc.benchmarkOccupancy != null ? round2(loc.benchmarkOccupancy) : null,
  })).slice(0, 50);

  const practitionerRows = practitionerData.map((p) => ({
    practitioner: p.practitioner_name,
    completedAppointments: p.completed_appointments,
    totalAppointments: p.booked_appointments,
    completedHours: round2(p.completed_hours),
    completionPct: p.booked_appointments > 0 ? round2((p.completed_appointments / p.booked_appointments) * 100) : 0,
  })).slice(0, 50);

  const hourlyRows = filteredHourlyData.map((h) => ({
    hour: h.hour,
    utilisationPct: round2(h.utilisation),
    appointments: h.appointments,
  })).slice(0, 50);

  const occupancySorted = [...locationRows].sort((a, b) => b.occupancyPct - a.occupancyPct);
  const underutilised = locationRows.filter((l) =>
    l.benchmarkOccupancy != null ? l.occupancyPct < l.benchmarkOccupancy : l.occupancyPct < 80
  ).sort((a, b) => a.occupancyPct - b.occupancyPct).slice(0, 10);

  const chairsData = {
    totalChairs,
    avgOccupancy: avgOccupancy.toFixed(1),
    avgUtilisation: avgUtilisation.toFixed(1),
    avgRevenuePerChair: Math.round(avgRevenuePerChair),
    totalRevenue: Math.round(productionIncomeRevenue),
    revenueSource: 'Profit Benchmark Production Income',
    peakHours,
    lowUtilisationHours: lowHours,
    locationsCount: filteredLocations.length,
    benchmarkOccupancy: avgBenchmarkOccupancy,
    benchmarkRevPerHour: avgBenchmarkRevPerHour,
    selectedLocationName,
    period: {
      from: dateRange.startDate.toISOString().slice(0, 10),
      to: dateRange.endDate.toISOString().slice(0, 10),
    },
    rows: {
      locations: locationRows,
      practitioners: practitionerRows,
      hourly: hourlyRows,
    },
    rankings: {
      topChairsByOccupancy: occupancySorted.slice(0, 10),
      bottomChairsByOccupancy: [...occupancySorted].reverse().slice(0, 10),
      underutilisedLocations: underutilised,
      topPractitionersByHours: [...practitionerRows].sort((a, b) => b.completedHours - a.completedHours).slice(0, 10),
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'chairs', data: chairsData }}>
      <Helmet>
        <title>Chair Utilization & Occupancy</title>
        <meta
          name="description"
          content="Track dental chair utilization, occupancy rates, revenue per chair, and identify optimization opportunities."
        />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Chair Management</h1>
          <p className="text-muted-foreground mt-1">Occupancy, utilisation, and capacity analysis</p>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="chairs" data={chairsData} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card
            className={`kpi-card${dentallySiteId ? ' cursor-pointer' : ''}`}
            onClick={dentallySiteId ? openDentallyChairsReport : undefined}
            role={dentallySiteId ? 'link' : undefined}
            tabIndex={dentallySiteId ? 0 : undefined}
            onKeyDown={dentallySiteId ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDentallyChairsReport();
              }
            } : undefined}
          >
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <Armchair className="w-4 h-4" />
                <span>Total Chairs</span>
              </div>
              <div className="text-2xl font-semibold">{totalChairs}</div>
              <div className="text-xs text-muted-foreground">Across {filteredLocations.length} locations</div>
              <div className="text-xs text-blue-500 mt-1 font-mono">
                {totalCompletedHours.toFixed(1)} hrs / {totalAppointmentCount} appts
              </div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <Clock className="w-4 h-4" />
                <span>Avg Occupancy</span>
                {filteredMetrics.length > 0 && (
                  <TooltipProvider delayDuration={0}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help ml-auto" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs p-3 space-y-1">
                        <div className="text-xs font-semibold mb-1">Available hrs</div>
                        {filteredMetrics.map((m, i) => {
                          const chairs = Number(m.chairs_count) || 0;
                          const hrsPerDay = Number(m.clinic_opening_hours_per_day) || 0;
                          const avail = Number(m.available_hours) || 0;
                          const workingDays = chairs > 0 && hrsPerDay > 0
                            ? avail / (chairs * hrsPerDay)
                            : 0;
                          return (
                            <div key={i} className="text-xs font-mono pl-1">
                              {filteredMetrics.length > 1 && (
                                <div className="text-[10px] text-muted-foreground">{m.location_name}</div>
                              )}
                              <span>{chairs} chairs</span>
                              <span> &times; {hrsPerDay.toFixed(hrsPerDay % 1 === 0 ? 0 : 1)} hrs/day</span>
                              <span> &times; {workingDays.toFixed(workingDays % 1 === 0 ? 0 : 1)} days</span>
                              <span> = {avail.toFixed(1)}</span>
                            </div>
                          );
                        })}
                        <div className="border-t border-border/40 mt-1.5 pt-1.5 space-y-0.5">
                          <div className="text-xs font-mono">
                            {totalApptHours.toFixed(1)} appointment hrs
                          </div>
                          <div className="text-xs font-mono">
                            &divide; {totalAvailableHours.toFixed(1)} available hrs
                          </div>
                          <div className="text-xs font-mono">
                            = <span className="font-semibold">{totalAvailableHours > 0 ? ((totalApptHours / totalAvailableHours) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 italic">
                          Appointment hrs from completed appointments&apos; durations. Available hrs = chairs &times; opening hrs/day (from each location&apos;s operating hours) &times; working days (distinct dates with appointments).
                        </div>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="text-2xl font-semibold">{Math.round(avgOccupancy)}%</div>
              <div className="text-xs text-muted-foreground">
                {avgBenchmarkOccupancy != null ? `Benchmark: ${avgBenchmarkOccupancy.toFixed(0)}%` : 'No benchmark set'}
              </div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <TrendingUp className="w-4 h-4" />
                <span>Avg Utilisation</span>
                {filteredMetrics.length > 0 && (
                  <TooltipProvider delayDuration={0}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help ml-auto" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-sm p-3 space-y-2">
                        <div className="text-xs font-semibold">How Avg Utilisation is calculated</div>

                        <div className="space-y-1">
                          <div className="text-xs">
                            <span className="font-mono">Treatment hours = {totalTreatmentHours.toFixed(1)} hrs</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground pl-2 italic">
                            Total time spent on treatments completed during this period, taken from your Dentally treatments.
                          </div>

                          <div className="text-xs pt-1">
                            <span className="font-mono">Available hours = {totalAvailableHours.toFixed(1)} hrs</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground pl-2 italic">
                            Number of chairs &times; clinic opening hours per day &times; working days in this period.
                          </div>
                        </div>

                        <div className="border-t border-border/40 pt-2 mt-1 text-xs font-mono">
                          Utilisation = {totalTreatmentHours.toFixed(1)} &divide; {totalAvailableHours.toFixed(1)} = <span className="font-semibold">{totalAvailableHours > 0 ? ((totalTreatmentHours / totalAvailableHours) * 100).toFixed(1) : '0.0'}%</span>
                        </div>

                        {filteredMetrics.length > 1 && (
                          <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border/40">
                            Averaged across {filteredMetrics.length} locations: {filteredMetrics.map(m => `${Number(m.utilisation_pct).toFixed(1)}%`).join(' + ')} &divide; {filteredMetrics.length}
                          </div>
                        )}

                        <div className="text-[11px] text-muted-foreground mt-1 italic">
                          Higher utilisation means chairs are spending more of their open hours actually delivering treatments.
                        </div>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="text-2xl font-semibold">{Math.round(avgUtilisation)}%</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <AlertTriangle className="w-4 h-4" />
                <span>Revenue/Chair</span>
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(avgRevenuePerChair)}</div>
              <TrendIndicator value={avgTrend} />
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <Banknote className="w-4 h-4" />
                <span>Total Revenue</span>
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(productionIncomeRevenue)}</div>
              <TrendIndicator value={revenueTrendPct} />
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1 whitespace-nowrap [&>svg]:shrink-0">
                <Gauge className="w-4 h-4" />
                <span>Revenue/Chair/Hour</span>
                {totalAvailableHours > 0 && (
                  <TooltipProvider delayDuration={0}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help ml-auto" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-sm p-3 space-y-2">
                        <div className="text-xs font-semibold">How Revenue/Chair/Hour is calculated</div>

                        <div className="space-y-1">
                          <div className="text-xs">
                            <span className="font-mono">Total revenue = {formatCurrency(productionIncomeRevenue)}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground pl-2 italic">
                            Profit Benchmark Production Income (Private + Membership + NHS) for this region / location / period.
                          </div>

                          <div className="text-xs pt-1">
                            <span className="font-mono">Available chair-hours = {totalAvailableHours.toFixed(1)}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground pl-2 italic">
                            Number of chairs &times; clinic opening hours per day &times; working days in this period.
                          </div>
                        </div>

                        <div className="border-t border-border/40 pt-2 mt-1 text-xs font-mono">
                          Revenue/Chair/Hour = {formatCurrency(productionIncomeRevenue)} &divide; {totalAvailableHours.toFixed(1)} = <span className="font-semibold">{formatCurrency(revenuePerChairHour)}</span>
                        </div>

                        <div className="text-[11px] text-muted-foreground mt-1 italic">
                          Benchmark: {formatCurrency(avgBenchmarkRevPerHour)}/chair/hr.
                        </div>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(revenuePerChairHour)}</div>
              {/* Capacity (chairs × hours) is broadly stable period-to-period,
                  so this metric tracks the Production Income revenue trend —
                  same source/basis as the Total Revenue card. */}
              <TrendIndicator value={revenueTrendPct} />
              <div className="mt-1.5 space-y-1">
                <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                  Benchmark: {formatCurrency(avgBenchmarkRevPerHour)}/chair/hr
                </div>
                {avgBenchmarkRevPerHour > 0 && (
                  <ProgressBar
                    value={revenuePerChairHour}
                    max={avgBenchmarkRevPerHour}
                    size="sm"
                    variant={
                      revenuePerChairHour >= avgBenchmarkRevPerHour ? 'success'
                        : revenuePerChairHour >= avgBenchmarkRevPerHour * 0.75 ? 'warning'
                        : 'danger'
                    }
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>


        {/* Definitions Card */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Occupancy: </span>
                <span className="text-muted-foreground">% of available chair hours filled by appointments (booked time)</span>
              </div>
              <div>
                <span className="font-medium">Utilisation: </span>
                <span className="text-muted-foreground">% of available chair hours spent on completed treatments (delivered time)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            {canViewTab('overview') && <TabsTrigger value="overview">Overview</TabsTrigger>}
            {canViewTab('hourly-analysis') && <TabsTrigger value="hourly-analysis">Hourly Analysis</TabsTrigger>}
            {canViewTab('by-chair') && <TabsTrigger value="by-chair">By Chair</TabsTrigger>}
            {canViewTab('trends') && <TabsTrigger value="trends">Trends</TabsTrigger>}
            {canViewTab('settings') && (
              <TabsTrigger value="settings" className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" />
                Settings
              </TabsTrigger>
            )}
            {canViewTab('chair-recovery-goal') && (
              <TabsTrigger value="chair-recovery-goal">Chair Recovery Goal</TabsTrigger>
            )}
            {canViewTab('chair-efficiency-engine') && (
              <TabsTrigger value="chair-efficiency-engine">Chair Efficiency Engine</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Chair Performance by Location</CardTitle>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading metrics...</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Chairs</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Occupancy</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Utilisation</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Revenue/Chair</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLocations.map((loc) => (
                          <tr key={loc.locationId} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer">
                            <td className="py-3 px-4 font-medium">{loc.location}</td>
                            <td className="text-right py-3 px-4">{loc.chairs}</td>
                            <td className="text-right py-3 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16">
                                  <ProgressBar
                                    value={loc.occupancy}
                                    max={100}
                                    variant={loc.occupancy >= 90 ? 'success' : loc.occupancy >= 80 ? 'warning' : 'danger'}
                                  />
                                </div>
                                <span className={loc.occupancy >= 90 ? 'text-success' : loc.occupancy >= 80 ? 'text-warning' : 'text-danger'}>
                                  {loc.occupancy}%
                                </span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16">
                                  <ProgressBar
                                    value={loc.utilisation}
                                    max={100}
                                    variant={loc.utilisation >= 85 ? 'success' : loc.utilisation >= 75 ? 'warning' : 'danger'}
                                  />
                                </div>
                                <span className={loc.utilisation >= 85 ? 'text-success' : loc.utilisation >= 75 ? 'text-warning' : 'text-danger'}>
                                  {loc.utilisation}%
                                </span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-4">{formatCurrency(loc.revenuePerChair)}</td>
                            <td className="text-right py-3 px-4">
                              <TrendIndicator value={loc.trend} />
                            </td>
                          </tr>
                        ))}
                        {filteredLocations.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-muted-foreground">
                              No locations found. Set up chair counts in the Settings tab.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Occupancy vs Utilisation by Location</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={filteredLocations} layout="vertical" margin={{ left: 120 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis dataKey="location" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} width={120} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        {avgBenchmarkOccupancy != null && (
                          <ReferenceLine
                            x={avgBenchmarkOccupancy}
                            stroke="hsl(var(--destructive))"
                            strokeDasharray="5 5"
                            label={{ value: `Benchmark ${avgBenchmarkOccupancy.toFixed(0)}%`, position: 'top', fontSize: 11, fill: 'hsl(var(--destructive))' }}
                          />
                        )}
                        <Bar dataKey="occupancy" name="Occupancy %" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="utilisation" name="Utilisation %" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Weekly Pattern</CardTitle>
                </CardHeader>
                <CardContent>
                  {weeklyLoading ? (
                    <div className="flex items-center justify-center py-8 h-[300px]">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Loading weekly data...</span>
                    </div>
                  ) : weeklyChartData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={weeklyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="occupancy" name="Occupancy %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                          <Line type="monotone" dataKey="utilisation" name="Utilisation %" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 h-[300px] text-muted-foreground text-sm">
                      No appointment data for the selected period.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="hourly-analysis">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Hourly Utilisation Pattern
                  <TooltipProvider delayDuration={0}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-muted-foreground/60 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-sm p-3 space-y-2">
                        <div className="text-xs font-semibold">How each hour is calculated</div>
                        <div className="text-[11px] text-muted-foreground space-y-1">
                          <p>
                            For each clock-hour, across <span className="font-medium text-foreground">every day in the selected period</span>:
                          </p>
                          <p className="font-mono text-foreground">
                            utilisation = treatment minutes delivered in that hour
                            ÷ (chairs × minutes the clinic is open that hour × working days)
                          </p>
                          <p>
                            Treatment minutes use the same appointment-linked, per-appointment-capped
                            basis as the Overview "Avg Utilisation" tile, and each hour is capped at
                            100% (a chair can't be more than fully used). The clinic-open minutes
                            come from each location's Dentally operating hours — so only opening
                            hours are shown.
                          </p>
                        </div>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {selectedLocationId
                    ? filteredLocations[0]?.location ?? 'Selected location'
                    : 'All locations (aggregated)'}
                  {' \u2022 '}{totalChairs} chairs
                </p>
              </CardHeader>
              <CardContent>
                {hourlyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading hourly data...</span>
                  </div>
                ) : filteredHourlyData.length > 0 ? (
                  <>
                    <div className="h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={filteredHourlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const d = payload[0].payload as { hour: string; utilisation: number; appointments: number };
                              return (
                                <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, padding: '8px 12px' }}>
                                  <div className="text-sm font-medium mb-1">{d.hour}</div>
                                  <div className="text-xs text-muted-foreground">Utilisation: <span className="font-semibold text-foreground">{d.utilisation}%</span></div>
                                  <div className="text-xs text-muted-foreground">Appointments: <span className="font-semibold text-foreground">{d.appointments}</span></div>
                                </div>
                              );
                            }}
                          />
                          {avgBenchmarkOccupancy != null && (
                            <ReferenceLine
                              y={avgBenchmarkOccupancy}
                              stroke="hsl(var(--primary))"
                              strokeDasharray="5 5"
                              label={{ value: `Benchmark ${avgBenchmarkOccupancy.toFixed(0)}%`, position: 'insideTopRight', fontSize: 11, fill: 'hsl(var(--primary))' }}
                            />
                          )}
                          <Bar dataKey="utilisation" name="utilisation" radius={[4, 4, 0, 0]}>
                            {filteredHourlyData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={entry.utilisation >= 85 ? 'hsl(var(--success))' : entry.utilisation >= 70 ? 'hsl(var(--warning))' : 'hsl(var(--danger))'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                      <h4 className="font-medium mb-2">Key Insights</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {peakHours !== '-' && <li>Peak hours: {peakHours} (up to {peakPct}% utilisation)</li>}
                        {lowHours !== '-' && <li>Low utilisation: {lowHours} (as low as {lowPct}%)</li>}
                        {peakHours !== '-' && lowHours !== '-' && (
                          <li>Opportunity: Consider staggered lunch breaks or extended hours promotions during low periods</li>
                        )}
                        {peakHours === '-' && lowHours === '-' && (
                          <li>No significant peaks or troughs detected in the selected period</li>
                        )}
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p>No appointment data available for the selected period.</p>
                    <p className="text-xs mt-1">Ensure chairs are configured in Settings and appointments are synced.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="by-chair">
            <Card>
              <CardHeader>
                <CardTitle>Practitioner Appointments</CardTitle>
              </CardHeader>
              <CardContent>
                {practitionerLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading practitioner data...</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Practitioner</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Appointments</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Hours</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Utilisation</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">
                            <TooltipProvider delayDuration={0}>
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 cursor-help">
                                    DNA
                                    <Info className="w-3 h-3 text-muted-foreground/60" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Did not attend
                                </TooltipContent>
                              </UITooltip>
                            </TooltipProvider>
                          </th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Cancelled</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Revenue/Chair</th>
                        </tr>
                      </thead>
                      <tbody>
                        {practitionerData.map((p) => (
                          <tr key={p.practitioner_name} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-3 px-4 font-medium">{p.practitioner_name}</td>
                            <td className="text-center py-3 px-4">{p.completed_appointments}/{p.booked_appointments}</td>
                            <td className="text-center py-3 px-4">{p.completed_hours.toFixed(1)}h</td>
                            <td className="text-center py-3 px-4">
                              {(() => {
                                const pct = p.booked_appointments > 0 ? (p.completed_appointments / p.booked_appointments) * 100 : 0;
                                return (
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-16">
                                      <ProgressBar
                                        value={pct}
                                        max={100}
                                        variant={pct >= 90 ? 'success' : pct >= 80 ? 'warning' : 'danger'}
                                      />
                                    </div>
                                    <span className={pct >= 90 ? 'text-success' : pct >= 80 ? 'text-warning' : 'text-danger'}>
                                      {pct.toFixed(1)}%
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="text-center py-3 px-4">{p.dna_appointments}</td>
                            <td className="text-center py-3 px-4">{p.cancelled_appointments}</td>
                            <td className="text-right py-3 px-4">{formatCurrency(p.revenue_per_chair)}</td>
                          </tr>
                        ))}
                        {practitionerData.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground">
                              No appointment data found for the selected period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trends">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Trends</CardTitle>
              </CardHeader>
              <CardContent>
                {monthlyLoading ? (
                  <div className="flex items-center justify-center py-8 h-[400px]">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading monthly data...</span>
                  </div>
                ) : monthlyChartData.length > 0 ? (
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis domain={[0, 'auto']} stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          formatter={(value: number, name: string) => [`${value}%`, name]}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        {avgBenchmarkOccupancy != null && (
                          <ReferenceLine
                            y={avgBenchmarkOccupancy}
                            stroke="hsl(var(--destructive))"
                            strokeDasharray="5 5"
                            label={{ value: `Benchmark ${avgBenchmarkOccupancy.toFixed(0)}%`, position: 'insideTopRight', fontSize: 11, fill: 'hsl(var(--destructive))' }}
                          />
                        )}
                        <Line type="monotone" dataKey="occupancy" name="Occupancy %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="utilisation" name="Utilisation %" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 h-[400px] text-muted-foreground text-sm">
                    No data available for the selected period.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Chair Settings</CardTitle>
              </CardHeader>
              <CardContent>
                {dynamicLocations && dynamicLocations.length > 0 ? (
                  // Only take the single-location path when the globally
                  // selected location actually exists in the accessible list —
                  // otherwise fall through to the all-locations accordion so
                  // the Settings tab is never blank.
                  (selectedLocationId && dynamicLocations.some(l => l.id === selectedLocationId)) ? (
                    // Single location selected — show settings directly
                    (() => {
                      const loc = dynamicLocations.find(l => l.id === selectedLocationId);
                      if (!loc) return null;
                      const locId = loc.id;
                      const form = { ...getFormForLocation(locId), ...settingsForms[locId] };
                      const isSavingThis = savingSettingsLocationId === locId && isSavingSettings;
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground mb-3">Dentally Practice Working Hours</h3>
                            <PracticeWorkingHours operatingHours={(loc as any).operating_hours} />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-foreground mb-3">Chair Configuration</h3>
                            <ChairSettingsTable
                              form={form}
                              onChange={(key, val) => handleSettingsFieldChange(locId, key, val)}
                              disabled={!can('chairs', 'update', 'settings_tab')}
                            />
                            {can('chairs', 'update', 'settings_tab') && (
                              <div className="flex justify-end mt-6">
                                <Button onClick={() => handleSettingsSave(locId)} disabled={isSavingThis}>
                                  {isSavingThis ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                  Save
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    // All locations — show accordion per location
                    <Accordion type="multiple" className="w-full space-y-3">
                      {dynamicLocations.map((loc) => {
                        const locId = loc.id;
                        const form = { ...getFormForLocation(locId), ...settingsForms[locId] };
                        const isSavingThis = savingSettingsLocationId === locId && isSavingSettings;
                        return (
                          <AccordionItem key={locId} value={locId} className="border rounded-lg px-4">
                            <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
                              <span>
                                {loc.location_name}
                                {loc.city && <span className="text-sm text-muted-foreground font-normal ml-2">({loc.city})</span>}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                  <h3 className="text-sm font-semibold text-foreground mb-3">Dentally Practice Working Hours</h3>
                                  <PracticeWorkingHours operatingHours={(loc as any).operating_hours} />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-foreground mb-3">Chair Configuration</h3>
                                  <ChairSettingsTable
                                    form={form}
                                    onChange={(key, val) => handleSettingsFieldChange(locId, key, val)}
                                    disabled={!can('chairs', 'update', 'settings_tab')}
                                  />
                                  {can('chairs', 'update', 'settings_tab') && (
                                    <div className="flex justify-end mt-4">
                                      <Button onClick={() => handleSettingsSave(locId)} disabled={isSavingThis}>
                                        {isSavingThis ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                        Save
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  )
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Armchair className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p>No locations found. Please add locations in the Settings page first.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chair-recovery-goal">
            <ChairRecoveryGoalTab />
          </TabsContent>

          <TabsContent value="chair-efficiency-engine">
            <ChairEfficiencyEngineTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
