import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PractitionerSummary } from '@/hooks/usePractitionerHistory';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

const PAGE_SIZE = 1000;

async function fetchAll<T>(buildQuery: () => any, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) { console.error('[fetchAll] error:', error); break; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    offset += pageSize;
  }
  return all;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface CancelledAppt {
  patientName: string;
  practitionerName: string;
  practitionerId: number;
  appointmentDate: string;
  cancelledAt: string;
  reason: string;
  notes: string;
  treatment: string;
  duration: number;
}

type SortKey = 'patientName' | 'practitionerName' | 'appointmentDate' | 'reason';
type SortOrder = 'asc' | 'desc';

const ITEMS_PER_PAGE = 10;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitioners: PractitionerSummary[];
}

export function CancelledAppointmentsDialog({ open, onOpenChange, practitioners }: Props) {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);
  // London day-boundary instants for the timestamptz filter — keeps this dialog's
  // rows in step with usePractitionerHistoryList's cancelled counts.
  const startInstant = ukDayStartInstant(dateRange.startDate);
  const endInstant = ukDayEndInstant(dateRange.endDate);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('appointmentDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);
  const [filterPractitioner, setFilterPractitioner] = useState<string>('all');

  // Build practitioner extId → name map
  const practitionerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of practitioners) {
      m.set(String(p.externalId), p.name);
    }
    return m;
  }, [practitioners]);

  const extIds = useMemo(() => practitioners.map(p => p.externalId), [practitioners]);

  const { data: cancelledAppts = [], isLoading } = useQuery({
    queryKey: ['cancelled-appointments', organizationId, startDate, endDate, selectedLocationId || 'all'],
    queryFn: async (): Promise<CancelledAppt[]> => {
      if (!organizationId || extIds.length === 0) return [];

      const rows = await fetchAll<{
        apmt_patient_name: string | null;
        apmt_practitioner_id: number | null;
        apmt_start_time: string | null;
        apmt_cancelled_at: string | null;
        apmt_reason: string | null;
        apmt_notes: string | null;
        apmt_treatment_description: string | null;
        apmt_cancellation_reason_name: string | null;
        apmt_duration: number | null;
      }>(() => {
        let q = (supabase as any)
          .from('appointments')
          .select('apmt_patient_name, apmt_practitioner_id, apmt_start_time, apmt_cancelled_at, apmt_reason, apmt_notes, apmt_treatment_description, apmt_cancellation_reason_name, apmt_duration')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('apmt_patient_id', 'is', null)
          .eq('apmt_state', 'Cancelled')
          .gte('apmt_start_time', startInstant)
          .lte('apmt_start_time', endInstant)
          .in('apmt_practitioner_id', extIds);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      });

      return rows.map(r => {
        return {
          patientName: r.apmt_patient_name || 'Unknown',
          practitionerName: practitionerMap.get(String(r.apmt_practitioner_id)) || 'Unknown',
          practitionerId: r.apmt_practitioner_id || 0,
          appointmentDate: r.apmt_start_time || '',
          cancelledAt: r.apmt_cancelled_at || '',
          reason: r.apmt_cancellation_reason_name || 'No reason given',
          notes: r.apmt_notes || '',
          treatment: r.apmt_treatment_description || r.apmt_reason || '',
          duration: r.apmt_duration || 0,
        };
      });
    },
    enabled: open && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    return cancelledAppts
      .filter(a => {
        const matchesSearch = search === '' ||
          a.patientName.toLowerCase().includes(search.toLowerCase()) ||
          a.reason.toLowerCase().includes(search.toLowerCase()) ||
          a.practitionerName.toLowerCase().includes(search.toLowerCase());
        const matchesPractitioner = filterPractitioner === 'all' ||
          String(a.practitionerId) === filterPractitioner;
        return matchesSearch && matchesPractitioner;
      })
      .sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case 'patientName': cmp = a.patientName.localeCompare(b.patientName); break;
          case 'practitionerName': cmp = a.practitionerName.localeCompare(b.practitionerName); break;
          case 'appointmentDate': cmp = a.appointmentDate.localeCompare(b.appointmentDate); break;
          case 'reason': cmp = a.reason.localeCompare(b.reason); break;
        }
        return sortOrder === 'asc' ? cmp : -cmp;
      });
  }, [cancelledAppts, search, filterPractitioner, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const paginatedData = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortOrder('asc'); }
  };

  const SortHeader = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <th className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleSort(sortKeyValue)}>
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sortKeyValue ? (
          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </div>
    </th>
  );

  const filterPractitionerName = filterPractitioner === 'all'
    ? 'All Practitioners'
    : practitioners.find(p => String(p.externalId) === filterPractitioner)?.name || 'All';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Cancelled Appointments
            <Badge variant="destructive" className="text-xs">{filtered.length}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search patient, reason..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 gap-2 text-xs">
                <Filter className="w-3.5 h-3.5" />
                {filterPractitionerName}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              <DropdownMenuItem onClick={() => { setFilterPractitioner('all'); setPage(1); }}>
                All Practitioners
              </DropdownMenuItem>
              {practitioners.filter(p => p.cancelled > 0).map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => { setFilterPractitioner(String(p.externalId)); setPage(1); }}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <p className="text-muted-foreground text-sm text-center py-8">Loading cancelled appointments...</p>
          ) : (
            <table className="data-table text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <SortHeader label="Patient" sortKeyValue="patientName" />
                  <SortHeader label="Practitioner" sortKeyValue="practitionerName" />
                  <SortHeader label="Date" sortKeyValue="appointmentDate" />
                  <th>Treatment</th>
                  <SortHeader label="Cancel Reason" sortKeyValue="reason" />
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((appt, i) => (
                  <tr key={i}>
                    <td className="font-medium">{appt.patientName}</td>
                    <td className="text-muted-foreground">{appt.practitionerName}</td>
                    <td className="text-muted-foreground whitespace-nowrap">
                      {appt.appointmentDate ? new Date(appt.appointmentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="text-muted-foreground">{appt.treatment || '—'}</td>
                    <td>
                      <span className={cn('text-sm', appt.reason === 'No reason given' ? 'text-muted-foreground italic' : 'text-red-600')}>
                        {appt.reason}
                      </span>
                    </td>
                    <td className="text-muted-foreground">{appt.duration}m</td>
                  </tr>
                ))}
                {paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">No cancelled appointments found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages} ({filtered.length} total)
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = currentPage <= 3 ? i + 1 : currentPage + i - 2;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <Button key={pageNum} variant={pageNum === currentPage ? 'default' : 'outline'} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(pageNum)}>
                    {pageNum}
                  </Button>
                );
              })}
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
