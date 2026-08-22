import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Save, Search } from 'lucide-react';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { useChairRecoveryGoal, useAssociatePotentialGoals, type AssociatePotentialGoalInput } from '@/hooks/useChairRecoveryGoal';
import { useChairMetrics } from '@/hooks/useChairMetrics';
import { usePractitionerChairMetrics } from '@/hooks/usePractitionerChairMetrics';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useFilters } from '@/contexts/FilterContext';
import { usePermissions } from '@/hooks/usePermissions';

const formatGBP = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const formatGBPNoDecimals = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const formatHrs = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

// UK financial year — April to March. fyStartYear=2026 means 1 Apr 2026 →
// 31 Mar 2027. Used to label the period rows underneath the FY dropdowns.
function fyRangeLabel(fyStartYear: number): string {
  return `01-04-${fyStartYear} To 31-03-${fyStartYear + 1}`;
}

// Build a "DD-MM-YYYY To DD-MM-YYYY" range for a YYYY-MM value (month mode).
function monthRangeLabel(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return `01-${mm}-${year} To ${String(lastDay).padStart(2, '0')}-${mm}-${year}`;
}

// 5%, 10%, 15% … 100% — fixed Chair Occupancy target options.
const OCCUPANCY_OPTIONS: number[] = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

export function ChairRecoveryGoalTab() {
  const { can } = usePermissions();
  const canEdit = can('chairs', 'update', 'chair_recovery_goal_tab') || can('chairs', 'add', 'chair_recovery_goal_tab');

  const { selectedLocationId } = useFilters();

  // Filter row — these are user-controlled inputs local to the tab, not the
  // global FilterContext range. They drive what gets recorded against each
  // history row but do not change the live numbers (which come from the
  // global period filter so the user can compare against any actual window).
  const today = new Date();
  const currentUkFy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

  const [periodType, setPeriodType] = useState<'month' | 'year'>('month');
  const [actualFy, setActualFy] = useState<number>(currentUkFy);
  const [planningFy, setPlanningFy] = useState<number>(currentUkFy + 1);
  const [actualMonth, setActualMonth] = useState<string>(currentMonthStr);
  const [planningMonth, setPlanningMonth] = useState<string>(nextMonthStr);

  // Single source of truth for the value that gets persisted, regardless of
  // mode. Hooks/db now use TEXT (e.g. "2025" or "2026-04").
  const actualPeriod = periodType === 'month' ? actualMonth : String(actualFy);
  const planningPeriod = periodType === 'month' ? planningMonth : String(planningFy);

  // Translate the user's Actual Period (month string or FY year) into a real
  // Date range so the data hooks below can be scoped to that window. UK FY:
  // April → March. Updating Actual Month/FY re-fetches every live metric and
  // re-derives the production row per associate — matches the user's request
  // that the Production column tracks the local Actual filter.
  const actualRange = useMemo(() => {
    if (periodType === 'month') {
      const m = /^(\d{4})-(\d{2})$/.exec(actualMonth);
      if (!m) return { start: new Date(), end: new Date() };
      const year = Number(m[1]);
      const monthIdx = Number(m[2]) - 1;
      return {
        start: new Date(year, monthIdx, 1),
        end: new Date(year, monthIdx + 1, 0),
      };
    }
    return {
      start: new Date(actualFy, 3, 1),
      end: new Date(actualFy + 1, 2, 31),
    };
  }, [periodType, actualMonth, actualFy]);

  // Live source metrics — re-use the same hooks the rest of the chairs page
  // calls so the numbers reconcile £-for-£ and hour-for-hour with the
  // Overview tiles. This keeps us inside the feedback memory rule (reuse
  // page logic; never reinvent a metric).
  const { data: chairMetrics = [] } = useChairMetrics({
    startDate: actualRange.start,
    endDate: actualRange.end,
  });
  const { data: practitionerData = [], isLoading: practitionerLoading } = usePractitionerChairMetrics({
    startDate: actualRange.start,
    endDate: actualRange.end,
    locationId: selectedLocationId,
  });

  // Production per practitioner — exact same RPC (and same email-grouping
  // multi-location aggregation) that drives the Profit Goals Settings
  // "Total Production Actual" column on the provider detail page. Keyed by
  // provider name so we can attach it to the matching practitioner row below.
  const { data: providerProductionData } = useAllProvidersNetProduction(
    null,
    actualRange.start,
    actualRange.end,
    selectedLocationId,
  );
  const productionByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of providerProductionData?.providers ?? []) {
      map.set(p.providerName.trim().toLowerCase(), p.total);
    }
    return map;
  }, [providerProductionData]);

  const filteredMetrics = useMemo(
    () => chairMetrics.filter(m => !selectedLocationId || m.location_id === selectedLocationId),
    [chairMetrics, selectedLocationId]
  );

  // Current chair time occupied (hrs) = completed appointment hours, same
  // basis as the Overview "Avg Occupancy" tile.
  const currentChairTimeOccupied = useMemo(
    () => filteredMetrics.reduce((sum, m) => sum + Number(m.completed_hours), 0),
    [filteredMetrics]
  );

  // Sum of every practitioner's Profit-Goals production for this period —
  // matches what the Production column rows add up to.
  const currentTotalRevenue = useMemo(
    () => (providerProductionData?.providers ?? []).reduce((s, p) => s + (p.total || 0), 0),
    [providerProductionData]
  );

  // Recovery percentage — the user's target uplift in occupancy. The image
  // shows 5% → recovery hrs = 5% * 6,099 = 305, recovery £ = 5% * £856k.
  const [occupancyPctStr, setOccupancyPctStr] = useState<string>('10');
  const occupancyPct = Number(occupancyPctStr) || 0;
  const recoveryChairTime = (currentChairTimeOccupied * occupancyPct) / 100;
  const potentialRevenueRecovery = (currentTotalRevenue * occupancyPct) / 100;

  // Recovery goal persistence.
  const {
    history: recoveryHistory,
    isLoading: recoveryHistoryLoading,
    saveGoal,
    isSaving: isSavingRecovery,
  } = useChairRecoveryGoal(selectedLocationId);

  const handleRecoverySave = () => {
    if (!canEdit) return;
    saveGoal({
      location_id: selectedLocationId,
      period_type: periodType,
      actual_period: actualPeriod,
      planning_period: planningPeriod,
      chair_occupancy_pct: occupancyPct,
      current_chair_time_occupied_hrs: Number(currentChairTimeOccupied.toFixed(2)),
      recovery_chair_time_hrs: Number(recoveryChairTime.toFixed(2)),
      current_total_revenue: Number(currentTotalRevenue.toFixed(2)),
      potential_revenue_recovery: Number(potentialRevenueRecovery.toFixed(2)),
    });
  };

  // Associate goals state — one row per practitioner from the live metrics.
  type AssocRow = {
    associate_name: string;
    provider_external_id: string | null;
    production: number;
    chair_time_occupied: number;
    revenue_per_chair_hour: number;
    chair_time_target: string;
    target_revenue_per_chair_hour: string;
  };

  const buildBaseAssocRows = (): AssocRow[] =>
    practitionerData.map(p => {
      // Profit-Goals "Total Production Actual" — fall back to TPI revenue if
      // the providers/email match doesn't find a row (e.g. archived names).
      const production = productionByName.get(p.practitioner_name.trim().toLowerCase()) ?? p.revenue;
      return {
        associate_name: p.practitioner_name,
        provider_external_id: null,
        production,
        chair_time_occupied: p.completed_hours,
        revenue_per_chair_hour: p.completed_hours > 0 ? production / p.completed_hours : 0,
        chair_time_target: '',
        target_revenue_per_chair_hour: '',
      };
    });

  const [assocRows, setAssocRows] = useState<AssocRow[]>([]);

  // Re-seed when practitioner data OR production data changes; preserve any
  // user input keyed by associate name so a background refetch doesn't wipe
  // what they typed.
  useEffect(() => {
    setAssocRows(prev => {
      const prevByName = new Map(prev.map(r => [r.associate_name, r]));
      return buildBaseAssocRows().map(r => {
        const existing = prevByName.get(r.associate_name);
        if (existing) {
          return {
            ...r,
            chair_time_target: existing.chair_time_target,
            target_revenue_per_chair_hour: existing.target_revenue_per_chair_hour,
          };
        }
        return r;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practitionerData, productionByName]);

  const updateAssocField = (
    name: string,
    field: 'chair_time_target' | 'target_revenue_per_chair_hour',
    value: string,
  ) => {
    setAssocRows(prev =>
      prev.map(r => (r.associate_name === name ? { ...r, [field]: value } : r))
    );
  };

  const {
    history: assocHistory,
    isLoading: assocHistoryLoading,
    saveBatch: saveAssocBatch,
    isSaving: isSavingAssoc,
  } = useAssociatePotentialGoals(selectedLocationId);

  const handleAssocSave = () => {
    if (!canEdit) return;
    const batch: AssociatePotentialGoalInput[] = assocRows.map(r => ({
      provider_external_id: r.provider_external_id,
      associate_name: r.associate_name,
      chair_time_target_hrs: Number(r.chair_time_target) || 0,
      target_revenue_per_chair_hour: Number(r.target_revenue_per_chair_hour) || 0,
    }));
    saveAssocBatch({
      location_id: selectedLocationId,
      period_type: periodType,
      actual_period: actualPeriod,
      planning_period: planningPeriod,
      associates: batch,
    });
  };

  // History search boxes — filter rendered rows only.
  const [recoverySearch, setRecoverySearch] = useState('');
  const [assocSearch, setAssocSearch] = useState('');

  const filteredRecoveryHistory = useMemo(() => {
    if (!recoverySearch) return recoveryHistory;
    const q = recoverySearch.toLowerCase();
    return recoveryHistory.filter(h =>
      String(h.chair_occupancy_pct).includes(q) ||
      String(h.potential_revenue_recovery).includes(q) ||
      String(h.recovery_chair_time_hrs).includes(q) ||
      new Date(h.created_at).toLocaleDateString('en-GB').toLowerCase().includes(q)
    );
  }, [recoveryHistory, recoverySearch]);

  const filteredAssocHistory = useMemo(() => {
    if (!assocSearch) return assocHistory;
    const q = assocSearch.toLowerCase();
    return assocHistory.filter(h =>
      h.associate_name.toLowerCase().includes(q) ||
      String(h.chair_time_target_hrs).includes(q) ||
      String(h.target_revenue_per_chair_hour).includes(q)
    );
  }, [assocHistory, assocSearch]);

  // FY dropdown options — current −2 to current +3.
  const fyOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = currentUkFy - 2; y <= currentUkFy + 3; y++) out.push(y);
    return out;
  }, [currentUkFy]);

  return (
    <div className="space-y-4">
      {/* Period filters */}
      <Card>
        <CardHeader>
          <CardTitle>Chair Recovery Goal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Period Type</label>
              <Select value={periodType} onValueChange={(v) => setPeriodType(v as 'month' | 'year')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodType === 'year' ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Actual FY</label>
                  <Select value={String(actualFy)} onValueChange={(v) => setActualFy(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fyOptions.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-[11px] text-primary flex items-center gap-1">
                    {fyRangeLabel(actualFy)}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Planning FY</label>
                  <Select value={String(planningFy)} onValueChange={(v) => setPlanningFy(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fyOptions.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-[11px] text-primary flex items-center gap-1">
                    {fyRangeLabel(planningFy)}
                  </div>
                </div>
              </>
            ) : (
              <ConfigProvider
                theme={{
                  token: {
                    colorPrimary: 'hsl(244, 48%, 25%)',
                    colorPrimaryBg: '#e6f4ff',
                    colorPrimaryBgHover: '#bae0ff',
                  },
                }}
              >
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Actual Month</label>
                  <DatePicker
                    picker="month"
                    value={actualMonth ? dayjs(actualMonth, 'YYYY-MM') : null}
                    onChange={(d) => {
                      if (d) setActualMonth(d.format('YYYY-MM'));
                    }}
                    format="YYYY-MM"
                    allowClear={false}
                    className="w-full h-10"
                  />
                  <div className="text-[11px] text-primary flex items-center gap-1">
                    {monthRangeLabel(actualMonth)}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Planning Month</label>
                  <DatePicker
                    picker="month"
                    value={planningMonth ? dayjs(planningMonth, 'YYYY-MM') : null}
                    onChange={(d) => {
                      if (d) setPlanningMonth(d.format('YYYY-MM'));
                    }}
                    format="YYYY-MM"
                    allowClear={false}
                    className="w-full h-10"
                  />
                  <div className="text-[11px] text-primary flex items-center gap-1">
                    {monthRangeLabel(planningMonth)}
                  </div>
                </div>
              </ConfigProvider>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Goal + Associate tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recovery Goal card */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-1.5">
              <span>£</span> Chair Recovery Goal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Chair Occupancy</label>
              <div className="flex items-center gap-2">
                <Select
                  value={occupancyPctStr}
                  onValueChange={(v) => setOccupancyPctStr(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OCCUPANCY_OPTIONS.map(v => (
                      <SelectItem key={v} value={String(v)}>{v}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  className="p-2 text-orange-500 hover:bg-orange-50 rounded"
                  title="Reset"
                  onClick={() => setOccupancyPctStr('10')}
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Current Chair Time Occupied (Hrs)</label>
              <Input
                readOnly
                value={formatHrs(currentChairTimeOccupied)}
                className="bg-muted/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Recovery Chair Time (Hrs)</label>
              <Input
                readOnly
                value={formatHrs(recoveryChairTime)}
                className="bg-muted/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Current Total Revenue</label>
              <Input
                readOnly
                value={formatGBP(currentTotalRevenue)}
                className="bg-muted/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Potential Revenue Recovery</label>
              <Input
                readOnly
                value={formatGBP(potentialRevenueRecovery)}
                className="bg-muted/40"
              />
            </div>

            {canEdit && (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleRecoverySave}
                  disabled={isSavingRecovery}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                  size="sm"
                >
                  {isSavingRecovery ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Associate Potential Goal */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-1.5">
              <span>£</span> Associate Potential Goal
            </CardTitle>
          </CardHeader>
          <CardContent>
            {practitionerLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading associates…</span>
              </div>
            ) : assocRows.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No associates with appointments in the selected period.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-primary text-white">
                      <th className="text-left py-2 px-3 font-medium">Associate</th>
                      <th className="text-right py-2 px-3 font-medium">Production (£)</th>
                      <th className="text-right py-2 px-3 font-medium">Chair-Time Occupied (Hrs)</th>
                      <th className="text-right py-2 px-3 font-medium">Revenue per Chair Hour (£)</th>
                      <th className="text-right py-2 px-3 font-medium">Chair-Time Target (Hrs)</th>
                      <th className="text-right py-2 px-3 font-medium">Target Revenue per Chair Hour (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assocRows.map((r) => (
                      <tr key={r.associate_name} className="border-b border-border/50">
                        <td className="py-2 px-3 font-medium text-primary">{r.associate_name}</td>
                        <td className="text-right py-2 px-3">{formatGBPNoDecimals(r.production)}</td>
                        <td className="text-right py-2 px-3">
                          {r.chair_time_occupied > 0 ? r.chair_time_occupied.toFixed(2) : 0}
                        </td>
                        <td className="text-right py-2 px-3">
                          {r.chair_time_occupied > 0
                            ? `£${Math.round(r.revenue_per_chair_hour)}/hr`
                            : '£0/hr'}
                        </td>
                        <td className="text-right py-2 px-3">
                          <Input
                            type="number"
                            min={0}
                            value={r.chair_time_target}
                            onChange={(e) =>
                              updateAssocField(r.associate_name, 'chair_time_target', e.target.value)
                            }
                            disabled={!canEdit}
                            placeholder="0"
                            className="h-8 w-20 ml-auto text-right"
                          />
                        </td>
                        <td className="text-right py-2 px-3">
                          <div className="flex items-center justify-end">
                            <span className="flex items-center h-8 text-xs text-muted-foreground border border-r-0 rounded-l-md px-2 bg-muted">£</span>
                            <Input
                              type="number"
                              min={0}
                              value={r.target_revenue_per_chair_hour}
                              onChange={(e) =>
                                updateAssocField(r.associate_name, 'target_revenue_per_chair_hour', e.target.value)
                              }
                              disabled={!canEdit}
                              placeholder="0"
                              className="h-8 w-20 rounded-l-none text-right"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && assocRows.length > 0 && (
              <div className="flex justify-end pt-3">
                <Button
                  onClick={handleAssocSave}
                  disabled={isSavingAssoc}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                  size="sm"
                >
                  {isSavingAssoc ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5">
                <span>£</span> Chair Recovery History
              </CardTitle>
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search here..."
                  value={recoverySearch}
                  onChange={(e) => setRecoverySearch(e.target.value)}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {recoveryHistoryLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-primary/90 text-white">
                      <th className="text-left py-2 px-3 font-medium">Chair Occupancy %</th>
                      <th className="text-left py-2 px-3 font-medium">Potential Recover Revenue</th>
                      <th className="text-left py-2 px-3 font-medium">Recovery Chair Time</th>
                      <th className="text-left py-2 px-3 font-medium">Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecoveryHistory.map((h) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-2 px-3">{Number(h.chair_occupancy_pct)} %</td>
                        <td className="py-2 px-3">{formatGBPNoDecimals(Number(h.potential_revenue_recovery))}</td>
                        <td className="py-2 px-3">{Number(h.recovery_chair_time_hrs).toFixed(2)}</td>
                        <td className="py-2 px-3">
                          {new Date(h.created_at).toLocaleDateString('en-GB')}
                        </td>
                      </tr>
                    ))}
                    {filteredRecoveryHistory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground text-sm">
                          No history yet. Save a recovery goal to start the timeline.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5">
                <span>£</span> Associate Potential History
              </CardTitle>
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search here..."
                  value={assocSearch}
                  onChange={(e) => setAssocSearch(e.target.value)}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {assocHistoryLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-primary/90 text-white">
                      <th className="text-left py-2 px-3 font-medium">Associate</th>
                      <th className="text-left py-2 px-3 font-medium">Target Chair Time</th>
                      <th className="text-left py-2 px-3 font-medium">Target Revenue Per Chair Hour</th>
                      <th className="text-left py-2 px-3 font-medium">Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssocHistory.map((h) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-2 px-3">{h.associate_name}</td>
                        <td className="py-2 px-3">{Number(h.chair_time_target_hrs).toFixed(2)}</td>
                        <td className="py-2 px-3">{formatGBPNoDecimals(Number(h.target_revenue_per_chair_hour))}</td>
                        <td className="py-2 px-3">
                          {new Date(h.created_at).toLocaleDateString('en-GB')}
                        </td>
                      </tr>
                    ))}
                    {filteredAssocHistory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground text-sm">
                          No associate targets saved yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
