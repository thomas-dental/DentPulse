import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUGGESTABLE_FIELDS = [
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

const SYSTEM_PROMPT = `You are a dental practice pricing advisor. You suggest values for a treatment by combining FOUR sources:

1. PEER DATA — same/similar treatments at the user's other clinic locations (same organization, most reliable when present)
2. AREA BENCHMARK — anonymized aggregate (avg/median, count) of OTHER dental clinics in the same city/state from our internal DB. Real local-market data.
3. WEB — LIVE web search results for nearby dental clinics in the named city. Use the web_search tool to look up "<treatment> price <city> dental" or "dental clinics <city>". Visit clinic websites to find their published private prices, then AVERAGE them. Cite the actual clinic names in the reason.
4. MARKET AREA — typical PRIVATE dental pricing for the named city/region drawn from your training-data knowledge. Use as a fallback only.

Rules:
- Always rank sources: PEER > AREA > WEB > MARKET. Use the highest-ranked source with data; don't invent.
- For each suggestion include a "sources" array with the codes used: any of ["peer","area","web","market"].
- "reason" is ONE short sentence (≤30 words), plain business English, naming the source. WEB suggestions MUST cite the clinics found ("Avg across Trinity Dental £180, Bupa Elgin £200, Bishopmill £190"). No DB jargon.
- Numbers are plain numbers, no symbols/commas. Round currency to nearest 1 unit, percentages to 1 decimal, minutes to nearest 5.
- If a field has no usable data from ANY source, omit it.
- ONLY include a field in "suggestions" if your recommended value is meaningfully different from the current value (≥1% change for currency/percent fields, ≥5 mins for time fields).
- When using WEB: search FIRST for the named city, then for at least 2-3 nearby dental clinics. Visit their public sites if accessible to find actual published prices. Skip clinics with no published price.
- If MARKET is the only source, prefix the reason with "Estimate:" and the summary must remind the user to verify locally.
- Summary phrasing: when peers > 0 say so; when AREA exists say "across N clinics in <city>"; when WEB drives suggestions list 2-3 clinic names. Do NOT mention "competitor" — not a source in this product.
- Currency: if the market area is US/Canada use $, UK/Ireland £, EU €. Pick from context but always return plain numbers.

Return ONLY this JSON shape, no markdown:
{
  "summary": "<1-2 sentence headline. Mention which sources were used and clinics found.>",
  "currency": "<GBP|USD|EUR|other>",
  "suggestions": {
    "<field>": { "value": <number>, "reason": "<string>", "sources": ["peer"|"area"|"web"|"market"] }
  }
}

Suggestable fields: price, duration_minutes, therapist_time_mins, lab_bill, lab_bill_discount, material_cost, percent_fees, therapist_pay_rate, hourly_rate, finance_fee, average_time_minutes. Omit irrelevant ones.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    if (!body) {
      return new Response(
        JSON.stringify({ error: 'Empty request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const {
      currentTreatment,
      peerTreatments,
      locationName,
      organizationName,
      marketArea,
      areaBenchmark,
    } = JSON.parse(body);

    if (!currentTreatment) {
      return new Response(
        JSON.stringify({ error: 'Missing currentTreatment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured.');
    }

    const areaSection = areaBenchmark
      ? `AREA BENCHMARK — anonymized averages across ${areaBenchmark.clinic_count} other dental clinics (${areaBenchmark.sample_count} treatments) matched at geo=${areaBenchmark.geo_level}/${areaBenchmark.geo_label}, match=${areaBenchmark.match_level}:
${JSON.stringify(areaBenchmark, null, 2)}`
      : 'AREA BENCHMARK: (none — fewer than 3 clinics in area, or no geo provided)';

    const userMessage = `Practice: ${organizationName || 'Unknown'}
Editing at location: ${locationName || 'Unknown'}
Market area (city/region): ${marketArea || '(not provided)'}

Current treatment being edited:
${JSON.stringify(currentTreatment, null, 2)}

PEER DATA — ${(peerTreatments || []).length} samples from other locations:
${JSON.stringify(peerTreatments || [], null, 2)}

${areaSection}

Suggestable fields: ${SUGGESTABLE_FIELDS.join(', ')}

Generate suggestions per the rules. Tag every suggestion with the sources you actually used.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        // Higher cap because web_search consumes tokens for tool-use rounds
        max_tokens: 4000,
        messages: [{ role: 'user', content: userMessage }],
        system: SYSTEM_PROMPT,
        // Use the broadly-supported web_search version (the newer _20260209
        // requires programmatic tool calling, which Haiku 4.5 doesn't support).
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ error: `Anthropic API error ${response.status}: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const result = await response.json();
    // Web-search responses interleave server_tool_use / web_search_tool_result
    // blocks with text. The final JSON sits in the LAST text block, not block[0].
    const blocks = Array.isArray(result.content) ? result.content : [];
    const lastTextBlock = [...blocks].reverse().find((b: any) => b?.type === 'text');
    const responseText = lastTextBlock?.text ?? '{}';

    let analysis: any;
    try {
      const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.warn('Failed to parse AI pricing JSON:', responseText);
      analysis = { error: 'Failed to parse AI response', raw: responseText };
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('AI treatment pricing error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
