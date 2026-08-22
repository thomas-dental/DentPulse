import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Calendar, Stethoscope, Info, ExternalLink } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { usePractitionerHistoryDetail } from '@/hooks/usePractitionerHistory';
import { useFilters } from '@/contexts/FilterContext';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area,
  PieChart, Pie, Cell,
} from 'recharts';

const STATUS_COLORS = {
  completed: '#22c55e',
  attended: '#3b82f6',
  cancelled: '#ef4444',
  dna: '#f59e0b',
};

const CHART_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#0ea5e9'];

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const formatCurrencyShort = (value: number): string => {
  if (value >= 1000) return `£${(value / 1000).toFixed(1)}K`;
  return `£${value.toFixed(0)}`;
};

const getInitials = (name: string): string => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
};

type TrendGranularity = 'weekly' | 'monthly' | 'quarterly';

// practitioner.monthlyTrend rows are keyed either daily ('YYYY-MM-DD') or,
// for year-long ranges, monthly ('YYYY-MM') — see usePractitionerHistory's
// groupByMonth. The `d || 1` fallback below handles both shapes, so this
// re-buckets whichever granularity the hook returned into the wider one
// selected here.
function bucketKey(key: string, granularity: TrendGranularity): { key: string; label: string } {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));

  if (granularity === 'quarterly') {
    const q = Math.floor(dt.getUTCMonth() / 3) + 1;
    return { key: `${dt.getUTCFullYear()}-Q${q}`, label: `Q${q} ${dt.getUTCFullYear()}` };
  }
  if (granularity === 'weekly') {
    // Bucket to the Monday starting each ISO week
    const diffToMonday = (dt.getUTCDay() + 6) % 7;
    const monday = new Date(dt);
    monday.setUTCDate(dt.getUTCDate() - diffToMonday);
    return {
      key: monday.toISOString().substring(0, 10),
      label: monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
    };
  }
  return {
    key: key.substring(0, 7),
    label: dt.toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  };
}

