const claudeClient = require('./claudeClient');
const apiKeyService = require('./apiKeyService');
const { formatDateDisplay } = require('./periodHelper');
const { supabaseAdmin } = require('../../config/supabase');

// Heuristic: does the user's message look like an account-mapping / CoA /
// configuration lookup? Used to load the mapping reference even when the
// current page didn't provide it in pageContext (so mapping Qs work
// everywhere, not just on Cost Impact).
function isMappingQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  const hasMappingKey = /\b(chart of accounts?|coa|mapped to|mapping|which (xero|iplicit|chart of )?account|nominal( code)?|gl code|account code|expense account|account configuration|what'?s mapped|account.{0,12}feed|configured account)\b/.test(t);
  const hasCategoryKey = /\b(lab fees?|staff costs?|operating leases?|clinician costs?|overhead costs?|material costs?|cost of sales|admin(istrative)? costs?|revenue|income|nhs|private)\b/.test(t);
  return hasMappingKey && hasCategoryKey;
}

// In-process cache for mapping references. Mappings don't change minute-to-
// minute and the same org may ask several mapping questions in a row — caching
// avoids 4 Supabase round-trips per question. TTL 5 min — long enough to amortise
// a typical chat session, short enough that config changes appear quickly.
const mappingCache = new Map(); // orgId -> { ref, expiresAt }
const MAPPING_CACHE_TTL_MS = 5 * 60 * 1000;

// EBITDA reference cache. Computing EBITDA is several Supabase round-trips
// (revenue RPC + per-bucket cost queries + CoA resolution). Cache for 5 min
// so repeat EBITDA questions don't recompute. Keyed on orgId+period so
// asking "EBITDA this month" then "EBITDA last quarter" both cache.
const ebitdaCache = new Map(); // `${orgId}|${from}|${to}` -> { ref, expiresAt }
const EBITDA_CACHE_TTL_MS = 5 * 60 * 1000;

// Treatment profitability reference cache. Calling get_profitability_invoice_items
// + treatments-table join is a few Supabase round-trips; cache for 5 min so
// repeat asks ("improve composite filling margin", "show loss-making
// treatments", "lowest margin") on the same period don't recompute.
const treatmentProfitabilityCache = new Map(); // `${orgId}|${from}|${to}|${locId}` -> { ref, expiresAt }
const TREATMENT_PROFITABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

// Provider-stats cache. "Revenue per appointment / per patient / per chair
// hour" questions need both numerator + denominator for the named provider;
// caching for 5 min keeps repeat asks ("revenue per visit", "revenue per
// patient", "revenue per chair hour" — same provider) to one DB roundtrip.
const providerStatsCache = new Map(); // `${orgId}|${from}|${to}|${locId}|${doctor}` -> { ref, expiresAt }
const PROVIDER_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

// Heuristic: does the user's question ask for a derived per-X ratio (revenue
// per appointment, profit per chair hour, revenue per patient)? Used to
// trigger the loadProviderStats fallback so the bot has both numerator and
// denominator to compute the ratio, instead of returning a raw revenue
// table that doesn't answer the question.
function isPerXRatioQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  return /\b(?:revenue|income|production|earnings|profit)\s+per\s+(?:\w+\s+){0,2}(?:appointment|appointments|visit|visits|patient|patients|booking|bookings|treatment|treatments|hour|hours|day|days|chair[\s-]?hour|chair[\s-]?day|surgery|chair)\b|\baverage\s+(?:revenue|income|profit|earnings)\s+per\s+(?:\w+\s+){0,2}(?:appointment|visit|patient|booking|treatment|hour|day)\b|\bper[\s-]?(?:appointment|visit|patient|booking|treatment|chair[\s-]?hour|chair[\s-]?day)\s+(?:revenue|income|profit|earnings)\b/i.test(text);
}

// Extracts a single provider name from a free-text question by matching
// against the org's active provider list. Used for per-X ratio questions
// where the local classifier routed to general_question and so the LLM
// args.doctor_name field wasn't populated. Returns the exact provider name
// (preserves the canonical capitalisation) or null when no unambiguous match.
async function resolveDoctorNameFromMessage(message, organizationId) {
  if (!message || !organizationId) return null;
  const text = message.toLowerCase();
  const { data: provs } = await supabaseAdmin
    .from('providers')
    .select('name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .eq('is_active', true);
  if (!provs || provs.length === 0) return null;
  // 1. Full-name contains (case-insensitive).
  for (const p of provs) {
    if (!p?.name) continue;
    if (text.includes(p.name.toLowerCase())) return p.name;
  }
  // 2. First word + last word match — handles "Dr David Bianchi", "David
  //    Bianchi BDS", possessive forms.
  for (const p of provs) {
    if (!p?.name) continue;
    const words = p.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const first = words[0];
      const last = words[words.length - 1];
      const reFirst = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      const reLast = new RegExp(`\\b${last.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      if (reFirst.test(text) && reLast.test(text)) return p.name;
    }
  }
  return null;
}

// Loads revenue + completed-appointment count + distinct-patient count for
// a named provider (or every provider when no name is given), so the LLM can
// compute revenue-per-appointment / per-patient / per-day ratios. Uses the
// same chart_get_production_metrics RPC the Production page uses, plus a
// direct count from the appointments table — both filtered by org, period,
// and (optional) location.
async function loadProviderStats(organizationId, pageContextPeriod, locationId, doctorName) {
  try {
    const periodHelper = require('./periodHelper');
    let periodFrom = pageContextPeriod?.from || null;
    let periodTo = pageContextPeriod?.to || null;
    if (!periodFrom || !periodTo) {
      const tm = periodHelper.resolveperiodLabel('This Month');
      if (tm) { periodFrom = tm.from; periodTo = tm.to; }
    }
    if (!periodFrom || !periodTo) return null;

    const locKey = locationId || 'all';
    const doctorKey = (doctorName || '').toLowerCase().trim() || 'all';
    const cacheKey = `${organizationId}|${periodFrom}|${periodTo}|${locKey}|${doctorKey}`;
    const cached = providerStatsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.ref;

    // 1. Revenue per provider via the same RPC the Production page uses.
    const { data: prodRows, error: prodErr } = await supabaseAdmin.rpc('chart_get_production_metrics', {
      p_start_date: periodFrom,
      p_end_date: periodTo,
      p_organization_id: organizationId,
      p_provider_type: null,
      p_location_id: locationId || null,
    });
    if (prodErr) {
      console.error('[CHATBOT] loadProviderStats production RPC error:', prodErr.message);
      return null;
    }
    if (!Array.isArray(prodRows) || prodRows.length === 0) return null;

    // Optional doctor filter — match by name contains (case-insensitive) so
    // "David Bianchi" matches "Dr David Bianchi" / "David Bianchi BDS" too.
    const filterByName = doctorName && doctorName.length > 0
      ? String(doctorName).toLowerCase().trim()
      : null;
    const filteredProd = filterByName
      ? prodRows.filter(p => (p.provider_name || '').toLowerCase().includes(filterByName))
      : prodRows;

    if (filteredProd.length === 0) {
      // Named provider not found in the production output for this period.
      return {
        period: { from: periodFrom, to: periodTo },
        locationId: locationId || null,
        doctorName: doctorName || null,
        providers: [],
        note: `No production data found for ${doctorName || 'any provider'} in this period. They may not have had completed treatment plan items in the window, or their name doesn't match the practitioner list — try the exact name as it appears in the Provider directory.`,
      };
    }

    // 2. Look up the provider external_id list to query the appointments table.
    const providerNames = filteredProd.map(p => p.provider_name).filter(Boolean);
    const { data: provRows } = await supabaseAdmin
      .from('providers')
      .select('external_id, name, provider_role')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .in('name', providerNames);
    const extIdsByName = new Map();
    for (const r of provRows || []) {
      if (r.name && r.external_id != null) {
        if (!extIdsByName.has(r.name)) extIdsByName.set(r.name, []);
        extIdsByName.get(r.name).push(Number(r.external_id));
      }
    }

    // 3. Pull appointment counts in one query, then group in JS.
    const allExtIds = Array.from(new Set([].concat(...extIdsByName.values())));
    const apptCountByExtId = new Map();
    const patientSetByExtId = new Map();
    if (allExtIds.length > 0) {
      const PAGE_SIZE = 1000;
      let cursor = null;
      while (true) {
        let q = supabaseAdmin
          .from('appointments')
          .select('apmt_id, apmt_practitioner_id, apmt_patient_id, apmt_state, apmt_start_time, apmt_duration')
          .eq('organization_id', organizationId)
          .in('apmt_practitioner_id', allExtIds)
          .eq('apmt_state', 'Completed')
          .gte('apmt_start_time', periodFrom)
          .lte('apmt_start_time', periodTo + 'T23:59:59')
          .is('deleted_at', null)
          .order('apmt_id')
          .limit(PAGE_SIZE);
        if (locationId) q = q.eq('location_id', locationId);
        if (cursor != null) q = q.gt('apmt_id', cursor);
        const { data: pageRows, error: apptErr } = await q;
        if (apptErr) {
          console.error('[CHATBOT] loadProviderStats appointments error:', apptErr.message);
          break;
        }
        if (!pageRows || pageRows.length === 0) break;
        for (const a of pageRows) {
          const ext = Number(a.apmt_practitioner_id);
          apptCountByExtId.set(ext, (apptCountByExtId.get(ext) || 0) + 1);
          if (a.apmt_patient_id != null) {
            if (!patientSetByExtId.has(ext)) patientSetByExtId.set(ext, new Set());
            patientSetByExtId.get(ext).add(String(a.apmt_patient_id));
          }
        }
        if (pageRows.length < PAGE_SIZE) break;
        cursor = pageRows[pageRows.length - 1].apmt_id;
      }
    }

    // 4. Build per-provider rows with derived ratios.
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const providers = filteredProd.map(p => {
      const exts = extIdsByName.get(p.provider_name) || [];
      let apptCount = 0;
      const patients = new Set();
      for (const e of exts) {
        apptCount += apptCountByExtId.get(e) || 0;
        const pset = patientSetByExtId.get(e);
        if (pset) for (const pid of pset) patients.add(pid);
      }
      const revenue = Number(p.production_amount) || 0;
      const daysWorked = Number(p.days_worked) || 0;
      return {
        provider: p.provider_name,
        revenue: r2(revenue),
        completedAppointments: apptCount,
        distinctPatients: patients.size,
        daysWorked: r2(daysWorked),
        revenuePerAppointment: apptCount > 0 ? r2(revenue / apptCount) : null,
        revenuePerPatient: patients.size > 0 ? r2(revenue / patients.size) : null,
        revenuePerDay: daysWorked > 0 ? r2(revenue / daysWorked) : null,
      };
    });

    const ref = {
      period: { from: periodFrom, to: periodTo },
      locationId: locationId || null,
      doctorName: doctorName || null,
      providers,
      note: 'Provider stats computed from the Production RPC (same source as the Production page) for revenue + days, joined with the appointments table for completed-appointment count and distinct-patient count. Use revenuePerAppointment / revenuePerPatient / revenuePerDay directly — they are pre-divided.',
    };
    providerStatsCache.set(cacheKey, { ref, expiresAt: Date.now() + PROVIDER_STATS_CACHE_TTL_MS });
    return ref;
  } catch (err) {
    console.error('[CHATBOT] loadProviderStats failed:', err?.message);
    return null;
  }
}

// Heuristic: does the user's message look like an EBITDA / valuation /
// profitability-summary question? Used to lazy-load an EBITDA summary on any
// page (not just the EBITDA pages) so the bot can answer "what's our EBITDA"
// directly from anywhere.
function isEbitdaQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return /\b(ebitda|enterprise\s+value|practice\s+(?:value|worth|valuation)|what.{0,8}(?:my|our|the)\s+practice\s+worth|exit\s+value|valuation|gross\s+margin|gross\s+profit|net\s+profit|operating\s+profit|total\s+costs?|profit\s+margin|cost[\s-]?to[\s-]?revenue|cost\s+ratio)\b/.test(t);
}

// Computes an org-wide EBITDA summary by delegating to the get_ebitda tool's
// resolver. Picks a default period (page period > FY-to-date), caches the
// result for 5 min keyed on org+period, and returns a compact summary the
// general_question prompt can cite directly.
//
// Used when a user asks an EBITDA question on a page that doesn't already
// expose EBITDA in its aiContext (e.g. asks "what's our EBITDA?" from
// Cashflow). On EBITDA-bearing pages, the page's own structured context wins
// — we only load if the structured context doesn't already have an ebitda
// field.
async function loadEbitdaSummary(organizationId, pageContextPeriod) {
  try {
    // 1. Period selection: page period > FY-to-date.
    const periodHelper = require('./periodHelper');
    let periodFrom = pageContextPeriod?.from || null;
    let periodTo = pageContextPeriod?.to || null;
    if (!periodFrom || !periodTo) {
      const fy = periodHelper.resolveperiodLabel('This Year');
      if (fy) { periodFrom = fy.from; periodTo = fy.to; }
    }
    if (!periodFrom || !periodTo) return null;

    const cacheKey = `${organizationId}|${periodFrom}|${periodTo}`;
    const cached = ebitdaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.ref;

    // 2. Delegate to the same resolver get_ebitda uses, so numbers reconcile
    //    with the EBITDA Valuation / Dashboard pages exactly.
    const { resolveEbitda } = require('./dataResolver');
    const result = await resolveEbitda(
      { period_from: periodFrom, period_to: periodTo },
      organizationId,
    );
    // resolveEbitda returns either a structured EBITDA object or a
    // preformatted error markdown. Only cache + return the structured form.
    if (!result || result.preformatted) return null;

    const r2 = (n) => n === null || n === undefined ? null : Math.round((Number(n) || 0) * 100) / 100;
    const ref = {
      period: { from: periodFrom, to: periodTo },
      locationName: result.locationName || 'All locations',
      revenue: r2(result.revenue),
      cogs: r2(result.cogs),
      grossProfit: r2(result.grossProfit),
      grossMarginPercent: r2(result.grossMargin),
      operatingExpenses: r2(result.opex),
      totalCosts: r2(result.totalCosts),
      ebitda: r2(result.ebitda),
      ebitdaMarginPercent: r2(result.ebitdaMargin),
      multiple: r2(result.multiple),
      enterpriseValue: r2(result.enterpriseValue),
      costBuckets: Array.isArray(result.costBuckets)
        ? result.costBuckets.map(b => ({ label: b.label || b.name, value: r2(b.value || b.amount) }))
        : null,
      note: 'Computed by the same logic that powers the EBITDA Valuation page — figures reconcile with that page for the same period.',
    };
    ebitdaCache.set(cacheKey, { ref, expiresAt: Date.now() + EBITDA_CACHE_TTL_MS });
    return ref;
  } catch (err) {
    console.error('[CHATBOT] loadEbitdaSummary failed:', err?.message);
    return null;
  }
}

// Heuristic: does the user's message look like a treatment-profitability
// question? Used to lazy-load the per-treatment P&L on any page (not just
// the Profitability page) so the chatbot can answer "how can I improve
// Composite Filling margin?", "which treatments are loss-making?", "lowest
// margin treatment", etc. from anywhere.
function isTreatmentProfitabilityQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  // Must touch the per-treatment concept...
  const hasTreatmentSubject = /\b(treatment|treatments|filling|crown|bridge|extraction|denture|implant|composite|hygien|exam|radiograph|gbt|cosmetic|orthodontic|endodontic|periodontic|prosthetic|restorative)\b/.test(t);
  // ...and a profitability concept.
  const hasProfitabilitySubject = /\b(margin|profit|loss|p\s*&\s*l|p\s*and\s*l|profitability|unprofitable|loss[\s-]?making|losing\s+money|cost\s+ratio|expense\s+ratio|improve|optimi[sz]e|increase|grow|reduce|cut|lower)\b/.test(t);
  return hasTreatmentSubject && hasProfitabilitySubject;
}

