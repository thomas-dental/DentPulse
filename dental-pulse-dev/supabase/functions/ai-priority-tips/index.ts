import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // The key now comes from the backend (per-user / tenant key), passed by the
    // caller — no Supabase env secret. See src/lib/aiKey.ts + /api/ai-key.
    const { actions, financialContext, apiKey } = await req.json();

    const ANTHROPIC_API_KEY = apiKey;

    if (!ANTHROPIC_API_KEY) {
      throw new Error('No API key provided by the backend.');
    }

    const systemPrompt = `You are a dental practice M&A advisor helping practice owners increase their enterprise value before exit.

You will receive a list of priority actions, each with:
- label: the specific improvement needed
- metric: which KPI it relates to (e.g. Associate Dependency, Chair Utilisation, NHS Delivery)
- currentValue: current measured value
- targetValue: the target to hit
- valueImpact: estimated EV uplift in GBP
- category: area (practitioners, revenue, appointments, costs)

Generate a short, specific, actionable tip for each action. Each tip should:
- Be 1-2 sentences maximum
- Include a concrete first step the owner can take this week
- Reference the actual current metric value and what specifically needs to change
- Be specific to UK dental practices (associates, UDAs, NHS contracts, chair utilisation, payment plans, etc.)
- Be encouraging but realistic

Return ONLY a JSON array of objects with "actionLabel" and "tip" fields. No markdown, no explanation.

Example:
[{"actionLabel":"Reduce top associate concentration below 25%","tip":"Start by redistributing new patient bookings — assign 60% of new NHS patients to your second and third associates this month. Document all clinical SOPs so procedures aren't tied to one clinician."}]`;

    const userMessage = `Practice financial summary:
- Sustainable EBITDA: £${Math.round(financialContext.sustainableEBITDA).toLocaleString()}
- Current Enterprise Value: £${Math.round(financialContext.currentEV).toLocaleString()}
- Optimised Enterprise Value: £${Math.round(financialContext.optimisedEV).toLocaleString()}
- Quality Score: ${financialContext.qualityScore}/100
- Exit Readiness: ${financialContext.overallReadiness}/100

Priority actions requiring tips:
${JSON.stringify(actions, null, 2)}

Generate one specific, actionable tip for each action based on the practice's actual metrics.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return new Response(JSON.stringify({ error: `Anthropic API error ${response.status}: ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const responseText = result.content?.[0]?.text ?? '[]';

    let tips: Array<{ actionLabel: string; tip: string }>;
    try {
      const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
      tips = JSON.parse(cleaned);
      if (!Array.isArray(tips)) tips = [];
    } catch {
      console.warn('Failed to parse AI tips JSON:', responseText);
      tips = [];
    }

    return new Response(JSON.stringify({ tips }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI priority tips error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
