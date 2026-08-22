import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GitCompareArrows, Info } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PractitionerSummary } from '@/hooks/usePractitionerHistory';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';

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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitioners: PractitionerSummary[];
}

interface MetricRow {
  label: string;
  valueA: number;
  valueB: number;
  format: 'number' | 'currency' | 'hours' | 'percent';
  higherIsBetter: boolean;
  info: string;
}

function formatMetric(value: number, format: string): string {
  switch (format) {
    case 'currency': return formatCurrency(value);
    case 'hours': return formatHours(value);
    case 'percent': return `${value.toFixed(1)}%`;
    default: return value.toLocaleString();
  }
}

function GapIndicator({ valueA, valueB, format, higherIsBetter }: { valueA: number; valueB: number; format: string; higherIsBetter: boolean }) {
  const diff = valueA - valueB;
  if (Math.abs(diff) < 0.01) return <span className="text-xs text-muted-foreground">—</span>;

  // For percentages show pp difference, for others show % difference
  let label: string;
  if (format === 'percent') {
    label = `${Math.abs(diff).toFixed(1)}pp`;
  } else if (valueB !== 0) {
    label = `${Math.abs(Math.round((diff / valueB) * 100))}%`;
  } else {
    label = '—';
  }

  const aIsBetter = diff > 0 === higherIsBetter;
  // Show who leads: A is left column
  return (
    <span className={cn('text-xs font-medium', aIsBetter ? 'text-green-600' : 'text-red-600')}>
      {label}
    </span>
  );
}

