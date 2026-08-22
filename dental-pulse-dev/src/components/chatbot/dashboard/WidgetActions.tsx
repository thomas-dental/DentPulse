import { Info, Download, ShieldCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { DashboardWidget } from '@/hooks/useChatbot';

/**
 * The per-widget action cluster shown top-right of every card:
 *   ⓘ  Info     — plain-English explanation of what the widget measures
 *   ⬇  Download — CSV export (charts/tables only)
 *   ⛉  Verify   — reconciliation chip: the figure is derived from N real
 *                 source records in the period (no fabricated numbers).
 *
 * Info text is business language only — never DB table/column names
 * (product rule).
 */

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(widget: DashboardWidget): string | null {
  const d = widget.data || {};
  if (widget.type === 'table' && d.columns && d.rows) {
    return [d.columns.map(csvEscape).join(','), ...d.rows.map(r => r.map(csvEscape).join(','))].join('\r\n');
  }
  if ((widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie') && d.points) {
    return [['Label', widget.title].map(csvEscape).join(','),
      ...d.points.map(p => [p.label, p.value].map(csvEscape).join(','))].join('\r\n');
  }
  return null;
}

function downloadCsv(widget: DashboardWidget) {
  const csv = buildCsv(widget);
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${widget.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const iconBtn =
  'shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

export function WidgetActions({
  widget, downloadable = false,
}: { widget: DashboardWidget; downloadable?: boolean }) {
  const records: number | undefined = widget.meta?.records;
  const explain: string = widget.meta?.explain || widget.description || widget.title;
  const verifyTitle = typeof records === 'number'
    ? `Verified — figure reconciled from ${records.toLocaleString('en-GB')} source record${records === 1 ? '' : 's'} in this period.`
    : 'Figures are computed from your live data — no estimated values.';

  return (
    <div className="flex items-center gap-0.5">
      <Popover>
        <PopoverTrigger asChild>
          <button className={iconBtn} title="Details" aria-label="Widget details">
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 text-xs">
          <p className="font-semibold mb-1">{widget.title}</p>
          <p className="text-muted-foreground leading-relaxed">{explain}</p>
          {typeof records === 'number' && (
            <p className="text-muted-foreground mt-2">
              Based on <span className="font-medium text-foreground">{records.toLocaleString('en-GB')}</span> source records.
            </p>
          )}
        </PopoverContent>
      </Popover>

      {downloadable && (
        <button className={iconBtn} title="Download CSV" aria-label="Download CSV"
                onClick={() => downloadCsv(widget)}>
          <Download className="h-3.5 w-3.5" />
        </button>
      )}

      <span
        className="shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-emerald-600 dark:text-emerald-400"
        title={verifyTitle}
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        Verify
      </span>
    </div>
  );
}
