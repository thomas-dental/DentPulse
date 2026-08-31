/**
 * Unit tests — reactivation worklist logic (last visit, overdue, annualized hist).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  daysSinceLastVisit,
  annualizeTrailingContribution,
  resolveWorklistDaysOverdue,
  pickLatestCompletedVisit,
  buildRecoveryFunnel,
} = require('../peReactivationWorklistLogic');

test('daysSinceLastVisit ignores future dates', () => {
  const future = new Date();
  future.setDate(future.getDate() + 30);
  assert.equal(daysSinceLastVisit(future.toISOString()), 0);
});

test('daysSinceLastVisit counts past completed visits', () => {
  const past = new Date();
  past.setDate(past.getDate() - 40);
  assert.equal(daysSinceLastVisit(past.toISOString()), 40);
});

test('annualizeTrailingContribution scales to 12 months', () => {
  assert.equal(annualizeTrailingContribution(500, 6), 1000);
  assert.equal(annualizeTrailingContribution(458.31, 12), 458.31);
});

test('resolveWorklistDaysOverdue prefers last visit over recall', () => {
  const past = new Date();
  past.setDate(past.getDate() - 115);
  assert.equal(
    resolveWorklistDaysOverdue(past.toISOString(), '2018-01-01', null),
    115,
  );
});

test('pickLatestCompletedVisit ignores future and non-completed', () => {
  const past = new Date();
  past.setDate(past.getDate() - 10);
  const future = new Date();
  future.setDate(future.getDate() + 60);

  const last = pickLatestCompletedVisit([
    { apmt_state: 'completed', apmt_completed_at: past.toISOString() },
    { apmt_state: 'completed', apmt_completed_at: future.toISOString() },
    { apmt_state: 'pending', apmt_completed_at: null, apmt_start_time: past.toISOString() },
    { apmt_state: 'cancelled', apmt_completed_at: past.toISOString() },
  ]);

  assert.equal(last, past.toISOString());
});

test('buildRecoveryFunnel uses worklist workflow not flag-age thresholds', () => {
  const flags = [
    {
      status: 'open',
      patientId: 'p-new',
      contributionAtRiskAtFlagTime: 1000,
      flaggedAt: new Date().toISOString(),
    },
    {
      status: 'open',
      patientId: 'p-contacted',
      contributionAtRiskAtFlagTime: 500,
      flaggedAt: new Date().toISOString(),
    },
    {
      status: 'recovered',
      patientId: 'p-done',
      contributionAtRiskAtFlagTime: 200,
      contributionRecoveredGbp: 0,
      flaggedAt: new Date().toISOString(),
    },
  ];
  const worklist = [
    { patientId: 'p-new', workflowStatus: 'new' },
    { patientId: 'p-contacted', workflowStatus: 'contacted' },
  ];
  const funnel = buildRecoveryFunnel(flags, worklist);
  assert.equal(funnel.openValueGbp, 1500);
  assert.equal(funnel.contactedGbp, 700);
  assert.equal(funnel.bookedGbp, 200);
  assert.equal(funnel.stages.find((s) => s.key === 'recovered')?.label, 'At-risk recovered');
});
