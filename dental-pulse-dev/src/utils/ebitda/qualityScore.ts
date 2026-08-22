// EBITDA Quality Score™ — 6 sub-scores weighted to a final 0-100 score
// Represents an investor's view of earnings reliability

export interface QualityWeights {
  revenue_predictability: number;
  associate_dependency: number;
  chair_stability: number;
  treatment_mix: number;
  cash_conversion: number;
  nhs_delivery: number;
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  revenue_predictability: 0.20,
  associate_dependency: 0.20,
  chair_stability: 0.15,
  treatment_mix: 0.15,
  cash_conversion: 0.15,
  nhs_delivery: 0.15,
};

export interface QualityScoreInputs {
  /** Monthly revenue values for computing coefficient of variation */
  monthlyRevenues: number[];
  /** Top provider's share of total revenue (0-100) */
  topProviderRevenuePct: number;
  /** Average chair utilisation % (0-100) */
  avgUtilisationPct: number;
  /** Private revenue as % of total (0-100) */
  privateRevenuePct: number;
  /** Paid invoices / total invoices (0-1) */
  paidInvoiceRate: number;
  /** UDA delivery % (0-100), null if no NHS contract */
  udaDeliveryPct: number | null;
  /** Custom weights (optional, defaults to standard weights) */
  weights?: QualityWeights;
}

export interface QualityScoreItem {
  label: string;
  value: number;
  weight: number;
}

export interface QualityScoreResult {
  scores: QualityScoreItem[];
  finalScore: number;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function calculateQualityScore(inputs: QualityScoreInputs): QualityScoreResult {
  // 1. Revenue Predictability: low variation = high score
  const cv = coefficientOfVariation(inputs.monthlyRevenues);
  const revenuePredictability = clamp(100 - cv * 200);

  // 2. Associate Dependency: high concentration = low score
  const associateDependency = clamp(100 - inputs.topProviderRevenuePct * 1.5);

  // 3. Chair Stability: direct mapping of utilisation
  const chairStability = clamp(inputs.avgUtilisationPct);

  // 4. Treatment Mix: higher private % = higher score
  const treatmentMix = clamp(inputs.privateRevenuePct);

  // 5. Cash Conversion: paid rate as percentage
  const cashConversion = clamp(inputs.paidInvoiceRate * 100);

  // 6. NHS Delivery: delivery rate, neutral (65) if no NHS contract
  const nhsDelivery = inputs.udaDeliveryPct != null
    ? clamp(inputs.udaDeliveryPct)
    : 65; // Neutral score when no NHS contract

  const w = inputs.weights ?? DEFAULT_QUALITY_WEIGHTS;

  const scores: QualityScoreItem[] = [
    { label: 'Revenue Predictability', value: revenuePredictability, weight: w.revenue_predictability },
    { label: 'Associate Dependency', value: associateDependency, weight: w.associate_dependency },
    { label: 'Chair Stability', value: chairStability, weight: w.chair_stability },
    { label: 'Treatment Mix', value: treatmentMix, weight: w.treatment_mix },
    { label: 'Cash Conversion', value: cashConversion, weight: w.cash_conversion },
    { label: 'NHS Delivery', value: nhsDelivery, weight: w.nhs_delivery },
  ];

  const finalScore = Math.round(
    scores.reduce((sum, s) => sum + s.value * s.weight, 0)
  );

  return { scores, finalScore };
}
