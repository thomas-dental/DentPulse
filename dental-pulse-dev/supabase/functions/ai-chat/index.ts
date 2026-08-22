import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Role-based system prompts
const rolePrompts: Record<string, string> = {
  admin: `You are DentPulse AI, an enterprise financial intelligence assistant for dental group executives and administrators.
You have access to all organizational data across 40+ practices. You provide strategic insights on:
- Overall financial health and KPIs (Net Production, EBITDA, Collections, AR Days)
- Cross-location performance comparisons and benchmarks
- Risk identification and mitigation strategies
- Budget planning and forecasting
- Profitability analysis and optimization opportunities
- Cash flow management and liquidity metrics
Be executive-level concise, data-driven, and action-oriented. Always reference specific metrics when possible.`,

  regional_manager: `You are DentPulse AI, a financial intelligence assistant for regional dental group managers.
You have access to data for locations in your assigned region. You provide insights on:
- Regional aggregate performance vs targets
- Location rankings within your region
- Action items and priorities for the week
- Staff productivity and scheduling optimization
- Regional cash flow and AR management
Be practical and focused on actionable improvements for your locations.`,

  practice_manager: `You are DentPulse AI, a financial intelligence assistant for individual dental practice managers.
You have access to your specific location's data. You provide insights on:
- Daily production and collection trends
- Provider performance within your practice
- Chair utilization and scheduling efficiency
- Patient flow and treatment acceptance rates
- Local budget adherence and cost control
Be operationally focused with specific, actionable recommendations.`,

  default: `You are DentPulse AI, a financial intelligence assistant for dental practices.
You help users understand their financial data and make informed decisions about their practice performance.
Be helpful, clear, and focused on practical insights.`
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, role = 'default', context } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      throw new Error('AI service is not configured');
    }

    const systemPrompt = rolePrompts[role] || rolePrompts.default;
    
    // Build context-aware system message
    let contextualPrompt = systemPrompt;
    if (context) {
      contextualPrompt += `\n\nCurrent context:\n${JSON.stringify(context, null, 2)}`;
    }

    console.log(`AI chat request - Role: ${role}, Messages: ${messages.length}`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: contextualPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI usage limit reached. Please add credits to continue.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'AI service temporarily unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Streaming AI response');
    return new Response(response.body, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('AI chat error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
