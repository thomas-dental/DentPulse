import { supabase } from '@/integrations/supabase/client';

/**
 * Fire-and-forget usage report for client-side AI features (AI Insights,
 * priority tips, buyer questions). The backend stamps user identity and
 * organization from the auth token and writes to ai_token_usage_logs — the
 * same table the chatbot's tokenTracker feeds — so this usage appears in the
 * superadmin AI usage dashboard alongside chatbot spend.
 *
 * Never throws and never blocks the caller's UI path.
 */
export function logAiUsage(entry: {
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): void {
  void (async () => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      await fetch(`${backendUrl}/api/ai-usage/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          feature: entry.feature,
          model: entry.model,
          input_tokens: entry.inputTokens,
          output_tokens: entry.outputTokens,
          latency_ms: entry.latencyMs,
        }),
      });
    } catch (err) {
      console.warn('[AI usage] log failed:', err);
    }
  })();
}
