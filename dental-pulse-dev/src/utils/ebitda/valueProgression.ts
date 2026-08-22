// Value Progression — compares baseline today vs optimised scenario
// Shows the value opportunity gap

import { calculateQualityScore, type QualityScoreInputs } from './qualityScore';
import { calculateMultiple, type MultipleInputs } from './multipleEngine';

export interface ValueProgressionInputs {
  sustainableEBITDA: number;
  currentMultiple: number;
  currentEV: number;
  /** Current quality score inputs for simulating improvements */
  qualityInputs: QualityScoreInputs;
  /** Current multiple inputs for recalculating with improved scores */
  multipleInputs: MultipleInputs;
  /** How much EBITDA could improve with optimisations */
  ebitdaImprovementPct: number;
}

export interface ProgressionDriver {
  label: string;
  from: string;
  to: string;
  impact: string; // e.g. "+0.2× multiple" or "+£50k EBITDA"
}

export interface ValueProgressionResult {
  baseline: { ebitda: number; multiple: number; value: number };
  optimised: { ebitda: number; multiple: number; value: number };
  opportunity: number;
  drivers: ProgressionDriver[];
  ebitdaGain: number;
  multipleGain: number;
  /** Value impact from EBITDA increase (ΔEBITDA × old multiple) */
  ebitdaValueImpact: number;
  /** Value impact from multiple increase (old EBITDA × Δmultiple) */
  multipleValueImpact: number;
  /** Cross effect (ΔEBITDA × Δmultiple) */
  combinedEffect: number;
}

const fmtPct = (v: number) => `${Math.round(v)}%`;
const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

export function calculateValueProgression(inputs: ValueProgressionInputs): ValueProgressionResult {
  const baseline = {
    ebitda: inputs.sustainableEBITDA,
    multiple: inputs.currentMultiple,
    value: inputs.currentEV,
  };

  // Simulate optimised scenario: improve all weak sub-scores to 80+
  const optimisedQualityInputs: QualityScoreInputs = {
    ...inputs.qualityInputs,
    topProviderRevenuePct: Math.min(inputs.qualityInputs.topProviderRevenuePct, 15),
    avgUtilisationPct: Math.max(inputs.qualityInputs.avgUtilisationPct, 85),
    privateRevenuePct: Math.max(inputs.qualityInputs.privateRevenuePct, 50),
    paidInvoiceRate: Math.max(inputs.qualityInputs.paidInvoiceRate, 0.95),
    udaDeliveryPct: inputs.qualityInputs.udaDeliveryPct != null
      ? Math.max(inputs.qualityInputs.udaDeliveryPct, 97) : null,
  };

  const optimisedQuality = calculateQualityScore(optimisedQualityInputs);

  const optimisedMultipleInputs: MultipleInputs = {
    ...inputs.multipleInputs,
    qualityScore: optimisedQuality.finalScore,
    topProviderRevenuePct: 15,
    avgUtilisationPct: 85,
    udaDeliveryPct: inputs.multipleInputs.udaDeliveryPct != null ? 97 : null,
  };

  const optimisedMultiple = calculateMultiple(optimisedMultipleInputs);

  // EBITDA improvement from removing sustainability haircuts + operational gains
  const optimisedEBITDA = inputs.sustainableEBITDA * (1 + inputs.ebitdaImprovementPct / 100);
  const optimisedEV = optimisedEBITDA * optimisedMultiple.finalMultiple;

  const optimised = {
    ebitda: Math.round(optimisedEBITDA),
    multiple: optimisedMultiple.finalMultiple,
    value: Math.round(optimisedEV),
  };

  // Build drivers: what changed and why
  const drivers: ProgressionDriver[] = [];
  const qi = inputs.qualityInputs;
  const mi = inputs.multipleInputs;

  if (qi.avgUtilisationPct < 85) {
    drivers.push({
      label: 'Chair Utilisation',
      from: fmtPct(qi.avgUtilisationPct),
      to: '85%',
      impact: 'Fills empty chair time, lifts revenue per chair',
    });
  }

  if (qi.topProviderRevenuePct > 15) {
    drivers.push({
      label: 'Associate Dependency',
      from: `${fmtPct(qi.topProviderRevenuePct)} top provider`,
      to: '15%',
      impact: 'Spread revenue across more clinicians',
    });
  }

  if (qi.privateRevenuePct < 50) {
    drivers.push({
      label: 'Private Mix',
      from: fmtPct(qi.privateRevenuePct),
      to: '50%+',
      impact: 'Higher-margin private treatments',
    });
  }

  if (qi.paidInvoiceRate < 0.95) {
    drivers.push({
      label: 'Cash Conversion',
      from: fmtPct(qi.paidInvoiceRate * 100),
      to: '95%+',
      impact: 'Fewer unpaid invoices, better cash flow',
    });
  }

  if (qi.udaDeliveryPct != null && qi.udaDeliveryPct < 97) {
    drivers.push({
      label: 'NHS Delivery',
      from: fmtPct(qi.udaDeliveryPct),
      to: '97%+',
      impact: 'Eliminate clawback risk',
    });
  }

  const deltaEbitda = optimised.ebitda - baseline.ebitda;
  const deltaMultiple = optimised.multiple - baseline.multiple;
  const ebitdaGain = deltaEbitda;
  const multipleGain = Math.round(deltaMultiple * 10) / 10;

  // Decompose opportunity into additive value impacts
  const ebitdaValueImpact = Math.round(deltaEbitda * baseline.multiple);
  const multipleValueImpact = Math.round(baseline.ebitda * deltaMultiple);
  const combinedEffect = Math.round(deltaEbitda * deltaMultiple);

  if (ebitdaGain > 0) {
    drivers.push({
      label: 'EBITDA Uplift',
      from: fmtCurrency(baseline.ebitda),
      to: fmtCurrency(optimised.ebitda),
      impact: `+${fmtCurrency(ebitdaGain)} from operational improvements`,
    });
  }

  return {
    baseline,
    optimised,
    opportunity: optimised.value - baseline.value,
    drivers,
    ebitdaGain,
    multipleGain,
    ebitdaValueImpact,
    multipleValueImpact,
    combinedEffect,
  };
}
