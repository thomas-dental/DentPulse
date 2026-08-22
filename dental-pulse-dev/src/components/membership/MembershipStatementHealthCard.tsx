import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, UserMinus, Banknote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMembershipStatementInsights, type StatementEventInsight } from '@/hooks/useMembershipStatementInsights';

const fmtGBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

function EventList({ events, showActivity }: {
  events: StatementEventInsight[];
  showActivity: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {events.map(ev => (
        <li key={ev.id} className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <span className="font-medium">{ev.displayName}</span>
            {ev.feeCategory && (
              <span className="text-muted-foreground"> · {ev.feeCategory}</span>
            )}
            {ev.eventDate && (
              <span className="text-muted-foreground"> · {new Date(ev.eventDate + 'T00:00:00').toLocaleDateString('en-GB')}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ev.amount != null && (
              <span className="tabular-nums">{fmtGBP.format(ev.amount)}</span>
            )}
            {showActivity && (
              ev.recentAppointments > 0 ? (
                <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                  Seen in last 60 days
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  No recent visits
                </Badge>
              )
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Practice Plan statement health for the displayed membership month: what the
 * statement actually collected vs its gross value, which payments failed
 * (flagging patients who are still attending — treatment at plan rates while
 * the payment bounced), and who cancelled their plan. The Failed collections
 * and Cancelled patients tiles open their patient list in a popup. Renders
 * nothing when no statement has been uploaded for the month (e.g.
 * Denplan-only orgs).
 */
export function MembershipStatementHealthCard({ month, year, monthLabel, providerLabel }: {
  month: number;
  year: number;
  monthLabel: string;
  providerLabel: string;
}) {
  const { data, isLoading } = useMembershipStatementInsights([{ month, year }]);
  // Which tile's patient list is open in the popup.
  const [expanded, setExpanded] = useState<'failed' | 'cancelled' | null>(null);

  if (isLoading || !data?.hasStatements) return null;

  const tiles: Array<{
    label: string;
    value: string;
    sub: string;
    color: string;
    expandKey?: 'failed' | 'cancelled';
    expandable?: boolean;
  }> = [
    {
      label: 'Collected',
      value: fmtGBP.format(data.totalCollectedValue),
      sub: 'what landed this month',
      color: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Gross plan value',
      value: fmtGBP.format(data.grossValue),
      sub: 'before failed payments',
      color: '',
    },
    {
      label: 'Failed collections',
      value: `${data.failedCount} · ${fmtGBP.format(data.failedValue)}`,
      sub: 'payments that bounced',
      color: data.failedCount > 0 ? 'text-amber-600 dark:text-amber-400' : '',
      expandKey: 'failed',
      expandable: data.failedEvents.length > 0,
    },
    {
      label: 'Cancelled patients',
      value: String(data.cancelledCount),
      sub: 'left the plan this month',
      color: data.cancelledCount > 0 ? 'text-red-600 dark:text-red-400' : '',
      expandKey: 'cancelled',
      expandable: data.cancelledEvents.length > 0,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Banknote className="w-5 h-5" />
          Statement Health — {monthLabel}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          From your {providerLabel} statement{data.statementCount > 1 ? 's' : ''}: what collected, what failed, and who left
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(t => {
            const clickable = !!t.expandable;
            return (
              <button
                key={t.label}
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => setExpanded(t.expandKey!) : undefined}
                className={cn(
                  'rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 px-4 py-3 text-left',
                  clickable && 'cursor-pointer transition-colors hover:border-primary/40 hover:bg-slate-100 dark:hover:bg-slate-900/70',
                )}
              >
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{t.label}</span>
                <div className={cn('text-xl font-bold mt-1 tabular-nums', t.color)}>{t.value}</div>
                <span className="text-xs text-muted-foreground">
                  {clickable ? `${t.sub} — click to view` : t.sub}
                </span>
              </button>
            );
          })}
        </div>

        <Dialog open={expanded !== null} onOpenChange={open => { if (!open) setExpanded(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {expanded === 'failed' ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Failed collections — {monthLabel}
                  </>
                ) : (
                  <>
                    <UserMinus className="w-4 h-4 text-red-500" />
                    Cancelled patients — {monthLabel}
                  </>
                )}
              </DialogTitle>
              <DialogDescription>
                {expanded === 'failed'
                  ? `${data.failedCount} payment${data.failedCount === 1 ? '' : 's'} bounced (${fmtGBP.format(data.failedValue)}) — patients still attending are an arrears risk`
                  : `${data.cancelledCount} patient${data.cancelledCount === 1 ? '' : 's'} left the plan this month`}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              {expanded === 'failed' && <EventList events={data.failedEvents} showActivity />}
              {expanded === 'cancelled' && <EventList events={data.cancelledEvents} showActivity={false} />}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
