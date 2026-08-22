// Valuation Multiple Engine — builds a waterfall from base multiple to final
// "Multiple is not given. It is earned."

export interface MultipleInputs {
  baseMultiple: number;
  totalRevenue: number;
  avgUtilisationPct: number;
  qualityScore: number;
  topProviderRevenuePct: number;
  udaDeliveryPct: number | null;
  hasGLData: boolean;
  netDebtToEbitdaRatio: number;
  /** Fixed penalty overrides (negative values, 0 = disabled) */
  mgmtDepthPenalty?: number;
  standardisationPenalty?: number;
  leveragePenalty?: number;
  /** User-defined extra penalties/premia from EBITDA Valuation Settings.
   *  value is the multiple delta (negative = penalty, positive = premium). */
  customPenalties?: Array<{ label: string; value: number }>;
}

export interface WaterfallItem {
  label: string;
  value: number;
  type: 'base' | 'positive' | 'negative';
}

export interface MultipleResult {
  waterfall: WaterfallItem[];
  finalMultiple: number;
}

export function calculateMultiple(inputs: MultipleInputs): MultipleResult {
  const {
    baseMultiple, totalRevenue, avgUtilisationPct, qualityScore,
    topProviderRevenuePct, udaDeliveryPct, hasGLData, netDebtToEbitdaRatio,
  } = inputs;

  const waterfall: WaterfallItem[] = [
    { label: 'Base Market', value: baseMultiple, type: 'base' },
  ];

  let running = baseMultiple;

  // + Scale: revenue size premium
  const scalePremium = totalRevenue > 5_000_000 ? 0.3
    : totalRevenue > 3_000_000 ? 0.2
    : totalRevenue > 1_000_000 ? 0.1 : 0;
  if (scalePremium > 0) {
    waterfall.push({ label: '+ Scale', value: scalePremium, type: 'positive' });
    running += scalePremium;
  }

  // + Chair utilisation premium
  const chairPremium = avgUtilisationPct > 80 ? 0.2
    : avgUtilisationPct > 70 ? 0.1 : 0;
  if (chairPremium > 0) {
    waterfall.push({ label: '+ Chair', value: chairPremium, type: 'positive' });
    running += chairPremium;
  }

  // + Reporting quality
  if (hasGLData) {
    waterfall.push({ label: '+ Reporting', value: 0.1, type: 'positive' });
    running += 0.1;
  }

  // + Low leverage
  const debtPremium = netDebtToEbitdaRatio < 1.5 ? 0.1 : 0;
  if (debtPremium > 0) {
    waterfall.push({ label: '+ Debt Mgmt', value: debtPremium, type: 'positive' });
    running += debtPremium;
  }

  // − Associate dependency
  const assocPenalty = topProviderRevenuePct > 40 ? -0.4
    : topProviderRevenuePct > 30 ? -0.3
    : topProviderRevenuePct > 20 ? -0.2 : 0;
  if (assocPenalty < 0) {
    waterfall.push({ label: '− Assoc. Dep.', value: assocPenalty, type: 'negative' });
    running += assocPenalty;
  }

  // − Management depth
  const mgmtPenalty = inputs.mgmtDepthPenalty ?? -0.3;
  waterfall.push({ label: '− Mgmt Depth', value: mgmtPenalty, type: mgmtPenalty < 0 ? 'negative' : 'positive' });
  running += mgmtPenalty;

  // − NHS risk
  const nhsPenalty = udaDeliveryPct == null ? 0
    : udaDeliveryPct < 92 ? -0.3
    : udaDeliveryPct < 96 ? -0.2
    : udaDeliveryPct < 100 ? -0.1 : 0;
  if (nhsPenalty < 0) {
    waterfall.push({ label: '− NHS Risk', value: nhsPenalty, type: 'negative' });
    running += nhsPenalty;
  }

  // − Standardisation
  const stdPenalty = inputs.standardisationPenalty ?? -0.2;
  waterfall.push({ label: '− Standards', value: stdPenalty, type: stdPenalty < 0 ? 'negative' : 'positive' });
  running += stdPenalty;

  // − Leverage
  const levPenalty = inputs.leveragePenalty ?? -0.2;
  waterfall.push({ label: '− Leverage', value: levPenalty, type: levPenalty < 0 ? 'negative' : 'positive' });
  running += levPenalty;

  // − Quality drag
  const qualDrag = qualityScore < 65 ? -0.3
    : qualityScore < 75 ? -0.2
    : qualityScore < 85 ? -0.1 : 0;
  if (qualDrag < 0) {
    waterfall.push({ label: '− Qual. Drag', value: qualDrag, type: 'negative' });
    running += qualDrag;
  }

  // User-defined custom penalties / premia from EBITDA Valuation Settings.
  for (const cp of inputs.customPenalties ?? []) {
    const v = Number(cp.value);
    if (!Number.isFinite(v) || v === 0) continue;
    const label = (cp.label || 'Custom').trim() || 'Custom';
    // Skip obvious placeholder/test rows so they never reach a client-facing
    // valuation (e.g. "test", "test2", "test 3").
    if (/^test\s*\d*$/i.test(label)) continue;
    waterfall.push({
      label: `${v < 0 ? '− ' : '+ '}${label}`,
      value: v,
      type: v < 0 ? 'negative' : 'positive',
    });
    running += v;
  }

  const finalMultiple = Math.max(3.0, Math.min(8.0, Math.round(running * 10) / 10));

  return { waterfall, finalMultiple };
}
