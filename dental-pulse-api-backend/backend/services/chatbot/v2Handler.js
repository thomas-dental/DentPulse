const { supabaseAdmin } = require('../../config/supabase');
const sessionService = require('./sessionService');
const mentionService = require('./mentionService');
const localClassifier = require('./localClassifier');
const llmClassifier = require('./llmClassifier');
const paramValidator = require('./paramValidator');
const dataResolver = require('./dataResolver');
const responseFormatter = require('./responseFormatter');
const apiKeyService = require('./apiKeyService');
const usageContext = require('./usageContext');
let mammoth = null;
try { mammoth = require('mammoth'); } catch { /* optional */ }

/**
 * V2 Handler — full 6-stage tool-use pipeline.
 * LLM picks a tool, resolver fetches data from Supabase RPCs,
 * formatter turns data into markdown.
 */

// Tools whose (already-correct) output is wrapped into the dashboard UI shell
// when feature_ai_dashboard is on. Metric/analytic/chart tools only — NOT
// row-list dumps, advisory/general, generate_dashboard (already a dashboard),
// or PDF/email reports.
const DASHBOARD_ADAPT_TOOLS = new Set([
  'get_financial_metric',
  'get_treatment_revenue',
  'get_location_metrics',
  'get_cost_breakdown',
  'get_cashflow_data',
  'get_ebitda',
  'get_profit_and_loss',
  'get_plan_mix',
  'get_nhs_performance',
  'get_membership_performance',
  'get_profit_goals',
  'get_revenue_breakdown_report',
  'get_chair_metrics',
  'drill_down_metric',
  'compare_doctors',
  'compare_periods',
  'compare_multiple_doctors',
  'year_over_year_report',
  'multi_period_report',
  'forecast_metric',
  'what_if_scenario',
  // Row/report tables — render as a clean scrollable dashboard table
  // (the adapter id-scrubs + caps rows) instead of a clipped markdown blob.
  'list_providers',
  'list_dna_patients',
  'list_cancelled_patients',
  'list_appointments',
  'list_cost_entries',
  'list_cost_transactions',
]);

