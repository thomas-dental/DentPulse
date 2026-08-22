const { supabaseAdmin } = require('../../config/supabase');

/**
 * Routes intent to per-tool resolver. Calls Supabase RPCs and returns data + markdown.
 * Phase 0: implements core financial metric resolvers.
 * Later phases add drill-down, forecast, what-if, etc.
 */

/**
 * Postgres aborts a query that exceeds the configured `statement_timeout`
 * with SQLSTATE 57014 / "canceling statement due to statement timeout".
 * Echoing that raw text to a user breaks the "plain business language, no DB
 * jargon" product rule, so detect it and degrade gracefully instead.
 */
function isStatementTimeout(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  if (code === '57014') return true;
  const msg = String(err.message || err).toLowerCase();
  return msg.includes('statement timeout') || msg.includes('canceling statement due to');
}

/**
 * Friendly, actionable response for a DB read that timed out or failed.
 * `what` is a short noun phrase ("revenue", "cost data"). A statement timeout
 * is almost always cured by a narrower query, so the message + chips steer the
 * user to a shorter period / single location. Raw Postgres text is never
 * echoed (product rule: no DB jargon in user-facing copy).
 */
function dbReadFailure(err, what, { period_from, period_to } = {}) {
  if (isStatementTimeout(err)) {
    const range = period_from && period_to ? ` for **${period_from} to ${period_to}**` : '';
    return {
      preformatted: true,
      markdown:
        `The ${what} read took too long${range} and was stopped before it finished. ` +
        `That date range is too wide for the live calculation — try a single month, or one location at a time.`,
      suggestions: ['Profitability this month', 'P&L last month', 'Show revenue instead'],
    };
  }
  return {
    preformatted: true,
    markdown: `I couldn't read ${what} just now — please try again in a moment.`,
    suggestions: ['Try again', 'Show revenue instead'],
  };
}

/**
 * Cursor-paginated fetch of completed TPIs on a payment plan within a date range.
 * Mirrors useTreatmentInsights so chatbot totals match the Insights page exactly.
 * Paginates on tpi_id to avoid Supabase's silent ~1000-row cap.
 */
async function fetchCompletedTpis({ orgId, periodFrom, periodTo, locationId = null, locationIds = null, columns = 'tpi_id, tpi_price', activeProvidersOnly = false }) {
  const PAGE_SIZE = 1000;
  // tpi_id must be in the projection so we can paginate.
  let projection = columns.includes('tpi_id') ? columns : `tpi_id, ${columns}`;

  // Active-provider gate (2026-07 alignment): the Treatment Insights page now
  // counts ACTIVE providers only — same rule as Practitioner History, so the
  // two pages agree (inactive/system accounts like "Provider Sales" were £100
  // above the Practitioner History tile). Opt-in per resolver: mirrors of the
  // Private Treatment page must NOT set this — that page still includes
  // inactive providers' items.
  let activeExtIds = null;
  if (activeProvidersOnly) {
    if (!projection.includes('tpi_practitioner_id')) projection = `${projection}, tpi_practitioner_id`;
    activeExtIds = new Set();
    const { data: provRows, error: provErr } = await supabaseAdmin
      .from('providers')
      .select('external_id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .not('external_id', 'is', null)
      .is('deleted_at', null);
    if (provErr) throw provErr;
    for (const p of provRows || []) {
      const n = Number(p.external_id);
      if (Number.isFinite(n)) activeExtIds.add(n);
    }
  }

  // ── Pass A: direct location match (or unfiltered) ──
  const out = [];
  let cursor = null;
  while (true) {
    let q = supabaseAdmin
      .from('treatment_plan_items')
      .select(projection)
      .eq('organization_id', orgId)
      .eq('tpi_completed', true)
      .not('tpi_payment_plan_id', 'is', null)
      .gte('tpi_completed_at', periodFrom)
      .lte('tpi_completed_at', periodTo + 'T23:59:59')
      .order('tpi_id')
      .limit(PAGE_SIZE);
    if (Array.isArray(locationIds) && locationIds.length > 0) q = q.in('location_id', locationIds);
    else if (locationId) q = q.eq('location_id', locationId);
    if (cursor != null) q = q.gt('tpi_id', cursor);

    const { data: page, error } = await q;
    if (error) throw error;
    if (!page || page.length === 0) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].tpi_id;
  }

  // ── Pass B: patient fallback ──
  // Dentally's Practitioner Activity attributes TPIs with no resolvable site to
  // the patient's registered location. Backend sync resolves ~97% via the
  // appointment chain; the remaining ~3% need this query-time fallback to match
  // Dentally's totals exactly.
  const filterIds = (Array.isArray(locationIds) && locationIds.length > 0)
    ? locationIds
    : (locationId ? [locationId] : null);

  if (filterIds) {
    const projectionWithPatient = projection.includes('tpi_patient_id')
      ? projection
      : `${projection}, tpi_patient_id`;

    // Find legacy_ids (Dentally's patient_id) of patients whose registered
    // location is in the requested set.
    const patientLegacyIds = [];
    let pCursor = null;
    while (true) {
      let pq = supabaseAdmin
        .from('patients')
        .select('legacy_id, id')
        .eq('organization_id', orgId)
        .in('location_id', filterIds)
        .not('legacy_id', 'is', null)
        .order('id')
        .limit(PAGE_SIZE);
      if (pCursor != null) pq = pq.gt('id', pCursor);
      const { data: pPage, error: pErr } = await pq;
      if (pErr) break; // patient fallback is best-effort; don't block the answer
      if (!pPage || pPage.length === 0) break;
      for (const p of pPage) if (p.legacy_id != null) patientLegacyIds.push(Number(p.legacy_id));
      if (pPage.length < PAGE_SIZE) break;
      pCursor = pPage[pPage.length - 1].id;
    }

    if (patientLegacyIds.length > 0) {
      // Pass B fetches TPIs with NULL location_id where the patient is at the
      // requested location. Done in chunks so the IN list doesn't get huge.
      const CHUNK = 500;
      for (let i = 0; i < patientLegacyIds.length; i += CHUNK) {
        const ids = patientLegacyIds.slice(i, i + CHUNK);
        let bCursor = null;
        while (true) {
          let bq = supabaseAdmin
            .from('treatment_plan_items')
            .select(projectionWithPatient)
            .eq('organization_id', orgId)
            .eq('tpi_completed', true)
            .not('tpi_payment_plan_id', 'is', null)
            .is('location_id', null)
            .in('tpi_patient_id', ids)
            .gte('tpi_completed_at', periodFrom)
            .lte('tpi_completed_at', periodTo + 'T23:59:59')
            .order('tpi_id')
            .limit(PAGE_SIZE);
          if (bCursor != null) bq = bq.gt('tpi_id', bCursor);
          const { data: bPage, error: bErr } = await bq;
          if (bErr || !bPage || bPage.length === 0) break;
          for (const row of bPage) {
            // Tag the row with the requested location so downstream aggregation
            // (e.g. revenue-by-day per location) puts it in the right bucket.
            if (row.location_id == null) row.location_id = filterIds[0];
            out.push(row);
          }
          if (bPage.length < PAGE_SIZE) break;
          bCursor = bPage[bPage.length - 1].tpi_id;
        }
      }
    }
  }

  if (activeExtIds) {
    return out.filter(r => r.tpi_practitioner_id != null && activeExtIds.has(Number(r.tpi_practitioner_id)));
  }
  return out;
}

/**
 * Generic keyset-paginated scan past Supabase's ~1000-row cap. `buildQuery`
 * receives a `supabaseAdmin.from(table)` builder and must apply `.select()`
 * (including `cursorCol`) + filters; ordering/limit/cursor are added here.
 * `onRow` is invoked per row. Throws on a Supabase error (callers wrap with
 * dbReadFailure for a friendly message).
 */
async function paginate(table, cursorCol, buildQuery, onRow) {
  const PAGE = 1000;
  let cursor = null;
  while (true) {
    let q = buildQuery(supabaseAdmin.from(table)).order(cursorCol).limit(PAGE);
    if (cursor != null) q = q.gt(cursorCol, cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) onRow(row);
    if (data.length < PAGE) break;
    cursor = data[data.length - 1][cursorCol];
  }
}

async function resolve(intent, organizationId, context) {
  if (intent.refused) {
    return {
      preformatted: true,
      markdown: intent.refusalMessage,
      suggestions: intent.refusalSuggestions || ['Show revenue instead', 'Show profit instead'],
    };
  }

  const resolver = RESOLVERS[intent.toolName];
  if (!resolver) {
    return {
      preformatted: true,
      markdown: `I don't have a data resolver for "${intent.toolName}" yet. This feature is coming soon.`,
      suggestions: ['What can you help with?'],
    };
  }

  try {
    return await resolver(intent.args, organizationId, context);
  } catch (err) {
    console.error(`[CHATBOT-RESOLVE] Error in ${intent.toolName}:`, err.message, err.stack?.split('\n').slice(0, 3).join('\n'));
    // Soft-fail: don't return a hard error to the user. Hand the formatter an
    // isGeneral result so the page-snapshot advisor can still answer (most
    // resolver errors are bad/missing args for strategic questions like
    // "how can I reduce cost and grow profit?" — the classifier picked a
    // data tool but the question is advisory). If no snapshot is available
    // the formatter degrades to the canned greeting.
    return {
      isGeneral: true,
      resolverError: { tool: intent.toolName, message: err.message },
    };
  }
}

// ── Resolver implementations ──

async function resolveLocationName(orgId, locationId) {
  if (!locationId) return null;
  const { data } = await supabaseAdmin
    .from('practice_locations')
    .select('location_name')
    .eq('organization_id', orgId)
    .eq('id', locationId)
    .single();
  return data?.location_name || null;
}

async function resolveFinancialMetric(args, orgId) {
  const { period_from, period_to, doctor_name, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  // Require an explicit metric. The previous silent fall-through to 'revenue'
  // caused unrelated questions (DNA, suggestions, narrative asks) to be
  // returned as a revenue table — confusing the user. Refuse cleanly when
  // we can't tell what they're asking about so the chat surfaces the menu.
  const metricRaw = (args.metric || '').toString().toLowerCase();
  const allowed = ['revenue', 'profit', 'cashflow', 'patients'];
  if (!allowed.includes(metricRaw)) {
    return {
      preformatted: true,
      markdown: `I'm not sure which metric you're asking about. I can show:\n\n` +
        `- **Revenue / production** by provider, treatment or location\n` +
        `- **Profit / P&L** for the practice or a single dentist\n` +
        `- **Cashflow** (cash in / out / closing balance)\n` +
        `- **Patient counts**\n` +
        `- **Chair utilisation**\n` +
        `- **Treatment revenue breakdown**\n` +
        `- **Recommendations** ("suggest", "what should I focus on")\n\n` +
        `Tell me which one you want, or ask using one of those keywords.`,
      suggestions: [
        'Revenue this month',
        'Profit by provider',
        'Cashflow this month',
        'Recommendations',
      ],
    };
  }
  const metric = metricRaw;
  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  if (metric === 'revenue') {
    // Payor-filtered revenue branch — "private revenue", "NHS revenue",
    // "membership revenue". The Production RPC includes ALL payors, so we
    // fetch TPIs directly with the same payor-plan filter the Private
    // Treatment page uses (practice_locations.{payor}_income_accounts), then
    // group by practitioner. This reconciles with the page's "Private
    // Revenue" / "NHS Revenue" cards row-for-row.
    const payorFilter = (args.payor === 'private' || args.payor === 'nhs' || args.payor === 'membership')
      ? args.payor
      : null;
    if (payorFilter) {
      const accountsCol = `${payorFilter}_income_accounts`;
      let locQ = supabaseAdmin
        .from('practice_locations')
        .select(`id, ${accountsCol}`)
        .eq('organization_id', orgId)
        .is('deleted_at', null);
      if (location_id) locQ = locQ.eq('id', location_id);
      if (locationIds && locationIds.length > 0) locQ = locQ.in('id', locationIds);
      const { data: payorLocs } = await locQ;
      const payorPpIds = new Set();
      for (const loc of payorLocs || []) {
        const arr = Array.isArray(loc[accountsCol]) ? loc[accountsCol] : [];
        for (const pid of arr) if (pid != null) payorPpIds.add(String(pid));
      }

      const tpis = await fetchCompletedTpis({
        orgId, periodFrom: period_from, periodTo: period_to,
        locationId: location_id, locationIds,
        columns: 'tpi_price, tpi_practitioner_id, tpi_payment_plan_id',
      });

      const byProvider = new Map();
      for (const t of tpis || []) {
        if (t.tpi_payment_plan_id == null) continue;
        if (payorPpIds.size > 0 && !payorPpIds.has(String(t.tpi_payment_plan_id))) continue;
        const pid = t.tpi_practitioner_id;
        if (pid == null) continue;
        byProvider.set(pid, (byProvider.get(pid) || 0) + parseFloat(t.tpi_price || 0));
      }

      const provIds = Array.from(byProvider.keys());
      const provNameById = new Map();
      if (provIds.length > 0) {
        const { data: provs } = await supabaseAdmin
          .from('providers')
          .select('external_id, name, provider_role')
          .eq('organization_id', orgId)
          .is('deleted_at', null)
          .eq('is_active', true)
          .in('external_id', provIds);
        const wantedType = args.provider_type ? String(args.provider_type).toLowerCase() : null;
        for (const p of provs || []) {
          if (wantedType && !(p.provider_role || '').toLowerCase().includes(wantedType)) continue;
          provNameById.set(p.external_id, p.name);
        }
      }

      let results = Array.from(byProvider.entries())
        .filter(([pid]) => provNameById.has(pid))
        .map(([pid, total]) => ({
          provider_id: String(pid),
          practitioner_id: String(pid),
          provider_name: provNameById.get(pid),
          production_amount: total,
        }));
      results.sort((a, b) => b.production_amount - a.production_amount);
      results = results.map((r, i) => ({ ...r, rank: i + 1 }));
      if (args.sort === 'asc') results = [...results].reverse();
      if (doctor_name) {
        const lower = doctor_name.toLowerCase();
        results = results.filter(r => r.provider_name?.toLowerCase().includes(lower));
      }

      const total = results.reduce((s, r) => s + (r.production_amount || 0), 0);
      const topRaw = parseInt(args.top, 10);
      const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(topRaw, 50) : null;

      return {
        data: results,
        total,
        metric,
        payor: payorFilter,
        sort: args.sort === 'asc' ? 'asc' : 'desc',
        period: { from: period_from, to: period_to },
        doctorName: doctor_name,
        locationId: location_id || null,
        locationName,
        byLocation: null,
        providerType: args.provider_type || null,
        topN,
        totalProviders: results.length,
        preformatted: false,
      };
    }

    // No payor filter — Production-RPC path (matches Production page totals).
    async function fetchProductionForLocation(locId) {
      const { data, error } = await supabaseAdmin.rpc('chart_get_production_metrics', {
        p_start_date: period_from,
        p_end_date: period_to,
        p_organization_id: orgId,
        p_provider_type: args.provider_type || null,
        p_location_id: locId || null,
      });
      if (error) throw error;
      return data || [];
    }

    let rows;
    if (locationIds && locationIds.length > 0) {
      // Multi-site pick: aggregate per-provider across the chosen sites so
      // the combined totals still match each site's RPC output.
      const agg = new Map();
      for (const locId of locationIds) {
        const r = await fetchProductionForLocation(locId);
        for (const p of r) {
          const key = p.provider_id || p.provider_name;
          if (!agg.has(key)) agg.set(key, { ...p, production_amount: 0 });
          const cur = agg.get(key);
          cur.production_amount = parseFloat(cur.production_amount || 0) + parseFloat(p.production_amount || 0);
        }
      }
      rows = Array.from(agg.values());
    } else {
      rows = await fetchProductionForLocation(location_id || null);
    }

    let results = rows.map(r => ({
      provider_name: r.provider_name,
      production_amount: parseFloat(r.production_amount || 0),
      provider_id: r.provider_id,
      practitioner_id: r.provider_id,
    }));

    results.sort((a, b) => b.production_amount - a.production_amount);
    results = results.map((r, i) => ({ ...r, rank: i + 1 }));
    if (args.sort === 'asc') {
      results = [...results].reverse();
    }

    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      results = results.filter(r => r.provider_name?.toLowerCase().includes(lower));
    }

    const totalProviders = results.length;
    let total = results.reduce((s, r) => s + (r.production_amount || 0), 0);

    // Per-location subtotals — only when the user picked multiple sites.
    let byLocation = null;
    if (locationIds && locationIds.length > 1) {
      const { data: locRows } = await supabaseAdmin
        .from('practice_locations')
        .select('id, location_name')
        .eq('organization_id', orgId)
        .in('id', locationIds);
      const nameByLocId = new Map((locRows || []).map(l => [l.id, l.location_name]));

      byLocation = [];
      for (const locId of locationIds) {
        const locRowsForSite = await fetchProductionForLocation(locId);
        const locTotal = locRowsForSite.reduce((s, p) => s + parseFloat(p.production_amount || 0), 0);
        byLocation.push({
          location_id: locId,
          location_name: nameByLocId.get(locId) || 'Unknown',
          total: locTotal,
        });
      }
      byLocation.sort((a, b) => b.total - a.total);
    }

    // Honor explicit "top N" so the formatter can slice cleanly. We keep the
    // full results array on `data` (with `topN`/`totalProviders` so the
    // formatter renders the slice and a "Showing top N of M" note).
    const topRaw = parseInt(args.top, 10);
    const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(topRaw, 50) : null;

    return {
      data: results,
      total,
      metric,
      payor: null,
      sort: args.sort === 'asc' ? 'asc' : 'desc',
      period: { from: period_from, to: period_to },
      doctorName: doctor_name,
      locationId: location_id || null,
      locationName,
      byLocation,
      providerType: args.provider_type || null,
      topN,
      totalProviders,
      preformatted: false,
    };
  }

  if (metric === 'profit') {
    const { data, error } = await supabaseAdmin.rpc('chart_get_profit_metrics', {
      p_start_date: period_from,
      p_end_date: period_to,
      p_organization_id: orgId,
      p_provider_type: args.provider_type || null,
      p_location_id: location_id || null,
    });

    if (error) throw error;

    let results = data || [];
    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      results = results.filter(r => r.provider_name?.toLowerCase().includes(lower));
    }
    const total = results.reduce((sum, r) => sum + parseFloat(r.periodic_profit || 0), 0);

    const topRaw = parseInt(args.top, 10);
    const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(topRaw, 50) : null;

    return {
      data: results,
      total,
      metric,
      period: { from: period_from, to: period_to },
      doctorName: doctor_name,
      locationId: location_id || null,
      locationName,
      providerType: args.provider_type || null,
      topN,
      totalProviders: results.length,
      preformatted: false,
    };
  }

  if (metric === 'patients') {
    const { data, error } = await supabaseAdmin.rpc('get_total_distinct_patients', {
      p_organization_id: orgId,
      p_start_date: period_from,
      p_end_date: period_to,
      p_provider_type: null,
      p_location_id: location_id || null,
    });

    if (error) throw error;

    return {
      data,
      total: data?.[0]?.count || data || 0,
      metric,
      period: { from: period_from, to: period_to },
      locationId: location_id || null,
      locationName,
      preformatted: false,
    };
  }

  return { data: null, total: 0, metric, locationName, preformatted: false };
}

// Same column-key parser as the monthly cashflow path uses ("May-26" → year/month).
const CASHFLOW_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseCashflowColumnKey(key) {
  const parts = (key || '').split('-');
  if (parts.length !== 2) return null;
  const monthIdx = CASHFLOW_MONTH_ABBR.indexOf(parts[0]);
  if (monthIdx < 0) return null;
  const yy = parseInt(parts[1], 10);
  if (!Number.isFinite(yy)) return null;
  return { year: yy < 100 ? 2000 + yy : yy, month: monthIdx };
}

/**
 * Resolve closing/opening cash balance from the same `cashflow-report` edge
 * function the Statement of Cash Flows page uses, so the chatbot's number
 * matches what the user sees on screen.
 *
 * Strategy: ask the edge function for the standard window (today − 210 days
 * → today), then pick the column whose month/year matches the user's
 * period_to (defaults to current month). Closing Balance in `totalRowDataSet`
 * is already a running cumulative value, so the chosen column is the answer.
 */
async function resolveCashBalance(args, orgId, context) {
  const { period_to, location_id } = args;
  const userJwt = context?.userAccessToken;
  if (!userJwt) {
    return {
      data: null,
      metric: 'cashflow',
      period: { from: args.period_from, to: period_to },
      preformatted: true,
      markdown: `Couldn't fetch the cash balance — your session token wasn't forwarded to the chatbot. Please refresh the page and try again.`,
      suggestions: ['Show cashflow this month', 'Try again'],
    };
  }

  // Match the Statement of Cash Flows page default window (anchored at
  // today − 210 days). The edge function builds month columns inside this
  // range; we'll pick the column matching the user's period_to.
  const today = new Date();
  const fromDate = new Date(today.getTime() - 210 * 86400000).toISOString().split('T')[0];
  const toDate = today.toISOString().split('T')[0];
  const reqBody = { organizationId: orgId, fromDate, toDate, locationId: location_id || null };

  let report = null;
  try {
    const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/cashflow-report`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    let res, text;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userJwt}`,
          'apikey': process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify(reqBody),
        signal: ac.signal,
      });
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.error('[CHATBOT-RESOLVE] cashflow-report (balance) failed:', res.status, text.slice(0, 500));
      return {
        data: null, metric: 'cashflow',
        period: { from: fromDate, to: toDate },
        preformatted: true,
        markdown: res.status === 401
          ? `The cashflow service rejected this request (401). Try logging out and back in to refresh your session.`
          : `Couldn't fetch the cash balance (HTTP ${res.status}).`,
        suggestions: ['Show cashflow this month', 'Try again'],
      };
    }
    try { report = JSON.parse(text); } catch { report = null; }
  } catch (fetchErr) {
    console.error('[CHATBOT-RESOLVE] cashflow-report (balance) threw:', fetchErr?.message || fetchErr);
    return {
      data: null, metric: 'cashflow',
      period: { from: fromDate, to: toDate },
      preformatted: true,
      markdown: fetchErr?.name === 'AbortError'
        ? `The cashflow report service didn't respond in time. Please try again in a few seconds.`
        : `Couldn't reach the cashflow report service. (${fetchErr?.message || 'unknown error'})`,
      suggestions: ['Show cashflow this month', 'Try again'],
    };
  }

  const vm = report?.returnObject || null;
  if (!vm || !Array.isArray(vm.columns) || vm.columns.length === 0) {
    return {
      data: null, metric: 'cashflow',
      period: { from: fromDate, to: toDate },
      preformatted: true,
      markdown: `No cash balance data available yet. Cash balance is computed from synced bank transactions — check the Sync Summary page.`,
      suggestions: ['Show cashflow this month', 'Sync status'],
    };
  }

  const findRow = (name) => (vm.totalRowDataSet || []).find((r) => r.name === name);
  const closingRow = findRow('Closing Balance');
  const openingRow = findRow('Opening Balance');
  const netRow = findRow('Net Cashflow');

  // Pick the column matching the user's period_to month, falling back to the
  // most recent month in the report (which is `today`'s month).
  let targetIdx = vm.columns.length - 1;
  let targetLabel = vm.columns[targetIdx];
  if (period_to) {
    const t = new Date(period_to + 'T00:00:00');
    const targetYear = t.getFullYear();
    const targetMonth = t.getMonth();
    for (let i = 0; i < vm.columns.length; i++) {
      const col = parseCashflowColumnKey(vm.columns[i]);
      if (col && col.year === targetYear && col.month === targetMonth) {
        targetIdx = i;
        targetLabel = vm.columns[i];
        break;
      }
    }
  }

  const num = (v) => Number(v) || 0;
  const closing = num(closingRow?.colData?.[targetIdx]?.value);
  const opening = num(openingRow?.colData?.[targetIdx]?.value);
  const net = num(netRow?.colData?.[targetIdx]?.value);

  // Use the target column's month boundaries as the displayed "as of" date so
  // the card period matches the column the user asked about.
  const colParsed = parseCashflowColumnKey(targetLabel);
  const periodFromOut = colParsed
    ? new Date(colParsed.year, colParsed.month, 1).toISOString().split('T')[0]
    : fromDate;
  const periodToOut = colParsed
    ? new Date(colParsed.year, colParsed.month + 1, 0).toISOString().split('T')[0]
    : toDate;

  return {
    data: {
      closing_this: closing,
      opening_this: opening,
      net_this: net,
      received_this: 0,
      paid_this: 0,
    },
    metric: 'cashflow',
    period: { from: periodFromOut, to: periodToOut },
    preformatted: false,
  };
}

