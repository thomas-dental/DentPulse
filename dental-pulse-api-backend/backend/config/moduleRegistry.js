// ============================================================
// Module Registry — canonical list of DentPulse app modules
// that can be enabled/disabled per organization.
//
// Keys, labels and icons are kept in sync with the DentPulse dev project's
// PERMISSION_REGISTRY (src/lib/permissionRegistry.ts) — the same module keys
// the dev app's sidebar gates on via canAccessModule(moduleKey)
// (src/components/layout/AppSidebar.tsx). `icon` is a lucide-react icon name
// the frontend maps to a component.
// ============================================================

const MODULE_REGISTRY = [
  { key: 'dashboard',            name: 'Dashboard',            icon: 'LayoutDashboard', description: 'Main overview and KPIs' },
  { key: 'performance',          name: 'Performance',          icon: 'BarChart3',       description: 'Location and entity performance tracking' },
  { key: 'cash_flow',            name: 'Cash Flow',            icon: 'Banknote',        description: 'Cash flow statement, forecast, and bills to pay' },
  { key: 'profitability',        name: 'Profitability',        icon: 'TrendingUp',      description: 'P&L analysis and benchmarking' },
  { key: 'tax',                  name: 'Tax',                  icon: 'Calculator',      description: 'Corporation tax and planning' },
  { key: 'budget',               name: 'Budget & Planning',    icon: 'ClipboardList',   description: 'Budget vs actual and forecasting' },
  { key: 'locations',            name: 'Locations',            icon: 'MapPin',          description: 'Multi-location management' },
  { key: 'providers',            name: 'Providers',            icon: 'Users',           description: 'Associate and staff performance' },
  { key: 'treatments',           name: 'Treatments',           icon: 'Stethoscope',     description: 'Treatment mix and specialty tracking' },
  { key: 'specialties',          name: 'Specialties',          icon: 'HeartPulse',      description: 'Clinical specialties setup' },
  { key: 'chairs',               name: 'Chairs',               icon: 'Armchair',        description: 'Chair utilisation and occupancy' },
  { key: 'patients',             name: 'Patients',             icon: 'UserCheck',       description: 'Patient list and insights' },
  { key: 'accounts_payable',     name: 'Accounts Payable',     icon: 'Zap',             description: 'Invoice automation and processing' },
  { key: 'cost_impact',          name: 'Cost Impact',          icon: 'Layers',          description: 'Lab, staff, overhead and material costs' },
  { key: 'marketing',            name: 'Marketing',            icon: 'Megaphone',       description: 'Marketing performance and campaigns' },
  { key: 'reports',              name: 'Reports',              icon: 'FileSpreadsheet', description: 'Financial statements and reports' },
  { key: 'organization',         name: 'Organization',         icon: 'Briefcase',       description: 'Team, users and organization settings' },
  { key: 'admin_settings',       name: 'Admin / Settings',     icon: 'Settings',        description: 'Modules, integrations and system preferences' },
  { key: 'ebitda_to_value',      name: 'EBITDA to Value',      icon: 'Target',          description: 'Enterprise value and EBITDA analysis' },
  { key: 'sync_summary',         name: 'Sync Summary',         icon: 'RefreshCw',       description: 'Integration sync status and history' },
  { key: 'team_management',      name: 'Team Management',      icon: 'Users',           description: 'Team member management' },
  { key: 'practitioner_history', name: 'Practitioner History', icon: 'Users',           description: 'Practitioner activity history' },
  { key: 'provider_types',       name: 'Provider Types',       icon: 'UserCheck',       description: 'Provider type configuration' },
  { key: 'roles_permissions',    name: 'Roles & Permissions',  icon: 'ShieldCheck',     description: 'Custom roles and permission management' },
];

const MODULE_KEYS = new Set(MODULE_REGISTRY.map((m) => m.key));

/** Default access map: every registered module enabled. */
function defaultModuleMap() {
  return MODULE_REGISTRY.reduce((acc, m) => {
    acc[m.key] = true;
    return acc;
  }, {});
}

module.exports = { MODULE_REGISTRY, MODULE_KEYS, defaultModuleMap };