async function handleMessage(req, res, config) {
  const userId = req.user?.id;
  const debugInfo = {};
  let orgId = null;
  let message = '';
  let sessionId = null;
  let pageContext = null;
  let includeDebug = false;
  let attachedImages = [];
  let attachedDocuments = [];
  let extractedDocText = '';

  const turnStart = Date.now();

  try {
    const body = req.body || {};
    const rawMessage = body.message;
    sessionId = body.sessionId || null;
    pageContext = body.pageContext || null;
    includeDebug = !!body.includeDebug;
    const images = body.images;
    const attachments = body.attachments;
    // Mentions picked from the @-picker arrive structurally as
    // [{ value, type }]. The user-visible message text deliberately omits the
    // '@' marker (clean bubble — see ChatInput.handleSubmit), so the regex
    // extractor can't recover them; we seed them into `mentions` below.
    const structuredMentions = Array.isArray(body.mentions) ? body.mentions : [];
    const hasAttachments = (Array.isArray(attachments) && attachments.length > 0)
      || (Array.isArray(images) && images.length > 0);
    message = (typeof rawMessage === 'string' && rawMessage.trim().length > 0)
      ? rawMessage
      : (hasAttachments ? '[file attached]' : '');

    // Build typed attachment blocks. Prefer the new `attachments` array; fall
    // back to legacy `images` when the client only sent images.
    const normalized = await normalizeAttachments(attachments, images);
    attachedImages = normalized.imageBlocks;
    attachedDocuments = normalized.documentBlocks;
    extractedDocText = normalized.extractedText;
    if (extractedDocText) {
      // Inline extracted DOCX text into the user message so the classifier and
      // resolvers see it. PDFs are sent natively as document blocks.
      message = `${message}\n\n${extractedDocText}`.trim();
    }

    // ── Resolve user profile ──
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();

    orgId = profile?.current_organization_id;
    if (!orgId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    // ── STEP 0: Pre-processing ──
    const session = await sessionService.resolveSession(userId, sessionId, orgId);
    const context = session.context_json || {};
    context.organizationId = orgId;
    // Forward the caller's JWT so resolvers that hit edge functions (e.g. cashflow-report)
    // authenticate as the actual user — service-role identity is rejected by some functions.
    context.userAccessToken = req.accessToken || null;
    // Forward the page's already-fetched data snapshot. Resolvers prefer this
    // over re-querying so chat answers match what the page is rendering — no
    // drift, no extra DB roundtrip. Persisted on context so subsequent turns
    // in the same session can still answer follow-ups.
    context.pageContext = pageContext || null;

    const expandedMessage = await mentionService.expandAliases(message, orgId, userId);
    const mentions = mentionService.extractMentions(expandedMessage);

    // Seed structurally-picked mentions (the @-picker sends them as plain
    // text with no '@', so extractMentions can't recover them) into the
    // parsed set, so the existing provider/period resolution applies.
    mentionService.mergeStructuredMentions(mentions, structuredMentions);

    mentionService.clearStaleContext(context, expandedMessage);

    // Update doctor from @-mention
    if (mentions.providers.length === 1) {
      const resolved = await mentionService.resolveProviderName(mentions.providers[0], orgId);
      if (resolved) {
        context.currentDoctor = resolved.name;
      }
    }

    // Load recent history for follow-up understanding
    const recentHistory = await sessionService.getSessionMessages(session.id);
    // Keep last 4 messages (2 user-assistant turns)
    const historyForLLM = (recentHistory || []).slice(-4);

    // ── STEP 1: Local classification ──
    let intent = localClassifier.classify(expandedMessage, context, mentions);
    if (intent) {
      debugInfo.classifiedBy = 'local';
    }

    // ── STEP 2: LLM classification (if local missed) ──
    // If any attachments (images or PDFs) are present we always defer to the
    // LLM — the local classifier is text-only.
    const hasAttachmentBlocks = attachedImages.length > 0 || attachedDocuments.length > 0;
    if (!intent || hasAttachmentBlocks) {
      const orgKey = await apiKeyService.getOrgApiKey(orgId);
      const llmAttachments = [...attachedImages, ...attachedDocuments];
      intent = await llmClassifier.classify(expandedMessage, context, mentions, pageContext, orgKey, historyForLLM, llmAttachments);
      debugInfo.classifiedBy = hasAttachmentBlocks ? 'llm-vision' : 'llm';
    }

    // ── STEP 2.5: Override period if @-period was explicitly mentioned ──
    // The @-period token is the source of truth — override whatever Claude picked
    if (mentions.periods.length === 1) {
      const periodHelper = require('./periodHelper');
      const resolvedPeriod = periodHelper.resolveperiodLabel(mentions.periods[0]);
      if (resolvedPeriod) {
        intent.args.period_from = resolvedPeriod.from;
        intent.args.period_to = resolvedPeriod.to;
      }
    }

    // Inline period in plain text ("this month", "last quarter") — chip replies
    // arrive without an @-prefix and may not match any local pattern, so resolve
    // them here when args are still missing.
    if (!intent.args.period_from || !intent.args.period_to) {
      const detected = localClassifier.detectInlinePeriod(expandedMessage);
      if (detected) {
        intent.args.period_from = intent.args.period_from || detected.from;
        intent.args.period_to = intent.args.period_to || detected.to;
      }
    }

    // Resume args from a refused turn. When the previous turn refused (e.g.
    // missing period), we stashed the original intent in context.pendingIntent.
    // If the current turn lands on the same tool, fill in any args the new
    // turn didn't explicitly set — most importantly things like sort='asc'
    // and dimension='treatment' that came from the original "which treatment
    // has lowest revenue" wording but the follow-up chip (just a location +
    // period) wouldn't carry.
    //
    // Also resume when the classifier fell back to `general_question`: bare
    // chip replies like "Loc A" or "this month" don't match any local pattern
    // and the LLM sometimes treats them as small talk. Treat them as a
    // continuation of the pending intent so the original revenue/profit
    // question gets answered.
    if (context.pendingIntent) {
      const pending = context.pendingIntent;
      const sameTool = pending.toolName === intent.toolName;
      const fellBackToGeneral = intent.toolName === 'general_question';
      const pendingArgs = pending.args || {};

      // A "pure chip reply" is when the user's whole message is just an answer
      // to the bot's clarifying prompt — a period chip ("This month", "Q1"),
      // a location chip ("The South Street Dental Practice", "All locations"),
      // or similar — with no new question words. In that case the LLM sometimes
      // hallucinates a sibling tool (e.g. "this month" + prior context
      // "private revenue" → get_treatment_revenue instead of the pending
      // get_location_metrics). Treat these the same as fellBackToGeneral:
      // restore the pending tool.
      //
      // Detection strategy:
      //   1. Exact match against a chip we just offered (most reliable — handles
      //      location names that we can't enumerate by regex).
      //   2. Period-keyword strip — message is empty after removing period
      //      references (handles "this month", "Q1", "April 2026" even when
      //      they weren't in the offered chips).
      const trimmedMsg = (message || '').trim();
      const lastChips = Array.isArray(context.lastSuggestions) ? context.lastSuggestions : [];
      const chipMatch = lastChips.some(c =>
        typeof c === 'string' && c.trim().toLowerCase() === trimmedMsg.toLowerCase()
      );
      const stripped = trimmedMsg
        .toLowerCase()
        .replace(/\b(this|last|next|past)\s+(year|month|week|quarter|day|fy|financial\s+year)s?\b/g, '')
        .replace(/\b(today|yesterday|tomorrow|ytd|fy\s*\d{0,4})\b/g, '')
        .replace(/\bq[1-4]\b/g, '')
        .replace(/\blast\s+\d+\s+days?\b/g, '')
        .replace(/\b\d{4}[-\/]\d{1,2}([-\/]\d{1,2})?\b/g, '')
        .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/g, '')
        .replace(/\ball\s+locations?\b/g, '')
        .replace(/[^a-z0-9]/g, '');
      const isPureChipReply = chipMatch || stripped.length <= 3;

      // Always carry over fields the user explicitly answered in a prior turn
      // (location, doctor) even when the LLM picks a sibling tool that doesn't
      // expose those fields in its schema. Without this, clicking a bare
      // period chip like "Last month" can land on a tool without location_id,
      // dropping the location the user just picked and letting the topbar
      // filter silently override it.
      const CARRY_OVER_KEYS = [
        'location_id',
        'location_ids',
        'location_display',
        'doctor_name',
      ];
      for (const k of CARRY_OVER_KEYS) {
        if (intent.args[k] == null && pendingArgs[k] != null) {
          intent.args[k] = pendingArgs[k];
        }
      }

      if (sameTool || fellBackToGeneral || isPureChipReply) {
        if (fellBackToGeneral || isPureChipReply) {
          intent.toolName = pending.toolName;
          intent.refused = false;
          intent.refusalMessage = undefined;
          intent.refusalSuggestions = undefined;
        }
        // For chip replies, pending args win over LLM-hallucinated args
        // (e.g., "Associate profit performance" → paramValidator stamps
        // provider_type='Dentist'. On a chip-reply turn the LLM doesn't see
        // the word "Associate" and may stamp provider_type='Other' instead.
        // Restoring pending overrides that hallucination.) The only args the
        // chip itself legitimately supplies are period + location — for those
        // we still prefer the current turn's value when present.
        const CHIP_SUPPLIED = new Set([
          'period_from', 'period_to', 'period_label',
          'location_id', 'location_ids', 'location_display',
        ]);
        for (const k of Object.keys(pendingArgs)) {
          const pendingHas = pendingArgs[k] != null;
          if (!pendingHas) continue;
          if (isPureChipReply && !CHIP_SUPPLIED.has(k)) {
            intent.args[k] = pendingArgs[k];
          } else if (intent.args[k] == null) {
            intent.args[k] = pendingArgs[k];
          }
        }
      }
    }

    // Pull a recently-mentioned email out of the message OR from a previous
    // turn so the user doesn't have to repeat it. We also scan the raw
    // message for an email-shaped token, since classifiers sometimes fail to
    // extract it when the message is "send the report on this".
    if (intent.toolName === 'email_report') {
      if (!intent.args.email_address) {
        const emailMatch = (expandedMessage || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (emailMatch) intent.args.email_address = emailMatch[0];
      }
      if (!intent.args.email_address && context.lastEmailAddress) {
        intent.args.email_address = context.lastEmailAddress;
      }
    }

    // "Send to another email" chip — user explicitly wants a different
    // recipient. Short-circuit before the lastEmailAddress auto-fill kicks in,
    // mark the session as awaiting-email, and respond with the address prompt
    // so the next turn collects a fresh address.
    if (/^\s*send\s+to\s+another\s+email\s*$/i.test(message || '')) {
      context.awaitingEmail = true;
      let emailChips = [];
      try {
        emailChips = await collectEmailChips(orgId, userId);
      } catch (chipErr) {
        console.error('[CHATBOT-V2] collectEmailChips failed:', chipErr.message);
      }
      const promptMd = 'Which email address should I send the report to?';
      await sessionService.saveMessages(
        session.id, message, promptMd,
        { toolName: 'general_question', args: {} },
        { preformatted: true, markdown: promptMd },
        emailChips,
      );
      {
        const { pageContext: _drop, ...contextForPersist } = context;
        await sessionService.updateContext(session.id, contextForPersist);
      }
      return res.json({
        sessionId: session.id,
        message: promptMd,
        suggestions: emailChips,
        chart: null,
        version: 'v2',
      });
    }

    // Awaiting-email follow-up: when the previous turn asked for an email and
    // the user replied with just an address (chip pick or typed), force the
    // email_report intent so we don't fall back into general_question and ask
    // again. We only consume the awaitingEmail flag if a real address is in
    // the message — otherwise the user is changing topic and the next normal
    // flow should handle it.
    if (context.awaitingEmail && intent.toolName !== 'email_report') {
      const emailInMessage = (expandedMessage || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (emailInMessage) {
        intent = {
          toolName: 'email_report',
          args: {
            email_address: emailInMessage[0],
            report_type: context.currentMetric === 'profit' ? 'pl' : (context.currentMetric || 'pl'),
            period_from: context.currentPeriod?.from,
            period_to: context.currentPeriod?.to,
            doctor_name: context.currentDoctor || undefined,
          },
          classifiedBy: 'override-email-awaiting',
        };
        debugInfo.classifiedBy = 'override-email-awaiting';
        context.awaitingEmail = false;
      }
    }

    // Safety net: when the user asks to email/send a report but the LLM
    // bailed to a text response asking for the email, and we actually have
    // one saved, override the classification to email_report. Without this,
    // the LLM keeps re-asking for an email it already has.
    const wantsEmailSend = /\b(email|e-?mail|send|mail|forward)\b.*\b(report|this|it|to me)\b|\b(send|email)\s+the\s+report\b|\bsend\s+(it|this|the\s+pdf)\b/i.test(expandedMessage || '');
    if (
      intent.toolName === 'general_question' &&
      wantsEmailSend &&
      context.lastEmailAddress
    ) {
      intent = {
        toolName: 'email_report',
        args: {
          email_address: context.lastEmailAddress,
          report_type: context.currentMetric === 'profit' ? 'pl' : (context.currentMetric || 'pl'),
          period_from: context.currentPeriod?.from,
          period_to: context.currentPeriod?.to,
          doctor_name: context.currentDoctor || undefined,
        },
        classifiedBy: 'override-email',
      };
      debugInfo.classifiedBy = 'override-email';
    }

    debugInfo.intent = intent.toolName;
    debugInfo.args = intent.args;

    // Inherit payor scope from the page when the user is on a payor-scoped
    // view (Private Treatment / NHS / Membership) and the intent supports
    // payor filtering. Without this, "show all locations overview" on
    // Private Treatment returns all-payor revenue and the numbers don't
    // match the page's "Private Revenue" card.
    {
      const pagePath = String(pageContext?.page || pageContext?.snapshot?.url || '').toLowerCase();
      const PAYOR_AWARE_TOOLS = new Set([
        'get_financial_metric',
        'get_treatment_revenue',
        'get_location_metrics',
        'get_revenue_breakdown_report',
        'generate_dashboard',
      ]);
      if (PAYOR_AWARE_TOOLS.has(intent.toolName) && !intent.args.payor) {
        if (pagePath.includes('private-treatment') || pagePath.includes('/treatments/private')) {
          intent.args.payor = 'private';
        } else if (pagePath.includes('/nhs') || pagePath.includes('nhs-treatment')) {
          intent.args.payor = 'nhs';
        } else if (pagePath.includes('membership')) {
          intent.args.payor = 'membership';
        }
      }
    }

    // Page-anchored intents inherit the topbar's date range BEFORE the
    // paramValidator's "missing period" refusal / default fires. This lets
    // "DNA rate" on the Location History page silently use the period the
    // page is currently showing instead of refusing or defaulting to "this
    // month". Revenue/profit intentionally do NOT inherit silently — the
    // user has to name the period to avoid the historical footgun.
    {
      const pageFilters_early = (pageContext && pageContext.filters) || {};
      const PAGE_ANCHORED_TOOLS = new Set([
        'get_attendance_metric',
        'get_recommendations',
        'list_dna_patients',
        'list_cancelled_patients',
        'list_appointments',
        'list_cost_entries',
        'list_cost_transactions',
        'get_ebitda',
        'list_providers',
        'get_profit_and_loss',
        // get_location_metrics added so per-location revenue questions on
        // payor-scoped pages (Private Treatment / NHS / Membership) inherit
        // the page's selected date range. Without this, "show all locations
        // overview" on Private Treatment with March selected returned May
        // data because the resolver defaulted to "This Month".
        'get_location_metrics',
        // NOTE: 'generate_dashboard' is deliberately NOT page-anchored.
        // A dashboard is a high-value, wide-scope answer, so we want the
        // user to explicitly confirm the window and location rather than
        // silently inheriting whatever the page filter happens to be (which
        // also propagated the page's off-by-one period). Leaving it out of
        // this set lets paramValidator's missing-period refusal fire, which
        // in turn triggers the location-then-period prompt below — the bot
        // asks "Which location?" then "Which time period?" before building.
        // The financial-metric / treatment-revenue / cost-breakdown /
        // cashflow / chair-metrics / revenue-breakdown / compare-doctors
        // tools INTENTIONALLY do NOT silently inherit the page's period —
        // user wants explicit control. They go through the normal "Tell me
        // a period" flow with a quick chip to use the page filter (added
        // in the resolver's missing-period response). This avoids the
        // confusion where two queries on the same page returned different
        // data because the page filter changed silently between turns.
      ]);
      if (
        PAGE_ANCHORED_TOOLS.has(intent.toolName) &&
        (!intent.args.period_from || !intent.args.period_to)
      ) {
        // Prefer the explicit period the page already passed in aiContext.
        // Pages on cost / treatment / dashboard pass `period: { from, to }`
        // at the top level of aiContext, separate from any topbar
        // date_range_id label. This is the authoritative source — use it
        // verbatim instead of re-resolving a label.
        const pageCtxPeriod = pageContext && pageContext.period;
        if (pageCtxPeriod && pageCtxPeriod.from && pageCtxPeriod.to) {
          intent.args.period_from = pageCtxPeriod.from;
          intent.args.period_to = pageCtxPeriod.to;
          // Stamp a flag so the formatter can tell the user the period came
          // from the page filter (rather than a bot default or explicit
          // user period). Improves transparency — without this the user
          // sees a date in the response they didn't type and can't tell
          // where it came from.
          intent.args._periodSource = 'page-filter';
        } else if (pageFilters_early.date_range_id) {
          const labelGuess = String(pageFilters_early.date_range_id).replace(/-/g, ' ');
          const resolved = require('./periodHelper').resolveperiodLabel(labelGuess);
          if (resolved) {
            intent.args.period_from = resolved.from;
            intent.args.period_to = resolved.to;
            intent.args._periodSource = 'page-filter';
          }
        }
      }
      // Same for the topbar's location filter — page-anchored intents need
      // it set before paramValidator/refusals run.
      if (
        PAGE_ANCHORED_TOOLS.has(intent.toolName) &&
        pageFilters_early.location_id &&
        !intent.args.location_id && !intent.args.location_ids
      ) {
        intent.args.location_id = pageFilters_early.location_id;
      }
      // Also inherit selectedLocationId from the page's aiContext (some
      // pages pass it at top level, not under filters).
      if (
        PAGE_ANCHORED_TOOLS.has(intent.toolName) &&
        !intent.args.location_id &&
        !intent.args.location_ids &&
        pageContext &&
        pageContext.selectedLocationId
      ) {
        intent.args.location_id = pageContext.selectedLocationId;
      }
    }

    // ── STEP 3: Parameter validation ──
    paramValidator.fillFromContext(intent, context, message);

    // "All locations" / "every site" — explicit opt-out of the location filter
    // when the user picks the multi-site chip. We mark this on context so the
    // location prompt doesn't re-fire on the next turn (e.g. when the user
    // still needs to answer the period question).
    const wantsAllLocations = /\b(all|every|each)\s+(location|site|practice|clinic)s?\b/i.test(message)
      || /^\s*all\s+locations?\s*$/i.test(message);
    if (wantsAllLocations) {
      context.locationScopeAll = true;
      context.locationAcknowledged = true;
    }

    // Defensive: the LLM sometimes stuffs the location *name* into
    // intent.args.location_id (e.g. when the user clicked a name chip). The
    // downstream query treats location_id as a UUID, so a name produces a
    // Postgres "invalid input syntax for type uuid" error. Clear any
    // location_id that isn't UUID-shaped so the mention-service below can
    // resolve the actual UUID from the message.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (intent.args.location_id && !UUID_RE.test(String(intent.args.location_id).trim())) {
      delete intent.args.location_id;
    }
    if (Array.isArray(intent.args.location_ids)) {
      intent.args.location_ids = intent.args.location_ids.filter(v => UUID_RE.test(String(v).trim()));
      if (intent.args.location_ids.length === 0) delete intent.args.location_ids;
    }

    // If the user named a location in the message itself ("south street", "TLF",
    // "both Teeth For Life"), that always wins over the topbar filter.
    const messageLocation = await mentionService.resolveLocationFromMessage(message, orgId);
    const userNamedLocation = !!(messageLocation && messageLocation.ids.length > 0);
    if (userNamedLocation && !intent.args.location_id && !intent.args.location_ids) {
      if (messageLocation.ids.length === 1) {
        intent.args.location_id = messageLocation.ids[0];
      } else {
        intent.args.location_ids = messageLocation.ids;
        intent.args.location_display = messageLocation.display;
      }
      // Once the user names a specific location, drop any prior "all" scope so
      // a later question doesn't keep spanning every site.
      context.locationScopeAll = false;
      context.locationAcknowledged = true;
    }

    // If the user's question explicitly asks for a cross-location breakdown
    // ("by location", "across locations", "compare locations", "per site"),
    // skip the single-location clarification entirely — they've already told
    // us they want ALL locations. Setting locationAcknowledged=true on the
    // session context stops the prompt below from firing, and locationScopeAll
    // ensures downstream resolvers don't filter by a single location_id.
    const wantsCrossLocation = /\b(?:by\s+location|across\s+(?:all\s+)?(?:locations?|sites?|practices?)|per\s+(?:location|site|practice)|for\s+each\s+(?:location|site|practice)|location[\s-]+breakdown|site[\s-]+breakdown|compare\s+(?:all\s+)?(?:locations?|sites?|practices?)|location[\s-]+wise|site[\s-]+wise|each\s+(?:location|site|practice)|every\s+(?:location|site|practice))\b/i.test(message || '');
    if (wantsCrossLocation) {
      context.locationScopeAll = true;
      context.locationAcknowledged = true;
    }

    // Multi-location orgs: if we're about to refuse for a missing period and
    // the user hasn't picked a location yet in this conversation, ask for the
    // location first with pure location-name chips. The period prompt will
    // re-fire on the next turn once the location is resolved. We deliberately
    // run this BEFORE applying the topbar's location filter so the user
    // always gets the option to override it from the chatbot itself.
    const pageFilters = pageContext?.filters || {};
    if (
      intent.refused &&
      /time period/i.test(intent.refusalMessage || '') &&
      !userNamedLocation &&
      !context.locationAcknowledged &&
      !wantsCrossLocation
    ) {
      const { data: locs } = await supabaseAdmin
        .from('practice_locations')
        .select('id, location_name')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('location_name')
        .limit(10);

      if (locs && locs.length > 1) {
        const names = locs.map(l => l.location_name).filter(Boolean);
        const head = names.slice(0, 4).map(n => `**${n}**`).join(', ');
        const moreCount = Math.max(0, names.length - 4);
        const moreNote = moreCount > 0 ? `, and ${moreCount} more` : '';

        intent.refusalMessage =
          `Which location would you like to see? Pick **all locations**, or one of: ${head}${moreNote}.\n\n` +
          `I'll ask for the time period next.`;

        intent.refusalSuggestions = [
          'All locations',
          ...names,
        ].filter((v, i, a) => a.indexOf(v) === i);
      }
    }

    // Apply the topbar's location/region filter when the user didn't pick one
    // from the chatbot (and we're not asking them for it on this turn).
    // EXCEPTION: when the user explicitly asked for "all locations" /
    // cross-location (wantsAllLocations / wantsCrossLocation / locationScopeAll
    // from context), the user's wording wins over the topbar — otherwise
    // "Show chair data for all locations" with South Street in the topbar
    // returns South Street only.
    const userOptedOutOfTopbarLocation = wantsAllLocations || wantsCrossLocation || context.locationScopeAll === true;
    if (pageFilters.location_id && !intent.args.location_id && !intent.args.location_ids && !userOptedOutOfTopbarLocation) {
      intent.args.location_id = pageFilters.location_id;
    }
    if (pageFilters.region_id && !intent.args.region_id && !userOptedOutOfTopbarLocation) {
      intent.args.region_id = pageFilters.region_id;
    }
    // Surface the explicit "all locations" intent on the intent itself so
    // downstream resolvers can drop the page-snapshot fast path (which is
    // already scoped to the topbar's location) and pull the full org data.
    if (userOptedOutOfTopbarLocation) {
      intent.args._scopeAllLocations = true;
    }

    // Hourly chair questions are inherently per-location (the page only shows
    // hourly for one location at a time). When the user asks for "hourly
    // utilisation pattern" on /chairs, force the per-location page-snapshot
    // path even if a prior turn set context.locationScopeAll — otherwise the
    // resolver returns the all-org summary and the hourly breakdown is
    // silently dropped. We do NOT clear context.locationScopeAll (so a
    // later question like "and what about revenue?" stays cross-location);
    // we only override for this turn.
    const wantsHourlyChair = intent.toolName === 'get_chair_metrics'
      && /\b(?:by\s+hour|hourly|per\s+hour|hour\s+by\s+hour|hourly\s+(?:utili[sz]ation|usage|pattern))\b|\bpeak\s+hours?\b|\blow[\s-]?utili[sz]ation\s+hours?\b/i.test(message);
    if (wantsHourlyChair) {
      delete intent.args._scopeAllLocations;
    }
    // Inherit the page's provider-type filter so "top 5" on the Dentist page
    // returns dentists only (matching the page's "TOTAL DENTISTS" card).
    if (pageFilters.provider_type && !intent.args.provider_type) {
      intent.args.provider_type = pageFilters.provider_type;
    }


    // The BI orchestrator parses the question itself to pick KPI + dimension.
    // The local classifier stamps args._question; the LLM-classified path
    // doesn't, so backfill it here from the (alias-expanded) message.
    if (intent.toolName === 'generate_dashboard' && !intent.args._question) {
      intent.args._question = expandedMessage || message;
    }

    // Page-aware fallback. A GENERIC dashboard ask (no specific KPI, and NOT
    // an explicit "overview / how are we doing" request) would otherwise emit
    // the one fixed practice_overview template for every page — the "same
    // dashboard everywhere" problem. Instead reflect the page the user is on
    // by routing to ITS dedicated, page-reconciled resolver (those numbers
    // mirror the page — feedback-chatbot-reuse-page-logic). Explicit overview
    // asks (vague) and specific-KPI asks are left untouched.
    if (intent.toolName === 'generate_dashboard') {
      const { resolveKpis, pageAwareDashboardTool } = require('./bi/nlResolver');
      const q = intent.args._question || expandedMessage || message || '';
      const rk = resolveKpis(q);
      if (!rk.primary && !rk.vague) {
        const pageTool = pageAwareDashboardTool(context.pageContext);
        if (pageTool && pageTool !== 'generate_dashboard') {
          intent.toolName = pageTool;
          const url = String(context.pageContext?.snapshot?.url || '').toLowerCase();
          if (pageTool === 'get_treatment_revenue'
              && /\/treatments\/private|private[-_]treatment/.test(url)
              && !intent.args.payor) {
            intent.args.payor = 'private';
          }
          debugInfo.classifiedBy = `${debugInfo.classifiedBy || ''}+page-aware:${pageTool}`;
        }
      }
    }

    // ── STEP 4: Data resolution ──
    const resolveStart = Date.now();
    const resolved = await dataResolver.resolve(intent, orgId, context);
    debugInfo.resolverMs = Date.now() - resolveStart;

    // ── STEP 5: Response formatting ──
    const formatStart = Date.now();
    // Pass `message` + `pageContext` through so the general-question formatter
    // can answer "anything visible on this page" questions from the page
    // snapshot the frontend captured (URL, title, rendered text of <main>).
    const formatted = await responseFormatter.format(intent, resolved, orgId, {
      userMessage: message,
      pageContext,
    });
    debugInfo.formatterMs = Date.now() - formatStart;

    // ── STEP 5.5: Normalise suggestion chip count ─────────────────────────
    // Different formatters return anywhere from 1 to 4 chips, which feels
    // inconsistent to the user — sometimes "page-related questions" come
    // back as 1, sometimes 4. Standardise: always 3-4 chips, padded from a
    // page-aware fallback when a formatter returned fewer. Truncated to 4
    // when more.
    formatted.suggestions = normalizeSuggestionChips(formatted.suggestions, {
      intent,
      pageContext,
      currentMetric: intent.args?.metric || context.currentMetric || null,
    });

    // When the bot has asked for an email address (LLM bailed to a text
    // response because email_report needs one), offer the user's known
    // addresses as chips so they can answer in one tap instead of typing.
    // We also flag the conversation as awaiting-email so the next turn can
    // force email_report when the user replies with just an address.
    const askedForEmail =
      intent.toolName === 'general_question' &&
      /\bemail\s+address\b|provide\s+(?:the|an?)\s+email|need\s+your\s+email|what\s+email/i.test(formatted.message || '');
    if (askedForEmail) {
      context.awaitingEmail = true;
      try {
        const emailChips = await collectEmailChips(orgId, userId);
        if (emailChips.length > 0) {
          formatted.suggestions = emailChips;
        }
      } catch (chipErr) {
        console.error('[CHATBOT-V2] collectEmailChips failed:', chipErr.message);
        // Non-fatal — fall back to the formatter's default suggestions.
      }
    } else if (intent.toolName === 'email_report' && !intent.refused) {
      // Email was sent successfully — clear the awaiting flag.
      context.awaitingEmail = false;
    }

    // Strip the [[EXPORT_LINKS]] placeholder BEFORE persistence so the DB
    // never stores it. Loading a previous session was showing the raw
    // placeholder because the cleanup originally happened AFTER saveMessages.
    // The placeholder → real-URL substitution below replaces the cleaned
    // message; if the formatter emitted an `exportable`, we substitute first,
    // then save. Otherwise we just strip and save.
    let messageForPersist = formatted.message;
    if (formatted.exportable && messageForPersist.includes('[[EXPORT_LINKS]]')) {
      const exportCache = require('./exportCache');
      const token = exportCache.put(formatted.exportable);
      const origin = `${req.protocol}://${req.get('host')}`;
      const csvUrl = `${origin}/api/chatbot/export/${token}?format=csv`;
      const pdfUrl = `${origin}/api/chatbot/export/${token}?format=pdf`;
      const links = `\n\n📥 **Download the full list:** [Excel / CSV](${csvUrl}) · [PDF](${pdfUrl})`;
      messageForPersist = messageForPersist.replace('[[EXPORT_LINKS]]', links);
    }
    messageForPersist = messageForPersist
      .replace(/\s*\[\[EXPORT_LINKS\]\]\s*/g, '')
      .replace(/\s*<<EXPORT_LINKS>>\s*/g, '');

    // Render adapter: data/report tools render in the dashboard UI shell too.
    // Wraps the EXISTING (correct, tuned) resolver output — never reroutes
    // through the v1 BI engine — so cashflow/EBITDA/P&L/cost numbers stay
    // right. Excludes row-list dumps, advisory, and PDF/email reports.
    if (
      config.feature_ai_dashboard &&
      !resolved.dashboard &&
      !resolved.preformatted &&
      !resolved.isGeneral &&
      DASHBOARD_ADAPT_TOOLS.has(intent.toolName)
    ) {
      try {
        const { adaptResolvedToDashboard } = require('./bi/resolvedAdapter');
        const adapted = adaptResolvedToDashboard(intent, resolved);
        if (adapted) resolved.dashboard = adapted;
      } catch (adaptErr) {
        console.error('[CHATBOT-V2] dashboard adapt failed (non-fatal):', adaptErr.message);
      }
    }

    // Attach the per-turn usage summary to the dashboard so it rides along
    // in the response + persistence (rendered as a muted line under the
    // answer, like the reference UI's "39.3s · tokens · $cost · N tools").
    if (resolved && resolved.dashboard) {
      const u = usageContext.get();
      resolved.dashboard.usage = {
        latencyMs: Date.now() - turnStart,
        inputTokens: u ? u.inputTokens : 0,
        outputTokens: u ? u.outputTokens : 0,
        costUsd: Number(((u ? u.costUsd : 0) || 0).toFixed(4)),
        tools: Array.isArray(resolved.dashboard.steps)
          ? resolved.dashboard.steps.length
          : (u ? u.calls : 0),
      };
    }

    // ── STEP 6: Persist + respond ──
    await sessionService.saveMessages(session.id, message, messageForPersist, intent, resolved, formatted.suggestions);

    // Update context
    context.lastIntent = intent.toolName;
    if (intent.args?.metric) context.currentMetric = intent.args.metric;
    if (intent.args?.period_from && intent.args?.period_to) {
      context.currentPeriod = {
        from: intent.args.period_from,
        to: intent.args.period_to,
        label: intent.args.period_label || `${intent.args.period_from} to ${intent.args.period_to}`,
      };
    }

    // Stash the intent if we refused so the next turn can pick up the
    // original sort/dimension/etc. Clear it on successful resolution so a
    // later, unrelated question doesn't inherit stale args.
    if (intent.refused) {
      context.pendingIntent = {
        toolName: intent.toolName,
        args: { ...(intent.args || {}) },
      };
    } else {
      context.pendingIntent = null;
    }
    // Stash the suggestion chips we just sent so the next turn can detect
    // whether the user is replying with one of them (chip-reply continuation).
    // Without this, a chip like "The South Street Dental Practice" looks
    // indistinguishable from a free-text question and the LLM may switch tools.
    context.lastSuggestions = Array.isArray(formatted.suggestions) ? formatted.suggestions.slice(0, 12) : null;
    if (!context.mentionedDoctors) context.mentionedDoctors = [];
    if (intent.args?.doctor_name && !context.mentionedDoctors.includes(intent.args.doctor_name)) {
      context.mentionedDoctors.push(intent.args.doctor_name);
    }

    // Remember the most recent email the user provided — either as an arg on
    // an email_report intent, or just typed into the message — so follow-ups
    // like "send the report on this" don't have to ask for it again.
    const observedEmail = intent.args?.email_address
      || ((message || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
    if (observedEmail) context.lastEmailAddress = observedEmail;

    // Strip the page snapshot before persisting — it can be large (providers
    // + trend arrays) and is supplied fresh on every request anyway, so
    // persisting it would just bloat the chat_sessions row.
    const { pageContext: _drop, ...contextForPersist } = context;
    await sessionService.updateContext(session.id, contextForPersist);

    // Auto-title from first message
    if (!session.title) {
      const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
      await sessionService.setSessionTitle(session.id, title);
    }

    // Apply feature flags
    const chart = config.feature_inline_charts ? (resolved.chart || null) : null;
    const dashboard = config.feature_ai_dashboard ? (resolved.dashboard || null) : null;

    // The export-link substitution + placeholder strip ran BEFORE persistence
    // (see messageForPersist above). Re-use that cleaned message for the
    // response so we don't do the work twice.
    const finalMessage = messageForPersist;

    res.json({
      sessionId: session.id,
      message: finalMessage,
      suggestions: formatted.suggestions || [],
      chart,
      dashboard,
      insightData: resolved.insightData || null,
      reportReady: resolved.reportReady || false,
      cachedReportId: resolved.reportId || null,
      briefing: null,
      anomalies: null,
      recommendations: null,
      version: 'v2',
      debug: includeDebug ? debugInfo : undefined,
    });

  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      let isAdmin = false;
      if (orgId) {
        const { data: role } = await supabaseAdmin
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .eq('organization_id', orgId)
          .single();
        isAdmin = role?.role === 'owner' || role?.role === 'admin';
      }

      return res.status(400).json({
        error: err.message,
        errorCode: 'NO_API_KEY',
        isAdmin,
      });
    }
    console.error('[CHATBOT-V2] Error:', err.message, err.stack?.split('\n').slice(0, 5).join('\n'));

    let isAdmin = false;
    if (orgId) {
      const { data: role } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', orgId)
        .single();
      isAdmin = role?.role === 'owner' || role?.role === 'admin';
    }

    // Anthropic capacity errors get a friendlier, retryable message for everyone.
    const errStatus = err?.status || err?.response?.status;
    const errType = err?.error?.error?.type || err?.error?.type;
    const isOverloaded = errStatus === 529 || errStatus === 429 || errType === 'overloaded_error' || errType === 'rate_limit_error';

    // Extract the Anthropic-side human-readable message. err.message from the
    // SDK is typically "<status> <raw-json-payload>" — parse the JSON out so
    // we don't bleed the request_id / structure into the UI.
    let anthropicMessage = err?.error?.error?.message || err?.error?.message || null;
    if (!anthropicMessage && typeof err?.message === 'string') {
      const jsonStart = err.message.indexOf('{');
      if (jsonStart >= 0) {
        try {
          const parsed = JSON.parse(err.message.slice(jsonStart));
          anthropicMessage = parsed?.error?.message || parsed?.message || null;
        } catch {
          /* leave anthropicMessage null and fall through */
        }
      }
    }

    // Map common LLM-provider billing/auth issues to a generic, vendor-neutral
    // message. The full technical detail is logged server-side above so the
    // dev team can diagnose without exposing Anthropic-specific wording (or
    // billing URLs) to end users.
    const isBilling = errStatus === 400 && /\bcredit\s+balance\b|billing|invoice|payment/i.test(anthropicMessage || '');
    const isAuthErr = errStatus === 401 || errStatus === 403 || /invalid.*api.*key|authentication/i.test(anthropicMessage || '');

    let userMessage;
    if (isOverloaded) {
      userMessage = 'The AI service is busy right now. Please try again in a moment.';
    } else if (isBilling || isAuthErr) {
      userMessage = 'The AI assistant is temporarily unavailable. Please try again later.';
    } else {
      userMessage = 'Something went wrong. Please try again.';
    }

    if (!res.headersSent) {
      res.status(errStatus === 429 || errStatus === 529 ? 503 : 500).json({
        error: userMessage,
        isAdmin,
      });
    }
  }
}

/**
 * Build chip suggestions of known email addresses for "email this report"
 * prompts. Puts the current user's email first so the obvious one-tap answer
 * is at the head of the list, followed by their teammates' emails.
 */
async function collectEmailChips(orgId, userId) {
  if (!orgId) return [];
  const out = [];
  const seen = new Set();

  // Current user's email first.
  if (userId) {
    const { data: me } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .maybeSingle();
    if (me?.email) {
      out.push(me.email);
      seen.add(me.email.toLowerCase());
    }
  }

  // Teammates assigned to this org.
  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .eq('organization_id', orgId);
  const teammateIds = (roles || []).map(r => r.user_id).filter(Boolean);

  if (teammateIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email')
      .in('user_id', teammateIds);
    for (const p of profiles || []) {
      if (!p?.email) continue;
      const key = p.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p.email);
    }
  }

  return out.slice(0, 6);
}

/**
 * Convert client-supplied attachments into Anthropic-style content blocks.
 *
 * Returns:
 *   - imageBlocks: image/* attachments as `image` content blocks
 *   - documentBlocks: PDFs as `document` content blocks (Anthropic native PDF support)
 *   - extractedText: concatenated plain text extracted from DOCX files,
 *     prefixed with the file name. Inlined into the user message so the
 *     classifier sees the document content.
 *
 * Accepts either:
 *   - typed `attachments`: [{ kind, mediaType, dataUrl, name }]
 *   - legacy `images`: array of data URLs or { dataUrl } objects
 */
async function normalizeAttachments(attachments, legacyImages) {
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
  const PDF_TYPE = 'application/pdf';
  const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const MAX_FILES = 8;

  const imageBlocks = [];
  const documentBlocks = [];
  const textChunks = [];

  // Build a unified list: typed attachments first, then any legacy images that
  // weren't already represented in the typed list.
  const items = [];
  if (Array.isArray(attachments)) {
    for (const a of attachments.slice(0, MAX_FILES)) items.push(a);
  } else if (Array.isArray(legacyImages)) {
    for (const raw of legacyImages.slice(0, MAX_FILES)) {
      if (typeof raw === 'string') items.push({ kind: 'image', dataUrl: raw });
      else if (raw && typeof raw === 'object') items.push(raw);
    }
  }

  for (const raw of items) {
    let mediaType = raw?.mediaType || null;
    let base64 = null;
    const name = raw?.name || 'attachment';

    if (typeof raw === 'string') {
      const m = /^data:([^;]+);base64,(.+)$/.exec(raw);
      if (m) { mediaType = m[1]; base64 = m[2]; }
    } else if (raw && typeof raw === 'object') {
      if (typeof raw.dataUrl === 'string') {
        const m = /^data:([^;]+);base64,(.+)$/.exec(raw.dataUrl);
        if (m) {
          if (!mediaType) mediaType = m[1];
          base64 = m[2];
        }
      } else if (raw.base64) {
        base64 = raw.base64;
      }
    }
    if (!mediaType || !base64) continue;
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

    if (IMAGE_TYPES.has(mediaType)) {
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
      continue;
    }

    if (mediaType === PDF_TYPE) {
      documentBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: PDF_TYPE, data: base64 },
      });
      continue;
    }

    if (mediaType === DOCX_TYPE) {
      if (!mammoth) {
        textChunks.push(`[Attached document "${name}" — DOCX parsing not available on this server.]`);
        continue;
      }
      try {
        const buffer = Buffer.from(base64, 'base64');
        const result = await mammoth.extractRawText({ buffer });
        const text = (result?.value || '').trim();
        if (text) {
          // Hard cap to avoid blowing the context window on huge documents.
          const MAX_CHARS = 20000;
          const clipped = text.length > MAX_CHARS
            ? `${text.slice(0, MAX_CHARS)}\n…[truncated, document has ${text.length} chars]`
            : text;
          textChunks.push(`---\nAttached document: ${name}\n---\n${clipped}`);
        } else {
          textChunks.push(`[Attached document "${name}" appears to be empty.]`);
        }
      } catch (err) {
        textChunks.push(`[Attached document "${name}" could not be read: ${err.message || 'unknown error'}.]`);
      }
      continue;
    }

    if (mediaType === 'application/msword') {
      // Old binary .doc format isn't readable without an extra parser.
      textChunks.push(`[Attached document "${name}" is in legacy .doc format — please save as .docx or PDF and re-attach.]`);
      continue;
    }
  }

  return {
    imageBlocks,
    documentBlocks,
    extractedText: textChunks.join('\n\n'),
  };
}

