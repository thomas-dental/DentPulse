import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, ConfigProvider } from "antd";
import dayjs from "dayjs";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Loader2, Check, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePayslip, useSavePayslipMutation } from "@/hooks/usePayslips";
import { useProviderNetProduction } from "@/hooks/useProviderNetProduction";
import { useProviderWorkingHours } from "@/hooks/useProviderWorkingHours";
import { useSlidingScales } from "@/hooks/useSlidingScales";
import {
  computePayBand,
  computeLabBand,
  computeNetPay,
  round2,
  PER_HOUR_EMPLOYEE_UPLIFT_PERCENT,
} from "@/lib/payslipCalculations";
import { PayslipSavePayload, PayslipStatus } from "@/types/payslip";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { formatCurrency as formatCurrencyBase } from "@/lib/currency";
import { Provider } from "@/types/provider";

interface PayslipDialogProps {
  open: boolean;
  mode: "add" | "edit" | "view";
  payslipId?: string;
  provider: Provider | undefined;
  providerId: string;
  onOpenChange: (open: boolean) => void;
}

interface AdjustmentRow {
  id: string;
  label: string;
  amount: number;
}

const SPLIT_METHOD_LABELS: Record<string, string> = {
  "flat-percentage": "Flat Percentage",
  "sliding-scale": "Sliding Scale",
  "per-case": "Per Case",
  "per-hour": "Per Hour",
};

let localRowId = 0;
const nextRowId = () => `row-${++localRowId}`;

