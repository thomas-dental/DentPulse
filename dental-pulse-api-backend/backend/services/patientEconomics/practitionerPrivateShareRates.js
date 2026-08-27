/**
 * Practitioner private-share rate history (append-only).
 * practice_id = organizations.id; practitioner_id = providers.id.
 */

const { supabaseAdmin } = require('../../config/supabase');

const SORT_FIELDS = new Set(['name', 'private_share', 'role']);

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function dayBefore(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isValidDateStr(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseRate(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function providerDedupeKey(p) {
  return `${normalizeName(p.name)}|${String(p.provider_role || '').trim().toLowerCase()}`;
}

/**
 * Prefer Dentally-synced (external_id), then active, then newest updated_at.
 * Same display name can appear twice when providers has a manual row (null external_id)
 * plus a Dentally sync row — UNIQUE(organization_id, external_id) allows multiple nulls.
 */
function preferProvider(a, b) {
  const aExt = a.external_id != null ? 1 : 0;
  const bExt = b.external_id != null ? 1 : 0;
  if (aExt !== bExt) return aExt > bExt ? a : b;

  const aActive = a.is_active !== false ? 1 : 0;
  const bActive = b.is_active !== false ? 1 : 0;
  if (aActive !== bActive) return aActive > bActive ? a : b;

  const aUpdated = a.updated_at ? Date.parse(a.updated_at) : 0;
  const bUpdated = b.updated_at ? Date.parse(b.updated_at) : 0;
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? a : b;

  return String(a.id).localeCompare(String(b.id)) <= 0 ? a : b;
}

function dedupeProvidersByNameRole(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = providerDedupeKey(row);
    const existing = best.get(key);
    best.set(key, existing ? preferProvider(existing, row) : row);
  }
  return [...best.values()];
}

/**
 * Build history entries with inclusive effective_from and effective_to (null = ongoing).
 */
function buildRateHistory(rows, asOfDate) {
  const sorted = [...rows].sort((a, b) =>
    String(a.effective_from).localeCompare(String(b.effective_from))
  );

  const currentRow =
    [...sorted].reverse().find((r) => String(r.effective_from) <= asOfDate) || null;

  return sorted
    .slice()
    .reverse()
    .map((row, idx, desc) => {
      const newer = desc[idx - 1];
      const effectiveTo = newer ? dayBefore(newer.effective_from) : null;
      return {
        id: row.id,
        rate: Number(row.rate),
        effectiveFrom: row.effective_from,
        effectiveTo,
        createdAt: row.created_at,
        isCurrent: currentRow ? row.id === currentRow.id : false,
      };
    });
}

function attachRates(providerRows, ratesByProvider, asOf) {
  return providerRows.map((p) => {
    const history = buildRateHistory(ratesByProvider.get(p.id) || [], asOf);
    const current = history.find((h) => h.isCurrent) || null;
    return {
      id: p.id,
      name: p.name,
      providerRole: p.provider_role || null,
      isActive: p.is_active !== false,
      externalId: p.external_id != null ? String(p.external_id) : null,
      rateConfigured: current != null,
      currentRate: current ? current.rate : null,
      currentEffectiveFrom: current ? current.effectiveFrom : null,
      history,
    };
  });
}

function sortPractitioners(list, sortBy, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1;
  const field = SORT_FIELDS.has(sortBy) ? sortBy : 'name';

  return [...list].sort((a, b) => {
    let cmp = 0;
    if (field === 'private_share') {
      const aRate = a.rateConfigured && a.currentRate != null ? a.currentRate : -1;
      const bRate = b.rateConfigured && b.currentRate != null ? b.currentRate : -1;
      cmp = aRate - bRate;
    } else if (field === 'role') {
      cmp = String(a.providerRole || '').localeCompare(String(b.providerRole || ''), undefined, {
        sensitivity: 'base',
      });
    } else {
      cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    }
    if (cmp === 0) {
      cmp = String(a.id).localeCompare(String(b.id));
    }
    return cmp * dir;
  });
}

async function listPractitionerRates(practiceId, options = {}) {
  const asOf = todayUtc();
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(options.pageSize) || 10));
  const search = String(options.search || '').trim();
  const sortBy = SORT_FIELDS.has(options.sortBy) ? options.sortBy : 'name';
  const sortDir = options.sortDir === 'desc' ? 'desc' : 'asc';

  const { data: providers, error: provErr } = await supabaseAdmin
    .from('providers')
    .select('id, name, provider_role, is_active, external_id, updated_at')
    .eq('organization_id', practiceId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (provErr) {
    throw new Error(`Failed to load practitioners: ${provErr.message}`);
  }

  // Active clinicians only — inactive copies of the same person often inflate duplicates.
  const activeRows = (providers || []).filter((p) => p.is_active !== false);
  const deduped = dedupeProvidersByNameRole(activeRows);

  const providerIds = deduped.map((p) => p.id);
  let rateRows = [];
  if (providerIds.length > 0) {
    const { data: rates, error: rateErr } = await supabaseAdmin
      .from('practitioner_private_share_rates')
      .select('id, practitioner_id, rate, effective_from, created_at')
      .eq('practice_id', practiceId)
      .in('practitioner_id', providerIds)
      .order('effective_from', { ascending: true });

    if (rateErr) {
      if (rateErr.code === '42P01') {
        throw Object.assign(new Error('practitioner_private_share_rates table not migrated yet'), {
          code: 'TABLE_NOT_FOUND',
        });
      }
      throw new Error(`Failed to load rates: ${rateErr.message}`);
    }
    rateRows = rates || [];
  }

  const ratesByProvider = new Map();
  for (const row of rateRows) {
    const list = ratesByProvider.get(row.practitioner_id) || [];
    list.push(row);
    ratesByProvider.set(row.practitioner_id, list);
  }

  let practitioners = attachRates(deduped, ratesByProvider, asOf);

  if (search) {
    const q = search.toLowerCase();
    practitioners = practitioners.filter((p) => {
      const role = (p.providerRole || '').replace(/_/g, ' ').toLowerCase();
      return p.name.toLowerCase().includes(q) || role.includes(q);
    });
  }

  practitioners = sortPractitioners(practitioners, sortBy, sortDir);

  const configuredCount = practitioners.filter((p) => p.rateConfigured).length;
  const totalCount = practitioners.length;
  const notConfiguredCount = totalCount - configuredCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = practitioners.slice(offset, offset + pageSize);

  return {
    practitioners: pageRows,
    summary: {
      totalPractitioners: totalCount,
      configuredCount,
      notConfiguredCount,
      hasMissingRate: notConfiguredCount > 0,
    },
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalCount,
    },
  };
}

