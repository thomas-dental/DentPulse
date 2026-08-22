/**
 * Curated multi-KPI templates for vague "how are we doing?" questions, where
 * the user wants an at-a-glance dashboard rather than one specific metric.
 *
 * A template is just an ordered list of plan items the orchestrator expands:
 *   { kpiId, dimension|null }
 * The orchestrator runs each through the registry + aggregator, then
 * planDashboard.js turns the results into widgets.
 */

const TEMPLATES = {
  practice_overview: {
    id: 'practice_overview',
    title: 'Practice overview',
    items: [
      { kpiId: 'total_treatment_revenue', dimension: null },
      { kpiId: 'patients_treated', dimension: null },
      { kpiId: 'avg_revenue_per_patient', dimension: null },
      { kpiId: 'total_treatment_revenue', dimension: 'month' },
      { kpiId: 'total_treatment_revenue', dimension: 'location' },
      { kpiId: 'total_treatment_revenue', dimension: 'provider' },
    ],
  },
  revenue_deep_dive: {
    id: 'revenue_deep_dive',
    title: 'Revenue deep dive',
    items: [
      { kpiId: 'total_treatment_revenue', dimension: null },
      { kpiId: 'completed_treatment_count', dimension: null },
      { kpiId: 'total_treatment_revenue', dimension: 'month' },
      { kpiId: 'total_treatment_revenue', dimension: 'location' },
      { kpiId: 'total_treatment_revenue', dimension: 'provider' },
    ],
  },
};

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.practice_overview;
}

module.exports = { TEMPLATES, getTemplate };
