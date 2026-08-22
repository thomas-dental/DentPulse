import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus, Loader2 } from "lucide-react";
import {
  AccountMultiSelect,
  AccountOption,
} from "@/components/settings/AccountMultiSelect";
import { useProviderSpecialTreatments } from "@/hooks/useProviderSpecialTreatments";

interface SpecialTreatmentsCardProps {
  providerId: string | undefined;
  treatmentOptions: AccountOption[];
}

interface SpecialTreatmentRow {
  _key: number;
  groupName: string;
  associateSplitPercentage: number;
  treatmentIds: string[];
}

function emptyRow(key: number): SpecialTreatmentRow {
  return { _key: key, groupName: "", associateSplitPercentage: 0, treatmentIds: [] };
}

export function SpecialTreatmentsCard({
  providerId,
  treatmentOptions,
}: SpecialTreatmentsCardProps) {
  const { groups, isLoading, saveGroups, isSaving } =
    useProviderSpecialTreatments(providerId);

  const nextKey = useRef(0);
  const [rows, setRows] = useState<SpecialTreatmentRow[]>([]);
  const seededFor = useRef<string | undefined>(undefined);

  // Seed the editor once per provider once its saved groups have loaded —
  // re-running on every `groups` change would clobber in-progress edits.
  useEffect(() => {
    if (isLoading) return;
    if (seededFor.current === providerId) return;
    seededFor.current = providerId;

    if (groups.length > 0) {
      setRows(
        groups.map((g) => ({
          _key: nextKey.current++,
          groupName: g.group_name,
          associateSplitPercentage: g.associate_split_percentage,
          treatmentIds: g.treatment_ids,
        })),
      );
    } else {
      setRows([emptyRow(nextKey.current++)]);
    }
  }, [providerId, isLoading, groups]);

  const updateRow = (key: number, patch: Partial<SpecialTreatmentRow>) => {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow(nextKey.current++)]);
  };

  const removeRow = (key: number) => {
    setRows((prev) => {
      const next = prev.filter((r) => r._key !== key);
      return next.length > 0 ? next : [emptyRow(nextKey.current++)];
    });
  };

  const handleSave = () => {
    if (!providerId) return;
    saveGroups({
      providerId,
      groups: rows.map((r) => ({
        groupName: r.groupName,
        associateSplitPercentage: r.associateSplitPercentage,
        treatmentIds: r.treatmentIds,
      })),
    });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4 rounded-md border border-border p-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Special Treatments
            </h3>
            <p className="text-sm text-muted-foreground">
              Configure associate split percentage per treatment group.
            </p>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-2">
              Loading special treatments...
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row, index) => (
                <div
                  key={row._key}
                  className="grid grid-cols-1 md:grid-cols-[2fr_1.5fr_2fr_auto] gap-4 items-end pb-3 border-b border-border last:border-b-0"
                >
                  <div className="space-y-2">
                    {index === 0 && <Label>Group Name</Label>}
                    <Input
                      value={row.groupName}
                      onChange={(e) =>
                        updateRow(row._key, { groupName: e.target.value })
                      }
                      placeholder="e.g. Fillings"
                    />
                  </div>
                  <div className="space-y-2">
                    {index === 0 && <Label>Associate Split (%)</Label>}
                    <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={row.associateSplitPercentage}
                        onChange={(e) =>
                          updateRow(row._key, {
                            associateSplitPercentage: Number(e.target.value),
                          })
                        }
                        className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <span className="px-3 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {index === 0 && <Label>Treatments</Label>}
                    <AccountMultiSelect
                      options={treatmentOptions}
                      value={row.treatmentIds}
                      onChange={(value) =>
                        updateRow(row._key, { treatmentIds: value })
                      }
                      placeholder="Select Treatments"
                      itemNoun="treatment"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Add group"
                      onClick={addRow}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Remove group"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeRow(row._key)}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!providerId || isSaving}
              className="gap-2 text-white"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Special Treatment
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
