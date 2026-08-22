import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatValue, type WidgetUnit } from '../format';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function DataTableWidget({ widget }: { widget: DashboardWidget }) {
  const columns = widget.data?.columns || [];
  const rows = widget.data?.rows || [];
  const unit = widget.data?.unit as WidgetUnit;
  const valueCol = widget.data?.valueColumnIndex;

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No rows.</p>;
  }

  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border border-border/50">
      <Table>
        <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className={`h-8 px-2.5 text-[11px] ${i === valueCol ? 'text-right' : ''}`}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((cell, ci) => (
                <TableCell key={ci} className={`p-2 px-2.5 text-xs ${ci === valueCol ? 'text-right tabular-nums font-medium' : ''}`}>
                  {ci === valueCol && typeof cell === 'number' ? formatValue(cell, unit) : String(cell ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