// Computes per-treatment profitability rows by calling the same RPC the
// Profitability page uses (get_profitability_invoice_items), joining with the
// treatments table for material/lab/therapist/hourly_rate/duration_minutes
// fallbacks, and applying the same per-unit P&L formula (avg − material − lab
// − therapist − opCost − assocPay − financeFee). Cached 5 min per
// org+period+location.
//
// Returns null when the org has no completed invoices in the period (so the
// caller can fall back to the generic advisory framework).
async function loadTreatmentProfitability(organizationId, pageContextPeriod, locationId) {
  try {
    const periodHelper = require('./periodHelper');
    let periodFrom = pageContextPeriod?.from || null;
    let periodTo = pageContextPeriod?.to || null;
    if (!periodFrom || !periodTo) {
      const tm = periodHelper.resolveperiodLabel('This Month');
      if (tm) { periodFrom = tm.from; periodTo = tm.to; }
    }
    if (!periodFrom || !periodTo) return null;

    const locKey = locationId || 'all';
    const cacheKey = `${organizationId}|${periodFrom}|${periodTo}|${locKey}`;
    const cached = treatmentProfitabilityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.ref;

    // 1. RPC — same call the Profitability page makes.
    const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc('get_profitability_invoice_items', {
      p_organization_id: organizationId,
      p_from_date: periodFrom,
      p_to_date: periodTo,
      p_location_id: locationId || null,
    });
    if (rpcErr) {
      console.error('[CHATBOT] loadTreatmentProfitability RPC error:', rpcErr.message);
      return null;
    }
    if (!Array.isArray(rpcRows) || rpcRows.length === 0) return null;

    // 2. Group by treatment_id when present (the RPC may return multiple
    //    monthly buckets per treatment for a multi-month period). Sum
    //    counts + revenue; cost-rate fields are the same across buckets so
    //    we just take the first non-null value.
    const grouped = new Map();
    for (const r of rpcRows) {
      const id = r.treatment_id || `name:${r.treatment_name || 'Unknown'}`;
      if (!grouped.has(id)) {
        grouped.set(id, {
          treatment_id: r.treatment_id || null,
          treatment_name: r.treatment_name || 'Unknown',
          category_name: r.category_name || '-',
          no_of_treatments: 0,
          total_revenue: 0,
          material_cost: Number(r.material_cost) || 0,
          lab_bill: Number(r.lab_bill) || 0,
          therapist_pay_rate: Number(r.therapist_pay_rate) || 0,
          percent_fees: Number(r.percent_fees) || 0,
          finance_fee: Number(r.finance_fee) || 0,
          hourly_rate: Number(r.hourly_rate) || 0,
          duration_minutes: Number(r.duration_minutes) || 0,
        });
      }
      const g = grouped.get(id);
      g.no_of_treatments += Number(r.no_of_treatments) || 0;
      g.total_revenue += Number(r.total_revenue) || 0;
    }

    // 3. Join with the treatments table for the matched UUIDs — the page
    //    prefers the treatments row's cost columns when there's a UUID match
    //    (so a manual edit on Treatment Setup beats whatever the RPC has).
    const matchedIds = Array.from(grouped.keys()).filter(k => !String(k).startsWith('name:'));
    const treatmentRowById = new Map();
    if (matchedIds.length > 0) {
      const { data: tRows, error: tErr } = await supabaseAdmin
        .from('treatments')
        .select('id, material_cost, lab_bill, therapist_pay_rate, percent_fees, finance_fee, hourly_rate, duration_minutes, treatment_categories!treatments_category_id_fkey(name, deleted_at)')
        .eq('organization_id', organizationId)
        .in('id', matchedIds);
      if (!tErr) {
        for (const t of tRows || []) treatmentRowById.set(t.id, t);
      }
    }

    // 4. Compute per-unit + per-treatment totals (same formula as
    //    AllTreatmentsProfitabilityTab so the chatbot's numbers reconcile
    //    with the page exactly).
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const rows = [];
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const g of grouped.values()) {
      const t = g.treatment_id ? treatmentRowById.get(g.treatment_id) : null;
      const mat = t ? (Number(t.material_cost) || 0) : g.material_cost;
      const lab = t ? (Number(t.lab_bill) || 0) : g.lab_bill;
      const thr = t ? (Number(t.therapist_pay_rate) || 0) : g.therapist_pay_rate;
      const hourlyRate = t ? (Number(t.hourly_rate) || 0) : g.hourly_rate;
      const durationMin = t ? (Number(t.duration_minutes) || 0) : g.duration_minutes;
      const pctFees = t ? (Number(t.percent_fees) || 0) : g.percent_fees;
      const finPct = t ? (Number(t.finance_fee) || 0) : g.finance_fee;
      let categoryName = g.category_name;
      if (t && t.treatment_categories) {
        const tc = Array.isArray(t.treatment_categories)
          ? t.treatment_categories.find(x => x && x.name && !x.deleted_at)
          : (t.treatment_categories.name && !t.treatment_categories.deleted_at ? t.treatment_categories : null);
        if (tc && tc.name) categoryName = tc.name;
      }

      const count = g.no_of_treatments;
      const totalInc = g.total_revenue;
      const avg = count > 0 ? totalInc / count : 0;
      const opCost = hourlyRate * (durationMin / 60);
      const assocPay = avg * (pctFees / 100);
      const finFee = avg * (finPct / 100);
      const expUnit = mat + lab + thr + opCost + assocPay + finFee;
      const plUnit = avg - expUnit;
      const totExp = expUnit * count;
      const totPL = totalInc - totExp;
      const marginPercent = avg > 0 ? (plUnit / avg) * 100 : null;

      rows.push({
        treatment: g.treatment_name,
        category: categoryName,
        avgIncome: r2(avg),
        materialCost: r2(mat),
        labBill: r2(lab),
        therapistPay: r2(thr),
        opCost: r2(opCost),
        associatePay: r2(assocPay),
        financeFee: r2(finFee),
        totalCostPerUnit: r2(expUnit),
        profitPerUnit: r2(plUnit),
        marginPercent: marginPercent === null ? null : r2(marginPercent),
        unitsSold: count,
        totalIncome: r2(totalInc),
        totalExpense: r2(totExp),
        totalProfitLoss: r2(totPL),
      });
      totalRevenue += totalInc;
      totalExpense += totExp;
    }

    // 5. Pre-rank so the LLM can answer "lowest margin"/"loss-making"/etc.
    //    without re-sorting. Cap each list at 20 to keep the prompt compact.
    const byImpact = [...rows].sort((a, b) => Math.abs(b.totalProfitLoss) - Math.abs(a.totalProfitLoss)).slice(0, 40);
    const lossMaking = [...rows].filter(r => r.totalProfitLoss < 0).sort((a, b) => a.totalProfitLoss - b.totalProfitLoss).slice(0, 20);
    const lowestMargin = [...rows].filter(r => r.marginPercent !== null).sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 10);
    const highestMargin = [...rows].filter(r => r.marginPercent !== null).sort((a, b) => b.marginPercent - a.marginPercent).slice(0, 10);

    const ref = {
      period: { from: periodFrom, to: periodTo },
      locationId: locationId || null,
      totals: {
        unitsSold: rows.reduce((s, r) => s + (r.unitsSold || 0), 0),
        totalIncome: r2(totalRevenue),
        totalExpense: r2(totalExpense),
        totalProfitLoss: r2(totalRevenue - totalExpense),
        rowCount: rows.length,
      },
      treatments: byImpact,
      lossMaking,
      lowestMargin,
      highestMargin,
      note: 'Computed by the same logic that powers the Profitability by Treatments page. Per-unit profit/loss = average income − (material + lab + therapist + operational + associate% + finance%). Loaded on demand because the page snapshot may have been empty when the chat was sent.',
    };
    treatmentProfitabilityCache.set(cacheKey, { ref, expiresAt: Date.now() + TREATMENT_PROFITABILITY_CACHE_TTL_MS });
    return ref;
  } catch (err) {
    console.error('[CHATBOT] loadTreatmentProfitability failed:', err?.message);
    return null;
  }
}

// Loads the practice's effective expense-account mappings for every active
// location, resolving UUIDs against the platform's chart-of-accounts table.
// Result is compact JSON the LLM can cite directly. Mirrors the logic in
// src/hooks/useExpenseAccountSettings.ts + src/hooks/useLocationCoaMappings.ts
// on the frontend — same source of truth, same fallback chain.
async function loadMappingReference(organizationId) {
  const cached = mappingCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.ref;
  try {
    const [orgRes, locRes, platRes] = await Promise.all([
      supabaseAdmin.from('organizations').select('lab_fees, staff_costs, operating_lease').eq('id', organizationId).single(),
      supabaseAdmin.from('practice_locations')
        .select('id, location_name, lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, clinician_cost_accounts, overhead_cost_accounts, material_cost_accounts')
        .eq('organization_id', organizationId).is('deleted_at', null),
      supabaseAdmin.from('platform_integrations').select('platform_name').eq('organization_id', organizationId).in('platform_name', ['iplicit', 'xero', 'Iplicit', 'Xero']),
    ]);

    const platform = (platRes.data || []).find(p => ['iplicit', 'xero'].includes((p.platform_name || '').toLowerCase()));
    const isIplicit = (platform?.platform_name || '').toLowerCase() === 'iplicit';
    const platformLabel = isIplicit ? 'Iplicit' : 'Xero';

    const parseOrgList = (val) => {
      if (!val) return [];
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed.selected_account) ? parsed.selected_account : [];
      } catch { return []; }
    };
    const orgLab = parseOrgList(orgRes.data?.lab_fees);
    const orgStaff = parseOrgList(orgRes.data?.staff_costs);
    const orgLease = parseOrgList(orgRes.data?.operating_lease);

    const locs = locRes.data || [];
    if (locs.length === 0) {
      return { platform: platformLabel, locations: [], note: 'No active locations found.' };
    }

    const uuids = new Set();
    const accountKeys = ['lab_fees_accounts', 'staff_costs_accounts', 'operating_lease_accounts', 'clinician_cost_accounts', 'overhead_cost_accounts', 'material_cost_accounts'];
    for (const l of locs) {
      for (const k of accountKeys) {
        const arr = Array.isArray(l[k]) ? l[k] : [];
        for (const u of arr) if (u) uuids.add(u);
      }
    }
    for (const u of orgLab) uuids.add(u);
    for (const u of orgStaff) uuids.add(u);
    for (const u of orgLease) uuids.add(u);

    const uuidToAcct = new Map();
    if (uuids.size > 0) {
      const ids = Array.from(uuids);
      if (isIplicit) {
        const { data: rows } = await supabaseAdmin.from('iplicit_chart_of_accounts')
          .select('id, code, name').eq('organization_id', organizationId).in('id', ids);
        for (const r of rows || []) {
          if (r.code) uuidToAcct.set(r.id, { code: r.code, name: r.name || '' });
        }
      } else {
        const { data: rows } = await supabaseAdmin.from('xero_chart_of_accounts')
          .select('id, account_code, account_name').eq('organization_id', organizationId).in('id', ids);
        for (const r of rows || []) {
          if (r.account_code) uuidToAcct.set(r.id, { code: r.account_code, name: r.account_name || '' });
        }
      }
    }

    const resolve = (arr) => {
      if (!Array.isArray(arr)) return [];
      const seen = new Set();
      const out = [];
      for (const u of arr) {
        const a = uuidToAcct.get(u);
        if (a?.code && !seen.has(a.code)) {
          seen.add(a.code);
          out.push(a);
        }
      }
      return out;
    };

    const orgLabResolved = resolve(orgLab);
    const orgStaffResolved = resolve(orgStaff);
    const orgLeaseResolved = resolve(orgLease);

    const locations = locs.map(l => {
      const locLab = resolve(l.lab_fees_accounts);
      const locStaff = resolve(l.staff_costs_accounts);
      const locLease = resolve(l.operating_lease_accounts);
      return {
        id: l.id,
        name: l.location_name || '',
        labFees: locLab.length > 0 ? locLab : orgLabResolved,
        staffCosts: locStaff.length > 0 ? locStaff : orgStaffResolved,
        operatingLease: locLease.length > 0 ? locLease : orgLeaseResolved,
        clinicianCost: resolve(l.clinician_cost_accounts),
        overheadCost: resolve(l.overhead_cost_accounts),
        materialCost: resolve(l.material_cost_accounts),
      };
    });

    const ref = { platform: platformLabel, locations };
    mappingCache.set(organizationId, { ref, expiresAt: Date.now() + MAPPING_CACHE_TTL_MS });
    return ref;
  } catch (err) {
    console.error('[CHATBOT] loadMappingReference failed:', err?.message);
    return null;
  }
}

// Parses an LLM response that may contain a "---FOLLOWUPS---" tail with a JSON
// array of 2-4 short follow-up chip strings. Returns { answer, suggestions }
// where suggestions is null if the tail is missing or malformed (caller will
// fall back to the static defaults).
// Post-process LLM output to scrub any internal code-style identifiers that
// leaked through despite the system-prompt rule. Catches camelCase /
// snake_case / dotted-path words, backticked code refs, and a few common
// internal field names from the structured-context block. Replaces them with
// space-separated plain English so the output never shows "planMix",
// "planMixTotalRevenue.length", `"locations[0]"`, etc. to the user.
function scrubInternalIdentifiers(text) {
  if (!text || typeof text !== 'string') return text;

  // Strip backtick-wrapped identifiers entirely — they're almost always code
  // refs (e.g. `planMix`, `accounts.length`).
  let out = text.replace(/`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[[^\]]+\])*)`/g, (_m, ident) => {
    return splitIdentifier(ident);
  });

  // Bare camelCase/snake_case tokens NOT inside a code fence — convert to
  // space-separated lowercase. We only target tokens that look unambiguously
  // code-shaped: contain a lowercase-Uppercase boundary (planMix) or an
  // underscore (plan_mix) or a dotted/bracketed access (foo.bar / foo[0]).
  // Pure capitalised words ("Private", "Dentist") and acronyms are left
  // alone.
  out = out.replace(/\b([a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)\b/g, (m) => splitIdentifier(m));
  out = out.replace(/\b([a-z][a-z0-9_]+_[a-z0-9_]+)\b/g, (m) => splitIdentifier(m));
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\b/g, (m) => splitIdentifier(m));
  // Bare word[index] e.g. "locations[0]" — drop the index, keep the word.
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\[[^\]]*\]/g, (_m, word) => splitIdentifier(word));

  return out;
}

function splitIdentifier(ident) {
  return String(ident)
    .replace(/\[[^\]]*\]/g, '')   // drop [0] / [idx]
    .replace(/\./g, ' ')           // dots → spaces
    .replace(/_/g, ' ')            // snake_case → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .toLowerCase()
    .trim();
}

function parseAnswerWithSuggestions(raw) {
  if (!raw || typeof raw !== 'string') return { answer: '', suggestions: null };
  const marker = /\n+\s*---FOLLOWUPS---\s*\n+/;
  const m = raw.split(marker);
  if (m.length < 2) return { answer: raw.trim(), suggestions: null };
  const answer = m[0].trim();
  const tail = m.slice(1).join('').trim();
  try {
    // Tolerate code-fenced JSON like ```json[...]``` or bare [...].
    const jsonMatch = tail.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { answer, suggestions: null };
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return { answer, suggestions: null };
    const clean = arr.map(s => String(s).trim()).filter(s => s.length > 0 && s.length <= 80).slice(0, 4);
    return { answer, suggestions: clean.length > 0 ? clean : null };
  } catch {
    return { answer, suggestions: null };
  }
}

/**
 * Formats resolved data into markdown for the user.
 * Phase 3 tools return pre-formatted markdown (skip LLM call).
 * Phase 1-2 tools use Claude to format data into natural language.
 */

// Expert persona used by every LLM-formatted response. Establishes the bot as
// a senior dental-practice advisor (strategy + finance + operations) rather
// than a generic "reporting assistant". Two effects:
//   1. Tone — confident, concise, partner-level. No AI-speak, no disclaimers.
//   2. Reasoning — interprets numbers (trend, mix, benchmark) instead of just
//      reading them back. Surfaces risks and one clear next move.
const EXPERT_PERSONA = `You are DentPulse AI — a senior advisor to dental practice owners and operators. You speak with the combined expertise of:
- A dental practice strategist (UK private + NHS dynamics, chair utilisation, provider mix, membership economics, patient lifecycle).
- A financial analyst (P&L, EBITDA, cashflow, margin drivers, working capital, valuation multiples).
- An operations adviser (collections, AR, lab/material/staff cost ratios, lease/overhead, marketing ROI).

How you think:
- Read numbers in context — trend direction, peer/industry norms (e.g. private margin ~25-35%, lab fees ~6-9% of revenue, staff cost ~25-30%, collection rate target ≥95%), and what they imply.
- When a number is off, name the most likely cause(s) before prescribing.
- Distinguish symptoms (a falling KPI) from drivers (mix shift, provider performance, capacity loss).
- Prefer one concrete next move over a list of possibilities.

How you write:
- Partner-level: confident, precise, no waffle, no hedging clauses, no "as an AI", no closing disclaimers.
- Markdown. Bold the key numbers. Use a small table only when comparing rows.
- Lead with the answer or the headline. Justification follows, never precedes.
- If data is insufficient, say so plainly in one line and name what would resolve it.`;

function formatCurrency(value) {
  const num = parseFloat(value) || 0;
  return '£' + num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const num = parseFloat(value) || 0;
  return num.toFixed(1) + '%';
}

function fmtPeriod(from, to) {
  return `${formatDateDisplay(from)} to ${formatDateDisplay(to)}`;
}

