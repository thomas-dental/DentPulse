import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAnthropicKey } from '@/lib/aiKey';
import { Treatment } from '@/types/treatment';
import {
  KNOWN_CLINIC_PRICES,
  findNearbyKnownClinics,
} from '@/data/knownClinicPrices';

export const SUGGESTABLE_FIELDS = [
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
] as const;

export type SuggestableField = (typeof SUGGESTABLE_FIELDS)[number];

export type SuggestionSource = 'peer' | 'area' | 'web' | 'market';

export interface FieldSuggestion {
  value: number;
  reason: string;
  sources?: SuggestionSource[];
}

export interface AreaBenchmark {
  match_level: 'code' | 'name' | 'category';
  geo_level: 'city' | 'state' | 'country';
  geo_label: string;
  clinic_count: number;
  sample_count: number;
  avg_price: number | null;
  median_price: number | null;
  avg_duration_minutes: number | null;
  avg_therapist_time_mins: number | null;
  avg_lab_bill: number | null;
  avg_lab_bill_discount: number | null;
  avg_material_cost: number | null;
  avg_percent_fees: number | null;
  avg_therapist_pay_rate: number | null;
  avg_hourly_rate: number | null;
  avg_finance_fee: number | null;
  avg_average_time_minutes: number | null;
}

export type ProximityTier =
  | 'postcode_exact'
  | 'postcode_outward'
  | 'postcode_area'
  | 'city'
  | 'state'
  | 'country';

export interface CompetitorRow {
  clinic_name: string | null;
  // Where this row came from. Drives the badge shown next to the clinic
  // name in the panel header so the user can tell their own locations
  // ('peer') from nearby DentPulse customers ('area') from web-scraped
  // results ('web'). Optional — legacy cached entries (pre-v3) won't have it.
  source_type?: 'peer' | 'area' | 'web';
  proximity_tier: ProximityTier;
  match_level?: 'code' | 'name' | 'category';
  // Web-sourced competitors carry rating + review count so the panel can
  // surface "rules best than my clinic" context. Both null when unknown.
  rating?: number | null;
  review_count?: number | null;
  // Either a short URL fragment (e.g. "trinitydental.co.uk/fees") or the
  // literal string "estimated" when the clinic doesn't publish the price.
  price_source?: string | null;
  price: number | null;
  duration_minutes: number | null;
  therapist_time_mins: number | null;
  lab_bill: number | null;
  lab_bill_discount: number | null;
  material_cost: number | null;
  percent_fees: number | null;
  therapist_pay_rate: number | null;
  hourly_rate: number | null;
  finance_fee: number | null;
  average_time_minutes: number | null;
}

export interface TreatmentPricingAnalysis {
  summary: string;
  currency?: string;
  suggestions: Partial<Record<SuggestableField, FieldSuggestion>>;
  peerCount: number;
  hasMarketArea: boolean;
  scopeLabel?: string;
  areaBenchmark?: AreaBenchmark | null;
  // Up to 3 anonymized competitor rows from the tightest postcode tier
  // that has data. UI labels them Clinic A/B/C in array order.
  competitors?: CompetitorRow[];
  // ISO timestamp of when this analysis was last produced (fresh call) or
  // last applied (cached row's applied_at). Drives the Refresh-button
  // cooldown countdown in the panel.
  lastGeneratedAt?: string | null;
  // The cache TTL (seconds) effective at the time of generation, so the
  // panel can compute remaining time without re-reading settings.
  regenerateAfterSeconds?: number;
}

interface PeerRow {
  location: string | null;
  organization: string | null;
  price: number | null;
  duration_minutes: number | null;
  therapist_time_mins: number | null;
  lab_bill: number | null;
  lab_bill_discount: number | null;
  material_cost: number | null;
  percent_fees: number | null;
  therapist_pay_rate: number | null;
  hourly_rate: number | null;
  finance_fee: number | null;
  average_time_minutes: number | null;
}

const PEER_SELECT = `
  id, organization_id, location_id, treatment_code, treatment_name,
  price, duration_minutes, therapist_time_mins, lab_bill, lab_bill_discount,
  material_cost, percent_fees, therapist_pay_rate, hourly_rate, finance_fee,
  average_time_minutes,
  category:treatment_categories!treatments_category_id_fkey(name),
  location:practice_locations!treatments_location_id_fkey(location_name),
  organization:organizations!treatments_organization_id_fkey(name)
`;

async function fetchPeerTreatments(
  treatment: Treatment,
  scope: { peerLocationIds?: string[] | null; excludeLocationId?: string | null },
): Promise<PeerRow[]> {
  const orParts: string[] = [];
  if (treatment.treatment_code) {
    orParts.push(`treatment_code.eq.${treatment.treatment_code}`);
  }
  if (treatment.treatment_name) {
    orParts.push(`treatment_name.eq.${treatment.treatment_name}`);
  }
  if (treatment.category_id) {
    orParts.push(`category_id.eq.${treatment.category_id}`);
  }
  if (orParts.length === 0) return [];

  let query = (supabase as any)
    .from('treatments')
    .select(PEER_SELECT)
    .or(orParts.join(','))
    .neq('id', treatment.id)
    .is('deleted_at', null);

  if (scope.peerLocationIds && scope.peerLocationIds.length > 0) {
    query = query.in('location_id', scope.peerLocationIds);
  } else if (scope.excludeLocationId) {
    query = query.neq('location_id', scope.excludeLocationId);
  }

  // Cap at 15 — beyond that, the median doesn't shift much but input tokens balloon.
  const { data, error } = await query.limit(15);

  if (error) {
    console.error('[ai-pricing] peer fetch failed:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    location: row.location?.location_name ?? null,
    organization: row.organization?.name ?? null,
    price: row.price,
    duration_minutes: row.duration_minutes,
    therapist_time_mins: row.therapist_time_mins,
    lab_bill: row.lab_bill,
    lab_bill_discount: row.lab_bill_discount,
    material_cost: row.material_cost,
    percent_fees: row.percent_fees,
    therapist_pay_rate: row.therapist_pay_rate,
    hourly_rate: row.hourly_rate,
    finance_fee: row.finance_fee,
    average_time_minutes: row.average_time_minutes,
  }));
}

interface AICallInput {
  currentTreatment: Record<string, unknown>;
  peerTreatments: PeerRow[];
  locationName?: string;
  organizationName?: string;
  marketArea?: string;
  areaBenchmark?: AreaBenchmark | null;
}

// Map of SuggestableField -> AreaBenchmark column that holds its average
const AREA_FIELD_MAP: Record<SuggestableField, keyof AreaBenchmark> = {
  price: 'avg_price',
  duration_minutes: 'avg_duration_minutes',
  therapist_time_mins: 'avg_therapist_time_mins',
  lab_bill: 'avg_lab_bill',
  lab_bill_discount: 'avg_lab_bill_discount',
  material_cost: 'avg_material_cost',
  percent_fees: 'avg_percent_fees',
  therapist_pay_rate: 'avg_therapist_pay_rate',
  hourly_rate: 'avg_hourly_rate',
  finance_fee: 'avg_finance_fee',
  average_time_minutes: 'avg_average_time_minutes',
};

const CURRENCY_FIELDS_SET = new Set<SuggestableField>([
  'price',
  'lab_bill',
  'lab_bill_discount',
  'material_cost',
  'therapist_pay_rate',
  'hourly_rate',
]);

const PERCENT_FIELDS_SET = new Set<SuggestableField>([
  'percent_fees',
  'finance_fee',
]);

const TIME_FIELDS_SET = new Set<SuggestableField>([
  'duration_minutes',
  'therapist_time_mins',
  'average_time_minutes',
]);

