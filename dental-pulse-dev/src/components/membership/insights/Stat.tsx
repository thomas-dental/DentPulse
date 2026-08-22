import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CalcRow } from "./LedgerLabel";

export function Stat({
  k,
  v,
  note,
  tone,
  tooltip,
  calc,
}: {
  k: string;
  v: string;
  note: string;
  tone?: "up" | "down";
  /** Plain-language "how is this worked out" text shown behind an ⓘ icon.
   *  When `calc` is ALSO given, this renders as a muted caveat line under
   *  the calculation rows (e.g. a methodology proxy warning) — prefer
   *  `calc` for anything with real, checkable numbers behind it. */
  tooltip?: string;
  /** The live numbers this figure is built from, as calculation rows (not
   *  prose) — e.g. count → rate → total. Takes priority over `tooltip`. */
  calc?: CalcRow[];
}) {
  const hasPopover = (calc && calc.length > 0) || !!tooltip;
  return (
    <div className="mpi-stat">
      <div className="k flex items-center gap-1">
        {k}
        {hasPopover && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
              </TooltipTrigger>
              <TooltipContent side="top" className={calc && calc.length > 0 ? "w-auto min-w-56" : "max-w-[260px]"}>
                {calc && calc.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {calc.map((row, i) => (
                      <div
                        key={i}
                        className={`flex items-baseline justify-between gap-4 ${row.isTotal ? "mt-1 pt-1 border-t border-border font-semibold" : "text-muted-foreground"}`}
                      >
                        <span className="whitespace-nowrap">{row.label}</span>
                        <span className="whitespace-nowrap tabular-nums text-popover-foreground">{row.value}</span>
                      </div>
                    ))}
                    {tooltip && (
                      <div className="mt-1 pt-1 border-t border-border text-muted-foreground max-w-[260px]">{tooltip}</div>
                    )}
                  </div>
                ) : (
                  tooltip
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="v num">{v}</div>
      <div className={`n num ${tone === "up" ? "mpi-up" : tone === "down" ? "mpi-down" : ""}`}>{note}</div>
    </div>
  );
}
