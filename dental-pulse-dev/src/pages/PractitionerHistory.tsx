import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, CheckCircle, XCircle, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Filter, GitCompareArrows, Info, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePractitionerHistoryList } from '@/hooks/usePractitionerHistory';
import { CancelledAppointmentsDialog } from '@/components/practitioner-history/CancelledAppointmentsDialog';
import { ComparePractitionersDialog } from '@/components/practitioner-history/ComparePractitionersDialog';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { toLocalYMD } from '@/utils/dateRangeUtils';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from 'recharts';

type SortKey = 'name' | 'totalAppointments' | 'completed' | 'attended' | 'cancelled' | 'dna' | 'totalRevenue' | 'uniquePatients' | 'totalTreatments' | 'totalHoursMinutes';
type SortOrder = 'asc' | 'desc';
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATUS_COLORS = {
  completed: '#22c55e',
  attended: '#3b82f6',
  cancelled: '#ef4444',
  dna: '#f59e0b',
};

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const getInitials = (name: string): string => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
};

export default function PractitionerHistory() {
  const navigate = useNavigate();
  const { selectedDateRangeId, selectedLocationId, dateRange } = useFilters();
  const { locations: allLocations } = useLocations();
  const { data, isLoading } = usePractitionerHistoryList();
  const practitioners = data?.practitioners ?? [];
  const monthlyTrend = data?.monthlyTrend ?? [];
  const practitionerTrendsMap = data?.practitionerTrendsMap;
  const totalUniquePatients = data?.totalUniquePatients ?? 0;
  const isYearRange = new Set(['this-year', 'ytd', 'last-year', 'last-12m', 'yoy']).has(selectedDateRangeId);
  const [chartPractitioner, setChartPractitioner] = useState<string>('all');
  const [cancelledDialogOpen, setCancelledDialogOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);

  // Filter chart data by selected practitioner
  const chartData = chartPractitioner === 'all'
    ? monthlyTrend
    : (practitionerTrendsMap?.get(chartPractitioner) ?? []);
  const chartPractitionerName = chartPractitioner === 'all'
    ? 'All Practitioners'
    : practitioners.find(p => p.id === chartPractitioner)?.name ?? 'All Practitioners';
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalRevenue');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  const filtered = practitioners
    .filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.role.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'totalAppointments': cmp = a.totalAppointments - b.totalAppointments; break;
        case 'completed': cmp = a.completed - b.completed; break;
        case 'cancelled': cmp = a.cancelled - b.cancelled; break;
        case 'dna': cmp = a.dna - b.dna; break;
        case 'totalRevenue': cmp = a.totalRevenue - b.totalRevenue; break;
        case 'uniquePatients': cmp = a.uniquePatients - b.uniquePatients; break;
        case 'attended': cmp = a.attended - b.attended; break;
        case 'totalTreatments': cmp = a.treatmentCount - b.treatmentCount; break;
        case 'totalHoursMinutes': cmp = a.totalHoursMinutes - b.totalHoursMinutes; break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Reset page when search or pageSize changes
  const handleSearchChange = (value: string) => { setSearchQuery(value); setCurrentPage(1); };
  const handlePageSizeChange = (value: string) => { setPageSize(Number(value)); setCurrentPage(1); };

  // Summary metrics
  const totals = practitioners.reduce(
    (acc, p) => ({
      appointments: acc.appointments + p.totalAppointments,
      completed: acc.completed + p.completed,
      cancelled: acc.cancelled + p.cancelled,
      dna: acc.dna + p.dna,
      revenue: acc.revenue + p.totalRevenue,
      patients: acc.patients + p.uniquePatients,
      treatments: acc.treatments + p.treatmentCount,
      hours: acc.hours + p.totalHoursMinutes,
    }),
    { appointments: 0, completed: 0, cancelled: 0, dna: 0, revenue: 0, patients: 0, treatments: 0, hours: 0 }
  );

  const overallPieData = [
    { name: 'Completed', value: totals.completed, color: STATUS_COLORS.completed },
    { name: 'Attended without patient', value: totals.appointments - totals.completed - totals.cancelled - totals.dna, color: STATUS_COLORS.attended },
    { name: 'Cancelled', value: totals.cancelled, color: STATUS_COLORS.cancelled },
    { name: 'DNA', value: totals.dna, color: STATUS_COLORS.dna },
  ].filter(d => d.value > 0);

  // Build AI context for chatbot — practitioner roster + summary
  const selectedLocationName = selectedLocationId
    ? (allLocations.find((l: any) => l.id === selectedLocationId)?.name ?? 'Selected Location')
    : 'All Locations';

  const aiPractitioners = (practitioners || []).slice(0, 60).map((p: any) => {
    const totalAppts = p.totalAppointments || 0;
    return {
      name: p.name,
      role: p.role,
      totalAppointments: totalAppts,
      completed: p.completed,
      attended: p.attended,
      cancelled: p.cancelled,
      dna: p.dna,
      uniquePatients: p.uniquePatients,
      treatmentCount: p.treatmentCount,
      totalHoursMinutes: p.totalHoursMinutes,
      revenue: Math.round((p.totalRevenue || 0) * 100) / 100,
      completionPercent: totalAppts > 0 ? Math.round((p.completed / totalAppts) * 100) : 0,
      cancellationPercent: totalAppts > 0 ? Math.round((p.cancelled / totalAppts) * 100) : 0,
    };
  });
  const topPractitionersByRevenue = [...aiPractitioners].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const bottomPractitionersByRevenue = [...aiPractitioners].sort((a, b) => a.revenue - b.revenue).slice(0, 10);
  const topPractitionersByPatients = [...aiPractitioners].sort((a, b) => b.uniquePatients - a.uniquePatients).slice(0, 10);

  const aiContextData = {
    page: 'practitioner-history',
    selectedLocationName,
    selectedLocationId: selectedLocationId || null,
    period: {
      from: toLocalYMD(dateRange?.startDate),
      to: toLocalYMD(dateRange?.endDate),
      rangeId: selectedDateRangeId,
    },
    summary: {
      practitionerCount: practitioners.length,
      totalAppointments: totals.appointments,
      completed: totals.completed,
      cancelled: totals.cancelled,
      dna: totals.dna,
      uniquePatients: totalUniquePatients,
      treatments: totals.treatments,
      hoursMinutes: totals.hours,
      revenue: Math.round(totals.revenue * 100) / 100,
    },
    practitionerCount: practitioners.length,
    practitioners: aiPractitioners,
    topPractitionersByRevenue,
    bottomPractitionersByRevenue,
    topPractitionersByPatients,
  };

  const SortHeader = ({ label, sortKeyValue, className }: { label: string; sortKeyValue: SortKey; className?: string }) => (
    <th
      className={cn('cursor-pointer hover:bg-muted/50 transition-colors', className)}
      onClick={() => handleSort(sortKeyValue)}
    >
      <div className="flex items-center justify-center gap-1">
        {label}
        {sortKey === sortKeyValue ? (
          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </div>
    </th>
  );

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>Practitioner History</title>
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Practitioner History</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Treatment attendance, cancellations, completions and revenue by practitioner
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading practitioner data...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Users className="w-4 h-4" />
                    Practitioners
                  </div>
                  <p className="text-2xl font-bold">{practitioners.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    Completed
                  </div>
                  <p className="text-2xl font-bold text-green-600">{totals.completed.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:border-red-300 transition-colors" onClick={() => setCancelledDialogOpen(true)}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <XCircle className="w-4 h-4 text-red-500" />
                    Cancelled
                  </div>
                  <p className="text-2xl font-bold text-red-600">{totals.cancelled.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    DNA
                    <UITooltip>
                      <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                      <TooltipContent>Did Not Attend</TooltipContent>
                    </UITooltip>
                  </div>
                  <p className="text-2xl font-bold text-amber-600">{totals.dna.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="text-muted-foreground text-sm mb-1">Patients</div>
                  <p className="text-2xl font-bold">{totalUniquePatients.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="text-muted-foreground text-sm mb-1">Treatments</div>
                  <p className="text-2xl font-bold">{totals.treatments.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="text-muted-foreground text-sm mb-1">Total Hours</div>
                  <p className="text-2xl font-bold">{formatHours(totals.hours)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="text-muted-foreground text-sm mb-1">Total Revenue</div>
                  <p className="text-2xl font-bold">{formatCurrency(totals.revenue)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Appointment Status Chart with Practitioner Filter */}
            {monthlyTrend.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Appointment Status by {isYearRange ? 'Month' : 'Date'}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-8 gap-2 text-xs">
                          <Filter className="w-3.5 h-3.5" />
                          {chartPractitionerName}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                        <DropdownMenuItem onClick={() => setChartPractitioner('all')}>
                          All Practitioners
                        </DropdownMenuItem>
                        {practitioners.map((p) => (
                          <DropdownMenuItem key={p.id} onClick={() => setChartPractitioner(p.id)}>
                            {p.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={chartData} margin={{ left: 0, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="completed" name="Completed" fill={STATUS_COLORS.completed} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="attended" name="Attended without patient" fill={STATUS_COLORS.attended} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cancelled" name="Cancelled" fill={STATUS_COLORS.cancelled} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="dna" name="DNA" fill={STATUS_COLORS.dna} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-muted-foreground text-sm py-8 text-center">No appointment data for this practitioner</p>
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
                  {PAGE_SIZE_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={String(opt)}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" className="h-9 gap-2" onClick={() => setCompareDialogOpen(true)}>
                <GitCompareArrows className="w-4 h-4" />
                Compare
              </Button>
              <div className="ml-auto text-sm text-muted-foreground">
                {filtered.length} of {practitioners.length} practitioners
              </div>
            </div>

            {/* Practitioner Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <SortHeader label="Practitioner" sortKeyValue="name" />
                      <SortHeader label="Total Appts" sortKeyValue="totalAppointments" />
                      <SortHeader label="Completed" sortKeyValue="completed" />
                      <SortHeader label="Attended w/o patient" sortKeyValue="attended" />
                      <SortHeader label="Cancelled" sortKeyValue="cancelled" />
                      <th className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleSort('dna')}>
                        <div className="flex items-center justify-center gap-1">
                          DNA
                          <UITooltip>
                            <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                            <TooltipContent>Did Not Attend</TooltipContent>
                          </UITooltip>
                          {sortKey === 'dna' ? (
                            sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>
                      <SortHeader label="Patients" sortKeyValue="uniquePatients" />
                      <SortHeader label="Treatments" sortKeyValue="totalTreatments" />
                      <SortHeader label="Hours" sortKeyValue="totalHoursMinutes" />
                      <SortHeader label="Revenue" sortKeyValue="totalRevenue" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((p) => (
                      <tr
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/practitioner-history/${p.id}`)}
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={p.photoUrl || undefined} />
                              <AvatarFallback className="text-xs">{getInitials(p.name)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{p.name}</span>
                            <Badge variant="outline" className="text-xs">{p.role}</Badge>
                            {!p.isActive && (
                              <Badge variant="secondary" className="text-xs">Inactive</Badge>
                            )}
                          </div>
                        </td>
                        <td className="font-medium text-center">{p.totalAppointments.toLocaleString()}</td>
                        <td className="text-center">
                          <span className="text-green-600 font-medium">{p.completed.toLocaleString()}</span>
                        </td>
                        <td className="text-center">
                          <span className={cn('font-medium', p.attended > 0 && 'text-blue-600')}>
                            {p.attended.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-center">
                          <span
                            className={cn('font-medium', p.cancelled > 0 && 'text-red-600 cursor-pointer hover:underline')}
                            onClick={(e) => { if (p.cancelled > 0) { e.stopPropagation(); setCancelledDialogOpen(true); } }}
                          >
                            {p.cancelled.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className={cn('font-medium', p.dna > 0 && 'text-amber-600')}>
                            {p.dna.toLocaleString()}
                          </span>
                        </td>
                        <td className="font-medium text-center">{p.uniquePatients.toLocaleString()}</td>
                        <td className="font-medium text-center">{p.treatmentCount.toLocaleString()}</td>
                        <td className="font-medium text-center">{formatHours(p.totalHoursMinutes)}</td>
                        <td className="font-medium text-center">{formatCurrency(p.totalRevenue)}</td>
                      </tr>
                    ))}
                    {paginatedRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-8 text-muted-foreground">
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
                    Showing {Math.min((currentPage - 1) * pageSize + 1, filtered.length)}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} practitioners
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm px-3">Page {currentPage} of {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(currentPage + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Cancelled Appointments Dialog */}
      <CancelledAppointmentsDialog
        open={cancelledDialogOpen}
        onOpenChange={setCancelledDialogOpen}
        practitioners={practitioners}
      />

      {/* Compare Practitioners Dialog */}
      <ComparePractitionersDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        practitioners={practitioners}
      />
    </MainLayout>
  );
}
