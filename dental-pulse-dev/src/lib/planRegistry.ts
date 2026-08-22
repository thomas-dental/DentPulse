// Subscription plan -> allowed moduleKey mapping. moduleKey values must match
// the ones used in AppSidebar.tsx / permissionRegistry.ts / PermissionProtectedRoute.
export type PlanTier = 'basic' | 'essential' | 'growth' | 'accelerate';

export const PLAN_TIERS: PlanTier[] = ['basic', 'essential', 'growth', 'accelerate'];

export const PLAN_LABELS: Record<PlanTier, string> = {
  basic: 'Basic',
  essential: 'Essential',
  growth: 'Growth',
  accelerate: 'Accelerate',
};

const SETTINGS_MODULES = ['organization', 'admin_settings', 'roles_permissions'];
const PROFIT_ENGINE_CORE = ['providers'];
const PROFIT_ENGINE_FULL = ['providers', 'treatments', 'chairs', 'specialties'];
const GROWTH_ADDITIONS = ['financial_reports', 'profitability', 'cash_flow', 'patients', 'marketing', 'cost_impact'];
const ACCELERATE_ADDITIONS = ['locations', 'accounts_payable', 'budget', 'ebitda_to_value'];

export const PLAN_MODULES: Record<PlanTier, string[]> = {
  basic: [...PROFIT_ENGINE_CORE, ...SETTINGS_MODULES],
  essential: ['dashboard', ...PROFIT_ENGINE_FULL, ...SETTINGS_MODULES],
  growth: ['dashboard', ...PROFIT_ENGINE_FULL, ...SETTINGS_MODULES, ...GROWTH_ADDITIONS],
  accelerate: [
    'dashboard',
    ...PROFIT_ENGINE_FULL,
    ...SETTINGS_MODULES,
    ...GROWTH_ADDITIONS,
    ...ACCELERATE_ADDITIONS,
  ],
};

// Every module key that's actually part of the plan-gating design (i.e. appears
// in at least one tier's list above). Anything outside this set — practitioner
// activity/history, performance, tax, reports, sync summary, team management,
// provider types, location history, etc. — was never meant to be plan-gated at
// all; it's permission-gated only (see usePermissions/canAccessModule).
const ALL_PLAN_GATED_MODULES = new Set(Object.values(PLAN_MODULES).flat());

// Unknown module keys fail open (not plan-gated), same philosophy as useModuleAccess's fail-open default.
export function isModuleInPlan(plan: PlanTier, moduleKey: string): boolean {
  const modules = PLAN_MODULES[plan];
  if (!modules) return true;
  if (!ALL_PLAN_GATED_MODULES.has(moduleKey)) return true;
  return modules.includes(moduleKey);
}

// Human-readable, cumulative feature summaries for the plan picker UI.
export const PLAN_FEATURES: Record<PlanTier, string[]> = {
  basic: [
    'Profit Engine — Associate provider only',
    'Settings',
  ],
  essential: [
    'Financial Position (full organization data)',
    'Full Profit Engine — Providers, Treatments, Chairs, Specialties',
    'Settings',
  ],
  growth: [
    'Everything in Essential',
    'Financial Statements',
    'Profitability',
    'Cashflow',
    'Managing Business Growth — Patients, Marketing, Cost Impact',
  ],
  accelerate: [
    'Everything in Growth',
    'Operational Efficiency — Locations, Accounts Payable, Budget',
    'Business Valuation',
  ],
};
