const { supabaseAdmin } = require('../../config/supabase');
const sessionService = require('./sessionService');

/**
 * V1 Handler — wraps existing Gemini chat logic server-side.
 * Replicates the behavior of supabase/functions/ai-chat/index.ts
 * but runs on Express with unified request/response format.
 */

const rolePrompts = {
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
Be helpful, clear, and focused on practical insights.`,
};

async function handleMessage(req, res, config) {
  const { message, sessionId, pageContext } = req.body;
  const userId = req.user.id;

  try {
    // 1. Resolve user profile and org
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();

    const orgId = profile?.current_organization_id;
    if (!orgId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    // 2. Resolve or create session
    const session = await sessionService.resolveSession(userId, sessionId, orgId);

    // 3. Save user message to DB
    await supabaseAdmin.from('chat_messages').insert({
      session_id: session.id,
      role: 'user',
      content: message,
    });

    // 4. Rebuild conversation history from DB
    const { data: history } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    const messagesForLLM = (history || []).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 5. Build system prompt
    const userRole = pageContext?.role || 'default';
    const basePrompt = rolePrompts[userRole] || rolePrompts.default;
    let contextualPrompt = basePrompt;
    if (pageContext) {
      contextualPrompt += `\n\nCurrent context:\n${JSON.stringify(pageContext, null, 2)}`;
    }

    // 6. Call Gemini via Lovable gateway (non-streaming)
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured (LOVABLE_API_KEY missing)' });
    }

    const geminiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.v1_model || 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: contextualPrompt },
          ...messagesForLLM,
        ],
        stream: false,
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('[CHATBOT-V1] Gemini error:', geminiResponse.status, errorText);

      if (geminiResponse.status === 429) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again in a moment.' });
      }
      if (geminiResponse.status === 402) {
        return res.status(402).json({ error: 'AI usage limit reached.' });
      }
      return res.status(500).json({ error: 'AI service temporarily unavailable' });
    }

    // 7. Parse response
    const geminiData = await geminiResponse.json();
    const assistantContent = geminiData.choices?.[0]?.message?.content || '';

    // 8. Save assistant message
    await supabaseAdmin.from('chat_messages').insert({
      session_id: session.id,
      role: 'assistant',
      content: assistantContent,
    });

    // 9. Auto-generate session title from first message
    if (!session.title) {
      const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
      await sessionService.setSessionTitle(session.id, title);
    }

    // 10. Update session activity
    await supabaseAdmin
      .from('chat_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', session.id);

    // 11. Return unified response
    res.json({
      sessionId: session.id,
      message: assistantContent,
      suggestions: [],
      chart: null,
      insightData: null,
      reportReady: false,
      cachedReportId: null,
      briefing: null,
      anomalies: null,
      recommendations: null,
      version: 'v1',
    });

  } catch (err) {
    console.error('[CHATBOT-V1] Error:', err);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
}

module.exports = { handleMessage };
