import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import dayjs from "dayjs";
import { ConfigProvider, DatePicker } from "antd";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  BarChart3,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  providerPerformsNhs,
  providerPerformsMos,
  providerPerformsUoa,
} from "@/types/provider";
import {
  useAllProvidersCounts,
  type ProviderMonthlyCount,
} from "@/hooks/useAllProvidersCounts";

export type UdaContractType = "NHS" | "MOS" | "UOA";

interface ProviderLite {
  id: string;
  name: string;
  /** Bitmask: NHS / MOS treatment flags from Edit Provider. */
  additional_options?: number | null;
}

interface UdaContractGoalsPanelProps {
  contractType: UdaContractType;
  organizationId: string | null | undefined;
  selectedLocationId: string | null | undefined;
  locationLabel: string;
  financialMonthStart: number | null;
  /** All providers in scope (incl. inactive); List filters do not apply. */
  filteredProviders: ProviderLite[];
  /** Canonical role key: Dentist | Hygienist | Therapist | Other; null = all provider types together. */
  providerType: "Dentist" | "Therapist" | "Hygienist" | "Other" | null;
  userId: string | null | undefined;
  userEmail: string | null | undefined;
}

/**
 * UK dental FY: storage uses the *start* year (Apr 2026 → 2026).
 * Display label is "YYYY-YY" (2026-27 for Apr 2026 – Mar 2027).
 */
function fyStartYearForDate(d: Date, financialMonthStart: number): number {
  const month = d.getMonth() + 1; // 1–12
  const year = d.getFullYear();
  return month < financialMonthStart ? year - 1 : year;
}

function fyRange(
  fyStartYear: number,
  financialMonthStart: number,
): { start: Date; end: Date } {
  const fms = financialMonthStart || 4;
  return {
    start: new Date(fyStartYear, fms - 1, 1),
    end: new Date(fyStartYear + 1, fms - 1, 0),
  };
}

/** e.g. FY start 2026 → "2026-27"; Jan-start calendar FY → "2026". */
function fyLabel(fyStartYear: number, financialMonthStart: number): string {
  const { start, end } = fyRange(fyStartYear, financialMonthStart);
  const startY = start.getFullYear();
  const endY = end.getFullYear();
  if (startY === endY) return String(startY);
  return `${startY}-${String(endY).slice(-2)}`;
}

function buildFyOptions(
  financialMonthStart: number,
  around: Date = new Date(),
): number[] {
  const current = fyStartYearForDate(around, financialMonthStart);
  // Current −2 … current +3
  return Array.from({ length: 6 }, (_, i) => current - 2 + i);
}

