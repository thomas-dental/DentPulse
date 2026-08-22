/**
 * useAiForecastSchedule
 *
 * Makes the 13-week AI forecast a SCHEDULED artefact (refreshed twice a day by the
 * backend cron) instead of a fresh Claude call on every page open.
 *
 * Why this exists:
 *  - Previously the page fired a prediction on every mount and every scope change. That
 *    is expensive, and because an LLM is not deterministic the practice saw DIFFERENT
 *    forecast numbers each time they reloaded — which reads as the system being unsure.
 *  - The 13-week baseline is computed in the browser (useCashflowForecast), so the cron
 *    cannot recompute it without a second, drift-prone copy of that engine. The browser
 *    therefore persists its baseline; the cron reads it, calls Claude, and stores the
 *    result; the page then renders that stored result.
 *
 * Both rows live in `cashflow_forecast_overrides` (sections 'ai_baseline' and
 * 'ai_forecast', JSON in `line_label`) — the same proven pattern as the threshold status
 * and the Bills feature, chosen because a dedicated table previously failed on a missing
 * RLS helper (`user_in_org`). No migration required.
 *
 * HONEST LIMITATION: the stored baseline is only as fresh as the last page visit for that
 * scope, and regenerating more often does not make a forecast more accurate — weekly cash
 * is genuinely noisy. Frequency buys freshness and consistency, not predictive power.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import type { AIForecastPayload, AIForecastResult } from './useCashflowForecastAI';

const BASELINE_SECTION = 'ai_baseline';
const BASELINE_LINE_KEY = 'ai_forecast_baseline';
const RESULT_SECTION = 'ai_forecast';
const RESULT_LINE_KEY = 'ai_forecast_result';

/** A stored AI forecast, plus the stamps the UI needs to be honest about its age. */
export interface StoredAiForecast extends AIForecastResult {
  anchorIso: string | null;
  locationLabel: string | null;
  /** When the BASELINE the AI ran on was computed (i.e. the last page visit). */
  baselineComputedAt: string | null;
  /** When the AI numbers themselves were produced. */
  generatedAt: string | null;
  generatedBy: 'cron' | 'live' | null;
}

/**
 * Persist the computed baseline so the twice-daily cron has something to run on.
 * `ready` gates it — while the forecast settles the numbers flip around, and writing
 * a half-settled baseline would have the cron predict from nonsense.
 */
export function useAiForecastSnapshotSync(
  payload: (AIForecastPayload & { anchorIso: string; locationId: string | null }) | null,
  ready: boolean,
) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !organizationId || !payload) return;
    if (!payload.rows?.length || !payload.weeks?.length) return;

    // Signature excludes the timestamp so identical numbers don't re-write on every
    // render; a fresh mount resets it, so each app-open refreshes `computedAt`.
    const sig = [
      payload.locationId ?? 'all',
      payload.anchorIso,
      payload.rows.length,
      // Row totals are enough to notice a real change without hashing every cell.
      ...payload.rows.map((r) => `${r.key}:${r.baseline.reduce((a, b) => a + (b || 0), 0)}`),
    ].join('|');
    if (lastSig.current === sig) return;
    lastSig.current = sig;

    (async () => {
      try {
        const sb = supabase as unknown as { from: (t: string) => any };
        // Exactly one baseline row per (org, location) — clear stale anchors first.
        let del = sb.from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', BASELINE_SECTION)
          .eq('line_key', BASELINE_LINE_KEY);
        del = payload.locationId ? del.eq('location_id', payload.locationId) : del.is('location_id', null);
        await del;

        await sb.from('cashflow_forecast_overrides').insert({
          organization_id: organizationId,
          location_id: payload.locationId,
          section: BASELINE_SECTION,
          week_start: payload.anchorIso,
          line_key: BASELINE_LINE_KEY,
          line_label: JSON.stringify({
            locationLabel: payload.locationLabel ?? null,
            period: payload.period ?? null,
            weeks: payload.weeks,
            rows: payload.rows,
            computedAt: new Date().toISOString(),
          }),
          amount: 0,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        });
      } catch {
        lastSig.current = null; // allow a retry on the next change
      }
    })();
  }, [user?.id, organizationId, ready, payload]);
}

/**
 * Read the stored (cron-generated) AI forecast for this scope.
 * `anchorIso` is compared so a stored result from a DIFFERENT forecast window is
 * ignored rather than overlaid onto weeks it was never computed for.
 */
export function useStoredAiForecast(locationId: string | null, anchorIso: string | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['ai-forecast-stored', organizationId, locationId ?? 'all', anchorIso ?? ''],
    enabled: !!organizationId && !!anchorIso,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<StoredAiForecast | null> => {
      const sb = supabase as unknown as { from: (t: string) => any };
      let q = sb.from('cashflow_forecast_overrides')
        .select('line_label, week_start')
        .eq('organization_id', organizationId)
        .eq('section', RESULT_SECTION)
        .eq('line_key', RESULT_LINE_KEY);
      q = locationId ? q.eq('location_id', locationId) : q.is('location_id', null);
      const { data, error } = await q.limit(1);
      if (error || !data?.length) return null;

      let parsed: any;
      try { parsed = JSON.parse(data[0].line_label || '{}'); } catch { return null; }
      if (!Array.isArray(parsed?.predictedRows)) return null;
      // A result computed for a different anchor week would misalign with these
      // columns — treat it as absent so the page falls back to the live prediction.
      if (parsed.anchorIso && anchorIso && parsed.anchorIso !== anchorIso) return null;

      return {
        predictedRows: parsed.predictedRows,
        narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
        model: typeof parsed.model === 'string' ? parsed.model : '',
        anchorIso: parsed.anchorIso ?? data[0].week_start ?? null,
        locationLabel: parsed.locationLabel ?? null,
        baselineComputedAt: parsed.baselineComputedAt ?? null,
        generatedAt: parsed.generatedAt ?? null,
        generatedBy: parsed.generatedBy ?? null,
      };
    },
  });
}
