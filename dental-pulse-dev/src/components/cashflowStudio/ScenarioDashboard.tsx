/**
 * Cash Flow Scenario Studio — the decision layer.
 *
 * Implements the cash-flow-scenario-dashboard skill: KPI cards, scenario
 * selector + levers, a 13-week ending-cash chart (base vs scenario + threshold),
 * a weekly cash-movement chart, a scenario impact table, a CFO exceptions panel,
 * and a written interpretation. All scenario numbers recompute from the weekly
 * cash lines via the engine — never from hard-coded ending-cash values.
 */

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CashFlowModel, PresetName, ScenarioLevers } from '@/lib/cashflowStudio/types';
import { computeBase, computeScenario, presetLevers, sensitivity } from '@/lib/cashflowStudio/engine';
import { fmtCompact, fmtFull, fmtSignedCompact } from '@/lib/cashflowStudio/format';

const PRESETS: { key: PresetName; label: string }[] = [
  { key: 'base', label: 'Base Case' },
  { key: 'downside', label: 'Downside' },
  { key: 'management', label: 'Management Action' },
  { key: 'upside', label: 'Upside' },
  { key: 'custom', label: 'Custom' },
];

export function ScenarioDashboard({ model }: { model: CashFlowModel }) {
  const sym = model.currencySymbol;
  const [preset, setPreset] = useState<PresetName>('base');
  const [levers, setLevers] = useState<ScenarioLevers>(() => presetLevers('base', model.threshold));

  const base = useMemo(() => computeBase(model), [model]);
  const scenario = useMemo(() => computeScenario(model, levers), [model, levers]);
  const sens = useMemo(() => sensitivity(model, levers.threshold), [model, levers.threshold]);

  const applyPreset = (p: PresetName) => {
    setPreset(p);
    if (p !== 'custom') setLevers(presetLevers(p, levers.threshold));
  };
  const patch = (p: Partial<ScenarioLevers>) => {
    setLevers((prev) => ({ ...prev, ...p }));
    setPreset('custom');
  };

  const chartData = model.weeks.map((w, i) => ({
    week: w.label.replace('Week ', 'W'),
    base: Math.round(base.endingCash[i]),
    scenario: Math.round(scenario.endingCash[i]),
    threshold: Math.round(levers.threshold),
    receipts: Math.round(scenario.totalReceipts[i]),
    disbursements: -Math.round(scenario.totalDisbursements[i]),
    net: Math.round(scenario.netCashFlow[i]),
  }));

  const endDelta = scenario.endingCash[12] - base.endingCash[12];
  const minDelta = scenario.minCashAmount - base.minCashAmount;
  const topLever = sens[0];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{model.title}</h1>
          <p className="text-sm text-muted-foreground">
            As of {model.asOfDate} · 13-week horizon · threshold {fmtFull(model.threshold, sym)}
          </p>
        </div>
        <Badge
          variant={model.isDraft || model.cfoSummary.topExceptions.length ? 'destructive' : 'secondary'}
          className="mt-1"
        >
          {model.isDraft
            ? 'Draft — CFO Review Required'
            : model.cfoSummary.topExceptions.length
              ? 'CFO Review Required'
              : 'Ready for Review'}
        </Badge>
      </div>

      {/* 2. KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Opening cash" value={fmtCompact(model.openingCash, sym)} />
        <Kpi label="Base ending" value={fmtCompact(base.endingCash[12], sym)} />
        <Kpi
          label="Scenario ending"
          value={fmtCompact(scenario.endingCash[12], sym)}
          accent={endDelta >= 0 ? 'pos' : 'neg'}
        />
        <Kpi label="Base min cash" value={fmtCompact(base.minCashAmount, sym)} sub={`Week ${base.minCashWeek}`} />
        <Kpi
          label="Scenario min cash"
          value={fmtCompact(scenario.minCashAmount, sym)}
          sub={`Week ${scenario.minCashWeek}`}
          accent={scenario.minCashAmount < levers.threshold ? 'neg' : minDelta >= 0 ? 'pos' : 'neg'}
        />
        <Kpi
          label="Weeks below threshold"
          value={`${scenario.weeksBelowThreshold}`}
          sub={`base ${base.weeksBelowThreshold}`}
          accent={scenario.weeksBelowThreshold > 0 ? 'neg' : 'pos'}
        />
        <Kpi
          label="Δ vs base ending"
          value={fmtSignedCompact(endDelta, sym)}
          accent={endDelta >= 0 ? 'pos' : 'neg'}
        />
      </div>

      {/* 3. Scenario selector */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? 'default' : 'outline'}
            onClick={() => applyPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* 4. Levers */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
          <LeverSelect
            label="AR collection timing"
            value={String(levers.arTimingDays)}
            onChange={(v) => patch({ arTimingDays: Number(v) as ScenarioLevers['arTimingDays'] })}
            options={[
              { v: '-7', l: '7 days earlier' },
              { v: '0', l: 'No change' },
              { v: '7', l: '7 days later' },
              { v: '14', l: '14 days later' },
              { v: '21', l: '21 days later' },
            ]}
          />
          <LeverSlider
            label="Retail / online / marketplace receipts"
            value={levers.receiptChangePct}
            min={-20}
            max={20}
            step={1}
            display={`${levers.receiptChangePct > 0 ? '+' : ''}${levers.receiptChangePct}%`}
            onChange={(v) => patch({ receiptChangePct: v })}
          />
          <LeverSlider
            label="Discretionary marketing reduction"
            value={levers.marketingReductionPct}
            min={0}
            max={30}
            step={1}
            display={`−${levers.marketingReductionPct}%`}
            onChange={(v) => patch({ marketingReductionPct: v })}
          />
          <LeverSelect
            label="Operating AP stretch"
            value={String(levers.apStretchDays)}
            onChange={(v) => patch({ apStretchDays: Number(v) as ScenarioLevers['apStretchDays'] })}
            options={[
              { v: '0', l: 'No stretch' },
              { v: '7', l: '+7 days' },
              { v: '14', l: '+14 days' },
            ]}
          />
          <LeverSelect
            label="Purchase commitment delay"
            value={String(levers.poDelayDays)}
            onChange={(v) => patch({ poDelayDays: Number(v) as ScenarioLevers['poDelayDays'] })}
            options={[
              { v: '0', l: 'No delay' },
              { v: '7', l: '+7 days' },
              { v: '14', l: '+14 days' },
            ]}
          />
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Cash threshold</label>
            <Input
              type="number"
              value={levers.threshold}
              onChange={(e) => patch({ threshold: Number(e.target.value) || 0 })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 5. Forecast visualization */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ending cash — base vs scenario</h2>
            {scenario.delayedBeyondHorizon > 0 && (
              <span className="text-xs text-muted-foreground">
                {fmtCompact(scenario.delayedBeyondHorizon, sym)} shifted beyond Week 13
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => fmtCompact(v, sym)} width={64} />
              <RTooltip
                formatter={(v: number, n: string) => [fmtFull(v, sym), labelFor(n)]}
                labelClassName="text-xs"
                contentStyle={{ fontSize: 12 }}
              />
              <Legend formatter={labelFor} wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                y={levers.threshold}
                stroke="#f59e0b"
                strokeDasharray="5 4"
                label={{ value: 'Threshold', position: 'insideTopRight', fontSize: 11, fill: '#f59e0b' }}
              />
              <Line
                type="monotone"
                dataKey="base"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 3"
              />
              <Line
                type="monotone"
                dataKey="scenario"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={(props: { cx?: number; cy?: number; payload?: { scenario: number; threshold: number } }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload) return <g />;
                  const below = payload.scenario < payload.threshold;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={below ? 4.5 : 3}
                      fill={below ? '#dc2626' : '#2563eb'}
                      stroke="white"
                      strokeWidth={1}
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 6. Weekly cash movement */}
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Weekly cash movement (scenario)</h2>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => fmtCompact(v, sym)} width={64} />
              <RTooltip
                formatter={(v: number, n: string) => [fmtFull(Math.abs(v), sym), labelFor(n)]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend formatter={labelFor} wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <Bar dataKey="receipts" fill="#16a34a" radius={[2, 2, 0, 0]} />
              <Bar dataKey="disbursements" fill="#ef4444" radius={[0, 0, 2, 2]} />
              <Line type="monotone" dataKey="net" stroke="#0f172a" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 7. Scenario impact table */}
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Scenario impact vs base</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Metric</th>
                  <th className="py-2 pr-4 font-medium">Base</th>
                  <th className="py-2 pr-4 font-medium">Scenario</th>
                  <th className="py-2 font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                <ImpactRow label="Ending cash (Week 13)" base={fmtFull(base.endingCash[12], sym)} scen={fmtFull(scenario.endingCash[12], sym)} delta={endDelta} sym={sym} />
                <ImpactRow label="Minimum cash" base={fmtFull(base.minCashAmount, sym)} scen={fmtFull(scenario.minCashAmount, sym)} delta={minDelta} sym={sym} />
                <ImpactRow label="Minimum cash week" base={`Week ${base.minCashWeek}`} scen={`Week ${scenario.minCashWeek}`} />
                <ImpactRow label="Weeks below threshold" base={`${base.weeksBelowThreshold}`} scen={`${scenario.weeksBelowThreshold}`} delta={base.weeksBelowThreshold - scenario.weeksBelowThreshold} isCount sym={sym} />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Main drivers: {describeLevers(levers) || 'no levers applied (base case)'}.
          </p>
        </CardContent>
      </Card>

      {/* 8. Exceptions / CFO review panel */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ExceptionGroup
          icon={<ShieldAlert className="h-4 w-4" />}
          title="CFO review required"
          tone="danger"
          items={model.exceptions.filter((e) => e.category === 'cfo')}
          sym={sym}
        />
        <ExceptionGroup
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Model warnings"
          tone="warning"
          items={model.exceptions.filter((e) => e.category === 'warning')}
          sym={sym}
        />
        <ExceptionGroup
          icon={<Info className="h-4 w-4" />}
          title="Informational"
          tone="info"
          items={model.exceptions.filter((e) => e.category === 'informational')}
          sym={sym}
        />
      </div>

      {/* 9. CFO interpretation */}
      <Card>
        <CardContent className="space-y-2 p-5 text-sm">
          <h2 className="text-sm font-semibold">CFO interpretation</h2>
          <p className="text-muted-foreground">
            Under <span className="font-medium text-foreground">{PRESETS.find((p) => p.key === preset)?.label}</span>,
            ending cash moves {fmtSignedCompact(endDelta, sym)} to {fmtFull(scenario.endingCash[12], sym)} and
            minimum cash lands at {fmtFull(scenario.minCashAmount, sym)} in Week {scenario.minCashWeek}
            {scenario.weeksBelowThreshold > 0
              ? `, breaching the threshold in ${scenario.weeksBelowThreshold} week(s).`
              : ', staying above the threshold all quarter.'}
          </p>
          {topLever && (
            <p className="text-muted-foreground">
              The single lever that moves minimum cash most is{' '}
              <span className="font-medium text-foreground">{topLever.label}</span> ({fmtSignedCompact(topLever.delta, sym)}).
            </p>
          )}
          <p className="text-muted-foreground">
            Review first:{' '}
            <span className="font-medium text-foreground">
              {model.cfoSummary.topExceptions[0] ?? 'no CFO-review exceptions outstanding'}
            </span>
            {scenario.minCashAmount < levers.threshold
              ? ` — and confirm a plan to cover the Week ${scenario.minCashWeek} dip below ${fmtFull(levers.threshold, sym)}.`
              : '.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── sub-components ──────────────────────────────────────────────────

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'pos' | 'neg' }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-lg font-semibold ${accent === 'neg' ? 'text-red-600' : accent === 'pos' ? 'text-emerald-600' : ''}`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function LeverSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v}>
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LeverSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <span className="text-xs font-semibold tabular-nums">{display}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function ImpactRow({
  label,
  base,
  scen,
  delta,
  isCount,
  sym,
}: {
  label: string;
  base: string;
  scen: string;
  delta?: number;
  isCount?: boolean;
  sym?: string;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{base}</td>
      <td className="py-2 pr-4 font-medium tabular-nums">{scen}</td>
      <td className="py-2 tabular-nums">
        {delta == null ? (
          '—'
        ) : (
          <span className={delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {isCount
              ? `${delta > 0 ? '+' : ''}${delta}`
              : fmtSignedCompact(delta, sym ?? '$')}
          </span>
        )}
      </td>
    </tr>
  );
}

function ExceptionGroup({
  icon,
  title,
  tone,
  items,
  sym,
}: {
  icon: React.ReactNode;
  title: string;
  tone: 'danger' | 'warning' | 'info';
  items: CashFlowModel['exceptions'];
  sym: string;
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : 'text-sky-600';
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${toneCls}`}>
          {icon}
          {title}
          <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((e, i) => (
              <li key={i} className="text-xs">
                <div className="font-medium">
                  {e.issueType}
                  {e.amount != null && (
                    <span className="ml-1 font-normal text-muted-foreground">· {fmtCompact(e.amount, sym)}</span>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {e.sourceFile}
                  {e.sourceRef ? ` · ${e.sourceRef}` : ''} — {e.treatment}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function labelFor(key: string): string {
  const map: Record<string, string> = {
    base: 'Base ending cash',
    scenario: 'Scenario ending cash',
    threshold: 'Threshold',
    receipts: 'Receipts',
    disbursements: 'Disbursements',
    net: 'Net cash flow',
  };
  return map[key] ?? key;
}

function describeLevers(l: ScenarioLevers): string {
  const parts: string[] = [];
  if (l.arTimingDays !== 0) parts.push(`AR ${l.arTimingDays > 0 ? '+' : ''}${l.arTimingDays}d`);
  if (l.receiptChangePct !== 0) parts.push(`receipts ${l.receiptChangePct > 0 ? '+' : ''}${l.receiptChangePct}%`);
  if (l.marketingReductionPct !== 0) parts.push(`marketing −${l.marketingReductionPct}%`);
  if (l.apStretchDays !== 0) parts.push(`AP +${l.apStretchDays}d`);
  if (l.poDelayDays !== 0) parts.push(`PO +${l.poDelayDays}d`);
  return parts.join(', ');
}
