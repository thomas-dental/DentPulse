// Key Value Drivers — traffic-light indicators for the main value levers

export interface KeyDriverResult {
  label: string;
  status: string;
  color: 'green' | 'amber' | 'red';
  actual: string;
  description: string;
  thresholds: string;
  pct: number; // 0–100 normalised score for visual bar
}

export interface KeyDriverInputs {
  ebitdaMarginPct: number;
  utilisationPct: number;
  topProviderPct: number;
  privateRevenuePct: number;
  udaDeliveryPct: number | null;
  totalRevenue: number;
}

const fmtPct = (v: number) => `${Math.round(v * 10) / 10}%`;
const fmtRevenue = (v: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function calculateKeyDrivers(inputs: KeyDriverInputs): KeyDriverResult[] {
  const drivers: KeyDriverResult[] = [];

  // Margin Efficiency — 0% → 0, 25%+ → 100
  const marginPct = clamp((inputs.ebitdaMarginPct / 30) * 100);
  drivers.push({
    label: 'Margin Efficiency',
    status: inputs.ebitdaMarginPct > 25 ? 'Strong' : inputs.ebitdaMarginPct > 15 ? 'Medium' : 'Low',
    color: inputs.ebitdaMarginPct > 25 ? 'green' : inputs.ebitdaMarginPct > 15 ? 'amber' : 'red',
    actual: fmtPct(inputs.ebitdaMarginPct),
    description: 'EBITDA as a % of revenue — higher margin = more profit per pound earned.',
    thresholds: '>25% Strong · 15–25% Medium · <15% Low',
    pct: marginPct,
  });

  // Chair Utilisation — direct %
  drivers.push({
    label: 'Chair Utilisation',
    status: inputs.utilisationPct > 80 ? 'Strong' : inputs.utilisationPct > 65 ? 'Moderate' : 'Low',
    color: inputs.utilisationPct > 80 ? 'green' : inputs.utilisationPct > 65 ? 'amber' : 'red',
    actual: fmtPct(inputs.utilisationPct),
    description: 'Average chair usage — low utilisation = wasted capacity.',
    thresholds: '>80% Strong · 65–80% Moderate · <65% Low',
    pct: clamp(inputs.utilisationPct),
  });

  // Associate Dependency — inverted: lower concentration = better
  const assocPct = clamp(100 - inputs.topProviderPct * 2);
  drivers.push({
    label: 'Associate Dependency',
    status: inputs.topProviderPct > 35 ? 'High Risk' : inputs.topProviderPct > 25 ? 'Moderate' : 'Low Risk',
    color: inputs.topProviderPct > 35 ? 'red' : inputs.topProviderPct > 25 ? 'amber' : 'green',
    actual: `${fmtPct(inputs.topProviderPct)} top associate`,
    description: 'Revenue share of the highest-earning associate — if they leave, this % is at risk.',
    thresholds: '<25% Low Risk · 25–35% Moderate · >35% High Risk',
    pct: assocPct,
  });

  // Revenue Quality — private mix %
  drivers.push({
    label: 'Revenue Quality',
    status: inputs.privateRevenuePct > 50 ? 'Strong' : inputs.privateRevenuePct > 30 ? 'Improving' : 'Low',
    color: inputs.privateRevenuePct > 50 ? 'green' : inputs.privateRevenuePct > 30 ? 'amber' : 'red',
    actual: `${fmtPct(inputs.privateRevenuePct)} private`,
    description: 'Private treatment share — higher margins, not subject to NHS clawback.',
    thresholds: '>50% Strong · 30–50% Improving · <30% Low',
    pct: clamp(inputs.privateRevenuePct),
  });

  // NHS Delivery
  if (inputs.udaDeliveryPct != null) {
    drivers.push({
      label: 'NHS Delivery',
      status: inputs.udaDeliveryPct >= 96 ? 'On Track' : inputs.udaDeliveryPct >= 90 ? 'At Risk' : 'Critical',
      color: inputs.udaDeliveryPct >= 96 ? 'green' : inputs.udaDeliveryPct >= 90 ? 'amber' : 'red',
      actual: `${fmtPct(inputs.udaDeliveryPct)} delivered`,
      description: 'UDA delivery vs NHS target — under-delivery risks clawback.',
      thresholds: '≥96% On Track · 90–96% At Risk · <90% Critical',
      pct: clamp(inputs.udaDeliveryPct),
    });
  }

  // Scalability — £0 → 0, £5M+ → 100
  const scalePct = clamp((inputs.totalRevenue / 5_000_000) * 100);
  drivers.push({
    label: 'Scalability',
    status: inputs.totalRevenue > 5_000_000 ? 'Strong' : inputs.totalRevenue > 2_000_000 ? 'Moderate' : 'Early Stage',
    color: inputs.totalRevenue > 5_000_000 ? 'green' : inputs.totalRevenue > 2_000_000 ? 'amber' : 'red',
    actual: fmtRevenue(inputs.totalRevenue),
    description: 'Total revenue — larger practices attract higher multiples.',
    thresholds: '>£5M Strong · £2M–£5M Moderate · <£2M Early Stage',
    pct: scalePct,
  });

  return drivers;
}