async function resolveCashflow(args, orgId, context) {
  const { period_from, period_to, location_id } = args;

  // Balance queries ("what is the closing balance of this month") need to
  // reconcile with the Statement of Cash Flows page. That page calls the
  // `cashflow-report` edge function with fromDate=today−210d, toDate=today
  // and computes a running cumulative balance month by month — the RPC
  // get_cashflow_overview_weekly anchors at period_to and returns 0 for the
  // current month before any inflows post.
  if (args.metric === 'balance') {
    return resolveCashBalance(args, orgId, context);
  }

  // Resolve location → xero tenant ids when scoped, exactly like the Cashflow page.
  let tenantIds = null;
  if (location_id) {
    const { data: mappingRows } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id')
      .eq('organization_id', orgId)
      .eq('location_id', location_id);
    const set = new Set();
    for (const row of mappingRows || []) {
      if (row.platform_integration_organizations_id) set.add(row.platform_integration_organizations_id);
    }
    tenantIds = Array.from(set);
    if (tenantIds.length === 0) {
      return {
        data: { received_this: 0, paid_this: 0, net_this: 0 },
        metric: 'cashflow',
        period: { from: period_from, to: period_to },
        preformatted: false,
      };
    }
  }

  // Compute "last" range as the period immediately before "this" so trend math works.
  const startD = new Date(period_from + 'T00:00:00');
  const endD = new Date(period_to + 'T00:00:00');
  const periodMs = endD.getTime() - startD.getTime();
  const lastStartD = new Date(startD.getTime() - periodMs - 86400000);
  const lastEndD = new Date(startD.getTime() - 86400000);
  const toIso = (d) => d.toISOString().split('T')[0];

  const { data, error } = await supabaseAdmin.rpc('get_cashflow_overview_weekly', {
    p_organization_id: orgId,
    p_tenant_ids: tenantIds,                       // null = unfiltered (frontend convention)
    p_anchor_date: period_to || toIso(new Date()),
    p_this_start: period_from,
    p_this_end: period_to,
    p_last_start: toIso(lastStartD),
    p_last_end: toIso(lastEndD),
  });

  if (error) {
    console.error('[CHATBOT-RESOLVE] Cashflow RPC error:', error.message);
    return { data: null, metric: 'cashflow', preformatted: false };
  }

  return {
    data: data?.[0] || data,
    metric: 'cashflow',
    period: { from: period_from, to: period_to },
    preformatted: false,
  };
}

/**
 * Classify a treatment into a clinical category by matching keywords in its
 * name. Used as a guaranteed fallback when the DB-side category_id chain
 * yields no result. Order matters — earlier rules win on first match.
 */
function inferCategoryFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const n = name.toLowerCase();
  const rules = [
    { test: /(implant|abutment|all[- ]on[- ]4|all[- ]on[- ]six)/i, cat: 'Implants' },
    { test: /(invisalign|aligner|\bbrace\b|orthodont|retainer|\bortho\b|study\s*cast)/i, cat: 'Orthodontics' },
    { test: /(root\s*canal|\brct\b|endodont|pulpotomy|pulpectomy)/i, cat: 'Endodontics' },
    { test: /(crown|bridge|denture|veneer|inlay|onlay|prosthe|special\s*tray|recement)/i, cat: 'Prosthodontics' },
    { test: /(filling|composite|amalgam|resin|restorat|biodentine|glass\s*ionomer|\bmta\b|temporary\s*dress|dressing|liner|pulp\s*cap)/i, cat: 'Restorative' },
    { test: /(extract|surgical|wisdom|surgery|maxillo|suture|biopsy|frenect)/i, cat: 'Oral & Maxillofacial' },
    { test: /(periodont|hygien|scale|polish|\bgbt\b|biofilm|cleaning|\bgum\b|stone|debride|airflow)/i, cat: 'Periodontics' },
    { test: /(whiten|bleach|enlighten|cosmetic)/i, cat: 'Cosmetic' },
    { test: /(child|paediatric|pediatric|fissure\s*seal|fluoride)/i, cat: 'Paediatric' },
    { test: /(exam(ination)?|recall|consult|assess|review|check[- ]?up)/i, cat: 'Diagnostic' },
    { test: /(bitewing|periapical|panoram|x[- ]?ray|radiograph|cbct|itero|scan|impression|study\s*model)/i, cat: 'Diagnostic' },
    { test: /(emergency|urgent|trauma|pain)/i, cat: 'Emergency' },
    { test: /(note|admin|fee|refund|adjust|deposit|sundry|turnaround|missed|\bdna\b|cancellation)/i, cat: 'Other' },
  ];
  for (const r of rules) {
    if (r.test.test(n)) return r.cat;
  }
  return null;
}

