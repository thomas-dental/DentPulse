const { supabaseAdmin } = require('../../config/supabase');
const periodHelper = require('./periodHelper');

/**
 * Extracts @-mentions, @-periods, and @-pages from a message.
 * Expands custom aliases. Detects provider signals for context bleed prevention.
 */

const PRONOUNS = new Set([
  'this', 'that', 'it', 'them', 'they', 'he', 'she', 'her', 'him',
  'his', 'hers', 'their', 'theirs', 'same',
]);

function extractMentions(message) {
  const mentions = {
    providers: [],
    periods: [],
    pages: [],
    raw: [],
  };

  // First, extract known @-period tokens (match longest first)
  let remaining = message;
  const sortedPeriods = [...periodHelper.KNOWN_PERIOD_TOKENS].sort((a, b) => b.length - a.length);
  for (const pt of sortedPeriods) {
    const regex = new RegExp(`@${pt}\\b`, 'i');
    if (regex.test(remaining)) {
      mentions.periods.push(pt);
      mentions.raw.push(pt);
      remaining = remaining.replace(regex, ' ').trim();
    }
  }

  // Then extract remaining @-mentions as providers
  const atMatches = remaining.match(/@[\w.'-]+(?:\s+[\w.'-]+)*/g) || [];
  for (const raw of atMatches) {
    const token = raw.slice(1).trim();
    if (!token || periodHelper.isperiodToken(token)) continue;
    mentions.providers.push(token);
    mentions.raw.push(token);
  }

  return mentions;
}

/**
 * Merge mentions picked from the @-picker (sent structurally as
 * [{ value, type }]) into a parsed `mentions` object. The user-visible
 * message text deliberately omits the '@' marker (clean bubble — see
 * ChatInput.handleSubmit), so extractMentions() can't recover them; without
 * this, picker selections never become a provider/period filter.
 *
 * Mutates and returns `mentions`. Provider + alias → providers; period →
 * periods (only if it's a recognised period token). De-duped. Defensive
 * against malformed input.
 */
function mergeStructuredMentions(mentions, structured) {
  if (!mentions || !Array.isArray(structured)) return mentions;
  for (const m of structured) {
    if (!m || typeof m.value !== 'string') continue;
    const val = m.value.trim();
    if (!val) continue;
    if (m.type === 'provider' || m.type === 'alias') {
      if (!mentions.providers.includes(val)) {
        mentions.providers.push(val);
        mentions.raw.push(val);
      }
    } else if (m.type === 'period' && periodHelper.isperiodToken(val)) {
      if (!mentions.periods.includes(val)) {
        mentions.periods.push(val);
        mentions.raw.push(val);
      }
    }
    // 'page' mentions are already plain text in the message — no-op.
  }
  return mentions;
}

function hasProviderSignal(message, currentDoctor) {
  const lower = message.toLowerCase();

  // Has @-mention?
  if (/@\w/.test(message)) return true;

  // Has pronoun?
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (PRONOUNS.has(word)) return true;
  }

  // References current doctor by first name?
  if (currentDoctor) {
    const firstName = currentDoctor.split(/\s+/)[0].toLowerCase();
    if (firstName.length > 2 && lower.includes(firstName)) return true;
  }

  return false;
}

function clearStaleContext(context, message) {
  if (!hasProviderSignal(message, context.currentDoctor)) {
    context.currentDoctor = null;
  }
}

async function expandAliases(message, organizationId, userId) {
  const { data: aliases } = await supabaseAdmin
    .from('chat_mention_aliases')
    .select('alias_name, bound_provider_ids')
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  if (!aliases || aliases.length === 0) return message;

  let expanded = message;
  for (const alias of aliases) {
    const pattern = new RegExp(`@${alias.alias_name}\\b`, 'gi');
    if (pattern.test(expanded)) {
      // For now, expand to comma-separated provider names
      // Will be resolved to actual names when provider lookup is implemented
      const ids = alias.bound_provider_ids || [];
      expanded = expanded.replace(pattern, ids.map(id => `@${id}`).join(', '));
    }
  }

  return expanded;
}