// Mirrors the NHS / MOS contract goals tabs from the provider app's UDA Goals
// Settings screen — same layout, rendered once per contract type with its own
// contract value / obligation / rate labels and its own saved records.
export function UdaContractGoalsPanel({
  contractType,
  organizationId,
  selectedLocationId,
  locationLabel,
  financialMonthStart,
  filteredProviders,
  providerType,
  userId,
  userEmail,
}: UdaContractGoalsPanelProps) {
  const contractLabel = `${contractType} Contract Value`;
  const obligationLabel =
    contractType === "NHS" ? "Total UDA Obligation" : "Total UDA Obligation";
  const rateLabel =
    contractType === "NHS"
      ? "UDA Rate"
      : contractType === "UOA"
        ? "UDA Rate"
        : "UDA Rate";
  const fms = financialMonthStart || 4;

  // selectedFY = FY *start* year (storage). UI shows "YYYY-YY" (e.g. 2026-27).
  const [selectedFY, setSelectedFY] = useState<number>(() =>
    fyStartYearForDate(new Date(), 4),
  );
  const [contractValue, setContractValue] = useState<string>("");
  const [totalObligation, setTotalObligation] = useState<string>("");
  const rate = useMemo(() => {
    const cv = parseFloat(contractValue);
    const ob = parseFloat(totalObligation);
    if (!isNaN(cv) && !isNaN(ob) && ob > 0) return (cv / ob).toFixed(2);
    return "";
  }, [contractValue, totalObligation]);

  const [yearlyTargets, setYearlyTargets] = useState<Record<string, string>>(
    {},
  );
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, string>>(
    {},
  );
  const [actualMonth, setActualMonth] = useState<Date | null>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [planningMonth, setPlanningMonth] = useState<Date | null>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  });

  const [targetHistory, setTargetHistory] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(5);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingYearly, setIsSavingYearly] = useState(false);
  const [isSavingMonthly, setIsSavingMonthly] = useState(false);

  // Re-align selected FY when org financial-month setting loads / changes.
  useEffect(() => {
    if (!financialMonthStart) return;
    setSelectedFY(fyStartYearForDate(new Date(), financialMonthStart));
  }, [financialMonthStart]);

  // Keep Actual / Planning months inside the selected FY (avoid Aug 2026 while FY is 2025-26).
  useEffect(() => {
    if (!financialMonthStart) return;
    const { start, end } = fyRange(selectedFY, financialMonthStart);
    const clampToFy = (d: Date | null, fallback: Date) => {
      const base = d ?? fallback;
      if (base < start)
        return new Date(start.getFullYear(), start.getMonth(), 1);
      if (base > end) return new Date(end.getFullYear(), end.getMonth(), 1);
      return new Date(base.getFullYear(), base.getMonth(), 1);
    };
    setActualMonth((prev) => clampToFy(prev, start));
    setPlanningMonth((prev) => {
      const nextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return clampToFy(prev, nextMonth <= end ? nextMonth : start);
    });
  }, [selectedFY, financialMonthStart]);

  const fyOptions = useMemo(() => buildFyOptions(fms), [fms]);

  // ── Load settings for the selected FY / location / contract type ──────────
  useEffect(() => {
    const load = async () => {
      if (!organizationId) return;
      let q = (supabase as any)
        .from("uda_settings")
        .select("nhs_contract_value, total_uda_obligation")
        .eq("organization_id", organizationId)
        .eq("financial_year", selectedFY)
        .eq("contract_type", contractType);
      q = selectedLocationId
        ? q.eq("location_id", selectedLocationId)
        : q.is("location_id", null);
      const { data } = await q.maybeSingle();
      if (data) {
        setContractValue(
          data.nhs_contract_value != null
            ? String(data.nhs_contract_value)
            : "",
        );
        setTotalObligation(
          data.total_uda_obligation != null
            ? String(data.total_uda_obligation)
            : "",
        );
      } else {
        setContractValue("");
        setTotalObligation("");
      }
    };
    load();
  }, [organizationId, selectedFY, selectedLocationId, contractType]);

  // ── Yearly targets ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!organizationId || !financialMonthStart) return;
      const fyStart = new Date(selectedFY, (financialMonthStart || 4) - 1, 1);
      const periodStr = format(fyStart, "yyyy-MM-dd");
      const { data } = await (supabase as any)
        .from("uda_targets")
        .select("provider_id, uda_target")
        .eq("organization_id", organizationId)
        .eq("period_type", "yearly")
        .eq("period", periodStr)
        .eq("contract_type", contractType);
      if (data) {
        const targets: Record<string, string> = {};
        data.forEach((row: any) => {
          targets[row.provider_id] = String(row.uda_target);
        });
        setYearlyTargets(targets);
      }
    };
    load();
  }, [organizationId, selectedFY, financialMonthStart, contractType]);

  // ── Monthly targets ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!organizationId || !planningMonth) return;
      const periodStr = format(startOfMonth(planningMonth), "yyyy-MM-dd");
      const { data } = await (supabase as any)
        .from("uda_targets")
        .select("provider_id, uda_target")
        .eq("organization_id", organizationId)
        .eq("period_type", "monthly")
        .eq("period", periodStr)
        .eq("contract_type", contractType);
      if (data) {
        const targets: Record<string, string> = {};
        data.forEach((row: any) => {
          targets[row.provider_id] = String(row.uda_target);
        });
        setMonthlyTargets(targets);
      }
    };
    load();
  }, [organizationId, planningMonth, contractType]);

  // Which appointment_summary column backs this contract's actuals — NHS pays
  // per UDA (uda_count); MOS is paid per case (mos_count); UOA is paid per
  // unit of orthodontic activity (uoa_count) — each its own column.
  const actualsField =
    contractType === "MOS"
      ? "mos_count"
      : contractType === "UOA"
        ? "uoa_count"
        : "uda_count";

  const fyBounds = useMemo(() => {
    if (!financialMonthStart)
      return { start: null as Date | null, end: null as Date | null };
    return fyRange(selectedFY, financialMonthStart);
  }, [selectedFY, financialMonthStart]);

  // Same source as Production Data → NHS/MOS Count (practitioner_id aggregation,
  // includes inactive). Do not query appointment_summary.provider_id for the
  // List-filtered set — that misses leavers / other-home dentists with counts.
  const { data: yearlyCountsData } = useAllProvidersCounts(
    providerType,
    fyBounds.start,
    fyBounds.end,
    actualsField,
  );

  const { data: monthlyCountsData } = useAllProvidersCounts(
    providerType,
    actualMonth ? startOfMonth(actualMonth) : null,
    actualMonth ? endOfMonth(actualMonth) : null,
    actualsField,
  );

  const yearlyActuals = useMemo(() => {
    const actuals: Record<string, number> = {};
    for (const row of yearlyCountsData?.providers ?? []) {
      actuals[row.providerId] = row.total || 0;
    }
    return actuals;
  }, [yearlyCountsData]);

  const monthlyActuals = useMemo(() => {
    const actuals: Record<string, number> = {};
    for (const row of monthlyCountsData?.providers ?? []) {
      actuals[row.providerId] = row.total || 0;
    }
    return actuals;
  }, [monthlyCountsData]);

  const loadTargetHistory = async () => {
    if (!organizationId) return;
    const { data } = await (supabase as any)
      .from("uda_targets")
      .select(
        "id, provider_id, period, uda_target, created_at, updated_at, created_by_email",
      )
      .eq("organization_id", organizationId)
      .eq("period_type", "monthly")
      .eq("contract_type", contractType)
      .order("updated_at", { ascending: false });
    if (data) setTargetHistory(data);
  };

  useEffect(() => {
    loadTargetHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, contractType]);

  const saveSettings = async () => {
    if (!organizationId) return;
    setIsSavingSettings(true);
    try {
      const { error } = await (supabase as any).from("uda_settings").upsert(
        {
          organization_id: organizationId,
          location_id: selectedLocationId ?? null,
          financial_year: selectedFY,
          contract_type: contractType,
          nhs_contract_value: contractValue ? parseFloat(contractValue) : null,
          total_uda_obligation: totalObligation
            ? parseFloat(totalObligation)
            : null,
        },
        {
          onConflict:
            "organization_id,location_id,financial_year,contract_type",
        },
      );
      if (error) throw error;
      toast.success(`${contractType} settings saved`);
    } catch (err) {
      console.error(`[UDA:${contractType}] saveSettings error:`, err);
      toast.error(`Failed to save ${contractType} settings`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const saveYearlyTargets = async () => {
    if (!organizationId || !financialMonthStart) return;
    setIsSavingYearly(true);
    try {
      const fyStart = new Date(selectedFY, (financialMonthStart || 4) - 1, 1);
      const periodStr = format(fyStart, "yyyy-MM-dd");
      const rows = yearlyListProviders.map((p) => ({
        organization_id: organizationId,
        provider_id: p.id,
        period_type: "yearly",
        period: periodStr,
        contract_type: contractType,
        uda_target: parseInt(yearlyTargets[p.id] || "0") || 0,
      }));
      const { error } = await (supabase as any)
        .from("uda_targets")
        .upsert(rows, {
          onConflict:
            "organization_id,provider_id,period_type,period,contract_type",
        });
      if (error) throw error;
      toast.success(`Yearly ${contractType} targets saved`);
    } catch (err) {
      console.error(`[UDA:${contractType}] saveYearlyTargets error:`, err);
      toast.error("Failed to save yearly targets");
    } finally {
      setIsSavingYearly(false);
    }
  };

  const saveMonthlyTargets = async () => {
    if (!organizationId || !planningMonth) {
      toast.error("Please select a planning month");
      return;
    }
    setIsSavingMonthly(true);
    try {
      const periodStr = format(startOfMonth(planningMonth), "yyyy-MM-dd");
      const rows = monthlyListProviders.map((p) => ({
        organization_id: organizationId,
        provider_id: p.id,
        period_type: "monthly",
        period: periodStr,
        contract_type: contractType,
        uda_target: parseInt(monthlyTargets[p.id] || "0") || 0,
        created_by: userId ?? null,
        created_by_email: userEmail ?? null,
      }));
      const { error } = await (supabase as any)
        .from("uda_targets")
        .upsert(rows, {
          onConflict:
            "organization_id,provider_id,period_type,period,contract_type",
        });
      if (error) throw error;
      toast.success(`Monthly ${contractType} targets saved`);
      await loadTargetHistory();
    } catch (err) {
      console.error(`[UDA:${contractType}] saveMonthlyTargets error:`, err);
      toast.error("Failed to save monthly targets");
    } finally {
      setIsSavingMonthly(false);
    }
  };

  const providerMap = useMemo(
    () => Object.fromEntries(filteredProviders.map((p) => [p.id, p.name])),
    [filteredProviders],
  );

  /** Provider opted into this contract type (NHS / MOS / UOA treatment flag). */
  const performsContract = (p: ProviderLite) =>
    contractType === "MOS"
      ? providerPerformsMos(p.additional_options)
      : contractType === "UOA"
        ? providerPerformsUoa(p.additional_options)
        : providerPerformsNhs(p.additional_options);

  // Merge provider rows from the parent list with anyone who only appears in
  // Production Data counts (e.g. inactive / missing from filteredProviders).
  const mergeWithCountRows = (
    counts: ProviderMonthlyCount[] | undefined,
    actuals: Record<string, number>,
  ): ProviderLite[] => {
    const byId = new Map<string, ProviderLite>();
    for (const p of filteredProviders) byId.set(p.id, p);
    for (const row of counts ?? []) {
      if (!byId.has(row.providerId)) {
        byId.set(row.providerId, {
          id: row.providerId,
          name: row.providerName,
          additional_options: null,
        });
      }
    }
    return Array.from(byId.values())
      .filter((p) => performsContract(p) || (actuals[p.id] ?? 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  // Yearly / Monthly lists: treatment flag OR actuals > 0 (same people as Production Data).
  const yearlyListProviders = useMemo(
    () => mergeWithCountRows(yearlyCountsData?.providers, yearlyActuals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredProviders, yearlyCountsData, yearlyActuals, contractType],
  );

  const monthlyListProviders = useMemo(
    () => mergeWithCountRows(monthlyCountsData?.providers, monthlyActuals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredProviders, monthlyCountsData, monthlyActuals, contractType],
  );

  const yearlyListActualTotal = useMemo(
    () =>
      yearlyListProviders.reduce((s, p) => s + (yearlyActuals[p.id] ?? 0), 0),
    [yearlyListProviders, yearlyActuals],
  );

  const monthlyListActualTotal = useMemo(
    () =>
      monthlyListProviders.reduce((s, p) => s + (monthlyActuals[p.id] ?? 0), 0),
    [monthlyListProviders, monthlyActuals],
  );

  const filteredHistory = useMemo(() => {
    return targetHistory.filter((row) => {
      const name = providerMap[row.provider_id] || "";
      return name.toLowerCase().includes(historySearch.toLowerCase());
    });
  }, [targetHistory, providerMap, historySearch]);

  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / historyPageSize),
  );
  const historyPageData = filteredHistory.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-6">
        {/* Contract Settings Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              UDA Settings
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {selectedLocationId
                ? `For ${locationLabel} — set this location's ${contractType} contract`
                : `Organisation-wide default — choose a location in the top filter to set its own ${contractType} contract`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Select FY — shows UK label e.g. 2026-27 for Apr 2026 – Mar 2027 */}
            <div className="grid grid-cols-[180px_1fr] items-start gap-4">
              <Label className="pt-2 text-sm">Select FY</Label>
              <div>
                <Select
                  value={String(selectedFY)}
                  onValueChange={(v) => setSelectedFY(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select FY" />
                  </SelectTrigger>
                  <SelectContent>
                    {fyOptions.map((fyStart) => (
                      <SelectItem key={fyStart} value={String(fyStart)}>
                        {fyLabel(fyStart, fms)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-primary mt-1">
                  {(() => {
                    const { start, end } = fyRange(selectedFY, fms);
                    return `${format(start, "dd-MM-yyyy")} To ${format(end, "dd-MM-yyyy")}`;
                  })()}
                </p>
              </div>
            </div>

            {/* Contract Value */}
            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
              <Label className="text-sm">{contractLabel}</Label>
              <div className="flex items-center border rounded-md overflow-hidden">
                <span className="px-3 py-2 bg-muted text-sm border-r">£</span>
                <Input
                  type="number"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  className="border-0 rounded-none shadow-none"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Total Obligation */}
            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
              <Label className="text-sm">{obligationLabel}</Label>
              <Input
                type="number"
                value={totalObligation}
                onChange={(e) => setTotalObligation(e.target.value)}
                placeholder="0"
              />
            </div>

            {/* Rate */}
            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
              <Label className="text-sm">{rateLabel}</Label>
              <div className="flex items-center border rounded-md overflow-hidden bg-muted/40">
                <span className="px-3 py-2 bg-muted text-sm border-r">£</span>
                <Input
                  type="text"
                  value={rate}
                  readOnly
                  className="border-0 rounded-none shadow-none bg-transparent cursor-default"
                  placeholder="Auto-calculated"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={saveSettings}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={isSavingSettings}
              >
                {isSavingSettings && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Obligation By Associate (Yearly) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              UDA Obligation By Associate (Yearly)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-sidebar text-white">
                    <th className="text-left px-4 py-3 font-medium">
                      Associate
                    </th>
                    <th className="text-right px-4 py-3 font-medium">
                      UDA Actual Completed
                    </th>
                    <th className="text-right px-4 py-3 font-medium">
                      UDA Target
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {yearlyListProviders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-muted-foreground text-sm"
                      >
                        No associates with {contractType} actuals or “Does
                        Perform {contractType} Treatments?” enabled.
                      </td>
                    </tr>
                  ) : (
                    yearlyListProviders.map((provider, idx) => (
                      <tr
                        key={provider.id}
                        className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                      >
                        <td className="px-4 py-3 font-medium">
                          {provider.name}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {yearlyActuals[provider.id] ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={yearlyTargets[provider.id] ?? "0"}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, "");
                              setYearlyTargets((prev) => ({
                                ...prev,
                                [provider.id]: val,
                              }));
                            }}
                            className="w-24 h-8 text-right ml-auto"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                  <tr className="border-t bg-white font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">
                      {yearlyListActualTotal}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="text"
                        value={yearlyListProviders.reduce(
                          (s, p) => s + (parseInt(yearlyTargets[p.id]) || 0),
                          0,
                        )}
                        readOnly
                        className="w-24 h-8 text-right ml-auto bg-muted"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex justify-end p-4">
              <Button
                onClick={saveYearlyTargets}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                disabled={isSavingYearly}
              >
                {isSavingYearly && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Column - Obligation By Associate (Monthly) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            UDA Obligation By Associate (Monthly)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Month pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Actual Month
              </Label>
              <ConfigProvider>
                <DatePicker
                  picker="month"
                  value={actualMonth ? dayjs(actualMonth) : null}
                  onChange={(date) =>
                    setActualMonth(date ? date.toDate() : null)
                  }
                  style={{ width: "100%" }}
                />
              </ConfigProvider>
              {actualMonth && (
                <p className="text-xs text-primary mt-1">
                  {format(startOfMonth(actualMonth), "dd-MM-yyyy")} To{" "}
                  {format(endOfMonth(actualMonth), "dd-MM-yyyy")}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Planning Month
              </Label>
              <ConfigProvider>
                <DatePicker
                  picker="month"
                  value={planningMonth ? dayjs(planningMonth) : null}
                  onChange={(date) =>
                    setPlanningMonth(date ? date.toDate() : null)
                  }
                  style={{ width: "100%" }}
                />
              </ConfigProvider>
              {planningMonth && (
                <p className="text-xs text-primary mt-1">
                  {format(startOfMonth(planningMonth), "dd-MM-yyyy")} To{" "}
                  {format(endOfMonth(planningMonth), "dd-MM-yyyy")}
                </p>
              )}
            </div>
          </div>

          {/* Monthly table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-white">
                  <th className="text-left px-4 py-3 font-medium">Associate</th>
                  <th className="text-right px-4 py-3 font-medium">
                    UDA Actual
                  </th>
                  <th className="text-right px-4 py-3 font-medium">
                    UDA Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthlyListProviders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-center text-muted-foreground text-sm"
                    >
                      No associates with {contractType} actuals or “Does Perform{" "}
                      {contractType} Treatments?” enabled.
                    </td>
                  </tr>
                ) : (
                  monthlyListProviders.map((provider, idx) => (
                    <tr
                      key={provider.id}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-4 py-3 font-medium">{provider.name}</td>
                      <td className="px-4 py-3 text-right">
                        {monthlyActuals[provider.id] ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={monthlyTargets[provider.id] ?? "0"}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, "");
                            setMonthlyTargets((prev) => ({
                              ...prev,
                              [provider.id]: val,
                            }));
                          }}
                          className="w-24 h-8 text-right ml-auto"
                        />
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t bg-white font-semibold">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">
                    {monthlyListActualTotal}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Input
                      type="text"
                      value={monthlyListProviders.reduce(
                        (s, p) => s + (parseInt(monthlyTargets[p.id]) || 0),
                        0,
                      )}
                      readOnly
                      className="w-24 h-8 text-right ml-auto bg-muted"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={saveMonthlyTargets}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
              disabled={isSavingMonthly}
            >
              {isSavingMonthly && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Target History */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              UDA Target History
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search here..."
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value);
                  setHistoryPage(1);
                }}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-white">
                  <th className="text-left px-4 py-3 font-medium">
                    Associate Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Target</th>
                  <th className="text-left px-4 py-3 font-medium">From Date</th>
                  <th className="text-left px-4 py-3 font-medium">To Date</th>
                  <th className="text-left px-4 py-3 font-medium">
                    Created Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    Created By
                  </th>
                </tr>
              </thead>
              <tbody>
                {historyPageData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No records found
                    </td>
                  </tr>
                ) : (
                  historyPageData.map((row, idx) => {
                    const periodDate = new Date(row.period);
                    const fromDate = format(
                      startOfMonth(periodDate),
                      "dd-MM-yyyy",
                    );
                    const toDate = format(endOfMonth(periodDate), "dd-MM-yyyy");
                    const createdDate = format(
                      new Date(row.updated_at),
                      "dd-MM-yyyy",
                    );
                    return (
                      <tr
                        key={row.id}
                        className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                      >
                        <td className="px-4 py-3">
                          {providerMap[row.provider_id] || "Unknown"}
                        </td>
                        <td className="px-4 py-3">£{row.uda_target}</td>
                        <td className="px-4 py-3">{fromDate}</td>
                        <td className="px-4 py-3">{toDate}</td>
                        <td className="px-4 py-3">{createdDate}</td>
                        <td className="px-4 py-3">
                          {row.created_by_email || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 mt-3">
            <span className="text-sm text-muted-foreground">Page Size</span>
            <select
              value={historyPageSize}
              onChange={(e) => {
                setHistoryPageSize(Number(e.target.value));
                setHistoryPage(1);
              }}
              className="border rounded px-2 py-1 text-sm"
            >
              {[5, 10, 25, 50].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">
              {filteredHistory.length === 0
                ? "0 of 0"
                : `${(historyPage - 1) * historyPageSize + 1} – ${Math.min(historyPage * historyPageSize, filteredHistory.length)} of ${filteredHistory.length}`}
            </span>
            <button
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              disabled={historyPage === 1}
              className="border rounded px-2 py-1 text-sm disabled:opacity-40"
            >
              ‹
            </button>
            <button
              onClick={() =>
                setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))
              }
              disabled={historyPage >= totalHistoryPages}
              className="border rounded px-2 py-1 text-sm disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