function roundForField(field: SuggestableField, value: number): number {
  if (CURRENCY_FIELDS_SET.has(field)) return Math.round(value);
  if (PERCENT_FIELDS_SET.has(field)) return Math.round(value * 10) / 10;
  if (TIME_FIELDS_SET.has(field)) return Math.round(value / 5) * 5;
  return Math.round(value);
}

function meetsThreshold(
  field: SuggestableField,
  suggested: number,
  current: number,
): boolean {
  const diff = Math.abs(suggested - current);
  if (TIME_FIELDS_SET.has(field)) return diff >= 5;
  // currency / percent: ≥1% relative change (with floor at 0.5 absolute for tiny values)
  if (current === 0) return diff >= 0.5;
  return diff / Math.abs(current) >= 0.01;
}

// Map of SuggestableField -> the field on PeerRow that holds its raw value.
// Used to compute medians client-side so we don't need an LLM round-trip
// when peer data alone is enough to produce a suggestion.
const PEER_FIELD_MAP: Record<SuggestableField, keyof PeerRow> = {
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

const PEER_MIN_SAMPLES = 3;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build deterministic PEER-based suggestions from the user's other locations.
 * Computes the median per field across peer rows. Same shape as the AREA
 * helper, but tagged with sources: ['peer']. Skipped entirely if fewer
 * than PEER_MIN_SAMPLES peers are available.
 *
 * This eliminates the need for any LLM call when peer data alone covers
 * every suggestable field.
 */
function buildDeterministicPeerSuggestions(
  peers: PeerRow[],
  currentValues: Record<string, number | string | null>,
): Partial<Record<SuggestableField, FieldSuggestion>> {
  const out: Partial<Record<SuggestableField, FieldSuggestion>> = {};

  (Object.keys(PEER_FIELD_MAP) as SuggestableField[]).forEach((field) => {
    const col = PEER_FIELD_MAP[field];
    // Pair each numeric sample with its source location so the reason
    // text can name *which* of the user's clinics contributed. Just a
    // count (e.g. "across 15 of your other locations") leaves the user
    // wondering what those 15 are.
    const samples = peers
      .map((p) => ({
        value: p[col] as number | null,
        location: p.location,
      }))
      .filter(
        (s): s is { value: number; location: string | null } =>
          typeof s.value === 'number' && Number.isFinite(s.value) && s.value > 0,
      );
    if (samples.length < PEER_MIN_SAMPLES) return;

    const med = median(samples.map((s) => s.value));
    if (med === null) return;

    const rounded = roundForField(field, med);
    const currentRaw = currentValues[field];
    const currentNum =
      typeof currentRaw === 'number'
        ? currentRaw
        : currentRaw == null
          ? 0
          : Number(currentRaw);
    if (
      !meetsThreshold(
        field,
        rounded,
        Number.isFinite(currentNum) ? currentNum : 0,
      )
    ) {
      return;
    }

    // Build a human-readable list of contributing locations. Capped at
    // 3 names + "+N more" to keep the reason text short — full list is
    // available in console via the [ai-pricing] generate log.
    const locNames = Array.from(
      new Set(samples.map((s) => s.location).filter(Boolean)),
    ) as string[];
    const reasonSuffix =
      locNames.length === 0
        ? ''
        : locNames.length <= 3
          ? `: ${locNames.join(', ')}`
          : `: ${locNames.slice(0, 3).join(', ')}, +${locNames.length - 3} more`;

    out[field] = {
      value: rounded,
      reason: `Median across ${samples.length} of your other locations${reasonSuffix}`,
      sources: ['peer'],
    };
  });

  return out;
}

/**
 * Build deterministic WEB-based suggestions from competitor row prices.
 * Captures the value the user can actually verify — "median of Trinity
 * £180, Bupa £200, Bishopmill £190" — instead of regenerating an
 * estimate via a second LLM call. Currently only fills `price` since
 * web competitor rows rarely carry other fields, but the structure is
 * generic so other fields can be added if a future competitor source
 * exposes them.
 */
function buildDeterministicWebSuggestions(
  competitors: CompetitorRow[],
  currentValues: Record<string, number | string | null>,
): Partial<Record<SuggestableField, FieldSuggestion>> {
  const out: Partial<Record<SuggestableField, FieldSuggestion>> = {};

  // Pull the price column off named web competitors.
  const webPrices = competitors
    .filter(
      (c) =>
        c.source_type === 'web' &&
        !!c.clinic_name &&
        typeof c.price === 'number' &&
        Number.isFinite(c.price) &&
        c.price > 0,
    )
    .map((c) => ({ price: c.price as number, name: c.clinic_name as string }));

  if (webPrices.length >= 2) {
    const med = median(webPrices.map((w) => w.price));
    if (med !== null) {
      const rounded = roundForField('price', med);
      const currentRaw = currentValues['price'];
      const currentNum =
        typeof currentRaw === 'number'
          ? currentRaw
          : currentRaw == null
            ? 0
            : Number(currentRaw);
      if (
        meetsThreshold(
          'price',
          rounded,
          Number.isFinite(currentNum) ? currentNum : 0,
        )
      ) {
        const namedClinics = webPrices.slice(0, 3).map((w) => w.name).join(', ');
        out.price = {
          value: rounded,
          reason: `Average of ${webPrices.length} nearby clinics: ${namedClinics}`,
          sources: ['web'],
        };
      }
    }
  }

  return out;
}

/**
 * Build deterministic AREA-based suggestions directly from the
 * benchmark RPC output. These bypass the LLM so the suggested
 * values are stable across refreshes — they only change when
 * the underlying clinic data changes.
 */
function buildDeterministicAreaSuggestions(
  benchmark: AreaBenchmark,
  currentValues: Record<string, number | string | null>,
): Partial<Record<SuggestableField, FieldSuggestion>> {
  const out: Partial<Record<SuggestableField, FieldSuggestion>> = {};
  const clinicCount = benchmark.clinic_count;
  const geo = benchmark.geo_label || benchmark.geo_level;

  (Object.keys(AREA_FIELD_MAP) as SuggestableField[]).forEach((field) => {
    const col = AREA_FIELD_MAP[field];
    const raw = benchmark[col];
    if (raw === null || raw === undefined) return;
    const numericRaw = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numericRaw) || numericRaw <= 0) return;

    const rounded = roundForField(field, numericRaw);
    const currentRaw = currentValues[field];
    const currentNum =
      typeof currentRaw === 'number'
        ? currentRaw
        : currentRaw == null
          ? 0
          : Number(currentRaw);
    if (!meetsThreshold(field, rounded, Number.isFinite(currentNum) ? currentNum : 0)) {
      return;
    }

    out[field] = {
      value: rounded,
      reason: `Average across ${clinicCount} clinics in ${geo}`,
      sources: ['area'],
    };
  });

  return out;
}