async function resolveProviderName(name, organizationId) {
  const lower = name.toLowerCase().trim().replace(/^dr\.?\s*/i, '');

  const { data: providers } = await supabaseAdmin
    .from('providers')
    .select('id, name, external_id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);

  if (!providers || providers.length === 0) return null;

  // 1. Exact match
  const exact = providers.find(p => p.name.toLowerCase() === name.toLowerCase().trim());
  if (exact) return exact;

  // 2. Starts with
  const startsWith = providers.find(p => p.name.toLowerCase().startsWith(lower));
  if (startsWith) return startsWith;

  // 3. Contains
  const contains = providers.find(p => p.name.toLowerCase().includes(lower));
  if (contains) return contains;

  // 4. First name only
  const firstName = providers.find(p => {
    const pFirst = p.name.split(/\s+/)[0].toLowerCase();
    return pFirst === lower;
  });
  if (firstName) return firstName;

  return null;
}

/**
 * Match practice locations against anything the user typed in the message:
 *  - full-name contains ("the south street dental practice")
 *  - distinctive phrase ("south street")
 *  - acronym formed from non-noise words ("TLF" / "TFL" → "Teeth For Life ...")
 *  - explicit "both"/"all"/"every" qualifiers expand a partial match to all
 *    locations sharing the matched stem.
 * Returns { ids: string[], names: string[], display: string } or null.
 */
async function resolveLocationFromMessage(message, organizationId) {
  if (!message || !organizationId) return null;
  const text = message.toLowerCase();
  const compactText = text.replace(/[^a-z0-9]/g, '');

  const { data: locations } = await supabaseAdmin
    .from('practice_locations')
    .select('id, location_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);

  if (!locations || locations.length === 0) return null;

  const NOISE = new Set([
    'the', 'and', 'of', 'a', 'practice', 'dental', 'care', 'centre', 'center',
    'clinic', 'dentists', 'studio', 'limited', 'ltd',
  ]);

  // Build a "distinctive stem" per location (kept words ≥3 chars, non-noise).
  const enriched = locations.map(loc => {
    const words = (loc.location_name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !NOISE.has(w));
    const acronyms = new Set();
    if (words.length >= 2) {
      const initials = words.map(w => w[0]).join('');
      // Add initials and a couple of common reorderings (e.g. T-F-L vs T-L-F).
      acronyms.add(initials);
      if (initials.length >= 3) {
        acronyms.add(initials[0] + initials[2] + initials[1]);
      }
    }
    return { ...loc, words, acronyms };
  });

  const wantsAll = /\b(both|all|every|each)\b/.test(text);
  const matches = new Set();
  let matchStem = null;

  // Pre-compute word frequency so multiple strategies can use it without
  // recomputing.
  const wordFreq = new Map();
  for (const loc of enriched) {
    for (const w of loc.words) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
  }

  function addMatch(loc) {
    matches.add(loc);
    if (!matchStem) matchStem = loc.words.slice(0, 2).join(' ');
  }

  // We run every strategy and union the matches so a multi-location query
  // like "wigmore and south street" picks up both sites — not just the first
  // one found.

  // 1. Full name contains
  for (const loc of enriched) {
    const name = (loc.location_name || '').toLowerCase();
    if (name && text.includes(name)) addMatch(loc);
  }

  // 2. Distinctive-phrase / all-words / 2-word slice
  for (const loc of enriched) {
    if (matches.has(loc)) continue;
    if (loc.words.length === 0) continue;
    const allWordsHit = loc.words.every(w => text.includes(w));
    let sliceHit = false;
    for (let i = 0; i < loc.words.length - 1; i++) {
      if (text.includes(`${loc.words[i]} ${loc.words[i + 1]}`)) { sliceHit = true; break; }
    }
    if (allWordsHit || sliceHit) addMatch(loc);
  }

  // 2b. Unique-single-word match — e.g. "magor" only appears in one location,
  // so typing it alone should pick that location even without the rest of the
  // name.
  for (const loc of enriched) {
    if (matches.has(loc)) continue;
    const uniqueWord = loc.words.find(w => wordFreq.get(w) === 1 && w.length >= 4);
    if (uniqueWord && new RegExp(`\\b${uniqueWord}\\b`, 'i').test(text)) {
      addMatch(loc);
    }
  }

  // 2c. Prefix-tolerant match on the unique word — catches typos like
  // "wigmor" for "Wigmore" or "caldicott" for "Caldicot". We only accept a
  // prefix hit when at least 5 chars overlap with the unique word, so we
  // don't grab a location off a random short token.
  for (const loc of enriched) {
    if (matches.has(loc)) continue;
    const uniqueWord = loc.words.find(w => wordFreq.get(w) === 1 && w.length >= 5);
    if (!uniqueWord) continue;
    const minOverlap = 5;
    const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.length < minOverlap) continue;
      const head = uniqueWord.slice(0, Math.max(minOverlap, Math.floor(uniqueWord.length * 0.8)));
      if (tok.startsWith(head) || uniqueWord.startsWith(tok.slice(0, minOverlap))) {
        addMatch(loc);
        break;
      }
    }
  }

  // 3. Acronym match (e.g. "TLF" → "Teeth For Life ...")
  for (const loc of enriched) {
    if (matches.has(loc)) continue;
    for (const ac of loc.acronyms) {
      if (ac.length >= 2 && new RegExp(`\\b${ac}\\b`, 'i').test(message)) {
        addMatch(loc);
        break;
      }
      // also detect compact occurrence inside concatenated words
      if (ac.length >= 3 && compactText.includes(ac)) {
        addMatch(loc);
        break;
      }
    }
  }

  if (matches.size === 0) return null;

  // If user wrote "both"/"all" and we matched at least one location, expand to
  // every location whose first distinctive word matches the same stem.
  if (wantsAll && matchStem) {
    const stemFirst = matchStem.split(' ')[0];
    for (const loc of enriched) {
      if (loc.words[0] === stemFirst) matches.add(loc);
    }
  }

  const list = Array.from(matches);
  return {
    ids: list.map(l => l.id),
    names: list.map(l => l.location_name),
    display: list.length === 1
      ? list[0].location_name
      : list.length === 2
        ? `${list[0].location_name} + ${list[1].location_name}`
        : `${list.length} locations`,
  };
}

module.exports = {
  extractMentions,
  mergeStructuredMentions,
  hasProviderSignal,
  clearStaleContext,
  expandAliases,
  resolveProviderName,
  resolveLocationFromMessage,
};
