import { useState, useEffect } from 'react';
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
import { TreatmentServiceStep, TreatmentServiceStepUpdate } from '@/types/treatment-service-step';
import { Treatment } from '@/types/treatment';

interface TreatmentServiceStepFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: TreatmentServiceStep | null;
  treatments: Treatment[];
  onSubmit: (data: TreatmentServiceStepUpdate) => void;
  isLoading?: boolean;
}

export function TreatmentServiceStepFormDialog({
  open,
  onOpenChange,
  step,
  treatments,
  onSubmit,
  isLoading,
}: TreatmentServiceStepFormDialogProps) {
  const [formData, setFormData] = useState({
    mapped_treatment_id: 'none' as string,
    is_main_treatment_step: false,
    completion_time_used_mins: '' as number | string,
  });

  useEffect(() => {
    if (open && step) {
      setFormData({
        mapped_treatment_id: step.mapped_treatment_id || 'none',
        is_main_treatment_step: step.is_main_treatment_step || false,
        completion_time_used_mins: step.completion_time_used_mins ?? '',
      });
    }
  }, [step, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      mapped_treatment_id: formData.mapped_treatment_id === 'none' ? null : formData.mapped_treatment_id,
      is_main_treatment_step: formData.is_main_treatment_step,
      completion_time_used_mins:
        formData.completion_time_used_mins === '' ? null : Number(formData.completion_time_used_mins),
    });
  };

  if (!open || !step) return null;

  // A step can't be mapped under itself, and can't be mapped under a
  // treatment it's already mapped to via another step's mapping -- a step
  // can only ever belong to one treatment, but a treatment can have as many
  // steps as needed, so no other filtering is required here.
  const treatmentOptions = treatments
    .filter((t) => t.id !== step.treatment_id)
    .map((t) => ({ value: t.id, label: t.treatment_name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Edit Treatment Step</DialogTitle>
          <DialogDescription>
            Update the step settings for {step.service_name}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Treatment Code</Label>
              <Input value={step.service_code || '-'} disabled />
            </div>
            <div>
              <Label>Treatment Name</Label>
              <Input value={step.service_name} disabled />
            </div>
          </div>

          <div>
            <Label htmlFor="mapped_treatment_id">Map to Treatment</Label>
            <Select
              value={formData.mapped_treatment_id}
              onValueChange={(value) => setFormData({ ...formData, mapped_treatment_id: value })}
            >
              <SelectTrigger id="mapped_treatment_id">
                <SelectValue placeholder="Select a treatment..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unmapped</SelectItem>
                {treatmentOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="completion_time_used_mins">Completion Time Used (mins)</Label>
            <Input
              id="completion_time_used_mins"
              type="number"
              min="0"
              value={formData.completion_time_used_mins}
              onChange={(e) => setFormData({ ...formData, completion_time_used_mins: e.target.value })}
              placeholder="0"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="is_main_treatment_step" className="cursor-pointer">
              Is Main Treatment Step
            </Label>
            <Switch
              id="is_main_treatment_step"
              checked={formData.is_main_treatment_step}
              onCheckedChange={(checked) => setFormData({ ...formData, is_main_treatment_step: checked })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
