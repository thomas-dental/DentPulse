import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAnthropicKey } from '@/lib/aiKey';
import { logAiUsage } from '@/lib/aiUsageLog';

interface UseAISummaryOptions {
  page: string;
  role?: string;
}

const MODEL = 'claude-haiku-4-5-20251001';

/** Force £ in AI text when the model (or an old cache) used $. */
function normalizeAiSummaryGbp(text: string): string {
  if (!text || !text.includes('$')) return text;
  return text
    .replace(/-\$/g, '-£')
    .replace(/\$/g, '£');
}

interface SummaryResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

/* Mirrors the edge function's page prompts so the direct (dev) path and the
   edge (production) path produce the same summaries. */
const getSystemPrompt = (page: string, role: string) => {
  const roleContext = role === 'owner'
    ? 'You are advising a practice owner who needs strategic insights and high-level summaries.'
    : role === 'admin'
    ? 'You are advising a practice administrator who needs operational insights and actionable recommendations.'
    : 'You are advising a team member who needs clear, practical information.';

  const pagePrompts: Record<string, string> = {
    dashboard: `${roleContext} Analyze the dashboard KPIs and provide a brief executive summary highlighting key performance indicators, trends, and any areas requiring attention. Focus on revenue, collections, and patient metrics.`,
    'cash-ar': `${roleContext} Analyze the accounts receivable data and provide insights on cash flow health, aging buckets, and collection efficiency. Highlight any concerning trends or opportunities for improvement.`,
    cashflow: `${roleContext} Analyze the cash flow overview data (received vs paid, closing balance trend, top cash-generating categories, outliers, free cash flow). Summarize liquidity health, sustainability, and any risks or opportunities.`,
    profitability: `${roleContext} Analyze profitability metrics and provide insights on margin performance, cost efficiency, and revenue optimization opportunities.`,
    providers: `${roleContext} Analyze provider performance data and provide insights on productivity, revenue contribution, and areas for improvement.`,
    'staff-costs': `${roleContext} Analyze staff cost data and provide insights on labor efficiency, cost trends, and optimization opportunities.`,
    'lab-fees': `${roleContext} Analyze lab fee data and provide insights on cost management, vendor performance, and optimization opportunities.`,
    treatments: `${roleContext} Analyze treatment data and provide insights on service mix, revenue per treatment, and growth opportunities.`,
    marketing: `${roleContext} Analyze marketing data and provide insights on campaign performance, patient acquisition costs, and ROI.`,
    'cost-impact': `${roleContext} Analyze cost impact scenarios and provide insights on potential savings, risks, and strategic recommendations.`,
    budget: `${roleContext} Analyze budget data for a UK dental practice. All amounts are GBP (£) — never use $. Provide insights on variance, spending trends, and recommendations for budget optimization.`,
    reports: `${roleContext} Analyze the financial reports and provide a comprehensive summary of financial health, trends, and key takeaways.`,
  };

  return pagePrompts[page] || `${roleContext} Analyze the provided data and give a concise, actionable summary with key insights and recommendations.`;
};

/* Compact output contract — keeps summaries scannable and cheap (~4× fewer
   output tokens than free-form paragraphs). Must stay in sync with
   supabase/functions/ai-summary/index.ts. */
const FORMAT_RULES = `Respond in EXACTLY this format, 80 words maximum in total:
Line 1: one bold headline sentence (**...**) with the single most important takeaway, including its key figure.
Then 3-4 bullets, each on its own line starting with "- " followed immediately by ONE status symbol: ✓ (good / on track), ⚠ (watch), ✗ (risk / off track) — the symbol comes FIRST, before the metric.
Each bullet: **Metric** value with ▲ or ▼ and the % change where relevant — then a takeaway of 8 words or fewer.
All money figures are GBP: always write them with the £ symbol (e.g. £55.5k) — never use $.
No headings, no preamble, no closing sentence, plain business language.`;

/* Input budget: the whole request (system + data + format rules + 300-token
   output) must stay within ~5,000 tokens. ~14,000 chars of compact JSON is
   ≈3.5k tokens, leaving comfortable headroom. Must stay in sync with
   supabase/functions/ai-summary/index.ts. */
const MAX_DATA_CHARS = 14000;

function compactDataJson(data: Record<string, any>): string {
  const trimArrays = (v: any): any => {
    if (Array.isArray(v)) return v.slice(0, 12).map(trimArrays);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = trimArrays(val);
      return out;
    }
    return v;
  };
  // Compact (not pretty-printed) JSON — indentation alone roughly doubles tokens.
  let json = JSON.stringify(data);
  if (json.length > MAX_DATA_CHARS) json = JSON.stringify(trimArrays(data));
  if (json.length > MAX_DATA_CHARS) json = `${json.slice(0, MAX_DATA_CHARS)}…(truncated)`;
  return json;
}

const buildUserPrompt = (page: string, data: Record<string, any>) =>
  `Here is the current data for the ${page} page:\n\n${compactDataJson(data)}\n\n${FORMAT_RULES}`;

/* Direct Anthropic call — works in dev via the '/anthropic-api' Vite proxy.
   Same pattern as useAIPriorityTips. */
async function callAnthropicDirect(page: string, role: string, data: Record<string, any>): Promise<SummaryResult> {
  const apiKey = await getAnthropicKey();

  const response = await fetch('/anthropic-api/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: getSystemPrompt(page, role),
      messages: [{ role: 'user', content: buildUserPrompt(page, data) }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const summary = result.content?.[0]?.text;
  if (!summary) throw new Error('No summary in response');
  return {
    summary,
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
  };
}

/* Edge-function fallback — works in production. The backend-resolved key is
   passed in the body (same as ai-priority-tips / ai-buyer-questions). */
async function callEdgeFunction(page: string, role: string, data: Record<string, any>): Promise<SummaryResult> {
  const apiKey = await getAnthropicKey();
  const { data: result, error: fnError } = await supabase.functions.invoke('ai-summary', {
    body: { page, role, data, apiKey },
  });

  if (fnError) throw new Error(fnError.message || 'Failed to generate summary');
  if (result?.error) throw new Error(result.error);
  if (!result?.summary) throw new Error('No summary generated');
  return {
    summary: result.summary,
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
  };
}

export function useAISummary({ page, role = 'admin' }: UseAISummaryOptions) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSummary = useCallback(async (data: Record<string, any>) => {
    setIsLoading(true);
    setError(null);

    const startedAt = Date.now();
    try {
      // Direct Anthropic first (dev, via Vite proxy), edge function as fallback (production)
      let result: SummaryResult;
      try {
        result = await callAnthropicDirect(page, role, data);
      } catch (directErr) {
        console.warn('[AI Summary] Direct call failed, trying edge function:', directErr);
        result = await callEdgeFunction(page, role, data);
      }
      setSummary(normalizeAiSummaryGbp(result.summary));
      // Usage tracking — lands in ai_token_usage_logs next to chatbot spend.
      logAiUsage({
        feature: `ai-insights-${page}`,
        model: MODEL,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate summary';
      console.warn('[AI Summary] Failed to generate:', errorMessage);
      setError('AI Insights temporarily unavailable. Click refresh to try again.');
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, role]);

  const setSummaryDirect = useCallback((text: string) => {
    setSummary(text);
    setError(null);
  }, []);

  const clearSummary = useCallback(() => {
    setSummary(null);
    setError(null);
  }, []);

  return {
    summary,
    isLoading,
    error,
    generateSummary,
    setSummaryDirect,
    clearSummary,
  };
}
