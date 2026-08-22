import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface ColumnOption {
  id: string;
  label: string;
}

interface EditColumnsPopoverProps {
  columns: ColumnOption[];
  visibleColumns: Record<string, boolean>;
  onColumnToggle: (columnId: string) => void;
}

export function EditColumnsPopover({
  columns,
  visibleColumns,
  onColumnToggle,
}: EditColumnsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0"
          title="Edit Columns"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-foreground">Edit Columns</div>
          <div className="space-y-2">
            {columns.map((column) => (
              <div key={column.id} className="flex items-center gap-3">
                <Checkbox
                  id={column.id}
                  checked={visibleColumns[column.id] ?? true}
                  onCheckedChange={() => onColumnToggle(column.id)}
                />
                <Label
                  htmlFor={column.id}
                  className="flex-1 cursor-pointer font-normal text-sm"
                >
                  {column.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