async function format(intent, resolved, organizationId, options = {}) {
  const { userMessage, pageContext } = options;

  // Pre-formatted responses (Phase 3 tools, placeholders, errors)
  if (resolved.preformatted) {
    return {
      message: resolved.markdown || 'No data available.',
      suggestions: resolved.suggestions || generateSuggestions(intent),
    };
  }

  // General questions — let LLM answer directly. If the frontend captured a
  // page snapshot (URL + title + visible text of <main>), use it so the bot
  // can answer "anything visible on this page" without per-page wiring.
  if (resolved.isGeneral) {
    const snapshot = pageContext && pageContext.snapshot;
    const visibleText = snapshot && typeof snapshot.visibleText === 'string'
      ? snapshot.visibleText.trim()
      : '';
    // Text from currently-open dialogs/sheets/popovers/dropdowns (portaled
    // outside <main>). Captured separately so the bot can answer questions
    // about modal content the user is looking at — e.g. invoice review modal,
    // a filter dialog, an edit form.
    const overlays = snapshot && typeof snapshot.overlays === 'string'
      ? snapshot.overlays.trim()
      : '';

    // Pages may also pass structured data via `aiContext` (e.g. CoA mappings,
    // integration names, current cost values). Anything in pageContext that
    // isn't the visible-text snapshot is treated as authoritative structured
    // context the LLM can cite — useful for facts the page knows but doesn't
    // render (e.g. account codes behind a £0.00 tile).
    let structuredObj = null;
    if (pageContext && typeof pageContext === 'object') {
      const { snapshot: _snap, ...structured } = pageContext;
      if (Object.keys(structured || {}).length > 0) structuredObj = structured;
    }

    // Cross-page mapping fallback. Mapping/configuration questions should be
    // answerable on every page, not just pages that opt into aiContext. If the
    // user is asking a mapping Q and the page didn't provide `locations`, we
    // load the same data directly from the DB and graft it in.
    if (userMessage && isMappingQuestion(userMessage)) {
      const hasLocationsMap = Array.isArray(structuredObj?.locations) && structuredObj.locations.length > 0;
      if (!hasLocationsMap) {
        const mappingRef = await loadMappingReference(organizationId);
        if (mappingRef) {
          structuredObj = { ...(structuredObj || {}), accountMappingReference: mappingRef };
        }
      }
    }

    // Cross-page EBITDA fallback. Same pattern as mapping: if the user is
    // asking about EBITDA / valuation / margin and the current page doesn't
    // already expose those fields, compute an org-wide summary on demand and
    // inject it. So "what's our EBITDA?" works on Cashflow, Treatments, any
    // page — not just /ebitda-valuation.
    if (userMessage && isEbitdaQuestion(userMessage)) {
      const hasEbitdaInContext = !!(
        structuredObj?.ebitda
        || structuredObj?.reportedEBITDA
        || structuredObj?.sustainableEBITDA
        || structuredObj?.totals?.ebitda
        || (typeof structuredObj?.ebitdaPercent === 'number')
      );
      if (!hasEbitdaInContext) {
        const ebitdaRef = await loadEbitdaSummary(organizationId, structuredObj?.period);
        if (ebitdaRef) {
          structuredObj = { ...(structuredObj || {}), ebitdaReference: ebitdaRef };
        }
      }
    }

    // Cross-page provider-stats fallback for per-X ratio questions
    // ("revenue per appointment", "revenue per patient", "profit per chair
    // hour" for a named provider). These need BOTH a numerator (revenue)
    // and a denominator (appointment count / patient count / days worked)
    // — the page snapshot usually only renders one of them. We compute both
    // server-side using the same RPC the Production page uses and inject as
    // structuredObj.providerStatsReference so the LLM can quote the exact
    // ratio (and explain its components) instead of falling back to a
    // generic revenue ranking.
    if (userMessage && isPerXRatioQuestion(userMessage)) {
      const doctorFromMessage = await resolveDoctorNameFromMessage(userMessage, organizationId);
      const locId = structuredObj?.selectedLocationId || null;
      const statsRef = await loadProviderStats(
        organizationId,
        structuredObj?.period,
        locId,
        doctorFromMessage,
      );
      if (statsRef) {
        structuredObj = { ...(structuredObj || {}), providerStatsReference: statsRef };
      }
    }

    // Cross-page treatment-profitability fallback. Same pattern as EBITDA:
    // when the user asks about a treatment's margin / loss / profitability
    // ("how can I improve Composite Filling margin?", "which treatments are
    // loss-making?") and the current page hasn't already injected per-
    // treatment P&L into structuredObj (Profitability page has it as
    // .treatments[]; other pages don't), compute it on demand via the same
    // RPC the page uses. Reconciles row-for-row with /treatments/profitability.
    if (userMessage && isTreatmentProfitabilityQuestion(userMessage)) {
      const hasTreatmentsInContext = Array.isArray(structuredObj?.treatments)
        && structuredObj.treatments.length > 0
        && structuredObj.treatments[0]
        && (
          typeof structuredObj.treatments[0].profitPerUnit === 'number'
          || typeof structuredObj.treatments[0].totalProfitLoss === 'number'
          || typeof structuredObj.treatments[0].marginPercent === 'number'
        );
      if (!hasTreatmentsInContext) {
        const locId = structuredObj?.selectedLocationId || null;
        const profRef = await loadTreatmentProfitability(
          organizationId,
          structuredObj?.period,
          locId,
        );
        if (profRef) {
          structuredObj = { ...(structuredObj || {}), treatmentProfitabilityReference: profRef };
        }
      }
    }

    let structuredJson = '';
    if (structuredObj) {
      try { structuredJson = JSON.stringify(structuredObj, null, 2); } catch { structuredJson = ''; }
      if (structuredJson.length > 12000) structuredJson = structuredJson.slice(0, 12000) + '\n…(truncated)';
    }

    // Combined-payload guard. Three blocks (structured + visibleText + overlays)
    // were each capped individually but could sum to 28KB+ — past the comfortable
    // budget for the format LLM call. Trim by priority: structured kept first
    // (it's the authoritative data), then visibleText, then overlays.
    const TOTAL_BUDGET = 22000;
    let combinedLen = structuredJson.length + visibleText.length + overlays.length;
    let trimmedVisibleText = visibleText;
    let trimmedOverlays = overlays;
    if (combinedLen > TOTAL_BUDGET) {
      // Step 1: shrink overlays first (least authoritative).
      const overflow1 = combinedLen - TOTAL_BUDGET;
      const overlayKeep = Math.max(0, trimmedOverlays.length - overflow1);
      trimmedOverlays = trimmedOverlays.slice(0, overlayKeep);
      combinedLen = structuredJson.length + trimmedVisibleText.length + trimmedOverlays.length;
      if (combinedLen > TOTAL_BUDGET) {
        // Step 2: shrink visibleText.
        const overflow2 = combinedLen - TOTAL_BUDGET;
        const textKeep = Math.max(0, trimmedVisibleText.length - overflow2);
        trimmedVisibleText = trimmedVisibleText.slice(0, textKeep)
          + (textKeep < visibleText.length ? '\n…(truncated)' : '');
      }
      if (trimmedOverlays.length < overlays.length && trimmedOverlays.length > 0) {
        trimmedOverlays += '\n…(truncated)';
      }
    }

    // Always treat resolver-error fallbacks as suggestion-style — they reached
    // us because the classifier picked a data tool but the question was
    // advisory ("how can I reduce cost?"). Answer with advice, not greeting.
    const isResolverErrorFallback = !!resolved.resolverError;

    // Short-circuit when the page is still loading. Without this, the LLM
    // tends to do BOTH ("data isn't loaded yet" AND a long generic framework)
    // and the user reads it as the bot ignoring real data that's actually
    // visible on the page. Returning a fixed one-liner makes the loading
    // state unambiguous and stops the framework from drowning the message.
    // Only short-circuit when we have NOTHING useful to answer with — i.e.
    // the page is loading AND no on-demand reference (EBITDA, treatment
    // profitability, mapping) was loaded above. When a reference IS loaded,
    // we can answer authoritatively from the DB even though the page hasn't
    // rendered yet.
    const hasOnDemandRef = !!(
      structuredObj?.ebitdaReference
      || structuredObj?.treatmentProfitabilityReference
      || structuredObj?.accountMappingReference
      || structuredObj?.providerStatsReference
    );
    if (userMessage && pageContext && pageContext.isPageLoading && !hasOnDemandRef) {
      const what = (userMessage || '').trim().toLowerCase();
      let retryHint = 'Try again in a moment.';
      if (/\b(margin|profit|loss|p\s*&\s*l|profitability)\b/.test(what)) {
        retryHint = 'Try again once the profitability table finishes loading.';
      } else if (/\b(treatment|category|revenue|income)\b/.test(what)) {
        retryHint = 'Try again once the treatment data finishes loading.';
      } else if (/\b(provider|dentist|hygienist|associate|practitioner)\b/.test(what)) {
        retryHint = 'Try again once the provider list finishes loading.';
      }
      return {
        message: `The page is still loading. ${retryHint}`,
        suggestions: ['Try again now', 'Refresh the page', 'Open profitability page'],
      };
    }

    if (userMessage && (visibleText.length > 0 || structuredJson.length > 0 || overlays.length > 0)) {
      const generalStart = Date.now();
      try {
        const orgKey = await apiKeyService.getOrgApiKey(organizationId);
        const pageLabel = (snapshot?.title || snapshot?.url || 'this page').toString();

        // Detect whether the user is asking for advice / suggestions /
        // recommendations rather than a plain data lookup. When they are, the
        // bot replies in an advisory tone with prioritised actions grounded
        // in the numbers on the page — instead of just reading values back.
        // Resolver-error fallbacks are always advisory (the question wasn't a
        // clean data lookup or it would have resolved).
        const wantsSuggestions = isResolverErrorFallback || /\b(suggest|suggestion|recommend|recommendation|advice|advise|tip|tips|what should (i|we)|how (do|can) (i|we) (improve|fix|grow|reduce|increase|optimi[sz]e)|improve|optimi[sz]e|action|actions|next step|priorit(y|ies|ise|ize)|needs? attention|at risk|underperform|opportunit(y|ies)|recommendation)\b/i.test(userMessage);

        const isPageLoading = !!(pageContext && pageContext.isPageLoading);
        const loadingNote = isPageLoading
          ? `- LOADING STATE: the structured context is sparse and the page snapshot is short — the page is most likely still loading its data. Do NOT pretend zeros are real values. Reply in one line: "The page is still loading — give it a moment and ask again." Offer one short suggestion of what they'll be able to ask once data loads.`
          : `- EMPTY DATA HANDLING: if both the structured context and snapshot return only zeros or no rows for what the user asked, distinguish two cases: (a) the FILTER returned nothing (wrong period/location selected) — say so and suggest widening the filter; (b) the category is genuinely unconfigured (no mapping, no transactions) — say so and point to where to configure it. Never imply "your practice has zero X" when it's clearly a configuration or filter issue.`;

        const baseRules = `READ THE QUESTION FIRST. Before you write a single character of the answer, silently identify all four of:
  1. METRIC — what is being asked? (revenue, profit, EBITDA, cost, count, mapping, rate, % change, …)
  2. DIMENSION — what breakdown? (by location, by provider, by treatment, by category, by month, single value, …)
  3. SCOPE — one named entity, all entities, a filter applied, or the user-selected topbar location? "By location" / "across locations" / "compare locations" = ALL locations (not one).
  4. TIME — explicit period in the question, otherwise the page's period in the structured context. Never invent a period.
If the question asks for one of these and your answer addresses a different one (e.g. user asks "by location", you answer "by category"), you have answered the wrong question. Stop and re-read.

- Ground every figure in the page context below (structured data + page snapshot). Never invent data or pull numbers from memory.
- The "Structured page context" is authoritative — pages pass it for facts they know but may not render (e.g. chart-of-account mappings behind a value). Treat it on equal footing with the snapshot.
- Quote values exactly as they appear.
- **NEVER mention internal JSON field names, variable names, array indices, or any code-like identifiers in your reply.** Examples of things you must NEVER write: "the planMix array is empty", "planMixTotalRevenue is £0", "accounts.length", "locations[0]", "the structured context shows", "the aiContext field", "ebitdaReference", "categoryByExtId". The structured context is your private knowledge — describe what it tells you in plain business English. If you find yourself about to write a camelCase or snake_case word, that word is wrong — rephrase as a normal noun ("plan mix", "total revenue", "EBITDA reference data"). This rule applies to EMPTY-DATA responses too: say "no plan-mix data for this period at this location" — never "the planMix array is empty".
- NEVER return a bare £0 / 0% / "—" as the whole answer. If the value is zero, explain in one short clause why it's zero (e.g. "no chart-of-account mapping configured", "no GL entries in this period", "category not yet set up at this location") and what would unblock it. Always combine the number with the cause.
- ADJACENT ADVICE: when the answer reveals a clear problem (a zero where there should be value, a margin below benchmark, a mapping gap, a concentration risk, a falling trend), append a single short advisory line starting with "**Tip:**" that names one concrete next move. Skip the Tip line when the data is healthy.
${loadingNote}`;

        const suggestionRules = `- Mode: ADVISORY. The user wants your professional opinion, not a readout.
- Structure: (1) a one-line read of the situation that names the headline number and its implication; (2) 2–4 prioritised actions as a numbered list — each is **Bold action verb** + one short line of analyst-grade reasoning that cites the specific number/row from the snapshot or structured context and, where relevant, the benchmark it's failing or beating; (3) a single closing line: "Next move:" with the single most important step.
- Order actions by expected impact, not by what's easiest.
- Flag any risk you'd raise to a board (concentration risk, falling collection rate, cost-line drift, capacity loss) — don't bury it.
- If the page doesn't show enough to advise responsibly, say so in one line and name the data that would unlock the call.`;

        const lookupRules = `- Mode: LOOKUP — expert analyst depth. Start with the value, then ONE concise sentence of interpretation (trend, ratio vs benchmark, what's driving it, or what it implies). Add a second short sentence only when there's a non-obvious driver or material caveat. Never just read the number back.
- For mapping/configuration questions (e.g. "which chart of account is mapped to X"), use the structured context — these facts won't be in the snapshot. Both "locations" (page-provided, for the current page) and "accountMappingReference" (loaded on demand for any page) are valid sources. Prefer "locations" when present; otherwise use accountMappingReference.locations.
- For EBITDA / valuation / margin / profit questions, the structured context may contain page-provided EBITDA fields OR an "ebitdaReference" block loaded on demand. Use whichever is present. The ebitdaReference exposes: revenue, cogs, grossProfit, grossMarginPercent, operatingExpenses, totalCosts, ebitda, ebitdaMarginPercent, multiple, enterpriseValue, period, locationName, costBuckets. Quote the period explicitly when citing the figure (e.g. "EBITDA for {period} is £X").
- For per-treatment profitability questions (e.g. "improve Composite Filling margin", "loss-making treatments", "lowest margin"), the structured context may contain page-provided treatments[] (Profitability page) OR a "treatmentProfitabilityReference" block loaded on demand. Both have the same shape: each row exposes treatment, category, avgIncome, materialCost, labBill, therapistPay, opCost, associatePay, financeFee, totalCostPerUnit, profitPerUnit, marginPercent, unitsSold, totalIncome, totalExpense, totalProfitLoss. The reference also pre-ranks the rows in three lists: lossMaking (negative totalProfitLoss, sorted worst first), lowestMargin (lowest marginPercent first), highestMargin (highest first). When the user asks about a specific treatment, find the row whose treatment name matches (case-insensitive contains) and quote its actual figures — never invent numbers or fall back to a generic framework when the row is available. Cite the period from the reference.
- For per-X ratio questions ("revenue per appointment", "revenue per patient", "profit per chair hour" — typically for a named provider), the structured context may contain a "providerStatsReference" block loaded on demand. The reference exposes a providers[] array; each row has provider, revenue, completedAppointments, distinctPatients, daysWorked, revenuePerAppointment, revenuePerPatient, revenuePerDay. The ratios are PRE-DIVIDED — quote them directly. Also quote the two source numbers so the user can verify (e.g. "David Bianchi: £72.45 per completed appointment — £3,839 revenue across 53 appointments"). When the user names a provider, find their row by case-insensitive name contains. If providers[] is empty, surface that cleanly ("no production data for that provider in this period") and suggest the period filter to widen.
- LOCATION HANDLING for mapping questions: mappings are per-location. The structured context exposes a per-location array and the user's currently-selected scope as "selectedLocationName".
  • If the user named a location in their question, answer for that location only.
  • Else if exactly one location is selected (selectedLocationName is a specific location), answer for that selected location.
  • Else if multiple locations exist with different mappings and the user hasn't named one, ASK FIRST: "Which location?" and list the available location names. Do not aggregate or guess.
  • Else (only one configured location, or all locations share the same mapping), answer directly and mention the location(s) by name.
- EMPTY-MAPPING HANDLING: If the requested category is empty at the user's selected location:
  • First scan the per-location array for any OTHER location that DOES have the same category mapped. If any exist, list them so the user can replicate the config: "Lab Fees isn't mapped at South Street. It IS mapped at <Location A> (5040 — Laboratory Costs) and <Location B> (5040 — Laboratory Costs)."
  • If no location has it mapped, say: "Lab Fees hasn't been mapped to a <integration> account at any location yet — set it up in Settings → Expense Accounts."
- When listing mapped accounts, format each as "<code> — <name>" (omit the dash if name is blank). If there are multiple codes for one category at one location, list them as a short bullet list under the location heading. When the user asks for ONE location, never dump every location's list — just the one asked for.
- LANGUAGE RULE: never reference internal JSON field names, array indices, code identifiers ("mappedAccounts", "accounts.length", "locations[0]"), or programming jargon. Pretend the structured context is your own private knowledge — describe it in plain business English.
- DEPTH RULE for non-mapping lookups: if the user asks for one number and the structured context exposes related context (e.g. revenue trend, peer comparison, period split, breakdown by category), use it to add ONE analyst-grade line of interpretation — don't waste the rich context.
- TABLE-MATH RULE: when the page shows a per-row table and the user asks to IDENTIFY rows matching a derived attribute ("loss-making", "below benchmark", "negative margin", "worst margin", "underperforming"), DO the arithmetic on the visible rows yourself. Examples:
  • "Loss-making treatments" → for each row, compute total cost = sum of every cost column shown (material cost + lab bill + therapist pay etc.) and compare to income/revenue. List the rows where cost > income, smallest margin first, with a short per-row note ("Income £X, total cost £Y, loss £Z").
  • "Lowest margin treatments" → margin = (income − total cost) / income. Sort ascending, list top 5–10.
  • "Below benchmark X" → compare each row's metric to the named benchmark and list the rows that fail.
  Never just return the top revenue list if the user asked "which is losing money" — that answers a different question. If the visible table is paginated or truncated, say so in one line and offer to widen the period or paginate.
- If neither source contains the answer, say so in one line and point to something that IS available on this page.
- Use a small table only when comparing rows.`;

        const followupRules = `
FOLLOW-UP CHIPS (REQUIRED): after your answer, append exactly the marker line "---FOLLOWUPS---" on its own line, then a JSON array of 3 short follow-up question strings the user might naturally ask NEXT given THIS answer. Rules for chips:
- 3-7 words each, conversational ("Show by month", "Compare to last year").
- Topically tied to what was just discussed — NOT a generic revenue/profit menu.
- Distinct angles: one drill-down, one comparison, one action ("How can I reduce this?").
- If you asked a clarifying question, the chips should be the direct answer choices for that question.
- Phrase as something the user would type, not a tool name.
Example format at end of message:
---FOLLOWUPS---
["Break this down by month", "Compare to last quarter", "How can I improve this?"]`;

        const systemPrompt = `${EXPERT_PERSONA}

You are answering questions about the page the user is currently on. You will be given two inputs about that page: (1) structured context the page provided programmatically, and (2) a text snapshot of the rendered page. Either may answer the question.

${baseRules}
${wantsSuggestions ? suggestionRules : lookupRules}
${followupRules}`;

        const structuredBlock = structuredJson
          ? `Structured page context (JSON — authoritative facts the page knows about itself):
"""
${structuredJson}
"""

`
          : '';
        const snapshotBlock = trimmedVisibleText
          ? `Page snapshot (rendered text from <main>):
"""
${trimmedVisibleText}
"""

`
          : '';
        const overlayBlock = trimmedOverlays
          ? `Open overlays (dialogs/sheets/popovers/dropdowns visible right now — portaled outside <main>). Treat as part of what the user is looking at:
"""
${trimmedOverlays}
"""

`
          : '';
        const formatPrompt = `User is on: ${pageLabel}
URL: ${snapshot?.url || ''}

${structuredBlock}${overlayBlock}${snapshotBlock}User question: "${userMessage}"

${wantsSuggestions
  ? 'The user is asking for suggestions / recommendations. Respond in advisory tone as instructed in the system prompt.'
  : 'Answer using the structured context and/or page snapshot above.'}`;
        const answer = await claudeClient.callForFormat({
          apiKey: orgKey.apiKey,
          model: orgKey.formatModel,
          systemPrompt,
          userMessage: formatPrompt,
          dataContext: {},
          organizationId,
        });
        if (answer && answer.trim()) {
          const parsed = parseAnswerWithSuggestions(answer);
          const ms = Date.now() - generalStart;
          const kb = (s) => Math.round((s.length || 0) / 102.4) / 10;
          console.log(`[CHATBOT-METRICS] path=general orgId=${organizationId} ms=${ms} ctxKB=${kb(structuredJson)} snapKB=${kb(trimmedVisibleText)} ovrKB=${kb(trimmedOverlays)} pageLoading=${pageContext?.isPageLoading || false} chipsParsed=${parsed.suggestions ? parsed.suggestions.length : 0} mode=${wantsSuggestions ? 'advisory' : 'lookup'} msgLen=${answer.length}`);
          const cleanMessage = scrubInternalIdentifiers(parsed.answer || answer.trim());
          return {
            message: cleanMessage,
            suggestions: parsed.suggestions || generateSuggestions(intent),
          };
        }
      } catch (err) {
        const ms = Date.now() - generalStart;
        console.error(`[CHATBOT-METRICS] path=general orgId=${organizationId} ms=${ms} status=failed err=${err.message}`);
        // Fall through to the generic response.
      }
    }

    // No page snapshot, but the question is clearly advisory (e.g. "how can
    // I reduce cost and grow profit?") — give qualitative expert advice
    // grounded in the persona's industry knowledge, without inventing
    // practice-specific numbers.
    const advisoryNoSnapshot = userMessage && (
      isResolverErrorFallback ||
      /\b(how (do|can) (i|we)|what should (i|we)|any (suggestion|advice|tip)|ways? to|ideas? to|how to)\b/i.test(userMessage)
    );
    if (advisoryNoSnapshot) {
      try {
        const orgKey = await apiKeyService.getOrgApiKey(organizationId);
        const systemPrompt = `${EXPERT_PERSONA}

The user is asking for strategic guidance but no page data is attached. Give qualitative advice based on UK dental practice best practice — do NOT invent specific numbers for this practice. Structure: one-line framing of the lever, then 2–4 prioritised actions (each: **Bold action** + one short line of reasoning citing typical industry dynamics or benchmarks). End with: "To tailor this to your numbers, open the relevant page (e.g. Cost Impact, Profitability) and ask again."

FOLLOW-UP CHIPS (REQUIRED): after your answer, append "---FOLLOWUPS---" on its own line then a JSON array of 3 short follow-ups (3-7 words each, topically tied to the advice you just gave, NOT a generic revenue menu). Example tail:
---FOLLOWUPS---
["Show me lab fee trend", "How do we compare to peers?", "Which location is worst?"]`;
        const answer = await claudeClient.callForFormat({
          apiKey: orgKey.apiKey,
          model: orgKey.formatModel,
          systemPrompt,
          userMessage: `User question: "${userMessage}"\n\nAnswer in advisory tone per the system prompt.`,
          dataContext: {},
          organizationId,
        });
        if (answer && answer.trim()) {
          const parsed = parseAnswerWithSuggestions(answer);
          return {
            message: parsed.answer || answer.trim(),
            suggestions: parsed.suggestions || generateSuggestions(intent),
          };
        }
      } catch (err) {
        console.error('[CHATBOT] advisory-no-snapshot answer failed:', err.message);
      }
    }

    return {
      message: intent.textResponse || "Hello! I'm DentPulse AI. I can help you with financial metrics, provider performance, treatment analysis, chair utilization, and more. What would you like to know?",
      suggestions: [
        'What\'s my revenue this month?',
        'Show profit by provider',
        'Chair utilization rate',
        'Treatment revenue breakdown',
      ],
    };
  }

  // Format based on tool type. Pass userMessage so formatters can render the
  // breakdown the user explicitly asked for ("by chair", "by hour", "by
  // practitioner") rather than always defaulting to the location summary.
  const formatter = FORMATTERS[intent.toolName];
  if (formatter) {
    return formatter(intent, resolved, { userMessage });
  }

  // Fallback: use LLM to format (Phase 1-2 tools)
  try {
    const orgKey = await apiKeyService.getOrgApiKey(organizationId);
    const formatted = await claudeClient.callForFormat({
      apiKey: orgKey.apiKey,
      model: orgKey.formatModel,
      systemPrompt: `${EXPERT_PERSONA}

You are formatting tool-resolved data for the user. Lead with the headline number, then one short line of analyst-grade interpretation (trend, mix, what's driving it). Bold key numbers. Use a markdown table only when comparing rows. Close with a "Next move:" line ONLY when the data clearly justifies one specific action — otherwise omit it.`,
      userMessage: intent.args?.metric || 'financial data',
      dataContext: resolved.data,
      organizationId,
    });
    return {
      message: formatted,
      suggestions: generateSuggestions(intent),
    };
  } catch (err) {
    // If LLM format fails, use basic formatting
    return basicFormat(intent, resolved);
  }
}