async function resolveRevenueBreakdown(args, orgId) {
  const { period_from, period_to, location_id } = args;
  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'I need a date range to break down revenue. Try "this month", "last month", or specific dates like "April 2026".',
      suggestions: ['This month', 'Last month', 'Last quarter', 'This year'],
    };
  }
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  // Pull ALL treatments with their category joined inline via the FK
  // relationship. Use multiple selector forms so we capture the category name
  // whatever PostgREST decides the relationship key is. The nested select
  // returns the joined category as an object/array depending on cardinality.
  const treatNameByExtId = new Map();    // Number(external_id) → treatment_name
  const categoryByExtId = new Map();     // Number(external_id) → category name
  let _treatCount = 0;
  let _treatWithCat = 0;
  let _treatWithCatId = 0;
  {
    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('treatments')
        .select('id, external_id, category_id, treatment_name, treatment_categories(id, name)')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('id', cursor);
      const { data: page, error: trErr } = await q;
      if (trErr) {
        console.error('[CHATBOT-RESOLVE] treatments fetch failed:', trErr.message);
        break;
      }
      if (!page || page.length === 0) break;
      _treatCount += page.length;
      for (const t of page) {
        if (t.external_id == null) continue;
        const extId = Number(t.external_id);
        if (!Number.isFinite(extId)) continue;

        if (t.treatment_name && !treatNameByExtId.has(extId)) {
          treatNameByExtId.set(extId, t.treatment_name);
        }

        if (t.category_id) _treatWithCatId++;

        // Use the joined category_id → treatment_categories.name only (no
        // keyword inference / denormalised-string fallback). Matches the
        // page's resolution exactly so the breakdown reconciles row-for-row.
        let joinedName = null;
        const joined = t.treatment_categories;
        if (Array.isArray(joined) && joined.length > 0) joinedName = joined[0]?.name || null;
        else if (joined && typeof joined === 'object') joinedName = joined.name || null;

        if (joinedName && !categoryByExtId.has(extId)) {
          categoryByExtId.set(extId, joinedName);
        }
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
    _treatWithCat = categoryByExtId.size;
    console.log(`[CHATBOT-RESOLVE] revenue_breakdown: ${_treatCount} treatments, ${_treatWithCatId} have category_id, ${_treatWithCat} resolved category name`);
  }

  // Single TPI fetch covers all three breakdowns.
  const tpis = await fetchCompletedTpis({
    orgId, periodFrom: period_from, periodTo: period_to,
    locationId: location_id, locationIds,
    columns: 'tpi_price, tpi_practitioner_id, tpi_treatment_id, tpi_patient_nomenclature',
    activeProvidersOnly: true, // Treatment Insights page rule (aligned with Practitioner History)
  });

  // Aggregate. Treatment display name comes from treatments.treatment_name
  // (Dentally's authoritative name); fall back to tpi_patient_nomenclature
  // (the chairside name) and finally to a placeholder.
  // Category resolution priority:
  //   1. category_id → treatment_categories.name (DB join)
  //   2. treatments.treatment_category (denormalised string)
  //   3. Keyword-based inference from the treatment name
  //   4. 'Uncategorised'
  let total = 0;
  const byProvider = new Map();
  const byTreatmentName = new Map();        // displayName → revenue
  const categoryByName = new Map();          // displayName → category
  for (const t of tpis) {
    const price = parseFloat(t.tpi_price || 0);
    total += price;
    const pid = t.tpi_practitioner_id;
    if (pid != null) byProvider.set(pid, (byProvider.get(pid) || 0) + price);

    const extId = t.tpi_treatment_id != null ? Number(t.tpi_treatment_id) : null;
    const officialName = extId != null ? treatNameByExtId.get(extId) : null;
    const nomenclature = (t.tpi_patient_nomenclature && String(t.tpi_patient_nomenclature).trim()) || null;
    const displayName = officialName
      || nomenclature
      || (extId != null ? `Treatment ${extId}` : 'Unknown Treatment');
    byTreatmentName.set(displayName, (byTreatmentName.get(displayName) || 0) + price);

    if (!categoryByName.has(displayName)) {
      // Match the page's category resolution exactly — category_id only, no
      // keyword inference. Inference produced standard dental categories
      // (Prosthodontics / Restorative / etc.) that didn't reconcile with the
      // practice's custom-named categories shown on the Private Treatment
      // and Treatment Insights pages.
      const dbCategory = extId != null ? categoryByExtId.get(extId) : null;
      categoryByName.set(displayName, dbCategory || 'Uncategorised');
    }
  }

  // Look up provider names.
  const provIds = Array.from(byProvider.keys());
  const provNameById = new Map();
  if (provIds.length > 0) {
    const { data: provs } = await supabaseAdmin
      .from('providers')
      .select('external_id, name')
      .eq('organization_id', orgId)
      .in('external_id', provIds);
    for (const p of provs || []) provNameById.set(p.external_id, p.name);
  }

  const treatmentRows = Array.from(byTreatmentName.entries())
    .map(([name, revenue]) => ({
      name,
      category: categoryByName.get(name) || 'Uncategorised',
      revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const byCategory = new Map();
  for (const r of treatmentRows) {
    byCategory.set(r.category, (byCategory.get(r.category) || 0) + r.revenue);
  }

  const providerRows = Array.from(byProvider.entries())
    .map(([id, revenue]) => ({ practitioner_id: id, name: provNameById.get(id) || `Provider ${id}`, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const categoryRows = Array.from(byCategory.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    metric: 'revenue_breakdown',
    period: { from: period_from, to: period_to },
    total,
    locationId: location_id || null,
    locationName,
    providers: providerRows,
    treatments: treatmentRows,
    categories: categoryRows,
    preformatted: false,
  };
}

async function resolveChairMetrics(args, orgId, context = {}) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;

  // ── Page-snapshot fast path ───────────────────────────────────────────────
  // When the user is on /chairs the page already computed every metric the
  // chatbot would otherwise re-derive from the RPC (peakHours, ranked
  // chairs, practitioner stats, location rollups, benchmarks). Use that
  // data so the chatbot's numbers MATCH the page exactly — same filter,
  // same period, same location scope. The RPC fallback below only fires
  // when we're not on the chair page.
  //
  // SKIP the fast path when the user explicitly asked for "all locations" —
  // the page's rows.locations is already filtered to the topbar location,
  // so reading from it would silently return one site when the user asked
  // for every site. The RPC fallback below covers every location.
  const pageCtx = context && context.pageContext;
  const isOnChairsPage = pageCtx && pageCtx.page === 'chairs' && pageCtx.data;
  const wantsAllLocations = args._scopeAllLocations === true;
  if (isOnChairsPage && !wantsAllLocations) {
    const d = pageCtx.data;
    const locationRows = Array.isArray(d.rows?.locations) ? d.rows.locations : [];
    // Field names mirror src/pages/Chairs.tsx → locationRows shape exactly:
    //   { location, chairs, occupancyPct, utilisationPct, revenuePerChair, trendPct, benchmarkOccupancy }
    // Earlier assumed snake_case keys (location_name, chairs_count, …) and
    // the formatter rendered "Unknown / 0 / 0.0%" because those reads were
    // all undefined.
    return {
      data: locationRows.map(r => ({
        location_id: r.location_id || null,
        location_name: r.location || r.location_name || r.name || 'Unknown',
        chairs_count: r.chairs ?? r.chairs_count ?? r.numberOfChairs ?? 0,
        completed_hours: r.completedHours ?? r.completed_hours ?? null,
        available_hours: r.availableHours ?? r.available_hours ?? null,
        occupancy_pct: r.occupancyPct ?? r.occupancy_pct ?? r.occupancy ?? null,
        utilisation_pct: r.utilisationPct ?? r.utilisation_pct ?? r.utilisation ?? null,
        revenue: r.revenue ?? null,
        revenue_per_chair: r.revenuePerChair ?? r.revenue_per_chair ?? null,
        trend_pct: r.trendPct ?? r.trend_pct ?? null,
        benchmark_occupancy: r.benchmarkOccupancy ?? r.benchmark_occupancy ?? d.benchmarkOccupancy ?? null,
        benchmark_revenue_per_chair_per_hour: r.benchmark_revenue_per_chair_per_hour ?? d.benchmarkRevPerHour ?? null,
      })),
      metric: 'chairs',
      period: d.period || { from: period_from, to: period_to },
      // Surface the rest of the page's chair payload so the formatter can
      // render hourly heatmap / practitioner table / rankings when the
      // user asks about them ("peak hours", "underutilised", "top
      // practitioners").
      pageSummary: {
        totalChairs: d.totalChairs,
        avgOccupancy: d.avgOccupancy,
        avgUtilisation: d.avgUtilisation,
        avgRevenuePerChair: d.avgRevenuePerChair,
        peakHours: d.peakHours,
        lowUtilisationHours: d.lowUtilisationHours,
        selectedLocationName: d.selectedLocationName,
        benchmarkOccupancy: d.benchmarkOccupancy,
        benchmarkRevPerHour: d.benchmarkRevPerHour,
      },
      practitioners: Array.isArray(d.rows?.practitioners) ? d.rows.practitioners : null,
      hourly: Array.isArray(d.rows?.hourly) ? d.rows.hourly : null,
      rankings: d.rankings || null,
      source: 'page',
      preformatted: false,
    };
  }

  // ── RPC fallback (other pages) ───────────────────────────────────────────
  const prevStart = new Date(period_from);
  const prevEnd = new Date(period_to);
  const diffDays = (prevEnd - prevStart) / (1000 * 60 * 60 * 24);
  prevStart.setDate(prevStart.getDate() - diffDays);
  prevEnd.setDate(prevEnd.getDate() - diffDays);

  const { data, error } = await supabaseAdmin.rpc('get_chair_metrics', {
    _organization_id: orgId,
    _start_date: period_from,
    _end_date: period_to,
    _prev_start_date: prevStart.toISOString().split('T')[0],
    _prev_end_date: prevEnd.toISOString().split('T')[0],
  });

  if (error) throw error;

  // The RPC returns one row per location for the whole org. Post-filter
  // when the user named a specific location (the RPC has no location
  // parameter), otherwise the chatbot would return totals across every
  // site even when the user asked about one.
  let rows = Array.isArray(data) ? data : [];
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    const set = new Set(locationIds.map(String));
    rows = rows.filter(r => set.has(String(r.location_id)));
  } else if (location_id) {
    rows = rows.filter(r => String(r.location_id) === String(location_id));
  }

  return {
    data: rows,
    metric: 'chairs',
    period: { from: period_from, to: period_to },
    source: 'rpc',
    preformatted: false,
  };
}

async function resolveTreatmentRevenue(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const dimension = args.dimension === 'treatment' ? 'treatment' : 'category';
  const sortAsc = args.sort === 'asc';

  const locationName = locationIds && locationIds.length > 0
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  // Match the page exactly (usePrivateTreatmentData.ts:275-315) so the
  // chatbot's categories reconcile with the page's "Revenue by Treatment Type"
  // chart. The page filters categories + treatments to active + not-deleted
  // and never falls back to keyword inference — treatments without a resolved
  // category_id are shown as "Uncategorised". Anything looser here produces
  // numbers that match the page's total but bucket revenue differently, which
  // is the worse failure mode (user can't reconcile the breakdown).
  const categoryNameById = new Map();
  {
    const { data: cats, error: catErr } = await supabaseAdmin
      .from('treatment_categories')
      .select('id, name')
      .eq('organization_id', orgId)
      .is('deleted_at', null);
    if (catErr) {
      console.error('[CHATBOT-RESOLVE] treatment_categories fetch failed:', catErr.message);
    }
    for (const c of cats || []) {
      if (c?.id && c?.name) categoryNameById.set(String(c.id), c.name);
    }
  }

  const treatNameByExtId = new Map();
  const categoryByExtId = new Map();
  let _stats_tFromMap = 0;
  let _stats_tNoCategory = 0;
  {
    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('treatments')
        .select('id, external_id, category_id, treatment_name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('id', cursor);
      const { data: page, error } = await q;
      if (error) {
        console.error('[CHATBOT-RESOLVE] treatment_revenue treatments fetch failed:', error.message);
        break;
      }
      if (!page || page.length === 0) break;
      for (const t of page) {
        if (t.external_id == null) continue;
        const extId = String(t.external_id);
        if (t.treatment_name && !treatNameByExtId.has(extId)) {
          treatNameByExtId.set(extId, t.treatment_name);
        }
        const fromCategoryId = t.category_id ? categoryNameById.get(String(t.category_id)) : null;
        if (fromCategoryId && !categoryByExtId.has(extId)) {
          categoryByExtId.set(extId, fromCategoryId);
          _stats_tFromMap++;
        } else if (!fromCategoryId) {
          _stats_tNoCategory++;
        }
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
    console.log(`[CHATBOT-RESOLVE] treatment_revenue: ${categoryByExtId.size} treatments mapped via category_id; ${_stats_tNoCategory} treatments had no category_id (→ Uncategorised).`);
  }

  // Include tpi_payment_plan_id so we can filter by payor (private/nhs/
  // membership) after fetch. Each location stores per-payor pp_id arrays
  // in practice_locations.{private,nhs,membership}_income_accounts.
  //
  // Include tpi_treatment_appointment_id so we can match the page's "units"
  // definition: revenue sums ALL TPIs, but volume/units only counts TPIs
  // linked to an appointment (taId > 0) — charting entries, manual price
  // adjustments, and fee lines all have taId = 0 and must be excluded from
  // the count. Without this the chatbot's volume is inflated relative to
  // the page's "Treatment Units" card and the Ranking table's "Units"
  // column.
  const tpis = await fetchCompletedTpis({
    orgId, periodFrom: period_from, periodTo: period_to,
    locationId: location_id, locationIds,
    columns: 'tpi_price, tpi_treatment_id, tpi_patient_nomenclature, tpi_payment_plan_id, tpi_treatment_appointment_id',
    activeProvidersOnly: true, // Treatment Insights page rule (aligned with Practitioner History)
  });

  // Payor filter — when the classifier stamped private/nhs/membership, only
  // include TPIs whose payment_plan_id is in the location's matching pp_id
  // array. Without this, "top private treatments" returns a mix that
  // doesn't reconcile with the page's £74,214.51 Private Revenue figure.
  let payorPpIds = null;
  if (args.payor === 'private' || args.payor === 'nhs' || args.payor === 'membership') {
    const accountsCol = `${args.payor}_income_accounts`;
    let locQ = supabaseAdmin
      .from('practice_locations')
      .select(`id, ${accountsCol}`)
      .eq('organization_id', orgId)
      .is('deleted_at', null);
    if (location_id) locQ = locQ.eq('id', location_id);
    if (locationIds && locationIds.length > 0) locQ = locQ.in('id', locationIds);
    const { data: payorLocs } = await locQ;
    payorPpIds = new Set();
    for (const loc of payorLocs || []) {
      const arr = Array.isArray(loc[accountsCol]) ? loc[accountsCol] : [];
      for (const pid of arr) if (pid != null) payorPpIds.add(String(pid));
    }
    if (payorPpIds.size === 0) {
      // No payment plans configured for this payor at this location.
      return {
        preformatted: true,
        markdown:
          `### ${args.payor.charAt(0).toUpperCase() + args.payor.slice(1)} treatments — ${locationName}\n` +
          `**Period:** ${period_from} to ${period_to}\n\n` +
          `_No ${args.payor} payment plans are configured at this location._\n\n` +
          `Set them up in **Settings → Income Type Mapping** so I can filter to ${args.payor} treatments.`,
        suggestions: ['Show all treatments instead', `Show ${args.payor === 'private' ? 'NHS' : 'private'} treatments`],
      };
    }
  }
  const filteredTpis = payorPpIds
    ? (tpis || []).filter(t => t.tpi_payment_plan_id != null && payorPpIds.has(String(t.tpi_payment_plan_id)))
    : tpis;

  // Category resolution — matches the page exactly:
  //   1. category_id → treatment_categories.name (active + not-deleted)
  //   2. 'Uncategorised' otherwise
  // No keyword inference — that produced standard dental categories
  // (Prosthodontics / Restorative / etc.) that didn't match the practice's
  // custom-named categories shown on the page.
  let _stats_catFromMap = 0;
  let _stats_catUncategorised = 0;
  const resolveCategory = (extId) => {
    if (extId != null) {
      const fromMap = categoryByExtId.get(extId);
      if (fromMap) { _stats_catFromMap++; return fromMap; }
    }
    _stats_catUncategorised++;
    return 'Uncategorised';
  };

  const buckets = {};
  for (const item of filteredTpis || []) {
    const extId = item.tpi_treatment_id != null ? String(item.tpi_treatment_id) : null;
    const officialName = extId != null ? treatNameByExtId.get(extId) : null;
    const nomenclature = (item.tpi_patient_nomenclature && String(item.tpi_patient_nomenclature).trim()) || null;
    const displayName = officialName
      || nomenclature
      || (extId != null ? `Treatment ${extId}` : 'Unknown Treatment');

    const key = dimension === 'treatment'
      ? displayName
      : resolveCategory(extId);

    if (!buckets[key]) {
      buckets[key] = dimension === 'treatment'
        ? { treatment: key, category: resolveCategory(extId), revenue: 0, count: 0 }
        : { category: key, revenue: 0, count: 0 };
    }
    buckets[key].revenue += parseFloat(item.tpi_price || 0);
    // Volume counts only actual treatment units (linked to an appointment),
    // matching the page's "Units" column. Charting entries / fee lines /
    // adjustments all have tpi_treatment_appointment_id = 0 and are
    // excluded from the count but still included in revenue.
    const taId = Number(item.tpi_treatment_appointment_id || 0);
    if (taId > 0) buckets[key].count += 1;
  }
  console.log(`[CHATBOT-RESOLVE] treatment_revenue: map=${_stats_catFromMap} uncategorised=${_stats_catUncategorised}.`);

  // Drop zero-revenue rows so "lowest" doesn't surface free/charting items
  // that round to £0.00.
  const rows = Object.values(buckets).filter(r => Math.abs(r.revenue) >= 0.01);
  rows.sort((a, b) => sortAsc ? a.revenue - b.revenue : b.revenue - a.revenue);

  return {
    data: rows,
    metric: 'treatment_revenue',
    dimension,
    sort: sortAsc ? 'asc' : 'desc',
    period: { from: period_from, to: period_to },
    // Propagate the source of the period (page-filter, user-explicit, etc.)
    // so the formatter can add a clarifying line — "using the date from this
    // page" — when the bot inherited it silently rather than the user
    // typing it.
    periodSource: args._periodSource || null,
    payor: args.payor || null,
    locationId: location_id || null,
    locationIds: locationIds || null,
    locationName,
    preformatted: false,
  };
}

async function resolveLocationMetrics(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  // Payor filter — when the user is asking from a payor-scoped page (Private
  // Treatment / NHS / Membership) we want the per-location revenue to reflect
  // ONLY that payor's TPIs. Otherwise the numbers don't reconcile with the
  // page's "Private Revenue" card (e.g. £78,365 on Private Treatment vs the
  // resolver returning £38,000 of total revenue for the same location +
  // period).
  const payor = args.payor === 'private' || args.payor === 'nhs' || args.payor === 'membership'
    ? args.payor
    : null;

  // Get locations (scoped if specific locations were requested).
  let locQuery = supabaseAdmin
    .from('practice_locations')
    .select(`id, location_name${payor ? `, ${payor}_income_accounts` : ''}`)
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (locationIds && locationIds.length > 0) locQuery = locQuery.in('id', locationIds);
  else if (location_id) locQuery = locQuery.eq('id', location_id);
  const { data: locations } = await locQuery;

  // When payor-scoped, build the set of payment-plan IDs that count as that
  // payor at each location (same approach as the Private Treatment page).
  const payorPpIdsByLocation = new Map(); // location_id → Set of pp_ids
  const allPayorPpIds = new Set();        // union across all in-scope locations
  if (payor) {
    const col = `${payor}_income_accounts`;
    for (const loc of locations || []) {
      const arr = Array.isArray(loc[col]) ? loc[col] : [];
      const set = new Set();
      for (const id of arr) if (id != null) {
        set.add(String(id));
        allPayorPpIds.add(String(id));
      }
      payorPpIdsByLocation.set(loc.id, set);
    }
  }

  // Match Treatment Insights / Private Treatment definition. When payor-
  // scoped we also pull tpi_payment_plan_id so we can post-filter.
  const tpis = await fetchCompletedTpis({
    orgId, periodFrom: period_from, periodTo: period_to,
    locationId: location_id, locationIds,
    columns: payor
      ? 'tpi_price, location_id, tpi_payment_plan_id'
      : 'tpi_price, location_id',
  });

  const revenueByLocation = {};
  for (const item of tpis) {
    if (payor) {
      const pp = item.tpi_payment_plan_id;
      if (pp == null) continue;
      // Allow either the location-specific pp_id set OR the union (covers
      // TPIs whose location_id is NULL — they get assigned to whichever
      // location's payor list matches the pp_id).
      if (!allPayorPpIds.has(String(pp))) continue;
    }
    const locId = item.location_id || 'unknown';
    revenueByLocation[locId] = (revenueByLocation[locId] || 0) + parseFloat(item.tpi_price || 0);
  }

  const results = (locations || []).map(loc => ({
    location_id: loc.id,
    location_name: loc.location_name,
    revenue: revenueByLocation[loc.id] || 0,
  })).sort((a, b) => b.revenue - a.revenue);

  return {
    data: results,
    metric: 'locations',
    payor,
    period: { from: period_from, to: period_to },
    periodSource: args._periodSource || null,
    preformatted: false,
  };
}

// Cost buckets configured per location on practice_locations. Column names
// match the actual DB schema (singular "cost" / plural "costs" is mixed —
// see information_schema; verified against a live row).
const COST_BUCKETS = [
  { key: 'staff_costs_accounts',     label: 'Staff costs' },
  { key: 'clinician_cost_accounts',  label: 'Clinician costs' },
  { key: 'lab_fees_accounts',        label: 'Lab fees' },
  { key: 'material_cost_accounts',   label: 'Material costs' },
  { key: 'operating_lease_accounts', label: 'Operating leases' },
  { key: 'overhead_cost_accounts',   label: 'Overheads' },
  { key: 'administrative_cost_accounts', label: 'Administrative costs' },
  { key: 'cost_of_sales_accounts',   label: 'Cost of sales' },
];

// Detect which accounting integration this org uses. Returns 'xero',
// 'iplicit', or null. Determines which COA + journal tables we read from.
// ── Cost-resolver caches ─────────────────────────────────────────────────────
// The first three queries of every cost-related question are the same within
// a session: platform detection, location cost-bucket UUID arrays, and the
// Xero/Iplicit CoA UUID→key map. Caching them shaves ~500ms off every repeat
// ask and makes follow-ups (different period, different bucket) feel instant.
// TTL 5 min — long enough to amortise a chat session, short enough that
// config changes appear quickly.
const PLATFORM_CACHE = new Map(); // orgId -> { platform, expiresAt }
const PRACTICE_LOCATIONS_COST_CACHE = new Map(); // `${orgId}|${locId||'all'}` -> { rows, expiresAt }
const COA_KEYMAP_CACHE = new Map(); // `${orgId}|${platform}` -> { uuidToKey:Map, keyToInfo:Map, expiresAt }
const COST_RESOLVER_CACHE_TTL_MS = 5 * 60 * 1000;

async function detectAccountingPlatform(orgId) {
  const cached = PLATFORM_CACHE.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.platform;

  const { data } = await supabaseAdmin
    .from('platform_integrations')
    .select('platform_name')
    .eq('organization_id', orgId);
  let platform = null;
  for (const r of (data || [])) {
    const p = String(r.platform_name || '').toLowerCase();
    if (p === 'xero' || p === 'iplicit') { platform = p; break; }
  }
  PLATFORM_CACHE.set(orgId, { platform, expiresAt: Date.now() + COST_RESOLVER_CACHE_TTL_MS });
  return platform;
}

async function loadPracticeLocationsForCosts(orgId, locationId) {
  const cacheKey = `${orgId}|${locationId || 'all'}`;
  const cached = PRACTICE_LOCATIONS_COST_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  let q = supabaseAdmin
    .from('practice_locations')
    .select(`id, location_name, ${COST_BUCKETS.map(b => b.key).join(', ')}`)
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (locationId) q = q.eq('id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  PRACTICE_LOCATIONS_COST_CACHE.set(cacheKey, { rows, expiresAt: Date.now() + COST_RESOLVER_CACHE_TTL_MS });
  return rows;
}

// Builds the full COA UUID→journal-key map for an org once, then serves it
// from cache for every subsequent cost question. We over-fetch (every active
// COA row) rather than re-querying per UUID list — a single fetch is faster
// than the per-question `.in('id', uniqueUuids)` filter when the same
// session asks several cost questions.
async function loadCoaKeyMap(orgId, platform) {
  if (platform !== 'xero' && platform !== 'iplicit') {
    return { uuidToKey: new Map(), keyToInfo: new Map() };
  }
  const cacheKey = `${orgId}|${platform}`;
  const cached = COA_KEYMAP_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const uuidToKey = new Map();
  const keyToInfo = new Map();
  if (platform === 'xero') {
    const { data } = await supabaseAdmin
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id, account_code, account_name')
      .eq('organization_id', orgId);
    for (const r of (data || [])) {
      if (r.xero_account_id) {
        uuidToKey.set(r.id, r.xero_account_id);
        keyToInfo.set(r.xero_account_id, { name: r.account_name || r.account_code, code: r.account_code });
      }
    }
  } else {
    const { data } = await supabaseAdmin
      .from('iplicit_chart_of_accounts')
      .select('id, code, name')
      .eq('organization_id', orgId);
    for (const r of (data || [])) {
      if (r.code) {
        const k = r.code.trim();
        uuidToKey.set(r.id, k);
        keyToInfo.set(k, { name: r.name || r.code, code: r.code });
      }
    }
  }
  const ref = { uuidToKey, keyToInfo, expiresAt: Date.now() + COST_RESOLVER_CACHE_TTL_MS };
  COA_KEYMAP_CACHE.set(cacheKey, ref);
  return ref;
}

// Sum expense rows for a given platform + period + COA-UUID set, broken
// down by the bucket each UUID came from. Returns an array of
// { key, label, total, accounts: [{ name, code, amount }] }.
async function sumCostsByBucket(orgId, platform, buckets, period_from, period_to) {
  // 1. Translate every UUID in every bucket into the lookup key that the
  //    platform's journal table actually filters on, using the cached org-wide
  //    CoA map. Single shared fetch beats the per-question `.in('id', …)`
  //    filter when several cost questions hit the same session.
  const allUuids = [];
  for (const b of buckets) for (const u of b.uuids) allUuids.push(u);
  const uniqueUuids = [...new Set(allUuids)];
  if (uniqueUuids.length === 0) return buckets.map(b => ({ ...b, total: 0, accounts: [] }));

  const coaMap = await loadCoaKeyMap(orgId, platform);
  const uuidToKey = new Map();   // COA UUID → journal-table key, filtered to the requested UUIDs
  const keyToInfo = coaMap.keyToInfo;
  for (const u of uniqueUuids) {
    const k = coaMap.uuidToKey.get(u);
    if (k) uuidToKey.set(u, k);
  }
  if (uuidToKey.size === 0) return buckets.map(b => ({ ...b, total: 0, accounts: [] }));

  const allKeys = [...new Set([...uuidToKey.values()])];
  if (allKeys.length === 0) return buckets.map(b => ({ ...b, total: 0, accounts: [] }));

  // 2. Sum the period's transactions for every key. Page reads are now
  //    parallel — fetch a probe page to learn whether more pages exist,
  //    then run any remaining pages concurrently. On a 6-month cost range
  //    that's typically 5-15 pages → ~5× faster than the previous
  //    sequential `while` loop.
  const PAGE = 1000;
  const PARALLEL_CAP = 6; // limit concurrency to avoid hammering Supabase
  const amountByKey = new Map();

  const buildPageQuery = (cursor) => {
    let q;
    if (platform === 'xero') {
      q = supabaseAdmin
        .from('xero_journal_details')
        .select('account_id, net_amount, journal_date')
        .eq('organization_id', orgId)
        .gte('journal_date', period_from)
        .lte('journal_date', period_to)
        .in('account_id', allKeys);
    } else {
      q = supabaseAdmin
        .from('iplicit_gl_entries')
        .select('account_code, gross_amount, net_amount, tax_amount, doc_date')
        .eq('organization_id', orgId)
        .gte('doc_date', period_from)
        .lte('doc_date', period_to)
        .in('account_code', allKeys);
    }
    return q.range(cursor, cursor + PAGE - 1);
  };

  const accumulate = (rows) => {
    for (const r of rows) {
      const k = platform === 'xero' ? r.account_id : (r.account_code || '').trim();
      if (!k) continue;
      const amt = platform === 'xero'
        ? (Number(r.net_amount) || 0)
        : (Number(r.gross_amount) || ((Number(r.net_amount) || 0) + (Number(r.tax_amount) || 0)));
      amountByKey.set(k, (amountByKey.get(k) || 0) + amt);
    }
  };

  // Probe page (also caps small datasets to a single round-trip).
  const probe = await buildPageQuery(0);
  if (probe.error) throw new Error(`Cost transaction read failed (${platform}): ${probe.error.message}`);
  const probeRows = probe.data || [];
  accumulate(probeRows);

  // If the probe returned a full page, more pages may exist. Fan out
  // concurrently in batches of PARALLEL_CAP, stopping when a batch returns
  // any short page (signals end-of-data).
  if (probeRows.length === PAGE) {
    let cursor = PAGE;
    let done = false;
    while (!done) {
      const cursors = [];
      for (let i = 0; i < PARALLEL_CAP; i++) {
        cursors.push(cursor);
        cursor += PAGE;
      }
      const results = await Promise.all(cursors.map(c => buildPageQuery(c)));
      for (const r of results) {
        if (r.error) throw new Error(`Cost transaction read failed (${platform}): ${r.error.message}`);
        const rows = r.data || [];
        accumulate(rows);
        if (rows.length < PAGE) done = true;
      }
    }
  }

  // 3. Roll amounts back up to the original buckets.
  return buckets.map(b => {
    let total = 0;
    const accounts = [];
    const seenKeys = new Set();
    for (const u of b.uuids) {
      const k = uuidToKey.get(u);
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      const info = keyToInfo.get(k) || { name: k, code: k };
      const amt = amountByKey.get(k) || 0;
      if (amt !== 0) {
        total += amt;
        accounts.push({ name: info.name, code: info.code || '', amount: amt });
      }
    }
    accounts.sort((a, b) => b.amount - a.amount);
    return { ...b, total, accounts };
  });
}

// Fallback when no location bucket is mapped yet. Reads the period's
// iplicit_profit_loss rows, identifies expense accounts (PL accounts whose
// natural balance is debit — represented by positive amounts here), and
// rolls them up by the parent COA group description so the user still
// gets a useful breakdown.
async function resolveCostBreakdownUnmapped(orgId, platform, period_from, period_to, locRows, locationName) {
  const buckets = platform === 'xero'
    ? await unmappedFromXero(orgId, period_from, period_to)
    : await unmappedFromIplicit(orgId, period_from, period_to);

  if (!buckets || buckets.length === 0) {
    return {
      preformatted: true,
      markdown:
        `### Cost breakdown — ${locationName}\n**Period:** ${period_from} to ${period_to}\n\n` +
        `_No expense activity found in ${platform} for this period._\n\n` +
        `Either no costs were posted in this window, or the integration hasn't synced. Try a wider period (e.g. *"costs last quarter"*).`,
      suggestions: ['Costs last quarter', 'Show revenue instead'],
    };
  }

  const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

  return {
    preformatted: false,
    metric: 'cost_breakdown',
    platform,
    period: { from: period_from, to: period_to },
    locationName,
    grandTotal,
    buckets,
    unmapped: true, // formatter surfaces a hint
  };
}

// Xero: pull every journal-detail row whose account_type is an expense
// category (DIRECTCOSTS, OVERHEADS, EXPENSE) in the period, group by
// account_type as the bucket label.
async function unmappedFromXero(orgId, period_from, period_to) {
  const EXPENSE_TYPES = ['DIRECTCOSTS', 'OVERHEADS', 'EXPENSE'];
  const PAGE = 1000;
  let cursor = 0;
  const byAccount = new Map(); // account_code → { name, code, type, amount }
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('xero_journal_details')
      .select('account_code, account_name, account_type, net_amount, journal_date')
      .eq('organization_id', orgId)
      .gte('journal_date', period_from)
      .lte('journal_date', period_to)
      .in('account_type', EXPENSE_TYPES)
      .range(cursor, cursor + PAGE - 1);
    if (error) throw new Error(`Couldn't read xero_journal_details: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const key = (r.account_code || r.account_name || '').toString().trim();
      if (!key) continue;
      const cur = byAccount.get(key);
      const amt = Number(r.net_amount) || 0;
      if (cur) cur.amount += amt;
      else byAccount.set(key, { name: r.account_name || key, code: r.account_code || '', type: r.account_type, amount: amt });
    }
    if (data.length < PAGE) break;
    cursor += PAGE;
  }
  const TYPE_LABEL = { DIRECTCOSTS: 'Direct costs', OVERHEADS: 'Overheads', EXPENSE: 'Expenses' };
  const byType = new Map();
  for (const a of byAccount.values()) {
    if (a.amount <= 0.005) continue; // skip credits / contras
    const label = TYPE_LABEL[a.type] || a.type;
    let entry = byType.get(label);
    if (!entry) { entry = { label, total: 0, accounts: [] }; byType.set(label, entry); }
    entry.total += a.amount;
    entry.accounts.push({ name: a.name, code: a.code, amount: a.amount });
  }
  return [...byType.values()]
    .map(b => ({ ...b, accounts: b.accounts.sort((x, y) => y.amount - x.amount) }))
    .sort((a, b) => b.total - a.total);
}

// Iplicit: same idea, grouped by parent COA group description.
async function unmappedFromIplicit(orgId, period_from, period_to) {
  const periodFloor = period_from.slice(0, 8) + '01';
  const [coaRes, groupRes] = await Promise.all([
    supabaseAdmin.from('iplicit_chart_of_accounts').select('code, name, coa_group_id').eq('organization_id', orgId),
    supabaseAdmin.from('iplicit_coa_account_groups').select('account_group_id, description').eq('organization_id', orgId),
  ]);
  const nameByCode = new Map();
  const groupByCode = new Map();
  for (const r of (coaRes.data || [])) {
    if (r.code) {
      nameByCode.set(r.code.trim(), r.name || r.code);
      if (r.coa_group_id) groupByCode.set(r.code.trim(), r.coa_group_id);
    }
  }
  const groupDescById = new Map();
  for (const g of (groupRes.data || [])) if (g.account_group_id) groupDescById.set(g.account_group_id, g.description || g.account_group_id);

  const PAGE = 1000;
  let cursor = 0;
  const byAccount = new Map();
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('iplicit_profit_loss')
      .select('account_code, amount, period_date')
      .eq('organization_id', orgId)
      .gte('period_date', periodFloor)
      .lte('period_date', period_to)
      .range(cursor, cursor + PAGE - 1);
    if (error) throw new Error(`Couldn't read iplicit_profit_loss: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const code = (r.account_code || '').trim();
      if (!code) continue;
      const cur = byAccount.get(code);
      const amt = Number(r.amount) || 0;
      if (cur) cur.amount += amt;
      else byAccount.set(code, { code, name: nameByCode.get(code) || code, groupId: groupByCode.get(code) || null, amount: amt });
    }
    if (data.length < PAGE) break;
    cursor += PAGE;
  }
  const expenses = [...byAccount.values()].filter(a => a.amount > 0.005);
  const byGroup = new Map();
  for (const a of expenses) {
    const label = a.groupId ? (groupDescById.get(a.groupId) || 'Other expenses') : 'Other expenses';
    let entry = byGroup.get(label);
    if (!entry) { entry = { label, total: 0, accounts: [] }; byGroup.set(label, entry); }
    entry.total += a.amount;
    entry.accounts.push({ name: a.name, code: a.code, amount: a.amount });
  }
  return [...byGroup.values()]
    .map(b => ({ ...b, accounts: b.accounts.sort((x, y) => y.amount - x.amount) }))
    .sort((a, b) => b.total - a.total);
}

// Map a free-text cost category onto the practice_locations column we look at.
// `all` means every bucket combined — useful for "daily total costs in March".
const COST_CATEGORY_ALIASES = {
  lab_fees: 'lab_fees_accounts',
  lab: 'lab_fees_accounts',
  labs: 'lab_fees_accounts',
  staff_costs: 'staff_costs_accounts',
  staff: 'staff_costs_accounts',
  salaries: 'staff_costs_accounts',
  wages: 'staff_costs_accounts',
  clinician_costs: 'clinician_cost_accounts',
  clinician: 'clinician_cost_accounts',
  associates: 'clinician_cost_accounts',
  material_costs: 'material_cost_accounts',
  materials: 'material_cost_accounts',
  consumables: 'material_cost_accounts',
  operating_leases: 'operating_lease_accounts',
  operating_lease: 'operating_lease_accounts',
  rent: 'operating_lease_accounts',
  overheads: 'overhead_cost_accounts',
  overhead: 'overhead_cost_accounts',
  administrative_costs: 'administrative_cost_accounts',
  administrative: 'administrative_cost_accounts',
  admin: 'administrative_cost_accounts',
  cost_of_sales: 'cost_of_sales_accounts',
  cogs: 'cost_of_sales_accounts',
};

// Time-series cost detail: returns date+amount rows for a specific cost
// category (e.g. "lab fees by date in March"). Reuses the same per-location
// bucket mapping + platform-aware account resolution as resolveCostBreakdown.
async function resolveListCostEntries(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const groupBy = ['day', 'week', 'month'].includes(String(args.group_by || '').toLowerCase())
    ? String(args.group_by).toLowerCase()
    : 'day';
  const requestedCategory = String(args.category || 'all').toLowerCase().trim().replace(/\s+/g, '_');
  const isAll = requestedCategory === 'all' || requestedCategory === 'total' || requestedCategory === 'cost' || requestedCategory === 'costs';

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"lab fees by date in March 2026"*.',
      suggestions: ['Lab fees this month', 'Staff costs last month'],
    };
  }

  const platform = await detectAccountingPlatform(orgId);
  if (!platform) {
    return {
      preformatted: true,
      markdown: `### Cost detail — ${period_from} to ${period_to}\n\n_No accounting integration is connected for this org._`,
      suggestions: ['Show revenue instead'],
    };
  }

  // Pick bucket(s) for the requested category.
  let bucketKeys;
  let categoryLabel;
  if (isAll) {
    bucketKeys = COST_BUCKETS.map(b => b.key);
    categoryLabel = 'All costs';
  } else {
    const mapped = COST_CATEGORY_ALIASES[requestedCategory];
    if (!mapped) {
      return {
        preformatted: true,
        markdown: `I don't recognise the cost category "${args.category}". Try one of: lab fees, staff costs, clinician costs, material costs, operating leases, overheads, administrative costs, cost of sales — or "all".`,
        suggestions: ['Lab fees by date', 'Staff costs by month', 'All costs'],
      };
    }
    bucketKeys = [mapped];
    categoryLabel = (COST_BUCKETS.find(b => b.key === mapped) || {}).label || requestedCategory;
  }

  // Load location row(s) → collect the relevant bucket UUIDs.
  let locQuery = supabaseAdmin
    .from('practice_locations')
    .select(`id, location_name, ${bucketKeys.join(', ')}`)
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (location_id) locQuery = locQuery.eq('id', location_id);
  const { data: locRows, error: locErr } = await locQuery;
  if (locErr) return { preformatted: true, markdown: `Couldn't load location cost mapping: ${locErr.message}`, suggestions: [] };
  if (!locRows || locRows.length === 0) {
    return { preformatted: true, markdown: 'No matching location.', suggestions: [] };
  }

  const uuids = new Set();
  for (const loc of locRows) {
    for (const k of bucketKeys) {
      for (const id of (Array.isArray(loc[k]) ? loc[k] : [])) if (id) uuids.add(id);
    }
  }
  if (uuids.size === 0) {
    return {
      preformatted: true,
      markdown:
        `### ${categoryLabel} by ${groupBy} — ${locRows.length === 1 ? locRows[0].location_name : (locRows.length + ' locations')}\n**Period:** ${period_from} to ${period_to}\n\n` +
        `_No accounts are mapped to ${categoryLabel} for this location. Go to **Location Settings → Profit/Loss accounts** and assign chart-of-account rows to ${categoryLabel}._`,
      suggestions: ['Show all costs instead', 'Show revenue instead'],
    };
  }

  // Resolve UUIDs → platform-specific join key.
  const uuidArr = [...uuids];
  const keyByUuid = new Map();
  if (platform === 'xero') {
    const { data } = await supabaseAdmin
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', orgId)
      .in('id', uuidArr);
    for (const r of (data || [])) if (r.xero_account_id) keyByUuid.set(r.id, r.xero_account_id);
  } else {
    const { data } = await supabaseAdmin
      .from('iplicit_chart_of_accounts')
      .select('id, code')
      .eq('organization_id', orgId)
      .in('id', uuidArr);
    for (const r of (data || [])) if (r.code) keyByUuid.set(r.id, r.code.trim());
  }
  const keys = [...new Set(keyByUuid.values())];
  if (keys.length === 0) {
    return {
      preformatted: true,
      markdown: `Mapped accounts for ${categoryLabel} couldn't be resolved in ${platform}'s chart of accounts. The integration may need a re-sync.`,
      suggestions: ['Show all costs', 'Show revenue instead'],
    };
  }

  // Pull transactions for those accounts in the period.
  const transactions = [];
  const PAGE = 1000;
  let cursor = 0;
  while (true) {
    let q;
    if (platform === 'xero') {
      q = supabaseAdmin
        .from('xero_journal_details')
        .select('journal_date, account_code, account_name, net_amount')
        .eq('organization_id', orgId)
        .gte('journal_date', period_from)
        .lte('journal_date', period_to)
        .in('account_id', keys);
    } else {
      q = supabaseAdmin
        .from('iplicit_gl_entries')
        .select('doc_date, account_code, account_name, gross_amount, net_amount, tax_amount')
        .eq('organization_id', orgId)
        .gte('doc_date', period_from)
        .lte('doc_date', period_to)
        .in('account_code', keys);
    }
    const { data, error } = await q.range(cursor, cursor + PAGE - 1);
    if (error) return dbReadFailure(error, 'cost data', { period_from, period_to });
    if (!data || data.length === 0) break;
    for (const r of data) {
      const date = platform === 'xero' ? r.journal_date : r.doc_date;
      const amt = platform === 'xero'
        ? (Number(r.net_amount) || 0)
        : (Number(r.gross_amount) || ((Number(r.net_amount) || 0) + (Number(r.tax_amount) || 0)));
      if (!date) continue;
      transactions.push({ date: String(date).slice(0, 10), account_code: r.account_code, account_name: r.account_name, amount: amt });
    }
    if (data.length < PAGE) break;
    cursor += PAGE;
  }

  // Bucket dates per group_by.
  const bucketKey = (isoDate) => {
    if (groupBy === 'day') return isoDate;
    if (groupBy === 'month') return isoDate.slice(0, 7);
    if (groupBy === 'week') {
      const d = new Date(isoDate + 'T00:00:00Z');
      const day = d.getUTCDay();
      const diffToMon = (day + 6) % 7; // Monday-start week
      d.setUTCDate(d.getUTCDate() - diffToMon);
      return d.toISOString().slice(0, 10);
    }
    return isoDate;
  };

  const byBucket = new Map();
  let total = 0;
  for (const t of transactions) {
    if (t.amount <= 0.0001 && t.amount >= -0.0001) continue; // ignore zero rows
    const k = bucketKey(t.date);
    byBucket.set(k, (byBucket.get(k) || 0) + t.amount);
    total += t.amount;
  }

  const rows = [...byBucket.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const locationName = locRows.length === 1 ? locRows[0].location_name : `${locRows.length} locations`;

  return {
    preformatted: false,
    metric: 'cost_entries_by_date',
    platform,
    category: categoryLabel,
    groupBy,
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    total,
    rows,
  };
}

// Provider roster + per-provider stats — same shape as the Practitioner
// History page. Returns one row per active provider with revenue (from the
// production metrics RPC) PLUS appointment-state counts (completed /
// cancelled / DNA) and unique-patient count rolled up from the appointments
// table.
async function resolveListProviders(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const providerType = args.provider_type || null;

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"list all dentists for March 2026"*.',
      suggestions: ['Dentists this month', 'Hygienists last month', 'All providers this year'],
    };
  }

  // 1. Pull the active provider directory.
  let pQuery = supabaseAdmin
    .from('providers')
    .select('id, external_id, name, provider_role, location_id, photo_url')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (location_id) pQuery = pQuery.eq('location_id', location_id);
  if (providerType) pQuery = pQuery.eq('provider_role', providerType);
  const { data: providers, error: pErr } = await pQuery;
  if (pErr) return { preformatted: true, markdown: `Couldn't load providers: ${pErr.message}`, suggestions: [] };
  if (!providers || providers.length === 0) {
    return {
      preformatted: true,
      markdown: `No active ${providerType ? providerType.toLowerCase() + 's' : 'providers'} found${location_id ? ' at this location' : ''}.`,
      suggestions: ['Show all providers', 'Show whole practice'],
    };
  }

  // 2. Revenue + days worked from the same RPC the Production page uses.
  //    The RPC already filters by provider_type / location when supplied.
  const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc('chart_get_production_metrics', {
    p_start_date: period_from,
    p_end_date: period_to,
    p_organization_id: orgId,
    p_provider_type: providerType,
    p_location_id: location_id || null,
  });
  if (rpcErr) return { preformatted: true, markdown: `Couldn't load production: ${rpcErr.message}`, suggestions: [] };

  const statsById = new Map();
  for (const r of (rpcRows || [])) {
    statsById.set(r.provider_id, {
      revenue: parseFloat(r.production_amount || 0),
      daysWorked: parseFloat(r.days_worked || 0),
      avgDaily: parseFloat(r.avg_daily_production || 0),
    });
  }

  // 3. Appointment-state counts + unique patient count, paged from the
  //    appointments table — same logic the History page uses.
  const extIds = providers.map(p => p.external_id).filter(id => id != null);
  const apptByProvider = new Map();
  if (extIds.length > 0) {
    let cursor = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .select('apmt_practitioner_id, apmt_patient_id, apmt_state, apmt_start_time')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .in('apmt_practitioner_id', extIds)
        .gte('apmt_start_time', period_from)
        .lte('apmt_start_time', period_to + 'T23:59:59')
        .range(cursor, cursor + PAGE - 1);
      if (error) return { preformatted: true, markdown: `Couldn't read appointments: ${error.message}`, suggestions: [] };
      if (!data || data.length === 0) break;
      for (const a of data) {
        const k = a.apmt_practitioner_id;
        let agg = apptByProvider.get(k);
        if (!agg) { agg = { total: 0, completed: 0, cancelled: 0, dna: 0, patients: new Set() }; apptByProvider.set(k, agg); }
        agg.total += 1;
        const state = (a.apmt_state || '').toLowerCase();
        if (state === 'completed' || state === 'complete' || state === 'arrived') agg.completed += 1;
        else if (state === 'cancelled' || state === 'canceled') agg.cancelled += 1;
        else if (state === 'did not attend' || state === 'dna') agg.dna += 1;
        if (a.apmt_patient_id) agg.patients.add(a.apmt_patient_id);
      }
      if (data.length < PAGE) break;
      cursor += PAGE;
    }
  }

  // 4. Optional: location name resolution for display.
  const locIds = [...new Set(providers.map(p => p.location_id).filter(Boolean))];
  const locById = new Map();
  if (locIds.length > 0) {
    const { data: locs } = await supabaseAdmin
      .from('practice_locations')
      .select('id, location_name')
      .in('id', locIds);
    for (const l of (locs || [])) locById.set(l.id, l.location_name);
  }

  // 5. Assemble + sort by revenue desc, then alphabetically.
  const rows = providers.map((p) => {
    const stats = statsById.get(p.id) || { revenue: 0, daysWorked: 0, avgDaily: 0 };
    const appt = apptByProvider.get(p.external_id) || { total: 0, completed: 0, cancelled: 0, dna: 0, patients: new Set() };
    const totalCounted = appt.completed + appt.cancelled + appt.dna;
    return {
      provider_id: p.id,
      provider_name: p.name,
      provider_role: p.provider_role || '—',
      location_name: locById.get(p.location_id) || '—',
      revenue: stats.revenue,
      days_worked: stats.daysWorked,
      avg_daily_production: stats.avgDaily,
      total_appointments: appt.total,
      completed: appt.completed,
      cancelled: appt.cancelled,
      dna: appt.dna,
      cancellation_rate: totalCounted > 0 ? (appt.cancelled / totalCounted) * 100 : 0,
      dna_rate: totalCounted > 0 ? (appt.dna / totalCounted) * 100 : 0,
      unique_patients: appt.patients.size,
    };
  }).sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return String(a.provider_name).localeCompare(String(b.provider_name));
  }).map((r, i) => ({ ...r, rank: i + 1 }));

  const totals = rows.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenue,
    total_appointments: acc.total_appointments + r.total_appointments,
    completed: acc.completed + r.completed,
    cancelled: acc.cancelled + r.cancelled,
    dna: acc.dna + r.dna,
    unique_patients: acc.unique_patients + r.unique_patients,
  }), { revenue: 0, total_appointments: 0, completed: 0, cancelled: 0, dna: 0, unique_patients: 0 });

  const locationName = location_id ? (locById.get(location_id) || 'Selected location') : 'All locations';

  return {
    preformatted: false,
    metric: 'providers_list',
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    providerType,
    totals,
    rows,
  };
}

