/**
 * Cashflow excludes Xero Manual Journals (and equivalent labels).
 * Synced as source_type = MANJOURNAL, source_type_desc = ManualJournal.
 */

export function normalizeJournalTypeKey(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

/** True for Manual Journal / MANJOURNAL / MANUALJOURNAL. */
export function isManualJournalType(sourceType?: unknown, sourceTypeDesc?: unknown): boolean {
  const t = normalizeJournalTypeKey(sourceType);
  const d = normalizeJournalTypeKey(sourceTypeDesc);
  return (
    t === "MANJOURNAL" ||
    t === "MANUALJOURNAL" ||
    d === "MANJOURNAL" ||
    d === "MANUALJOURNAL"
  );
}
