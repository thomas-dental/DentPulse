import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2 } from 'lucide-react';
import { Treatment } from '@/types/treatment';
import { TreatmentServiceStep } from '@/types/treatment-service-step';

interface StepRow {
  key: string;
  stepId: string;
  completionTime: string;
  isMain: boolean;
}

interface TreatmentAddStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treatment: Treatment;
  allSteps: TreatmentServiceStep[];
  onSave: (
    rows: { id: string; completion_time_used_mins: number | null; is_main_treatment_step: boolean }[],
    removedStepIds: string[],
  ) => Promise<void>;
  isSaving?: boolean;
}

const emptyRow = (): StepRow => ({
  key: crypto.randomUUID(),
  stepId: '',
  completionTime: '',
  isMain: false,
});

export function TreatmentAddStepsDialog({
  open,
  onOpenChange,
  treatment,
  allSteps,
  onSave,
  isSaving,
}: TreatmentAddStepsDialogProps) {
  const [rows, setRows] = useState<StepRow[]>([]);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const included = allSteps.filter((s) => s.mapped_treatment_id === treatment.id);
    const initialRows = included.map((s) => ({
      key: s.id,
      stepId: s.id,
      completionTime: s.completion_time_used_mins != null ? String(s.completion_time_used_mins) : '',
      isMain: s.is_main_treatment_step,
    }));
    setRows(initialRows.length > 0 ? initialRows : [emptyRow()]);
    setOriginalStepIds(included.map((s) => s.id));
  }, [open, treatment.id, allSteps]);

  // A step is selectable for this treatment if it isn't the treatment's own
  // step, and it's either unmapped or already mapped to this treatment --
  // once a step belongs to another treatment it disappears from this list.
  const selectableSteps = useMemo(
    () =>
      allSteps.filter(
        (s) =>
          s.treatment_id !== treatment.id &&
          (s.mapped_treatment_id === null || s.mapped_treatment_id === treatment.id),
      ),
    [allSteps, treatment.id],
  );

  const optionsForRow = (rowKey: string) => {
    const selectedElsewhere = new Set(
      rows.filter((r) => r.key !== rowKey && r.stepId).map((r) => r.stepId),
    );
    return selectableSteps.filter((s) => !selectedElsewhere.has(s.id));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : [emptyRow()]));
  };

  const updateRow = (key: string, patch: Partial<StepRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    const filled = rows.filter((r) => r.stepId);
    const finalStepIds = new Set(filled.map((r) => r.stepId));
    const removedStepIds = originalStepIds.filter((id) => !finalStepIds.has(id));

    await onSave(
      filled.map((r) => ({
        id: r.stepId,
        completion_time_used_mins: r.completionTime === '' ? null : Number(r.completionTime),
        is_main_treatment_step: r.isMain,
      })),
      removedStepIds,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[750px]">
        <DialogHeader>
          <DialogTitle>Add Steps</DialogTitle>
          <DialogDescription>
            Build the step list for this treatment. A step already used by another treatment won't show up here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Treatment Name</Label>
            <Input value={treatment.treatment_name} disabled />
          </div>
          <div>
            <Label>Treatment Code</Label>
            <Input value={treatment.treatment_code || '-'} disabled />
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Treatment Step</TableHead>
                <TableHead className="w-[160px] text-right">Completion Time (mins)</TableHead>
                <TableHead className="w-[140px] text-center">Is Main Treatment</TableHead>
                <TableHead className="w-[60px] text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Select value={row.stepId} onValueChange={(value) => updateRow(row.key, { stepId: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a step..." />
                      </SelectTrigger>
                      <SelectContent>
                        {optionsForRow(row.key).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.service_name}
                            {s.service_code ? ` (${s.service_code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      value={row.completionTime}
                      onChange={(e) => updateRow(row.key, { completionTime: e.target.value })}
                      placeholder="0"
                      className="text-right"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={row.isMain}
                      onCheckedChange={(checked) => updateRow(row.key, { isMain: checked })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-fit gap-2">
          <Plus className="h-4 w-4" />
          Add Row
        </Button>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