// Tightly-constrained Anthropic call that uses web_search to find up to 3
// nearby competitor dental clinics that out-rank the user's clinic on
// Google reviews, plus each clinic's published price for the treatment.
//
// Token discipline:
//   * max_tokens = 600 (compact JSON output only)
//   * web_search max_uses = 3 (one search per clinic, hard cap)
//   * system prompt ≈ 110 tokens, user message ≈ 40 tokens
//   * If a price isn't published anywhere, the model returns null +
//     "estimated" rather than guessing — the panel surfaces that label
//     so users know which numbers are concrete vs. inferred.
async function fetchCompetitorsViaWebSearch(
  treatment: Treatment,
  meta: {
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    userClinicName?: string | null;
    currency?: string | null;
  },
  settings: {
    modelName: string;
    webSearchToolVersion: string;
  },
): Promise<CompetitorRow[]> {
  let apiKey: string;
  try {
    apiKey = await getAnthropicKey();
  } catch {
    return [];
  }
  if (!treatment.treatment_name && !treatment.treatment_code) return [];

  const locationLabel = [meta.postalCode, meta.city, meta.country]
    .filter(Boolean)
    .join(', ');
  if (!locationLabel) return [];

  // Pick the registered fee pages closest to the user. These URLs are
  // SCRAPED LIVE by the model on every run — no static prices are
  // stored client-side. The model is instructed to open each URL via
  // web_fetch / web_search and extract the line item matching the
  // requested treatment.
  const userClinicNames = [meta.userClinicName]
    .filter((n): n is string => !!n);
  const nearbyKnown = findNearbyKnownClinics({
    city: meta.city ?? null,
    postcodeOutward: meta.postalCode
      ? meta.postalCode.split(' ')[0]
      : null,
    excludeClinicNames: userClinicNames,
    limit: 3,
  });
  const fallbackKnown =
    nearbyKnown.length > 0 ? nearbyKnown : KNOWN_CLINIC_PRICES;
  const registryBlock = fallbackKnown
    .map(
      (c) =>
        `- ${c.clinic_name} (${c.city} ${c.postcode_outward}) → ${c.source_url}`,
    )
    .join('\n');

  const systemPrompt = `Find EXACTLY 3 dental clinics geographically nearest to the user's clinic and produce a numeric price for the named treatment at each. For every clinic, the price MUST come from a live page you actually opened — never a guess.

REGISTERED FEE PAGES (LIVE, SCRAPE THESE FIRST):
${registryBlock}

These URLs are pre-vetted as accurate, current fee pages. Always include any of these clinics in your 3-clinic list when they're near the user, and ALWAYS open them with web_fetch (or web_search → open the registered URL) to read the live price. Do NOT cache, guess, or use prior knowledge for these — re-read the page every run, since fees change. Map the user's treatment name to the clinic's terminology — e.g. "Crown Placement - Bonded (Metal Ceramic)" matches lines like "porcelain bonded crown", "metal ceramic crown", "PFM crown", "porcelain fused to metal", "Tooth crown porcelain bonded". Pick the closest published line item; if there are multiple variants (front vs back teeth, materials), pick the closest match and note the variant in the reason. Drop "From £" prefixes. Set price_source to a short URL fragment of the page you scraped (e.g. "trinitydentist.co.uk/fees" or "bupa.co.uk/.../elgin/treatment-prices").

PRICE SOURCING (most → least preferred):
1. SCRAPE a registered fee page above for this clinic. price_source = short URL fragment.
2. SCRAPE the clinic's own fee page (web_search "<clinic name> dental fees" → open the result). Look for a page titled "Fees", "Prices", "Treatment prices", "Price list". price_source = short URL fragment.
3. CROSS-REFERENCE — if this clinic does not publish the treatment, scrape one of the OTHER registered fee pages above (the one geographically closest), use that price, and set price_source = "xref:<short-url-of-the-page-you-scraped>". This is a real source attribution, not an estimate.
4. ONLY if every scrape attempt above truly fails (page 404, treatment genuinely absent from every registered + own page), fall back to a tier-appropriate UK private-dental estimate. price_source = "estimated".
5. NEVER return null for price.

You MUST actually open at least one URL per clinic before returning. A run that returns "estimated" for all 3 without any successful scrape is wrong.

Each clinic returned will render as its own accordion row alongside the average — so clinic NAME and PRICE for every row must be filled.

Return ONLY this JSON shape, no prose, no markdown:
{"competitors":[{"name":"<clinic name>","rating":<0-5 number>,"reviews":<integer>,"distance":"<short label e.g. 'Same area' or 'IV30'>","price":<number>,"price_source":"<short URL, 'xref:<short-url>', or 'estimated'>"}]}

Rules:
- ALWAYS include exactly 3 clinics — never fewer.
- Each clinic must be DIFFERENT from the user's own clinic (exclude it by name).
- Sort by proximity to the user's clinic first, then by rating × ln(reviews+1) descending as a tiebreaker.
- Currency matches the location (GBP for UK).`;

  const userMsg = `Location: ${locationLabel}
Treatment: ${treatment.treatment_name ?? treatment.treatment_code}${treatment.category?.name ? ` (${treatment.category.name})` : ''}
${meta.userClinicName ? `User clinic: ${meta.userClinicName}` : ''}
Currency: ${meta.currency || 'GBP'}.`;

  const isDev = !!import.meta.env.DEV;
  const url = isDev
    ? '/anthropic-api/v1/messages'
    : 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
  if (!isDev) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.modelName,
        max_tokens: 8000,
        messages: [{ role: 'user', content: userMsg }],
        system: systemPrompt,
        tools: [
          {
            type: settings.webSearchToolVersion,
            name: 'web_search',
            max_uses: 7,
          },
          // web_fetch lets the model pull a specific URL directly,
          // skipping the search step entirely. Without it the model
          // had to burn a search slot just to navigate to a known
          // registered URL. Capped per-run so we don't pay for
          // dozens of fetches; 6 = 3 registered URL scrapes + 3
          // own-site cross-references is plenty for the worst case.
          {
            type: 'web_fetch_20250910',
            name: 'web_fetch',
            max_uses: 6,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        '[ai-pricing] competitors web search HTTP error:',
        response.status,
      );
      return [];
    }

    const result = await response.json();
    const parsed = parseCompetitorsResponse(result);
    console.debug('[ai-pricing] competitors web search returned:', {
      count: parsed.length,
      stop_reason: result?.stop_reason,
      clinics: parsed.map((c) => c.clinic_name),
      // Anthropic returns usage on every successful response. Surfacing
      // it lets you size max_tokens correctly without guessing.
      usage: result?.usage,
      // server_tool_use shows how many web_search calls the model
      // actually made (regardless of max_uses cap).
      server_tool_use: result?.usage?.server_tool_use,
    });
    return parsed;
  } catch (err) {
    console.warn('[ai-pricing] competitors web search exception:', err);
    return [];
  }
}

function parseCompetitorsResponse(result: any): CompetitorRow[] {
  try {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const lastTextBlock = [...blocks]
      .reverse()
      .find((b: any) => b?.type === 'text');
    const rawText: string = lastTextBlock?.text ?? '';
    console.debug('[ai-pricing] competitors raw text block:', {
      hasText: !!rawText.trim(),
      length: rawText.length,
      preview: rawText.slice(0, 400),
    });
    if (!rawText.trim()) return [];

    const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const greedy = cleaned.match(/\{[\s\S]*\}/);
      if (greedy) {
        try {
          parsed = JSON.parse(greedy[0]);
        } catch {
          /* fall through */
        }
      }
    }

    // Accept several plausible array keys — Haiku sometimes returns
    // {clinics: [...]} or {results: [...]} despite the prompt asking
    // for {competitors: [...]}. Don't punish the user with an empty
    // panel just because the model picked a synonym.
    const items: any[] = Array.isArray(parsed?.competitors)
      ? parsed.competitors
      : Array.isArray(parsed?.clinics)
        ? parsed.clinics
        : Array.isArray(parsed?.results)
          ? parsed.results
          : [];
    return items.slice(0, 3).map(
      (c: any): CompetitorRow => ({
        // Same forgiving approach for the clinic name itself.
        clinic_name:
          typeof c.name === 'string'
            ? c.name
            : typeof c.clinic_name === 'string'
              ? c.clinic_name
              : typeof c.clinic === 'string'
                ? c.clinic
                : null,
        source_type: 'web',
        // Web-sourced rows are always area-level; we don't know the exact
        // postcode tier of each Google result.
        proximity_tier: 'postcode_area',
        match_level: 'name',
        rating: typeof c.rating === 'number' ? c.rating : null,
        review_count: typeof c.reviews === 'number' ? c.reviews : null,
        price_source:
          typeof c.price_source === 'string' ? c.price_source : null,
        price: typeof c.price === 'number' ? c.price : null,
        duration_minutes: null,
        therapist_time_mins: null,
        lab_bill: null,
        lab_bill_discount: null,
        material_cost: null,
        percent_fees: null,
        therapist_pay_rate: null,
        hourly_rate: null,
        finance_fee: null,
        average_time_minutes: null,
      }),
    );
  } catch (err) {
    console.warn('[ai-pricing] parse competitors failed:', err);
    return [];
  }
}

