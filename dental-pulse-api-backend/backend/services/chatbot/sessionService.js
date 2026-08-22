const { supabaseAdmin } = require('../../config/supabase');
const { getIdentity } = require('./identityCache');

async function resolveSession(userId, sessionId, organizationId) {
  // If sessionId provided, load existing session
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();

    if (data && !error) return data;
    // If session not found, fall through to create new one
  }

  // Stamp identity at session creation so the row survives an account
  // deletion (the FK is ON DELETE SET NULL) and the admin panel can still
  // attribute the chat history to a person.
  const { email, fullName } = await getIdentity(userId);

  // Create new session
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .insert({
      user_id: userId,
      user_email: email,
      user_full_name: fullName,
      organization_id: organizationId,
      context_json: {
        currentDoctor: null,
        currentPeriod: null,
        currentMetric: null,
        lastIntent: null,
        mentionedDoctors: [],
        mentionedPeriods: [],
        insightIntent: null,
        insightWhyLevel: 0,
        insightHealthState: null,
        lastAssociateId: null,
        organizationId,
      },
    })
    .select()
    .single();

  if (error) {
    console.error('[CHATBOT-SESSION] Failed to create session:', error.message);
    throw new Error('Failed to create chat session');
  }

  return data;
}

async function saveMessages(sessionId, userContent, assistantContent, intent, resolvedData, suggestions) {
  // Save user message
  await supabaseAdmin.from('chat_messages').insert({
    session_id: sessionId,
    role: 'user',
    content: userContent,
  });

  // Save assistant message
  await supabaseAdmin.from('chat_messages').insert({
    session_id: sessionId,
    role: 'assistant',
    content: assistantContent,
    intent_json: intent ? { toolName: intent.toolName, args: intent.args } : null,
    data_json: (suggestions || resolvedData?.dashboard)
      ? { suggestions: suggestions || [], ...(resolvedData?.dashboard ? { dashboard: resolvedData.dashboard } : {}) }
      : null,
    chart_json: resolvedData?.chart || null,
  });

  // Update session activity
  await supabaseAdmin
    .from('chat_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', sessionId);
}

async function updateContext(sessionId, context) {
  await supabaseAdmin
    .from('chat_sessions')
    .update({ context_json: context })
    .eq('id', sessionId);
}

async function getSessionMessages(sessionId, userId) {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, intent_json, data_json, chart_json, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[CHATBOT-SESSION] Failed to load messages:', error.message);
    return [];
  }
  return data || [];
}

async function getUserSessions(userId, organizationId) {
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, title, created_at, last_activity_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .order('last_activity_at', { ascending: false })
    .limit(50);

  return data || [];
}

async function deleteSession(sessionId, userId) {
  const { error } = await supabaseAdmin
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) {
    console.error('[CHATBOT-SESSION] Failed to delete session:', error.message);
    throw new Error('Failed to delete session');
  }
}

async function setSessionTitle(sessionId, title) {
  await supabaseAdmin
    .from('chat_sessions')
    .update({ title })
    .eq('id', sessionId);
}

module.exports = {
  resolveSession,
  saveMessages,
  updateContext,
  getSessionMessages,
  getUserSessions,
  deleteSession,
  setSessionTitle,
};
