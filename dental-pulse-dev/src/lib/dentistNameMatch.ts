/**
 * Best-effort matching between a free-text dentist name (a Practice Plan /
 * Denplan statement's treating_dentist, or any other manually-entered name)
 * and a Dentally `providers.name` record. The two rarely match exactly —
 * statements print full/title-cased names ("Dr Abygail Costello") while the
 * provider record may use a short form ("Aby Costello") — so an exact
 * string comparison silently fails and every Dentally-sourced figure for
 * that dentist shows as missing.
 *
 * Shared by useAllProvidersNetProduction.ts (membership-module revenue
 * fallback) and useCliniciansData.ts (Clinicians tab's Site/New pts/Joins/
 * Conversion/Utilisation columns) — keep both on this ONE implementation;
 * two independent matchers drifting apart is exactly how this bug happened
 * the first time (2026-08-11).
 */

import { isEditDistanceOne } from './stringSimilarity';

const TITLE_PREFIX_RE = /^(dr|mr|mrs|miss|ms|prof)\.?\s+/i;

export function normalizeDentistName(raw: string): string {
  return raw.replace(TITLE_PREFIX_RE, '').trim().toLowerCase();
}

/** Surname must match exactly or differ by a single-character typo (e.g. a
 *  Practice Plan statement's "Achilliefs Sotiriou" vs Dentally's "Achillefs
 *  Sotiriou" — confirmed real case, 2026-08-12); first names must match
 *  exactly, be a nickname prefix of one another (e.g. "Aby" ~ "Abygail"), or
 *  likewise differ by a single-character typo. */
export function dentistNamesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeDentistName(a);
  const nb = normalizeDentistName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(/\s+/);
  const pb = nb.split(/\s+/);
  const lastA = pa[pa.length - 1];
  const lastB = pb[pb.length - 1];
  if (lastA !== lastB && !isEditDistanceOne(lastA, lastB)) return false;
  const firstA = pa[0];
  const firstB = pb[0];
  return (
    firstA.startsWith(firstB) ||
    firstB.startsWith(firstA) ||
    isEditDistanceOne(firstA, firstB)
  );
}
