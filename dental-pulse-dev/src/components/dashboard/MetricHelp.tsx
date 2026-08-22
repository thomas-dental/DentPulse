import { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

/**
 * A small ⓘ trigger that reveals plain-language "how this is calculated" help for a
 * metric tile. Mirrors the house tooltip pattern (Dashboard / Chairs): an Info icon
 * next to the metric title, business language only (no table/column jargon).
 *
 * Usage: place next to a tile's title.
 *   <div className="flex items-center gap-1.5">
 *     <span>Revenue per Chair</span>
 *     <MetricHelp title="Revenue per Chair">…explanation…</MetricHelp>
 *   </div>
 */
export function MetricHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`How ${title} is calculated`}
            className="text-muted-foreground/70 hover:text-foreground transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="!overflow-visible w-[320px] max-w-[calc(100vw-2rem)] p-4 whitespace-normal break-words"
        >
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