// Postgres NUMERIC values arrive from supabase-js as strings — coerce
// them into nullable numbers so the panel doesn't try to format strings.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch nearby DentPulse customer orgs charging for the same treatment
 * via the get_area_treatment_pricing_competitors RPC. Used as a
 * FALLBACK when the live web_search returns nothing — gives the user
 * something concrete to compare against rather than a "no clinics
 * found" empty state. Each row carries proximity_tier + match_level so
 * the panel can warn when the match is loose (e.g. category-only at
 * country level).
 */
async function fetchAreaCompetitors(
  treatment: Treatment,
  excludeOrganizationId: string,
  geo: {
    postalCode?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  },
): Promise<CompetitorRow[]> {
  const hasGeo = !!(geo.postalCode || geo.city || geo.state || geo.country);
  if (!hasGeo) return [];
  if (
    !treatment.treatment_code &&
    !treatment.treatment_name &&
    !treatment.category?.name
  ) {
    return [];
  }

  const { data, error } = await (supabase as any).rpc(
    'get_area_treatment_pricing_competitors',
    {
      p_exclude_organization_id: excludeOrganizationId,
      p_treatment_code: treatment.treatment_code ?? null,
      p_treatment_name: treatment.treatment_name ?? null,
      p_category_name: treatment.category?.name ?? null,
      p_postal_code: geo.postalCode ?? null,
      p_city: geo.city ?? null,
      p_state: geo.state ?? null,
      p_country: geo.country ?? null,
      p_limit: 3,
    },
  );

  if (error) {
    console.warn('[ai-pricing] area competitors RPC failed:', error);
    return [];
  }

  return (data || []).map(
    (row: any): CompetitorRow => ({
      clinic_name: row.clinic_name ?? null,
      source_type: 'area',
      proximity_tier: row.proximity_tier as ProximityTier,
      match_level: row.match_level as 'code' | 'name' | 'category',
      rating: null,
      review_count: null,
      price_source: null,
      price: toNum(row.price),
      duration_minutes: toNum(row.duration_minutes),
      therapist_time_mins: toNum(row.therapist_time_mins),
      lab_bill: toNum(row.lab_bill),
      lab_bill_discount: toNum(row.lab_bill_discount),
      material_cost: toNum(row.material_cost),
      percent_fees: toNum(row.percent_fees),
      therapist_pay_rate: toNum(row.therapist_pay_rate),
      hourly_rate: toNum(row.hourly_rate),
      finance_fee: toNum(row.finance_fee),
      average_time_minutes: toNum(row.average_time_minutes),
    }),
  );
}

// Match the competitor accordions cap (3) so the panel stays compact.
// 15 peer rows would dominate the panel and bury the web competitors.
const MAX_PEER_ACCORDIONS = 3;

