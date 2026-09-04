/**
 * Reactivation worklist — pure helpers (last visit overdue, annualised hist).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function recallOverdueDays(dentistRecall, hygienistRecall) {
  const today = startOfToday();
  let maxOverdue = 0;
  for (const raw of [dentistRecall, hygienistRecall]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    d.setHours(0, 0, 0, 0);
    if (d < today) {
      const overdue = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      if (overdue > maxOverdue) maxOverdue = overdue;
    }
  }
  return maxOverdue;
}

/** Days since last completed visit (worklist overdue column). */
function daysSinceLastVisit(lastVisitAt) {
  if (!lastVisitAt) return 0;
  const visit = new Date(lastVisitAt);
  if (Number.isNaN(visit.getTime())) return 0;
  visit.setHours(0, 0, 0, 0);
  const today = startOfToday();
  if (visit > today) return 0;
  return Math.floor((today - visit) / (1000 * 60 * 60 * 24));
}

/** Annualize trailing-window contribution for hist. contribution/yr column. */
function annualizeTrailingContribution(trailingGbp, trailingMonths) {
  const trailing = num(trailingGbp);
  const months = num(trailingMonths);
  if (trailing <= 0) return 0;
  if (months <= 0) return round2(trailing);
  return round2((trailing / months) * 12);
}

function resolveWorklistDaysOverdue(lastVisitAt, dentistRecall, hygienistRecall) {
  const daysFromVisit = daysSinceLastVisit(lastVisitAt);
  if (daysFromVisit > 0) return daysFromVisit;
  return recallOverdueDays(dentistRecall, hygienistRecall);
}

/**
 * Latest completed appointment timestamp (past only), excluding cancelled/DNA.
 */
function pickLatestCompletedVisit(appointments) {
  const today = startOfToday();
  let latest = null;

  for (const appt of appointments) {
    const state = String(appt.apmt_state || '').toLowerCase().trim();
    if (state === 'cancelled' || state === 'did not attend' || state === 'dna') continue;

    const completedAt = appt.apmt_completed_at;
    if (!completedAt) continue;

    const visit = new Date(completedAt);
    if (Number.isNaN(visit.getTime()) || visit > today) continue;

    const at = String(completedAt);
    if (!latest || at > latest) latest = at;
  }

  return latest;
}

function roundPct(rate) {
  if (!Number.isFinite(rate)) return null;
  return Math.round(rate * 1000) / 1000;
}

/**
 * Recovery Loop funnel — stage £ aligned to worklist workflow status (not flag-age heuristics).
 */
function buildRecoveryFunnel(flagRows, openWorklist = []) {
  const workflowByPatient = new Map(
    openWorklist.map((w) => [w.patientId, w.workflowStatus]),
  );

  const recoveredRows = flagRows.filter((f) => f.status === 'recovered');
  const openRows = flagRows.filter((f) => f.status === 'open');

  const sumAtRisk = (rows) =>
    round2(rows.reduce((s, f) => s + num(f.contributionAtRiskAtFlagTime), 0));

  const workflowOf = (f) => {
    if (f.status === 'recovered') return 'recovered';
    return workflowByPatient.get(f.patientId) ?? 'new';
  };

  const flaggedAtRiskGbp = sumAtRisk(flagRows);
  const recoveredAtRiskGbp = sumAtRisk(recoveredRows);
  const recoveredValueGbp = round2(
    recoveredRows.reduce((s, f) => s + num(f.contributionRecoveredGbp), 0),
  );
  const openValueGbp = sumAtRisk(openRows);

  const contactedOpen = openRows.filter((f) => {
    const ws = workflowOf(f);
    return ws === 'contacted' || ws === 'booked';
  });
  const bookedOpen = openRows.filter((f) => workflowOf(f) === 'booked');

  const assignedGbp = round2(recoveredAtRiskGbp + openValueGbp);
  const contactedGbp = round2(sumAtRisk(contactedOpen) + recoveredAtRiskGbp);
  const bookedGbp = round2(sumAtRisk(bookedOpen) + recoveredAtRiskGbp);

  const bankedPct =
    flaggedAtRiskGbp > 0 ? roundPct(recoveredAtRiskGbp / flaggedAtRiskGbp) : null;

  return {
    flaggedAtRiskGbp,
    assignedGbp,
    contactedGbp,
    bookedGbp,
    recoveredAtRiskGbp,
    recoveredValueGbp,
    openValueGbp,
    bankedPct,
    stages: [
      { key: 'flagged', label: 'Flagged at risk', valueGbp: flaggedAtRiskGbp },
      { key: 'assigned', label: 'Assigned', valueGbp: assignedGbp },
      { key: 'contacted', label: 'Contacted', valueGbp: contactedGbp },
      { key: 'booked', label: 'Booked', valueGbp: bookedGbp },
      { key: 'recovered', label: 'Recovered', valueGbp: recoveredAtRiskGbp },
    ],
  };
}

module.exports = {
  daysSinceLastVisit,
  annualizeTrailingContribution,
  resolveWorklistDaysOverdue,
  pickLatestCompletedVisit,
  recallOverdueDays,
  buildRecoveryFunnel,
};
