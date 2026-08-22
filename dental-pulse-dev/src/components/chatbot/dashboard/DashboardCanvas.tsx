import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Maximize2, Minimize2 } from 'lucide-react';
import type { DashboardPayload } from '@/hooks/useChatbot';
import { InsightsBanner } from './InsightsBanner';
import { WidgetRenderer } from './WidgetRenderer';

/**
 * Right-pane dashboard canvas for the split chat drawer. Expandable like a
 * Claude artifact: the maximise button promotes it to a full-screen overlay
 * (Esc or the minimise button restores it back into the split pane).
 */
function DashboardBody({ dashboard }: { dashboard: DashboardPayload }) {
  return (
    <div className="space-y-3">
      <InsightsBanner insights={dashboard.insights || []} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {dashboard.widgets.map((w) => (
          <WidgetRenderer key={w.id} widget={w} />
        ))}
      </div>
    </div>
  );
}

function CanvasHeader({
  title, expanded, onToggle,
}: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-2 min-w-0">
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-semibold truncate" title={title}>{title}</p>
      </div>
      <button
        onClick={onToggle}
        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={expanded ? 'Restore' : 'Expand'}
        aria-label={expanded ? 'Restore dashboard' : 'Expand dashboard'}
      >
        {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function DashboardCanvas({
  dashboard, expanded: expandedProp, onExpandedChange,
}: {
  dashboard: DashboardPayload;
  // Controlled by ChatDrawer so it can drop the Sheet's modal scroll-lock
  // while expanded (otherwise react-remove-scroll kills wheel scrolling on
  // the full-screen overlay). Falls back to internal state if uncontrolled.
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = (v: boolean) => {
    if (onExpandedChange) onExpandedChange(v);
    else setInternalExpanded(v);
  };

  useEffect(() => {
    if (!expanded) return;
    // Capture phase + stopPropagation so Esc only restores the canvas and
    // doesn't also bubble to the Radix Sheet (which would close the drawer).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  if (!dashboard || !Array.isArray(dashboard.widgets) || dashboard.widgets.length === 0) {
    return null;
  }

  if (expanded) {
    // The chat drawer is a Radix *modal* Dialog; its scroll-lock
    // (react-remove-scroll) sets `pointer-events: none` on everything
    // portaled outside the dialog. This overlay lives on document.body, so
    // we must explicitly re-enable pointer events or the scrollbar renders
    // but wheel/drag are dead.
    return createPortal(
      <div
        className="fixed inset-0 z-[70] bg-background flex flex-col"
        style={{ pointerEvents: 'auto' }}
        data-chatbot-root
      >
        <CanvasHeader title={dashboard.title} expanded onToggle={() => setExpanded(false)} />
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5"
          style={{ pointerEvents: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="mx-auto max-w-[1200px]">
            <DashboardBody dashboard={dashboard} />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted/20">
      <CanvasHeader title={dashboard.title} expanded={false} onToggle={() => setExpanded(true)} />
      <div className="flex-1 min-h-0 overflow-auto p-3.5">
        <DashboardBody dashboard={dashboard} />
      </div>
    </div>
  );
}