export function ComparePractitionersDialog({ open, onOpenChange, practitioners }: Props) {
  const [practitionerAId, setPractitionerAId] = useState<string>('');
  const [practitionerBId, setPractitionerBId] = useState<string>('');

  const practA = practitioners.find(p => p.id === practitionerAId);
  const practB = practitioners.find(p => p.id === practitionerBId);

  const metrics: MetricRow[] = useMemo(() => {
    if (!practA || !practB) return [];

    const completionRateA = practA.totalAppointments > 0 ? (practA.completed / practA.totalAppointments) * 100 : 0;
    const completionRateB = practB.totalAppointments > 0 ? (practB.completed / practB.totalAppointments) * 100 : 0;
    const cancelRateA = practA.totalAppointments > 0 ? (practA.cancelled / practA.totalAppointments) * 100 : 0;
    const cancelRateB = practB.totalAppointments > 0 ? (practB.cancelled / practB.totalAppointments) * 100 : 0;
    const dnaRateA = practA.totalAppointments > 0 ? (practA.dna / practA.totalAppointments) * 100 : 0;
    const dnaRateB = practB.totalAppointments > 0 ? (practB.dna / practB.totalAppointments) * 100 : 0;
    const revenuePerApptA = practA.completed > 0 ? practA.totalRevenue / practA.completed : 0;
    const revenuePerApptB = practB.completed > 0 ? practB.totalRevenue / practB.completed : 0;
    const revenuePerPatientA = practA.uniquePatients > 0 ? practA.totalRevenue / practA.uniquePatients : 0;
    const revenuePerPatientB = practB.uniquePatients > 0 ? practB.totalRevenue / practB.uniquePatients : 0;

    const fmtC = (v: number) => formatCurrency(v);
    const fmtH = (v: number) => formatHours(v);
    const nA = practA.name;
    const nB = practB.name;

    return [
      { label: 'Total Appointments', valueA: practA.totalAppointments, valueB: practB.totalAppointments, format: 'number', higherIsBetter: true, info: `Total booked appointments from Dentally. ${nA}: ${practA.totalAppointments}, ${nB}: ${practB.totalAppointments}. Difference: ${Math.abs(practA.totalAppointments - practB.totalAppointments)}.` },
      { label: 'Completed', valueA: practA.completed, valueB: practB.completed, format: 'number', higherIsBetter: true, info: `Appointments marked as completed. ${nA}: ${practA.completed} of ${practA.totalAppointments}, ${nB}: ${practB.completed} of ${practB.totalAppointments}.` },
      { label: 'Completion Rate', valueA: completionRateA, valueB: completionRateB, format: 'percent', higherIsBetter: true, info: `${nA}: ${practA.completed} / ${practA.totalAppointments} = ${completionRateA.toFixed(1)}%. ${nB}: ${practB.completed} / ${practB.totalAppointments} = ${completionRateB.toFixed(1)}%.` },
      { label: 'Cancelled', valueA: practA.cancelled, valueB: practB.cancelled, format: 'number', higherIsBetter: false, info: `Appointments cancelled. ${nA}: ${practA.cancelled} of ${practA.totalAppointments}, ${nB}: ${practB.cancelled} of ${practB.totalAppointments}.` },
      { label: 'Cancellation Rate', valueA: cancelRateA, valueB: cancelRateB, format: 'percent', higherIsBetter: false, info: `${nA}: ${practA.cancelled} / ${practA.totalAppointments} = ${cancelRateA.toFixed(1)}%. ${nB}: ${practB.cancelled} / ${practB.totalAppointments} = ${cancelRateB.toFixed(1)}%.` },
      { label: 'DNA', valueA: practA.dna, valueB: practB.dna, format: 'number', higherIsBetter: false, info: `Did Not Attend. ${nA}: ${practA.dna} of ${practA.totalAppointments}, ${nB}: ${practB.dna} of ${practB.totalAppointments}.` },
      { label: 'DNA Rate', valueA: dnaRateA, valueB: dnaRateB, format: 'percent', higherIsBetter: false, info: `${nA}: ${practA.dna} / ${practA.totalAppointments} = ${dnaRateA.toFixed(1)}%. ${nB}: ${practB.dna} / ${practB.totalAppointments} = ${dnaRateB.toFixed(1)}%.` },
      { label: 'Patients', valueA: practA.uniquePatients, valueB: practB.uniquePatients, format: 'number', higherIsBetter: true, info: `Unique patients treated. ${nA}: ${practA.uniquePatients}, ${nB}: ${practB.uniquePatients}. Difference: ${Math.abs(practA.uniquePatients - practB.uniquePatients)}.` },
      { label: 'Treatments', valueA: practA.treatmentCount, valueB: practB.treatmentCount, format: 'number', higherIsBetter: true, info: `Unique treatment types performed. ${nA}: ${practA.treatmentCount}, ${nB}: ${practB.treatmentCount}. Excludes charting entries.` },
      { label: 'Total Hours', valueA: practA.totalHoursMinutes, valueB: practB.totalHoursMinutes, format: 'hours', higherIsBetter: true, info: `Total treatment duration. ${nA}: ${fmtH(practA.totalHoursMinutes)}, ${nB}: ${fmtH(practB.totalHoursMinutes)}. Difference: ${fmtH(Math.abs(practA.totalHoursMinutes - practB.totalHoursMinutes))}.` },
      { label: 'Revenue', valueA: practA.totalRevenue, valueB: practB.totalRevenue, format: 'currency', higherIsBetter: true, info: `Total revenue from completed treatments. ${nA}: ${fmtC(practA.totalRevenue)}, ${nB}: ${fmtC(practB.totalRevenue)}. Difference: ${fmtC(Math.abs(practA.totalRevenue - practB.totalRevenue))}.` },
      { label: 'Revenue / Treatment', valueA: revenuePerApptA, valueB: revenuePerApptB, format: 'currency', higherIsBetter: true, info: `${nA}: ${fmtC(practA.totalRevenue)} / ${practA.completed} completed appts = ${fmtC(revenuePerApptA)}. ${nB}: ${fmtC(practB.totalRevenue)} / ${practB.completed} completed appts = ${fmtC(revenuePerApptB)}.` },
      { label: 'Revenue / Patient', valueA: revenuePerPatientA, valueB: revenuePerPatientB, format: 'currency', higherIsBetter: true, info: `${nA}: ${fmtC(practA.totalRevenue)} / ${practA.uniquePatients} patients = ${fmtC(revenuePerPatientA)}. ${nB}: ${fmtC(practB.totalRevenue)} / ${practB.uniquePatients} patients = ${fmtC(revenuePerPatientB)}.` },
    ];
  }, [practA, practB]);

  // Gap analysis insights
  const insights = useMemo(() => {
    if (!practA || !practB || metrics.length === 0) return [];

    const result: string[] = [];
    for (const m of metrics) {
      const diff = m.valueA - m.valueB;
      const absDiff = Math.abs(diff);
      if (absDiff < 0.01) continue;

      const pctDiff = m.valueB !== 0 ? Math.abs((diff / m.valueB) * 100) : 100;
      if (pctDiff < 10) continue; // Only show significant gaps

      const better = diff > 0 === m.higherIsBetter ? practA.name : practB.name;
      const worse = diff > 0 === m.higherIsBetter ? practB.name : practA.name;

      if (m.format === 'percent') {
        result.push(`${better} has ${absDiff.toFixed(1)}pp better ${m.label.toLowerCase()} than ${worse}`);
      } else {
        result.push(`${better} has ${Math.round(pctDiff)}% higher ${m.label.toLowerCase()} than ${worse}`);
      }
    }
    return result.slice(0, 5);
  }, [practA, practB, metrics]);

  const chartData = useMemo(() => {
    if (!practA || !practB) return [];
    return [
      { metric: 'Appts', [practA.name]: practA.totalAppointments, [practB.name]: practB.totalAppointments },
      { metric: 'Completed', [practA.name]: practA.completed, [practB.name]: practB.completed },
      { metric: 'Cancelled', [practA.name]: practA.cancelled, [practB.name]: practB.cancelled },
      { metric: 'DNA', [practA.name]: practA.dna, [practB.name]: practB.dna },
      { metric: 'Patients', [practA.name]: practA.uniquePatients, [practB.name]: practB.uniquePatients },
    ];
  }, [practA, practB]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="w-5 h-5" />
            Compare Practitioners
          </DialogTitle>
        </DialogHeader>

        {/* Selection */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Practitioner A</label>
            <Select value={practitionerAId} onValueChange={setPractitionerAId}>
              <SelectTrigger><SelectValue placeholder="Select practitioner" /></SelectTrigger>
              <SelectContent>
                {practitioners.filter(p => p.id !== practitionerBId).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Practitioner B</label>
            <Select value={practitionerBId} onValueChange={setPractitionerBId}>
              <SelectTrigger><SelectValue placeholder="Select practitioner" /></SelectTrigger>
              <SelectContent>
                {practitioners.filter(p => p.id !== practitionerAId).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {practA && practB && (
          <>
            {/* Header Cards */}
            <div className="grid grid-cols-2 gap-6">
              {[practA, practB].map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={p.photoUrl || undefined} />
                    <AvatarFallback className="text-xs">{getInitials(p.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <Badge variant="outline" className="text-xs">{p.role}</Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Comparison Chart */}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="metric" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey={practA.name} fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey={practB.name} fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Metrics Table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="data-table text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th>Metric</th>
                    <th>{practA.name}</th>
                    <th className="text-center w-12">Gap</th>
                    <th>{practB.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => {
                    const diff = m.valueA - m.valueB;
                    const aWins = diff > 0 === m.higherIsBetter;
                    const bWins = diff < 0 === !m.higherIsBetter;
                    const isEqual = Math.abs(diff) < 0.01;

                    return (
                      <tr key={m.label}>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{m.label}</span>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help flex-shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs text-xs">
                                {m.info}
                              </TooltipContent>
                            </UITooltip>
                          </div>
                        </td>
                        <td className={cn(!isEqual && aWins && 'text-green-600 font-semibold', !isEqual && !aWins && 'text-muted-foreground')}>
                          {formatMetric(m.valueA, m.format)}
                        </td>
                        <td className="text-center">
                          <GapIndicator valueA={m.valueA} valueB={m.valueB} format={m.format} higherIsBetter={m.higherIsBetter} />
                        </td>
                        <td className={cn(!isEqual && bWins && 'text-green-600 font-semibold', !isEqual && !bWins && 'text-muted-foreground')}>
                          {formatMetric(m.valueB, m.format)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Gap Analysis Insights */}
            {insights.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-4">
                <h4 className="text-sm font-medium mb-2">Key Differences</h4>
                <ul className="space-y-1.5">
                  {insights.map((insight, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
