// Sustainability Haircuts — risk-adjusted deductions from Adjusted EBITDA
// Converts accounting earnings to sustainable operating performance

export interface SustainabilityInputs {
  avgUtilisationPct: number;
  totalRevenue: number;
  totalChairs: number;
  /** Revenue of the highest-earning single provider */
  topProviderRevenue: number;
  /** Probability of top provider departure (default 0.3 = 30%) */
  departureRiskFactor: number;
  /** UDA delivery % (null if no NHS contract) */
  udaDeliveryPct: number | null;
  /** Total NHS contract value from uda_settings */
  nhsContractValue: number;
  /** Manual sustainability items from ebitda_adjustments table */
  manualItems: Array<{ label: string; amount: number; confidence_pct: number | null }>;
  /** Settings-based manual overrides */
  newAssociateRampUp: number;
  newAssociateRampConfidence: number;
  utilisationImprovement: number;
  utilisationImprovementConfidence: number;
}

export interface SustainabilityItem {
  label: string;
  value: number;
  confidence?: string;
  description?: string;
}

export interface SustainabilityResult {
  items: SustainabilityItem[];
  totalImpact: number;
}

export function calculateSustainabilityHaircuts(inputs: SustainabilityInputs): SustainabilityResult {
  const items: SustainabilityItem[] = [];

  // 1. Chair downtime loss
  if (inputs.totalChairs > 0 && inputs.avgUtilisationPct < 100) {
    const downtimePct = (100 - inputs.avgUtilisationPct) / 100;
    const revenuePerChair = inputs.totalRevenue / inputs.totalChairs;
    const chairLoss = -(downtimePct * revenuePerChair * inputs.totalChairs * 0.05);
    if (Math.abs(chairLoss) > 1000) {
      items.push({
        label: 'Chair downtime (verified)',
        value: Math.round(chairLoss),
        description: `${Math.round(inputs.avgUtilisationPct)}% utilisation → ${Math.round(downtimePct * 100)}% idle × ${formatCompact(revenuePerChair)}/chair × ${inputs.totalChairs} chairs × 5%`,
      });
    }
  }

  // 2. Associate departure risk
  if (inputs.topProviderRevenue > 0 && inputs.departureRiskFactor > 0) {
    const departureRisk = -(inputs.topProviderRevenue * inputs.departureRiskFactor);
    items.push({
      label: 'Top associate departure risk',
      value: Math.round(departureRisk),
      description: `${formatCompact(inputs.topProviderRevenue)} top provider revenue × ${Math.round(inputs.departureRiskFactor * 100)}% departure probability`,
    });
  }

  // 3. New associate ramp-up (positive, with confidence weighting)
  if (inputs.newAssociateRampUp > 0) {
    const conf = inputs.newAssociateRampConfidence / 100;
    const rampValue = Math.round(inputs.newAssociateRampUp * conf);
    items.push({
      label: 'New associate ramp-up',
      value: rampValue,
      confidence: `${inputs.newAssociateRampConfidence}%`,
      description: `${formatCompact(inputs.newAssociateRampUp)} potential × ${inputs.newAssociateRampConfidence}% confidence = ${formatCompact(rampValue)}`,
    });
  }

  // 4. Utilisation improvement (positive, with confidence weighting)
  if (inputs.utilisationImprovement > 0) {
    const conf = inputs.utilisationImprovementConfidence / 100;
    const utilValue = Math.round(inputs.utilisationImprovement * conf);
    items.push({
      label: 'Utilisation improvement',
      value: utilValue,
      confidence: `${inputs.utilisationImprovementConfidence}%`,
      description: `${formatCompact(inputs.utilisationImprovement)} potential gain × ${inputs.utilisationImprovementConfidence}% confidence = ${formatCompact(utilValue)}`,
    });
  }

  // 5. NHS UDA clawback
  if (inputs.udaDeliveryPct != null && inputs.nhsContractValue > 0 && inputs.udaDeliveryPct < 100) {
    const shortfallPct = (100 - inputs.udaDeliveryPct) / 100;
    const clawback = -(shortfallPct * inputs.nhsContractValue);
    items.push({
      label: `NHS UDA clawback`,
      value: Math.round(clawback),
      description: `${Math.round(inputs.udaDeliveryPct)}% delivered → ${Math.round(shortfallPct * 100)}% shortfall × ${formatCompact(inputs.nhsContractValue)} contract value`,
    });
  }

  // 6. Manual sustainability items from DB
  for (const item of inputs.manualItems) {
    const conf = item.confidence_pct != null ? item.confidence_pct / 100 : 1;
    items.push({
      label: item.label,
      value: Math.round(item.amount * conf),
      confidence: item.confidence_pct != null ? `${item.confidence_pct}%` : undefined,
      description: item.confidence_pct != null
        ? `${formatCompact(item.amount)} × ${item.confidence_pct}% confidence`
        : `Manual adjustment`,
    });
  }

  const totalImpact = items.reduce((sum, i) => sum + i.value, 0);

  return { items, totalImpact };
}

function formatCompact(value: number): string {
  return '£' + new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
