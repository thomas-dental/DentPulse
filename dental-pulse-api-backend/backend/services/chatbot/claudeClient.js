const Anthropic = require('@anthropic-ai/sdk');
const tokenTracker = require('./tokenTracker');
const requestLogger = require('./requestLogger');

/**
 * Wraps the Anthropic Claude API. Handles tool-use protocol and token tracking.
 * Retries automatically on transient overload (529) and rate-limit (429) responses.
 */

const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 4;

// Hard ceiling on generated (output) tokens for every call. Keeps cost bounded;
// 4000 is well above what any of these prompts actually need to answer fully,
// so clamping to it does not truncate real answers.
const OUTPUT_TOKEN_CAP = 4000;
const capTokens = (n) => Math.min(Number(n) || OUTPUT_TOKEN_CAP, OUTPUT_TOKEN_CAP);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callMessagesWithRetry(client, params) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (!RETRY_STATUSES.has(status) || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      // Exponential backoff with jitter: 0.5s, 1.5s, 4s
      const backoff = Math.round((Math.pow(2, attempt - 1) * 500) * (0.8 + Math.random() * 0.4));
      console.warn(`[CLAUDE] ${status} from Anthropic — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoff}ms`);
      lastErr = err;
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/**
 * Runs one logical Claude call (through the retry wrapper) and records the full
 * request + response to `ai_request_logs` — on success AND on failure — before
 * returning/re-throwing. The log write is fire-and-forget (not awaited) so it
 * adds no latency to the AI call, and requestLogger swallows its own errors so
 * a logging problem can never break the feature. Captures the Anthropic
 * `request_id` (from the message on success, or the error on failure) so a row
 * can be matched to the Anthropic Console → Logs entry.
 */
async function callAndLog(client, params, ctx) {
  const startMs = Date.now();
  try {
    const response = await callMessagesWithRetry(client, params);
    requestLogger.logAiRequest({
      requestId: response?._request_id || null,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      feature: ctx.feature,
      model: params.model,
      status: 'success',
      requestParams: params,
      responsePayload: { stop_reason: response?.stop_reason, content: response?.content },
      inputTokens: response?.usage?.input_tokens || 0,
      outputTokens: response?.usage?.output_tokens || 0,
      latencyMs: Date.now() - startMs,
    });
    return response;
  } catch (err) {
    requestLogger.logAiRequest({
      requestId: err?.request_id || err?.requestID || null,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      feature: ctx.feature,
      model: params.model,
      status: 'error',
      httpStatus: err?.status || err?.response?.status || null,
      errorType: err?.name || err?.type || null,
      errorMessage: err?.message || String(err),
      requestParams: params,
      latencyMs: Date.now() - startMs,
    });
    throw err;
  }
}

async function callWithTools({ apiKey, model, systemPrompt, userMessage, messages, tools, organizationId, userId, feature }) {
  const client = new Anthropic({ apiKey });
  const startMs = Date.now();

  // Use messages array if provided (includes conversation history), otherwise single message
  const msgArray = messages || [{ role: 'user', content: userMessage }];

  const response = await callAndLog(client, {
    model,
    max_tokens: capTokens(1024),
    system: systemPrompt,
    messages: msgArray,
    tools,
    tool_choice: { type: 'auto' },
  }, { feature: feature || 'chatbot-intent', organizationId, userId });

  const latencyMs = Date.now() - startMs;

  // Log token usage
  await tokenTracker.logTokenUsage({
    organizationId,
    userId,
    feature: feature || 'chatbot-intent',
    model,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs,
  });

  // Extract tool use from response
  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse) {
    return {
      toolName: toolUse.name,
      args: toolUse.input || {},
      stopReason: response.stop_reason,
    };
  }

  // If no tool use, extract text response
  const textBlock = response.content.find(c => c.type === 'text');
  return {
    toolName: 'general_question',
    args: {},
    textResponse: textBlock?.text || '',
    stopReason: response.stop_reason,
  };
}

