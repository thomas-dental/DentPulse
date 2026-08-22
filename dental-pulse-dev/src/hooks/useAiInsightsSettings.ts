/**
 * Global AI Insights generation schedule, set by SuperAdmin
 * (SuperAdmin panel → Settings → "AI Insights Generation Timeframe";
 * stored in the sync_settings global JSON, served by the Node backend).
 *
 * mode:
 *   'session' — regenerate once per browser session (legacy behaviour)
 *   'daily'   — once per calendar day (first visit of the day generates)
 *   'weekly'  — regenerates on the selected weekday (0=Sun … 6=Sat)
 *   'monthly' — regenerates on the selected date of the month (1–28)
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export type AiInsightsMode = 'session' | 'daily' | 'weekly' | 'monthly';

export interface AiInsightsSettings {
  mode: AiInsightsMode;
  weekday: number;   // 0 (Sunday) – 6 (Saturday); used when mode === 'weekly'
  monthDay: number;  // 1–28; used when mode === 'monthly'
}

const DEFAULTS: AiInsightsSettings = { mode: 'session', weekday: 1, monthDay: 1 };
const MODES: AiInsightsMode[] = ['session', 'daily', 'weekly', 'monthly'];

/**
 * The current regeneration period's identity for a schedule, as a local
 * YYYY-MM-DD of the period's start day. A cached summary is fresh while its
 * stored period key equals the current one; the first visit after a boundary
 * (new day / the chosen weekday / the chosen month date) regenerates.
 * Returns null for 'session' mode (no period — legacy behaviour applies).
 */
export function currentAiInsightsPeriodKey(s: AiInsightsSettings): string | null {
  const now = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (s.mode === 'daily') return ymd(now);
  if (s.mode === 'weekly') {
    const diff = (now.getDay() - s.weekday + 7) % 7;
    return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
  }
  if (s.mode === 'monthly') {
    const day = Math.min(Math.max(1, s.monthDay), 28);
    const start = now.getDate() >= day
      ? new Date(now.getFullYear(), now.getMonth(), day)
      : new Date(now.getFullYear(), now.getMonth() - 1, day);
    return ymd(start);
  }
  return null;
}

export function useAiInsightsSettings(): AiInsightsSettings & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-insights-settings'],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<AiInsightsSettings> => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return DEFAULTS;
        const res = await fetch(`${BACKEND_URL}/api/settings/ai-insights-public`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return DEFAULTS;
        const body = await res.json();
        const mode = MODES.includes(body?.mode) ? (body.mode as AiInsightsMode) : 'session';
        const weekday = Number(body?.weekday);
        const monthDay = Number(body?.month_day);
        return {
          mode,
          weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1,
          monthDay: Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 28 ? monthDay : 1,
        };
      } catch {
        return DEFAULTS; // backend unreachable → behave exactly as before
      }
    },
  });

  return { ...(data ?? DEFAULTS), isLoading };
}