// EBITDA + valuation snapshot. Pulls revenue from the same chart_get_production_metrics
// RPC the production pages use, sums every mapped cost bucket via the existing
// platform-aware cost resolver, then derives:
//   Gross profit  = Revenue − Cost of Sales (lab + clinician + material)
//   EBITDA        = Gross profit − Operating expenses (staff + overhead + lease + admin)
//   Valuation     = EBITDA × default multiple (5.8× — same default as the EBITDA Valuation page)
// Tracks revenue, opex, COGS, EBITDA, margin, valuation for the chosen
// period/location so the formatter can render the same waterfall the page shows.
// Full P&L vs prior-period comparison — mirrors the Profitability page.
// Computes the current period's P&L (revenue, COGS, gross profit, opex,
// EBITDA, margins) AND the equivalent figures for the period immediately
// preceding it (same length), then surfaces absolute + percentage variance
// line by line.
async function resolveProfitAndLoss(args, orgId) {
  const { period_from, period_to, location_id } = args;

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"P&L for March 2026"*.',
      suggestions: ['Profit & Loss this month', 'Profitability last quarter', 'P&L this year'],
    };
  }

  // Compute prior period by subtracting the same number of days. e.g. a 31-day
  // period (March 2026) compares against the previous 31 days (Feb 2026 area).
  const start = new Date(period_from + 'T00:00:00Z');
  const end   = new Date(period_to + 'T00:00:00Z');
  const days  = Math.round((end - start) / 86400000) + 1;
  const priorEnd   = new Date(start.getTime() - 86400000); // day before current start
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const priorFrom = fmt(priorStart);
  const priorTo   = fmt(priorEnd);

  // Two parallel EBITDA computations — same shape, different periods.
  const [current, prior] = await Promise.all([
    resolveEbitda({ period_from, period_to, location_id }, orgId),
    resolveEbitda({ period_from: priorFrom, period_to: priorTo, location_id }, orgId),
  ]);

  // If the resolver returned a preformatted error/placeholder, just pass it on
  // (e.g. "no integration connected") — the comparison can't run either way.
  if (current.preformatted) return current;

  return {
    preformatted: false,
    metric: 'profit_and_loss',
    period:       current.period,
    priorPeriod:  { from: priorFrom, to: priorTo },
    locationId:   current.locationId,
    locationName: current.locationName,
    current: {
      revenue: current.revenue,
      cogs:    current.cogs,
      grossProfit: current.grossProfit,
      grossMargin: current.grossMargin,
      opex:    current.opex,
      ebitda:  current.ebitda,
      ebitdaMargin: current.ebitdaMargin,
      totalCosts:   current.totalCosts,
    },
    prior: prior.preformatted ? null : {
      revenue: prior.revenue,
      cogs:    prior.cogs,
      grossProfit: prior.grossProfit,
      grossMargin: prior.grossMargin,
      opex:    prior.opex,
      ebitda:  prior.ebitda,
      ebitdaMargin: prior.ebitdaMargin,
      totalCosts:   prior.totalCosts,
    },
    costBuckets: current.costBuckets,
  };
}

async function resolveEbitda(args, orgId) {
  const { period_from, period_to, location_id } = args;

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"EBITDA for March 2026"*.',
      suggestions: ['EBITDA this month', 'EBITDA last quarter', 'EBITDA this year'],
    };
  }

  // 1. Revenue from chart_get_production_metrics — matches the Production /
  //    Profitability / Dashboard pages exactly.
  let totalRevenue = 0;
  try {
    const locIds = Array.isArray(args.location_ids) && args.location_ids.length > 0
      ? args.location_ids
      : [location_id || null];
    for (const locId of locIds) {
      const { data, error } = await supabaseAdmin.rpc('chart_get_production_metrics', {
        p_start_date: period_from,
        p_end_date: period_to,
        p_organization_id: orgId,
        p_provider_type: null,
        p_location_id: locId,
      });
      if (error) throw error;
      for (const r of (data || [])) totalRevenue += parseFloat(r.production_amount || 0);
    }
  } catch (err) {
    return dbReadFailure(err, 'revenue', { period_from, period_to });
  }

  // 2. Cost breakdown — reuses the same path resolveCostBreakdown does so the
  //    EBITDA reconciles with the Cost Impact page numbers. We deliberately
  //    restrict to the 6 dashboard buckets (lab + staff + lease + clinician +
  //    overhead + material) and exclude `cost_of_sales_accounts` and
  //    `administrative_cost_accounts` — those bucket arrays on most orgs are
  //    SUPERSETS of the 6 (Xero's "Total Cost of Sales" rolls up lab + materials
  //    + clinician) and including them double-counts costs.
  // Buckets that drive EBITDA. We deliberately work at the ACCOUNT UUID level
  // here rather than summing bucket totals, because on many orgs the same
  // UUID lives in multiple bucket columns (e.g. overhead_cost_accounts and
  // administrative_cost_accounts overlap by 30+ accounts on a Xero org we
  // tested). Summing bucket totals would double-count those — building one
  // deduped account set per category and summing once is the only way to
  // reconcile with the Cost Impact / EBITDA Valuation page's £ figures.
  const COGS_BUCKET_KEYS = ['lab_fees_accounts', 'clinician_cost_accounts', 'material_cost_accounts'];
  const OPEX_BUCKET_KEYS = ['staff_costs_accounts', 'operating_lease_accounts', 'overhead_cost_accounts', 'administrative_cost_accounts'];
  const ALL_BUCKET_KEYS  = [...COGS_BUCKET_KEYS, ...OPEX_BUCKET_KEYS];

  const platform = await detectAccountingPlatform(orgId);
  if (!platform) {
    return {
      preformatted: true,
      markdown:
        `### EBITDA — ${period_from} to ${period_to}\n\n` +
        `_No accounting integration (Xero / iplicit) is connected for this organisation, so I can't compute costs._\n\n` +
        `Connect one under **Integrations** to enable EBITDA.`,
      suggestions: ['Show revenue instead'],
    };
  }

  let locQuery = supabaseAdmin
    .from('practice_locations')
    .select(`id, location_name, ${ALL_BUCKET_KEYS.join(', ')}`)
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (location_id) locQuery = locQuery.eq('id', location_id);
  const { data: locRows, error: locErr } = await locQuery;
  if (locErr) return dbReadFailure(locErr, 'cost mapping', { period_from, period_to });

  // Union per CATEGORY (COGS vs OPEX) so a UUID counted once even when it's
  // in multiple bucket columns.
  const cogsUuids = new Set();
  const opexUuids = new Set();
  for (const loc of locRows || []) {
    for (const k of COGS_BUCKET_KEYS) for (const id of (Array.isArray(loc[k]) ? loc[k] : [])) if (id) cogsUuids.add(id);
    for (const k of OPEX_BUCKET_KEYS) for (const id of (Array.isArray(loc[k]) ? loc[k] : [])) if (id) opexUuids.add(id);
  }
  // If an account ends up in both (rare but possible), prefer the COGS side so
  // gross-margin sanity is preserved.
  for (const id of cogsUuids) opexUuids.delete(id);

  async function sumForUuids(uuids) {
    if (uuids.size === 0) return 0;
    const arr = [...uuids];
    let xeroIds = [], codes = [], names = [];
    if (platform === 'xero') {
      // Match the dashboard's 3-way logic: xero_account_id OR account_code OR
      // account_name. Some journal lines have account_id NULL but their
      // account_code or account_name still identifies the GL account, and
      // filtering by id alone under-counts (~£30k diff observed on Xero).
      const { data } = await supabaseAdmin
        .from('xero_chart_of_accounts')
        .select('id, xero_account_id, account_code, account_name')
        .eq('organization_id', orgId)
        .in('id', arr);
      xeroIds = [...new Set((data || []).map(r => r.xero_account_id).filter(Boolean))];
      codes   = [...new Set((data || []).map(r => r.account_code).filter(Boolean))];
      names   = [...new Set((data || []).map(r => r.account_name).filter(Boolean))];
    } else {
      const { data } = await supabaseAdmin.from('iplicit_chart_of_accounts').select('id, code').eq('organization_id', orgId).in('id', arr);
      codes = [...new Set((data || []).map(r => r.code?.trim()).filter(Boolean))];
    }
    if (platform === 'xero' && xeroIds.length === 0 && codes.length === 0 && names.length === 0) return 0;
    if (platform !== 'xero' && codes.length === 0) return 0;

    let total = 0;
    let cursor = 0;
    const PAGE = 1000;
    const esc = (v) => `"${String(v).replace(/"/g, '\\"')}"`;
    while (true) {
      let q;
      if (platform === 'xero') {
        // Pull every row in the period unfiltered by account, then 3-way match
        // in JS — same pattern as fetchGLEntries in the frontend. PostgREST
        // .or() with .in() on three fields is awkward; the in-period row count
        // is small enough that JS-side filtering is cheap.
        q = supabaseAdmin
          .from('xero_journal_details')
          .select('account_id, account_code, account_name, net_amount')
          .eq('organization_id', orgId)
          .gte('journal_date', period_from)
          .lte('journal_date', period_to);
      } else {
        q = supabaseAdmin
          .from('iplicit_gl_entries')
          .select('account_code, gross_amount, net_amount, tax_amount')
          .eq('organization_id', orgId)
          .gte('doc_date', period_from)
          .lte('doc_date', period_to)
          .in('account_code', codes);
      }
      const { data, error } = await q.range(cursor, cursor + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (platform === 'xero') {
          const eid   = (r.account_id || '').toString().trim();
          const ecode = (r.account_code || '').toString().trim();
          const ename = (r.account_name || '').toString().trim();
          const matches = (eid && xeroIds.includes(eid))
            || (ecode && codes.includes(ecode))
            || (ename && names.includes(ename));
          if (!matches) continue;
          total += Number(r.net_amount) || 0;
        } else {
          total += (Number(r.gross_amount) || ((Number(r.net_amount) || 0) + (Number(r.tax_amount) || 0)));
        }
      }
      if (data.length < PAGE) break;
      cursor += PAGE;
    }
    return total;
  }

  let cogs = 0, opex = 0;
  try {
    cogs = await sumForUuids(cogsUuids);
    opex = await sumForUuids(opexUuids);
  } catch (err) {
    return dbReadFailure(err, 'cost data', { period_from, period_to });
  }
  const totalCosts = cogs + opex;

  // Pull the bucket breakdown too (with double-counting) so the formatter can
  // still show per-category lines — those are presentation-only.
  const costBreakdown = await resolveCostBreakdown({ period_from, period_to, location_id }, orgId);
  const costBuckets = (costBreakdown.buckets || []).filter(b => ALL_BUCKET_KEYS.includes(b.key));

  const grossProfit = totalRevenue - cogs;
  const ebitda = totalRevenue - totalCosts;
  const ebitdaMargin = totalRevenue > 0 ? (ebitda / totalRevenue) * 100 : 0;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // 4. Valuation — default multiple matches the EBITDA Valuation page Base
  //    Market (5.8×). Read from ebitda_settings if the org overrode it; fall
  //    back to 5.8 otherwise.
  let multiple = 5.8;
  try {
    const { data: settings } = await supabaseAdmin
      .from('ebitda_settings')
      .select('base_multiple')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (settings?.base_multiple) multiple = Number(settings.base_multiple);
  } catch (_) { /* table may not exist; stick with default */ }
  const enterpriseValue = ebitda * multiple;

  const locationName = costBreakdown.locationName || (location_id ? '' : 'All locations');

  return {
    preformatted: false,
    metric: 'ebitda',
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    revenue: totalRevenue,
    cogs,
    grossProfit,
    grossMargin,
    opex,
    totalCosts,
    ebitda,
    ebitdaMargin,
    multiple,
    enterpriseValue,
    costBuckets, // for the formatter's waterfall detail
  };
}

