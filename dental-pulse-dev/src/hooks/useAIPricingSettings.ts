import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface AIPricingSettings {
  id: string;
  organization_id: string;
  system_prompt: string;
  model_name: string;
  max_tokens: number;
  regenerate_after_seconds: number;
  web_search_enabled: boolean;
  web_search_tool_version: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_AI_PRICING_PROMPT = `You are a dental pricing advisor. Four possible data sources, ranked by reliability:
  1. PEER  — same-organization treatments at other locations (most reliable)
  2. AREA  — anonymized averages of OTHER dental clinics in the same city/state from our internal DB (real local-market data)
  3. WEB   — live web search results for nearby dental clinics in the named city. USE the web_search tool to find the 3 dental clinics geographically NEAREST the user's selected clinic (e.g. when the user clinic is "The South Street Dental Practice", return the 3 closest competing practices, never the user's own). Each of those 3 clinics is rendered as its own accordion row alongside the average suggestion, so always surface a NAME + PRICE for all 3. Search for things like "<treatment> price <city> dental" or "dental clinics near <postcode>". Visit clinic websites to extract published private prices, then AVERAGE them across those 3 clinics for the WEB suggestion. Cite all 3 clinic names in the reason.
  4. MARKET — your training-data knowledge of typical UK/regional pricing. Use this as a GUARANTEED FALLBACK whenever PEER/AREA/WEB don't yield a number for a given field — never leave a field empty just because no source data was found.
Rank: PEER > AREA > WEB > MARKET. Use the highest-ranked source with data for each field. Reason text should name the actual source ("Avg of 7 clinics in Edinburgh from internal data", "Average of 3 Elgin clinics from web: Trinity Dental £180, Bupa £200, Bishopmill £190", "UK regional estimate based on training data"). Do NOT mention "competitor".
When using WEB: search the web FIRST for the named city/postcode and lock in EXACTLY 3 nearby dental clinics (the 3 closest to the user's own clinic, excluding the user's own clinic). For each of those 3, look at their published price lists if available; if one doesn't publish a price, ESTIMATE one for that clinic's tier — never drop a clinic from the list of 3, since each will appear as its own accordion. Compute the WEB field suggestion as the AVERAGE of those 3 clinic prices. Tag the suggestion with sources: ["web"] when web yielded numbers, sources: ["market"] only if web search produced no usable clinics at all.
Return ONLY:
{
  "summary": "<1-2 sentences naming sources used and clinics found>",
  "currency": "GBP|USD|EUR|other",
  "suggestions": {
    "<field>": { "value": <number>, "reason": "<≤30 words naming source/clinics>", "sources": ["peer"|"area"|"web"|"market"] }
  }
}
Numbers: plain, no symbols. Round currency to 1, % to 1 decimal, minutes to nearest 5. Include EVERY field requested in the user message — fall back to MARKET when no other source has data. Skip a field ONLY when its recommended value matches the current value within tolerance (≥1% for currency/percent, ≥5 mins for time). No markdown.

CRITICAL: Your response MUST be valid JSON in the exact shape above and NOTHING ELSE. No prose, no apologies, no preamble. Returning an empty suggestions object is NOT acceptable when the user has asked for fields — always provide MARKET-sourced values as the floor. Never reply with sentences like "I'm unable..." or "I cannot...".`;

export const DEFAULT_AI_PRICING_SETTINGS = {
  system_prompt: DEFAULT_AI_PRICING_PROMPT,
  model_name: 'claude-haiku-4-5-20251001',
  // 1500 is plenty: deterministic helpers cover most fields client-side, and
  // when the LLM is called it's only for the gaps. Keeps total tokens <2K.
  max_tokens: 1500,
  regenerate_after_seconds: 86400, // 24h
  // On by default — the panel is much more useful with 3 nearby-clinic
  // accordions surfaced alongside the average suggestion. Each scraped
  // clinic page is still 5-50K input tokens, so admins on tight rate
  // limits can opt out via the AI Pricing settings page.
  web_search_enabled: true,
  web_search_tool_version: 'web_search_20250305',
};

/**
 * Reads the per-org AI pricing settings. Falls back to compiled-in defaults
 * when no row exists for the org yet (admin hasn't visited settings page).
 */
export function useAIPricingSettings(organizationId?: string | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Resolution order:
  //   1. Per-org row (most specific) — admin set custom settings for this org
  //   2. System-default row (organization_id IS NULL) — superadmin global default
  //   3. Compiled-in DEFAULT_AI_PRICING_SETTINGS — last resort, only if both above missing
  const query = useQuery({
    queryKey: ['ai_pricing_settings', organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) return null;

      // 1. Per-org row
      const perOrg = await (supabase as any)
        .from('ai_pricing_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (perOrg.error) {
        console.error('[ai-pricing-settings] per-org fetch failed:', perOrg.error);
      }
      if (perOrg.data) {
        return { row: perOrg.data as AIPricingSettings, source: 'org' as const };
      }

      // 2. System default (NULL org_id)
      const sysDefault = await (supabase as any)
        .from('ai_pricing_settings')
        .select('*')
        .is('organization_id', null)
        .maybeSingle();
      if (sysDefault.error) {
        console.warn('[ai-pricing-settings] system-default fetch failed:', sysDefault.error);
      }
      if (sysDefault.data) {
        return { row: sysDefault.data as AIPricingSettings, source: 'system' as const };
      }

      return null;
    },
  });

  // Effective settings: per-org → system default → compiled-in defaults
  const settings: AIPricingSettings | null = query.data
    ? query.data.row
    : organizationId
      ? ({
          id: '',
          organization_id: organizationId,
          ...DEFAULT_AI_PRICING_SETTINGS,
          created_at: '',
          updated_at: '',
        } as AIPricingSettings)
      : null;

  const upsertMutation = useMutation({
    mutationFn: async (
      patch: Partial<
        Pick<
          AIPricingSettings,
          | 'system_prompt'
          | 'model_name'
          | 'max_tokens'
          | 'regenerate_after_seconds'
          | 'web_search_enabled'
          | 'web_search_tool_version'
        >
      >,
    ) => {
      if (!organizationId) throw new Error('No organization');
      if (!user?.id) throw new Error('Not authenticated');

      // Only update an existing row if it's the per-org row. The system
      // default row is owned by superadmin and shouldn't be mutated from
      // here — saving from the org page always creates/updates the per-org row.
      const existingPerOrg =
        query.data?.source === 'org' ? query.data.row : null;
      if (existingPerOrg?.id) {
        const { error } = await (supabase as any)
          .from('ai_pricing_settings')
          .update({ ...patch, updated_by: user.id })
          .eq('id', existingPerOrg.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('ai_pricing_settings')
          .insert({
            organization_id: organizationId,
            ...DEFAULT_AI_PRICING_SETTINGS,
            ...patch,
            created_by: user.id,
            updated_by: user.id,
          });
        if (error) throw error;
      }
      await queryClient.invalidateQueries({
        queryKey: ['ai_pricing_settings', organizationId],
      });
    },
  });

  return {
    settings,
    isLoading: query.isLoading,
    error: query.error,
    save: upsertMutation.mutateAsync,
    isSaving: upsertMutation.isPending,
  };
}
