/**
 * Patient Economic Value (PEV) — PROPOSED FORMULA (business confirmation required)
 *
 * There is no settled product spec for "Patient Economic Value™" in Dentally or PE
 * migrations. This module documents the engineering proposal for v_patient_contribution
 * and UI until product signs off.
 *
 * ---------------------------------------------------------------------------
 * PROPOSED FORMULA (implemented in SQL + mirrored here)
 * ---------------------------------------------------------------------------
 *
 *   When Day 3 modelled scores exist for the patient:
 *     PEV = patient_economics_modelled_scores.cltv_projection
 *
 *   When modelled row is missing (job not run / patient excluded):
 *     PEV = contribution (invoice rollup to date only — no forward component)
 *
 * WHY cltv_projection (not contribution + cltv_projection):
 *   The Modelled job already defines cltv_projection as:
 *     historical contribution + discounted future run-rate (5yr @ 10%)
 *   See computePatientModelledScores.js. Adding contribution again double-counts history.
 *
 * WHY NOT opportunity_weighted:
 *   Mockup footnote describes "discounted future contribution over 5-year horizon",
 *   which matches the CLTV run-rate model, NOT planned-not-scheduled pipeline £.
 *   opportunity_weighted is a separate partial-M6 lens (ledger planned value × default p).
 *
 * ALTERNATIVE FOR BUSINESS DISCUSSION (NOT implemented):
 *   PEV = contribution + opportunity_weighted
 *   (realized + near-term pipeline — simpler but mixes provenance grains)
 *
 * Provenance: tier = Modelled; see PE_PATIENT_ECONOMIC_VALUE_TIER_NOTE.
 * ---------------------------------------------------------------------------
 */

export const PE_PATIENT_ECONOMIC_VALUE_TIER = 'Modelled' as const;

export const PE_PATIENT_ECONOMIC_VALUE_TIER_NOTE =
  'Proposed: cltv_projection when modelled job present (contrib + discounted 5yr run-rate); else contribution only. Confirm formula with business — not a settled spec term.';

/**
 * SQL mirror of the proposed PEV expression (for comments / tests).
 * cltvProjection null → use contribution only.
 */
export function proposedPatientEconomicValue(
  contribution: number,
  cltvProjection: number | null | undefined,
): number {
  if (cltvProjection != null && Number.isFinite(cltvProjection)) {
    return cltvProjection;
  }
  return contribution;
}
