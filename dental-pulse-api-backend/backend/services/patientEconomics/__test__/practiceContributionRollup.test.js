'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  clampPct,
  applyDataQualityMetrics,
  mapScopedSummaryFacts,
} = require('../practiceContributionRollupMetrics');

test('clampPct keeps attribution completeness in 0–100', () => {
  assert.equal(clampPct(-50.4), 0);
  assert.equal(clampPct(104.2), 100);
  assert.equal(clampPct(4.44), 4.4);
});

test('mapScopedSummaryFacts uses mutually exclusive provenance counts', () => {
  const row = mapScopedSummaryFacts({
    invoice_count: 120,
    invoices_with_revenue: 100,
    total_revenue: 50000,
    total_contribution: 12000,
    invoices_complete: 4,
    invoices_partial_no_practitioner: 90,
    invoices_partial_missing_rate: 6,
    pct_complete: 4.0,
    pct_partial_no_practitioner: 90.0,
    pct_partial_missing_rate: 6.0,
  });

  assert.equal(row.invoicesComplete, 4);
  assert.equal(row.invoicesPartialNoPractitioner, 90);
  assert.equal(row.invoicesPartialMissingRate, 6);
  assert.equal(row.pctComplete, 4);
  assert.equal(row.pctPartialNoPractitioner, 90);
  assert.equal(row.pctPartialMissingRate, 6);
  assert.equal(row.contributionProvenanceStatus, 'partial_no_practitioner');
});

test('applyDataQualityMetrics never emits negative completeness', () => {
  const row = applyDataQualityMetrics({
    invoicesWithRevenue: 100,
    invoicesComplete: -15,
    invoicesPartialNoPractitioner: 80,
    invoicesPartialMissingRate: 55,
  });

  assert.ok(row.pctComplete >= 0);
  assert.ok(row.pctComplete <= 100);
});
