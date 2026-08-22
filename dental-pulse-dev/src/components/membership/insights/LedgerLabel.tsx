import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CalcRow {
  label: string;
  value: string;
  isTotal?: boolean;
}

/** A ledger row's label with an optional ⓘ "live calculation" popover — a
 *  small worked sum (visits, minutes, rate, total), styled like the app's
 *  own ledger tables, not a paragraph of description. */
export function LedgerLabel({ label, calc }: { label: string; calc?: CalcRow[] }) {
  if (!calc || calc.length === 0) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
          </TooltipTrigger>
          <TooltipContent side="top" className="w-auto min-w-56">
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
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
