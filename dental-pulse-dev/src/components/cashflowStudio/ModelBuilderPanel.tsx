/**
 * Cash Flow Scenario Studio — the Week-0 model builder view.
 *
 * Implements the cash-flow-model-builder skill's UI: ingest messy exports,
 * preview the seven workbook tabs (README, Input Inventory, Weekly Schedules,
 * 13-Week Forecast, Exceptions, Self-Check, CFO Summary), and download the
 * downloadable .xlsx. A "Load sample data" path exercises the whole pipeline
 * without any upload.
 */

import { useRef } from 'react';
import { Upload, Download, Sparkles, FileSpreadsheet, ArrowRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  WEEKS,
  RECEIPT_KEYS,
  DISBURSEMENT_KEYS,
  type CashFlowModel,
  type CheckStatus,
} from '@/lib/cashflowStudio/types';
import { computeBase } from '@/lib/cashflowStudio/engine';
import { fmtFull } from '@/lib/cashflowStudio/format';

interface Props {
  model: CashFlowModel | null;
  warnings: string[];
  isParsing: boolean;
  onLoadSample: () => void;
  onFiles: (files: FileList) => void;
  onDownload: () => void;
  onOpenDashboard: () => void;
  /** Optional live-data loader (rendered under the ingest buttons). */
  dentpulseSlot?: React.ReactNode;
}