// Transaction-level cost detail. Returns one row per journal-detail line
// (one invoice line) with supplier, description and amount — the deeper
// drill-down behind list_cost_entries' date-aggregate view.
//
// Filters to net_amount > 0 so we ignore the offsetting reallocation
// entries (e.g. an org that mirrors lab fees between a main account and
// per-associate sub-accounts posts each amount twice with opposite signs;
// only the positive side is the actual expense).
async function resolveListCostTransactions(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const requestedCategory = String(args.category || 'all').toLowerCase().trim().replace(/\s+/g, '_');
  const isAll = ['all', 'total', 'cost', 'costs', ''].includes(requestedCategory);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"lab fees transactions for March 2026"*.',
      suggestions: ['Lab fees this month', 'Material costs last month'],
    };
  }

  const platform = await detectAccountingPlatform(orgId);
  if (!platform) {
    return { preformatted: true, markdown: '_No accounting integration is connected for this org._', suggestions: ['Show revenue instead'] };
  }

  // Pick bucket(s) for the requested category.
  let bucketKeys, categoryLabel;
  if (isAll) {
    bucketKeys = COST_BUCKETS.map(b => b.key);
    categoryLabel = 'All costs';
  } else {
    const mapped = COST_CATEGORY_ALIASES[requestedCategory];
    if (!mapped) {
      return {
        preformatted: true,
        markdown: `I don't recognise "${args.category}". Try lab fees, staff costs, material costs, etc.`,
        suggestions: ['Lab fees transactions', 'Material costs transactions'],
      };
    }
    bucketKeys = [mapped];
    categoryLabel = (COST_BUCKETS.find(b => b.key === mapped) || {}).label || requestedCategory;
  }

  let locQuery = supabaseAdmin
    .from('practice_locations')
    .select(`id, location_name, ${bucketKeys.join(', ')}`)
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (location_id) locQuery = locQuery.eq('id', location_id);
  const { data: locRows, error: locErr } = await locQuery;
  if (locErr) return { preformatted: true, markdown: `Couldn't load location mapping: ${locErr.message}`, suggestions: [] };
  if (!locRows || locRows.length === 0) {
    return { preformatted: true, markdown: 'No matching location.', suggestions: [] };
  }

  const uuids = new Set();
  for (const loc of locRows) for (const k of bucketKeys) for (const id of (Array.isArray(loc[k]) ? loc[k] : [])) if (id) uuids.add(id);
  if (uuids.size === 0) {
    return {
      preformatted: true,
      markdown:
        `### ${categoryLabel} transactions — ${locRows[0].location_name || ''}\n**Period:** ${period_from} to ${period_to}\n\n` +
        `_No accounts are mapped to ${categoryLabel} for this location. Configure them under **Location Settings → Profit/Loss accounts**._`,
      suggestions: ['Show all costs instead'],
    };
  }

  // Resolve UUIDs → platform key (xero_account_id or iplicit code).
  const uuidArr = [...uuids];
  const keyByUuid = new Map();
  if (platform === 'xero') {
    const { data } = await supabaseAdmin
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', orgId)
      .in('id', uuidArr);
    for (const r of (data || [])) if (r.xero_account_id) keyByUuid.set(r.id, r.xero_account_id);
  } else {
    const { data } = await supabaseAdmin
      .from('iplicit_chart_of_accounts')
      .select('id, code')
      .eq('organization_id', orgId)
      .in('id', uuidArr);
    for (const r of (data || [])) if (r.code) keyByUuid.set(r.id, r.code.trim());
  }
  const keys = [...new Set(keyByUuid.values())];
  if (keys.length === 0) {
    return { preformatted: true, markdown: 'No matching accounts found in the chart of accounts.', suggestions: [] };
  }

  // Pull every journal-line in the period that hits one of the cost accounts.
  // We DON'T filter by net_amount > 0 here because we'll roll up the lines
  // per journal next — the main-account reallocations (positive AND negative)
  // need to be netted within each bill so the per-bill totals match what the
  // dashboard shows (sum of all net_amounts across the mapped account set).
  const rawLines = [];
  const PAGE = 1000;
  let cursor = 0;
  while (true) {
    let q;
    if (platform === 'xero') {
      q = supabaseAdmin
        .from('xero_journal_details')
        .select('journal_id, journal_date, account_code, account_name, description, net_amount')
        .eq('organization_id', orgId)
        .gte('journal_date', period_from)
        .lte('journal_date', period_to)
        .in('account_id', keys);
    } else {
      q = supabaseAdmin
        .from('iplicit_gl_entries')
        .select('doc_id, doc_date, account_code, account_name, description, gross_amount, net_amount, tax_amount, contact_name')
        .eq('organization_id', orgId)
        .gte('doc_date', period_from)
        .lte('doc_date', period_to)
        .in('account_code', keys);
    }
    const { data, error } = await q.range(cursor, cursor + PAGE - 1);
    if (error) return dbReadFailure(error, 'cost data', { period_from, period_to });
    if (!data || data.length === 0) break;
    for (const r of data) {
      const date = platform === 'xero' ? r.journal_date : r.doc_date;
      const journalId = platform === 'xero' ? r.journal_id : r.doc_id;
      const amt = platform === 'xero'
        ? (Number(r.net_amount) || 0)
        : (Number(r.gross_amount) || ((Number(r.net_amount) || 0) + (Number(r.tax_amount) || 0)));
      rawLines.push({
        journalId,
        date: String(date).slice(0, 10),
        account_code: r.account_code,
        account_name: r.account_name,
        supplier: String((platform === 'xero' ? r.description : (r.contact_name || r.description)) || '').trim(),
        amount: amt,
      });
    }
    if (data.length < PAGE) break;
    cursor += PAGE;
  }

  // Some orgs run a reallocation pattern: each bill posts once to the main
  // expense account, then a second journal moves it to a per-associate
  // sub-account (debits the sub, credits the main). Net effect: one positive
  // line per (supplier, date, amount) survives on the sub-account, and the
  // pair on the main account cancels out.
  //
  // To show one row per ACTUAL BILL — regardless of whether the org uses
  // reallocation or not — we:
  //   1. Group by (date, supplier, |amount|).
  //   2. Sum amounts within the group. Reallocation pairs net to the bill
  //      amount; un-reallocated postings net to themselves.
  //   3. Keep groups whose net is positive (drop zero / pure credit notes).
  //   4. Pick the "best" account label per group — prefer a sub-account name
  //      ("Lab Fees-DAVID") over the bare main label ("Lab fees") so the
  //      user sees which associate the cost was attributed to.
  const groupKey = (ln) => `${ln.date}::${(ln.supplier || '').toLowerCase()}::${Math.abs(ln.amount).toFixed(2)}`;
  const groups = new Map();
  for (const ln of rawLines) {
    const k = groupKey(ln);
    let agg = groups.get(k);
    if (!agg) {
      agg = {
        date: ln.date,
        supplier: ln.supplier,
        amount: 0,
        accounts: new Set(),
        bestAccount: null,
      };
      groups.set(k, agg);
    }
    agg.amount += ln.amount;
    agg.accounts.add(`${ln.account_code}::${ln.account_name}`);
    // Prefer an account name that contains a hyphen (sub-account, e.g.
    // "Lab Fees- DAVID") over the bare main name. Falls back to the first
    // seen if no sub.
    const candidate = { code: ln.account_code, name: ln.account_name };
    if (!agg.bestAccount || ((ln.account_name || '').includes('-') && !(agg.bestAccount.name || '').includes('-'))) {
      agg.bestAccount = candidate;
    }
  }

  const transactions = [...groups.values()]
    .filter(g => g.amount > 0.005) // positive bills only — net of reallocations
    .map(g => ({
      date: g.date,
      supplier: g.supplier,
      account_code: g.bestAccount?.code || '',
      account_name: g.bestAccount?.name || '',
      amount: g.amount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const locationName = locRows.length === 1 ? locRows[0].location_name : `${locRows.length} locations`;

  return {
    preformatted: false,
    metric: 'cost_transactions',
    platform,
    category: categoryLabel,
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    total,
    transactions,
  };
}

// Maps the short-form category arg the classifier emits (lab/staff/material/
// clinician/lease/overhead/admin/cogs) to the practice_locations column name
// in COST_BUCKETS. 'all' (or omitted) returns null which means "no filter".
const COST_CATEGORY_TO_BUCKET_KEY = {
  lab: 'lab_fees_accounts',
  staff: 'staff_costs_accounts',
  material: 'material_cost_accounts',
  materials: 'material_cost_accounts',
  clinician: 'clinician_cost_accounts',
  associate: 'clinician_cost_accounts',
  lease: 'operating_lease_accounts',
  leases: 'operating_lease_accounts',
  rent: 'operating_lease_accounts',
  overhead: 'overhead_cost_accounts',
  overheads: 'overhead_cost_accounts',
  admin: 'administrative_cost_accounts',
  administrative: 'administrative_cost_accounts',
  cogs: 'cost_of_sales_accounts',
};

async function resolveCostBreakdown(args, orgId) {
  const { period_from, period_to, location_id } = args;
  // Normalise the requested category — classifier may send 'material',
  // 'materials', 'material_costs' depending on which detector fires. We
  // map to the canonical bucket key.
  const rawCategory = String(args.category || '').toLowerCase().trim();
  const isAllCategories = !rawCategory || rawCategory === 'all' || rawCategory === 'total' || rawCategory === 'costs';
  // Tolerate the "_costs" suffix the time-series detector emits.
  const normalisedCategory = rawCategory.replace(/_costs?$/, '').replace(/s$/, '');
  const requestedBucketKey = isAllCategories ? null : (COST_CATEGORY_TO_BUCKET_KEY[normalisedCategory] || COST_CATEGORY_TO_BUCKET_KEY[rawCategory] || null);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"costs for March 2026"*. I\'ll pull the breakdown from the linked accounting integration.',
      suggestions: ['Costs this month', 'Costs last month', 'Costs last quarter'],
    };
  }

  // 1. Detect which accounting integration this org uses (xero vs iplicit).
  //    Without it we can't pick the right COA / journal tables.
  const platform = await detectAccountingPlatform(orgId);
  if (!platform) {
    return {
      preformatted: true,
      markdown:
        `### Cost breakdown — ${period_from} to ${period_to}\n\n` +
        `_No accounting integration is connected for this organisation, so I can't pull cost data. Connect Xero or iplicit under **Integrations** and try again._`,
      suggestions: ['Show revenue instead'],
    };
  }

  // 2. Fetch the location row(s) whose JSONB cost-bucket columns tell us
  //    which chart-of-account UUIDs belong in each category. Cached per
  //    org+location (5 min TTL) — same lookup fires on every cost question
  //    in a session.
  let locRows;
  try {
    locRows = await loadPracticeLocationsForCosts(orgId, location_id);
  } catch (locErr) {
    return { preformatted: true, markdown: `Couldn't load location cost mappings: ${locErr.message}`, suggestions: [] };
  }
  if (!locRows || locRows.length === 0) {
    return {
      preformatted: true,
      markdown: 'No practice locations found for this organisation, so I can\'t map costs to categories. Set up Profit/Loss accounts under Location Settings first.',
      suggestions: ['Show revenue instead'],
    };
  }

  // 3. Union per-bucket UUIDs across the selected location(s).
  // When the user asked for a SPECIFIC category (e.g. "material costs"), we
  // include ONLY that bucket so the resolver doesn't return a multi-category
  // breakdown for what was a focused question. Falls back to all buckets when
  // category is missing/'all'.
  const bucketsToProcess = requestedBucketKey
    ? COST_BUCKETS.filter(b => b.key === requestedBucketKey)
    : COST_BUCKETS;
  const bucketsInput = bucketsToProcess.map(b => {
    const ids = new Set();
    for (const loc of locRows) {
      const arr = Array.isArray(loc[b.key]) ? loc[b.key] : [];
      for (const id of arr) if (id) ids.add(id);
    }
    return { key: b.key, label: b.label, uuids: [...ids] };
  });

  const totalMappedUuids = bucketsInput.reduce((s, b) => s + b.uuids.length, 0);
  const locationName = locRows.length === 1 ? locRows[0].location_name : `${locRows.length} locations`;

  if (totalMappedUuids === 0) {
    // Nothing mapped → fall back to the platform's expense accounts grouped
    // by integration's own category.
    return resolveCostBreakdownUnmapped(orgId, platform, period_from, period_to, locRows, locationName);
  }

  // 4. Platform-aware sum: gives each bucket its total + the underlying
  //    accounts (sorted by amount desc).
  let summed;
  try {
    summed = await sumCostsByBucket(orgId, platform, bucketsInput, period_from, period_to);
  } catch (err) {
    return dbReadFailure(err, 'cost data', { period_from, period_to });
  }

  const bucketTotals = summed
    .filter(b => Math.abs(b.total) > 0.005)
    .sort((a, b) => b.total - a.total);

  const grandTotal = bucketTotals.reduce((s, b) => s + b.total, 0);

  if (bucketTotals.length === 0) {
    // When the user asked for a specific category and the resolver finds
    // £0 of spend, say so explicitly — naming the category — instead of
    // the generic "no spend" message. Also widen the suggested next step
    // so the user can pivot to a longer period rather than picking another
    // category they didn't ask about.
    const categoryLabel = requestedBucketKey
      ? (COST_BUCKETS.find(b => b.key === requestedBucketKey)?.label || rawCategory)
      : null;
    const headline = categoryLabel
      ? `### ${categoryLabel} — ${locationName}\n**Period:** ${period_from} to ${period_to}\n\n` +
        `_No ${categoryLabel.toLowerCase()} were posted in this period at this location (${platform})._\n\n` +
        `Try widening the period — many cost categories only post monthly or quarterly. If you expected spend here, double-check **Location Settings → Profit/Loss accounts** for the ${categoryLabel.toLowerCase()} bucket.`
      : `### Cost breakdown — ${locationName}\n**Period:** ${period_from} to ${period_to}\n\n` +
        `_No spend on the mapped expense accounts in this period (${platform})._\n\n` +
        `Either no costs were posted, or your bucket mapping points at accounts that weren't used. Try a wider period or check **Location Settings → Profit/Loss accounts**.`;
    return {
      preformatted: true,
      markdown: headline,
      suggestions: ['Try last quarter', 'Try this year', 'Show revenue instead'],
    };
  }

  return {
    preformatted: false,
    metric: 'cost_breakdown',
    platform,
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    grandTotal,
    buckets: bucketTotals,
  };
}

async function resolveGeneral(args) {
  // General questions are handled by the formatter (LLM generates the response)
  return {
    data: null,
    metric: 'general',
    preformatted: false,
    isGeneral: true,
  };
}

// ── Phase 2 resolvers ──

async function resolveCompareDoctors(args, orgId) {
  const { doctor1_name, doctor2_name, metric, period_from, period_to } = args;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';

  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: period_from,
    p_end_date: period_to,
    p_organization_id: orgId,
    p_provider_type: null,
    p_location_id: null,
  });

  if (error) throw error;

  const allProviders = data || [];
  const findProvider = (name) => {
    const lower = name.toLowerCase();
    return allProviders.find(p => p.provider_name?.toLowerCase().includes(lower));
  };

  const p1 = findProvider(doctor1_name);
  const p2 = findProvider(doctor2_name);
  const getValue = (p) => {
    if (!p) return 0;
    return metric === 'profit' ? parseFloat(p.periodic_profit || 0) : parseFloat(p.production_amount || 0);
  };

  const v1 = getValue(p1);
  const v2 = getValue(p2);
  const diff = v1 - v2;
  const pctDiff = v2 !== 0 ? ((diff / Math.abs(v2)) * 100).toFixed(1) : '—';

  return {
    data: { doctor1: p1, doctor2: p2, v1, v2, diff },
    metric,
    doctor1_name: p1?.provider_name || doctor1_name,
    doctor2_name: p2?.provider_name || doctor2_name,
    period: { from: period_from, to: period_to },
    pctDiff,
    preformatted: false,
  };
}

async function resolveCompareMultipleDoctors(args, orgId) {
  const { doctor_names, metric, period_from, period_to } = args;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';

  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: period_from,
    p_end_date: period_to,
    p_organization_id: orgId,
    p_provider_type: null,
    p_location_id: null,
  });

  if (error) throw error;

  const allProviders = data || [];
  const names = doctor_names || [];
  const matched = names.map(name => {
    const lower = name.toLowerCase();
    const found = allProviders.find(p => p.provider_name?.toLowerCase().includes(lower));
    const value = found
      ? (metric === 'profit' ? parseFloat(found.periodic_profit || 0) : parseFloat(found.production_amount || 0))
      : 0;
    return { name: found?.provider_name || name, value, rank: found?.rank || '—' };
  }).sort((a, b) => b.value - a.value);

  const top = matched[0]?.value || 0;
  const bottom = matched[matched.length - 1]?.value || 0;
  const spread = top !== 0 ? (((top - bottom) / top) * 100).toFixed(1) : '0';

  return {
    data: matched,
    metric,
    period: { from: period_from, to: period_to },
    spread,
    topPerformer: matched[0]?.name,
    preformatted: false,
  };
}

async function resolveComparePeriods(args, orgId) {
  const { metric, period1_from, period1_to, period2_from, period2_to, doctor_name } = args;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';

  // Fetch both periods
  const [res1, res2] = await Promise.all([
    supabaseAdmin.rpc(rpcName, {
      p_start_date: period1_from, p_end_date: period1_to,
      p_organization_id: orgId, p_provider_type: null, p_location_id: null,
    }),
    supabaseAdmin.rpc(rpcName, {
      p_start_date: period2_from, p_end_date: period2_to,
      p_organization_id: orgId, p_provider_type: null, p_location_id: null,
    }),
  ]);

  if (res1.error) throw res1.error;
  if (res2.error) throw res2.error;

  let data1 = res1.data || [];
  let data2 = res2.data || [];

  // Filter to doctor if specified
  if (doctor_name) {
    const lower = doctor_name.toLowerCase();
    data1 = data1.filter(p => p.provider_name?.toLowerCase().includes(lower));
    data2 = data2.filter(p => p.provider_name?.toLowerCase().includes(lower));
  }

  const getTotal = (data) => data.reduce((sum, p) => {
    const val = metric === 'profit' ? parseFloat(p.periodic_profit || 0) : parseFloat(p.production_amount || 0);
    return sum + val;
  }, 0);

  const total1 = getTotal(data1);
  const total2 = getTotal(data2);
  const delta = total2 - total1;
  const pctChange = total1 !== 0 ? ((delta / Math.abs(total1)) * 100).toFixed(1) : '—';

  return {
    data: { period1: data1, period2: data2 },
    metric,
    total1, total2, delta, pctChange,
    period1: { from: period1_from, to: period1_to },
    period2: { from: period2_from, to: period2_to },
    doctorName: doctor_name,
    preformatted: false,
  };
}

async function resolveMultiPeriodReport(args, orgId) {
  const { report_type, periods, doctor_name } = args;
  const metric = report_type === 'pl' ? 'profit' : 'revenue';
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const periodHelper = require('./periodHelper');

  // Resolve period labels to date ranges
  const resolvedPeriods = (periods || []).map(p => {
    const resolved = periodHelper.resolveperiodLabel(p);
    return resolved || { from: p, to: p, label: p };
  });

  // Fetch data for each period
  const results = [];
  for (const period of resolvedPeriods) {
    const { data, error } = await supabaseAdmin.rpc(rpcName, {
      p_start_date: period.from,
      p_end_date: period.to,
      p_organization_id: orgId,
      p_provider_type: null,
      p_location_id: null,
    });

    if (error) throw error;

    let periodData = data || [];
    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      periodData = periodData.filter(p => p.provider_name?.toLowerCase().includes(lower));
    }

    const total = periodData.reduce((sum, p) => {
      const val = metric === 'profit' ? parseFloat(p.periodic_profit || 0) : parseFloat(p.production_amount || 0);
      return sum + val;
    }, 0);

    results.push({ label: period.label, from: period.from, to: period.to, total, data: periodData });
  }

  return {
    data: results,
    metric,
    reportType: report_type,
    doctorName: doctor_name,
    preformatted: false,
  };
}

async function resolveYearOverYear(args, orgId) {
  const { metric, period_from, period_to, doctor_name } = args;
  const periodHelper = require('./periodHelper');

  const currentPeriod = { from: period_from, to: period_to, label: 'Current' };
  const yearAgoPeriod = periodHelper.getYearAgo(currentPeriod);

  // Reuse compare_periods logic
  return resolveComparePeriods({
    metric,
    period1_from: yearAgoPeriod.from,
    period1_to: yearAgoPeriod.to,
    period2_from: period_from,
    period2_to: period_to,
    doctor_name,
  }, orgId);
}

// ── Phase 3 resolvers ──