async function callForFormat({ apiKey, model, systemPrompt, userMessage, dataContext, organizationId, userId }) {
  const client = new Anthropic({ apiKey });
  const startMs = Date.now();

  const prompt = `User asked: "${userMessage}"

Here is the data retrieved from the database:
${JSON.stringify(dataContext, null, 2)}

Format this data into a clear, concise markdown response for the user. Include key numbers, trends, and actionable insights. Use bold for important metrics. Use markdown tables where appropriate.`;

  const response = await callAndLog(client, {
    model,
    max_tokens: capTokens(2048),
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  }, { feature: 'chatbot-format', organizationId, userId });

  const latencyMs = Date.now() - startMs;

  await tokenTracker.logTokenUsage({
    organizationId,
    userId,
    feature: 'chatbot-format',
    model,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs,
  });

  const textBlock = response.content.find(c => c.type === 'text');
  return textBlock?.text || 'I was unable to format the response.';
}

/**
 * Plain system+user completion with no fixed prompt wrapper. Used by the
 * Conversational BI insights step, which needs full control of the prompt
 * (it forces the model to cite only pre-computed numbers and return JSON) —
 * callForFormat's hard-coded "format into markdown tables" wrapper would
 * fight that contract. Same retry + token-tracking as the other calls.
 */
async function callForInsights({ apiKey, model, systemPrompt, userMessage, organizationId, userId }) {
  const client = new Anthropic({ apiKey });
  const startMs = Date.now();

  const response = await callAndLog(client, {
    model,
    max_tokens: capTokens(700),
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }, { feature: 'chatbot-bi-insights', organizationId, userId });

  await tokenTracker.logTokenUsage({
    organizationId,
    userId,
    feature: 'chatbot-bi-insights',
    model,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs: Date.now() - startMs,
  });

  const textBlock = response.content.find(c => c.type === 'text');
  return textBlock?.text || '[]';
}

/**
 * Best-effort JSON parse for model output. Tries a straight parse first, then
 * falls back to extracting the first balanced {...} block (in case the model
 * wraps the JSON in prose or a markdown fence despite instructions).
 */
function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

/**
 * Structured-output completion. Constrains the response to `schema` via
 * output_config.format (GA on Opus 4.8 / Sonnet 4.6 / Haiku 4.5) and returns
 * the parsed object. Used by the 13-week cash flow AI forecast — it must hand
 * back a strict JSON shape (adjusted weekly numbers + narrative) the frontend
 * can consume directly. Same retry + token-tracking as the other calls.
 */
async function callForJson({ apiKey, model, systemPrompt, userMessage, schema, feature, maxTokens = OUTPUT_TOKEN_CAP, organizationId, userId }) {
  const client = new Anthropic({ apiKey });
  const startMs = Date.now();

  const base = {
    model,
    max_tokens: capTokens(maxTokens),
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };

  // Prefer structured outputs (output_config.format) for a guaranteed JSON
  // shape, but it's only supported on newer models — if the model/account
  // rejects it, fall back to a plain completion and parse the JSON from text.
  const logCtx = { feature: feature || 'structured-json', organizationId, userId };
  let response;
  try {
    response = await callAndLog(
      client,
      schema ? { ...base, output_config: { format: { type: 'json_schema', schema } } } : base,
      logCtx,
    );
  } catch (err) {
    if (!schema) throw err;
    console.warn('[CLAUDE] structured-output call failed, retrying without schema:', err?.message);
    response = await callAndLog(client, base, logCtx);
  }

  await tokenTracker.logTokenUsage({
    organizationId,
    userId,
    feature: feature || 'structured-json',
    model,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    latencyMs: Date.now() - startMs,
  });

  const textBlock = response.content.find(c => c.type === 'text');
  return parseJsonLoose(textBlock?.text || '');
}

module.exports = { callWithTools, callForFormat, callForInsights, callForJson };
