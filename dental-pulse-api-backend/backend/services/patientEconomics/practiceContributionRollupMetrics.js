function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampPct(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/** Revenue-invoice attribution percentages (matches v_practice_contribution.pct_*). */
function applyDataQualityMetrics(row) {
  const withRevenue = row.invoicesWithRevenue;
  const storedPctComplete = row.pctComplete;
  const storedPctPartialNoPractitioner = row.pctPartialNoPractitioner;
  const storedPctPartialMissingRate = row.pctPartialMissingRate;

  if (withRevenue > 0) {
    const completeWithRevenue = Math.max(
      0,
      Math.min(withRevenue, num(row.invoicesComplete)),
    );

    row.pctComplete =
      storedPctComplete != null
        ? clampPct(storedPctComplete)
        : clampPct((1000 * completeWithRevenue) / withRevenue / 10);
    row.pctPartialNoPractitioner =
      storedPctPartialNoPractitioner != null
        ? clampPct(storedPctPartialNoPractitioner)
        : clampPct((1000 * row.invoicesPartialNoPractitioner) / withRevenue / 10);
    row.pctPartialMissingRate =
      storedPctPartialMissingRate != null
        ? clampPct(storedPctPartialMissingRate)
        : clampPct((1000 * row.invoicesPartialMissingRate) / withRevenue / 10);
  } else {
    row.pctComplete = null;
    row.pctPartialNoPractitioner = null;
    row.pctPartialMissingRate = null;
  }

  if (row.invoicesPartialNoPractitioner > 0) {
    row.contributionProvenanceStatus = 'partial_no_practitioner';
  } else if (row.invoicesPartialMissingRate > 0) {
    row.contributionProvenanceStatus = 'partial_missing_rate';
  } else {
    row.contributionProvenanceStatus = 'complete';
  }

  if (row.invoicesPartialNoPractitioner > 0 || row.invoicesPartialMissingRate > 0) {
    row.clinicianCostTier = 'External';
  } else {
    row.clinicianCostTier = 'Derived';
  }

  return row;
}

function mapScopedSummaryFacts(facts) {
  const row = {
    invoiceCount: num(facts.invoice_count),
    invoicesWithRevenue: num(facts.invoices_with_revenue),
    patientCount: num(facts.patient_count),
    patientsWithRevenue: num(facts.patients_with_revenue),
    revenuePrivatePlan: num(facts.total_revenue),
    contribution: num(facts.total_contribution),
    invoicesComplete: num(facts.invoices_complete),
    invoicesPartialNoPractitioner: num(facts.invoices_partial_no_practitioner),
    invoicesPartialMissingRate: num(facts.invoices_partial_missing_rate),
    pctComplete: facts.pct_complete != null ? num(facts.pct_complete) : null,
    pctPartialNoPractitioner:
      facts.pct_partial_no_practitioner != null
        ? num(facts.pct_partial_no_practitioner)
        : null,
    pctPartialMissingRate:
      facts.pct_partial_missing_rate != null
        ? num(facts.pct_partial_missing_rate)
        : null,
    contributionProvenanceStatus: 'complete',
    clinicianCostTier: 'Derived',
  };

  return applyDataQualityMetrics(row);
}

module.exports = {
  clampPct,
  applyDataQualityMetrics,
  mapScopedSummaryFacts,
};