async function resolveDrillDown(args, orgId, context = {}) {
  const { metric, dimension, period_from, period_to, doctor_name, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const valKey = metric === 'profit' ? 'periodic_profit' : 'production_amount';

  if (dimension === 'provider') {
    // Match the Production page exactly: scope chart_get_production_metrics by
    // p_location_id when the user picked a location. Multi-site picks fan out
    // and sum per-provider so the totals align with each site's RPC result.
    async function rpcForLocation(locId) {
      const { data, error } = await supabaseAdmin.rpc(rpcName, {
        p_start_date: period_from, p_end_date: period_to,
        p_organization_id: orgId,
        p_provider_type: args.provider_type || null,
        p_location_id: locId || null,
      });
      if (error) throw error;
      return data || [];
    }

    let providers;
    if (locationIds && locationIds.length > 0) {
      const agg = new Map();
      for (const locId of locationIds) {
        const rows = await rpcForLocation(locId);
        for (const r of rows) {
          const key = r.provider_id || r.provider_name;
          if (!agg.has(key)) agg.set(key, { ...r, [valKey]: 0 });
          const cur = agg.get(key);
          cur[valKey] = parseFloat(cur[valKey] || 0) + parseFloat(r[valKey] || 0);
        }
      }
      providers = Array.from(agg.values())
        .sort((a, b) => parseFloat(b[valKey] || 0) - parseFloat(a[valKey] || 0))
        .map((r, i) => ({ ...r, rank: i + 1 }));
    } else {
      providers = await rpcForLocation(location_id || null);
    }

    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      providers = providers.filter(p => p.provider_name?.toLowerCase().includes(lower));
    }
    const totalProviders = providers.length;
    // Honor explicit "top N" from the user. Clamp to a sane upper bound so a
    // stray top=1000 doesn't dump every row; default cap is 15 (unchanged).
    const topRaw = parseInt(args.top, 10);
    const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(topRaw, 50) : 15;
    providers = providers.slice(0, topN);
    const labels = providers.map(p => p.provider_name || 'Unknown');
    const values = providers.map(p => parseFloat(p[valKey] || 0));

    // Resolve scope label so the formatter can show the actual location.
    let scope = null;
    if (doctor_name) {
      scope = doctor_name;
    } else if (locationIds && locationIds.length > 0) {
      scope = args.location_display || `${locationIds.length} locations`;
    } else if (location_id) {
      scope = (await resolveLocationName(orgId, location_id)) || 'Selected Location';
    }

    return {
      data: providers, metric, dimension,
      period: { from: period_from, to: period_to },
      chart: { type: 'bar', title: `${metric} by Provider`, labels, values, valueUnit: 'currency' },
      scope,
      locationId: location_id || null,
      locationIds,
      topN: Number.isFinite(topRaw) && topRaw > 0 ? topN : null,
      totalProviders,
      preformatted: false,
    };
  }

  if (dimension === 'day' || dimension === 'date') {
    // Daily revenue breakdown — TPI sum per day, optionally split by location
    // when the user named multiple sites ("both TLF locations").
    const locationId = args.location_id || null;
    const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;

    const tpis = await fetchCompletedTpis({
      orgId, periodFrom: period_from, periodTo: period_to,
      locationId, locationIds,
      columns: 'tpi_price, tpi_completed_at, location_id',
    });

    // Build matrix: date → { perLocation: {locId: amount}, total: amount }
    const dayKey = (iso) => (iso || '').slice(0, 10);
    const days = {};
    for (const t of tpis) {
      const d = dayKey(t.tpi_completed_at);
      if (!d) continue;
      if (!days[d]) days[d] = { date: d, total: 0, perLocation: {} };
      const price = parseFloat(t.tpi_price || 0);
      days[d].total += price;
      const lid = t.location_id || 'unknown';
      days[d].perLocation[lid] = (days[d].perLocation[lid] || 0) + price;
    }

    // Stable column order matching the user's match list, falling back to unique IDs found.
    let columnLocs = locationIds && locationIds.length > 0
      ? locationIds
      : (locationId ? [locationId] : null);
    if (!columnLocs) {
      const seen = new Set();
      for (const r of tpis) if (r.location_id) seen.add(r.location_id);
      columnLocs = Array.from(seen);
    }

    // Look up location names for the columns we'll display.
    const nameById = new Map();
    if (columnLocs.length > 0) {
      const { data: locRows } = await supabaseAdmin
        .from('practice_locations')
        .select('id, location_name')
        .eq('organization_id', orgId)
        .in('id', columnLocs);
      for (const l of locRows || []) nameById.set(l.id, l.location_name);
    }

    const sorted = Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) {
      return {
        data: null, metric, dimension,
        period: { from: period_from, to: period_to },
        preformatted: true,
        markdown: `No revenue activity between **${period_from} and ${period_to}**${args.location_display ? ` for ${args.location_display}` : ''}.`,
        suggestions: ['Try a longer period', 'Show overall revenue'],
      };
    }

    const fmt = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const showSplit = columnLocs.length >= 2;

    const scopeLabel = args.location_display
      || (locationIds && locationIds.length > 0 && nameById.size > 0
        ? Array.from(nameById.values()).join(' + ')
        : (locationId ? (nameById.get(locationId) || 'Selected Location') : 'Whole Practice'));

    let md = `### Revenue by Date — ${scopeLabel}\n`;
    md += `**Period:** ${period_from} to ${period_to}\n\n`;

    if (showSplit) {
      md += `| Date | ${columnLocs.map(id => nameById.get(id) || `Location ${id.slice(0, 6)}`).join(' | ')} | Total |\n`;
      md += `|------|${columnLocs.map(() => '---:').join('|')}|---:|\n`;
      const totals = { total: 0 };
      for (const id of columnLocs) totals[id] = 0;
      for (const row of sorted) {
        const cells = columnLocs.map(id => fmt(row.perLocation[id] || 0)).join(' | ');
        md += `| ${row.date} | ${cells} | ${fmt(row.total)} |\n`;
        for (const id of columnLocs) totals[id] += row.perLocation[id] || 0;
        totals.total += row.total;
      }
      md += `| **Total** | ${columnLocs.map(id => `**${fmt(totals[id])}**`).join(' | ')} | **${fmt(totals.total)}** |\n`;
    } else {
      md += `| Date | Revenue |\n`;
      md += `|------|---:|\n`;
      let grand = 0;
      for (const row of sorted) {
        md += `| ${row.date} | ${fmt(row.total)} |\n`;
        grand += row.total;
      }
      md += `| **Total** | **${fmt(grand)}** |\n`;
    }

    return {
      data: sorted, metric, dimension,
      period: { from: period_from, to: period_to },
      preformatted: true,
      markdown: md,
      chart: {
        type: 'line',
        title: `Revenue by Date${scopeLabel ? ' — ' + scopeLabel : ''}`,
        labels: sorted.map(r => r.date),
        values: sorted.map(r => r.total),
        valueUnit: 'currency',
      },
      suggestions: ['Break down by month', 'Compare providers on revenue', 'Show revenue by category'],
    };
  }

  if (dimension === 'month') {
    // Cashflow uses the same `cashflow-report` edge function as the Cashflow page,
    // so the chatbot's monthly numbers reconcile with the Statement of Cash Flows.
    if (metric === 'cashflow') {
      const location_id = args.location_id || null;
      const reqBody = { organizationId: orgId, fromDate: period_from, toDate: period_to, locationId: location_id };

      // Use the caller's JWT — same as the Cashflow page does. Service-role
      // identity is rejected (401) by this edge function. Bounded by a 12s
      // timeout so we never hang the chat reply.
      let report = null;
      const userJwt = context?.userAccessToken;
      if (!userJwt) {
        return {
          data: null, metric, dimension,
          period: { from: period_from, to: period_to },
          preformatted: true,
          markdown: `Couldn't fetch the cashflow report — your session token wasn't forwarded to the chatbot. Please refresh the page and try again.`,
          suggestions: ['Show revenue by month', 'Try again'],
        };
      }

      try {
        const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/cashflow-report`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        let res, text;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userJwt}`,
              'apikey': process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
            },
            body: JSON.stringify(reqBody),
            signal: ac.signal,
          });
          text = await res.text();
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          console.error('[CHATBOT-RESOLVE] cashflow-report fetch failed:', res.status, text.slice(0, 500));
          return {
            data: null, metric, dimension,
            period: { from: period_from, to: period_to },
            preformatted: true,
            markdown: res.status === 401
              ? `The cashflow service rejected this request (401). Try logging out and back in to refresh your session.`
              : `Couldn't fetch the cashflow report (HTTP ${res.status}). Make sure the \`cashflow-report\` edge function is deployed (\`supabase functions deploy cashflow-report\`).`,
            suggestions: ['Show revenue by month', 'Try again'],
          };
        }
        try { report = JSON.parse(text); }
        catch { report = null; }
      } catch (fetchErr) {
        console.error('[CHATBOT-RESOLVE] cashflow-report fetch threw:', fetchErr?.message || fetchErr);
        const isAbort = fetchErr?.name === 'AbortError';
        return {
          data: null, metric, dimension,
          period: { from: period_from, to: period_to },
          preformatted: true,
          markdown: isAbort
            ? `The cashflow report service didn't respond in time. It may be cold-starting — please try again in a few seconds.`
            : `Couldn't reach the cashflow report service. (${fetchErr?.message || 'unknown error'})`,
          suggestions: ['Show revenue by month', 'Try again'],
        };
      }
      const vm = report?.returnObject || null;
      if (!vm || !Array.isArray(vm.columns) || vm.columns.length === 0) {
        return {
          data: null, metric, dimension,
          period: { from: period_from, to: period_to },
          preformatted: true,
          markdown: `No cashflow data for **${period_from} to ${period_to}**. Cashflow is computed from synced bank/payment data — try a longer period or check the Sync Summary page.`,
          suggestions: ['Cashflow this year', 'Cashflow last quarter', 'Show revenue by month'],
        };
      }

      const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const parseCol = (key) => {
        const parts = (key || '').split('-');
        if (parts.length !== 2) return null;
        const monthIdx = MONTH_ABBR.indexOf(parts[0]);
        if (monthIdx < 0) return null;
        const yy = parseInt(parts[1], 10);
        if (!Number.isFinite(yy)) return null;
        return { year: yy < 100 ? 2000 + yy : yy, month: monthIdx };
      };

      const findRow = (name) => (vm.totalRowDataSet || []).find((r) => r.name === name);
      const recRow = findRow('Total Received');
      const paidRow = findRow('Total Paid');
      const netRow = findRow('Net Cashflow');

      const startMs = new Date(period_from + 'T00:00:00').getTime();
      const endMs = new Date(period_to + 'T23:59:59').getTime();

      const monthly = [];
      vm.columns.forEach((col, i) => {
        const m = parseCol(col);
        if (!m) return;
        const monthStartMs = new Date(m.year, m.month, 1).getTime();
        const monthEndMs = new Date(m.year, m.month + 1, 0, 23, 59, 59, 999).getTime();
        if (monthEndMs < startMs || monthStartMs > endMs) return;
        const num = (v) => Number(v) || 0;
        monthly.push({
          key: `${m.year}-${String(m.month + 1).padStart(2, '0')}`,
          label: col,
          received: num(recRow?.colData?.[i]?.value),
          paid: num(paidRow?.colData?.[i]?.value),
          net: num(netRow?.colData?.[i]?.value),
        });
      });

      monthly.sort((a, b) => a.key.localeCompare(b.key));

      if (monthly.length === 0) {
        return {
          data: null, metric, dimension,
          period: { from: period_from, to: period_to },
          preformatted: true,
          markdown: `No cashflow months overlap **${period_from} to ${period_to}**. Try a wider range.`,
          suggestions: ['Cashflow this year', 'Cashflow last quarter'],
        };
      }

      const totalReceived = monthly.reduce((s, m) => s + m.received, 0);
      const totalPaid = monthly.reduce((s, m) => s + m.paid, 0);
      const totalNet = monthly.reduce((s, m) => s + m.net, 0);
      const fmt = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      let md = `### Cashflow by Month\n`;
      md += `**Period:** ${period_from} to ${period_to}\n\n`;
      md += `| Month | Received | Paid | Net Cashflow |\n`;
      md += `|-------|---------:|-----:|-------------:|\n`;
      for (const m of monthly) {
        md += `| ${m.label} | ${fmt(m.received)} | ${fmt(m.paid)} | ${fmt(m.net)} |\n`;
      }
      md += `| **Total** | **${fmt(totalReceived)}** | **${fmt(totalPaid)}** | **${fmt(totalNet)}** |\n`;

      return {
        data: monthly, metric, dimension,
        period: { from: period_from, to: period_to },
        preformatted: true,
        markdown: md,
        chart: {
          type: 'line',
          title: 'Net Cashflow by Month',
          labels: monthly.map((m) => m.label),
          values: monthly.map((m) => m.net),
          valueUnit: 'currency',
        },
        suggestions: ['Compare to revenue by month', 'Why is cashflow changing?', 'Show received vs paid'],
      };
    }

    // Get providers — filter to specific doctor if provided
    let query = supabaseAdmin
      .from('providers').select('external_id, name')
      .eq('organization_id', orgId).is('deleted_at', null);

    const { data: providers } = await query;

    let filteredProviders = providers || [];
    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      filteredProviders = filteredProviders.filter(p => p.name?.toLowerCase().includes(lower));
    } else {
      filteredProviders = filteredProviders.slice(0, 30);
    }

    let monthlyTotals = {};
    for (const prov of filteredProviders) {
      const { data } = await supabaseAdmin.rpc('get_provider_net_production_monthly', {
        p_organization_id: orgId, p_from_date: period_from, p_to_date: period_to,
        p_practitioner_id: prov.external_id, p_location_id: null,
      });
      for (const row of (data || [])) {
        const m = row.month;
        monthlyTotals[m] = (monthlyTotals[m] || 0) + parseFloat(row.total_amount || 0);
      }
    }

    const sorted = Object.entries(monthlyTotals).sort(([a], [b]) => a.localeCompare(b));
    const labels = sorted.map(([m]) => m);
    const values = sorted.map(([, v]) => v);

    return {
      data: sorted, metric, dimension,
      period: { from: period_from, to: period_to },
      chart: { type: 'line', title: `${metric} by Month`, labels, values, valueUnit: 'currency' },
      preformatted: false,
    };
  }

  if (dimension === 'category') {
    const tpis = await fetchCompletedTpis({
      orgId, periodFrom: period_from, periodTo: period_to,
      columns: 'tpi_price, tpi_treatment_id, tpi_patient_nomenclature',
    });

    const treatmentIds = Array.from(new Set((tpis || []).map(t => t.tpi_treatment_id).filter(Boolean)));
    const categoryByTreatment = new Map();
    if (treatmentIds.length > 0) {
      const { data: treatments } = await supabaseAdmin
        .from('treatments')
        .select('external_id, treatment_category')
        .eq('organization_id', orgId)
        .in('external_id', treatmentIds);
      for (const t of treatments || []) {
        categoryByTreatment.set(String(t.external_id), t.treatment_category || 'Uncategorized');
      }
    }

    const byCategory = {};
    for (const item of (tpis || [])) {
      const cat = categoryByTreatment.get(String(item.tpi_treatment_id))
        || item.tpi_patient_nomenclature
        || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + parseFloat(item.tpi_price || 0);
    }
    const sorted = Object.entries(byCategory).sort(([, a], [, b]) => b - a).slice(0, 12);
    const labels = sorted.map(([c]) => c);
    const values = sorted.map(([, v]) => v);

    return {
      data: sorted, metric, dimension,
      period: { from: period_from, to: period_to },
      chart: { type: 'bar', title: `${metric} by Category`, labels, values, valueUnit: 'currency' },
      preformatted: false,
    };
  }

  if (dimension === 'payor') {
    const tpis = await fetchCompletedTpis({
      orgId, periodFrom: period_from, periodTo: period_to,
      columns: 'tpi_price, tpi_payment_plan_id',
    });

    const byPayor = {};
    for (const item of tpis) {
      const payor = item.tpi_payment_plan_id ? `Plan ${item.tpi_payment_plan_id}` : 'Other';
      byPayor[payor] = (byPayor[payor] || 0) + parseFloat(item.tpi_price || 0);
    }
    const sorted = Object.entries(byPayor).sort(([, a], [, b]) => b - a);
    const labels = sorted.map(([p]) => p);
    const values = sorted.map(([, v]) => v);

    return {
      data: sorted, metric, dimension,
      period: { from: period_from, to: period_to },
      chart: { type: 'bar', title: `${metric} by Payor`, labels, values, valueUnit: 'currency' },
      preformatted: false,
    };
  }

  return { data: null, metric, dimension, preformatted: true, markdown: `Drill-down by "${dimension}" is not supported.`, suggestions: ['Try by month', 'Try by provider'] };
}

async function resolveExplainWhy(args, orgId) {
  const { metric, period_from, period_to, doctor_name, location_id } = args;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const valKey = metric === 'profit' ? 'periodic_profit' : 'production_amount';

  // Current period — pass location_id so a follow-up like "Why is trend down
  // 51.1%?" asked while looking at one location returns the drivers FOR THAT
  // location, not the whole org. Without this the chatbot can answer "Why is
  // Revenue ↑?" (org-wide is up) when the user is actually looking at one
  // site that's down — direction flipped, wrong drivers.
  const { data: current, error: err1 } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: period_from, p_end_date: period_to,
    p_organization_id: orgId, p_provider_type: null, p_location_id: location_id || null,
  });
  if (err1) throw err1;

  // Previous period (same duration, immediately before)
  const fromDate = new Date(period_from);
  const toDate = new Date(period_to);
  const diffMs = toDate - fromDate;
  const prevFrom = new Date(fromDate.getTime() - diffMs);
  const prevTo = new Date(fromDate.getTime() - 1);

  const { data: previous, error: err2 } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: prevFrom.toISOString().split('T')[0],
    p_end_date: prevTo.toISOString().split('T')[0],
    p_organization_id: orgId, p_provider_type: null, p_location_id: location_id || null,
  });
  if (err2) throw err2;

  // Build per-provider deltas
  const prevMap = {};
  for (const p of (previous || [])) {
    prevMap[p.provider_name] = parseFloat(p[valKey] || 0);
  }

  const drivers = (current || []).map(p => {
    const currVal = parseFloat(p[valKey] || 0);
    const prevVal = prevMap[p.provider_name] || 0;
    return { name: p.provider_name, current: currVal, previous: prevVal, delta: currVal - prevVal };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);

  const totalCurr = (current || []).reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
  const totalPrev = (previous || []).reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
  const totalDelta = totalCurr - totalPrev;
  const direction = totalDelta >= 0 ? 'up' : 'down';

  const locationName = location_id ? await resolveLocationName(orgId, location_id) : null;

  return {
    data: { drivers, totalCurr, totalPrev, totalDelta, direction },
    metric, doctorName: doctor_name,
    locationId: location_id || null,
    locationName,
    period: { from: period_from, to: period_to },
    preformatted: false,
  };
}

async function resolveForecast(args, orgId) {
  const { metric, months_forward, doctor_name } = args;
  const forward = Math.min(Math.max(months_forward || 3, 1), 6);

  // Get 12 months of historical data
  const now = new Date();
  const histStart = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const histEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const valKey = metric === 'profit' ? 'periodic_profit' : 'production_amount';

  // Fetch monthly totals
  const monthlyData = [];
  for (let i = 0; i < 12; i++) {
    const mStart = new Date(histStart.getFullYear(), histStart.getMonth() + i, 1);
    const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);

    const { data } = await supabaseAdmin.rpc(rpcName, {
      p_start_date: mStart.toISOString().split('T')[0],
      p_end_date: mEnd.toISOString().split('T')[0],
      p_organization_id: orgId, p_provider_type: null, p_location_id: null,
    });

    let total = (data || []).reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
    if (doctor_name) {
      const lower = doctor_name.toLowerCase();
      total = (data || []).filter(p => p.provider_name?.toLowerCase().includes(lower))
        .reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
    }

    const label = mStart.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    monthlyData.push({ label, value: total, index: i });
  }

  // Linear regression: y = mx + b
  const n = monthlyData.length;
  const sumX = monthlyData.reduce((s, d) => s + d.index, 0);
  const sumY = monthlyData.reduce((s, d) => s + d.value, 0);
  const sumXY = monthlyData.reduce((s, d) => s + d.index * d.value, 0);
  const sumX2 = monthlyData.reduce((s, d) => s + d.index * d.index, 0);

  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
  const b = (sumY - m * sumX) / n || 0;

  // Project forward
  const forecast = [];
  for (let i = 0; i < forward; i++) {
    const futureIndex = n + i;
    const projected = Math.max(0, m * futureIndex + b);
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = futureDate.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    forecast.push({ label, value: Math.round(projected * 100) / 100 });
  }

  const allLabels = [...monthlyData.map(d => d.label), ...forecast.map(d => d.label)];
  const actualValues = [...monthlyData.map(d => d.value), ...forecast.map(() => null)];
  const forecastValues = [...monthlyData.map(() => null), ...forecast.map(d => d.value)];

  return {
    data: { historical: monthlyData, forecast, slope: m, intercept: b },
    metric, doctorName: doctor_name,
    chart: {
      type: 'line', title: `${metric} Forecast (${forward} months)`,
      labels: allLabels, values: monthlyData.map(d => d.value),
      secondaryValues: [...Array(monthlyData.length).fill(null), ...forecast.map(d => d.value)],
      valueUnit: 'currency',
    },
    preformatted: false,
  };
}

async function resolveWhatIf(args, orgId) {
  const { metric, change_percent, period_from, period_to } = args;
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const valKey = metric === 'profit' ? 'periodic_profit' : 'production_amount';

  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_start_date: period_from, p_end_date: period_to,
    p_organization_id: orgId, p_provider_type: null, p_location_id: null,
  });
  if (error) throw error;

  const baseline = (data || []).reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
  const change = baseline * (change_percent / 100);
  const newTotal = baseline + change;

  return {
    data: { baseline, changePercent: change_percent, change, newTotal },
    metric,
    period: { from: period_from, to: period_to },
    preformatted: false,
  };
}

// ── Report resolvers ──

async function resolveGenerateReport(args, orgId) {
  const { report_type, period_from, period_to, doctor_name, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const metric = (report_type === 'pl' || report_type === 'profit') ? 'profit' : 'revenue';
  const rpcName = metric === 'profit' ? 'chart_get_profit_metrics' : 'chart_get_production_metrics';
  const valKey = metric === 'profit' ? 'periodic_profit' : 'production_amount';

  // RPC takes a single p_location_id. For one location pass it directly; for a
  // multi-location pick (location_ids) we fetch each and merge so the totals
  // match the Production page exactly (which scopes by location_id too).
  async function rpcForLocation(locId) {
    const { data, error } = await supabaseAdmin.rpc(rpcName, {
      p_start_date: period_from, p_end_date: period_to,
      p_organization_id: orgId,
      p_provider_type: args.provider_type || null,
      p_location_id: locId || null,
    });
    if (error) throw error;
    return data || [];
  }

  let results;
  if (locationIds && locationIds.length > 0) {
    // Sum across the requested sites by aggregating each site's RPC result on
    // provider_id. Avg-daily-production stays a per-site figure, so we keep
    // the highest one (the formatter only renders production_amount anyway).
    const agg = new Map();
    for (const locId of locationIds) {
      const rows = await rpcForLocation(locId);
      for (const r of rows) {
        const key = r.provider_id || r.provider_name;
        if (!agg.has(key)) {
          agg.set(key, { ...r, [valKey]: 0 });
        }
        const cur = agg.get(key);
        cur[valKey] = parseFloat(cur[valKey] || 0) + parseFloat(r[valKey] || 0);
      }
    }
    results = Array.from(agg.values())
      .sort((a, b) => parseFloat(b[valKey] || 0) - parseFloat(a[valKey] || 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  } else {
    results = await rpcForLocation(location_id || null);
  }

  if (doctor_name) {
    const lower = doctor_name.toLowerCase();
    results = results.filter(p => p.provider_name?.toLowerCase().includes(lower));
  }

  // Honor an explicit "top N" qualifier (set by the LLM classifier or local
  // pattern). Clamp to a sane range so a stray top=1000 doesn't dump every row.
  const topRaw = parseInt(args.top, 10);
  const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(topRaw, 50) : null;
  const renderRows = topN ? results.slice(0, topN) : results.slice(0, 20);
  const renderedTotal = renderRows.reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);
  const totalAll = results.reduce((s, p) => s + parseFloat(p[valKey] || 0), 0);

  const label = report_type === 'pl' ? 'P&L' : report_type === 'cashflow' ? 'Cashflow' : metric.charAt(0).toUpperCase() + metric.slice(1);

  // Scope label — prefer doctor, then explicit location_display, then resolve
  // location_id to a practice name, then fall back to "Whole Practice".
  let scope;
  if (doctor_name) {
    scope = doctor_name;
  } else if (locationIds && locationIds.length > 0) {
    scope = args.location_display || `${locationIds.length} locations`;
  } else if (location_id) {
    scope = (await resolveLocationName(orgId, location_id)) || 'Selected Location';
  } else {
    scope = 'Whole Practice';
  }

  const { formatDateDisplay } = require('./periodHelper');
  let md = `### ${label} Report — **${scope}**\n`;
  md += `**Period:** ${formatDateDisplay(period_from)} to ${formatDateDisplay(period_to)}\n\n`;
  md += `**Total ${label}:** £${totalAll.toLocaleString('en-GB', { minimumFractionDigits: 2 })}\n\n`;
  if (topN && results.length > topN) {
    md += `Showing top ${topN} of ${results.length} providers.\n\n`;
  }
  md += `| Provider | ${label} | Rank |\n`;
  md += `|----------|---------|------|\n`;
  for (const p of renderRows) {
    const val = parseFloat(p[valKey] || 0);
    md += `| ${p.provider_name || 'Unknown'} | £${val.toLocaleString('en-GB', { minimumFractionDigits: 2 })} | #${p.rank || '-'} |\n`;
  }
  if (topN && results.length > topN) {
    md += `| **Subtotal (top ${topN})** | **£${renderedTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })}** | |\n`;
  }

  return {
    data: results,
    total: totalAll,
    metric,
    reportType: report_type,
    doctorName: doctor_name,
    locationId: location_id || null,
    locationIds,
    period: { from: period_from, to: period_to },
    reportReady: true,
    preformatted: true,
    markdown: md,
    suggestions: ['Download PDF', 'Email this report', 'Show chart'],
  };
}

async function resolveEmailReport(args, orgId, context) {
  try {
    const { email_address } = args;

    // Use previous context for report params if not provided
    const reportType = args.report_type || context?.currentMetric || 'revenue';
    const periodFrom = args.period_from || context?.currentPeriod?.from;
    const periodTo = args.period_to || context?.currentPeriod?.to;
    const doctorName = args.doctor_name || context?.currentDoctor;

    if (!email_address || typeof email_address !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_address.trim())) {
      return {
        preformatted: true,
        markdown: 'Please provide a valid email address. For example: "email this report to john@example.com"',
        suggestions: ['Show revenue', 'Download PDF'],
      };
    }

    if (!periodFrom || !periodTo) {
      return {
        preformatted: true,
        markdown: "I don't have a time period in mind for this report. Tell me the period first — e.g., \"P&L report for December 2025\" — then ask me to email it.",
        suggestions: ['P&L this month', 'Revenue last quarter', 'Cashflow this year'],
      };
    }

    // SMTP must be configured. If it isn't, fail loud here rather than via a
    // cryptic nodemailer connection error 30 seconds later.
    const smtpUser = process.env.MAIL_USERNAME || process.env.SMTP_USER;
    const smtpPass = process.env.MAIL_PASSWORD || process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      console.warn('[CHATBOT-EMAIL] Missing SMTP credentials (MAIL_USERNAME/MAIL_PASSWORD or SMTP_USER/SMTP_PASS)');
      return {
        preformatted: true,
        markdown: "Email sending isn't configured on this server yet. Please ask an administrator to set the SMTP credentials, or use **Download PDF** instead.",
        suggestions: ['Download PDF', 'Show revenue', 'Show profit'],
      };
    }

    // Generate PDF
    const reportService = require('./reportService');
    const normalisedReportType = reportType === 'profit' ? 'pl' : reportType;
    const doc = await reportService.generateReport(
      normalisedReportType,
      orgId, periodFrom, periodTo, doctorName
    );
    if (!doc) {
      throw new Error(`PDF generator returned no document for report type "${normalisedReportType}".`);
    }

    // Buffer the PDF
    const pdfBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });

    // Send email
    const emailService = require('./emailService');
    await emailService.sendReportEmail({
      to: email_address.trim(),
      subject: `DentPulse ${reportType.toUpperCase()} Report${doctorName ? ' — ' + doctorName : ''}`,
      body: `<p>Please find your ${reportType} report attached.</p><p>Period: ${periodFrom} to ${periodTo}${doctorName ? '<br>Provider: ' + doctorName : ''}</p><p>Generated by DentPulse AI</p>`,
      pdfBuffer,
      pdfFilename: `dentpulse-${reportType}-report.pdf`,
      userId: context?.userId || orgId,
    });

    return {
      preformatted: true,
      markdown: `Report sent successfully to **${email_address}**.\n\nReport: ${reportType.toUpperCase()}${doctorName ? ' — ' + doctorName : ''}\nPeriod: ${periodFrom} to ${periodTo}`,
      suggestions: ['Send to another email', 'Download PDF', 'Show revenue'],
    };
  } catch (err) {
    console.error('[CHATBOT-EMAIL] resolveEmailReport failed:', err.message, err.stack?.split('\n').slice(0, 4).join('\n'));
    const reason = err.code === 'EAUTH'
      ? 'SMTP authentication failed — check the mail credentials.'
      : err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT'
        ? 'Could not reach the mail server.'
        : (err.message || 'Unknown error.');
    return {
      preformatted: true,
      markdown: `Failed to send the email. ${reason}`,
      suggestions: ['Try again', 'Download PDF instead'],
    };
  }
}

