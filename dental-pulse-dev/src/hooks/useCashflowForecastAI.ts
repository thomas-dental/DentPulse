import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

// ─────────────────────────────────────────────────────────────────────────────
// 13-Week Cash Flow Forecast — AI (grounded) prediction.
//
// Sends the deterministic baseline (the numbers the page already computed) to
// the Node backend, which asks Claude to PREDICT an adjusted forward set of
// weekly numbers grounded in that baseline. The result is shown as an optional
// "AI forecast" the user can toggle on — it never overwrites the calculated
// numbers or the user's saved overrides. The Claude call runs server-side
// (the API key never reaches the browser).
// ─────────────────────────────────────────────────────────────────────────────

export interface AIForecastRowInput {
  key: string;
  label: string;
  section: 'inflow' | 'outflow';
  cadence: 'monthly-lump' | 'weekly';
  baseline: number[];
  // Membership rows only: the observed month-by-month add/remove dynamics from
  // the uploaded membership sheet, so Claude can ground each monthly lump in the
  // real joiner/leaver trend rather than just the flat baseline.
  membership?: {
    currentMembers: number;
    avgRevenuePerMember: number;
    avgMonthlyJoiners: number;
    avgMonthlyLeavers: number;
    monthlyChurnPct: number;
    monthsObserved: number;
    monthlyActivity: Array<{ month: string; members: number; joiners: number; leavers: number; revenue: number }>;
  };
  // Private row only: the trailing week-by-week patient counts AND revenue, so
  // Claude forecasts from real volume × value (e.g. "10 patients, £2k") rather
  // than just the revenue baseline.
  private?: {
    avgPatientsPerWeek: number;
    avgRevenuePerPatient: number;
    weeklyTrendPct: number;
    weeklyActivity: Array<{ week: number; patients: number; revenue: number }>;
    // Booked appointments per FORECAST week, straight from the diary — the only real
    // forward signal (measured r = 0.588 vs weekly takings). Claude forecasts Private
    // FROM this plus the trailing history, rather than adjusting a calculated baseline.
    bookedAppointments?: number[];
    // How many of those weeks have a genuinely filled diary. Past that point a low count
    // means "not booked yet", not "will be quiet" — Claude is told to ignore it there.
    diaryReliableWeeks?: number;
  };
}

export interface AIForecastPayload {
  locationLabel?: string;
  period?: string;
  weeks: Array<{ weekNumber: number; date: string }>;
  rows: AIForecastRowInput[];
}

export interface AIForecastResult {
  predictedRows: Array<{ key: string; values: number[] }>;
  narrative: string;
  assumptions: string[];
  model: string;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (session?.access_token) {
    const expiresAt = session.expires_at ?? 0;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt > now + 60) return session.access_token;
  }
  const { data: refreshed } = await supabase.auth.refreshSession();
  return refreshed?.session?.access_token ?? null;
}

export function useCashflowForecastAI() {
  const { organizationId } = useOrganization();
  const [aiData, setAiData] = useState<AIForecastResult | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: AIForecastPayload): Promise<AIForecastResult> => {
      if (!organizationId) throw new Error('No organization');
      const token = await getAccessToken();
      if (!token) throw new Error('Your session has expired — please sign in again.');
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/cashflow-forecast/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ organizationId, ...payload }),
      });
      if (!res.ok) {
        let msg = '';
        try {
          const j = await res.json();
          // The Vite dev proxy returns { errorCode: 'BACKEND_UNREACHABLE' } when
          // the Node backend is down or mid-restart — surface that clearly.
          if (j?.errorCode === 'BACKEND_UNREACHABLE') {
            msg = 'The forecasting service is unreachable — the backend may be restarting. Try again in a moment.';
          } else {
            msg = j?.error || j?.errorCode || '';
          }
        } catch {
          /* non-JSON error body (e.g. a 404 HTML page) */
        }
        if (!msg) {
          msg = res.status === 404
            ? 'Forecasting endpoint not found — the backend needs a restart to load it.'
            : `AI forecast failed (HTTP ${res.status}).`;
        }
        throw new Error(msg);
      }
      return (await res.json()) as AIForecastResult;
    },
    onSuccess: (data) => setAiData(data),
  });

  // key -> predicted weekly values, for overlaying onto the table.
  const aiValuesByKey = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of aiData?.predictedRows ?? []) map.set(r.key, r.values);
    return map;
  }, [aiData]);

  return {
    predict: mutation.mutate,
    isPredicting: mutation.isPending,
    error: mutation.error as Error | null,
    aiData,
    aiValuesByKey,
    clear: () => setAiData(null),
  };
}