async function insertPractitionerRate({ practiceId, practitionerId, rate, effectiveFrom, createdBy }) {
  const parsedRate = parseRate(rate);
  if (parsedRate == null) {
    throw Object.assign(new Error('rate must be a number between 0 and 100'), { status: 400 });
  }
  if (!isValidDateStr(effectiveFrom)) {
    throw Object.assign(new Error('effectiveFrom must be YYYY-MM-DD'), { status: 400 });
  }

  const { data: provider, error: provErr } = await supabaseAdmin
    .from('providers')
    .select('id, organization_id, name')
    .eq('id', practitionerId)
    .eq('organization_id', practiceId)
    .maybeSingle();

  if (provErr) {
    throw new Error(`Failed to verify practitioner: ${provErr.message}`);
  }
  if (!provider) {
    throw Object.assign(new Error('Practitioner not found for this practice'), { status: 404 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('practitioner_private_share_rates')
    .insert({
      practice_id: practiceId,
      practitioner_id: practitionerId,
      rate: parsedRate,
      effective_from: effectiveFrom,
      created_by: createdBy || null,
    })
    .select('id, practitioner_id, rate, effective_from, created_at')
    .single();

  if (insertErr) {
    if (insertErr.code === '42P01') {
      throw Object.assign(new Error('practitioner_private_share_rates table not migrated yet'), {
        code: 'TABLE_NOT_FOUND',
      });
    }
    if (insertErr.code === '23505') {
      throw Object.assign(
        new Error('A rate already exists for this practitioner on that effective date'),
        { status: 409 }
      );
    }
    throw new Error(`Failed to save rate: ${insertErr.message}`);
  }

  const history = buildRateHistory(
    await fetchRatesForPractitioner(practiceId, practitionerId),
    todayUtc()
  );
  const current = history.find((h) => h.isCurrent) || null;

  return {
    practitionerId,
    practitionerName: provider.name,
    rateConfigured: current != null,
    currentRate: current ? current.rate : null,
    currentEffectiveFrom: current ? current.effectiveFrom : null,
    history,
    inserted: {
      id: inserted.id,
      rate: Number(inserted.rate),
      effectiveFrom: inserted.effective_from,
      createdAt: inserted.created_at,
    },
  };
}

async function fetchRatesForPractitioner(practiceId, practitionerId) {
  const { data, error } = await supabaseAdmin
    .from('practitioner_private_share_rates')
    .select('id, rate, effective_from, created_at')
    .eq('practice_id', practiceId)
    .eq('practitioner_id', practitionerId)
    .order('effective_from', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  listPractitionerRates,
  insertPractitionerRate,
  buildRateHistory,
  todayUtc,
  dedupeProvidersByNameRole,
  preferProvider,
};