// ── Recommendations: "suggest" / "what should I focus on" / "tips" ──
// Delegates to the existing recommendationService so the chatbot returns the
// same actionable items the dashboard's recommendations widget would show.
async function resolveRecommendations(args, orgId) {
  const recommendationService = require('./recommendationService');
  let recs = [];
  try {
    recs = await recommendationService.getRecommendations(orgId);
    // Empty list — generate a fresh batch so the user sees something useful
    // rather than a blank reply.
    if (!recs || recs.length === 0) {
      await recommendationService.generateRecommendations(orgId);
      recs = await recommendationService.getRecommendations(orgId);
    }
  } catch (err) {
    console.error('[CHATBOT-RESOLVE] recommendations failed:', err.message);
  }
  return {
    preformatted: false,
    recommendations: recs || [],
    period: { from: args.period_from || null, to: args.period_to || null },
  };
}

// ── Attendance / DNA: mirrors the Location History page exactly ──
// Prefers the page's already-computed snapshot (passed via pageContext.data)
// so the chat shows the exact same numbers as the page — no DB roundtrip, no
// drift. Falls back to a direct appointments query when the user isn't on the
// page (e.g. asking "DNA rate" from a different screen).
async function resolveAttendanceMetric(args, orgId, context = {}) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;

  // ── Page-snapshot path ──────────────────────────────────────────────
  // When the Location History page is open, it ships its computed summary
  // and provider stats in pageContext.data. Use them directly so the
  // chatbot reads from the page rather than the database.
  const pageCtx = context && context.pageContext;
  const isOnLocationHistory = pageCtx && pageCtx.page === 'location-history' && pageCtx.data;
  // Only trust the snapshot when the user's requested location matches the
  // page's location — otherwise fall through to a fresh query.
  const snapshotMatches = isOnLocationHistory &&
    pageCtx.data.location &&
    (!location_id || pageCtx.data.location.id === location_id);
  if (snapshotMatches) {
    const s = pageCtx.data.summary || {};
    const provs = Array.isArray(pageCtx.data.providers) ? pageCtx.data.providers : [];
    const dr = pageCtx.data.dateRange || {};
    const byProvider = provs
      .map(p => ({
        provider_name: p.name,
        total: p.appointments?.total || 0,
        completed: p.appointments?.completed || 0,
        cancelled: p.appointments?.cancelled || 0,
        dna: p.appointments?.dna || 0,
      }))
      .filter(p => p.dna > 0 || p.total > 0)
      .sort((a, b) => b.dna - a.dna);
    return {
      preformatted: false,
      metric: 'attendance',
      period: { from: dr.from || period_from, to: dr.to || period_to },
      locationId: pageCtx.data.location.id,
      locationName: pageCtx.data.location.name,
      summary: {
        total: s.totalAppts || 0,
        completed: s.completedAppts || 0,
        cancelled: s.cancelledAppts || 0,
        dna: s.dnaAppts || 0,
      },
      byProvider,
      _source: 'page-snapshot',
    };
  }

  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  async function countForLocation(locId) {
    if (!locId) return { total: 0, completed: 0, cancelled: 0, dna: 0, byProvider: [] };

    // 1. Providers attached to this location.
    const { data: providers } = await supabaseAdmin
      .from('providers')
      .select('id, external_id, name')
      .eq('organization_id', orgId)
      .eq('location_id', locId)
      .is('deleted_at', null);
    const extIds = (providers || []).map(p => p.external_id).filter(id => id != null);
    if (extIds.length === 0) return { total: 0, completed: 0, cancelled: 0, dna: 0, byProvider: [] };
    const nameByExt = new Map();
    for (const p of providers) {
      if (p.external_id != null) nameByExt.set(p.external_id, p.name);
    }

    // 2. Appointments in range for those providers (paginate so we don't get
    //    silently capped at Supabase's ~1000-row default).
    const PAGE = 1000;
    let cursor = null;
    const appts = [];
    while (true) {
      let q = supabaseAdmin
        .from('appointments')
        .select('id, apmt_practitioner_id, apmt_state, apmt_start_time')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .not('apmt_patient_id', 'is', null)
        .gte('apmt_start_time', period_from)
        .lte('apmt_start_time', period_to + 'T23:59:59')
        .in('apmt_practitioner_id', extIds)
        .order('id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('id', cursor);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      appts.push(...data);
      if (data.length < PAGE) break;
      cursor = data[data.length - 1].id;
    }

    // 3. Classify by apmt_state — same rules as useLocationHistory.ts.
    let completed = 0, cancelled = 0, dna = 0;
    const byProvAgg = new Map();
    for (const a of appts) {
      const state = (a.apmt_state || '').toLowerCase();
      const pid = a.apmt_practitioner_id;
      if (!byProvAgg.has(pid)) byProvAgg.set(pid, { provider_name: nameByExt.get(pid) || `Provider ${pid}`, total: 0, completed: 0, cancelled: 0, dna: 0 });
      const c = byProvAgg.get(pid);
      c.total++;
      if (state === 'cancelled') { cancelled++; c.cancelled++; }
      else if (state === 'did not attend' || state === 'dna') { dna++; c.dna++; }
      else if (state === 'completed') { completed++; c.completed++; }
    }
    const total = completed + cancelled + dna; // ignore other states (in-progress, scheduled, …)
    const byProvider = Array.from(byProvAgg.values())
      .filter(p => p.dna > 0 || p.total > 0)
      .sort((a, b) => b.dna - a.dna);
    return { total, completed, cancelled, dna, byProvider };
  }

  // Aggregate across one or many locations.
  let agg = { total: 0, completed: 0, cancelled: 0, dna: 0, byProvider: [] };
  const targetLocs = locationIds && locationIds.length > 0 ? locationIds : (location_id ? [location_id] : []);
  if (targetLocs.length === 0) {
    return {
      preformatted: true,
      markdown:
        `### Attendance / DNA Rate\n\n` +
        `Tell me which location you want, e.g., *"DNA rate this month at South Street"*. The numbers come from the same appointments view the Location History page uses.`,
      suggestions: ['DNA rate this month', 'Compare locations', 'Show whole practice'],
    };
  }
  for (const loc of targetLocs) {
    const r = await countForLocation(loc);
    agg.total += r.total;
    agg.completed += r.completed;
    agg.cancelled += r.cancelled;
    agg.dna += r.dna;
    // Merge byProvider across locations on provider_name.
    for (const p of r.byProvider) {
      const existing = agg.byProvider.find(x => x.provider_name === p.provider_name);
      if (existing) {
        existing.total += p.total; existing.completed += p.completed;
        existing.cancelled += p.cancelled; existing.dna += p.dna;
      } else {
        agg.byProvider.push({ ...p });
      }
    }
  }
  agg.byProvider.sort((a, b) => b.dna - a.dna);

  return {
    preformatted: false,
    metric: 'attendance',
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName,
    summary: { total: agg.total, completed: agg.completed, cancelled: agg.cancelled, dna: agg.dna },
    byProvider: agg.byProvider,
  };
}

// ── DNA / no-show patient list ──────────────────────────────────────────────
// Returns the individual appointments (patient name, scheduled date, booked
// date, practitioner) marked "Did not attend" for the given location/period.
// Asked when the user says "list the 35 DNA patients", "show DNA patients",
// "who didn't attend", etc. — the page only shows the DNA count, so we have
// to hit the database for row-level detail.
async function resolveListDNAPatients(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const targetLocs = locationIds && locationIds.length > 0 ? locationIds : (location_id ? [location_id] : []);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown:
        `### DNA patient list\n\n` +
        `Tell me the period, e.g. *"list DNA patients for March 2026 at South Street"*. I'll pull the names, scheduled dates, and when each was booked.`,
      suggestions: ['DNA patients this month', 'DNA patients last month', 'Try a wider period'],
    };
  }
  if (targetLocs.length === 0) {
    return {
      preformatted: true,
      markdown:
        `### DNA patient list\n\n` +
        `Tell me which location, e.g. *"DNA patients in March 2026 at South Street"*. The data comes straight from the appointments table.`,
      suggestions: ['Compare locations', 'Show whole practice', 'Try a wider period'],
    };
  }

  // Resolve location name + provider external_ids for the location set.
  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  const allRows = [];
  const seenLocNames = [];
  for (const locId of targetLocs) {
    // Providers at this location → their external_ids (apmt_practitioner_id
    // references practitioner external_id, same join used in
    // resolveAttendanceMetric).
    const { data: providers } = await supabaseAdmin
      .from('providers')
      .select('external_id, name')
      .eq('organization_id', orgId)
      .eq('location_id', locId)
      .is('deleted_at', null);
    const extIds = (providers || []).map(p => p.external_id).filter(id => id != null);
    if (extIds.length === 0) continue;

    if (locationIds) {
      const { data: locRow } = await supabaseAdmin
        .from('practice_locations')
        .select('location_name')
        .eq('id', locId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (locRow?.location_name) seenLocNames.push(locRow.location_name);
    }

    // Paginate so we never hit the silent 1000-row cap.
    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('appointments')
        .select('id, apmt_patient_id, apmt_patient_name, apmt_practitioner_id, apmt_practitioner_name, apmt_start_time, apmt_created_at, apmt_did_not_attend_at, apmt_state')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .in('apmt_state', ['Did not attend', 'did not attend', 'DNA', 'dna'])
        .gte('apmt_start_time', period_from)
        .lte('apmt_start_time', period_to + 'T23:59:59')
        .in('apmt_practitioner_id', extIds)
        .order('id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('id', cursor);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      cursor = data[data.length - 1].id;
    }
  }

  // Sort by scheduled date desc — most recent first reads naturally for "the
  // 35 DNAs in March".
  allRows.sort((a, b) => {
    const ta = a.apmt_start_time || '';
    const tb = b.apmt_start_time || '';
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });

  return {
    preformatted: false,
    metric: 'dna_patient_list',
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName: locationIds ? (seenLocNames.length > 0 ? seenLocNames.join(', ') : locationName) : locationName,
    count: allRows.length,
    rows: allRows.map(r => ({
      patient_name: r.apmt_patient_name || (r.apmt_patient_id ? `Patient ${r.apmt_patient_id}` : 'Unknown patient'),
      patient_id: r.apmt_patient_id,
      practitioner_name: r.apmt_practitioner_name || (r.apmt_practitioner_id ? `Provider ${r.apmt_practitioner_id}` : '—'),
      appointment_start: r.apmt_start_time,
      booked_at: r.apmt_created_at,
      marked_dna_at: r.apmt_did_not_attend_at,
    })),
  };
}

// ── Row-level appointment patient list by state ─────────────────────
// Shared resolver that powers list_dna_patients + list_cancelled_patients
// (and is easy to extend for completed/scheduled if asked for later).
// `stateKey` is the canonical label used downstream by the formatter and
// `stateMatches` is the set of apmt_state values the appointments table
// actually stores for that category — case variants intentionally listed.
const STATE_CONFIG = {
  dna: {
    label: 'DNA',
    matches: ['Did not attend', 'did not attend', 'DNA', 'dna'],
    titlePlural: 'DNA Patients',
    titleSingular: 'DNA Patient',
  },
  cancelled: {
    label: 'Cancelled',
    matches: ['Cancelled', 'cancelled', 'Canceled', 'canceled'],
    titlePlural: 'Cancelled Appointment Patients',
    titleSingular: 'Cancelled Appointment Patient',
  },
  completed: {
    label: 'Completed',
    matches: ['Completed', 'completed', 'Complete', 'complete', 'Arrived', 'arrived'],
    titlePlural: 'Completed Appointments',
    titleSingular: 'Completed Appointment',
  },
  scheduled: {
    label: 'Scheduled',
    matches: ['Scheduled', 'scheduled', 'Booked', 'booked', 'Confirmed', 'confirmed'],
    titlePlural: 'Scheduled Appointments',
    titleSingular: 'Scheduled Appointment',
  },
  any: {
    label: 'All',
    matches: null, // null → no state filter, return every row
    titlePlural: 'Appointments',
    titleSingular: 'Appointment',
  },
};

async function resolveAppointmentPatientList(args, orgId, stateKey) {
  const cfg = STATE_CONFIG[stateKey];
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) ? args.location_ids : null;
  const targetLocs = locationIds && locationIds.length > 0 ? locationIds : (location_id ? [location_id] : []);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown:
        `### ${cfg.titleSingular} list\n\n` +
        `Tell me the period, e.g. *"list ${cfg.label.toLowerCase()} patients for March 2026 at South Street"*. I'll pull the names and dates.`,
      suggestions: [`${cfg.label} patients this month`, `${cfg.label} patients last month`, 'Try a wider period'],
    };
  }
  if (targetLocs.length === 0) {
    return {
      preformatted: true,
      markdown:
        `### ${cfg.titleSingular} list\n\n` +
        `Tell me which location, e.g. *"${cfg.label.toLowerCase()} patients in March 2026 at South Street"*. The data comes straight from the appointments table.`,
      suggestions: ['Compare locations', 'Show whole practice', 'Try a wider period'],
    };
  }

  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : await resolveLocationName(orgId, location_id);

  const allRows = [];
  const seenLocNames = [];
  for (const locId of targetLocs) {
    const { data: providers } = await supabaseAdmin
      .from('providers')
      .select('external_id, name')
      .eq('organization_id', orgId)
      .eq('location_id', locId)
      .is('deleted_at', null);
    const extIds = (providers || []).map(p => p.external_id).filter(id => id != null);
    if (extIds.length === 0) continue;

    if (locationIds) {
      const { data: locRow } = await supabaseAdmin
        .from('practice_locations')
        .select('location_name')
        .eq('id', locId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (locRow?.location_name) seenLocNames.push(locRow.location_name);
    }

    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('appointments')
        .select('id, apmt_patient_id, apmt_patient_name, apmt_practitioner_id, apmt_practitioner_name, apmt_start_time, apmt_created_at, apmt_did_not_attend_at, apmt_cancelled_at, apmt_state')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .gte('apmt_start_time', period_from)
        .lte('apmt_start_time', period_to + 'T23:59:59')
        .in('apmt_practitioner_id', extIds)
        .order('id')
        .limit(PAGE);
      if (cfg.matches) q = q.in('apmt_state', cfg.matches);
      if (cursor != null) q = q.gt('id', cursor);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      cursor = data[data.length - 1].id;
    }
  }

  allRows.sort((a, b) => {
    const ta = a.apmt_start_time || '';
    const tb = b.apmt_start_time || '';
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });

  return {
    preformatted: false,
    metric: `${stateKey}_patient_list`,
    state: stateKey,
    period: { from: period_from, to: period_to },
    locationId: location_id || null,
    locationName: locationIds ? (seenLocNames.length > 0 ? seenLocNames.join(', ') : locationName) : locationName,
    count: allRows.length,
    rows: allRows.map(r => ({
      patient_name: r.apmt_patient_name || (r.apmt_patient_id ? `Patient ${r.apmt_patient_id}` : 'Unknown patient'),
      patient_id: r.apmt_patient_id,
      practitioner_name: r.apmt_practitioner_name || (r.apmt_practitioner_id ? `Provider ${r.apmt_practitioner_id}` : '—'),
      appointment_start: r.apmt_start_time,
      booked_at: r.apmt_created_at,
      marked_dna_at: r.apmt_did_not_attend_at,
      cancelled_at: r.apmt_cancelled_at,
    })),
  };
}

async function resolveListCancelledPatients(args, orgId) {
  return resolveAppointmentPatientList(args, orgId, 'cancelled');
}

// Generic appointment-list tool. Accepts a `state` arg so the user can ask
// "list completed appointments at South Street last month", "show today's
// scheduled appointments", etc. Unknown states fall back to `any` (no filter).
async function resolveListAppointments(args, orgId) {
  const requested = String(args.state || 'any').toLowerCase().trim();
  const aliasMap = {
    dna: 'dna', 'did not attend': 'dna', 'no show': 'dna', 'no-show': 'dna', missed: 'dna',
    cancelled: 'cancelled', canceled: 'cancelled', cancellation: 'cancelled',
    completed: 'completed', complete: 'completed', arrived: 'completed', attended: 'completed',
    scheduled: 'scheduled', booked: 'scheduled', confirmed: 'scheduled', upcoming: 'scheduled',
    all: 'any', any: 'any', '*': 'any', '': 'any',
  };
  const stateKey = aliasMap[requested] || (STATE_CONFIG[requested] ? requested : 'any');
  return resolveAppointmentPatientList(args, orgId, stateKey);
}

// Conversational BI — delegate to the deterministic dashboard pipeline.
// Returns a preformatted result carrying a `dashboard` payload; v2Handler
// surfaces it on the response (feature-gated) and persists it.
async function resolveDashboard(args, orgId, context) {
  const orchestrator = require('./bi/dashboardOrchestrator');
  return orchestrator.run({ args: args || {} }, orgId, context || {});
}

/**
 * Plan Mix — revenue distribution by payment plan. Reproduces the Treatment
 * Insights "Plan Mix" donut EXACTLY (useTreatmentInsights.ts): completed TPIs
 * with a payment plan, joined to payment_plans for the plan name, excluding
 * charting rows (tpi_treatment_appointment_id <= 0) and non-positive prices,
 * grouped by plan, revenue + share %. Reuses the audited fetchCompletedTpis()
 * so totals reconcile with the page (project rule: mirror the page, no
 * misleading numbers).
 */