const PEER_NUMERIC_KEYS: (keyof PeerRow)[] = [
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

/**
 * Convert peer rows (your other locations) into CompetitorRow shape so
 * the panel renders one accordion per peer location alongside the
 * "Avg Suggested Pricing" accordion. Without this, peer data only shows
 * up rolled into the median — the user can't see what each individual
 * location of theirs charges.
 *
 * Capped at MAX_PEER_ACCORDIONS rows, ranked by how much data each
 * location actually has (more populated fields = more useful comparison).
 * The full peer set still feeds the median in buildDeterministicPeerSuggestions.
 *
 * proximity_tier is set to 'postcode_exact' as a placeholder; peers
 * don't really have a postcode-distance concept since they're the same
 * org. The badge in the panel uses source_type='peer' instead.
 */
function peersToCompetitors(peers: PeerRow[]): CompetitorRow[] {
  // Score each peer by the count of populated numeric fields so the
  // accordions show the locations with the most signal first. Peers
  // with a missing location join (e.g. soft-deleted practice_location)
  // get a placeholder name so they don't silently disappear from the
  // panel — surfacing them lets the user see something is off.
  const scored = peers.map((p, idx) => {
    const populatedFields = PEER_NUMERIC_KEYS.reduce((count, key) => {
      const v = p[key];
      return typeof v === 'number' && Number.isFinite(v) && v > 0
        ? count + 1
        : count;
    }, 0);
    return {
      peer: p,
      populatedFields,
      // Fall back to a positional label rather than nuking the row.
      // Name resolution failure usually points at deleted locations,
      // which the user can fix in Locations setup.
      displayName: p.location || `Other location ${idx + 1}`,
    };
  });

  // Highest-scored first. Stable for ties (Array.sort in V8 is stable),
  // so insertion order from the DB query breaks ties deterministically.
  scored.sort((a, b) => b.populatedFields - a.populatedFields);

  return scored.slice(0, MAX_PEER_ACCORDIONS).map(({ peer: p, displayName }) => ({
    clinic_name: displayName,
    source_type: 'peer' as const,
    proximity_tier: 'postcode_exact' as ProximityTier,
    match_level: 'name' as const,
    rating: null,
    review_count: null,
    price_source: null,
    price: p.price,
    duration_minutes: p.duration_minutes,
    therapist_time_mins: p.therapist_time_mins,
    lab_bill: p.lab_bill,
    lab_bill_discount: p.lab_bill_discount,
    material_cost: p.material_cost,
    percent_fees: p.percent_fees,
    therapist_pay_rate: p.therapist_pay_rate,
    hourly_rate: p.hourly_rate,
    finance_fee: p.finance_fee,
    average_time_minutes: p.average_time_minutes,
  }));
}

async function fetchAreaBenchmark(
  treatment: Treatment,
  excludeOrganizationId: string,
  geo: { city?: string | null; state?: string | null; country?: string | null },
): Promise<AreaBenchmark | null> {
  const hasGeo = !!(geo.city || geo.state || geo.country);
  if (!hasGeo) return null;
  if (!treatment.treatment_code && !treatment.treatment_name && !treatment.category?.name) {
    return null;
  }

  const { data, error } = await (supabase as any).rpc(
    'get_area_treatment_pricing_benchmark',
    {
      p_exclude_organization_id: excludeOrganizationId,
      p_treatment_code: treatment.treatment_code ?? null,
      p_treatment_name: treatment.treatment_name ?? null,
      p_category_name: treatment.category?.name ?? null,
      p_city: geo.city ?? null,
      p_state: geo.state ?? null,
      p_country: geo.country ?? null,
      p_min_clinics: 3,
    },
  );

  if (error) {
    console.error('[ai-pricing] area benchmark RPC failed:', error);
    return null;
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) return null;

  const geoLabel = row.geo_level === 'city'
    ? geo.city ?? ''
    : row.geo_level === 'state'
      ? geo.state ?? ''
      : geo.country ?? '';

  return { ...row, geo_label: geoLabel } as AreaBenchmark;
}

interface AICallSettings {
  systemPrompt: string;
  modelName: string;
  maxTokens: number;
  webSearchEnabled: boolean;
  webSearchToolVersion: string;
}

/**
 * Slim, low-token system prompt for the LLM fallback.
 *
 * Token-counted:
 *   prompt header + JSON shape + rules ≈ 150 tokens
 *
 * The hook only calls the LLM for fields that PEER+AREA didn't cover, so
 * the user message is also tiny. Total per call typically ≤500 input tokens.
 */
const SLIM_SYSTEM_PROMPT = `You are a dental pricing advisor. Suggest values for the listed fields using your training-data knowledge of UK private dental pricing for the named city/region. If a field's current value is null or 0, treat that as "not yet set" and fill it with your best market estimate — do NOT skip it just because no current value exists. Only skip a field when the treatment itself is genuinely unknown (very obscure or unbranded names) AND you would be guessing without any anchor.
Return ONLY:
{"summary":"<≤15 words>","currency":"GBP|USD|EUR","suggestions":{"<field>":{"value":<number>,"reason":"<≤15 words>","sources":["market"]}}}
Numbers: plain, no symbols. Round currency to 1, % to 1 decimal, minutes to nearest 5. Omit fields ONLY when the current value is non-zero AND your suggestion matches it within 1% / 5 mins (i.e. never omit a null or 0 field on threshold grounds). No prose, no markdown — JSON only.`;

async function callAnthropicDirect(
  input: AICallInput,
  settings: AICallSettings,
  fieldsToFill: SuggestableField[],
): Promise<{
  summary: string;
  suggestions: Partial<Record<SuggestableField, FieldSuggestion>>;
}> {
  const apiKey = await getAnthropicKey();

  // If the admin has set a custom prompt in settings, use it. Otherwise use
  // the slim default. Either way, the user message stays minimal.
  const systemPrompt = settings.systemPrompt?.trim()
    ? settings.systemPrompt
    : SLIM_SYSTEM_PROMPT;

  // Compact representation of just the data the LLM needs. We deliberately
  // skip the full PEER row dump (already used deterministically) and the
  // full AREA JSON (also deterministic) — only city/state and the missing
  // fields are sent.
  const currentSubset = fieldsToFill.reduce<Record<string, unknown>>(
    (acc, f) => {
      acc[f] = (input.currentTreatment as any)[f] ?? null;
      return acc;
    },
    {
      name: (input.currentTreatment as any).name,
      code: (input.currentTreatment as any).code,
    },
  );

  const userMessage = `City/region: ${input.marketArea || 'Unknown'}
Treatment: ${JSON.stringify(currentSubset)}
Suggest values for: ${fieldsToFill.join(', ')}.`;

  // Dev: hit the Vite proxy (avoids browser CORS).
  // Prod: call Anthropic directly — no edge function in this flow. Requires
  // anthropic-dangerous-direct-browser-access to bypass CORS preflight.
  const isDev = !!import.meta.env.DEV;
  const url = isDev
    ? '/anthropic-api/v1/messages'
    : 'https://api.anthropic.com/v1/messages';

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
  if (!isDev) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.modelName,
      max_tokens: settings.maxTokens,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      ...(settings.webSearchEnabled && {
        // max_uses caps the searches the model may run. Without it, the
        // tool spec is incomplete and the model may decline to use it
        // — which silently leaves uncovered fields with no web data and
        // produces the empty-suggestions edge case the panel calls out.
        tools: [
          {
            type: settings.webSearchToolVersion,
            name: 'web_search',
            max_uses: 3,
          },
        ],
      }),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();

    // Friendly handling for rate-limit errors. The raw Anthropic error is
    // verbose JSON; surface a short, neutral wait message so the panel
    // doesn't expose token limits or settings hints to the end user.
    if (response.status === 429) {
      throw new Error('Please wait a moment and try again.');
    }

    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  console.debug('[ai-pricing] gap-fill raw response:', {
    stop_reason: result?.stop_reason,
    usage: result?.usage,
    server_tool_use: result?.usage?.server_tool_use,
    content_block_types: Array.isArray(result?.content)
      ? result.content.map((b: any) => b?.type)
      : [],
  });
  return parseAIResponse(result);
}

// Extracted so it's easy to test and so the call site stays readable. Returns
// a graceful empty analysis under any non-JSON response — never throws.
function parseAIResponse(result: any): {
  summary: string;
  suggestions: Partial<Record<SuggestableField, FieldSuggestion>>;
} {
  console.debug('[ai-pricing] parser v3 running');
  try {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const lastTextBlock = [...blocks]
      .reverse()
      .find((b: any) => b?.type === 'text');
    const rawText: string = lastTextBlock?.text ?? '';

    if (!rawText.trim()) {
      return { summary: 'No suggestions available right now.', suggestions: {} };
    }

    const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();

    // Try plain parse
    try {
      return JSON.parse(cleaned);
    } catch {
      /* fall through */
    }

    // Try the largest {...} block (greedy — first { to last })
    const greedy = cleaned.match(/\{[\s\S]*\}/);
    if (greedy) {
      try {
        return JSON.parse(greedy[0]);
      } catch {
        /* fall through */
      }
    }

    // Try the first balanced {...} block
    const start = cleaned.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(cleaned.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
    }

    console.warn('[ai-pricing] non-JSON response:', rawText.slice(0, 300));
    return {
      summary: rawText.trim().slice(0, 200) || 'No suggestions available right now.',
      suggestions: {},
    };
  } catch (err) {
    console.error('[ai-pricing] parser exception:', err);
    return { summary: 'No suggestions available right now.', suggestions: {} };
  }
}

interface CachedAIResponse {
  summary: string;
  currency?: string;
  suggestions: Partial<Record<SuggestableField, FieldSuggestion>>;
  appliedAt: string;
}

// ----------- Global cooldown helpers (per-org, via localStorage) -----------
//
// The Refresh restriction is GLOBAL across the org: if any user just made a
// fresh AI call on any treatment, every other treatment's Generate / Refresh
// is disabled for the configured TTL. This prevents users from hopping
// between treatments and burning rate-limit tokens.

const GLOBAL_COOLDOWN_LS_KEY = (orgId: string) =>
  `ai_pricing_last_generate_at::${orgId}`;

function readGlobalLastGenerateAt(orgId: string | null | undefined): string | null {
  if (!orgId) return null;
  try {
    return window.localStorage.getItem(GLOBAL_COOLDOWN_LS_KEY(orgId));
  } catch {
    return null;
  }
}

function writeGlobalLastGenerateAt(orgId: string | null | undefined, iso: string): void {
  if (!orgId) return;
  try {
    window.localStorage.setItem(GLOBAL_COOLDOWN_LS_KEY(orgId), iso);
  } catch {
    /* localStorage unavailable — silently skip */
  }
}

/**
 * Pick the more recent of two ISO timestamps. Either may be null/undefined.
 */
function maxIso(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

// ----------- Per-treatment analysis cache (localStorage) -----------
//
// Generated suggestions are cached in localStorage per treatment so that
// reopening the treatment shows the last AI run *without* re-calling the
// API, even if the user never applied any of the suggestions.
//
// The DB row in `treatment_ai_suggested_pricing` only exists when the
// user clicked Save with an AI value applied — that's the audit trail.
// This cache is the "last thing you saw" UI persistence layer.

// Cache key version. Bump when the shape of TreatmentPricingAnalysis or
// CompetitorRow changes in a way that would render stale entries as
// "Clinic 1"-style nameless ghosts. Old keys are orphaned (small, no
// cleanup needed — localStorage entries are tiny).
//   v1: original DB-based competitors (no clinic_name)
//   v2: web-search competitors (clinic_name, rating, review_count, price_source)
//   v3: peer/area/web competitors merged + source_type badge
const ANALYSIS_LS_KEY = (treatmentId: string) =>
  `ai_pricing_analysis::v3::${treatmentId}`;

function readCachedAnalysis(
  treatmentId: string,
  maxAgeSeconds: number,
): TreatmentPricingAnalysis | null {
  if (!treatmentId) return null;
  try {
    const raw = window.localStorage.getItem(ANALYSIS_LS_KEY(treatmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TreatmentPricingAnalysis & {
      lastGeneratedAt?: string;
    };
    if (!parsed.lastGeneratedAt) return parsed;
    if (maxAgeSeconds <= 0) return parsed;
    const ageSec =
      (Date.now() - new Date(parsed.lastGeneratedAt).getTime()) / 1000;
    if (ageSec > maxAgeSeconds) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedAnalysis(
  treatmentId: string,
  analysis: TreatmentPricingAnalysis,
): void {
  if (!treatmentId) return;
  try {
    window.localStorage.setItem(
      ANALYSIS_LS_KEY(treatmentId),
      JSON.stringify(analysis),
    );
  } catch {
    /* localStorage unavailable / quota exceeded — silently skip */
  }
}

/**
 * Looks up the most recent treatment_ai_suggested_pricing row for this
 * treatment, optionally filtered by max age. Pass `maxAgeSeconds = 0` to
 * skip the age filter and always return the most recent row (used by
 * loadLastApplied to restore previous suggestions on page open).
 */
async function fetchCachedAIResponse(
  treatmentId: string,
  maxAgeSeconds: number,
): Promise<CachedAIResponse | null> {
  let query = (supabase as any)
    .from('treatment_ai_suggested_pricing')
    .select('summary, currency, ai_suggestions, applied_at')
    .eq('treatment_id', treatmentId)
    .order('applied_at', { ascending: false })
    .limit(1);

  if (maxAgeSeconds > 0) {
    const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();
    query = query.gte('applied_at', cutoff);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn('[ai-pricing] cache lookup failed:', error);
    return null;
  }
  if (!data) return null;

  return {
    summary: data.summary ?? '',
    currency: data.currency ?? undefined,
    suggestions: data.ai_suggestions ?? {},
    appliedAt: data.applied_at,
  };
}

interface UseTreatmentPricingSuggestionsOptions {
  systemPrompt?: string;
  modelName?: string;
  maxTokens?: number;
  webSearchEnabled?: boolean;
  webSearchToolVersion?: string;
  regenerateAfterSeconds?: number;
}

const DEFAULT_HOOK_OPTIONS: Required<UseTreatmentPricingSuggestionsOptions> = {
  systemPrompt: '', // resolved via useAIPricingSettings; empty here triggers a fallback
  modelName: 'claude-haiku-4-5-20251001',
  // Slim default: even with all 11 fields uncovered, ~600 tokens of JSON is plenty.
  // Leaves total per-call budget under ~1.5K tokens (input + output).
  maxTokens: 1500,
  // Web search is ON by default so the panel surfaces 3 nearby-clinic
  // accordions. Each scraped page is 5-50K input tokens, so admins on
  // tight rate limits can opt out via the AI Pricing settings page.
  webSearchEnabled: true,
  webSearchToolVersion: 'web_search_20250305',
  regenerateAfterSeconds: 86400,
};

export function useTreatmentPricingSuggestions(
  options?: UseTreatmentPricingSuggestionsOptions,
) {
  const [analysis, setAnalysis] = useState<TreatmentPricingAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the org-global cooldown anchor so the Generate button (which
  // shows BEFORE any analysis is loaded) can also respect the cooldown.
  // Updated whenever loadLastApplied/generate runs for any treatment.
  const [globalCooldownAt, setGlobalCooldownAt] = useState<string | null>(null);

  const generate = useCallback(
    async (
      treatment: Treatment,
      currentValues: Record<string, number | string | null>,
      meta: {
        locationName?: string;
        organizationName?: string;
        marketArea?: string;
        peerLocationIds?: string[] | null;
        excludeLocationId?: string | null;
        scopeLabel?: string;
        areaPostalCode?: string | null;
        areaCity?: string | null;
        areaState?: string | null;
        areaCountry?: string | null;
      } = {},
      runtime?: { force?: boolean },
    ) => {
      console.debug('[ai-pricing] generate() called', {
        treatmentId: treatment?.id,
        force: runtime?.force,
      });
      setIsLoading(true);
      setError(null);
      setAnalysis(null);

      const effective = { ...DEFAULT_HOOK_OPTIONS, ...(options ?? {}) };
      try {
        // Resolve the system prompt inside the try block so a failed
        // dynamic import (network blip, build mismatch) becomes a
        // visible error instead of a stuck spinner with no feedback.
        if (!effective.systemPrompt) {
          const { DEFAULT_AI_PRICING_PROMPT } = await import(
            '@/hooks/useAIPricingSettings'
          );
          effective.systemPrompt = DEFAULT_AI_PRICING_PROMPT;
        }
        // Cache check: reuse a recent AI response if force=false and TTL > 0.
        if (!runtime?.force && effective.regenerateAfterSeconds > 0) {
          const cached = await fetchCachedAIResponse(
            treatment.id,
            effective.regenerateAfterSeconds,
          );
          if (cached && Object.keys(cached.suggestions).length > 0) {
            // Web-search competitors are expensive — skip on cache hits and
            // rely on the localStorage analysis (which already has them
            // from the last live generation). Cache-hit branch only
            // refreshes the area benchmark.
            const areaBenchmark = await fetchAreaBenchmark(
              treatment,
              treatment.organization_id,
              {
                city: meta.areaCity,
                state: meta.areaState,
                country: meta.areaCountry,
              },
            );
            const competitors: CompetitorRow[] = [];
            const cachedAnalysis: TreatmentPricingAnalysis = {
              summary: `${cached.summary} (cached)`.trim(),
              currency: cached.currency,
              suggestions: cached.suggestions,
              peerCount: 0,
              hasMarketArea: !!meta.marketArea?.trim(),
              scopeLabel: meta.scopeLabel,
              areaBenchmark,
              competitors,
              // Cooldown anchors to THIS treatment's row only — other
              // treatments' generations don't gate this one's Refresh.
              lastGeneratedAt: cached.appliedAt,
              regenerateAfterSeconds: effective.regenerateAfterSeconds,
            };
            setAnalysis(cachedAnalysis);
            writeCachedAnalysis(treatment.id, cachedAnalysis);
            setIsLoading(false);
            return;
          }
        }

        // The AI scrapes registered fee pages live on every run — the
        // URLs from knownClinicPrices.ts are passed into the prompt and
        // the model opens them via web_fetch / web_search. There is no
        // separate static-price merge step anymore.
        const competitorsPromise = effective.webSearchEnabled
          ? fetchCompetitorsViaWebSearch(
              treatment,
              {
                postalCode: meta.areaPostalCode,
                city: meta.areaCity,
                country: meta.areaCountry,
                userClinicName: meta.organizationName ?? meta.locationName,
                currency: 'GBP',
              },
              {
                modelName: effective.modelName,
                webSearchToolVersion: effective.webSearchToolVersion,
              },
            )
          : Promise.resolve<CompetitorRow[]>([]);

        const [peers, areaBenchmark, webCompetitors, areaCompetitors] =
          await Promise.all([
            fetchPeerTreatments(treatment, {
              peerLocationIds: meta.peerLocationIds,
              excludeLocationId: meta.excludeLocationId,
            }),
            fetchAreaBenchmark(treatment, treatment.organization_id, {
              city: meta.areaCity,
              state: meta.areaState,
              country: meta.areaCountry,
            }),
            competitorsPromise,
            fetchAreaCompetitors(treatment, treatment.organization_id, {
              postalCode: meta.areaPostalCode,
              city: meta.areaCity,
              state: meta.areaState,
              country: meta.areaCountry,
            }),
          ]);

        // Merge order = display order in the panel:
        //   1. Your other locations (peers) — most relevant comparisons.
        //   2. Web-scraped clinics — REAL nearby competitors found via
        //      Anthropic web_search (requires web_search_enabled).
        //   3. Internal-DB clinics (other DentPulse customers) — used
        //      ONLY when web_search returned no NAMED clinics AND the
        //      RPC found a TIGHT geographic match (postcode or city).
        //      State/country-tier matches are excluded because "any
        //      DentPulse customer in the UK" is not actually nearby
        //      — that produced the misleading "GM Dental NEARBY ·
        //      Same country" rows the user flagged. Tagged
        //      source_type='area' so the panel can label them
        //      differently from real web results.
        const namedWebCompetitors = webCompetitors.filter(
          (c) => !!c.clinic_name,
        );
        const tightAreaCompetitors = areaCompetitors.filter(
          (c) =>
            c.proximity_tier === 'postcode_exact' ||
            c.proximity_tier === 'postcode_outward' ||
            c.proximity_tier === 'postcode_area' ||
            c.proximity_tier === 'city',
        );
        const peerCompetitorRows = peersToCompetitors(peers);
        const competitors: CompetitorRow[] = [
          ...peerCompetitorRows,
          ...namedWebCompetitors,
          ...(namedWebCompetitors.length === 0 ? tightAreaCompetitors : []),
        ];
        console.debug('[ai-pricing] peer locations contributing:', {
          peerLocationsCount: peers.length,
          peerLocations: peers.map((p) => p.location),
          peerHasNullLocation: peers.filter((p) => !p.location).length,
          peerAccordionsRendered: peerCompetitorRows.length,
          peerAccordionNames: peerCompetitorRows.map((c) => c.clinic_name),
        });
        console.debug('[ai-pricing] merged competitors:', {
          peerCount: peers.length,
          webRawCount: webCompetitors.length,
          webNamedCount: namedWebCompetitors.length,
          areaFallbackUsed: namedWebCompetitors.length === 0,
          areaRawCount: areaCompetitors.length,
          areaTightCount: tightAreaCompetitors.length,
          areaTiers: areaCompetitors.map((c) => c.proximity_tier),
          totalForPanel: competitors.length,
          geo: {
            postalCode: meta.areaPostalCode,
            city: meta.areaCity,
            state: meta.areaState,
            country: meta.areaCountry,
          },
        });

        // Compute deterministic suggestions from data we already have:
        //   PEER  — median across user's other locations (≥3 samples)
        //   AREA  — average across DentPulse customers in city/state
        //   WEB   — median of named web-search competitor prices (≥2)
        // Source ranking: PEER > AREA > WEB > MARKET. The MARKET
        // fallback comes later from the LLM gap-fill call.
        const deterministicArea = areaBenchmark
          ? buildDeterministicAreaSuggestions(areaBenchmark, currentValues)
          : {};
        const deterministicPeer = buildDeterministicPeerSuggestions(
          peers,
          currentValues,
        );
        const deterministicWeb = buildDeterministicWebSuggestions(
          competitors,
          currentValues,
        );
        const internalSuggestions: Partial<
          Record<SuggestableField, FieldSuggestion>
        > = {
          ...deterministicWeb,  // lowest of the three deterministic sources
          ...deterministicArea, // AREA overwrites WEB
          ...deterministicPeer, // PEER overwrites both
        };

        // Which fields still have no internal answer? Only those go to the LLM.
        const uncoveredFields = SUGGESTABLE_FIELDS.filter(
          (f) => !(f in internalSuggestions),
        );

        let aiResult: {
          summary: string;
          currency?: string;
          suggestions: Partial<Record<SuggestableField, FieldSuggestion>>;
        } = { summary: '', suggestions: {} };

        // Skip the LLM entirely when internal data covers every field.
        // That means 0 input/output tokens for the common multi-location case.
        if (uncoveredFields.length > 0) {
          const currentTreatment = {
            code: treatment.treatment_code,
            name: treatment.treatment_name,
            category: treatment.category?.name ?? null,
            ...currentValues,
          };

          const input: AICallInput = {
            currentTreatment,
            peerTreatments: peers,
            locationName: meta.locationName,
            organizationName: meta.organizationName,
            marketArea: meta.marketArea,
            areaBenchmark,
          };

          // Wrap the LLM call: if it rate-limits or errors, keep
          // the deterministic peer+area suggestions on screen instead
          // of nuking the whole analysis. Surface a soft warning that
          // the LLM portion didn't run, but don't fail generate().
          try {
            aiResult = (await callAnthropicDirect(
              input,
              {
                systemPrompt: effective.systemPrompt,
                modelName: effective.modelName,
                maxTokens: effective.maxTokens,
                webSearchEnabled: effective.webSearchEnabled,
                webSearchToolVersion: effective.webSearchToolVersion,
              },
              uncoveredFields,
            )) as typeof aiResult;
            console.debug('[ai-pricing] LLM gap-fill returned:', {
              suggestionCount: Object.keys(aiResult.suggestions ?? {}).length,
              summary: aiResult.summary,
              uncoveredFields,
            });
          } catch (llmErr) {
            const llmMsg =
              llmErr instanceof Error ? llmErr.message : String(llmErr);
            console.warn(
              '[ai-pricing] LLM gap-fill failed — using peer/area only:',
              llmMsg,
            );
            // Surface the message non-fatally; the panel shows it in red
            // beneath whatever deterministic data we did get.
            setError(llmMsg);
          }
        }

        // Merge order: LLM fills the gaps; deterministic internal wins where present.
        const mergedSuggestions: Partial<
          Record<SuggestableField, FieldSuggestion>
        > = {
          ...(aiResult?.suggestions ?? {}),
          ...internalSuggestions,
        };

        // Build a summary that names what was actually used.
        const summaryParts: string[] = [];
        if (Object.keys(deterministicPeer).length > 0) {
          summaryParts.push(
            `Median across ${peers.length} of your other locations.`,
          );
        }
        if (
          areaBenchmark &&
          Object.keys(deterministicArea).length > 0
        ) {
          summaryParts.push(
            `Avg across ${areaBenchmark.clinic_count} clinics in ${areaBenchmark.geo_label || areaBenchmark.geo_level}.`,
          );
        }
        if (uncoveredFields.length > 0 && aiResult.summary) {
          summaryParts.push(aiResult.summary);
        }
        const finalSummary = summaryParts.join(' ').trim();

        // Fresh API call (or attempt) → write the global cooldown anchor
        // for this org. Done even if uncoveredFields was empty (no LLM call)
        // because the user clicked Generate and we want to prevent rapid
        // re-clicks from queuing more work in their brain.
        const nowIso = new Date().toISOString();
        if (uncoveredFields.length > 0) {
          writeGlobalLastGenerateAt(treatment.organization_id, nowIso);
          setGlobalCooldownAt(nowIso);
        }
        const freshAnalysis: TreatmentPricingAnalysis = {
          summary: finalSummary,
          currency: aiResult.currency,
          suggestions: mergedSuggestions,
          peerCount: peers.length,
          hasMarketArea: !!meta.marketArea?.trim(),
          scopeLabel: meta.scopeLabel,
          areaBenchmark,
          competitors,
          lastGeneratedAt: nowIso,
          regenerateAfterSeconds: effective.regenerateAfterSeconds,
        };
        setAnalysis(freshAnalysis);
        // Persist so reopening the treatment restores it without an API call.
        writeCachedAnalysis(treatment.id, freshAnalysis);

        // Audit: log this generation to treatment_ai_suggested_pricing so
        // the Suggestion History tab shows every meaningful AI run, not
        // just applied ones. We use the existing apply_action enum
        // ('single') with an empty applied_fields = {} as the "generated,
        // nothing applied yet" marker — no schema change required. The
        // history component detects generated rows by
        // Object.keys(applied_fields).length === 0.
        //
        // Skip the insert when mergedSuggestions is empty: that case has
        // nothing to apply and renders as all-blank columns in the
        // history table (LLM returned no usable JSON, every field was
        // already in line, or peer/area data simply produced no
        // above-threshold change).
        if (Object.keys(mergedSuggestions).length > 0) {
          try {
            const { data: authData } = await supabase.auth.getUser();
            await (supabase as any)
              .from('treatment_ai_suggested_pricing')
              .insert({
                organization_id: treatment.organization_id,
                treatment_id: treatment.id,
                applied_by: authData?.user?.id ?? null,
                apply_action: 'single',
                summary: finalSummary,
                currency: aiResult.currency ?? null,
                scope_label: meta.scopeLabel ?? null,
                peer_count: peers.length,
                area_match_level: areaBenchmark?.match_level ?? null,
                area_geo_level: areaBenchmark?.geo_level ?? null,
                area_geo_label: areaBenchmark?.geo_label ?? null,
                area_clinic_count: areaBenchmark?.clinic_count ?? null,
                area_sample_count: areaBenchmark?.sample_count ?? null,
                ai_suggestions: mergedSuggestions,
                applied_fields: {},
              });
          } catch (logErr) {
            // Non-fatal — analysis is already in state and localStorage
            console.warn('[ai-pricing] generation audit log failed:', logErr);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate suggestions';
        console.error('[ai-pricing] generate failed:', err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [
      options?.systemPrompt,
      options?.modelName,
      options?.maxTokens,
      options?.webSearchEnabled,
      options?.webSearchToolVersion,
      options?.regenerateAfterSeconds,
    ],
  );

  const reset = useCallback(() => {
    setAnalysis(null);
    setError(null);
  }, []);

  /**
   * Restore the most recent saved AI suggestion for this treatment without
   * making any API call. Use this on page mount so the panel doesn't reset
   * to "Generate Suggestions" every time the user reopens a treatment.
   *
   * - If a row exists and is younger than the configured TTL, the Refresh
   *   button shows the live cooldown.
   * - If a row exists but is older than the TTL, the panel still loads it
   *   but the Refresh button is enabled (cache has expired).
   * - If no row exists, this is a no-op — panel stays in empty state.
   */
  const loadLastApplied = useCallback(
    async (
      treatment: Treatment,
      meta: {
        marketArea?: string;
        scopeLabel?: string;
        areaPostalCode?: string | null;
        areaCity?: string | null;
        areaState?: string | null;
        areaCountry?: string | null;
        // Used to backfill the 3 nearby-clinic accordions on stale caches
        // (created before web_search was enabled) without forcing the
        // user to wait for the cooldown to expire.
        locationName?: string;
        organizationName?: string;
      } = {},
    ) => {
      const effective = { ...DEFAULT_HOOK_OPTIONS, ...(options ?? {}) };
      try {
        // 1. localStorage first — captures the last GENERATED analysis
        //    for THIS treatment, even if the user never clicked Apply.
        //    No API call, no DB read. Empty suggestions is fine (e.g.
        //    "all values already in line") so the Refresh button stays
        //    visible. Cooldown is anchored only to this treatment's
        //    own lastGeneratedAt.
        const lsCached = readCachedAnalysis(treatment.id, 0);
        if (lsCached) {
          setAnalysis({
            ...lsCached,
            regenerateAfterSeconds: effective.regenerateAfterSeconds,
          });

          // Stale-cache backfill. Without this, the panel would keep
          // displaying whatever the cache has (often "Avg Suggested
          // Pricing" alone, or stale "estimated" rows) until the
          // cooldown expires (up to 24h). The static price-book pre-pass
          // was removed when the registry switched to live scraping —
          // now web_search is the single backfill source.
          const cachedCompetitors = lsCached.competitors ?? [];
          const hasNamedCompetitors = cachedCompetitors.some(
            (c) => !!c.clinic_name,
          );
          if (effective.webSearchEnabled && !hasNamedCompetitors) {
            fetchCompetitorsViaWebSearch(
              treatment,
              {
                postalCode: meta.areaPostalCode,
                city: meta.areaCity,
                country: meta.areaCountry,
                userClinicName: meta.organizationName ?? meta.locationName,
                currency: 'GBP',
              },
              {
                modelName: effective.modelName,
                webSearchToolVersion: effective.webSearchToolVersion,
              },
            )
              .then((webCompetitors) => {
                const named = webCompetitors.filter((c) => !!c.clinic_name);
                if (named.length === 0) return;
                setAnalysis((prev) => {
                  if (!prev) return prev;
                  // Preserve any peer/area rows already in the cached
                  // analysis; just append the freshly-found web rows.
                  const merged: CompetitorRow[] = [
                    ...(prev.competitors ?? []),
                    ...named,
                  ];
                  const next = { ...prev, competitors: merged };
                  writeCachedAnalysis(treatment.id, next);
                  return next;
                });
              })
              .catch((err) => {
                console.warn(
                  '[ai-pricing] background competitor backfill failed:',
                  err,
                );
              });
          }
          return;
        }

        // 2. DB-applied row fallback — historical applied suggestions
        //    or generated rows for THIS treatment specifically.
        const cached = await fetchCachedAIResponse(treatment.id, 0);
        if (cached && Object.keys(cached.suggestions).length > 0) {
          // No web-search competitors here — `loadLastApplied` is called
          // on every page open, so running web_search would burn tokens
          // on simple navigation. Competitors come from the next live
          // generate (when the user clicks Refresh). The area benchmark
          // is cheap so we still refresh it.
          const areaBenchmark = await fetchAreaBenchmark(
            treatment,
            treatment.organization_id,
            {
              city: meta.areaCity,
              state: meta.areaState,
              country: meta.areaCountry,
            },
          );
          const competitors: CompetitorRow[] = [];

          const dbAnalysis: TreatmentPricingAnalysis = {
            summary: `${cached.summary} (saved)`.trim(),
            currency: cached.currency,
            suggestions: cached.suggestions,
            peerCount: 0,
            hasMarketArea: !!meta.marketArea?.trim(),
            scopeLabel: meta.scopeLabel,
            areaBenchmark,
            competitors,
            // Per-treatment cooldown only — no merging with org-global.
            lastGeneratedAt: cached.appliedAt,
            regenerateAfterSeconds: effective.regenerateAfterSeconds,
          };
          setAnalysis(dbAnalysis);
          writeCachedAnalysis(treatment.id, dbAnalysis);
        }
        // 3. Neither cache hit → leave empty state. Generate button stays
        //    enabled because this treatment has never been generated.
      } catch (err) {
        // Non-fatal — just leave the panel in its empty state.
        console.warn('[ai-pricing] loadLastApplied failed:', err);
      }
    },
    [
      options?.regenerateAfterSeconds,
      options?.systemPrompt,
      options?.modelName,
      options?.maxTokens,
      options?.webSearchEnabled,
      options?.webSearchToolVersion,
    ],
  );

  // Effective regenerate TTL (for the Generate-button cooldown).
  const effectiveTtl =
    options?.regenerateAfterSeconds ?? DEFAULT_HOOK_OPTIONS.regenerateAfterSeconds;

  return {
    analysis,
    isLoading,
    error,
    generate,
    reset,
    loadLastApplied,
    // Org-global cooldown anchor so the Generate button (visible before
    // any analysis is loaded) can also respect the rate-limit cooldown.
    globalCooldownAt,
    regenerateAfterSeconds: effectiveTtl,
  };
}
