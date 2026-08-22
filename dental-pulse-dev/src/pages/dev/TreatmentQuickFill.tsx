/**
 * Hidden dev tool — not in any nav menu.
 * URL: /dev/treatment-quick-fill
 *
 * Pick a location, see its treatments, generate realistic random values for
 * the editable fields, preview them, save in bulk. Only fills fields that
 * are currently 0 / null — never overwrites real values.
 */

import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Wand2, Save, RefreshCw } from 'lucide-react';
import { useLocations } from '@/hooks/useLocations';
import { useTreatments } from '@/hooks/useTreatments';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Treatment } from '@/types/treatment';

type RandomFields = {
  price: number;
  duration_minutes: number;
  therapist_time_mins: number;
  lab_bill: number;
  lab_bill_discount: number;
  material_cost: number;
  percent_fees: number;
  therapist_pay_rate: number;
  hourly_rate: number;
  finance_fee: number;
  average_time_minutes: number;
};

const FIELD_LABELS: Record<keyof RandomFields, string> = {
  price: 'Amount',
  duration_minutes: 'Dentist Mins',
  therapist_time_mins: 'Therapist Mins',
  lab_bill: 'Lab Bill',
  lab_bill_discount: 'Lab Discount',
  material_cost: 'Material',
  percent_fees: 'Assoc %',
  therapist_pay_rate: 'Therapist £/hr',
  hourly_rate: 'Op £/hr',
  finance_fee: 'Finance %',
  average_time_minutes: 'Completion Mins',
};

const FIELD_KEYS = Object.keys(FIELD_LABELS) as (keyof RandomFields)[];

const randInt = (min: number, max: number, step = 1) => {
  const range = Math.floor((max - min) / step) + 1;
  return min + Math.floor(Math.random() * range) * step;
};

const randFloat = (min: number, max: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round((min + Math.random() * (max - min)) * factor) / factor;
};

function generateRandomValues(): RandomFields {
  const dentistMins = randInt(15, 180, 5);
  return {
    price: randInt(30, 3000, 5),
    duration_minutes: dentistMins,
    therapist_time_mins: randInt(0, 90, 5),
    lab_bill: randInt(0, 500, 5),
    lab_bill_discount: randFloat(0, 30, 1),
    material_cost: Math.round(randFloat(0.5, 100, 2) * 2) / 2,
    percent_fees: randFloat(30, 50, 1),
    therapist_pay_rate: randInt(20, 40, 1),
    hourly_rate: randInt(80, 150, 5),
    finance_fee: randFloat(0, 5, 1),
    average_time_minutes:
      Math.round((dentistMins * (0.9 + Math.random() * 0.2)) / 5) * 5,
  };
}

interface PreviewRow {
  id: string;
  treatment_name: string;
  treatment_code: string | null;
  current: Partial<RandomFields>;
  proposed: RandomFields;
  toUpdate: Partial<RandomFields>;
}

function buildPreview(treatments: Treatment[]): PreviewRow[] {
  return treatments.map((t) => {
    const current: Partial<RandomFields> = {};
    FIELD_KEYS.forEach((k) => {
      const v = (t as any)[k];
      if (typeof v === 'number') current[k] = v;
    });

    const proposed = generateRandomValues();
    const toUpdate: Partial<RandomFields> = {};
    FIELD_KEYS.forEach((k) => {
      const cur = current[k];
      if (cur == null || cur === 0) {
        toUpdate[k] = proposed[k];
      }
    });

    return {
      id: t.id,
      treatment_name: t.treatment_name,
      treatment_code: t.treatment_code,
      current,
      proposed,
      toUpdate,
    };
  });
}