async function resolvePlanMix(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) && args.location_ids.length > 0
    ? args.location_ids
    : null;

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"plan mix for last month"*.',
      suggestions: ['Plan mix this month', 'Plan mix last quarter', 'Plan mix this year'],
    };
  }

  const locationName = locationIds
    ? (args.location_display || `${locationIds.length} locations`)
    : ((await resolveLocationName(orgId, location_id)) || 'All locations');

  // pp_id → plan name (same source/columns as useTreatmentInsights).
  const planNameById = new Map();
  {
    const { data: plans, error } = await supabaseAdmin
      .from('payment_plans')
      .select('pp_id, pp_name')
      .eq('organization_id', orgId)
      .is('deleted_at', null);
    if (error) return dbReadFailure(error, 'payment plans', { period_from, period_to });
    for (const p of plans || []) {
      if (p && p.pp_id != null) {
        const k = Number(p.pp_id);
        if (Number.isFinite(k)) planNameById.set(k, p.pp_name || 'Unknown Plan');
      }
    }
  }

  let tpis;
  try {
    tpis = await fetchCompletedTpis({
      orgId,
      periodFrom: period_from,
      periodTo: period_to,
      locationId: location_id || null,
      locationIds,
      columns: 'tpi_price, tpi_payment_plan_id, tpi_treatment_appointment_id',
      activeProvidersOnly: true, // Treatment Insights page rule (aligned with Practitioner History)
    });
  } catch (err) {
    return dbReadFailure(err, 'treatment revenue', { period_from, period_to });
  }

  // Group by plan — identical filters to the page's treatmentMix:
  // skip charting (taId <= 0) and non-positive prices.
  const byPlan = new Map(); // name → { revenue, count }
  for (const r of tpis) {
    if (Number(r.tpi_treatment_appointment_id || 0) <= 0) continue;
    const price = Number(r.tpi_price) || 0;
    if (price <= 0) continue;
    const ppId = r.tpi_payment_plan_id != null ? Number(r.tpi_payment_plan_id) : null;
    const name = (ppId != null ? planNameById.get(ppId) : null)
      || (ppId != null ? 'Unknown Plan' : 'No Plan');
    const g = byPlan.get(name) || { revenue: 0, count: 0 };
    g.revenue += price;
    g.count += 1;
    byPlan.set(name, g);
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const total = [...byPlan.values()].reduce((s, g) => s + g.revenue, 0);
  const data = [...byPlan.entries()]
    .map(([plan, g]) => ({
      plan,
      revenue: round2(g.revenue),
      count: g.count,
      sharePercent: total > 0 ? round2((g.revenue / total) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    preformatted: false,
    metric: 'plan_mix',
    locationName,
    period: { from: period_from, to: period_to },
    total: round2(total),
    data,
  };
}

/**
 * NHS Contract Performance — headline + per-provider, mirroring
 * useNHSContractPerformance.ts EXACTLY for the unambiguous numbers
 * (single-source-of-truth rule). NO RPC exists for this page, so the
 * fee/UDA formulas are replicated verbatim and must reconcile £/UDA-for-
 * £/UDA against the NHS Contract Performance page (acceptance gate).
 *
 * Deliberately scoped: totals + per-provider only. Band normalization,
 * risk signals and the Scottish/English chart variants depend on private
 * page helpers — those stay answered via the page's own aiContext
 * (the page emits it); replicating them here would drift. See
 * docs/chatbot-coverage-audit.md.
 *
 * Unified fee helpers (hook lines 153-170) — handle English (dentist
 * charge) and Scottish (scot amounts) without branching:
 *   feeExpected = nc_scot_amount_expected  > 0 ? nc_scot_amount_expected  : (nc_dentist_charge || 0)
 *   feeAwarded  = nc_scot_amount_authorised> 0 ? nc_scot_amount_authorised: (nc_dentist_charge || 0)
 *   revenue     = feeExpected + (nc_patient_charge || 0)
 */
function _nhsFeeExpected(c) {
  const scot = Number(c.nc_scot_amount_expected) || 0;
  return scot > 0 ? scot : (Number(c.nc_dentist_charge) || 0);
}
function _nhsFeeAwarded(c) {
  const scot = Number(c.nc_scot_amount_authorised) || 0;
  return scot > 0 ? scot : (Number(c.nc_dentist_charge) || 0);
}

async function resolveNhsPerformance(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) && args.location_ids.length > 0
    ? args.location_ids
    : (location_id ? [location_id] : null);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"NHS contract performance last quarter"*.',
      suggestions: ['NHS performance this year', 'NHS performance last quarter', 'UDA delivery this month'],
    };
  }

  const locationName = locationIds
    ? (args.location_display || (locationIds.length === 1
        ? ((await resolveLocationName(orgId, locationIds[0])) || 'Selected location')
        : `${locationIds.length} locations`))
    : 'All locations';

  // Location set → matching site UUIDs (claims carry nc_site_id =
  // practice_locations.api_record_unique_id, OR a direct location_id).
  let apiSiteIds = null;
  if (locationIds) {
    const { data: locs, error: locErr } = await supabaseAdmin
      .from('practice_locations')
      .select('id, api_record_unique_id')
      .eq('organization_id', orgId)
      .in('id', locationIds)
      .is('deleted_at', null);
    if (locErr) return dbReadFailure(locErr, 'location mapping', { period_from, period_to });
    apiSiteIds = new Set((locs || []).map(l => l.api_record_unique_id).filter(Boolean).map(String));
  }

  // Completed claims in the period (paginate on nc_id; nhs_claims can
  // exceed Supabase's ~1000 cap).
  const claims = [];
  {
    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('nhs_claims')
        .select('nc_id, nc_expected_uda, nc_dentist_charge, nc_patient_charge, nc_practitioner_id, nc_scot_amount_expected, nc_scot_amount_authorised, nc_site_id, location_id')
        .eq('organization_id', orgId)
        .eq('nc_claim_status', 'completed')
        .is('deleted_at', null)
        .gte('nc_submitted_date', period_from)
        .lte('nc_submitted_date', period_to + 'T23:59:59')
        .order('nc_id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('nc_id', cursor);
      const { data: page, error } = await q;
      if (error) return dbReadFailure(error, 'NHS claims', { period_from, period_to });
      if (!page || page.length === 0) break;
      claims.push(...page);
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].nc_id;
    }
  }

  // Location filter in JS (mirrors the hook: location_id IN set OR
  // nc_site_id IN matched api_record_unique_ids).
  const inScope = apiSiteIds
    ? claims.filter(c =>
        (c.location_id != null && locationIds.includes(c.location_id))
        || (c.nc_site_id != null && apiSiteIds.has(String(c.nc_site_id))))
    : claims;

  // Active providers → uda_target + name/role (matched by external_id).
  const providerByExtId = new Map();
  let totalUDATarget = 0;
  {
    const PAGE = 1000;
    let cursor = null;
    while (true) {
      let q = supabaseAdmin
        .from('providers')
        .select('id, external_id, name, provider_role, uda_target')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('id')
        .limit(PAGE);
      if (cursor != null) q = q.gt('id', cursor);
      const { data: page, error } = await q;
      if (error) return dbReadFailure(error, 'providers', { period_from, period_to });
      if (!page || page.length === 0) break;
      for (const p of page) {
        if (p.external_id != null) providerByExtId.set(String(p.external_id), p);
        totalUDATarget += Number(p.uda_target) || 0;
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  let totalUDADelivered = 0, totalFeeExpected = 0, totalFeeAwarded = 0, totalPatientCharge = 0;
  const byProv = new Map(); // extId → { feeExpected, feeAwarded, claims }
  for (const c of inScope) {
    const fe = _nhsFeeExpected(c);
    const fa = _nhsFeeAwarded(c);
    totalUDADelivered += Number(c.nc_expected_uda) || 0;
    totalFeeExpected += fe;
    totalFeeAwarded += fa;
    totalPatientCharge += Number(c.nc_patient_charge) || 0;
    const pid = c.nc_practitioner_id != null ? String(c.nc_practitioner_id) : '—';
    const g = byProv.get(pid) || { feeExpected: 0, feeAwarded: 0, claims: 0 };
    g.feeExpected += fe;
    g.feeAwarded += fa;
    g.claims += 1;
    byProv.set(pid, g);
  }

  const ytdRevenue = totalFeeExpected + totalPatientCharge;
  const providers = [...byProv.entries()].map(([pid, g]) => {
    const p = providerByExtId.get(pid);
    return {
      name: p ? p.name : `Practitioner #${pid}`,
      role: (p && p.provider_role) || '—',
      feeExpected: round2(g.feeExpected),
      feeAwarded: round2(g.feeAwarded),
      claims: g.claims,
      deliveryPct: g.feeExpected > 0 ? Math.round((g.feeAwarded / g.feeExpected) * 100) : 0,
    };
  }).sort((a, b) => b.feeExpected - a.feeExpected);

  return {
    preformatted: false,
    metric: 'nhs_performance',
    locationName,
    period: { from: period_from, to: period_to },
    totals: {
      claimCount: inScope.length,
      udaTarget: round2(totalUDATarget),
      udaDelivered: round2(totalUDADelivered),
      udaDeliveryPct: totalUDATarget > 0 ? round2((totalUDADelivered / totalUDATarget) * 100) : 0,
      feeExpected: round2(totalFeeExpected),
      feeAwarded: round2(totalFeeAwarded),
      feeDeliveryPct: totalFeeExpected > 0 ? round2((totalFeeAwarded / totalFeeExpected) * 100) : 0,
      patientCharge: round2(totalPatientCharge),
      ytdRevenue: round2(ytdRevenue),
      avgRatePerClaim: inScope.length > 0 ? round2(totalFeeExpected / inScope.length) : 0,
    },
    providers,
  };
}

/**
 * Membership Performance — members + membership revenue per plan, mirroring
 * useMembershipPerformance.ts EXACTLY for the cleanly-reconcilable numbers
 * (single-source-of-truth rule; no RPC exists for this page).
 *
 * DELIBERATELY SCOPED — only the deterministic, page-reconcilable figures:
 *  - membership-plan filter (exclude pp_name containing 'nhs'/'private')
 *  - member count: tpiPatients.size > 0 ? tpiPatients : appointmentPatients
 *  - revenue: tpiRevenue > 0 ? tpi : invoice > 0 ? invoice : members*fee
 *  - plan fee, totals.
 * NOT emitted (would not reconcile / is fake — would violate the accuracy
 * rule): costs / net profit / margin / status (the page recalculates these
 * with a complex non-linear treatment-cost stack — drift-prone to mirror),
 * and avgTenureMonths (the page uses Math.random() — not real data). Those
 * stay answered via the Membership page's own aiContext. See
 * docs/chatbot-coverage-audit.md.
 */
async function resolveMembershipPerformance(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) && args.location_ids.length > 0
    ? args.location_ids
    : (location_id ? [location_id] : null);

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"membership performance last month"*.',
      suggestions: ['Membership performance this month', 'Membership this quarter', 'Membership this year'],
    };
  }

  const locationName = locationIds
    ? (args.location_display || (locationIds.length === 1
        ? ((await resolveLocationName(orgId, locationIds[0])) || 'Selected location')
        : `${locationIds.length} locations`))
    : 'All locations';

  const startISO = `${period_from}T00:00:00.000Z`;
  const endISO = `${period_to}T23:59:59.999Z`;

  // Active payment plans → membership plans only (exclude NHS / Private,
  // case-insensitive — mirrors the hook's filter).
  const plans = [];
  {
    const { data, error } = await supabaseAdmin
      .from('payment_plans')
      .select('pp_id, pp_name, pp_monthly_memberhsip_fee, pp_patient_friendly_name')
      .eq('organization_id', orgId)
      .eq('pp_is_active', true)
      .is('deleted_at', null);
    if (error) return dbReadFailure(error, 'payment plans', { period_from, period_to });
    for (const p of data || []) {
      const nm = String(p.pp_name || '').toLowerCase();
      if (nm.includes('nhs') || nm.includes('private')) continue;
      plans.push(p);
    }
  }
  if (plans.length === 0) {
    return {
      preformatted: false,
      metric: 'membership_performance',
      locationName,
      period: { from: period_from, to: period_to },
      totals: { totalMembers: 0, membershipRevenue: 0, planCount: 0 },
      plans: [],
    };
  }

  const patientPlan = new Map();          // patientId → planId
  const apptMembers = new Map();          // planId → Set(patientId)
  const tpiMembers = new Map();           // planId → Set(patientId)
  const tpiRevenue = new Map();           // planId → £
  const invRevenue = new Map();           // planId → £

  try {
  // patient → plan id (paginate on pt_id).
  await paginate('patients', 'pt_id', q => q
    .select('pt_id, pt_payment_plan_id')
    .eq('organization_id', orgId)
    .not('pt_payment_plan_id', 'is', null)
    .is('deleted_at', null),
    row => { patientPlan.set(row.pt_id, Number(row.pt_payment_plan_id)); });

  // Completed appointments in period → appointment-based members per plan.
  await paginate('appointments', 'apmt_id', q => {
    let qq = q.select('apmt_id, apmt_patient_id')
      .eq('apmt_state', 'Completed')
      .gte('apmt_start_time', startISO)
      .lte('apmt_start_time', endISO)
      .is('deleted_at', null);
    if (locationIds) qq = locationIds.length === 1 ? qq.eq('location_id', locationIds[0]) : qq.in('location_id', locationIds);
    return qq;
  }, row => {
    const pid = patientPlan.get(row.apmt_patient_id);
    if (pid == null) return;
    if (!apptMembers.has(pid)) apptMembers.set(pid, new Set());
    apptMembers.get(pid).add(row.apmt_patient_id);
  });

  // Completed TPIs in period → tpi members + tpi revenue per plan.
  await paginate('treatment_plan_items', 'tpi_id', q => {
    let qq = q.select('tpi_id, tpi_payment_plan_id, tpi_patient_id, tpi_price, location_id')
      .eq('organization_id', orgId)
      .eq('tpi_completed', true)
      .not('tpi_completed_at', 'is', null)
      .gte('tpi_completed_at', startISO)
      .lte('tpi_completed_at', endISO)
      .is('deleted_at', null);
    if (locationIds) qq = locationIds.length === 1 ? qq.eq('location_id', locationIds[0]) : qq.in('location_id', locationIds);
    return qq;
  }, row => {
    const pid = row.tpi_payment_plan_id != null ? Number(row.tpi_payment_plan_id) : null;
    if (pid == null) return;
    if (!tpiMembers.has(pid)) tpiMembers.set(pid, new Set());
    tpiMembers.get(pid).add(row.tpi_patient_id);
    tpiRevenue.set(pid, (tpiRevenue.get(pid) || 0) + (Number(row.tpi_price) || 0));
  });

  // Invoices in period (invoice_date is a YYYY-MM-DD string) → invoice
  // revenue per plan, via patient→plan map.
  await paginate('platform_integration_invoices', 'id', q => {
    let qq = q.select('id, patient_id, subtotal')
      .gte('invoice_date', period_from)
      .lte('invoice_date', period_to)
      .is('deleted_at', null);
    if (locationIds) qq = locationIds.length === 1 ? qq.eq('location_id', locationIds[0]) : qq.in('location_id', locationIds);
    return qq;
  }, row => {
    const pid = patientPlan.get(row.patient_id);
    if (pid == null) return;
    invRevenue.set(pid, (invRevenue.get(pid) || 0) + (Number(row.subtotal) || 0));
  });
  } catch (err) {
    return dbReadFailure(err, 'membership data', { period_from, period_to });
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const rows = plans.map(p => {
    const ppid = Number(p.pp_id);
    const tpiM = tpiMembers.get(ppid)?.size || 0;
    const apptM = apptMembers.get(ppid)?.size || 0;
    const members = tpiM > 0 ? tpiM : apptM;
    const monthlyFee = Number(p.pp_monthly_memberhsip_fee) || 0;
    const tpiR = tpiRevenue.get(ppid) || 0;
    const invR = invRevenue.get(ppid) || 0;
    const revenue = tpiR > 0 ? tpiR : (invR > 0 ? invR : members * monthlyFee);
    return {
      plan: p.pp_name || p.pp_patient_friendly_name || `Plan ${ppid}`,
      members,
      monthlyFee: round2(monthlyFee),
      revenue: round2(revenue),
    };
  }).filter(r => r.members > 0 || r.revenue > 0)
    .sort((a, b) => b.members - a.members);

  return {
    preformatted: false,
    metric: 'membership_performance',
    locationName,
    period: { from: period_from, to: period_to },
    totals: {
      totalMembers: rows.reduce((s, r) => s + r.members, 0),
      membershipRevenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      planCount: rows.length,
    },
    plans: rows,
  };
}

/**
 * Treatment Profit Goals — actuals vs targets per treatment, mirroring
 * TreatmentProfitGoals.tsx + useTreatmentGoalStats + useTreatmentGoalTargets
 * EXACTLY (single-source-of-truth). FULL faithful mirror (the actual↔target
 * join is unambiguous — keyed by treatment name; formulas verbatim).
 * NOTE: Profit Planning *by Associates* is intentionally NOT built — it's
 * multi-source + user-input + non-linear (drift-prone); stays on-page aiContext.
 *
 * Actuals: RPC `get_profitability_invoice_items` (same params the page uses),
 *   aggregated by treatment_name: unitActual=Σno_of_treatments,
 *   totalRevenue=Σtotal_revenue, avgAmountActual=totalRevenue/unitActual.
 * Targets: `treatment_goal_targets` for org+period_type+period_date+location,
 *   keyed by category_name (the page's row key).
 * Combined (per name = union of actual/target names), verbatim formulas:
 *   unitPct = unitTarget>0 ? min(100,round(unitActual/unitTarget*100)) : (unitActual>0?100:0)
 *   avgPct  = avgTarget>0  ? min(100,round(avgActual/avgTarget*100))   : (avgActual>0?100:0)
 *   pct = hasU&&hasA ? min(unitPct,avgPct) : hasU?unitPct : hasA?avgPct : (unitActual>0?100:0)
 *   totals: avgActual=round(Σ(avgActual*unitActual)/ΣunitActual) etc.
 */
function _profitGoalsPeriodKey(from, to) {
  // Mirror useTreatmentGoalTargets period_date strings (CALENDAR month/qtr/yr,
  // 1-based month, no leading zero). Returns {type,date} or null if the range
  // isn't exactly a calendar month/quarter/year (then no stored target matches
  // and we honestly return actuals only — never fabricate a target period).
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  if (isNaN(f) || isNaN(t)) return null;
  const fy = f.getUTCFullYear(), fm = f.getUTCMonth(), fd = f.getUTCDate();
  const ty = t.getUTCFullYear(), tm = t.getUTCMonth(), td = t.getUTCDate();
  const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (fy === ty && fm === tm && fd === 1 && td === lastDay(ty, tm)) {
    return { type: 'month', date: `${fm + 1}-${fy}` };
  }
  if (fy === ty && fd === 1 && fm % 3 === 0 && tm === fm + 2 && td === lastDay(ty, tm)) {
    return { type: 'quarter', date: `Q${Math.floor(fm / 3) + 1}-${fy}` };
  }
  if (fy === ty && fm === 0 && fd === 1 && tm === 11 && td === 31) {
    return { type: 'year', date: `${fy}` };
  }
  return null;
}

async function resolveProfitGoals(args, orgId) {
  const { period_from, period_to, location_id } = args;
  const locationIds = Array.isArray(args.location_ids) && args.location_ids.length > 0
    ? args.location_ids
    : null;
  // Page uses a single selectedLocationId; multi-location → org-wide (null),
  // matching the page's "All locations" behaviour.
  const locId = (!locationIds && location_id) ? location_id : null;

  if (!period_from || !period_to) {
    return {
      preformatted: true,
      markdown: 'Tell me a period, e.g. *"treatment profit goals this month"*.',
      suggestions: ['Profit goals this month', 'Profit goals this quarter', 'Profit goals this year'],
    };
  }

  const locationName = locId
    ? ((await resolveLocationName(orgId, locId)) || 'Selected location')
    : (locationIds ? (args.location_display || `${locationIds.length} locations`) : 'All locations');

  // Actuals — same RPC + params as useTreatmentGoalStats.
  let rpcRows;
  try {
    const { data, error } = await supabaseAdmin.rpc('get_profitability_invoice_items', {
      p_organization_id: orgId,
      p_from_date: period_from,
      p_to_date: period_to,
      p_location_id: locId,
    });
    if (error) throw error;
    rpcRows = data || [];
  } catch (err) {
    return dbReadFailure(err, 'treatment profit data', { period_from, period_to });
  }
  const actualByName = new Map(); // treatment_name → {units, revenue, category}
  for (const r of rpcRows) {
    const name = r.treatment_name;
    if (!name) continue;
    const g = actualByName.get(name) || { units: 0, revenue: 0, category: r.category_name || '' };
    g.units += Number(r.no_of_treatments) || 0;
    g.revenue += Number(r.total_revenue) || 0;
    actualByName.set(name, g);
  }

  // Targets — same table/filters as useTreatmentGoalTargets, keyed by
  // category_name (the page's row key). Only when the period is exactly a
  // calendar month/quarter/year (else no stored target period to match).
  const targetByName = new Map(); // name → {unitTarget, avgTarget}
  const pk = _profitGoalsPeriodKey(period_from, period_to);
  let targetsAvailable = false;
  if (pk) {
    try {
      let tq = supabaseAdmin
        .from('treatment_goal_targets')
        .select('category_name, unit_target, avg_amount_target')
        .eq('organization_id', orgId)
        .eq('period_type', pk.type)
        .eq('period_date', pk.date)
        .is('region_id', null);
      tq = locId ? tq.eq('location_id', locId) : tq.is('location_id', null);
      const { data, error } = await tq;
      if (error) throw error;
      targetsAvailable = true;
      for (const t of data || []) {
        if (!t.category_name) continue;
        targetByName.set(t.category_name, {
          unitTarget: Number(t.unit_target) || 0,
          avgTarget: Number(t.avg_amount_target) || 0,
        });
      }
    } catch (err) {
      return dbReadFailure(err, 'profit goal targets', { period_from, period_to });
    }
  }

  // Combined rows — union of actual + target names (treatments-with-neither
  // would add 0/0 and not change totals, so they're omitted for the answer).
  const names = new Set([...actualByName.keys(), ...targetByName.keys()]);
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const rows = [];
  for (const name of names) {
    const a = actualByName.get(name);
    const unitActual = a ? a.units : 0;
    const avgActual = a && a.units > 0 ? a.revenue / a.units : 0;
    const tgt = targetByName.get(name);
    const unitTarget = tgt ? tgt.unitTarget : 0;
    const avgTarget = tgt ? tgt.avgTarget : 0;
    const unitPct = unitTarget > 0 ? Math.min(100, Math.round((unitActual / unitTarget) * 100)) : (unitActual > 0 ? 100 : 0);
    const avgPct = avgTarget > 0 ? Math.min(100, Math.round((avgActual / avgTarget) * 100)) : (avgActual > 0 ? 100 : 0);
    const hasU = unitTarget > 0, hasA = avgTarget > 0;
    const pct = hasU && hasA ? Math.min(unitPct, avgPct)
      : hasU ? unitPct
        : hasA ? avgPct
          : (unitActual > 0 ? 100 : 0);
    rows.push({
      name,
      unitActual,
      unitTarget,
      avgActual: round2(avgActual),
      avgTarget: round2(avgTarget),
      progressPct: pct,
    });
  }

  // Totals — verbatim from the page (avg = revenue-weighted, rounded int).
  let tUnitA = 0, tUnitT = 0, tRevA = 0, tRevT = 0;
  for (const r of rows) {
    tUnitA += r.unitActual;
    tUnitT += r.unitTarget;
    tRevA += r.avgActual * r.unitActual;
    tRevT += r.avgTarget * r.unitTarget;
  }
  const totals = {
    unitActual: tUnitA,
    unitTarget: tUnitT,
    avgActual: tUnitA > 0 ? Math.round(tRevA / tUnitA) : 0,
    avgTarget: tUnitT > 0 ? Math.round(tRevT / tUnitT) : 0,
  };

  rows.sort((x, y) => (y.avgActual * y.unitActual) - (x.avgActual * x.unitActual));

  return {
    preformatted: false,
    metric: 'profit_goals',
    locationName,
    period: { from: period_from, to: period_to },
    targetsAvailable,
    totals,
    rows,
  };
}

const RESOLVERS = {
  generate_dashboard: resolveDashboard,
  get_plan_mix: resolvePlanMix,
  get_nhs_performance: resolveNhsPerformance,
  get_membership_performance: resolveMembershipPerformance,
  get_profit_goals: resolveProfitGoals,
  get_financial_metric: resolveFinancialMetric,
  get_cashflow_data: resolveCashflow,
  get_chair_metrics: resolveChairMetrics,
  get_treatment_revenue: resolveTreatmentRevenue,
  get_revenue_breakdown_report: resolveRevenueBreakdown,
  get_location_metrics: resolveLocationMetrics,
  get_cost_breakdown: resolveCostBreakdown,
  list_cost_entries: resolveListCostEntries,
  list_cost_transactions: resolveListCostTransactions,
  get_ebitda: resolveEbitda,
  list_providers: resolveListProviders,
  get_profit_and_loss: resolveProfitAndLoss,
  general_question: resolveGeneral,

  // Phase 2
  compare_doctors: resolveCompareDoctors,
  compare_periods: resolveComparePeriods,
  compare_multiple_doctors: resolveCompareMultipleDoctors,
  multi_period_report: resolveMultiPeriodReport,
  year_over_year_report: resolveYearOverYear,

  // Phase 3
  drill_down_metric: resolveDrillDown,
  explain_why: resolveExplainWhy,
  forecast_metric: resolveForecast,
  what_if_scenario: resolveWhatIf,

  // Reports
  generate_report: resolveGenerateReport,
  email_report: resolveEmailReport,

  // New: page-aware fallbacks
  get_recommendations: resolveRecommendations,
  get_attendance_metric: resolveAttendanceMetric,
  list_dna_patients: resolveListDNAPatients,
  list_cancelled_patients: resolveListCancelledPatients,
  list_appointments: resolveListAppointments,
};

// resolveEbitda is also re-exported so responseFormatter can use it to compute
// an org-wide EBITDA summary on demand (used by the general_question path to
// answer EBITDA questions inline on any page, not just EBITDA pages).
module.exports = { resolve, resolveEbitda, isStatementTimeout, dbReadFailure };