// ── Per-tool formatters ──

function formatFinancialMetric(intent, resolved) {
  const { metric, doctorName, locationId, locationName, providerType, topN, totalProviders } = resolved;
  const period = resolved.period;
  // Compose the scope label. Provider-type ("Dentists", "Therapists", …) is
  // pluralised and folded into the scope so the header reflects exactly what
  // was filtered — same as the page's "TOTAL <TYPE>S" card.
  const typePart = providerType
    ? `${providerType.charAt(0).toUpperCase() + providerType.slice(1)}s`
    : null;
  let scope;
  if (doctorName) {
    scope = `**${doctorName}**`;
  } else if (typePart && locationName) {
    scope = `**${typePart} at ${locationName}**`;
  } else if (typePart) {
    scope = `**${typePart}**`;
  } else if (locationName) {
    scope = `**${locationName}**`;
  } else if (locationId) {
    scope = '**Selected Location**';
  } else {
    scope = '**Whole Practice**';
  }

  if (metric === 'revenue' || metric === 'profit') {
    const total = formatCurrency(resolved.total);
    const baseLabel = metric === 'revenue' ? 'Revenue' : 'Profit';
    // Payor-qualified labelling — when the bot filtered to private/NHS/
    // membership, surface that in the header so the user can see at a glance
    // why the total differs from the all-payor production card. Only revenue
    // supports payor today.
    const payorPrefix = (metric === 'revenue' && resolved.payor)
      ? `${resolved.payor.charAt(0).toUpperCase() + resolved.payor.slice(1)} `
      : '';
    const label = `${payorPrefix}${baseLabel}`;
    const isAsc = resolved.sort === 'asc';
    const direction = isAsc ? 'Lowest' : 'Top';

    let md = `### ${label} — ${scope}\n`;
    md += `**Period:** ${fmtPeriod(period.from, period.to)}\n\n`;

    // Empty result — bail with a clear message instead of an empty table.
    if (!doctorName && (!resolved.data || resolved.data.length === 0)) {
      const typeNote = providerType
        ? ` for ${typePart}`
        : '';
      md += `_No ${metric} data found${typeNote} at this location for this period._\n\n`;
      md += `Try a wider period, a different location, or remove the provider-type filter (you're on a page that scopes by type).`;
      return {
        message: md,
        suggestions: [
          'Try a wider period',
          'Compare with last month',
          'Show whole practice instead',
        ],
      };
    }

    md += `**Total ${label}:** ${total}\n\n`;

    // Per-location breakdown — emitted when the user picked multiple sites
    // so they can see each one's contribution rather than just the combined
    // total.
    const byLocation = Array.isArray(resolved.byLocation) ? resolved.byLocation : null;
    if (byLocation && byLocation.length > 1) {
      md += `#### ${label} by Location\n\n`;
      md += `| Location | ${label} |\n`;
      md += `|----------|---------|\n`;
      for (const row of byLocation) {
        md += `| ${row.location_name} | ${formatCurrency(row.total)} |\n`;
      }
      md += `\n`;
    }

    // Slice — explicit "top N" wins; otherwise cap at 10 (existing behavior).
    const cap = topN || 10;
    const providers = (resolved.data || []).slice(0, cap);
    if (providers.length > 0 && !doctorName) {
      md += `#### ${direction} Providers by ${label}\n\n`;
      if (topN && totalProviders && totalProviders > topN) {
        md += `Showing top ${topN} of ${totalProviders} providers.\n\n`;
      }
      md += `| Provider | ${label} | Rank |\n`;
      md += `|----------|---------|------|\n`;
      for (const p of providers) {
        const val = metric === 'revenue' ? p.production_amount : p.periodic_profit;
        md += `| ${p.provider_name || 'Unknown'} | ${formatCurrency(val)} | #${p.rank || '-'} |\n`;
      }
    }

    return {
      message: md,
      suggestions: [
        `Break down ${metric} by month`,
        `Compare providers on ${metric}`,
        doctorName ? 'Show whole practice' : 'Show top provider detail',
        `${metric === 'revenue' ? 'Show profit' : 'Show revenue'} instead`,
      ],
    };
  }

  if (metric === 'patients') {
    const count = typeof resolved.total === 'object' ? resolved.total.count : resolved.total;
    return {
      message: `### Active Patients — ${scope}\n**Period:** ${fmtPeriod(period.from, period.to)}\n\n**Total Distinct Patients:** **${count || 0}**`,
      suggestions: ['Show revenue this month', 'Compare with last month', 'Patient trend by month'],
    };
  }

  return basicFormat(intent, resolved);
}

function formatCashflow(intent, resolved) {
  const data = resolved.data;
  if (!data) {
    return { message: 'No cashflow data available for this period.', suggestions: ['Try a different period'] };
  }

  const received = formatCurrency(data.received_this || data.totalReceived || 0);
  const paid = formatCurrency(data.paid_this || data.totalPaid || 0);
  const net = formatCurrency(data.net_this || data.netCashflow || 0);
  const closing = formatCurrency(data.closing_this || data.closingBalance || 0);
  const opening = formatCurrency(data.opening_this || 0);

  // Focused balance card when the user specifically asked for the closing /
  // cash balance ("what is the closing balance of this month").
  if (intent?.args?.metric === 'balance') {
    const md = `### Cash Balance\n**As of:** ${resolved.period?.to}\n\n| Metric | Amount |\n|--------|--------|\n| Opening Balance | ${opening} |\n| Net Cashflow (period) | ${net} |\n| **Closing Balance** | **${closing}** |`;
    return {
      message: md,
      suggestions: ['Show cashflow this month', 'Cashflow trend', 'Show revenue'],
    };
  }

  const md = `### Cashflow Overview\n**Period:** ${resolved.period?.from} to ${resolved.period?.to}\n\n| Metric | Amount |\n|--------|--------|\n| Received | ${received} |\n| Paid | ${paid} |\n| **Net Cashflow** | **${net}** |\n| Closing Balance | ${closing} |`;

  return {
    message: md,
    suggestions: ['Show revenue', 'Show profit', 'Cashflow trend'],
  };
}

function formatChairMetrics(intent, resolved, options = {}) {
  const userMessage = (options.userMessage || '').toLowerCase();
  const chairs = resolved.data || [];
  const summary = resolved.pageSummary || null;
  const practitioners = Array.isArray(resolved.practitioners) ? resolved.practitioners : null;
  const hourly = Array.isArray(resolved.hourly) ? resolved.hourly : null;

  // Detect which breakdown the user asked for. "by chair" / "explain by
  // chair" / "per chair" all mean the per-practitioner Practitioner
  // Appointments table the chairs page shows on its "By Chair" tab.
  const wantsByChair = /\b(?:by|per)\s+(?:chair|practitioner|clinician|provider)\b|\bexplain\s+by\s+(?:chair|practitioner|clinician)\b/i.test(userMessage)
    || /\btop\s+practitioners?\b/i.test(userMessage);
  const wantsHourly = /\b(?:by\s+hour|hourly|per\s+hour|hour\s+by\s+hour)\b|\bpeak\s+hours?\b|\blow[\s-]?utilisation\s+hours?\b/i.test(userMessage);

  if (chairs.length === 0 && !summary && !practitioners && !hourly) {
    return {
      message: `No chair utilisation data for **${resolved.period?.from} to ${resolved.period?.to}**. This metric is computed from completed appointments — try a longer or more recent period.`,
      suggestions: ['Chair utilisation last month', 'Chair utilisation this year', 'Show revenue instead'],
    };
  }

  const scope = summary?.selectedLocationName || (chairs.length === 1 ? chairs[0].location_name : null);
  const header = scope ? ` — ${scope}` : '';

  // ── "By Chair / By Practitioner" view ────────────────────────────────────
  if (wantsByChair && practitioners && practitioners.length > 0) {
    let md = `### Chair Utilisation by Practitioner${header}\n**Period:** ${resolved.period?.from} to ${resolved.period?.to}\n\n`;
    if (summary) {
      md += `**Total Chairs:** ${summary.totalChairs ?? '—'}  |  `;
      md += `**Avg Occupancy:** ${summary.avgOccupancy != null ? `${summary.avgOccupancy}%` : '—'}  |  `;
      md += `**Avg Utilisation:** ${summary.avgUtilisation != null ? `${summary.avgUtilisation}%` : '—'}\n\n`;
    }
    // Mirror the page's "By Chair" tab: Practitioner | Appointments (completed/total) | Hours | Completion %
    md += `| Practitioner | Appointments | Hours | Completion % |\n`;
    md += `|--------------|--------------|-------|--------------|\n`;
    const sorted = [...practitioners].sort((a, b) => (b.completedHours || 0) - (a.completedHours || 0));
    for (const p of sorted.slice(0, 15)) {
      const completed = p.completedAppointments ?? p.completed_appointments ?? 0;
      const total = p.totalAppointments ?? p.total_appointments ?? 0;
      const hours = p.completedHours ?? p.completed_hours ?? 0;
      const pct = p.completionPct ?? p.completion_pct ?? (total > 0 ? (completed / total) * 100 : 0);
      md += `| ${p.practitioner || p.name || 'Unknown'} | ${completed}/${total} | ${Number(hours).toFixed(1)} | ${formatPercent(pct)} |\n`;
    }
    return {
      message: md,
      suggestions: ['Hourly chair usage', 'Show revenue per chair', 'Compare to last month'],
    };
  }

  // ── "Hourly" view ────────────────────────────────────────────────────────
  if (wantsHourly && hourly && hourly.length > 0) {
    let md = `### Chair Utilisation by Hour${header}\n**Period:** ${resolved.period?.from} to ${resolved.period?.to}\n\n`;
    md += `| Hour | Utilisation | Appointments |\n`;
    md += `|------|-------------|--------------|\n`;
    const sorted = [...hourly].sort((a, b) => String(a.hour).localeCompare(String(b.hour)));
    for (const h of sorted) {
      const u = h.utilisationPct ?? h.utilisation_pct ?? h.utilisation ?? 0;
      const appts = h.appointments ?? 0;
      md += `| ${h.hour} | ${formatPercent(u)} | ${appts} |\n`;
    }
    if (summary?.peakHours || summary?.lowUtilisationHours) {
      md += `\n`;
      const peak = Array.isArray(summary.peakHours) && summary.peakHours.length > 0
        ? summary.peakHours.map(x => typeof x === 'string' ? x : (x.hour || JSON.stringify(x))).slice(0, 3).join(', ')
        : null;
      const low = Array.isArray(summary.lowUtilisationHours) && summary.lowUtilisationHours.length > 0
        ? summary.lowUtilisationHours.map(x => typeof x === 'string' ? x : (x.hour || JSON.stringify(x))).slice(0, 3).join(', ')
        : null;
      if (peak) md += `**Peak hours:** ${peak}\n`;
      if (low) md += `**Low-utilisation hours:** ${low}\n`;
    }
    return {
      message: md,
      suggestions: ['Show by practitioner', 'Chair trends by month', 'Compare to last month'],
    };
  }

  // ── Default: location summary ────────────────────────────────────────────
  let md = `### Chair Utilisation${header}\n**Period:** ${resolved.period?.from} to ${resolved.period?.to}\n\n`;
  if (summary) {
    md += `**Total Chairs:** ${summary.totalChairs ?? '—'}  |  `;
    md += `**Avg Occupancy:** ${summary.avgOccupancy != null ? `${summary.avgOccupancy}%` : '—'}  |  `;
    md += `**Avg Utilisation:** ${summary.avgUtilisation != null ? `${summary.avgUtilisation}%` : '—'}  |  `;
    md += `**Avg Revenue/Chair:** ${summary.avgRevenuePerChair != null ? formatCurrency(summary.avgRevenuePerChair) : '—'}\n\n`;
  }
  if (chairs.length > 0) {
    md += `| Location | Chairs | Occupancy | Utilisation | Revenue/Chair |\n`;
    md += `|----------|--------|-----------|-------------|---------------|\n`;
    for (const c of chairs.slice(0, 15)) {
      md += `| ${c.location_name || 'Unknown'} | ${c.chairs_count || 0} | ${formatPercent(c.occupancy_pct)} | ${formatPercent(c.utilisation_pct)} | ${formatCurrency(c.revenue_per_chair)} |\n`;
    }
    md += `\n`;
  }
  if (summary && (Array.isArray(summary.peakHours) || Array.isArray(summary.lowUtilisationHours))) {
    const peak = Array.isArray(summary.peakHours) && summary.peakHours.length > 0
      ? summary.peakHours.map(h => typeof h === 'string' ? h : (h.hour || h.label || JSON.stringify(h))).slice(0, 3).join(', ')
      : null;
    const low = Array.isArray(summary.lowUtilisationHours) && summary.lowUtilisationHours.length > 0
      ? summary.lowUtilisationHours.map(h => typeof h === 'string' ? h : (h.hour || h.label || JSON.stringify(h))).slice(0, 3).join(', ')
      : null;
    if (peak) md += `**Peak hours:** ${peak}\n`;
    if (low) md += `**Low-utilisation hours:** ${low}\n`;
  }
  return {
    message: md,
    suggestions: ['Show by chair', 'Hourly chair usage', 'Chair trends by month', 'Show revenue per chair'],
  };
}