function bucketAppointmentTrend<T extends { month: string; monthLabel: string; completed: number; cancelled: number; dna: number }>(
  rows: T[],
  granularity: TrendGranularity,
): Array<{ month: string; monthLabel: string; completed: number; cancelled: number; dna: number }> {
  const map = new Map<string, { month: string; monthLabel: string; completed: number; cancelled: number; dna: number }>();
  for (const row of rows) {
    const { key, label } = bucketKey(row.month, granularity);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { month: key, monthLabel: label, completed: 0, cancelled: 0, dna: 0 };
      map.set(key, bucket);
    }
    bucket.completed += row.completed;
    bucket.cancelled += row.cancelled;
    bucket.dna += row.dna;
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export default function PractitionerHistoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? '/practitioner-history';
  const { selectedDateRangeId, dateRange } = useFilters();
  const { data: practitioner, isLoading } = usePractitionerHistoryDetail(id);
  const isYearRange = new Set(['this-year', 'ytd', 'last-year', 'last-12m', 'yoy']).has(selectedDateRangeId);
  const [statusChartGranularity, setStatusChartGranularity] = useState<TrendGranularity>('monthly');
  const statusChartData = useMemo(
    () => bucketAppointmentTrend(practitioner?.monthlyTrend ?? [], statusChartGranularity),
    [practitioner?.monthlyTrend, statusChartGranularity],
  );

  // Build AI context — single practitioner detail. Built outside early
  // returns so it's defined for all three render paths.
  const practitionerAiData = practitioner ? (() => {
    const totalAppts = practitioner.totalAppointments || 0;
    const attendedNoPatient = totalAppts - practitioner.completed - practitioner.cancelled - practitioner.dna;
    const topTreatments = (practitioner.treatments || []).slice(0, 30).map(t => ({
      name: t.treatmentName,
      count: t.count,
      revenue: Math.round((t.revenue || 0) * 100) / 100,
    }));
    const trend = (practitioner.monthlyTrend || []).slice(0, 36).map((m: any) => ({
      label: m.monthLabel,
      completed: m.completed,
      attended: m.attended,
      cancelled: m.cancelled,
      dna: m.dna,
      revenue: Math.round((m.revenue || 0) * 100) / 100,
    }));
    return {
      practitionerId: practitioner.id,
      practitionerName: practitioner.name,
      role: practitioner.role,
      locationName: practitioner.locationName ?? null,
      summary: {
        totalAppointments: totalAppts,
        completed: practitioner.completed,
        cancelled: practitioner.cancelled,
        dna: practitioner.dna,
        attendedWithoutPatient: attendedNoPatient,
        completionPercent: totalAppts > 0 ? Math.round((practitioner.completed / totalAppts) * 100) : 0,
        cancellationPercent: totalAppts > 0 ? Math.round((practitioner.cancelled / totalAppts) * 100) : 0,
        uniquePatients: practitioner.uniquePatients,
        treatmentCount: practitioner.treatmentCount,
        hoursMinutes: practitioner.totalHoursMinutes,
        revenue: Math.round((practitioner.totalRevenue || 0) * 100) / 100,
      },
      treatmentRowCount: practitioner.treatments?.length ?? 0,
      topTreatmentsByCount: [...topTreatments].sort((a, b) => b.count - a.count).slice(0, 10),
      topTreatmentsByRevenue: [...topTreatments].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      monthlyTrend: trend,
    };
  })() : null;

  const aiContextData = {
    page: 'practitioner-history-detail',
    selectedLocationName: practitioner?.locationName ?? 'All Locations',
    period: {
      from: dateRange?.startDate ? dateRange.startDate.toISOString().slice(0, 10) : null,
      to: dateRange?.endDate ? dateRange.endDate.toISOString().slice(0, 10) : null,
      rangeId: selectedDateRangeId,
    },
    practitionerId: id ?? null,
    practitionerName: practitioner?.name ?? null,
    detail: practitionerAiData,
  };

  if (isLoading) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading practitioner data...</p>
        </div>
      </MainLayout>
    );
  }

  if (!practitioner) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <p className="text-muted-foreground">Practitioner not found</p>
          <Button variant="outline" onClick={() => navigate(backTo)}>
            Back to Practitioner History
          </Button>
        </div>
      </MainLayout>
    );
  }

  const attended = practitioner.totalAppointments - practitioner.completed - practitioner.cancelled - practitioner.dna;

  const pieData = [
    { name: 'Completed', value: practitioner.completed, color: STATUS_COLORS.completed },
    { name: 'Attended without patient', value: attended, color: STATUS_COLORS.attended },
    { name: 'Cancelled', value: practitioner.cancelled, color: STATUS_COLORS.cancelled },
    { name: 'DNA', value: practitioner.dna, color: STATUS_COLORS.dna },
  ].filter(d => d.value > 0);

  const topTreatments = practitioner.treatments.slice(0, 10);
  const completionRate = practitioner.totalAppointments > 0
    ? Math.round((practitioner.completed / practitioner.totalAppointments) * 100)
    : 0;
  const cancellationRate = practitioner.totalAppointments > 0
    ? Math.round((practitioner.cancelled / practitioner.totalAppointments) * 100)
    : 0;

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>{practitioner.name} - Practitioner History</title>
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(backTo)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Avatar className="h-12 w-12">
            <AvatarImage src={practitioner.photoUrl || undefined} />
            <AvatarFallback>{getInitials(practitioner.name)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{practitioner.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline">{practitioner.role}</Badge>
              {practitioner.locationName && (
                <span className="text-sm text-muted-foreground">{practitioner.locationName}</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Calendar className="w-3.5 h-3.5" />
                Total Appts
              </div>
              <p className="text-xl font-bold">{practitioner.totalAppointments.toLocaleString()}</p>
            </CardContent>
          </Card>
          {(() => {
            // Three appointment-state tiles deep-link to Dentally's
            // Appointments report; the Patients tile deep-links to
            // Dentally's Active Patients filter. URLs are sent without
            // query params — Dentally's web frontend ignores them anyway
            // and a bare URL keeps the address bar clean.
            const openDentally = (path: string) => {
              window.open(`https://app.dentally.co${path}`, '_blank', 'noopener,noreferrer');
            };
            const apptsHref = '/reports/appointments';
            const patientsHref = '/reports/patients-filter/active';
            const clickableClass = 'cursor-pointer group hover:border-primary/40 hover:shadow-md transition-all';
            const onKey = (path: string) => (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDentally(path);
              }
            };
            return (
              <>
                <Card
                  className={clickableClass}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDentally(apptsHref)}
                  onKeyDown={onKey(apptsHref)}
                  title="Open in Dentally Appointments report"
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      Completed
                      <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-70 transition-opacity" />
                    </div>
                    <p className="text-xl font-bold text-green-600">{practitioner.completed.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{completionRate}%</p>
                  </CardContent>
                </Card>
                <Card
                  className={clickableClass}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDentally(apptsHref)}
                  onKeyDown={onKey(apptsHref)}
                  title="Open in Dentally Appointments report"
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                      Cancelled
                      <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-70 transition-opacity" />
                    </div>
                    <p className="text-xl font-bold text-red-600">{practitioner.cancelled.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{cancellationRate}%</p>
                  </CardContent>
                </Card>
                <Card
                  className={clickableClass}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDentally(apptsHref)}
                  onKeyDown={onKey(apptsHref)}
                  title="Open in Dentally Appointments report"
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      DNA
                      <UITooltip>
                        <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                        <TooltipContent>Did Not Attend</TooltipContent>
                      </UITooltip>
                      <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-70 transition-opacity" />
                    </div>
                    <p className="text-xl font-bold text-amber-600">{practitioner.dna.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card
                  className={clickableClass}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDentally(patientsHref)}
                  onKeyDown={onKey(patientsHref)}
                  title="Open in Dentally Active Patients report"
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                      Patients
                      <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-70 transition-opacity" />
                    </div>
                    <p className="text-xl font-bold">{practitioner.uniquePatients.toLocaleString()}</p>
                  </CardContent>
                </Card>
              </>
            );
          })()}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Stethoscope className="w-3.5 h-3.5" />
                Treatments
              </div>
              <p className="text-xl font-bold">{practitioner.treatmentCount.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-muted-foreground text-xs mb-1">Total Hours</div>
              <p className="text-xl font-bold">{formatHours(practitioner.totalHoursMinutes)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-muted-foreground text-xs mb-1">Revenue</div>
              <p className="text-xl font-bold">{formatCurrency(practitioner.totalRevenue)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Appointment Status by Date/Month + Pie */}
        {practitioner.monthlyTrend.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="md:col-span-3">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4 gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Appointment Status by{' '}
                    {statusChartGranularity === 'weekly' ? 'Week' : statusChartGranularity === 'quarterly' ? 'Quarter' : 'Month'}
                  </h3>
                  <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
                    {(['weekly', 'monthly', 'quarterly'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setStatusChartGranularity(g)}
                        className={cn(
                          'text-xs font-medium rounded-sm px-2.5 py-1 capitalize transition-colors',
                          statusChartGranularity === g
                            ? 'bg-background shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={statusChartData} margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" name="Completed" fill={STATUS_COLORS.completed} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cancelled" name="Cancelled" fill={STATUS_COLORS.cancelled} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="dna" name="DNA" fill={STATUS_COLORS.dna} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex flex-col items-center justify-center h-full">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Status Overview</h3>
                <div className="w-36 h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={60}
                        dataKey="value"
                        strokeWidth={2}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => value.toLocaleString()} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1.5 mt-3 w-full">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                        <span className="text-muted-foreground truncate">{entry.name}</span>
                      </div>
                      <span className="font-medium">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Revenue by Date/Month */}
        {practitioner.monthlyTrend.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Revenue by {isYearRange ? 'Month' : 'Date'}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={practitioner.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Treatment Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Treatment-wise Count & Revenue Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Treatment Count vs Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topTreatments.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(250, topTreatments.length * 36)}>
                  <BarChart data={topTreatments} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 12 }} xAxisId="count" orientation="bottom" />
                    <XAxis type="number" tick={{ fontSize: 12 }} xAxisId="revenue" orientation="top" tickFormatter={formatCurrencyShort} />
                    <YAxis
                      type="category"
                      dataKey="treatmentName"
                      tick={{ fontSize: 11 }}
                      width={160}
                    />
                    <Tooltip formatter={(value: number, name: string) =>
                      name === 'Revenue' ? formatCurrency(value) : value.toLocaleString()
                    } />
                    <Legend />
                    <Bar dataKey="count" name="Count" fill="#6366f1" xAxisId="count" radius={[0, 4, 4, 0]} barSize={14} />
                    <Bar dataKey="revenue" name="Revenue" fill="#14b8a6" xAxisId="revenue" radius={[0, 4, 4, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-sm py-8 text-center">No treatment data</p>
              )}
            </CardContent>
          </Card>

          {/* Treatment Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Treatment Breakdown ({practitioner.treatments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {practitioner.treatments.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="bg-muted/50">
                        <th>Treatment</th>
                        <th className="text-right">Count</th>
                        <th className="text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {practitioner.treatments.map((tx) => (
                        <tr key={tx.treatmentName}>
                          <td className="text-sm">{tx.treatmentName}</td>
                          <td className="text-right font-medium">{tx.count.toLocaleString()}</td>
                          <td className="text-right font-medium">{formatCurrency(tx.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-8 text-center">No treatment data</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
