/**
 * True when `a` and `b` differ by exactly one character — one insertion,
 * deletion, or substitution. Last-resort fallback for a single-character
 * name typo an exact/prefix match can't catch — e.g. a Practice Plan
 * statement prints a patient as "Aspinal" (no DOB column filled in) while
 * Dentally has them as "Aspinall", or prints a dentist as "Achilliefs
 * Sotiriou" while Dentally has the provider as "Achillefs Sotiriou".
 *
 * Shared by useMembershipUploadData.ts (patient surname matching) and
 * dentistNameMatch.ts (dentist name matching) — one implementation so the
 * two don't drift apart.
 */
export function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return false;
  const lenDiff = a.length - b.length;
  if (Math.abs(lenDiff) > 1) return false;
  if (lenDiff === 0) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}
