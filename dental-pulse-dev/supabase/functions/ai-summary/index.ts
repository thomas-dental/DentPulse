import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // The key comes from the backend (per-user / tenant key), passed by the
    // caller — same pattern as ai-priority-tips. See src/lib/aiKey.ts + /api/ai-key.
    const { page, role, data, apiKey } = await req.json();

    if (!page || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: page and data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No API key provided by the backend.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = getSystemPrompt(page, role || 'member');

    // Compact output contract — must stay in sync with src/hooks/useAISummary.ts
    const formatRules = `Respond in EXACTLY this format, 80 words maximum in total:
Line 1: one bold headline sentence (**...**) with the single most important takeaway, including its key figure.
Then 3-4 bullets, each on its own line starting with "- " followed immediately by ONE status symbol: ✓ (good / on track), ⚠ (watch), ✗ (risk / off track) — the symbol comes FIRST, before the metric.
Each bullet: **Metric** value with ▲ or ▼ and the % change where relevant — then a takeaway of 8 words or fewer.
All money figures are GBP: always write them with the £ symbol (e.g. £55.5k) — never use $.
No headings, no preamble, no closing sentence, plain business language.`;

    // Input budget: the whole request (system + data + format rules + the
    // 300-token output cap) must stay within ~5,000 tokens. ~14,000 chars of
    // compact JSON ≈ 3.5k tokens. Must stay in sync with src/hooks/useAISummary.ts.
    const MAX_DATA_CHARS = 14000;
    const trimArrays = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.slice(0, 12).map(trimArrays);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = trimArrays(val);
        return out;
      }
      return v;
    };
    let dataJson = JSON.stringify(data);
    if (dataJson.length > MAX_DATA_CHARS) dataJson = JSON.stringify(trimArrays(data));
    if (dataJson.length > MAX_DATA_CHARS) dataJson = `${dataJson.slice(0, MAX_DATA_CHARS)}…(truncated)`;

    const userPrompt = `Here is the current data for the ${page} page:\n\n${dataJson}\n\n${formatRules}`;

    console.log(`Generating AI summary for page: ${page}, role: ${role}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Anthropic API error ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await response.json();
    const summary = result.content?.[0]?.text;

    if (!summary) {
      console.error('No summary in response:', result);
      return new Response(
        JSON.stringify({ error: 'No summary generated' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully generated summary for ${page}`);

    return new Response(
      JSON.stringify({
        summary,
        usage: {
          input_tokens: result.usage?.input_tokens ?? 0,
          output_tokens: result.usage?.output_tokens ?? 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-summary function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
