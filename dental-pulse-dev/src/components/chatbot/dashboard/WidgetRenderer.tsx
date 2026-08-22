import { Component, type ReactNode } from 'react';
import type { DashboardWidget } from '@/hooks/useChatbot';
import { KpiCardWidget } from './widgets/KpiCardWidget';
import { BarChartWidget } from './widgets/BarChartWidget';
import { LineChartWidget } from './widgets/LineChartWidget';
import { PieChartWidget } from './widgets/PieChartWidget';
import { DataTableWidget } from './widgets/DataTableWidget';
import { TextSummaryWidget } from './widgets/TextSummaryWidget';
import { WidgetActions } from './WidgetActions';

// A failing widget degrades to a neutral "Unavailable" state instead of
// taking down the whole dashboard (failure-isolation rule).
class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    if (import.meta.env.DEV) console.error('[ChatDashboard] widget render failed:', err);
  }
  render() {
    if (this.state.failed) {
      return <p className="text-xs text-muted-foreground py-6 text-center">Widget unavailable.</p>;
    }
    return this.props.children;
  }
}

const BODY: Record<string, (w: DashboardWidget) => ReactNode> = {
  bar: (w) => <BarChartWidget widget={w} />,
  line: (w) => <LineChartWidget widget={w} />,
  pie: (w) => <PieChartWidget widget={w} />,
  table: (w) => <DataTableWidget widget={w} />,
  text: (w) => <TextSummaryWidget widget={w} />,
};

export function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  // KPI tiles are their own self-contained card; everything else spans the
  // full row of the canvas grid.
  if (widget.type === 'kpi') {
    return (
      <div className="col-span-1">
        <WidgetErrorBoundary><KpiCardWidget widget={widget} /></WidgetErrorBoundary>
      </div>
    );
  }

  const render = BODY[widget.type];
  if (!render) return null;

  const downloadable = widget.type === 'table' || widget.type === 'bar'
    || widget.type === 'line' || widget.type === 'pie';

  return (
    <div className="col-span-2 xl:col-span-4 rounded-xl border border-border/60 bg-card text-card-foreground shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate" title={widget.title}>{widget.title}</p>
          {widget.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1" title={widget.description}>
              {widget.description}
            </p>
          )}
        </div>
        <WidgetActions widget={widget} downloadable={downloadable} />
      </div>
      <WidgetErrorBoundary>{render(widget)}</WidgetErrorBoundary>
    </div>
  );
}
