import { useEffect, useState } from 'react';
import { Sparkles, Wand2, Check, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CompetitorRow,
  SuggestableField,
  SuggestionSource,
  TreatmentPricingAnalysis,
} from '@/hooks/useTreatmentPricingSuggestions';

const FIELD_LABELS: Record<SuggestableField, string> = {
  price: 'Amount',
  duration_minutes: 'Dentist Time Mins',
  therapist_time_mins: 'Therapist Time Mins',
  lab_bill: 'Lab Bill',
  lab_bill_discount: 'Lab Bill Discount',
  material_cost: 'Material Cost',
  percent_fees: 'Associate Pay (%)',
  therapist_pay_rate: 'Therapist Pay Rate',
  hourly_rate: 'Operating Cost / Surgery / Hr',
  finance_fee: 'Finance Fee (%)',
  average_time_minutes: 'Completion Time Used Mins',
};

const FIELD_ORDER: SuggestableField[] = [
  'price',
  'duration_minutes',
  'therapist_time_mins',
  'lab_bill',
  'lab_bill_discount',
  'material_cost',
  'percent_fees',
  'therapist_pay_rate',
  'hourly_rate',
  'finance_fee',
  'average_time_minutes',
];

const CURRENCY_FIELDS = new Set<SuggestableField>([
  'price',
  'lab_bill',
  'lab_bill_discount',
  'material_cost',
  'therapist_pay_rate',
  'hourly_rate',
]);

const PERCENT_FIELDS = new Set<SuggestableField>(['percent_fees', 'finance_fee']);

