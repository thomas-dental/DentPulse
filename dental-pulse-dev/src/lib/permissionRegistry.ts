// ============================================================
// Permission Registry — Single source of truth for RBAC
// Derived from docs/modules-and-actions.md
// ============================================================

export type ActionType = 'view' | 'add' | 'update' | 'delete' | 'export' | 'import' | 'sync' | 'action';

export const ALL_ACTION_TYPES: ActionType[] = ['view', 'add', 'update', 'delete', 'export', 'import', 'sync', 'action'];

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  view: 'View',
  add: 'Add',
  update: 'Update',
  delete: 'Delete',
  export: 'Export',
  import: 'Import',
  sync: 'Sync',
  action: 'Action',
};

export interface PermissionCard {
  key: string;
  label: string;
  actions: ActionType[];
  tab?: string;        // tab key this card belongs to (omit for top-level / no-tab cards)
}

export interface TabDefinition {
  key: string;
  label: string;
}

export interface ModuleDefinition {
  key: string;
  label: string;
  icon: string;       // lucide-react icon name
  path?: string;
  tabs?: TabDefinition[];   // ordered tabs for this module
  disabled?: boolean;       // hide from permissions UI when true
  cards: PermissionCard[];
}

// ---------- Registry ----------

export const PERMISSION_REGISTRY: ModuleDefinition[] = [
  // 1. Dashboard — page level permission
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    path: '/',
    cards: [
      { key: 'page_access', label: 'Dashboard Page', actions: ['view'] },
    ],
  },

  // 2. Performance — page level access
  {
    key: 'performance',
    label: 'Performance',
    icon: 'BarChart3',
    path: '/performance',
    cards: [
      { key: 'page_access', label: 'Performance Page', actions: ['view'] },
    ],
  },

