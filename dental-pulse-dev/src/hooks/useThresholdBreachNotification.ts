/**
 * useThresholdStatusSync
 *
 * The 13-week cash-flow forecast is computed in the browser, so the breach can
 * only be DETECTED here. But the alert must be raised ONCE PER DAY at a fixed
 * time (08:00) by the backend cron — never on every page reload. So the browser
 * no longer inserts notifications at all. Instead it PERSISTS the latest breach
 * status, and the backend cron (cashflowThresholdCron.js) reads that status each
 * morning and inserts a single `cashflow_alert` if cash is below the threshold.
 *
 * Why reuse `cashflow_forecast_overrides` (section 'threshold_status') instead of
 * a dedicated table: a previous dedicated table failed on a missing RLS helper
 * (`user_in_org`); the Bills feature hit the same wall and solved it by reusing
 * this already-policied table. We follow that proven pattern — no new migration.
 *
 * Robust against the old "alert on every reload" bug:
 *  - `ready` gates everything — while the forecast settles, End Cash flips around,
 *    so we write nothing until the numbers are stable.
 *  - We only WRITE when the meaningful status actually changes (signature ref),
 *    so re-renders don't hammer the table.
 *  - The browser NEVER inserts into `general_notification`. That is now the cron's
 *    sole responsibility, which is what makes "once per day at 08:00" possible.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

// One threshold's verdict (End Cash minimum, or a per-row cost cap / income floor
// like Lab Fees, Materials, a clinician, etc.). The cron raises/resolves an alert
// per (location, threshold) from these.
export interface ThresholdBreach {
  key: string;                  // the threshold's line key (row key, or 'end_cash_threshold')
  label: string;               // human label, e.g. 'Lab Fees' / 'End Cash'
  kind: 'min' | 'max';         // min = floor (alert when below), max = cap (alert when above)
  inBreach: boolean;
  breachWeekIso: string | null; // first week the breach lands
  weekLabel: string | null;
  weekIndex: number | null;     // 0-based week position of the breach
  value: number | null;         // the breaching value
  limit: number | null;         // the threshold in force that week
  title: string;                // exact wording the cron should raise…
  message: string;              // …so the alert mirrors the page
}

export interface ThresholdStatus {
  locationId: string | null;
  locationName: string | null;  // human-readable scope name (so the alert can name the practice)
  anchorIso: string;            // weeks[0].iso — the forecast's anchor Monday
  thresholds: ThresholdBreach[]; // EVERY threshold set for this scope (breaching or not)
}

// Stamp the status as JSON in `line_label` (same trick the rule/comment rows use).
const STATUS_SECTION = 'threshold_status';
const STATUS_LINE_KEY = 'cash_threshold_status';

export function useThresholdStatusSync(status: ThresholdStatus | null, ready: boolean) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !organizationId || !status) return;
    // Signature excludes the timestamp so identical numbers don't re-write; a fresh
    // mount resets lastSig, so each app-open refreshes `computedAt` (freshness).
    const sig = [
      status.locationId ?? 'all',
      ...status.thresholds.map((t) => `${t.key}:${t.inBreach ? 'b' : 'o'}:${t.value ?? ''}:${t.limit ?? ''}:${t.breachWeekIso ?? ''}`),
    ].join('|');
    if (lastSig.current === sig) return;
    lastSig.current = sig;

    (async () => {
      try {
        const sb = supabase as unknown as {
          from: (t: string) => any;
        };
        // Keep exactly one status row per (org, location): clear stale anchors first.
        let del = sb.from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', STATUS_SECTION)
          .eq('line_key', STATUS_LINE_KEY);
        del = status.locationId ? del.eq('location_id', status.locationId) : del.is('location_id', null);
        await del;

        await sb.from('cashflow_forecast_overrides').insert({
          organization_id: organizationId,
          location_id: status.locationId,
          section: STATUS_SECTION,
          week_start: status.anchorIso,
          line_key: STATUS_LINE_KEY,
          line_label: JSON.stringify({
            locationName: status.locationName,
            thresholds: status.thresholds,
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
  }, [user?.id, organizationId, ready, status]);
}