function formatTreatmentRevenue(intent, resolved) {
  const rows = resolved.data || [];
  if (rows.length === 0) {
    return { message: 'No treatment revenue data available.', suggestions: ['Show overall revenue'] };
  }

  const dimension = resolved.dimension === 'treatment' ? 'treatment' : 'category';
  const isAsc = resolved.sort === 'asc';

  const dimLabel = dimension === 'treatment' ? 'Treatment' : 'Category';
  const direction = isAsc ? 'Lowest' : 'Top';

  const scope = resolved.locationName
    ? `**${resolved.locationName}**`
    : ((resolved.locationId || (resolved.locationIds && resolved.locationIds.length > 0))
        ? '**Selected Location**'
        : '**Whole Practice**');

  // % of Total is computed from the unsliced sum so the percentages still
  // reflect each row's share of the period — not just the visible slice.
  const total = rows.reduce((s, r) => s + r.revenue, 0);

  // When the bot inherited the period from the page's filter (vs the user
  // typing it explicitly), flag that in parentheses so the user knows where
  // the date came from and how to override.
  const periodSourceNote = resolved.periodSource === 'page-filter'
    ? ' _(using this page\'s date filter — say e.g. "for last quarter" to override)_'
    : '';
  // Surface the payor filter in the header so the user knows the table is
  // payor-filtered, not all-payor.
  const payorWord = resolved.payor
    ? `${resolved.payor.charAt(0).toUpperCase() + resolved.payor.slice(1)} `
    : '';

  let md = `### ${direction} ${payorWord}Treatments by Revenue (by ${dimLabel}) — ${scope}\n`;
  md += `**Period:** ${resolved.period?.from} to ${resolved.period?.to}${periodSourceNote}\n`;
  md += `**Total:** ${formatCurrency(total)}\n\n`;

  if (dimension === 'treatment') {
    md += `| ${dimLabel} | Category | Revenue | Volume | % of Total |\n`;
    md += `|----------|----------|---------|--------|------------|\n`;
    for (const r of rows.slice(0, 15)) {
      const pct = total > 0 ? ((r.revenue / total) * 100).toFixed(1) : '0';
      md += `| ${r.treatment} | ${r.category || '-'} | ${formatCurrency(r.revenue)} | ${r.count} | ${pct}% |\n`;
    }
  } else {
    md += `| ${dimLabel} | Revenue | Volume | % of Total |\n`;
    md += `|----------|---------|--------|------------|\n`;
    for (const r of rows.slice(0, 15)) {
      const pct = total > 0 ? ((r.revenue / total) * 100).toFixed(1) : '0';
      md += `| ${r.category} | ${formatCurrency(r.revenue)} | ${r.count} | ${pct}% |\n`;
    }
  }

  return {
    message: md,
    suggestions: [
      isAsc ? 'Show top treatments instead' : 'Show lowest treatments instead',
      dimension === 'treatment' ? 'Group by category' : 'Show individual treatments',
      'Compare NHS vs Private',
      'Show revenue by provider',
    ],
  };
}

function formatLocationMetrics(intent, resolved) {
  const locations = resolved.data || [];
  if (locations.length === 0) {
    return { message: 'No location data available.', suggestions: ['Show overall revenue'] };
  }

  // Surface the payor scope in the title so the user can immediately tell
  // whether the table is private-only / NHS-only / membership-only or all-
  // payor — same pattern as formatFinancialMetric. Without this, the table
  // looks identical to the all-payor version and the numbers don't reconcile
  // with the page's "Private Revenue" / "NHS Revenue" cards.
  const payorPrefix = resolved.payor
    ? `${resolved.payor.charAt(0).toUpperCase() + resolved.payor.slice(1)} `
    : '';
  const periodSourceNote = resolved.periodSource === 'page-filter'
    ? ' _(using this page\'s date filter — say e.g. "for last quarter" to override)_'
    : '';

  let md = `### ${payorPrefix}Location Performance\n`;
  md += `**Period:** ${resolved.period?.from} to ${resolved.period?.to}${periodSourceNote}\n\n`;
  md += `| Location | ${payorPrefix}Revenue |\n`;
  md += `|----------|---------|\n`;

  for (const l of locations) {
    md += `| ${l.location_name} | ${formatCurrency(l.revenue)} |\n`;
  }

  return {
    message: md,
    suggestions: ['Compare locations', 'Show chair utilisation by location', 'Show overall profit'],
  };
}

// ── Phase 2 formatters ──

function formatCompareDoctors(intent, resolved) {
  const { doctor1_name, doctor2_name, metric, v1, v2, diff, pctDiff } = resolved;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';

  let md = `### ${label} Comparison\n`;
  md += `**Period:** ${fmtPeriod(resolved.period.from, resolved.period.to)}\n\n`;
  md += `| Provider | ${label} |\n`;
  md += `|----------|--------|\n`;
  md += `| **${doctor1_name}** | ${formatCurrency(resolved.data.v1)} |\n`;
  md += `| **${doctor2_name}** | ${formatCurrency(resolved.data.v2)} |\n`;
  md += `| **Difference** | ${formatCurrency(resolved.data.diff)} (${pctDiff}%) |\n`;

  const winner = resolved.data.v1 >= resolved.data.v2 ? doctor1_name : doctor2_name;

  return {
    message: md,
    suggestions: [
      `Show ${winner}'s trend by month`,
      `Compare on ${metric === 'profit' ? 'revenue' : 'profit'}`,
      'Compare more providers',
    ],
  };
}

function formatCompareMultipleDoctors(intent, resolved) {
  const { metric, spread, topPerformer } = resolved;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';
  const providers = resolved.data || [];

  let md = `### ${label} Ranking (${providers.length} providers)\n`;
  md += `**Period:** ${fmtPeriod(resolved.period.from, resolved.period.to)}\n\n`;
  md += `| # | Provider | ${label} |\n`;
  md += `|---|----------|--------|\n`;

  providers.forEach((p, i) => {
    md += `| ${i + 1} | ${p.name} | ${formatCurrency(p.value)} |\n`;
  });

  md += `\n**Top performer:** ${topPerformer} | **Spread:** ${spread}%`;

  return {
    message: md,
    suggestions: [
      `Compare ${topPerformer} with others`,
      `Show ${metric} trend by month`,
      `Compare on ${metric === 'profit' ? 'revenue' : 'profit'}`,
    ],
  };
}

function formatComparePeriods(intent, resolved) {
  const { metric, total1, total2, delta, pctChange, doctorName } = resolved;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';
  const scope = doctorName ? `**${doctorName}**` : '**Whole Practice**';
  const direction = delta >= 0 ? 'up' : 'down';
  const arrow = delta >= 0 ? '↑' : '↓';

  let md = `### ${label} — Period Comparison — ${scope}\n\n`;
  md += `| Period | ${label} |\n`;
  md += `|--------|--------|\n`;
  md += `| ${fmtPeriod(resolved.period1.from, resolved.period1.to)} | ${formatCurrency(total1)} |\n`;
  md += `| ${fmtPeriod(resolved.period2.from, resolved.period2.to)} | ${formatCurrency(total2)} |\n`;
  const displayPct = isNaN(pctChange) || pctChange === '—' ? '0.0' : Math.abs(pctChange);
  md += `| **Change** | **${formatCurrency(delta)} (${arrow} ${displayPct}%)** |\n`;

  return {
    message: md,
    suggestions: [
      `Why is ${metric} ${direction}?`,
      `Forecast ${metric} next 3 months`,
      `Break down by provider`,
    ],
  };
}

function formatMultiPeriodReport(intent, resolved) {
  const { data: periods, metric, reportType, doctorName } = resolved;
  const label = reportType === 'pl' ? 'P&L' : 'Revenue';
  const scope = doctorName ? `**${doctorName}**` : '**Whole Practice**';

  let md = `### Multi-Period ${label} Report — ${scope}\n\n`;
  md += `| Period | Total |\n`;
  md += `|--------|-------|\n`;

  for (const p of periods) {
    md += `| ${p.label} | ${formatCurrency(p.total)} |\n`;
  }

  // Variance rows
  if (periods.length >= 2) {
    md += `\n### Period-over-Period Change\n\n`;
    md += `| Comparison | Change | % |\n`;
    md += `|------------|--------|---|\n`;
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1];
      const curr = periods[i];
      const delta = curr.total - prev.total;
      const pct = prev.total !== 0 ? ((delta / Math.abs(prev.total)) * 100).toFixed(1) : '—';
      const arrow = delta >= 0 ? '↑' : '↓';
      md += `| ${prev.label} → ${curr.label} | ${formatCurrency(delta)} | ${arrow} ${Math.abs(pct)}% |\n`;
    }
  }

  return {
    message: md,
    suggestions: [
      'Show trend by month',
      'Compare providers',
      'Download PDF report',
    ],
  };
}

// ── Phase 3 formatters ──

function formatDrillDown(intent, resolved) {
  const { metric, dimension, scope, topN, totalProviders } = resolved;
  const METRIC_LABELS = { revenue: 'Revenue', profit: 'Profit', cashflow: 'Cashflow', patients: 'Patients' };
  const label = METRIC_LABELS[metric] || (metric ? metric.charAt(0).toUpperCase() + metric.slice(1) : 'Revenue');
  const dimLabel = dimension.charAt(0).toUpperCase() + dimension.slice(1);
  const scopeSuffix = scope ? ` — **${scope}**` : '';

  let md = `### ${label} by ${dimLabel}${scopeSuffix}\n`;
  md += `**Period:** ${fmtPeriod(resolved.period.from, resolved.period.to)}\n\n`;

  const hasRows = resolved.chart && Array.isArray(resolved.chart.labels) && resolved.chart.labels.length > 0;

  // Empty result — emit a clear "no rows" message and drop the empty chart
  // payload so the UI doesn't render an empty placeholder box beneath it.
  if (!hasRows) {
    delete resolved.chart;
    md += `_No ${metric} data found for this ${dimension === 'provider' ? 'provider type and ' : ''}period._\n\n`;
    md += `Try a wider period, a different location, or remove the provider-type filter (you're on a page that scopes by type).`;
    return {
      message: md,
      suggestions: [
        'Try a wider period',
        'Compare with last month',
        'Show whole practice instead',
      ],
    };
  }

  if (topN && totalProviders && totalProviders > topN) {
    md += `Showing top ${topN} of ${totalProviders} providers.\n\n`;
  }

  const chart = resolved.chart;
  md += `| ${dimLabel} | ${label} |\n`;
  md += `|----------|--------|\n`;
  chart.labels.forEach((l, i) => {
    md += `| ${l} | ${formatCurrency(chart.values[i])} |\n`;
  });

  return {
    message: md,
    suggestions: [
      dimension !== 'month' ? 'Break down by month' : 'Break down by provider',
      `Why is ${metric} changing?`,
      `Forecast ${metric}`,
    ],
  };
}

function formatExplainWhy(intent, resolved) {
  const { data, metric, locationName, period } = resolved;
  const { drivers, totalCurr, totalPrev, totalDelta, direction } = data;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';
  const arrow = direction === 'up' ? '↑' : '↓';
  // Show location scope in the title so the user can tell which slice they're
  // looking at — without it, a positive org-wide trend looks contradictory
  // when the user just saw a negative single-location trend on the page.
  const scope = locationName ? ` — ${locationName}` : '';

  let md = `### Why is ${label} ${direction}?${scope}\n`;
  md += `**Period:** ${period?.from} to ${period?.to}\n`;
  md += `**Current period:** ${formatCurrency(totalCurr)} | **Previous:** ${formatCurrency(totalPrev)} | **Change:** ${formatCurrency(totalDelta)} ${arrow}\n\n`;
  md += `**Top contributing factors:**\n\n`;
  md += `| Provider | Current | Previous | Change |\n`;
  md += `|----------|---------|----------|--------|\n`;

  for (const d of drivers) {
    const dArrow = d.delta >= 0 ? '↑' : '↓';
    md += `| ${d.name} | ${formatCurrency(d.current)} | ${formatCurrency(d.previous)} | ${formatCurrency(d.delta)} ${dArrow} |\n`;
  }

  return {
    message: md,
    suggestions: [
      `Forecast ${metric} next 3 months`,
      `Break down ${metric} by month`,
      `Show ${metric === 'profit' ? 'revenue' : 'profit'} trend`,
    ],
  };
}

function formatForecast(intent, resolved) {
  const { data, metric, doctorName } = resolved;
  const { historical, forecast, slope } = data;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';
  const scope = doctorName ? `**${doctorName}**` : '**Whole Practice**';
  const trend = slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'flat';

  let md = `### ${label} Forecast — ${scope}\n`;
  md += `**Trend:** ${trend} (${slope >= 0 ? '+' : ''}${formatCurrency(slope)}/month)\n\n`;
  md += `**Projected:**\n\n`;
  md += `| Month | Forecast |\n`;
  md += `|-------|----------|\n`;

  for (const f of forecast) {
    md += `| ${f.label} | ${formatCurrency(f.value)} |\n`;
  }

  return {
    message: md,
    suggestions: [
      `What if revenue increases 10%?`,
      `Break down ${metric} by provider`,
      `Compare with last year`,
    ],
  };
}

function formatWhatIf(intent, resolved) {
  const { data, metric } = resolved;
  const { baseline, changePercent, change, newTotal } = data;
  const label = metric === 'profit' ? 'Profit' : 'Revenue';
  const direction = changePercent >= 0 ? 'increase' : 'decrease';

  let md = `### What-If Scenario: ${label} ${direction} of ${Math.abs(changePercent)}%\n`;
  md += `**Period:** ${fmtPeriod(resolved.period.from, resolved.period.to)}\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Current ${label} | ${formatCurrency(baseline)} |\n`;
  md += `| Change (${changePercent >= 0 ? '+' : ''}${changePercent}%) | ${formatCurrency(change)} |\n`;
  md += `| **New ${label}** | **${formatCurrency(newTotal)}** |\n`;

  return {
    message: md,
    suggestions: [
      `What if ${changePercent >= 0 ? 'down' : 'up'} ${Math.abs(changePercent)}% instead?`,
      `Forecast ${metric} next 3 months`,
      'Show revenue breakdown',
    ],
  };
}

// ── Helpers ──

function basicFormat(intent, resolved) {
  console.warn('[CHATBOT-FORMAT] basicFormat fallback', {
    tool: intent.toolName,
    args: intent.args,
    resolvedKeys: resolved ? Object.keys(resolved) : null,
    metric: resolved?.metric,
    total: resolved?.total,
  });
  const totalDisplay = typeof resolved.total === 'number' ? formatCurrency(resolved.total) : (resolved.total || 'N/A');
  return {
    message: `I retrieved data for **${intent.toolName}** but didn't have a layout for the result. Total: ${totalDisplay}.`,
    suggestions: generateSuggestions(intent),
  };
}

function generateSuggestions(intent) {
  const suggestions = ['Show revenue this month', 'Show profit', 'Chair utilisation'];
  if (intent.args?.doctor_name) {
    suggestions.push(`Compare ${intent.args.doctor_name} with others`);
  }
  return suggestions.slice(0, 4);
}

