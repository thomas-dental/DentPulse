import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Calculator, Target, TrendingUp, ChevronsUpDown, Check } from 'lucide-react';
import { useTreatments } from '@/hooks/useTreatments';

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * The "Profit Planning by Treatment" calculator, extracted from the
 * profit-planning-treatment tab in Budget.tsx (lines ~1078-1515) so it can
 * also be mounted as the "Planning" toggle view inside Profit by Treatments.
 * Deliberately not shared/refactored into one source yet — the Budget.tsx
 * tab and this page are still gated by different permission modules
 * (budget vs treatments), so keeping them separate avoids widening access
 * before that's resolved.
 */
export function ProfitPlanningByTreatmentPanel() {
  const { treatments: setupTreatments, isLoading: isLoadingSetupTreatments } = useTreatments();

  const [selectedCaseType, setSelectedCaseType] = useState<string>('');
  const [caseTypeOpen, setCaseTypeOpen] = useState(false);
  const [calcOverrides, setCalcOverrides] = useState({
    treatmentValue: '', materials: '', labBill: '', labBillDiscount: '',
    associatePercent: '', therapistPayPerHour: '', operatingCostPerHour: '',
    financeCostPercent: '', associateCost: '',
  });
  const [timeOverrides, setTimeOverrides] = useState({
    dentistOverride: '', dentistOverrun: '',
    therapistOverride: '', therapistOverrun: '',
  });

  // Available treatments from Treatment Setup
  const caseTypes = useMemo(() => {
    return setupTreatments
      .map(t => {
        const catName = t.category && !('deleted_at' in t.category && t.category.deleted_at)
          ? t.category.name : null;
        return { id: t.id, name: t.treatment_name, category: catName };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [setupTreatments]);

  // Defaults from Treatment Setup values
  const categoryDefaults = useMemo(() => {
    if (!selectedCaseType) return null;
    const t = setupTreatments.find(t => t.id === selectedCaseType);
    if (!t) return null;
    return {
      treatmentValue: t.price ?? 0,
      materials: t.material_cost ?? 0,
      labBill: t.lab_bill ?? 0,
      labBillDiscount: t.lab_bill_discount ?? 0,
      associatePercent: t.percent_fees ?? 0,
      therapistPayPerHour: t.therapist_pay_rate ?? 0,
      operatingCostPerHour: t.hourly_rate ?? 0,
      financeCostPercent: t.finance_fee ?? 0,
      dentistMinutes: t.duration_minutes ?? 0,
      therapistMinutes: t.therapist_time_mins ?? 0,
    };
  }, [setupTreatments, selectedCaseType]);

  // Reset overrides when case type changes; pre-fill Treatment Value with default
  useEffect(() => {
    const t = setupTreatments.find(t => t.id === selectedCaseType);
    setCalcOverrides({
      treatmentValue: t ? String(t.price ?? 0) : '',
      materials: '', labBill: '', labBillDiscount: '',
      associatePercent: '', therapistPayPerHour: '', operatingCostPerHour: '',
      financeCostPercent: '', associateCost: '',
    });
    setTimeOverrides({
      dentistOverride: '', dentistOverrun: '',
      therapistOverride: '', therapistOverrun: '',
    });
  }, [selectedCaseType, setupTreatments]);

  // Helper: get effective value (override if typed, else default)
  const getEff = (override: string, defaultVal: number) =>
    override !== '' ? parseFloat(override) || 0 : defaultVal;

  const calcResults = useMemo(() => {
    if (!categoryDefaults) return null;
    const d = categoryDefaults;
    const tv = getEff(calcOverrides.treatmentValue, d.treatmentValue);
    const mat = getEff(calcOverrides.materials, d.materials);
    const lab = getEff(calcOverrides.labBill, d.labBill);
    const labDisc = getEff(calcOverrides.labBillDiscount, d.labBillDiscount);
    const assocPct = getEff(calcOverrides.associatePercent, d.associatePercent);
    const thPay = getEff(calcOverrides.therapistPayPerHour, d.therapistPayPerHour);
    const opCostHr = getEff(calcOverrides.operatingCostPerHour, d.operatingCostPerHour);
    const finPct = getEff(calcOverrides.financeCostPercent, d.financeCostPercent);
    const assocCostDirect = calcOverrides.associateCost !== '' ? parseFloat(calcOverrides.associateCost) || 0 : null;

    const effectiveLabBill = lab * (1 - labDisc / 100);
    const assocCost = assocCostDirect !== null ? assocCostDirect : (tv - lab) * assocPct / 100;
    const financeCost = tv * finPct / 100;

    // Effective values for variance display
    const effectiveAssocCost = assocCost;

    // Time
    const dentistPlanned = getEff(timeOverrides.dentistOverride, d.dentistMinutes);
    const therapistPlanned = getEff(timeOverrides.therapistOverride, d.therapistMinutes);
    const dentistOverrun = timeOverrides.dentistOverrun !== '' ? parseFloat(timeOverrides.dentistOverrun) || 0 : 0;
    const therapistOverrun = timeOverrides.therapistOverrun !== '' ? parseFloat(timeOverrides.therapistOverrun) || 0 : 0;
    const dentistTotal = dentistPlanned + dentistOverrun;
    const therapistTotal = therapistPlanned + therapistOverrun;
    const totalPlannedMin = dentistPlanned + therapistPlanned;
    const totalMinWithOverrun = dentistTotal + therapistTotal;

    // Time-based costs
    const therapistCostPlanned = thPay * (therapistPlanned / 60);
    const therapistCostOverrun = thPay * (therapistTotal / 60);
    const opCostPlanned = opCostHr * (dentistPlanned / 60);
    const opCostOverrun = opCostHr * (dentistTotal / 60);

    // -- Associate completes work --
    const assocPlannedProfit = tv - mat - effectiveLabBill - assocCost - therapistCostPlanned - opCostPlanned - financeCost;
    const assocOverrunProfit = tv - mat - effectiveLabBill - assocCost - therapistCostOverrun - opCostOverrun - financeCost;
    const assocReduction = assocPlannedProfit - assocOverrunProfit;

    // -- Principal completes work (no associate cost) --
    const princPlannedProfit = tv - mat - effectiveLabBill - therapistCostPlanned - opCostPlanned - financeCost;
    const princOverrunProfit = tv - mat - effectiveLabBill - therapistCostOverrun - opCostOverrun - financeCost;
    const princReduction = princPlannedProfit - princOverrunProfit;

    const pct = (profit: number) => tv !== 0 ? (profit / tv) * 100 : 0;
    const perHr = (profit: number, mins: number) => mins > 0 ? profit / (mins / 60) : 0;

    return {
      effective: {
        treatmentValue: tv, materials: mat, labBill: lab, effectiveLabBill, labBillDiscount: labDisc,
        associatePercent: assocPct, associateCost: effectiveAssocCost, therapistPayPerHour: thPay,
        operatingCostPerHour: opCostHr, financeCostPercent: finPct, financeCost,
      },
      variances: {
        treatmentValue: tv - d.treatmentValue,
        materials: mat - d.materials,
        labBill: lab - d.labBill,
        labBillDiscount: labDisc - d.labBillDiscount,
        associatePercent: assocPct - d.associatePercent,
        therapistPayPerHour: thPay - d.therapistPayPerHour,
        operatingCostPerHour: opCostHr - d.operatingCostPerHour,
        financeCostPercent: finPct - d.financeCostPercent,
        associateCost: effectiveAssocCost - (d.treatmentValue * d.associatePercent / 100),
      },
      time: {
        dentistDefault: d.dentistMinutes, therapistDefault: d.therapistMinutes,
        dentistPlanned, therapistPlanned, dentistOverrun, therapistOverrun,
        dentistTotal, therapistTotal, totalPlannedMin, totalMinWithOverrun,
      },
      associate: {
        plannedProfit: assocPlannedProfit, plannedPct: pct(assocPlannedProfit), plannedPerHr: perHr(assocPlannedProfit, totalPlannedMin),
        overrunProfit: assocOverrunProfit, overrunPct: pct(assocOverrunProfit), overrunPerHr: perHr(assocOverrunProfit, totalMinWithOverrun),
        reduction: assocReduction, reductionPct: pct(assocReduction), reductionPerHr: perHr(assocPlannedProfit, totalPlannedMin) - perHr(assocOverrunProfit, totalMinWithOverrun),
      },
      principal: {
        plannedProfit: princPlannedProfit, plannedPct: pct(princPlannedProfit), plannedPerHr: perHr(princPlannedProfit, totalPlannedMin),
        overrunProfit: princOverrunProfit, overrunPct: pct(princOverrunProfit), overrunPerHr: perHr(princOverrunProfit, totalMinWithOverrun),
        reduction: princReduction, reductionPct: pct(princReduction), reductionPerHr: perHr(princPlannedProfit, totalPlannedMin) - perHr(princOverrunProfit, totalMinWithOverrun),
      },
    };
  }, [categoryDefaults, calcOverrides, timeOverrides]);

  if (isLoadingSetupTreatments) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Financials skeleton */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="p-4 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-8 w-24" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-8 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Right: Summary skeleton */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left: Financials */}
      <div className="lg:col-span-3 space-y-6">
        {/* Financials Section */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Calculator className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Financials</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="text-left py-2.5 px-4 font-medium w-[35%]">Associate</th>
                <th className="text-center py-2.5 px-4 font-medium w-[20%]">Defaults</th>
                <th className="text-center py-2.5 px-4 font-medium w-[25%]">Override</th>
                <th className="text-right py-2.5 px-4 font-medium w-[20%]">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Case Type */}
              <tr>
                <td className="py-3 px-4 text-muted-foreground">Case type</td>
                <td className="py-3 px-4" colSpan={3}>
                  <Popover open={caseTypeOpen} onOpenChange={setCaseTypeOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={caseTypeOpen}
                        className="w-full justify-between h-9 font-normal"
                      >
                        {selectedCaseType
                          ? (() => {
                              const ct = caseTypes.find(c => c.id === selectedCaseType);
                              return ct ? `${ct.name}${ct.category ? ` (${ct.category})` : ''}` : 'Select Case Type';
                            })()
                          : 'Select Case Type'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search treatments..." />
                        <CommandList>
                          <CommandEmpty>No treatment found.</CommandEmpty>
                          <CommandGroup className="max-h-64 overflow-y-auto">
                            {caseTypes.map(ct => (
                              <CommandItem
                                key={ct.id}
                                value={`${ct.name} ${ct.category || ''}`}
                                onSelect={() => {
                                  setSelectedCaseType(ct.id === selectedCaseType ? '' : ct.id);
                                  setCaseTypeOpen(false);
                                }}
                              >
                                <Check className={cn('mr-2 h-4 w-4', selectedCaseType === ct.id ? 'opacity-100' : 'opacity-0')} />
                                <span>{ct.name}</span>
                                {ct.category && <span className="ml-1 text-muted-foreground">({ct.category})</span>}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </td>
              </tr>
              {/* Treatment Value */}
              <tr>
                <td className="py-3 px-4">Treatment Value</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.treatmentValue ?? 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={1} value={calcOverrides.treatmentValue} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, treatmentValue: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.treatmentValue !== '' ? formatCurrency(calcResults?.variances.treatmentValue ?? 0) : formatCurrency(0)}
                </td>
              </tr>
              {/* Materials */}
              <tr>
                <td className="py-3 px-4">Materials</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.materials ?? 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={0.01} value={calcOverrides.materials} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, materials: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.materials !== '' ? formatCurrency(calcResults?.variances.materials ?? 0) : formatCurrency(0)}
                </td>
              </tr>
              {/* Lab bill */}
              <tr>
                <td className="py-3 px-4">Lab bill</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.labBill ?? 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={0.01} value={calcOverrides.labBill} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, labBill: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.labBill !== '' ? formatCurrency(calcResults?.variances.labBill ?? 0) : formatCurrency(0)}
                </td>
              </tr>
              {/* Lab bill discount */}
              <tr>
                <td className="py-3 px-4">Lab bill discount (%)</td>
                <td className="py-3 px-4 text-center">{(categoryDefaults?.labBillDiscount ?? 0).toFixed(0)}%</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} max={100} step={1} value={calcOverrides.labBillDiscount} placeholder="0"
                    onChange={(e) => setCalcOverrides(p => ({ ...p, labBillDiscount: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.labBillDiscount !== '' ? `${(calcResults?.variances.labBillDiscount ?? 0).toFixed(0)}%` : '0%'}
                </td>
              </tr>
              {/* Associate % */}
              <tr>
                <td className="py-3 px-4">Associate %</td>
                <td className="py-3 px-4 text-center">{(categoryDefaults?.associatePercent ?? 0).toFixed(1)}%</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} max={100} step={1} value={calcOverrides.associatePercent} placeholder="0"
                    onChange={(e) => {
                      const pct = e.target.value;
                      const tv = getEff(calcOverrides.treatmentValue, categoryDefaults?.treatmentValue ?? 0);
                      const lb = getEff(calcOverrides.labBill, categoryDefaults?.labBill ?? 0);
                      const computedCost = pct !== '' ? ((tv - lb) * (parseFloat(pct) || 0) / 100) : '';
                      setCalcOverrides(p => ({ ...p, associatePercent: pct, associateCost: computedCost !== '' ? String(Math.round(computedCost * 100) / 100) : '' }));
                    }}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.associatePercent !== '' ? `${(calcResults?.variances.associatePercent ?? 0).toFixed(1)}%` : '0%'}
                </td>
              </tr>
              {/* Therapist/hygienist pay per hour */}
              <tr>
                <td className="py-3 px-4">Therapist/hygienist pay per hour</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.therapistPayPerHour ?? 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={0.01} value={calcOverrides.therapistPayPerHour} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, therapistPayPerHour: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.therapistPayPerHour !== '' ? formatCurrency(calcResults?.variances.therapistPayPerHour ?? 0) : formatCurrency(0)}
                </td>
              </tr>
              {/* Operating cost per surgery per hour */}
              <tr>
                <td className="py-3 px-4">Operating cost per surgery per hour</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults?.operatingCostPerHour ?? 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={0.01} value={calcOverrides.operatingCostPerHour} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, operatingCostPerHour: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.operatingCostPerHour !== '' ? formatCurrency(calcResults?.variances.operatingCostPerHour ?? 0) : formatCurrency(0)}
                </td>
              </tr>
              {/* Finance cost % */}
              <tr>
                <td className="py-3 px-4">Finance cost %</td>
                <td className="py-3 px-4 text-center">{(categoryDefaults?.financeCostPercent ?? 0).toFixed(1)}%</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} max={100} step={0.1} value={calcOverrides.financeCostPercent} placeholder="0"
                    onChange={(e) => setCalcOverrides(p => ({ ...p, financeCostPercent: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.financeCostPercent !== '' ? `${(calcResults?.variances.financeCostPercent ?? 0).toFixed(1)}%` : '0%'}
                </td>
              </tr>
              {/* Associate cost */}
              <tr>
                <td className="py-3 px-4">Associate cost</td>
                <td className="py-3 px-4 text-center">{formatCurrency(categoryDefaults ? categoryDefaults.treatmentValue * categoryDefaults.associatePercent / 100 : 0)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs font-medium bg-muted px-1.5 py-1 rounded">£</span>
                    <input type="number" min={0} step={0.01} value={calcOverrides.associateCost} placeholder="0"
                      onChange={(e) => setCalcOverrides(p => ({ ...p, associateCost: e.target.value }))}
                      className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                      disabled={!selectedCaseType} />
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-medium">
                  {calcOverrides.associateCost !== '' || calcOverrides.associatePercent !== '' || calcOverrides.treatmentValue !== ''
                    ? formatCurrency(calcResults?.variances.associateCost ?? 0) : formatCurrency(0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Time Taken Section */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Target className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Time taken</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="text-left py-2.5 px-4 font-medium w-[25%]">Associate</th>
                <th className="text-center py-2.5 px-4 font-medium w-[15%]">Defaults</th>
                <th className="text-center py-2.5 px-4 font-medium w-[15%]">Override</th>
                <th className="text-center py-2.5 px-4 font-medium w-[15%]">Planned</th>
                <th className="text-center py-2.5 px-4 font-medium w-[15%]">Overrun</th>
                <th className="text-center py-2.5 px-4 font-medium w-[15%]">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-2 px-4 text-muted-foreground text-xs" colSpan={6}>Time taken in minutes</td>
              </tr>
              {/* Dentist */}
              <tr>
                <td className="py-3 px-4">Dentist</td>
                <td className="py-3 px-4 text-center">{categoryDefaults?.dentistMinutes ?? 0}</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} step={1} value={timeOverrides.dentistOverride} placeholder="0"
                    onChange={(e) => setTimeOverrides(p => ({ ...p, dentistOverride: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-center font-medium">{calcResults?.time.dentistPlanned ?? 0}</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} step={1} value={timeOverrides.dentistOverrun} placeholder="0"
                    onChange={(e) => setTimeOverrides(p => ({ ...p, dentistOverrun: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-center font-semibold">{calcResults?.time.dentistTotal ?? 0}</td>
              </tr>
              {/* Therapist/hygienist */}
              <tr>
                <td className="py-3 px-4">Therapist/hygienist</td>
                <td className="py-3 px-4 text-center">{categoryDefaults?.therapistMinutes ?? 0}</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} step={1} value={timeOverrides.therapistOverride} placeholder="0"
                    onChange={(e) => setTimeOverrides(p => ({ ...p, therapistOverride: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-center font-medium">{calcResults?.time.therapistPlanned ?? 0}</td>
                <td className="py-3 px-4">
                  <input type="number" min={0} step={1} value={timeOverrides.therapistOverrun} placeholder="0"
                    onChange={(e) => setTimeOverrides(p => ({ ...p, therapistOverrun: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={!selectedCaseType} />
                </td>
                <td className="py-3 px-4 text-center font-semibold">{calcResults?.time.therapistTotal ?? 0}</td>
              </tr>
              {/* Total */}
              <tr className="bg-muted/30 font-semibold">
                <td className="py-3 px-4">Total time taken</td>
                <td className="py-3 px-4 text-center">{(categoryDefaults?.dentistMinutes ?? 0) + (categoryDefaults?.therapistMinutes ?? 0)}</td>
                <td className="py-3 px-4 text-center">
                  {(timeOverrides.dentistOverride ? parseFloat(timeOverrides.dentistOverride) || 0 : (categoryDefaults?.dentistMinutes ?? 0)) +
                   (timeOverrides.therapistOverride ? parseFloat(timeOverrides.therapistOverride) || 0 : (categoryDefaults?.therapistMinutes ?? 0))}
                </td>
                <td className="py-3 px-4 text-center">{calcResults?.time.totalPlannedMin ?? 0}</td>
                <td className="py-3 px-4 text-center">{(calcResults?.time.dentistOverrun ?? 0) + (calcResults?.time.therapistOverrun ?? 0)}</td>
                <td className="py-3 px-4 text-center text-primary">{calcResults?.time.totalMinWithOverrun ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Results */}
      <div className="lg:col-span-2">
        <div className="bg-card rounded-xl border border-border overflow-hidden sticky top-4">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Results</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="text-left py-2.5 px-4 font-medium w-[40%]"></th>
                <th className="text-right py-2.5 px-4 font-medium w-[25%]">Total £</th>
                <th className="text-right py-2.5 px-4 font-medium w-[18%]">Profit %</th>
                <th className="text-right py-2.5 px-4 font-medium w-[17%]">Per hour £</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Associate completes work */}
              <tr>
                <td className="py-3 px-4 font-semibold" colSpan={4}>Associate completes work</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit of planned patient journey</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.plannedProfit ?? 0)}</td>
                <td className="py-2.5 px-4 text-right">{(calcResults?.associate.plannedPct ?? 0).toFixed(2)} %</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.plannedPerHr ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit after overruns</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.overrunProfit ?? 0)}</td>
                <td className="py-2.5 px-4 text-right">{(calcResults?.associate.overrunPct ?? 0).toFixed(2)} %</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.associate.overrunPerHr ?? 0)}</td>
              </tr>
              <tr className="bg-muted/20">
                <td className="py-2.5 px-4 font-semibold pl-6">Reduction in profit for overruns</td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reduction ?? 0) > 0 ? 'text-destructive' : '')}>
                  {formatCurrency(calcResults?.associate.reduction ?? 0)}
                </td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reductionPct ?? 0) > 0 ? 'text-destructive' : '')}>
                  {(calcResults?.associate.reductionPct ?? 0).toFixed(2)}%
                </td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.associate.reductionPerHr ?? 0) > 0 ? 'text-destructive' : '')}>
                  {formatCurrency(calcResults?.associate.reductionPerHr ?? 0)}
                </td>
              </tr>

              {/* Principal completes work */}
              <tr>
                <td className="py-3 px-4 font-semibold" colSpan={4}>Principal completes work</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit of planned patient journey</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.plannedProfit ?? 0)}</td>
                <td className="py-2.5 px-4 text-right">{(calcResults?.principal.plannedPct ?? 0).toFixed(2)} %</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.plannedPerHr ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 text-muted-foreground pl-6">Total profit after overruns</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.overrunProfit ?? 0)}</td>
                <td className="py-2.5 px-4 text-right">{(calcResults?.principal.overrunPct ?? 0).toFixed(2)} %</td>
                <td className="py-2.5 px-4 text-right">{formatCurrency(calcResults?.principal.overrunPerHr ?? 0)}</td>
              </tr>
              <tr className="bg-muted/20">
                <td className="py-2.5 px-4 font-semibold pl-6">Reduction in profit for overruns</td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reduction ?? 0) > 0 ? 'text-destructive' : '')}>
                  {formatCurrency(calcResults?.principal.reduction ?? 0)}
                </td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reductionPct ?? 0) > 0 ? 'text-destructive' : '')}>
                  {(calcResults?.principal.reductionPct ?? 0).toFixed(2)}%
                </td>
                <td className={cn('py-2.5 px-4 text-right font-semibold', (calcResults?.principal.reductionPerHr ?? 0) > 0 ? 'text-destructive' : '')}>
                  {formatCurrency(calcResults?.principal.reductionPerHr ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>

          {!selectedCaseType && (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Select a Case Type to see profit calculations
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