/**
 * Standardise the suggestion-chip count to 3-4 across every formatter, so
 * "page-related questions" feels consistent turn-to-turn. Different formatters
 * historically returned 1-4 chips depending on the code path. This pads
 * short lists with sensible fallbacks (context-aware where possible) and
 * caps long ones at 4.
 *
 * @param {string[]|null|undefined} suggestions - Raw chips from the formatter.
 * @param {object} ctx - { intent, pageContext, currentMetric } for fallback selection.
 * @returns {string[]} 3-4 chips, deduped, trimmed.
 */
function normalizeSuggestionChips(suggestions, ctx = {}) {
  const TARGET_MIN = 3;
  const TARGET_MAX = 4;

  // Clean + dedupe the input.
  const seen = new Set();
  const cleaned = [];
  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    if (typeof s !== 'string') continue;
    const trimmed = s.trim();
    if (trimmed.length === 0 || trimmed.length > 80) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }

  if (cleaned.length >= TARGET_MIN) {
    return cleaned.slice(0, TARGET_MAX);
  }

  // Need to pad. Build a contextual fallback pool ordered by relevance to
  // what the user just looked at — current metric first, then page-aware,
  // then generic.
  const metric = String(ctx.currentMetric || '').toLowerCase();
  const tool = String(ctx.intent?.toolName || '').toLowerCase();
  const pagePath = String(ctx.pageContext?.snapshot?.url || ctx.pageContext?.page || '').toLowerCase();

  const pool = [];

  // Metric-specific fallbacks
  if (metric === 'revenue' || tool.includes('revenue') || tool.includes('treatment_revenue')) {
    pool.push('Break down revenue by month', 'Compare with last month', 'Show profit instead');
  } else if (metric === 'profit' || tool.includes('profit')) {
    pool.push('Break down profit by month', 'Compare with last month', 'Show revenue instead');
  } else if (tool.includes('cost') || tool.includes('cashflow')) {
    pool.push('Break down by month', 'Compare with last quarter', 'Show revenue instead');
  } else if (tool.includes('chair')) {
    pool.push('Show by chair', 'Hourly chair usage', 'Chair trends by month');
  } else if (tool.includes('provider') || tool.includes('doctor')) {
    pool.push('Compare providers', 'Top providers by revenue', 'Show profit per provider');
  } else if (tool.includes('location')) {
    pool.push('Compare locations', 'Show chair utilisation by location', 'Show overall profit');
  }

  // Page-aware fallbacks (only fire if pool still short)
  if (pagePath.includes('chair')) {
    pool.push('Which chairs are underutilised?', 'Peak hours for chairs');
  } else if (pagePath.includes('private') || pagePath.includes('treatment')) {
    pool.push('Top treatments by revenue', 'Plan mix with revenue');
  } else if (pagePath.includes('cashflow')) {
    pool.push('Closing balance', 'Cash received this month');
  } else if (pagePath.includes('profit')) {
    pool.push('P&L vs last month', 'Operating expenses breakdown');
  }

  // Generic catch-all so we always reach the minimum
  pool.push(
    'Compare with last month',
    'Show revenue this month',
    'What should I focus on?',
  );

  for (const candidate of pool) {
    if (cleaned.length >= TARGET_MIN) break;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(candidate);
  }

  return cleaned.slice(0, TARGET_MAX);
}

// Run every turn inside a usage-accumulation context so tokenTracker can
// total tokens/cost across the classifier + formatter + insights LLM calls.
function handleMessageWithUsage(req, res, config) {
  return usageContext.run(() => handleMessage(req, res, config));
}

module.exports = { handleMessage: handleMessageWithUsage };