function formatRevenueBreakdown(intent, resolved) {
  const { period, total, providers = [], treatments = [], categories = [], locationName, locationId } = resolved;
  const scope = locationName ? `**${locationName}**` : (locationId ? '**Selected Location**' : '**Whole Practice**');
  const TOP_N = 15;

  let md = `### Revenue Breakdown — ${scope}\n`;
  md += `**Period:** ${fmtPeriod(period.from, period.to)}\n`;
  md += `**Total Revenue:** ${formatCurrency(total)}\n\n`;

  // Hide rows whose revenue rounds to £0.00 — charting/admin entries and
  // sub-penny amounts that clutter the report. Totals are computed on the
  // full set so they still reconcile with Total Revenue.
  const isNonZero = (v) => Math.abs(parseFloat(v) || 0) >= 0.01;
  const nzProviders = providers.filter(p => isNonZero(p.revenue));
  const nzTreatments = treatments.filter(t => isNonZero(t.revenue));
  const nzCategories = categories.filter(c => isNonZero(c.revenue));

  if (nzProviders.length > 0) {
    const shown = nzProviders.slice(0, TOP_N);
    const shownSum = shown.reduce((s, p) => s + (p.revenue || 0), 0);
    const grandSum = providers.reduce((s, p) => s + (p.revenue || 0), 0);
    const truncated = nzProviders.length > TOP_N;
    md += `#### By Practitioner\n\n`;
    md += `| Provider | Revenue |\n|----------|---------:|\n`;
    for (const p of shown) {
      md += `| ${p.name} | ${formatCurrency(p.revenue)} |\n`;
    }
    md += truncated
      ? `| **Subtotal (top ${TOP_N})** | **${formatCurrency(shownSum)}** |\n| **Total (${nzProviders.length} providers)** | **${formatCurrency(grandSum)}** |\n`
      : `| **Total** | **${formatCurrency(grandSum)}** |\n`;
    md += `\n`;
  }

  if (nzTreatments.length > 0) {
    const shown = nzTreatments.slice(0, TOP_N);
    const shownSum = shown.reduce((s, t) => s + (t.revenue || 0), 0);
    const grandSum = treatments.reduce((s, t) => s + (t.revenue || 0), 0);
    const truncated = nzTreatments.length > TOP_N;
    md += `#### By Treatment\n\n`;
    md += `| Treatment | Category | Revenue |\n|-----------|----------|---------:|\n`;
    for (const t of shown) {
      md += `| ${t.name} | ${t.category} | ${formatCurrency(t.revenue)} |\n`;
    }
    md += truncated
      ? `| **Subtotal (top ${TOP_N})** |  | **${formatCurrency(shownSum)}** |\n| **Total (${nzTreatments.length} treatments)** |  | **${formatCurrency(grandSum)}** |\n`
      : `| **Total** |  | **${formatCurrency(grandSum)}** |\n`;
    md += `\n`;
  }

  if (nzCategories.length > 0) {
    const grandSum = categories.reduce((s, c) => s + (c.revenue || 0), 0);
    md += `#### By Category\n\n`;
    md += `| Category | Revenue | % of Total |\n|----------|---------:|-----:|\n`;
    for (const c of nzCategories.slice(0, TOP_N)) {
      const pct = total > 0 ? ((c.revenue / total) * 100).toFixed(1) : '0';
      md += `| ${c.category} | ${formatCurrency(c.revenue)} | ${pct}% |\n`;
    }
    md += `| **Total** | **${formatCurrency(grandSum)}** | **100.0%** |\n`;
  }

  return {
    message: md,
    suggestions: [
      'Compare with previous period',
      'Show profit instead',
      'Break down revenue by month',
      'Show top provider detail',
    ],
  };
}

// ── Attendance / DNA formatter ──
function formatAttendanceMetric(intent, resolved) {
  const { period, locationName, summary, byProvider } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Whole Practice**';
  const total = summary?.total || 0;
  const dna = summary?.dna || 0;
  const cancelled = summary?.cancelled || 0;
  const completed = summary?.completed || 0;
  const pct = (n) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '–');

  let md = `### Attendance / DNA Rate — ${scope}\n`;
  md += `**Period:** ${fmtPeriod(period.from, period.to)}\n\n`;

  if (total === 0) {
    md += `_No appointments found at this location for this period._`;
    return {
      message: md,
      suggestions: ['Try a wider period', 'Compare locations', 'Show revenue instead'],
    };
  }

  md += `**Total appointments:** ${total.toLocaleString()}\n`;
  md += `- **Completed:** ${completed.toLocaleString()} (${pct(completed)})\n`;
  md += `- **Cancelled:** ${cancelled.toLocaleString()} (${pct(cancelled)})\n`;
  md += `- **DNA (Did Not Attend):** ${dna.toLocaleString()} (${pct(dna)})\n\n`;

  if (Array.isArray(byProvider) && byProvider.length > 0) {
    md += `#### DNAs by Provider\n\n`;
    md += `| Provider | DNA | Total | DNA % |\n`;
    md += `|----------|----:|------:|------:|\n`;
    for (const p of byProvider.slice(0, 10)) {
      const provPct = p.total > 0 ? `${((p.dna / p.total) * 100).toFixed(1)}%` : '–';
      md += `| ${p.provider_name || 'Unknown'} | ${p.dna} | ${p.total} | ${provPct} |\n`;
    }
  }

  // Light, non-prescriptive benchmark callout — only for visible periods.
  if (total >= 30) {
    const dnaRate = (dna / total) * 100;
    if (dnaRate > 7) {
      md += `\n_Industry benchmark: 4–6% is typical. ${dnaRate.toFixed(1)}% is on the higher end — appointment-confirmation reminders are usually the first lever to pull._`;
    } else if (dnaRate < 4) {
      md += `\n_Industry benchmark: 4–6% is typical. ${dnaRate.toFixed(1)}% is healthy._`;
    }
  }

  return {
    message: md,
    suggestions: [
      'Compare with last month',
      'DNAs by day of week',
      'Show revenue instead',
    ],
  };
}

// ── Recommendations formatter ──
function formatRecommendations(intent, resolved) {
  const recs = Array.isArray(resolved.recommendations) ? resolved.recommendations : [];
  if (recs.length === 0) {
    return {
      message:
        `### Suggestions\n\n` +
        `I don't have any active recommendations for this practice right now — that usually means the recent metrics are within healthy ranges.\n\n` +
        `Try asking me something specific instead, e.g.:\n\n` +
        `- *"Why is revenue down vs last month?"*\n` +
        `- *"Top 5 dentists by revenue"*\n` +
        `- *"Compare South Street and Wigmore profit"*\n`,
      suggestions: [
        'Revenue this month',
        'Compare with last month',
        'Top providers by revenue',
        'Cashflow this month',
      ],
    };
  }
  let md = `### Suggestions\n\n`;
  for (const r of recs.slice(0, 5)) {
    md += `**${r.title || 'Recommendation'}**\n\n${r.body || ''}\n\n`;
    if (r.suggested_action) {
      md += `_Suggested action:_ ${r.suggested_action}\n\n`;
    }
    md += `---\n\n`;
  }
  return {
    message: md.replace(/---\n\n$/, ''),
    suggestions: [
      'Explain the first one',
      'Compare with last month',
      'Show revenue trend',
    ],
  };
}

// Timezone-aware date formatters used by every patient/appointment list.
// Dentally appointment times come back as ISO strings in UTC; rendering them
// without an explicit timezone makes Node use the server's TZ (typically UTC
// in cloud) which mismatches what users see in Dentally (Europe/London).
// Force Europe/London so DST is handled correctly year-round.
const UK_TZ = 'Europe/London';
function fmtUkDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: UK_TZ });
}
function fmtUkDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: UK_TZ }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK_TZ });
}

