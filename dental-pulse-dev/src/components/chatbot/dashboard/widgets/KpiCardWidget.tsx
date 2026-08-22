import { formatValue, type WidgetUnit } from '../format';
import { WidgetActions } from '../WidgetActions';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function KpiCardWidget({ widget }: { widget: DashboardWidget }) {
  const value = widget.data?.value ?? 0;
  const unit = widget.data?.unit as WidgetUnit;
  // No source records → genuinely "no data": show an em-dash like the
  // reference UI's empty tile, rather than a misleading £0 / 0.
  const records = widget.meta?.records;
  const noData = (value === 0) && (records === 0 || records == null);
  const display = noData ? '—' : formatValue(value, unit);

  return (
    <div className="rounded-xl border border-border/60 bg-card text-card-foreground shadow-sm p-4 h-full flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className={`text-3xl font-bold tracking-tight ${noData ? 'text-muted-foreground/50' : 'text-foreground'}`}>
          {display}
        </p>
        <WidgetActions widget={widget} />
      </div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mt-1.5">
        {widget.title}
      </p>
      {widget.description && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
          {widget.description}
        </p>
      )}
    </div>
  );
}