export function PayslipDialog({
  open,
  mode,
  payslipId,
  provider,
  providerId,
  onOpenChange,
}: PayslipDialogProps) {
  const readOnly = mode === "view";
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = useCallback(
    (value: number | null | undefined) => formatCurrencyBase(value, showDecimals),
    [showDecimals],
  );

  const [activeTab, setActiveTab] = useState("gross-fees");
  const [monthEnding, setMonthEnding] = useState<Date>(endOfMonth(new Date()));
  const [statementDate, setStatementDate] = useState<Date>(new Date());
  const [udas, setUdas] = useState<number>(0);
  const [privateFees, setPrivateFees] = useState<number>(0);
  const [membershipFees, setMembershipFees] = useState<number>(0);
  const [nhsFees, setNhsFees] = useState<number>(0);
  const [badDebts, setBadDebts] = useState<number>(0);
  const [otherDeductions, setOtherDeductions] = useState<number>(0);
  const [caseCount, setCaseCount] = useState<number>(0);
  const [superannuation, setSuperannuation] = useState<number>(0);
  const [levy, setLevy] = useState<number>(0);
  const [additionRows, setAdditionRows] = useState<AdjustmentRow[]>([]);
  const [deductionRows, setDeductionRows] = useState<AdjustmentRow[]>([]);

  const { data: existingPayslip, isLoading: isLoadingExisting } = usePayslip(
    mode !== "add" ? payslipId : undefined,
  );
  const { savePayslip, isSaving } = useSavePayslipMutation(providerId);

  const monthStart = startOfMonth(monthEnding);
  const monthEndBound = endOfMonth(monthEnding);

  const { data: productionData } = useProviderNetProduction(
    open ? providerId : undefined,
    monthStart,
    monthEndBound,
  );
  const practitionerId = provider?.external_id
    ? Number(provider.external_id)
    : null;
  const { data: workingHoursData } = useProviderWorkingHours(
    open ? providerId : undefined,
    monthStart,
    monthEndBound,
    practitionerId,
    provider?.location_id ?? null,
  );
  const { getScalesByType } = useSlidingScales(open ? providerId : undefined);
  const associateBands = getScalesByType("sliding_scale");
  const labBands = getScalesByType("lab_sliding_scale");

  // Reset (add) or hydrate (edit/view) form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setActiveTab("gross-fees");

    if (mode === "add") {
      setMonthEnding(endOfMonth(new Date()));
      setStatementDate(new Date());
      setUdas(0);
      setPrivateFees(0);
      setMembershipFees(0);
      setNhsFees(0);
      setBadDebts(0);
      setOtherDeductions(0);
      setCaseCount(0);
      setSuperannuation(0);
      setLevy(0);
      setAdditionRows([]);
      setDeductionRows([]);
      return;
    }

    if (!existingPayslip) return;

    setMonthEnding(new Date(existingPayslip.month_ending));
    setStatementDate(new Date(existingPayslip.statement_date));
    setUdas(Number(existingPayslip.udas) || 0);

    const findAmount = (key: string) =>
      existingPayslip.income_lines.find((line) => line.line_key === key)
        ?.amount ?? 0;
    setPrivateFees(findAmount("private_fees"));
    setMembershipFees(findAmount("membership_fees"));
    setNhsFees(findAmount("nhs_fees"));
    setBadDebts(findAmount("bad_debts"));
    setOtherDeductions(findAmount("other_deductions"));

    const supLine = existingPayslip.adjustment_lines.find(
      (line) => line.label === "Superannuation",
    );
    const levyLine = existingPayslip.adjustment_lines.find(
      (line) => line.label === "Levy",
    );
    setSuperannuation(supLine?.amount ?? 0);
    setLevy(levyLine?.amount ?? 0);
    setAdditionRows(
      existingPayslip.adjustment_lines
        .filter((line) => line.adjustment_type === "addition")
        .map((line) => ({
          id: nextRowId(),
          label: line.label,
          amount: line.amount,
        })),
    );
    setDeductionRows(
      existingPayslip.adjustment_lines
        .filter(
          (line) =>
            line.adjustment_type === "deduction" &&
            line.label !== "Superannuation" &&
            line.label !== "Levy",
        )
        .map((line) => ({
          id: nextRowId(),
          label: line.label,
          amount: line.amount,
        })),
    );

    const rate = provider?.associate_split_per_case_rate;
    setCaseCount(
      provider?.split_source_method === "per-case" && rate
        ? round2((existingPayslip.associate_split_amount ?? 0) / rate)
        : 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, existingPayslip]);

  // Auto-populate gross fee lines from production for the selected month (add mode only —
  // editing a saved draft should show its stored values, not silently refresh them).
  useEffect(() => {
    if (!open || mode !== "add" || !productionData) return;
    setPrivateFees(productionData.totalPrivate);
    setMembershipFees(productionData.totalMembership);
    setNhsFees(productionData.totalNhs);
  }, [open, mode, monthEnding, productionData]);

  const grossFeesTotal = round2(privateFees + membershipFees + nhsFees);
  const grossDeductionsTotal = round2(badDebts + otherDeductions);
  const totalGrossFees = round2(grossFeesTotal - grossDeductionsTotal);
  const monthHours = workingHoursData?.totalHours ?? 0;
  const splitMethod = provider?.split_source_method || "flat-percentage";

  const payBandResult = useMemo(() => {
    if (!provider)
      return { percentage: null as number | null, amount: 0, bandLines: [] };
    return computePayBand(provider, totalGrossFees, {
      slidingBands: associateBands,
      monthHours,
      caseCount,
    });
  }, [provider, totalGrossFees, associateBands, monthHours, caseCount]);

  const labBandResult = useMemo(() => {
    if (!provider)
      return { percentage: null as number | null, amount: 0, bandLines: [] };
    return computeLabBand(provider, totalGrossFees, { slidingBands: labBands });
  }, [provider, totalGrossFees, labBands]);

  const labsTotal =
    splitMethod === "sliding-scale"
      ? round2(
          labBandResult.bandLines.reduce(
            (sum, band) => sum + band.gross_band_amount,
            0,
          ),
        )
      : totalGrossFees;

  const additionsTotal = round2(
    additionRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  );
  const deductionsTotal = round2(
    (Number(superannuation) || 0) +
      (Number(levy) || 0) +
      deductionRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  );
  const netPay = computeNetPay(
    payBandResult.amount,
    labBandResult.amount,
    additionsTotal,
    deductionsTotal,
  );

  const buildPayload = (status: PayslipStatus): PayslipSavePayload => ({
    id: mode === "edit" ? payslipId : undefined,
    provider_id: providerId,
    provider_name: provider?.name || "",
    month_ending: format(monthEnding, "yyyy-MM-dd"),
    statement_date: format(statementDate, "yyyy-MM-dd"),
    udas,
    status,
    gross_fees_total: grossFeesTotal,
    gross_deductions_total: grossDeductionsTotal,
    total_gross_fees: totalGrossFees,
    associate_split_percentage: payBandResult.percentage,
    associate_split_amount: payBandResult.amount,
    pay_band_associate_share_total: payBandResult.amount,
    labs_total: labsTotal,
    associate_lab_split_percentage: labBandResult.percentage,
    associate_lab_split_amount: labBandResult.amount,
    associate_lab_share_total: labBandResult.amount,
    additions_total: additionsTotal,
    deductions_total: deductionsTotal,
    net_pay: netPay,
    income_lines: [
      {
        line_type: "income",
        line_key: "private_fees",
        label: "Private Fees",
        display_order: 0,
        amount: privateFees,
      },
      {
        line_type: "income",
        line_key: "membership_fees",
        label: "Membership Fees",
        display_order: 1,
        amount: membershipFees,
      },
      {
        line_type: "income",
        line_key: "nhs_fees",
        label: "NHS Fees",
        display_order: 2,
        amount: nhsFees,
      },
      {
        line_type: "deduction",
        line_key: "bad_debts",
        label: "Bad Debts",
        display_order: 3,
        amount: badDebts,
      },
      {
        line_type: "deduction",
        line_key: "other_deductions",
        label: "Other Deductions",
        display_order: 4,
        amount: otherDeductions,
      },
    ],
    pay_band_lines: payBandResult.bandLines,
    lab_band_lines: labBandResult.bandLines,
    adjustment_lines: [
      {
        adjustment_type: "deduction",
        label: "Superannuation",
        display_order: 0,
        amount: superannuation,
      },
      {
        adjustment_type: "deduction",
        label: "Levy",
        display_order: 1,
        amount: levy,
      },
      ...additionRows.map((row, index) => ({
        adjustment_type: "addition" as const,
        label: row.label || `Addition ${index + 1}`,
        display_order: 10 + index,
        amount: row.amount,
      })),
      ...deductionRows.map((row, index) => ({
        adjustment_type: "deduction" as const,
        label: row.label || `Deduction ${index + 1}`,
        display_order: 20 + index,
        amount: row.amount,
      })),
    ],
  });

  const handleSave = (status: PayslipStatus) => {
    savePayslip(buildPayload(status), { onSuccess: () => onOpenChange(false) });
  };

  const title =
    mode === "add"
      ? "Add Payslip"
      : mode === "edit"
        ? "Edit Payslip"
        : "View Payslip";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {mode !== "add" && isLoadingExisting ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading payslip...
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-4"
          >
            <TabsList>
              <TabsTrigger value="gross-fees">
                Gross Fees & Deductions
              </TabsTrigger>
              <TabsTrigger value="pay-bands">Pay Bands</TabsTrigger>
              <TabsTrigger value="labs">Labs</TabsTrigger>
              <TabsTrigger value="adjustments">
                Additions & Deductions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gross-fees" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Month Ending</Label>
                  <ConfigProvider
                    theme={{ token: { colorPrimary: "hsl(244, 48%, 25%)" } }}
                  >
                    <DatePicker
                      picker="month"
                      className="w-full"
                      format="MMM YYYY"
                      value={dayjs(monthEnding)}
                      disabled={readOnly}
                      onChange={(date) =>
                        date && setMonthEnding(date.endOf("month").toDate())
                      }
                    />
                  </ConfigProvider>
                </div>
                <div className="space-y-2">
                  <Label>Statement Date</Label>
                  <ConfigProvider
                    theme={{ token: { colorPrimary: "hsl(244, 48%, 25%)" } }}
                  >
                    <DatePicker
                      className="w-full"
                      format="DD-MM-YYYY"
                      value={dayjs(statementDate)}
                      disabled={readOnly}
                      onChange={(date) =>
                        date && setStatementDate(date.toDate())
                      }
                    />
                  </ConfigProvider>
                </div>
                <div className="space-y-2">
                  <Label>UDAs</Label>
                  <Input
                    type="number"
                    value={udas}
                    disabled={readOnly}
                    onChange={(e) => setUdas(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border p-4 space-y-3">
                <h4 className="font-semibold text-foreground">Gross Fees</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Private Fees</Label>
                    <Input
                      type="number"
                      value={privateFees}
                      disabled={readOnly}
                      onChange={(e) => setPrivateFees(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Membership Fees</Label>
                    <Input
                      type="number"
                      value={membershipFees}
                      disabled={readOnly}
                      onChange={(e) =>
                        setMembershipFees(Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>NHS Fees</Label>
                    <Input
                      type="number"
                      value={nhsFees}
                      disabled={readOnly}
                      onChange={(e) => setNhsFees(Number(e.target.value))}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Gross Fees Total: {formatCurrency(grossFeesTotal)}
                </p>
              </div>

              <div className="rounded-md border border-border p-4 space-y-3">
                <h4 className="font-semibold text-foreground">
                  Gross Deductions
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Bad Debts</Label>
                    <Input
                      type="number"
                      value={badDebts}
                      disabled={readOnly}
                      onChange={(e) => setBadDebts(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Other Deductions</Label>
                    <Input
                      type="number"
                      value={otherDeductions}
                      disabled={readOnly}
                      onChange={(e) =>
                        setOtherDeductions(Number(e.target.value))
                      }
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Gross Deductions Total: {formatCurrency(grossDeductionsTotal)}
                </p>
              </div>

              <p className="font-semibold text-foreground">
                Total Gross Fees Less Deductions:{" "}
                {formatCurrency(totalGrossFees)}
              </p>
            </TabsContent>

            <TabsContent value="pay-bands" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Split Source Method:{" "}
                <span className="font-medium text-foreground">
                  {SPLIT_METHOD_LABELS[splitMethod] || splitMethod}
                </span>
              </p>

              {splitMethod === "flat-percentage" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Split Percentage</Label>
                    <Input value={payBandResult.percentage ?? 0} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Split Amount</Label>
                    <Input
                      value={formatCurrency(payBandResult.amount)}
                      disabled
                    />
                  </div>
                </div>
              )}

              {splitMethod === "per-case" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Case Count</Label>
                    <Input
                      type="number"
                      value={caseCount}
                      disabled={readOnly}
                      onChange={(e) => setCaseCount(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Associate Split Amount (Rate × Cases)</Label>
                    <Input
                      value={formatCurrency(payBandResult.amount)}
                      disabled
                    />
                  </div>
                </div>
              )}

              {splitMethod === "per-hour" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Hours Worked This Month</Label>
                    <Input value={monthHours} disabled />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Rate Per Hour</Label>
                      {provider?.employment_type === "employee" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-[220px] text-xs">
                                Employment Type is Employee, so a {PER_HOUR_EMPLOYEE_UPLIFT_PERCENT}%
                                uplift is automatically added to the contracted rate per hour.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <Input
                      value={formatCurrency(payBandResult.effectiveRatePerHour ?? 0)}
                      disabled
                    />
                    {provider?.employment_type === "employee" && (
                      <p className="text-xs text-muted-foreground">
                        Includes {PER_HOUR_EMPLOYEE_UPLIFT_PERCENT}% employee uplift on the base rate of{" "}
                        {formatCurrency(provider?.associate_split_per_hour_rate ?? 0)}/hr.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Associate Split Amount (Rate × Hours)</Label>
                    <Input
                      value={formatCurrency(payBandResult.amount)}
                      disabled
                    />
                  </div>
                </div>
              )}

              {splitMethod === "sliding-scale" && (
                <div className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Band</TableHead>
                        <TableHead className="text-right">Start</TableHead>
                        <TableHead className="text-right">End</TableHead>
                        <TableHead className="text-right">Split %</TableHead>
                        <TableHead className="text-right">
                          Band Amount
                        </TableHead>
                        <TableHead className="text-right">
                          Associate Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payBandResult.bandLines.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-muted-foreground"
                          >
                            No sliding scale bands configured for this provider.
                          </TableCell>
                        </TableRow>
                      ) : (
                        payBandResult.bandLines.map((band) => (
                          <TableRow key={band.band_order}>
                            <TableCell>{band.band_name}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.start_value)}
                            </TableCell>
                            <TableCell className="text-right">
                              {band.end_value
                                ? formatCurrency(band.end_value)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {band.associate_percentage}%
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.gross_band_amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.associate_amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <p className="font-semibold text-foreground">
                    Pay Band Associate Share Total:{" "}
                    {formatCurrency(payBandResult.amount)}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="labs" className="space-y-4">
              {splitMethod === "sliding-scale" ? (
                <div className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Band</TableHead>
                        <TableHead className="text-right">Start</TableHead>
                        <TableHead className="text-right">End</TableHead>
                        <TableHead className="text-right">Split %</TableHead>
                        <TableHead className="text-right">
                          Band Amount
                        </TableHead>
                        <TableHead className="text-right">
                          Associate Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {labBandResult.bandLines.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-muted-foreground"
                          >
                            No lab sliding scale bands configured for this
                            provider.
                          </TableCell>
                        </TableRow>
                      ) : (
                        labBandResult.bandLines.map((band) => (
                          <TableRow key={band.band_order}>
                            <TableCell>{band.band_name}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.start_value)}
                            </TableCell>
                            <TableCell className="text-right">
                              {band.end_value
                                ? formatCurrency(band.end_value)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {band.associate_percentage}%
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.gross_band_amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(band.associate_amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Lab Split Percentage</Label>
                    <Input value={labBandResult.percentage ?? 0} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Labs Total</Label>
                    <Input value={formatCurrency(labsTotal)} disabled />
                  </div>
                </div>
              )}
              <p className="font-semibold text-foreground">
                Associate Lab Share Total:{" "}
                {formatCurrency(labBandResult.amount)}
              </p>
            </TabsContent>

            <TabsContent value="adjustments" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Superannuation</Label>
                  <Input
                    type="number"
                    value={superannuation}
                    disabled={readOnly}
                    onChange={(e) => setSuperannuation(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Levy</Label>
                  <Input
                    type="number"
                    value={levy}
                    disabled={readOnly}
                    onChange={(e) => setLevy(Number(e.target.value))}
                  />
                </div>
              </div>

              <AdjustmentRowsEditor
                title="Additions"
                rows={additionRows}
                setRows={setAdditionRows}
                readOnly={readOnly}
              />
              <AdjustmentRowsEditor
                title="Deductions"
                rows={deductionRows}
                setRows={setDeductionRows}
                readOnly={readOnly}
              />

              <div className="rounded-md border border-border p-4 space-y-1">
                <p className="text-sm text-muted-foreground">
                  Additions Total: {formatCurrency(additionsTotal)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Deductions Total: {formatCurrency(deductionsTotal)}
                </p>
                <p className="font-semibold text-foreground text-lg">
                  Net Pay: {formatCurrency(netPay)}
                </p>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <>
              <Button
                variant="outline"
                onClick={() => handleSave("draft")}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Save as Draft"
                )}
              </Button>
              <Button
                onClick={() => handleSave("posted")}
                disabled={isSaving}
                className="gap-2 text-white"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentRowsEditor({
  title,
  rows,
  setRows,
  readOnly,
}: {
  title: string;
  rows: AdjustmentRow[];
  setRows: Dispatch<SetStateAction<AdjustmentRow[]>>;
  readOnly: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-foreground">{title}</h4>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { id: nextRowId(), label: "", amount: 0 },
              ])
            }
          >
            <Plus className="w-4 h-4" />
            Add {title.slice(0, -1)}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {title.toLowerCase()} added.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                placeholder="Label"
                value={row.label}
                disabled={readOnly}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) =>
                      r.id === row.id ? { ...r, label: e.target.value } : r,
                    ),
                  )
                }
              />
              <Input
                type="number"
                placeholder="Amount"
                value={row.amount}
                disabled={readOnly}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) =>
                      r.id === row.id
                        ? { ...r, amount: Number(e.target.value) }
                        : r,
                    ),
                  )
                }
                className="w-32"
              />
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setRows((prev) => prev.filter((r) => r.id !== row.id))
                  }
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
