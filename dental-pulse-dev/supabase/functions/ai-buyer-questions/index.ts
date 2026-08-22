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
    const { financialData, apiKey } = await req.json();

    const ANTHROPIC_API_KEY = apiKey;

    if (!ANTHROPIC_API_KEY) {
      throw new Error('No API key provided by the backend.');
    }

    const systemPrompt = `You are a dental M&A due diligence advisor. Based on the practice's financial data, generate exactly 5 specific buyer questions that a potential acquirer would ask during due diligence.

Rules:
- Each question must reference specific numbers from the data provided
- Questions should cover: revenue sustainability, cost structure, NHS risk, associate dependency, and operational efficiency
- Be specific and actionable — avoid generic questions
- Format: Return ONLY a JSON array of 5 strings, no markdown, no explanation

Example output:
["Question 1 with specific numbers...", "Question 2...", "Question 3...", "Question 4...", "Question 5..."]`;

    const userMessage = `Practice financial data for due diligence question generation:

${JSON.stringify(financialData, null, 2)}

Generate 5 specific buyer questions based on this data.`;

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

    // Parse the JSON array from AI response
    let questions: string[];
    try {
      // Strip markdown code blocks if present
      const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
      questions = JSON.parse(cleaned);
      if (!Array.isArray(questions)) questions = [];
    } catch {
      console.warn('Failed to parse JSON, extracting from text:', responseText);
      questions = responseText
        .split('\n')
        .filter((l: string) => l.trim().length > 10)
        .map((l: string) => l.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, '').trim())
        .filter((l: string) => l.length > 0)
        .slice(0, 5);
    }

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI buyer questions error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