export function ModelBuilderPanel({
  model,
  warnings,
  isParsing,
  onLoadSample,
  onFiles,
  onDownload,
  onOpenDashboard,
  dentpulseSlot,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      {/* Ingest controls */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Build a Week-0 13-week forecast</h2>
              <p className="text-sm text-muted-foreground">
                Upload messy finance exports (bank, AR aging, AP, POs, payroll) as CSV or Excel — or
                start from a sample dataset.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files && onFiles(e.target.files)}
              />
              <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={isParsing}>
                {isParsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload exports
              </Button>
              <Button variant="secondary" onClick={onLoadSample} disabled={isParsing}>
                <Sparkles className="mr-2 h-4 w-4" />
                Load sample data
              </Button>
            </div>
          </div>

          {dentpulseSlot && <div className="mt-4 border-t pt-4">{dentpulseSlot}</div>}

          {warnings.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="mb-1 font-semibold">Parser notes</div>
              <ul className="list-inside list-disc space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {!model ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No model yet. Upload exports or load the sample to build the 13-week forecast.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Model header + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{model.title}</h2>
              <Badge variant={model.isDraft ? 'destructive' : 'secondary'}>
                {model.isDraft ? 'Draft — review required' : 'Ready for review'}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download .xlsx
              </Button>
              <Button onClick={onOpenDashboard}>
                Open Scenario Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 7 tabs */}
          <Tabs defaultValue="forecast">
            <TabsList className="flex-wrap">
              <TabsTrigger value="readme">README</TabsTrigger>
              <TabsTrigger value="inventory">Input Inventory</TabsTrigger>
              <TabsTrigger value="schedules">Weekly Schedules</TabsTrigger>
              <TabsTrigger value="forecast">13-Week Forecast</TabsTrigger>
              <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
              <TabsTrigger value="selfcheck">Self-Check</TabsTrigger>
              <TabsTrigger value="cfo">CFO Summary</TabsTrigger>
            </TabsList>

            <TabsContent value="readme">
              <ReadmeTab model={model} />
            </TabsContent>
            <TabsContent value="inventory">
              <InventoryTab model={model} />
            </TabsContent>
            <TabsContent value="schedules">
              <SchedulesTab model={model} />
            </TabsContent>
            <TabsContent value="forecast">
              <ForecastTab model={model} />
            </TabsContent>
            <TabsContent value="exceptions">
              <ExceptionsTab model={model} />
            </TabsContent>
            <TabsContent value="selfcheck">
              <SelfCheckTab model={model} />
            </TabsContent>
            <TabsContent value="cfo">
              <CFOSummaryTab model={model} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ── tab bodies ──────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mt-2">
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function ReadmeTab({ model }: { model: CashFlowModel }) {
  return (
    <Panel>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <Row k="Model title" v={model.title} />
        <Row k="As-of date" v={model.asOfDate} />
        <Row k="Currency" v={model.currencySymbol} />
        <Row k="Cash threshold" v={fmtFull(model.threshold, model.currencySymbol)} />
        <Row k="Opening cash" v={fmtFull(model.openingCash, model.currencySymbol)} />
        <Row k="Status" v={model.isDraft ? 'Draft — CFO review required' : 'Ready for CFO review'} />
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Scope: one entity, one bank account, one currency, 13 weekly periods. Not modelled:
        multi-entity, multi-currency, covenants, full audit trail. This is a first-pass model —
        verify Exceptions before decisions.
      </p>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function InventoryTab({ model }: { model: CashFlowModel }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {['File', 'Type', 'Rows', 'Date range', 'Forecast use', 'Usage', 'Issues'].map((h) => (
                <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.inventory.map((r, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="py-2 pr-4 font-medium">{r.fileName}</td>
                <td className="py-2 pr-4">{r.fileType}</td>
                <td className="py-2 pr-4 tabular-nums">{r.rowCount.toLocaleString()}</td>
                <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{r.dateRange}</td>
                <td className="py-2 pr-4">{r.forecastUse}</td>
                <td className="py-2 pr-4">
                  <Badge variant={r.usage === 'Used' ? 'secondary' : 'outline'}>{r.usage}</Badge>
                </td>
                <td className="py-2 text-muted-foreground">{r.issues}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SchedulesTab({ model }: { model: CashFlowModel }) {
  const sym = model.currencySymbol;
  return (
    <Panel>
      <WideTable
        model={model}
        sections={[
          {
            title: 'Inflows',
            rows: RECEIPT_KEYS.map((k) => ({ label: model.labels.receipts[k], values: model.receipts[k] })),
          },
          {
            title: 'Outflows',
            rows: DISBURSEMENT_KEYS.map((k) => ({
              label: model.labels.disbursements[k],
              values: model.disbursements[k],
            })),
          },
        ]}
        sym={sym}
      />
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Key assumptions
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {model.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Excluded items
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {model.excludedItems.length ? (
              model.excludedItems.map((x, i) => <li key={i}>{x}</li>)
            ) : (
              <li>None.</li>
            )}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function ForecastTab({ model }: { model: CashFlowModel }) {
  const sym = model.currencySymbol;
  const f = computeBase(model);
  return (
    <Panel>
      <WideTable
        model={model}
        sections={[
          { title: '', rows: [{ label: 'Opening cash', values: f.openingByWeek, muted: true }] },
          {
            title: 'Receipts',
            rows: [
              ...RECEIPT_KEYS.map((k) => ({ label: model.labels.receipts[k], values: model.receipts[k] })),
              { label: 'Total cash receipts', values: f.totalReceipts, bold: true },
            ],
          },
          {
            title: 'Disbursements',
            rows: [
              ...DISBURSEMENT_KEYS.map((k) => ({
                label: model.labels.disbursements[k],
                values: model.disbursements[k],
              })),
              { label: 'Total cash disbursements', values: f.totalDisbursements, bold: true },
            ],
          },
          {
            title: '',
            rows: [
              { label: 'Net cash flow', values: f.netCashFlow, bold: true },
              { label: 'Ending cash', values: f.endingCash, bold: true },
            ],
          },
        ]}
        belowThreshold={f.belowThreshold}
        sym={sym}
      />
    </Panel>
  );
}

function ExceptionsTab({ model }: { model: CashFlowModel }) {
  const sym = model.currencySymbol;
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {['Issue', 'Source', 'Reference', 'Amount', 'Treatment', 'CFO review'].map((h) => (
                <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.exceptions.map((e, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="py-2 pr-4 font-medium">{e.issueType}</td>
                <td className="py-2 pr-4 text-muted-foreground">{e.sourceFile}</td>
                <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{e.sourceRef ?? '—'}</td>
                <td className="py-2 pr-4 tabular-nums">{e.amount != null ? fmtFull(e.amount, sym) : '—'}</td>
                <td className="py-2 pr-4">{e.treatment}</td>
                <td className="py-2">
                  {e.cfoReview ? (
                    <Badge variant="destructive">Yes</Badge>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const CHECK_TONE: Record<CheckStatus, string> = {
  PASS: 'text-emerald-600',
  WARNING: 'text-amber-600',
  FAIL: 'text-red-600',
};

function SelfCheckTab({ model }: { model: CashFlowModel }) {
  return (
    <Panel>
      <ul className="space-y-2">
        {model.selfChecks.map((c, i) => (
          <li key={i} className="flex items-start gap-3 border-b py-2 last:border-0 text-sm">
            <span className={`w-16 shrink-0 text-xs font-bold ${CHECK_TONE[c.status]}`}>{c.status}</span>
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CFOSummaryTab({ model }: { model: CashFlowModel }) {
  const s = model.cfoSummary;
  const sym = model.currencySymbol;
  return (
    <Panel>
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <Row k="As-of date" v={s.asOfDate} />
        <Row k="Opening cash" v={fmtFull(s.openingCash, sym)} />
        <Row k="Ending cash (Week 13)" v={fmtFull(s.endingCash, sym)} />
        <Row k="Minimum cash" v={`${fmtFull(s.minCashAmount, sym)} (Week ${s.minCashWeek})`} />
        <Row k="Cash threshold" v={fmtFull(s.threshold, sym)} />
        <Row k="Weeks below threshold" v={String(s.weeksBelowThreshold)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        <Bullets title="Biggest inflow risks" items={s.inflowRisks} />
        <Bullets title="Biggest outflow risks" items={s.outflowRisks} />
        <Bullets title="Most important exceptions" items={s.topExceptions} />
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ready for CFO review
          </div>
          <Badge variant={s.readyForReview ? 'secondary' : 'destructive'}>
            {s.readyForReview ? 'Yes' : 'No — draft'}
          </Badge>
        </div>
      </div>
      <p className="mt-4 rounded-md bg-muted p-3 text-sm">{s.summaryText}</p>
    </Panel>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
        {items.length ? items.map((it, i) => <li key={i}>{it}</li>) : <li>None.</li>}
      </ul>
    </div>
  );
}

// ── wide 13-week table ──────────────────────────────────────────────

interface TableRow {
  label: string;
  values: number[];
  bold?: boolean;
  muted?: boolean;
}
interface TableSection {
  title: string;
  rows: TableRow[];
}

function WideTable({
  model,
  sections,
  belowThreshold,
  sym,
}: {
  model: CashFlowModel;
  sections: TableSection[];
  belowThreshold?: boolean[];
  sym: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card py-2 pr-3 text-left font-medium">Line</th>
            {model.weeks.map((w, i) => (
              <th
                key={w.label}
                className={`px-2 py-2 text-right font-medium ${belowThreshold?.[i] ? 'text-red-600' : ''}`}
              >
                W{i + 1}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, si) => (
            <SectionRows key={si} section={sec} belowThreshold={belowThreshold} sym={sym} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({
  section,
  belowThreshold,
  sym,
}: {
  section: TableSection;
  belowThreshold?: boolean[];
  sym: string;
}) {
  return (
    <>
      {section.title && (
        <tr>
          <td
            colSpan={WEEKS + 2}
            className="sticky left-0 bg-card pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {section.title}
          </td>
        </tr>
      )}
      {section.rows.map((r, ri) => {
        const total = r.values.reduce((a, b) => a + b, 0);
        return (
          <tr key={ri} className={`border-b last:border-0 ${r.bold ? 'font-semibold' : ''}`}>
            <td
              className={`sticky left-0 z-10 bg-card py-1.5 pr-3 text-left ${r.muted ? 'text-muted-foreground' : ''}`}
            >
              {r.label}
            </td>
            {r.values.map((v, i) => (
              <td
                key={i}
                className={`px-2 py-1.5 text-right tabular-nums ${belowThreshold?.[i] && r.label === 'Ending cash' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : ''}`}
              >
                {v === 0 ? <span className="text-muted-foreground/40">—</span> : fmtFull(v, sym)}
              </td>
            ))}
            <td className="px-2 py-1.5 text-right font-medium tabular-nums">
              {r.label === 'Ending cash' || r.label === 'Opening cash' ? '' : fmtFull(total, sym)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