export default function TreatmentQuickFill() {
  const { locations, isLoading: isLoadingLocations } = useLocations();
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { treatments, isLoading: isLoadingTreatments } = useTreatments({
    locationId: selectedLocationId,
    includeInactive: true,
  });

  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const totalToUpdateCount = useMemo(
    () =>
      preview
        ? preview.reduce((s, r) => s + Object.keys(r.toUpdate).length, 0)
        : 0,
    [preview],
  );
  const treatmentsAffected = useMemo(
    () =>
      preview ? preview.filter((r) => Object.keys(r.toUpdate).length > 0).length : 0,
    [preview],
  );

  const generate = () => {
    if (!treatments || treatments.length === 0) {
      toast.error('No treatments for this location to fill');
      return;
    }
    setPreview(buildPreview(treatments));
  };

  const reroll = () => {
    if (!preview) return;
    setPreview(buildPreview(treatments));
  };

  const save = async () => {
    if (!preview) return;
    const rowsToUpdate = preview.filter(
      (r) => Object.keys(r.toUpdate).length > 0,
    );
    if (rowsToUpdate.length === 0) {
      toast.info('No empty fields to fill — every treatment already has values.');
      return;
    }

    setIsSaving(true);
    let success = 0;
    let failed = 0;

    for (const row of rowsToUpdate) {
      const { error } = await (supabase as any)
        .from('treatments')
        .update(row.toUpdate)
        .eq('id', row.id);
      if (error) {
        console.error('[QuickFill] update failed for', row.id, error);
        failed += 1;
      } else {
        success += 1;
      }
    }

    setIsSaving(false);
    if (failed === 0) {
      toast.success(`Updated ${success} treatments (${totalToUpdateCount} fields)`);
    } else {
      toast.error(`Updated ${success}, failed ${failed}. See console for errors.`);
    }
    queryClient.invalidateQueries({ queryKey: ['treatments'] });
    setPreview(null);
  };

  const formatVal = (k: keyof RandomFields, v: number | undefined) => {
    if (v == null) return '—';
    if (k === 'price' || k === 'lab_bill' || k === 'material_cost' || k === 'therapist_pay_rate' || k === 'hourly_rate') {
      return `£${v}`;
    }
    if (k === 'lab_bill_discount' || k === 'percent_fees' || k === 'finance_fee') {
      return `${v}%`;
    }
    return `${v}m`;
  };

  return (
    <MainLayout userRole="admin">
      <Helmet><title>Treatment Quick-Fill (dev)</title></Helmet>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Treatment Quick-Fill</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Hidden dev tool. Pick a location, generate random realistic values for
            empty treatment fields, preview, then save in bulk. Existing non-zero
            values are never overwritten.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Select location</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedLocationId ?? ''}
              onValueChange={(v) => {
                setSelectedLocationId(v || null);
                setPreview(null);
              }}
              disabled={isLoadingLocations}
            >
              <SelectTrigger className="w-full md:w-[480px]">
                <SelectValue placeholder={isLoadingLocations ? 'Loading…' : 'Pick a location'} />
              </SelectTrigger>
              <SelectContent>
                {(locations ?? []).map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.location_name}
                    {loc.city ? ` (${loc.city})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedLocationId && (
              <p className="text-xs text-muted-foreground mt-2">
                {isLoadingTreatments
                  ? 'Loading treatments…'
                  : `${treatments.length} treatments available for this location.`}
              </p>
            )}
          </CardContent>
        </Card>

        {selectedLocationId && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">2. Preview &amp; save</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generate}
                  disabled={isLoadingTreatments || treatments.length === 0 || isSaving}
                  className="gap-1"
                >
                  <Wand2 className="w-4 h-4" />
                  {preview ? 'Regenerate preview' : 'Generate preview'}
                </Button>
                {preview && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={reroll}
                      disabled={isSaving}
                      className="gap-1"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Re-roll values
                    </Button>
                    <Button
                      size="sm"
                      onClick={save}
                      disabled={isSaving || treatmentsAffected === 0}
                      className="gap-1"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save {treatmentsAffected} treatments
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!preview && (
                <p className="text-sm text-muted-foreground">
                  Click <em>Generate preview</em> to see the random values that
                  will be written. Nothing is saved until you click <em>Save</em>.
                </p>
              )}

              {preview && (
                <>
                  <div className="text-xs text-muted-foreground mb-2">
                    {treatmentsAffected} of {preview.length} treatments will be
                    updated, filling {totalToUpdateCount} empty fields. Treatments
                    with no empty fields appear greyed out.
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Treatment</TableHead>
                          {FIELD_KEYS.map((k) => (
                            <TableHead key={k} className="text-right">
                              {FIELD_LABELS[k]}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.map((row) => {
                          const willChange = Object.keys(row.toUpdate).length > 0;
                          return (
                            <TableRow
                              key={row.id}
                              className={willChange ? '' : 'opacity-50'}
                            >
                              <TableCell className="text-sm">
                                <div className="font-medium">{row.treatment_name}</div>
                                {row.treatment_code && (
                                  <div className="text-xs text-muted-foreground">
                                    {row.treatment_code}
                                  </div>
                                )}
                              </TableCell>
                              {FIELD_KEYS.map((k) => {
                                const cur = row.current[k];
                                const newV = (row.toUpdate as any)[k];
                                const isEmpty = cur == null || cur === 0;
                                const isUpdating = newV !== undefined;
                                return (
                                  <TableCell
                                    key={k}
                                    className={
                                      'text-right text-xs ' +
                                      (isUpdating
                                        ? 'text-emerald-600 font-medium'
                                        : isEmpty
                                          ? 'text-muted-foreground'
                                          : '')
                                    }
                                  >
                                    {isUpdating ? formatVal(k, newV) : formatVal(k, cur)}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