const fmtCurrency = (v: number, currency = 'GBP') => {
  const localeMap: Record<string, string> = { GBP: 'en-GB', USD: 'en-US', EUR: 'en-IE' };
  try {
    return new Intl.NumberFormat(localeMap[currency] || 'en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v}`;
  }
};

const formatValue = (field: SuggestableField, value: number, currency?: string) => {
  if (CURRENCY_FIELDS.has(field)) return fmtCurrency(value, currency);
  if (PERCENT_FIELDS.has(field)) return `${value}%`;
  return `${value} mins`;
};

const SOURCE_LABEL: Record<SuggestionSource, string> = {
  peer: 'Peer',
  area: 'Area',
  web: 'Web',
  market: 'Market',
};

const SOURCE_STYLE: Record<SuggestionSource, string> = {
  peer: 'bg-primary/10 text-primary border-primary/20',
  area: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  web: 'bg-blue-50 text-blue-700 border-blue-200',
  market: 'bg-amber-50 text-amber-700 border-amber-200',
};

// proximity_tier → human label. Tightest tier first; same-postcode is
// most useful, country-level is barely "nearby" at all and lets the
// user judge how loose the match is at a glance.
const PROXIMITY_LABEL: Record<string, string> = {
  postcode_exact: 'Same postcode',
  postcode_outward: 'Same district',
  postcode_area: 'Same region',
  city: 'Same city',
  state: 'Same county',
  country: 'Same country',
};

// match_level → label. 'category' = same broad bucket only (e.g. both
// in "Restorative") — that's too loose to compare unit prices, so we
// flag it. 'code' is the tightest, 'name' is mid.
const MATCH_LABEL: Record<string, string> = {
  code: 'Same code',
  name: 'Same name',
  category: 'Same category',
};

// SuggestableField → matching numeric column on CompetitorRow.
const COMPETITOR_FIELD_MAP: Record<SuggestableField, keyof CompetitorRow> = {
  price: 'price',
  duration_minutes: 'duration_minutes',
  therapist_time_mins: 'therapist_time_mins',
  lab_bill: 'lab_bill',
  lab_bill_discount: 'lab_bill_discount',
  material_cost: 'material_cost',
  percent_fees: 'percent_fees',
  therapist_pay_rate: 'therapist_pay_rate',
  hourly_rate: 'hourly_rate',
  finance_fee: 'finance_fee',
  average_time_minutes: 'average_time_minutes',
};

interface Props {
  analysis: TreatmentPricingAnalysis | null;
  isLoading: boolean;
  error: string | null;
  currentValues: Record<SuggestableField, number>;
  canApply: boolean;
  scopeHint?: string;
  onGenerate: (force?: boolean) => void;
  onApply: (field: SuggestableField, value: number) => void;
  onApplyAll: () => void;
  // Org-global cooldown anchor — used to disable Generate even before any
  // suggestions have been loaded, so users can't burn rate-limit tokens
  // by hopping between treatments.
  globalCooldownAt?: string | null;
  globalCooldownTtl?: number;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'available';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  return `${hours}h ${restMins.toString().padStart(2, '0')}m`;
}

export function TreatmentAISuggestionsPanel({
  analysis,
  isLoading,
  error,
  currentValues,
  canApply,
  scopeHint,
  onGenerate,
  onApply,
  onApplyAll,
  globalCooldownAt,
  globalCooldownTtl,
}: Props) {
  // Two flavours of "has analysis":
  //   hasAnalysis     — generate has run and produced *something* (even
  //                     an empty suggestions map). Drives header layout
  //                     (Refresh button, area benchmark hint).
  //   hasSuggestions  — at least one usable suggestion came back. Drives
  //                     whether to render accordions vs an empty-state
  //                     message in the success branch.
  // Splitting these two lets the panel show a clear "AI returned no
  // suggestions, retry" message instead of silently re-displaying the
  // pre-click "Generate Suggestions" CTA.
  const hasAnalysis = !!analysis;
  const hasSuggestions =
    !!analysis && Object.keys(analysis.suggestions).length > 0;
  const currency = analysis?.currency;
  const actionableFields = analysis
    ? FIELD_ORDER.filter((f) => {
        const sug = analysis.suggestions[f];
        if (!sug) return false;
        const current = currentValues[f] ?? 0;
        return Math.abs(sug.value - current) >= 0.01;
      })
    : [];

  const competitors = analysis?.competitors ?? [];
  // Show any clinic that has a name. The accordion body handles the
  // case where rating/price/other fields are null (with an explanatory
  // line). Filtering harder here was making the panel look empty even
  // when web_search legitimately returned 5 named local clinics — the
  // user wants to SEE them and decide; that's more useful than hiding.
  const usableCompetitors = competitors.filter((c) => !!c.clinic_name);
  const hasUsableCompetitors = usableCompetitors.length > 0;

  // Live cooldown — strictly PER-TREATMENT. Each treatment has its own
  // lastGeneratedAt (loaded from localStorage cache or the DB row), and
  // the cooldown applies only to that treatment's Refresh button. A
  // treatment that has never been generated shows Generate enabled,
  // regardless of activity on other treatments.
  const [now, setNow] = useState(() => Date.now());
  // Prefer the LIVE setting (globalCooldownTtl) over the value that
  // was stamped onto the analysis at generation time. Otherwise, when
  // an admin shortens the regenerate window in settings, treatments
  // that already have a cached analysis keep counting against the old
  // (longer) TTL until the cache expires — confusing UX.
  const ttl =
    typeof globalCooldownTtl === 'number'
      ? globalCooldownTtl
      : (analysis?.regenerateAfterSeconds ?? 0);
  const lastAt = analysis?.lastGeneratedAt
    ? new Date(analysis.lastGeneratedAt).getTime()
    : null;
  const cooldownEndsAt = lastAt && ttl > 0 ? lastAt + ttl * 1000 : null;
  const remainingSeconds = cooldownEndsAt
    ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
    : 0;
  const isCoolingDown = remainingSeconds > 0;
  // globalCooldownAt is reserved for the org-wide rate-limit anchor.
  // Not used yet — kept on the props so the hook can wire it in later.
  void globalCooldownAt;

  useEffect(() => {
    if (!isCoolingDown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isCoolingDown]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Suggested Pricing
          </CardTitle>
          {hasAnalysis && !isLoading && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrap in span so the tooltip still fires when the button is disabled */}
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onGenerate(true)}
                      disabled={isCoolingDown}
                      className="h-7 px-2 gap-1 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {isCoolingDown
                        ? `Refresh in ${formatRemaining(remainingSeconds)}`
                        : 'Refresh'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  {isCoolingDown
                    ? `Cache valid for another ${formatRemaining(remainingSeconds)}. Refresh becomes available when the cache expires.`
                    : 'Bypass cache and re-run the AI now.'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {scopeHint ?? 'Benchmarked against similar treatments at your other clinic locations.'}
        </p>
        {hasAnalysis && analysis?.areaBenchmark && (
          <p className="text-[11px] text-emerald-700 mt-1">
            Area benchmark: avg of {analysis.areaBenchmark.clinic_count} clinics in {analysis.areaBenchmark.geo_label}
            {analysis.areaBenchmark.geo_level !== 'city' && ` (${analysis.areaBenchmark.geo_level})`}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Pre-click empty state — generate has never run for this treatment. */}
        {!hasAnalysis && !isLoading && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Wand2 className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Generate pricing suggestions using internal peers + local market data.
            </p>
            <Button
              onClick={() => onGenerate()}
              className="gap-2"
              size="sm"
            >
              <Sparkles className="h-4 w-4" />
              Generate Suggestions
            </Button>
            {error && (
              <p className="text-xs text-destructive mt-2">{error}</p>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Crunching per data...</p>
          </div>
        )}

        {hasAnalysis && !isLoading && analysis && (
          <>
            {/* Soft error banner — only shown when generate() did produce
                deterministic peer/area suggestions but the LLM gap-fill
                step failed (e.g. Anthropic 429). When peer/area is also
                empty, the "AI returned no suggestions" retry block below
                is more useful, so suppress this one. */}
            {error && hasSuggestions && (
              <div className="rounded-md border bg-amber-50 border-amber-200 p-2 text-[11px] text-amber-700">
                AI enrichment unavailable: {error} — peer/area suggestions still apply.
              </div>
            )}
            {canApply && actionableFields.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onApplyAll}
                className="w-full gap-2"
              >
                <Check className="h-4 w-4" />
                Apply all suggestions ({actionableFields.length})
              </Button>
            )}

            {/* Genuine no-op case: suggestions came back but every one
                matched the user's value within threshold. */}
            {actionableFields.length === 0 && hasSuggestions && (
              <div className="rounded-md border bg-emerald-50 border-emerald-200 p-3 text-center">
                <p className="text-sm font-medium text-emerald-700">
                  All values are already in line
                </p>
                <p className="text-[11px] text-emerald-600/80 mt-0.5">
                  No changes recommended based on the available data.
                </p>
              </div>
            )}
            {/* Generate ran but came back empty across BOTH the merged
                Avg suggestions AND the per-clinic competitor list. Only
                show the retry box in that all-empty case — if web search
                returned named clinics, fall through to the accordion
                stack below so the user sees them. */}
            {actionableFields.length === 0 &&
              !hasSuggestions &&
              !hasUsableCompetitors && (
                <div className="rounded-md border bg-amber-50 border-amber-200 p-3 text-center space-y-2">
                  <p className="text-sm font-medium text-amber-700">
                    AI returned no suggestions
                  </p>
                  {error ? (
                    <p className="text-[11px] text-amber-700 break-words">
                      <span className="font-semibold">Reason:</span> {error}
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-600/80">
                      The model produced no usable answer this run. Possible
                      causes: rate limit, empty system prompt, or no published
                      data for this treatment. Check the browser console for
                      an "[ai-pricing]" warning.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onGenerate(true)}
                    className="gap-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try again
                  </Button>
                </div>
              )}

            {/* Panel-level accordion stack:
                  1. "Avg Suggested Pricing" — all actionable field rows
                     with Apply buttons. Open by default (primary content).
                     Hidden when there are no usable Avg suggestions (e.g.
                     LLM returned empty), but the competitor accordions
                     below should still render in that case.
                  2..4. One accordion per nearby competitor clinic — that
                     clinic's value for every field they report data for,
                     with diff vs current. Closed by default. */}
            {(hasSuggestions || hasUsableCompetitors) && (
            <Accordion
              type="multiple"
              defaultValue={['avg']}
              className="rounded-md border bg-card divide-y"
            >
              <AccordionItem value="avg" className="border-b-0 px-3">
                <AccordionTrigger className="py-2.5 text-sm font-medium hover:no-underline">
                  <div className="flex items-center gap-2 text-left">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>Avg Suggested Pricing</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      ({actionableFields.length} field{actionableFields.length === 1 ? '' : 's'})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3 pt-0">
                  {actionableFields.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-2">
                      No aggregated suggestions for this run. See the
                      individual clinic rows below for raw prices you can
                      apply directly.
                    </p>
                  )}
                  <div className="space-y-2">
                    {actionableFields.map((field) => {
                      const sug = analysis.suggestions[field]!;
                      const current = currentValues[field] ?? 0;
                      const diff = sug.value - current;
                      const diffPct = current !== 0 ? (diff / current) * 100 : 0;
                      return (
                        <div
                          key={field}
                          className="rounded-md border bg-background p-2.5 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">
                                  {FIELD_LABELS[field]}
                                </p>
                                {sug.sources && sug.sources.length > 0 && (
                                  <div className="flex gap-1 shrink-0">
                                    {sug.sources.map((s) => (
                                      <span
                                        key={s}
                                        className={`text-[9px] uppercase tracking-wider font-semibold border rounded px-1 py-px ${SOURCE_STYLE[s]}`}
                                      >
                                        {SOURCE_LABEL[s]}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-baseline gap-2 mt-0.5">
                                <span className="text-sm font-semibold">
                                  {formatValue(field, sug.value, currency)}
                                </span>
                                <span
                                  className={`text-[11px] font-medium ${
                                    diff > 0 ? 'text-emerald-600' : 'text-amber-600'
                                  }`}
                                >
                                  {diff > 0 ? '↑' : '↓'} {Math.abs(diffPct).toFixed(0)}%
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                                Current: {formatValue(field, current, currency)}
                              </p>
                              <p className="text-xs mt-1 leading-snug text-foreground/80">
                                {sug.reason}
                              </p>
                            </div>
                            {canApply && (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 shrink-0 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
                                onClick={() => onApply(field, sug.value)}
                                title="Apply this suggestion"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* One accordion per nearby competitor clinic. Names come
                  from a low-token Anthropic web_search call (capped at
                  3 searches, 4000 max_tokens). Web-sourced rows mostly
                  only carry `price`; other fields stay null since the
                  public web rarely exposes per-treatment cost breakdowns. */}
              {competitors.map((c, idx) => {
                const hasPrice =
                  typeof c.price === 'number' &&
                  Number.isFinite(c.price) &&
                  c.price > 0;
                const otherFieldRows: { field: SuggestableField; value: number }[] = [];
                for (const field of FIELD_ORDER) {
                  if (field === 'price') continue;
                  const col = COMPETITOR_FIELD_MAP[field];
                  const value = c[col] as number | null;
                  if (
                    typeof value === 'number' &&
                    Number.isFinite(value) &&
                    value > 0
                  ) {
                    otherFieldRows.push({ field, value });
                  }
                }

                // Hide nameless rows — these come from stale localStorage
                // cache (older data shape that didn't include clinic_name).
                // Showing "Clinic 1" with no real identity is worse than
                // showing nothing; the user can hit Refresh to repopulate.
                if (!c.clinic_name) return null;

                // Previously also skipped clinics with no price + no
                // rating + no other fields. Removed: the accordion body
                // already shows "<clinic> doesn't publish a price for
                // this treatment" for that case, which is more useful
                // than hiding the clinic entirely. Users want to see
                // the local-clinic NAMES even when prices aren't
                // published — knowing the competition is data too.

                // Whether to show "Estimated" instead of a real source URL.
                // 'xref:<url>' means the AI cross-referenced from another
                // clinic's published fee page when this clinic didn't
                // publish — that's a real source, not an estimate.
                const isXref =
                  typeof c.price_source === 'string' &&
                  c.price_source.startsWith('xref:');
                const xrefUrl = isXref
                  ? (c.price_source as string).slice(5)
                  : null;
                const isEstimated =
                  !isXref &&
                  (c.price_source === 'estimated' ||
                    c.price_source === null ||
                    c.price_source === undefined);

                return (
                  <AccordionItem
                    key={idx}
                    value={`clinic-${idx}`}
                    className="border-b-0 px-3"
                  >
                    <AccordionTrigger className="py-2.5 text-sm hover:no-underline">
                      <div className="flex items-center gap-2 text-left min-w-0 flex-1">
                        <span className="font-medium truncate">
                          {c.clinic_name}
                        </span>
                        {c.source_type && (
                          <span
                            className={`text-[9px] uppercase tracking-wider font-semibold border rounded px-1 py-px shrink-0 ${
                              SOURCE_STYLE[
                                c.source_type === 'peer'
                                  ? 'peer'
                                  : c.source_type === 'area'
                                    ? 'area'
                                    : 'web'
                              ]
                            }`}
                          >
                            {c.source_type === 'peer'
                              ? 'Your loc'
                              : c.source_type === 'area'
                                ? 'Nearby'
                                : 'Web'}
                          </span>
                        )}
                        {/* Proximity tier + match level — only meaningful
                            for area-RPC rows. Helps spot when "Nearby"
                            is actually country-wide or when "Same
                            category" is masking a treatment mismatch
                            (e.g. £2510 implant vs £40 check-up under
                            the same Restorative bucket). */}
                        {c.source_type === 'area' &&
                          c.proximity_tier &&
                          PROXIMITY_LABEL[c.proximity_tier] && (
                            <span className="text-[10px] text-muted-foreground font-normal shrink-0">
                              · {PROXIMITY_LABEL[c.proximity_tier]}
                            </span>
                          )}
                        {c.source_type === 'area' &&
                          c.match_level &&
                          MATCH_LABEL[c.match_level] && (
                            <span
                              className={`text-[10px] font-normal shrink-0 ${
                                c.match_level === 'category'
                                  ? 'text-amber-600'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              · {MATCH_LABEL[c.match_level]}
                            </span>
                          )}
                        {typeof c.rating === 'number' && (
                          <span className="text-[10px] text-amber-600 font-medium shrink-0">
                            ★ {c.rating.toFixed(1)}
                            {typeof c.review_count === 'number' &&
                              ` (${c.review_count})`}
                          </span>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 pt-0">
                      {/* Clinic rows mirror the avg-accordion card layout
                          so the user can compare side-by-side and adopt
                          any specific clinic's value via per-row Apply.
                          Concatenate price (when present) + the other
                          fields the clinic has data for. */}
                      <div className="space-y-2">
                        {(() => {
                          const allRows: {
                            field: SuggestableField;
                            value: number;
                          }[] = [];
                          if (hasPrice) {
                            allRows.push({ field: 'price', value: c.price as number });
                          }
                          allRows.push(...otherFieldRows);

                          // Web-sourced clinics often only have a name +
                          // rating with no published prices. Explain this
                          // explicitly instead of leaving an empty body.
                          if (allRows.length === 0) {
                            return (
                              <p className="text-[11px] text-muted-foreground italic text-center py-2 leading-snug">
                                {c.clinic_name} doesn't publish a price for
                                this treatment on their website.
                                {typeof c.rating === 'number' &&
                                  ` Their Google rating is ★${c.rating.toFixed(1)}${
                                    typeof c.review_count === 'number'
                                      ? ` (${c.review_count} reviews)`
                                      : ''
                                  }.`}
                              </p>
                            );
                          }

                          return allRows.map(({ field, value }) => {
                            const cur = currentValues[field] ?? 0;
                            const d = value - cur;
                            const dPct = cur !== 0 ? (d / cur) * 100 : 0;
                            const isPriceRow = field === 'price';
                            return (
                              <div
                                key={field}
                                className="rounded-md border bg-background p-2.5 hover:border-primary/40 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs text-muted-foreground">
                                      {FIELD_LABELS[field]}
                                    </p>
                                    <div className="flex items-baseline gap-2 mt-0.5">
                                      <span className="text-sm font-semibold tabular-nums">
                                        {formatValue(field, value, currency)}
                                      </span>
                                      {cur !== 0 && (
                                        <span
                                          className={`text-[11px] font-medium ${
                                            d > 0
                                              ? 'text-emerald-600'
                                              : d < 0
                                                ? 'text-amber-600'
                                                : 'text-muted-foreground'
                                          }`}
                                        >
                                          {d === 0
                                            ? '='
                                            : `${d > 0 ? '↑' : '↓'} ${Math.abs(dPct).toFixed(0)}%`}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                                      Current: {formatValue(field, cur, currency)}
                                    </p>
                                    {/* Source / estimated note shown only
                                        on the price row — that's the only
                                        web-sourced field with a citation. */}
                                    {isPriceRow && (
                                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug italic">
                                        {isEstimated
                                          ? 'Estimated — clinic does not publish this price.'
                                          : isXref
                                            ? `Cross-referenced from ${xrefUrl} (this clinic does not publish — price taken from a nearby clinic's fee page).`
                                            : `Source: ${c.price_source}`}
                                      </p>
                                    )}
                                  </div>
                                  {canApply && (
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-7 w-7 shrink-0 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
                                      onClick={() => onApply(field, value)}
                                      title={`Apply ${c.clinic_name}'s ${FIELD_LABELS[field]}`}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
            )}

          </>
        )}
      </CardContent>
    </Card>
  );
}