// 3. Cash Flow — Cash Flow Statement (with 3 in-page tabs)
  {
    key: 'cash_flow',
    label: 'Cash Flow',
    icon: 'Banknote',
    path: '/cashflow/preparing-statement',
    tabs: [
      { key: 'preparing', label: 'Cash Flow Statement' },
      { key: 'forecast', label: '13-Week Forecast' },
      { key: 'bills', label: 'Bills to Pay' },
      { key: 'cashflow-growth', label: 'Growth' },
    ],
    cards: [
      // Cash Flow Statement — page level + 3 tab-level cards
      { key: 'preparing_cashflow_page', label: 'Cash Flow Statement Page', actions: ['view'], tab: 'preparing' },
      { key: 'transactions_tab', label: 'Transactions to Review', actions: ['view'], tab: 'preparing' },
      { key: 'statement_tab', label: 'Cash Flow Statement', actions: ['view', 'export', 'action'], tab: 'preparing' },
      { key: 'archived_tab', label: 'Archived Cash Flow Statements', actions: ['view', 'delete'], tab: 'preparing' },
      // 13-Week Cash Flow Forecast
      { key: 'thirteen_week_forecast', label: '13-Week Cash Flow Forecast', actions: ['view', 'export', 'action'], tab: 'forecast' },
      // Bills to Pay
      { key: 'bills_to_pay', label: 'Bills to Pay', actions: ['view', 'action'], tab: 'bills' },
      { key: 'cashflow_growth_tab', label: 'Growth', actions: ['view'], tab: 'cashflow-growth' },
    ],
  },

  // 4. Profitability
  {
    key: 'profitability',
    label: 'Profitability',
    icon: 'TrendingUp',
    path: '/profitability',
    cards: [
      // 4a. Profitability Analysis — page level & tab level access
      { key: 'profitability_analysis', label: 'Profitability Analysis', actions: ['view'] },
      // 4b. Profit Benchmark — page level access
      { key: 'profit_benchmark', label: 'Profit Benchmark', actions: ['view'] },
    ],
  },

  // 5. Tax — page and tab level
  {
    key: 'tax',
    label: 'Tax',
    icon: 'Calculator',
    path: '/tax',
    tabs: [
      { key: 'entity', label: 'Entity Tax' },
      { key: 'group', label: 'Group Tax' },
      { key: 'calculation', label: 'Tax Calculation' },
      { key: 'planning', label: 'Tax Planning' },
    ],
    cards: [
      { key: 'page_access', label: 'Tax Page', actions: ['view'] },
      { key: 'entity_tab', label: 'Entity Tax', actions: ['view'], tab: 'entity' },
      { key: 'group_tab', label: 'Group Tax', actions: ['view'], tab: 'group' },
      { key: 'calculation_tab', label: 'Tax Calculation', actions: ['view'], tab: 'calculation' },
      { key: 'planning_tab', label: 'Tax Planning', actions: ['view'], tab: 'planning' },
    ],
  },

  // 6. Budget & Planning — Page level & Tab level access
  {
    key: 'budget',
    label: 'Budget & Planning',
    icon: 'ClipboardList',
    path: '/budget',
    tabs: [
      { key: 'budget-actual', label: 'Budget vs Actual' },
      { key: 'budget-settings', label: 'Budget Settings' },
      { key: 'profit-planning-treatment', label: 'Profit Planning by Treatment' },
    ],
    cards: [
      { key: 'page_access', label: 'Budget & Planning Page', actions: ['view'] },
      { key: 'budget_actual_tab', label: 'Budget vs Actual', actions: ['view'], tab: 'budget-actual' },
      { key: 'budget_settings_tab', label: 'Budget Settings', actions: ['view', 'update', 'export'], tab: 'budget-settings' },
      { key: 'profit_planning_treatment_tab', label: 'Profit Planning by Treatment', actions: ['view', 'update'], tab: 'profit-planning-treatment' },
    ],
  },

  // 7. Locations — page level access
  {
    key: 'locations',
    label: 'Locations',
    icon: 'MapPin',
    path: '/locations',
    cards: [
      { key: 'page_access', label: 'Locations Page', actions: ['view'] },
    ],
  },

  // 8. Providers — page and tab level access per provider type
  {
    key: 'providers',
    label: 'Providers',
    icon: 'Users',
    path: '/providers/dentist',
    tabs: [
      { key: 'dentist', label: 'Associate' },
      { key: 'therapist', label: 'Therapist' },
      { key: 'hygienist', label: 'Hygienist' },
      { key: 'other', label: 'Other' },
      { key: 'profit-by-associates', label: 'Profit by Associates' },
    ],
    cards: [
      { key: 'page_access', label: 'Providers Page', actions: ['view'] },
      { key: 'dentist_tab', label: 'Associate', actions: ['view', 'add', 'update', 'delete'], tab: 'dentist' },
      { key: 'therapist_tab', label: 'Therapist', actions: ['view', 'add', 'update', 'delete'], tab: 'therapist' },
      { key: 'hygienist_tab', label: 'Hygienist', actions: ['view', 'add', 'update', 'delete'], tab: 'hygienist' },
      { key: 'other_tab', label: 'Other', actions: ['view', 'add', 'update', 'delete'], tab: 'other' },
      { key: 'profit_by_associates_tab', label: 'Profit by Associates', actions: ['view'], tab: 'profit-by-associates' },
    ],
  },

  // 9. Treatments
  {
    key: 'treatments',
    label: 'Treatments',
    icon: 'Stethoscope',
    path: '/treatments/insights',
    tabs: [
      { key: 'insights', label: 'Treatment Insights' },
      { key: 'private', label: 'Private Treatment' },
      { key: 'membership', label: 'Membership' },
      { key: 'nhs', label: 'NHS' },
      { key: 'profitability', label: 'Profitability' },
      { key: 'profit-by-treatments', label: 'Profit by Treatments' },
      { key: 'setup-treatments', label: 'Setup - Treatments' },
      { key: 'setup-steps', label: 'Setup - Steps' },
      { key: 'setup-categories', label: 'Setup - Categories' },
      { key: 'setup-products', label: 'Setup - Products & Sundries' },
      { key: 'profit-goals', label: 'Profit Goals' },
    ],
    cards: [
      // Treatment Insights — page level access
      { key: 'insights_tab', label: 'Treatment Insights', actions: ['view'], tab: 'insights' },
      // Private Treatment — page level and tab level access
      { key: 'private_tab', label: 'Private Treatment', actions: ['view'], tab: 'private' },
      // Membership — page level and upload excel access level
      { key: 'membership_tab', label: 'Membership', actions: ['view', 'import', 'delete'], tab: 'membership' },
      // NHS — page level access
      { key: 'nhs_tab', label: 'NHS', actions: ['view'], tab: 'nhs' },
      // Profitability — page level access
      { key: 'profitability_tab', label: 'Profitability', actions: ['view', 'export'], tab: 'profitability' },
      { key: 'profit_by_treatments_tab', label: 'Profit by Treatments', actions: ['view'], tab: 'profit-by-treatments' },
      // Treatment Setup — 4 sub-tabs with crud access
      { key: 'setup_treatments_tab', label: 'Treatments', actions: ['view', 'add', 'update', 'delete', 'export', 'import'], tab: 'setup-treatments' },
      { key: 'setup_steps_tab', label: 'Steps', actions: ['view', 'add', 'update', 'delete'], tab: 'setup-steps' },
      { key: 'setup_categories_tab', label: 'Categories', actions: ['view', 'add', 'update', 'delete'], tab: 'setup-categories' },
      { key: 'setup_products_tab', label: 'Products & Sundries', actions: ['view', 'add', 'update', 'delete'], tab: 'setup-products' },
      // Profit Goals — Page level and Crud level access
      { key: 'profit_goals_tab', label: 'Profit Goals', actions: ['view', 'add', 'update', 'delete'], tab: 'profit-goals' },
    ],
  },

  // 10. Specialties — page and crud level access
  {
    key: 'specialties',
    label: 'Specialties',
    icon: 'HeartPulse',
    path: '/specialties',
    cards: [
      { key: 'page_access', label: 'Specialties Page', actions: ['view', 'add', 'update', 'delete'] },
    ],
  },

  // 11. Chairs — page level & tab level and crud level access
  {
    key: 'chairs',
    label: 'Chairs',
    icon: 'Armchair',
    path: '/chairs',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'hourly-analysis', label: 'Hourly Analysis' },
      { key: 'by-chair', label: 'By Chair' },
      { key: 'trends', label: 'Trends' },
      { key: 'settings', label: 'Settings' },
      { key: 'chair-recovery-goal', label: 'Chair Recovery Goal' },
      { key: 'chair-efficiency-engine', label: 'Chair Efficiency Engine' },
    ],
    cards: [
      { key: 'page_access', label: 'Chairs Page', actions: ['view'] },
      { key: 'overview_tab', label: 'Overview', actions: ['view'], tab: 'overview' },
      { key: 'hourly_analysis_tab', label: 'Hourly Analysis', actions: ['view'], tab: 'hourly-analysis' },
      { key: 'by_chair_tab', label: 'By Chair', actions: ['view'], tab: 'by-chair' },
      { key: 'trends_tab', label: 'Trends', actions: ['view'], tab: 'trends' },
      { key: 'settings_tab', label: 'Settings', actions: ['view', 'add', 'update', 'delete'], tab: 'settings' },
      { key: 'chair_recovery_goal_tab', label: 'Chair Recovery Goal', actions: ['view', 'add', 'update'], tab: 'chair-recovery-goal' },
      { key: 'chair_efficiency_engine_tab', label: 'Chair Efficiency Engine', actions: ['view'], tab: 'chair-efficiency-engine' },
    ],
  },

  // 11b. Patients — page level access
  {
    key: 'patients',
    label: 'Patients',
    icon: 'UserCheck',
    path: '/patients',
    cards: [
      { key: 'page_access', label: 'Patients Page', actions: ['view', 'export'] },
    ],
  },

  // 12. Accounts Payable — page level & tab level & crud level access
  {
    key: 'accounts_payable',
    label: 'Accounts Payable',
    icon: 'Zap',
    path: '/accounts-payable',
    tabs: [
      { key: 'invoice-capture', label: 'Invoice Capture' },
      { key: 'all-invoices', label: 'All Invoices' },
      { key: 'email-inbox', label: 'Email Inbox' },
      { key: 'processing-queue', label: 'Processing Queue' },
      { key: 'suppliers', label: 'Suppliers' },
      { key: 'analytics', label: 'Analytics' },
    ],
    cards: [
      { key: 'page_access', label: 'Accounts Payable Page', actions: ['view'] },
      { key: 'invoice_capture_tab', label: 'Invoice Capture', actions: ['view', 'add'], tab: 'invoice-capture' },
      { key: 'all_invoices_tab', label: 'All Invoices', actions: ['view', 'add', 'delete', 'export', 'action'], tab: 'all-invoices' },
      { key: 'email_inbox_tab', label: 'Email Inbox', actions: ['view', 'action'], tab: 'email-inbox' },
      { key: 'processing_queue_tab', label: 'Processing Queue', actions: ['view', 'export', 'action'], tab: 'processing-queue' },
      { key: 'suppliers_tab', label: 'Suppliers', actions: ['view'], tab: 'suppliers' },
      { key: 'analytics_tab', label: 'Analytics', actions: ['view'], tab: 'analytics' },
    ],
  },

  // 13. Cost Impact — page & tab level access
  {
    key: 'cost_impact',
    label: 'Cost Impact',
    icon: 'Layers',
    path: '/cost-impact',
    tabs: [
      { key: 'material-costs', label: 'Material Costs' },
      { key: 'lab-fees', label: 'Lab Fees' },
      { key: 'clinician-costs', label: 'Clinician Costs' },
      { key: 'staff-costs', label: 'Staff Costs' },
      { key: 'operating-leases', label: 'Operating Leases' },
      { key: 'overhead-costs', label: 'Overhead Costs' },
    ],
    cards: [
      { key: 'page_access', label: 'Cost Impact Page', actions: ['view'] },
      { key: 'material_costs_tab', label: 'Material Costs', actions: ['view'], tab: 'material-costs' },
      { key: 'lab_fees_tab', label: 'Lab Fees', actions: ['view'], tab: 'lab-fees' },
      { key: 'clinician_costs_tab', label: 'Clinician Costs', actions: ['view'], tab: 'clinician-costs' },
      { key: 'staff_costs_tab', label: 'Staff Costs', actions: ['view'], tab: 'staff-costs' },
      { key: 'operating_leases_tab', label: 'Operating Leases', actions: ['view'], tab: 'operating-leases' },
      { key: 'overhead_costs_tab', label: 'Overhead Costs', actions: ['view'], tab: 'overhead-costs' },
      { key: 'marketing_costs_tab', label: 'Marketing Costs', actions: ['view'], tab: 'marketing-costs' },
    ],
  },

  // 14. Marketing — page level access
  {
    key: 'marketing',
    label: 'Marketing',
    icon: 'Megaphone',
    path: '/marketing',
    cards: [
      { key: 'page_access', label: 'Marketing Page', actions: ['view'] },
    ],
  },

  // 15. Reports — Page and tab level access
  {
    key: 'reports',
    label: 'Reports',
    icon: 'FileSpreadsheet',
    path: '/reports',
    tabs: [
      { key: 'profit-loss', label: 'Profit & Loss' },
      { key: 'balance-sheet', label: 'Balance Sheet' },
      { key: 'cash-flow', label: 'Cash Flow' },
    ],
    cards: [
      { key: 'page_access', label: 'Reports Page', actions: ['view', 'export'] },
      { key: 'profit_loss_tab', label: 'Profit & Loss', actions: ['view', 'export'], tab: 'profit-loss' },
      { key: 'balance_sheet_tab', label: 'Balance Sheet', actions: ['view', 'export'], tab: 'balance-sheet' },
      { key: 'cash_flow_tab', label: 'Cash Flow', actions: ['view', 'export'], tab: 'cash-flow' },
    ],
  },

  // 15b. Financial Reports — Xero/QuickBooks Balance Sheet + P&L, page and tab level access
  {
    key: 'financial_reports',
    label: 'Financial Reports',
    icon: 'FileSpreadsheet',
    path: '/financial-reports',
    tabs: [
      { key: 'profit-loss', label: 'Profit & Loss' },
      { key: 'cashflow-statement', label: 'Cash Flow Statement' },
      { key: 'balance-sheet', label: 'Balance Sheet' },
    ],
    cards: [
      { key: 'page_access', label: 'Financial Reports Page', actions: ['view', 'export'] },
      { key: 'profit_loss_tab', label: 'Profit & Loss', actions: ['view', 'export'], tab: 'profit-loss' },
      { key: 'cashflow_statement_tab', label: 'Cash Flow Statement', actions: ['view', 'export'], tab: 'cashflow-statement' },
      { key: 'balance_sheet_tab', label: 'Balance Sheet', actions: ['view', 'export'], tab: 'balance-sheet' },
    ],
  },

  // 16. Organization — page level & tab level & crud level access
  {
    key: 'organization',
    label: 'Organization',
    icon: 'Briefcase',
    path: '/organization',
    tabs: [
      { key: 'team-members', label: 'Team Members' },
      { key: 'users', label: 'Users' },
      { key: 'settings', label: 'Settings' },
      { key: 'rules', label: 'Rules' },
    ],
    cards: [
      { key: 'page_access', label: 'Organization Page', actions: ['view'] },
      { key: 'team_members_tab', label: 'Team Members', actions: ['view', 'add', 'update', 'delete'], tab: 'team-members' },
      { key: 'users_tab', label: 'Users', actions: ['view', 'add', 'update', 'delete'], tab: 'users' },
      { key: 'settings_tab', label: 'Settings', actions: ['view', 'update'], tab: 'settings' },
      { key: 'rules_tab', label: 'Rules', actions: ['view', 'add', 'update', 'delete', 'action'], tab: 'rules' },
    ],
  },

  // 17. Admin / Settings — page level & tab level & crud level access
  {
    key: 'admin_settings',
    label: 'Admin / Settings',
    icon: 'Settings',
    path: '/admin',
    tabs: [
      { key: 'modules', label: 'Modules' },
      { key: 'integrations', label: 'Integrations' },
      { key: 'general', label: 'General' },
      { key: 'notifications', label: 'Notifications' },
      { key: 'security', label: 'Security' },
      { key: 'location-region', label: 'Location & Region' },
    ],
    cards: [
      { key: 'page_access', label: 'Admin / Settings Page', actions: ['view'] },
      { key: 'modules_tab', label: 'Modules', actions: ['view', 'update'], tab: 'modules' },
      { key: 'integrations_tab', label: 'Integrations', actions: ['view', 'add', 'update', 'delete', 'sync', 'action'], tab: 'integrations' },
      { key: 'general_tab', label: 'General', actions: ['view', 'update'], tab: 'general' },
      { key: 'notifications_tab', label: 'Notifications', actions: ['view', 'update'], tab: 'notifications' },
      { key: 'security_tab', label: 'Security', actions: ['view', 'update'], tab: 'security' },
      { key: 'location_region_tab', label: 'Location & Region', actions: ['view', 'add', 'update', 'delete'], tab: 'location-region' },
    ],
  },

  // 18. EBITDA to Value
  {
    key: 'ebitda_to_value',
    label: 'EBITDA to Value',
    icon: 'Target',
    path: '/ebitda-valuation',
    tabs: [
      { key: 'enterprise-overview', label: 'Enterprise Value Overview' },
      { key: 'ebitda-bridge', label: 'EBITDA Bridge' },
      { key: 'quality-score', label: 'EBITDA Quality Score' },
      { key: 'multiple-engine', label: 'Multiple Engine' },
      { key: 'value-drivers', label: 'Value Drivers' },
      { key: 'scenario-simulator', label: 'Scenario Simulator' },
      { key: 'exit-cockpit', label: 'Exit Decision Cockpit' },
      { key: 'due-diligence', label: 'Due Diligence Engine' },
      { key: 'group-heatmap', label: 'Group Heatmap' },
      { key: 'generate-pdf', label: 'Generate PDF' },
      { key: 'settings-adjustments', label: 'Settings & Adjustments' },
    ],
    cards: [
      // Enterprise Value Overview — page & crud level access
      { key: 'enterprise_overview_tab', label: 'Enterprise Value Overview', actions: ['view', 'add', 'update', 'delete'], tab: 'enterprise-overview' },
      // EBITDA Bridge — page level access
      { key: 'ebitda_bridge_tab', label: 'EBITDA Bridge', actions: ['view'], tab: 'ebitda-bridge' },
      // EBITDA Quality Score — page & crud level access
      { key: 'quality_score_tab', label: 'EBITDA Quality Score', actions: ['view', 'add', 'update', 'delete'], tab: 'quality-score' },
      // Multiple Engine — page & crud level access
      { key: 'multiple_engine_tab', label: 'Multiple Engine', actions: ['view', 'add', 'update', 'delete'], tab: 'multiple-engine' },
      // Value Drivers — page level access
      { key: 'value_drivers_tab', label: 'Value Drivers', actions: ['view'], tab: 'value-drivers' },
      // Scenario Simulator — page level access
      { key: 'scenario_simulator_tab', label: 'Scenario Simulator', actions: ['view'], tab: 'scenario-simulator' },
      // Exit Decision Cockpit — page level access
      { key: 'exit_cockpit_tab', label: 'Exit Decision Cockpit', actions: ['view'], tab: 'exit-cockpit' },
      // Due Diligence Engine — page level access
      { key: 'due_diligence_tab', label: 'Due Diligence Engine', actions: ['view'], tab: 'due-diligence' },
      // Group Heatmap — page level access
      { key: 'group_heatmap_tab', label: 'Group Heatmap', actions: ['view'], tab: 'group-heatmap' },
      // Generate PDF — page level & export access
      { key: 'generate_pdf_tab', label: 'Generate PDF', actions: ['view', 'export'], tab: 'generate-pdf' },
      // Settings & Adjustments — page & crud level access
      { key: 'settings_adjustments_tab', label: 'Settings & Adjustments', actions: ['view', 'add', 'update', 'delete'], tab: 'settings-adjustments' },
    ],
  },

  // 19. Sync Summary — page level access
  {
    key: 'sync_summary',
    label: 'Sync Summary',
    icon: 'RefreshCw',
    path: '/sync-summary',
    cards: [
      { key: 'page_access', label: 'Sync Summary Page', actions: ['view', 'sync', 'action'] },
    ],
  },

  // 20. Team Management — page level access
  {
    key: 'team_management',
    label: 'Team Management',
    icon: 'Users',
    path: '/team',
    cards: [
      { key: 'page_access', label: 'Team Management Page', actions: ['view', 'add', 'update', 'delete'] },
    ],
  },

  // 21. Practitioner History — page level access
  {
    key: 'practitioner_history',
    label: 'Practitioner History',
    icon: 'Users',
    path: '/practitioner-history',
    cards: [
      { key: 'page_access', label: 'Practitioner History Page', actions: ['view'] },
    ],
  },

  // 21b. Practitioner Activity — page level access
  {
    key: 'practitioner_activity',
    label: 'Practitioner Activity',
    icon: 'ClipboardList',
    path: '/practitioner-activity',
    cards: [
      { key: 'page_access', label: 'Practitioner Activity Page', actions: ['view'] },
    ],
  },

  // 22. Provider Types — page level access
  {
    key: 'provider_types',
    label: 'Provider Types',
    icon: 'UserCheck',
    path: '/provider-types',
    cards: [
      { key: 'page_access', label: 'Provider Types Page', actions: ['view'] },
    ],
  },
];

// ---------- Helpers ----------

/** Get a flat list of all permission keys: { module, card, action } */
export function getAllPermissionKeys(): Array<{ module: string; card: string; action: ActionType }> {
  const result: Array<{ module: string; card: string; action: ActionType }> = [];
  for (const mod of PERMISSION_REGISTRY) {
    for (const card of mod.cards) {
      for (const action of card.actions) {
        result.push({ module: mod.key, card: card.key, action });
      }
    }
  }
  return result;
}

/** Build a permission key string for Set lookups */
export function permissionKey(module: string, card: string, action: ActionType): string {
  return `${module}:${card}:${action}`;
}

/** Find a module definition by key */
export function getModule(key: string): ModuleDefinition | undefined {
  return PERMISSION_REGISTRY.find(m => m.key === key);
}

/** Get total number of individual permissions */
export function getTotalPermissionCount(): number {
  return getAllPermissionKeys().length;
}