// Transaction-level cost detail formatter. Shows one row per invoice line
// (supplier, account, amount, date) — the deeper drill behind list_cost_entries.
// Profit & Loss — current period vs prior period with variance, mirrors the
// Profitability page's comparison view. Each line shows £ current, £ prior,
// £ variance, % variance and (where meaningful) margin %.
function formatProfitAndLoss(intent, resolved) {
  const { current, prior, period, priorPeriod, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);
  const priorLabel  = prior ? fmtPeriod(priorPeriod.from, priorPeriod.to) : '—';

  if (current.revenue <= 0 && current.totalCosts <= 0) {
    return {
      message:
        `### Profit & Loss — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No revenue or cost activity in this period._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  // Variance helpers. Negative variance is "worse" for revenue / margin,
  // "better" for cost. We render the raw delta and a percentage of prior.
  const v = (cur, pr) => ({
    abs: cur - (pr || 0),
    pct: pr ? ((cur - pr) / Math.abs(pr)) * 100 : null,
  });
  const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const fmtAbs = (n) => (n < 0 ? '−' : '+') + formatCurrency(Math.abs(n));
  const fmtMargin = (n) => `${n.toFixed(1)}%`;

  let md = `### Profit & Loss — ${scope}\n`;
  md += `**Period:** ${periodLabel}`;
  if (prior) md += `  ·  **vs prior period:** ${priorLabel}`;
  md += `\n\n`;

  if (prior) {
    const dRev   = v(current.revenue,     prior.revenue);
    const dCogs  = v(current.cogs,        prior.cogs);
    const dGP    = v(current.grossProfit, prior.grossProfit);
    const dOpex  = v(current.opex,        prior.opex);
    const dEbi   = v(current.ebitda,      prior.ebitda);
    md += `| Line | Current | Margin | Prior | Variance |\n`;
    md += `|------|--------:|------:|------:|---------:|\n`;
    md += `| **Revenue** | ${formatCurrency(current.revenue)} | — | ${formatCurrency(prior.revenue)} | ${fmtAbs(dRev.abs)} (${fmtPct(dRev.pct)}) |\n`;
    md += `| − Cost of sales | ${formatCurrency(current.cogs)} | ${fmtMargin((current.cogs / current.revenue) * 100)} | ${formatCurrency(prior.cogs)} | ${fmtAbs(dCogs.abs)} (${fmtPct(dCogs.pct)}) |\n`;
    md += `| **= Gross profit** | ${formatCurrency(current.grossProfit)} | ${fmtMargin(current.grossMargin)} | ${formatCurrency(prior.grossProfit)} | ${fmtAbs(dGP.abs)} (${fmtPct(dGP.pct)}) |\n`;
    md += `| − Operating expenses | ${formatCurrency(current.opex)} | ${fmtMargin((current.opex / current.revenue) * 100)} | ${formatCurrency(prior.opex)} | ${fmtAbs(dOpex.abs)} (${fmtPct(dOpex.pct)}) |\n`;
    md += `| **= EBITDA** | ${current.ebitda < 0 ? '−' : ''}${formatCurrency(Math.abs(current.ebitda))} | ${fmtMargin(current.ebitdaMargin)} | ${prior.ebitda < 0 ? '−' : ''}${formatCurrency(Math.abs(prior.ebitda))} | ${fmtAbs(dEbi.abs)} (${fmtPct(dEbi.pct)}) |\n`;
  } else {
    md += `| Line | Current | Margin |\n`;
    md += `|------|--------:|------:|\n`;
    md += `| **Revenue** | ${formatCurrency(current.revenue)} | — |\n`;
    md += `| − Cost of sales | ${formatCurrency(current.cogs)} | ${fmtMargin((current.cogs / current.revenue) * 100)} |\n`;
    md += `| **= Gross profit** | ${formatCurrency(current.grossProfit)} | ${fmtMargin(current.grossMargin)} |\n`;
    md += `| − Operating expenses | ${formatCurrency(current.opex)} | ${fmtMargin((current.opex / current.revenue) * 100)} |\n`;
    md += `| **= EBITDA** | ${current.ebitda < 0 ? '−' : ''}${formatCurrency(Math.abs(current.ebitda))} | ${fmtMargin(current.ebitdaMargin)} |\n`;
  }
  md += `\n`;

  // Headline interpretation.
  if (prior) {
    const ebitdaDelta = current.ebitda - prior.ebitda;
    const marginDelta = current.ebitdaMargin - prior.ebitdaMargin;
    if (ebitdaDelta > 0 && marginDelta >= 0) {
      md += `✅ **Improving** — EBITDA up ${fmtAbs(ebitdaDelta)} vs prior period and margin expanded ${marginDelta.toFixed(1)} pts.\n`;
    } else if (ebitdaDelta < 0 && marginDelta < 0) {
      md += `⚠️ **Worsening** — EBITDA down ${fmtAbs(ebitdaDelta)} and margin contracted ${Math.abs(marginDelta).toFixed(1)} pts. Largest contributors: revenue ${fmtAbs(current.revenue - prior.revenue)}, costs ${fmtAbs(current.totalCosts - prior.totalCosts)}.\n`;
    } else if (ebitdaDelta > 0 && marginDelta < 0) {
      md += `📈 **Growing but lower quality** — EBITDA up ${fmtAbs(ebitdaDelta)} but margin slipped ${Math.abs(marginDelta).toFixed(1)} pts (costs rose faster than revenue).\n`;
    } else {
      md += `📉 **Margin pressure** — EBITDA down but margin held / improved. Check whether revenue dropped.\n`;
    }
  }

  // NASDAL benchmark check.
  if (current.ebitdaMargin < 0) {
    md += `\n⚠️ EBITDA margin is **negative** for this period — costs exceed revenue.`;
  } else if (current.ebitdaMargin < 18) {
    md += `\nEBITDA margin (${current.ebitdaMargin.toFixed(1)}%) is below NASDAL median (18–22%).`;
  } else {
    md += `\n✅ EBITDA margin (${current.ebitdaMargin.toFixed(1)}%) is at or above NASDAL median (18–22%).`;
  }

  return {
    message: md,
    suggestions: [
      'How to improve EBITDA?',
      'Show cost breakdown',
      'Why did profit change?',
      'Compare providers by revenue',
    ],
    exportable: {
      kind: 'profit_and_loss',
      filename: `pnl_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: prior
        ? ['Line', 'Current', 'Margin %', 'Prior', 'Variance £', 'Variance %']
        : ['Line', 'Current', 'Margin %'],
      rows: prior ? [
        ['Revenue',             current.revenue.toFixed(2),     '',                                              prior.revenue.toFixed(2),     (current.revenue - prior.revenue).toFixed(2),     prior.revenue ? (((current.revenue - prior.revenue) / Math.abs(prior.revenue)) * 100).toFixed(1) : ''],
        ['Cost of sales',       current.cogs.toFixed(2),        ((current.cogs / current.revenue) * 100).toFixed(1), prior.cogs.toFixed(2),        (current.cogs - prior.cogs).toFixed(2),           prior.cogs ? (((current.cogs - prior.cogs) / Math.abs(prior.cogs)) * 100).toFixed(1) : ''],
        ['Gross profit',        current.grossProfit.toFixed(2), current.grossMargin.toFixed(1),                  prior.grossProfit.toFixed(2), (current.grossProfit - prior.grossProfit).toFixed(2), prior.grossProfit ? (((current.grossProfit - prior.grossProfit) / Math.abs(prior.grossProfit)) * 100).toFixed(1) : ''],
        ['Operating expenses',  current.opex.toFixed(2),        ((current.opex / current.revenue) * 100).toFixed(1), prior.opex.toFixed(2),        (current.opex - prior.opex).toFixed(2),           prior.opex ? (((current.opex - prior.opex) / Math.abs(prior.opex)) * 100).toFixed(1) : ''],
        ['EBITDA',              current.ebitda.toFixed(2),      current.ebitdaMargin.toFixed(1),                 prior.ebitda.toFixed(2),      (current.ebitda - prior.ebitda).toFixed(2),       prior.ebitda ? (((current.ebitda - prior.ebitda) / Math.abs(prior.ebitda)) * 100).toFixed(1) : ''],
      ] : [
        ['Revenue',            current.revenue.toFixed(2),     ''],
        ['Cost of sales',      current.cogs.toFixed(2),        ((current.cogs / current.revenue) * 100).toFixed(1)],
        ['Gross profit',       current.grossProfit.toFixed(2), current.grossMargin.toFixed(1)],
        ['Operating expenses', current.opex.toFixed(2),        ((current.opex / current.revenue) * 100).toFixed(1)],
        ['EBITDA',             current.ebitda.toFixed(2),      current.ebitdaMargin.toFixed(1)],
      ],
      title: `P&L — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Provider roster — Practitioner History page output as a chat answer.
function formatListProviders(intent, resolved) {
  const { rows, totals, period, locationName, providerType } = resolved;
  const scope = locationName ? `**${locationName}**` : '**All locations**';
  const periodLabel = fmtPeriod(period.from, period.to);
  const typeLabel = providerType ? `${providerType}s` : 'Providers';

  if (!rows || rows.length === 0) {
    return {
      message:
        `### ${typeLabel} — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No ${typeLabel.toLowerCase()} found for this period and location._`,
      suggestions: ['Show all providers', 'Try a wider period'],
    };
  }

  const MAX = 50;
  const visible = rows.slice(0, MAX);

  let md = `### ${typeLabel} — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Active:** ${rows.length}  ·  **Total revenue:** ${formatCurrency(totals.revenue)}\n\n`;
  md += `| # | Provider | Role | Revenue | Days | Avg/day | Appts | Compl. | Canc. | DNA | Patients |\n`;
  md += `|---|----------|------|--------:|-----:|--------:|------:|------:|------:|----:|---------:|\n`;
  for (const r of visible) {
    md += `| ${r.rank} | ${r.provider_name} | ${r.provider_role} | ${formatCurrency(r.revenue)} | ${r.days_worked.toFixed(1)} | ${formatCurrency(r.avg_daily_production)} | ${r.total_appointments} | ${r.completed} | ${r.cancelled} | ${r.dna} | ${r.unique_patients} |\n`;
  }
  if (rows.length > MAX) {
    md += `\n_Showing the first ${MAX} of ${rows.length} providers._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  // Highlight the top earner + any provider with elevated cancellation/DNA.
  const topRev = rows[0];
  if (topRev && topRev.revenue > 0) {
    md += `\n\n**Top earner:** ${topRev.provider_name} — ${formatCurrency(topRev.revenue)} (${formatCurrency(topRev.avg_daily_production)}/day across ${topRev.days_worked.toFixed(1)} days)`;
  }
  const highDna = rows.filter(r => r.total_appointments >= 10 && r.dna_rate >= 8).sort((a, b) => b.dna_rate - a.dna_rate)[0];
  if (highDna) {
    md += `\n\n⚠️ **DNA hotspot:** ${highDna.provider_name} — ${highDna.dna_rate.toFixed(1)}% DNA rate (${highDna.dna} of ${highDna.completed + highDna.cancelled + highDna.dna} appts). Industry benchmark is 5–6%.`;
  }
  const highCancel = rows.filter(r => r.total_appointments >= 10 && r.cancellation_rate >= 15 && (!highDna || r.provider_id !== highDna.provider_id)).sort((a, b) => b.cancellation_rate - a.cancellation_rate)[0];
  if (highCancel) {
    md += `\n\n⚠️ **High cancellations:** ${highCancel.provider_name} — ${highCancel.cancellation_rate.toFixed(1)}% cancellation rate.`;
  }

  return {
    message: md,
    suggestions: [
      'Compare the top two providers',
      topRev ? `Why is ${topRev.provider_name} the top earner?` : 'Top providers by revenue',
      'Show DNA rate by provider',
      'Show cancelled patients',
    ],
    exportable: {
      kind: 'providers',
      filename: `providers_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Rank', 'Provider', 'Role', 'Location', 'Revenue', 'Days worked', 'Avg/day', 'Appointments', 'Completed', 'Cancelled', 'DNA', 'Unique patients'],
      rows: rows.map(r => [r.rank, r.provider_name, r.provider_role, r.location_name, r.revenue.toFixed(2), r.days_worked.toFixed(2), r.avg_daily_production.toFixed(2), r.total_appointments, r.completed, r.cancelled, r.dna, r.unique_patients]),
      title: `${typeLabel} — ${locationName} — ${periodLabel}`,
    },
  };
}

// EBITDA + valuation snapshot. Mirrors the EBITDA Valuation page waterfall:
// Revenue → Gross Profit → EBITDA → Enterprise Value.
function formatEbitda(intent, resolved) {
  const { revenue, cogs, grossProfit, grossMargin, opex, totalCosts, ebitda, ebitdaMargin, multiple, enterpriseValue, costBuckets, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (revenue <= 0 && totalCosts <= 0) {
    return {
      message:
        `### EBITDA — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No revenue or cost activity in this period. Either no data was posted, or the integration hasn't synced._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  const ebitdaSign = ebitda >= 0 ? '' : '−';
  const ebitdaAbs = Math.abs(ebitda);

  let md = `### EBITDA & Valuation — ${scope}\n`;
  md += `**Period:** ${periodLabel}\n\n`;

  md += `| Line | Amount |\n`;
  md += `|------|-------:|\n`;
  md += `| **Revenue** | ${formatCurrency(revenue)} |\n`;
  md += `| − Cost of sales (lab + clinician + materials) | ${formatCurrency(cogs)} |\n`;
  md += `| **= Gross profit** (${grossMargin.toFixed(1)}% margin) | ${formatCurrency(grossProfit)} |\n`;
  md += `| − Operating expenses (staff + overhead + lease + admin) | ${formatCurrency(opex)} |\n`;
  md += `| **= EBITDA** (${ebitdaMargin.toFixed(1)}% margin) | ${ebitdaSign}${formatCurrency(ebitdaAbs)} |\n`;
  md += `| × Multiple (default ${multiple.toFixed(1)}×) |  |\n`;
  md += `| **= Enterprise value** | ${enterpriseValue >= 0 ? '' : '−'}${formatCurrency(Math.abs(enterpriseValue))} |\n\n`;

  const topCost = (costBuckets || []).filter(b => Math.abs(b.total) > 0.005).sort((a, b) => b.total - a.total)[0];
  if (topCost) {
    const pct = totalCosts > 0 ? ((topCost.total / totalCosts) * 100).toFixed(1) : '0.0';
    md += `**Biggest cost driver:** ${topCost.label} — ${formatCurrency(topCost.total)} (${pct}% of all costs)\n\n`;
  }

  if (ebitdaMargin < 0) {
    md += `⚠️ **EBITDA is negative** — costs exceed revenue this period. Open the **Cost Impact** page to see the bucket-level breakdown and the **Multiple Engine** page for a path back to a positive valuation.\n`;
  } else if (ebitdaMargin < 12) {
    md += `⚠️ **Low margin** (NASDAL median for UK dental is 18–22%). Highest-impact levers are usually staff costs (review headcount per FTE) and lab fees (consolidate suppliers).\n`;
  } else if (ebitdaMargin < 18) {
    md += `Margin is below NASDAL median (18–22%). Open the **EBITDA Valuation** page for the multiple-adjustment breakdown and quality score that drives valuation.\n`;
  } else {
    md += `✅ **Healthy margin** (${ebitdaMargin.toFixed(1)}% vs NASDAL median 18–22%).\n`;
  }

  const days = (new Date(period.to) - new Date(period.from)) / 86400000 + 1;
  if (days > 0 && days < 360) {
    const annualised = (ebitda / days) * 365;
    md += `\n_Period is ${Math.round(days)} days. Annualised at this run-rate: **${annualised >= 0 ? '' : '−'}${formatCurrency(Math.abs(annualised))} EBITDA**._\n`;
  }

  return {
    message: md,
    suggestions: [
      'How to improve EBITDA?',
      'Show cost breakdown',
      'Compare EBITDA with last month',
      'Show revenue trend',
    ],
    exportable: {
      kind: 'ebitda',
      filename: `ebitda_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Line', 'Amount'],
      rows: [
        ['Revenue', revenue.toFixed(2)],
        ['Cost of sales', cogs.toFixed(2)],
        ['Gross profit', grossProfit.toFixed(2)],
        ['Operating expenses', opex.toFixed(2)],
        ['EBITDA', ebitda.toFixed(2)],
        [`Multiple (×${multiple.toFixed(1)})`, ''],
        ['Enterprise value', enterpriseValue.toFixed(2)],
      ],
      title: `EBITDA — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

function formatListCostTransactions(intent, resolved) {
  const { transactions, total, category, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!transactions || transactions.length === 0) {
    return {
      message:
        `### ${category} transactions — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No ${category.toLowerCase()} transactions in this period._`,
      suggestions: ['Try a wider period', 'Show all costs instead'],
    };
  }

  const MAX = 50;
  const visible = transactions.slice(0, MAX);

  let md = `### ${category} transactions — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Transactions:** ${transactions.length}  ·  **Total:** ${formatCurrency(total)}\n\n`;
  md += `| Date | Supplier | Account | Amount |\n`;
  md += `|------|----------|---------|-------:|\n`;
  for (const t of visible) {
    const supplier = (t.supplier || '—').replace(/\|/g, '/'); // pipe breaks markdown tables
    const acct = (t.account_name || t.account_code || '').replace(/\|/g, '/');
    md += `| ${fmtUkDate(t.date)} | ${supplier} | ${acct} | ${formatCurrency(t.amount)} |\n`;
  }
  if (transactions.length > MAX) {
    md += `\n_Showing the first ${MAX} of ${transactions.length} transactions._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  // Top suppliers summary — usually the most actionable insight ("which lab
  // are we spending the most with?").
  const bySupplier = new Map();
  for (const t of transactions) {
    const k = (t.supplier || '—').trim();
    bySupplier.set(k, (bySupplier.get(k) || 0) + t.amount);
  }
  const topSuppliers = [...bySupplier.entries()]
    .filter(([s]) => s && s !== '—')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topSuppliers.length > 1) {
    md += `\n\n**Top suppliers**\n`;
    for (const [s, amt] of topSuppliers) {
      const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0';
      md += `- ${s} — **${formatCurrency(amt)}** (${pct}%)\n`;
    }
  }

  return {
    message: md,
    suggestions: [
      `${category} by date`,
      `${category} by month`,
      'Show all costs breakdown',
      `Compare ${category.toLowerCase()} with last month`,
    ],
    exportable: {
      kind: 'cost_transactions',
      filename: `${category.toLowerCase().replace(/\s+/g, '_')}_transactions_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Date', 'Supplier', 'Account code', 'Account', 'Amount'],
      rows: transactions.map(t => [fmtUkDate(t.date), t.supplier || '', t.account_code || '', t.account_name || '', t.amount.toFixed(2)]),
      title: `${category} transactions — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Time-series cost-entries formatter. Renders one row per day/week/month for
// a single cost category (e.g. "date wise lab fees cost details").
function formatListCostEntries(intent, resolved) {
  const { rows, total, category, groupBy, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);
  const periodLabelHuman = ({ day: 'date', week: 'week', month: 'month' })[groupBy] || 'date';

  if (!rows || rows.length === 0) {
    return {
      message:
        `### ${category} by ${periodLabelHuman} — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No ${category.toLowerCase()} transactions in this period._`,
      suggestions: ['Try a wider period', 'Show all costs instead'],
    };
  }

  const fmtRowDate = (k) => {
    if (groupBy === 'month') {
      const [y, m] = k.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: UK_TZ });
    }
    return fmtUkDate(k);
  };

  const MAX = 50;
  const visible = rows.slice(0, MAX);

  let md = `### ${category} by ${periodLabelHuman} — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Total:** ${formatCurrency(total)}\n\n`;
  md += `| ${periodLabelHuman[0].toUpperCase() + periodLabelHuman.slice(1)} | Amount |\n`;
  md += `|---|-------:|\n`;
  for (const r of visible) {
    md += `| ${fmtRowDate(r.date)} | ${formatCurrency(r.amount)} |\n`;
  }
  if (rows.length > MAX) {
    md += `\n_Showing the first ${MAX} of ${rows.length} ${periodLabelHuman}s._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  // Inline line chart for visual scan of the trend.
  const chartData = rows.map(r => ({ date: fmtRowDate(r.date), amount: Number(r.amount.toFixed(2)) }));

  return {
    message: md,
    suggestions: [
      `Compare ${category.toLowerCase()} with last month`,
      `${category} by provider`,
      'Show all costs breakdown',
      `${category} by month`,
    ],
    chart: {
      type: 'line',
      title: `${category} by ${periodLabelHuman}`,
      data: chartData,
      xKey: 'date',
      yKey: 'amount',
      yLabel: 'Amount (£)',
    },
    exportable: {
      kind: 'cost_entries',
      filename: `${category.toLowerCase().replace(/\s+/g, '_')}_by_${groupBy}_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: [periodLabelHuman[0].toUpperCase() + periodLabelHuman.slice(1), 'Amount'],
      rows: rows.map(r => [fmtRowDate(r.date), r.amount.toFixed(2)]),
      title: `${category} by ${periodLabelHuman} — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Cost-breakdown formatter. Renders a category-by-category table for the
// period, calls out the biggest driver, and emits exportable CSV/PDF data.
function formatCostBreakdown(intent, resolved) {
  const { buckets, grandTotal, locationName, period, unmapped } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  // When the user asked for a SPECIFIC cost category, the resolver returned
  // only that bucket. Use its label in the header so the title reflects the
  // question (e.g. "Material costs — South Street") instead of the generic
  // "Cost breakdown" header that suggests a multi-category answer.
  const isSingleCategory = Array.isArray(buckets) && buckets.length === 1;
  const headerLabel = isSingleCategory ? buckets[0].label : 'Cost breakdown';

  if (!buckets || buckets.length === 0 || Math.abs(grandTotal) < 0.01) {
    return {
      message:
        `### ${headerLabel} — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No costs recorded for this location and period in the linked accounting integration._`,
      suggestions: ['Show revenue instead', 'Try a wider period'],
    };
  }

  const pct = (v) => grandTotal > 0 ? ((v / grandTotal) * 100).toFixed(1) + '%' : '—';

  let md = `### ${headerLabel} — ${scope}\n`;
  if (unmapped) {
    md += `_Grouped by the integration's own expense categories — your Profit/Loss buckets aren't mapped yet. Go to **Location Settings → Profit/Loss accounts** to get the curated Staff costs / Lab fees / Materials / Overheads view._\n\n`;
  }
  md += `**Period:** ${periodLabel}  ·  **Total costs:** ${formatCurrency(grandTotal)}\n\n`;
  md += `| Category | Amount | % of total |\n`;
  md += `|----------|-------:|-----------:|\n`;
  for (const b of buckets) {
    md += `| ${b.label} | ${formatCurrency(b.total)} | ${pct(b.total)} |\n`;
  }

  // Drill the top driver: show its 3 biggest underlying accounts so the user
  // sees WHERE the spend is, not just the bucket totals.
  const top = buckets[0];
  if (top && top.accounts && top.accounts.length > 0) {
    md += `\n**Biggest driver: ${top.label}** (${pct(top.total)} of all costs)\n`;
    const topAccounts = top.accounts.slice(0, 5);
    md += topAccounts.map(a => `- ${a.name} (${a.code}) — **${formatCurrency(a.amount)}**`).join('\n');
    md += '\n';
  }

  // Lightweight cost-reduction guidance keyed off the largest bucket. Kept
  // generic so it never invents practice-specific numbers — the user can
  // drill into the matching page for real action.
  const tips = {
    'Staff costs':
      `**To reduce staff costs:** review headcount vs production per FTE, audit overtime patterns, and benchmark hourly rates against the NASDAL median. Open the Staff Costs page to drill in.`,
    'Clinician costs':
      `**To reduce clinician costs:** check associate split rates, lab-fee recovery, and UDA hand-back risk on NHS contracts. Open the Clinician Costs page.`,
    'Lab fees':
      `**To reduce lab fees:** consolidate to fewer labs for volume discounts, audit turnaround vs price by item, and check whether lab fees on private treatment are being recovered in the fee schedule. Open the Lab Fees page.`,
    'Material costs':
      `**To reduce material costs:** group-purchasing agreements, generic substitutes where clinically equivalent, and reorder-point automation typically cut 5–10%. Open the Material Costs page.`,
    'Operating leases':
      `**To reduce operating leases:** renegotiate near renewal dates, audit underused equipment, and benchmark monthly cost against revenue (NASDAL median ~8% of revenue). Open the Operating Leases page.`,
    'Overheads':
      `**To reduce overheads:** review utility tariffs, software seat counts (often 20–30% over-provisioned), and marketing spend by channel ROI. Open the Overhead Costs page.`,
    'Administrative costs':
      `**To reduce administrative costs:** consolidate subscriptions, review professional-services retainers, and check duplicate accounts payable rules.`,
    'Cost of sales':
      `**To reduce cost of sales:** the biggest levers here are usually lab fees and material usage per treatment. Open the Cost Impact page for a procedure-level view.`,
  };
  if (top && tips[top.label]) {
    md += `\n${tips[top.label]}`;
  }

  md += `\n[[EXPORT_LINKS]]`;

  // Topic-aware follow-up suggestions. Pulled from the actual buckets in
  // this response so the chips always reflect the real biggest drivers, not
  // a fixed list.
  const topLabel = top?.label;
  const secondLabel = buckets[1]?.label;
  const suggestions = [];
  if (topLabel) suggestions.push(`How to reduce ${topLabel.toLowerCase()}?`);
  if (topLabel) suggestions.push(`${topLabel} by provider`);
  if (secondLabel) suggestions.push(`${secondLabel} breakdown`);
  suggestions.push('Compare costs with last month');
  suggestions.push('Cost as % of revenue');

  return {
    message: md,
    suggestions: suggestions.slice(0, 4),
    exportable: {
      kind: 'cost_breakdown',
      filename: `cost_breakdown_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Category', 'Amount', '% of total'],
      rows: buckets.map(b => [b.label, b.total.toFixed(2), pct(b.total)]),
      title: `Cost breakdown — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Generic appointment-list formatter. `resolved.state` tells us which header
// + columns to render (dna shows "Marked DNA on", cancelled shows "Cancelled
// on", scheduled/completed show just the appointment time + booked-on).
function formatAppointmentsList(intent, resolved) {
  const { count, rows, period, locationName, state } = resolved;
  const stateLabel = ({
    dna: 'DNA',
    cancelled: 'Cancelled',
    completed: 'Completed',
    scheduled: 'Scheduled',
    any: 'Appointments',
  })[state] || 'Appointments';
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!count || !Array.isArray(rows) || rows.length === 0) {
    return {
      message:
        `### ${stateLabel === 'Appointments' ? 'Appointments' : `${stateLabel} Appointments`} — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No ${stateLabel === 'Appointments' ? 'appointments' : stateLabel.toLowerCase() + ' appointments'} found for this location and period._`,
      suggestions: ['Try a wider period', 'Compare locations', 'Show whole practice'],
    };
  }

  const MAX = 50;
  const visible = rows.slice(0, MAX);

  let md = `### ${stateLabel === 'Appointments' ? 'Appointments' : `${stateLabel} Appointments`} — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Total:** ${count}\n\n`;

  if (state === 'dna') {
    md += `| # | Patient | Practitioner | Appointment | Booked on |\n`;
    md += `|---|---------|--------------|-------------|-----------|\n`;
    visible.forEach((r, i) => {
      md += `| ${i + 1} | ${r.patient_name} | ${r.practitioner_name} | ${fmtUkDateTime(r.appointment_start)} | ${fmtUkDate(r.booked_at)} |\n`;
    });
  } else if (state === 'cancelled') {
    md += `| # | Patient | Practitioner | Appointment | Booked on | Cancelled on |\n`;
    md += `|---|---------|--------------|-------------|-----------|--------------|\n`;
    visible.forEach((r, i) => {
      md += `| ${i + 1} | ${r.patient_name} | ${r.practitioner_name} | ${fmtUkDateTime(r.appointment_start)} | ${fmtUkDate(r.booked_at)} | ${fmtUkDate(r.cancelled_at)} |\n`;
    });
  } else {
    md += `| # | Patient | Practitioner | Appointment | Booked on |\n`;
    md += `|---|---------|--------------|-------------|-----------|\n`;
    visible.forEach((r, i) => {
      md += `| ${i + 1} | ${r.patient_name} | ${r.practitioner_name} | ${fmtUkDateTime(r.appointment_start)} | ${fmtUkDate(r.booked_at)} |\n`;
    });
  }

  if (count > MAX) {
    md += `\n_Showing the first ${MAX} of ${count}._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  // Topic-aware suggestions for the generic appointments list — adjust the
  // chips based on the current state filter.
  const stateChips = {
    dna:       ['DNA rate by provider', 'DNA patients last month', 'Show cancelled appointments'],
    cancelled: ['Cancellation rate by provider', 'Cancelled appointments last month', 'Show DNA appointments'],
    completed: ['Production by provider', 'Completed appointments last month', 'Show today\'s appointments'],
    scheduled: ['Show today\'s appointments', 'Booked appointments next week', 'Show cancellations'],
    any:       ['DNA appointments', 'Cancelled appointments', 'Show today\'s appointments'],
  };
  return {
    message: md,
    suggestions: stateChips[state] || stateChips.any,
    // The chatbot route handler replaces [[EXPORT_LINKS]] with real URLs after
    // registering this exportable in the in-memory cache.
    exportable: {
      kind: 'appointments',
      filename: `${stateLabel.toLowerCase()}_appointments_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: state === 'cancelled'
        ? ['#', 'Patient', 'Practitioner', 'Appointment', 'Booked on', 'Cancelled on']
        : (state === 'dna'
            ? ['#', 'Patient', 'Practitioner', 'Appointment', 'Booked on', 'Marked DNA on']
            : ['#', 'Patient', 'Practitioner', 'Appointment', 'Booked on']),
      rows: rows.map((r, i) => {
        const base = [i + 1, r.patient_name, r.practitioner_name, fmtUkDateTime(r.appointment_start), fmtUkDate(r.booked_at)];
        if (state === 'cancelled') base.push(fmtUkDate(r.cancelled_at));
        if (state === 'dna') base.push(fmtUkDate(r.marked_dna_at));
        return base;
      }),
      title: `${stateLabel === 'Appointments' ? 'Appointments' : `${stateLabel} Appointments`} — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

function formatCancelledPatientList(intent, resolved) {
  const { count, rows, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!count || !Array.isArray(rows) || rows.length === 0) {
    return {
      message:
        `### Cancelled Appointment Patients — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No cancelled appointments found for this location and period._`,
      suggestions: ['Try a wider period', 'Compare locations', 'Show DNA patients'],
    };
  }

  const MAX = 50;
  const visible = rows.slice(0, MAX);

  let md = `### Cancelled Appointment Patients — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Cancellations:** ${count}\n\n`;
  md += `| # | Patient | Practitioner | Appointment | Booked on | Cancelled on |\n`;
  md += `|---|---------|--------------|-------------|-----------|--------------|\n`;
  visible.forEach((r, i) => {
    md += `| ${i + 1} | ${r.patient_name} | ${r.practitioner_name} | ${fmtUkDateTime(r.appointment_start)} | ${fmtUkDate(r.booked_at)} | ${fmtUkDate(r.cancelled_at)} |\n`;
  });
  if (count > MAX) {
    md += `\n_Showing the first ${MAX} of ${count} cancellations._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  return {
    message: md,
    suggestions: [
      'Cancellation rate by provider',
      'Cancelled patients last month',
      'Compare with DNA appointments',
      'When are most cancellations booked?',
    ],
    exportable: {
      kind: 'appointments',
      filename: `cancelled_appointments_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['#', 'Patient', 'Practitioner', 'Appointment', 'Booked on', 'Cancelled on'],
      rows: rows.map((r, i) => [
        i + 1, r.patient_name, r.practitioner_name,
        fmtUkDateTime(r.appointment_start), fmtUkDate(r.booked_at), fmtUkDate(r.cancelled_at),
      ]),
      title: `Cancelled Appointment Patients — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

function formatDNAPatientList(intent, resolved) {
  const { count, rows, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!count || !Array.isArray(rows) || rows.length === 0) {
    return {
      message:
        `### DNA Patient List — ${scope}\n**Period:** ${periodLabel}\n\n` +
        `_No DNA appointments found for this location and period._\n\n` +
        `If the page's DNA count is non-zero, the appointments may be attached to providers not currently linked to this location, or the period filter may need widening.`,
      suggestions: ['Try a wider period', 'Compare locations', 'Show DNA rate'],
    };
  }

  // Cap visible rows; remaining count is mentioned in a footer line so the
  // chat doesn't try to render 500 rows.
  const MAX = 50;
  const visible = rows.slice(0, MAX);

  let md = `### DNA Patient List — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **DNAs:** ${count}\n\n`;
  md += `| # | Patient | Practitioner | Appointment | Booked on |\n`;
  md += `|---|---------|--------------|-------------|-----------|\n`;
  visible.forEach((r, i) => {
    md += `| ${i + 1} | ${r.patient_name} | ${r.practitioner_name} | ${fmtUkDateTime(r.appointment_start)} | ${fmtUkDate(r.booked_at)} |\n`;
  });
  if (count > MAX) {
    md += `\n_Showing the first ${MAX} of ${count} DNAs._  [[EXPORT_LINKS]]`;
  } else {
    md += `\n[[EXPORT_LINKS]]`;
  }

  return {
    message: md,
    suggestions: [
      'DNA rate by provider',
      'DNA patients last month',
      'Compare with cancelled appointments',
      'When are most DNAs booked?',
    ],
    exportable: {
      kind: 'appointments',
      filename: `dna_patients_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['#', 'Patient', 'Practitioner', 'Appointment', 'Booked on', 'Marked DNA on'],
      rows: rows.map((r, i) => [
        i + 1, r.patient_name, r.practitioner_name,
        fmtUkDateTime(r.appointment_start), fmtUkDate(r.booked_at), fmtUkDate(r.marked_dna_at),
      ]),
      title: `DNA Patient List — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Plan Mix — deterministic table (numbers from resolvePlanMix, never the
// LLM, so it reconciles with the Treatment Insights Plan Mix card exactly).
function formatPlanMix(intent, resolved) {
  const { data, total, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!Array.isArray(data) || data.length === 0) {
    return {
      message: `### Plan Mix — ${scope}\n**Period:** ${periodLabel}\n\n_No payment-plan revenue in this period._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  let md = `### Plan Mix — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Total:** ${formatCurrency(total)}\n\n`;
  md += `| Plan | Revenue | Share | Items |\n`;
  md += `|------|--------:|------:|------:|\n`;
  for (const d of data) {
    md += `| ${d.plan} | ${formatCurrency(d.revenue)} | ${(Number(d.sharePercent) || 0).toFixed(2)}% | ${d.count ?? ''} |\n`;
  }
  const top = data[0];
  md += `\n**${top.plan}** is the largest plan — ${(Number(top.sharePercent) || 0).toFixed(2)}% of revenue (${formatCurrency(top.revenue)}).`;

  return {
    message: md,
    suggestions: [
      'Break plan mix down by location',
      'How do I grow the membership plan share?',
      'Show revenue instead',
      'Compare with last month',
    ],
    exportable: {
      kind: 'plan_mix',
      filename: `plan_mix_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Plan', 'Revenue', 'Share %', 'Items'],
      rows: data.map(d => [d.plan, Number(d.revenue).toFixed(2), Number(d.sharePercent).toFixed(2), d.count]),
      title: `Plan Mix — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// NHS Contract Performance — deterministic (numbers from
// resolveNhsPerformance; reconciles with the NHS Contract Performance page).
function formatNhsPerformance(intent, resolved) {
  const { totals: t, providers, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!t || (t.feeExpected <= 0 && t.udaDelivered <= 0)) {
    return {
      message: `### NHS Contract Performance — ${scope}\n**Period:** ${periodLabel}\n\n_No completed NHS claims in this period._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  let md = `### NHS Contract Performance — ${scope}\n`;
  md += `**Period:** ${periodLabel}\n\n`;
  md += `| Metric | Value |\n|------|--------:|\n`;
  md += `| UDA delivered / target | ${Number(t.udaDelivered).toLocaleString('en-GB')} / ${Number(t.udaTarget).toLocaleString('en-GB')} (${t.udaDeliveryPct}%) |\n`;
  md += `| Fee expected | ${formatCurrency(t.feeExpected)} |\n`;
  md += `| Fee awarded | ${formatCurrency(t.feeAwarded)} (${t.feeDeliveryPct}% delivery) |\n`;
  md += `| Patient charges | ${formatCurrency(t.patientCharge)} |\n`;
  md += `| YTD revenue (fee + patient) | ${formatCurrency(t.ytdRevenue)} |\n`;
  md += `| Completed claims · avg/claim | ${Number(t.claimCount).toLocaleString('en-GB')} · ${formatCurrency(t.avgRatePerClaim)} |\n\n`;

  const top = (providers || []).slice(0, 10);
  if (top.length > 0) {
    md += `**By provider** (top ${top.length} by fee expected)\n\n`;
    md += `| Provider | Role | Fee expected | Fee awarded | Claims | Delivery |\n`;
    md += `|------|------|--------:|--------:|----:|----:|\n`;
    for (const p of top) {
      md += `| ${p.name} | ${p.role} | ${formatCurrency(p.feeExpected)} | ${formatCurrency(p.feeAwarded)} | ${p.claims} | ${Math.round(Number(p.deliveryPct) || 0)}% |\n`;
    }
  }

  return {
    message: md,
    suggestions: [
      'NHS performance by provider',
      'Show revenue instead',
      'UDA delivery vs target',
      'Compare with last quarter',
    ],
    exportable: {
      kind: 'nhs_performance',
      filename: `nhs_performance_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Provider', 'Role', 'Fee expected', 'Fee awarded', 'Claims', 'Delivery %'],
      rows: (providers || []).map(p => [p.name, p.role, Number(p.feeExpected).toFixed(2), Number(p.feeAwarded).toFixed(2), p.claims, Math.round(Number(p.deliveryPct) || 0)]),
      title: `NHS Contract Performance — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Membership Performance — deterministic (members + revenue per plan, from
// resolveMembershipPerformance; reconciles with the Membership page inputs).
// Cost/profit/margin are intentionally NOT shown — the page recalculates
// those with a complex treatment-cost stack; a chatbot copy would drift.
function formatMembershipPerformance(intent, resolved) {
  const { plans, totals, period, locationName } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!Array.isArray(plans) || plans.length === 0) {
    return {
      message: `### Membership Performance — ${scope}\n**Period:** ${periodLabel}\n\n_No membership-plan activity in this period._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  let md = `### Membership Performance — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Members:** ${Number(totals.totalMembers).toLocaleString('en-GB')}  ·  **Membership revenue:** ${formatCurrency(totals.membershipRevenue)}\n\n`;
  md += `| Plan | Members | Monthly fee | Revenue |\n`;
  md += `|------|----:|--------:|--------:|\n`;
  for (const p of plans) {
    md += `| ${p.plan} | ${Number(p.members).toLocaleString('en-GB')} | ${formatCurrency(p.monthlyFee)} | ${formatCurrency(p.revenue)} |\n`;
  }
  md += `\n_Cost, profit and margin per plan are on the **Membership Performance** page — ask there for the full P&L view._`;

  return {
    message: md,
    suggestions: [
      'Plan mix by revenue',
      'Show revenue instead',
      'Members by plan',
      'Compare with last month',
    ],
    exportable: {
      kind: 'membership_performance',
      filename: `membership_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Plan', 'Members', 'Monthly fee', 'Revenue'],
      rows: plans.map(p => [p.plan, p.members, Number(p.monthlyFee).toFixed(2), Number(p.revenue).toFixed(2)]),
      title: `Membership Performance — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

// Treatment Profit Goals — deterministic (actual vs target per treatment,
// from resolveProfitGoals; reconciles with the Profit Goals page).
function formatProfitGoals(intent, resolved) {
  const { rows, totals, period, locationName, targetsAvailable } = resolved;
  const scope = locationName ? `**${locationName}**` : '**Selected location**';
  const periodLabel = fmtPeriod(period.from, period.to);

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      message: `### Treatment Profit Goals — ${scope}\n**Period:** ${periodLabel}\n\n_No treatment activity or targets in this period._`,
      suggestions: ['Try a wider period', 'Show revenue instead'],
    };
  }

  let md = `### Treatment Profit Goals — ${scope}\n`;
  md += `**Period:** ${periodLabel}  ·  **Units:** ${Number(totals.unitActual).toLocaleString('en-GB')} actual`;
  if (totals.unitTarget > 0) md += ` / ${Number(totals.unitTarget).toLocaleString('en-GB')} target`;
  md += `  ·  **Avg £:** ${formatCurrency(totals.avgActual)} actual`;
  if (totals.avgTarget > 0) md += ` / ${formatCurrency(totals.avgTarget)} target`;
  md += `\n\n`;
  if (!targetsAvailable) {
    md += `_No saved goal targets for this exact period (targets are set per calendar month / quarter / year) — showing actuals only._\n\n`;
  }

  const withTarget = rows.filter(r => r.unitTarget > 0 || r.avgTarget > 0);
  const ranked = (withTarget.length > 0 ? withTarget : rows).slice();
  const lagging = ranked.slice().sort((a, b) => a.progressPct - b.progressPct).slice(0, 10);
  const top = rows.slice(0, 15);

  md += `| Treatment | Units (A/T) | Avg £ (A/T) | Progress |\n`;
  md += `|------|------:|------:|----:|\n`;
  for (const r of top) {
    const uT = r.unitTarget > 0 ? `/${Number(r.unitTarget).toLocaleString('en-GB')}` : '';
    const aT = r.avgTarget > 0 ? `/${formatCurrency(r.avgTarget)}` : '';
    md += `| ${r.name} | ${Number(r.unitActual).toLocaleString('en-GB')}${uT} | ${formatCurrency(r.avgActual)}${aT} | ${Math.round(Number(r.progressPct) || 0)}% |\n`;
  }
  if (rows.length > top.length) md += `\n_…and ${rows.length - top.length} more treatment(s)._`;
  if (targetsAvailable && lagging.length > 0 && (lagging[0].unitTarget > 0 || lagging[0].avgTarget > 0)) {
    md += `\n\n**Furthest from goal:** ` + lagging.slice(0, 3).map(r => `${r.name} (${Math.round(Number(r.progressPct) || 0)}%)`).join(', ') + '.';
  }

  return {
    message: md,
    suggestions: [
      'Which treatments are furthest from goal?',
      'Treatment revenue by treatment',
      'Show revenue instead',
      'Compare with last month',
    ],
    exportable: {
      kind: 'profit_goals',
      filename: `profit_goals_${period.from}_${period.to}`.replace(/[^a-z0-9_-]/gi, '_'),
      headers: ['Treatment', 'Units actual', 'Units target', 'Avg actual', 'Avg target', 'Progress %'],
      rows: rows.map(r => [r.name, r.unitActual, r.unitTarget, Number(r.avgActual).toFixed(2), Number(r.avgTarget).toFixed(2), Math.round(Number(r.progressPct) || 0)]),
      title: `Treatment Profit Goals — ${locationName || 'Selected location'} — ${periodLabel}`,
    },
  };
}

const FORMATTERS = {
  get_financial_metric: formatFinancialMetric,
  get_plan_mix: formatPlanMix,
  get_nhs_performance: formatNhsPerformance,
  get_membership_performance: formatMembershipPerformance,
  get_profit_goals: formatProfitGoals,
  get_cashflow_data: formatCashflow,
  get_chair_metrics: formatChairMetrics,
  get_treatment_revenue: formatTreatmentRevenue,
  get_revenue_breakdown_report: formatRevenueBreakdown,
  get_location_metrics: formatLocationMetrics,
  // Phase 2
  compare_doctors: formatCompareDoctors,
  compare_multiple_doctors: formatCompareMultipleDoctors,
  compare_periods: formatComparePeriods,
  multi_period_report: formatMultiPeriodReport,
  year_over_year_report: formatComparePeriods,
  // Phase 3
  drill_down_metric: formatDrillDown,
  explain_why: formatExplainWhy,
  forecast_metric: formatForecast,
  what_if_scenario: formatWhatIf,
  // New: page-aware fallbacks
  get_recommendations: formatRecommendations,
  get_attendance_metric: formatAttendanceMetric,
  list_dna_patients: formatDNAPatientList,
  list_cancelled_patients: formatCancelledPatientList,
  list_appointments: formatAppointmentsList,
  get_cost_breakdown: formatCostBreakdown,
  list_cost_entries: formatListCostEntries,
  list_cost_transactions: formatListCostTransactions,
  get_ebitda: formatEbitda,
  list_providers: formatListProviders,
  get_profit_and_loss: formatProfitAndLoss,
  // Reports (pre-formatted in resolver, just pass through)
  generate_report: (intent, resolved) => ({
    message: resolved.markdown,
    suggestions: resolved.suggestions || ['Show revenue', 'Show profit'],
  }),
  email_report: (intent, resolved) => ({
    message: resolved.markdown,
    suggestions: resolved.suggestions || ['Show revenue'],
  }),
};

module.exports = { format };
