import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { DashboardStep } from '@/hooks/useChatbot';

/**
 * Static "what the assistant did" checklist, shown in the chat column under
 * the answer (mirrors the README's streaming tool-step ticks — our backend is
 * single-response so these are reported, not streamed live).
 */
export function ToolSteps({ steps }: { steps?: DashboardStep[] }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {steps.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {s.ok
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            : <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
          <span className="truncate">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
