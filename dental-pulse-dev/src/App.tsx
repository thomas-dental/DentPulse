import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PermissionProtectedRoute } from "@/components/auth/PermissionProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import { FilterProvider } from "@/contexts/FilterContext";
import "@/utils/triggerSyncJob"; // Make triggerSyncJob available globally for console access

const Dashboard = lazy(() => import("./pages/Dashboard"));
const GroupDashboard = lazy(() => import("./pages/GroupDashboard"));
const GroupDashboardDesign = lazy(() => import("./pages/GroupDashboardDesign"));
const Performance = lazy(() => import("./pages/Performance"));
const LocationDetail = lazy(() => import("./pages/LocationDetail"));
const PreparingCashflowStatement = lazy(() => import("./pages/PreparingCashflowStatement"));
const CashflowForecast = lazy(() => import("./pages/CashflowForecast"));
const CashflowCfoSummary = lazy(() => import("./pages/CashflowCfoSummary"));
const CashflowGrowth = lazy(() => import("./pages/CashflowGrowth"));
const BillsToPay = lazy(() => import("./pages/BillsToPay"));
const Budget = lazy(() => import("./pages/Budget"));
const Reports = lazy(() => import("./pages/Reports"));
const FinancialReports = lazy(() => import("./pages/FinancialReports"));
const Profitability = lazy(() => import("./pages/Profitability"));
const ProfitBenchmarkAction = lazy(() => import("./pages/ProfitBenchmarkAction"));
const Tax = lazy(() => import("./pages/Tax"));
const Providers = lazy(() => import("./pages/Providers"));
const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
const ProviderActivity = lazy(() => import("./pages/ProviderActivity"));
const Treatments = lazy(() => import("./pages/Treatments"));
const TreatmentSetup = lazy(() => import("./pages/TreatmentSetup"));
const TreatmentInsights = lazy(() => import("./pages/TreatmentInsights"));
const PrivateTreatment = lazy(() => import("./pages/PrivateTreatment"));
const MembershipPerformance = lazy(() => import("./pages/MembershipPerformance"));
const TreatmentEdit = lazy(() => import("./pages/TreatmentEdit"));
const TreatmentQuickFill = lazy(() => import("./pages/dev/TreatmentQuickFill"));
const NHSContractPerformance = lazy(() => import("./pages/NHSContractPerformance"));
const NHSClaims = lazy(() => import("./pages/NHSClaims"));
const MembershipPlanDetail = lazy(() => import("./pages/MembershipPlanDetail"));
const TreatmentProfitGoals = lazy(() => import("./pages/TreatmentProfitGoals"));
const Chairs = lazy(() => import("./pages/Chairs"));
const Patients = lazy(() => import("./pages/Patients"));
const AccountsPayable = lazy(() => import("./pages/AccountsPayable"));
const ApproverInvoiceItems = lazy(() => import("./pages/ApproverInvoiceItems"));
const PublicInvoiceApproval = lazy(() => import("./pages/PublicInvoiceApproval"));
const ApproverDashboard = lazy(() => import("./pages/ApproverDashboard"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const LabFees = lazy(() => import("./pages/LabFees"));
const LabFeesView = lazy(() => import("./pages/LabFeesView"));
const StaffCosts = lazy(() => import("./pages/StaffCosts"));
const OperatingLeases = lazy(() => import("./pages/OperatingLeases"));
const ClinicianCosts = lazy(() => import("./pages/ClinicianCosts"));
const OverheadCosts = lazy(() => import("./pages/OverheadCosts"));
const MaterialCosts = lazy(() => import("./pages/MaterialCosts"));
const MarketingCosts = lazy(() => import("./pages/MarketingCosts"));
const Marketing = lazy(() => import("./pages/Marketing"));
const CostImpactDashboard = lazy(() => import("./pages/CostImpactDashboard"));
const Organization = lazy(() => import("./pages/Organization"));
const Locations = lazy(() => import("./pages/Locations"));
const ProviderTypes = lazy(() => import("./pages/ProviderTypes"));
const Specialties = lazy(() => import("./pages/Specialties"));
const ProvidersDentist = lazy(() => import("./pages/ProvidersDentist"));
const ProvidersTherapist = lazy(() => import("./pages/ProvidersTherapist"));
const ProvidersHygienist = lazy(() => import("./pages/ProvidersHygienist"));
const ProvidersOther = lazy(() => import("./pages/ProvidersOther"));
const ProfitPlanningByAssociates = lazy(() => import("./pages/ProfitPlanningByAssociates"));
const ProfitByAssociates = lazy(() => import("./pages/ProfitByAssociates"));
const ProfitByTreatments = lazy(() => import("./pages/ProfitByTreatments"));
const TreatmentIncomeReport = lazy(() => import("./pages/TreatmentIncomeReport"));
const XeroCallback = lazy(() => import("./pages/XeroCallback"));
const SageTest = lazy(() => import("./pages/SageTest"));
const SageDataViewer = lazy(() => import("./pages/SageDataViewer"));
const QuickBooksCallback = lazy(() => import("./pages/QuickBooksCallback"));
const SyncSummary = lazy(() =>
  import("./pages/SyncSummary").then((m) => ({ default: m.SyncSummary })),
);
const SetupCategories = lazy(() => import("./pages/SetupCategories"));
const AIPricingSettings = lazy(() => import("./pages/AIPricingSettings"));
const GA4Callback = lazy(() => import("./pages/GA4Callback"));
const GoogleAdsCallback = lazy(() => import("./pages/GoogleAdsCallback"));
const Notifications = lazy(() => import("./pages/Notifications"));
const OnboardingUIPreview = lazy(() => import("./pages/OnboardingUIPreview"));
const EbitdaValuation = lazy(() => import("./pages/EbitdaValuation"));
const ScenarioSimulator = lazy(() => import("./pages/ScenarioSimulator"));
const EbitdaBridge = lazy(() => import("./pages/EbitdaBridge"));
const QualityScore = lazy(() => import("./pages/QualityScore"));
const MultipleEngine = lazy(() => import("./pages/MultipleEngine"));
const GapAnalysis = lazy(() => import("./pages/GapAnalysis"));
const EbitdaSettings = lazy(() => import("./pages/EbitdaSettings"));
const ExitCockpit = lazy(() => import("./pages/ExitCockpit"));
const DueDiligence = lazy(() => import("./pages/DueDiligence"));
const GroupHeatmap = lazy(() => import("./pages/GroupHeatmap"));
const GeneratePdf = lazy(() => import("./pages/GeneratePdf"));
const RolesPermissions = lazy(() => import("./pages/RolesPermissions"));
const PractitionerHistory = lazy(() => import("./pages/PractitionerHistory"));
const PractitionerHistoryDetail = lazy(() => import("./pages/PractitionerHistoryDetail"));
const PractitionerActivityReport = lazy(() => import("./pages/PractitionerActivityReport"));
const LocationHistory = lazy(() => import("./pages/LocationHistory"));
const PlaidStatementsPage = lazy(() => import("./pages/PlaidStatementsPage"));
const CashflowScenarioStudio = lazy(() => import("./pages/CashflowScenarioStudio"));
const DentallyWebhookLogs = lazy(() => import("./pages/DentallyWebhookLogs"));
const PeSyncInspector = lazy(() => import("./pages/dev/PeSyncInspector"));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 min — data is fresh, no refetch needed
      gcTime: 15 * 60 * 1000,      // 15 min — keep cache longer to avoid re-fetching on back-navigation
      refetchOnWindowFocus: false,  // Don't refetch when window regains focus
      refetchOnMount: false,        // Don't refetch on mount if data is still fresh
      refetchOnReconnect: false,    // Don't refetch on network reconnect
      retry: 1,                     // Only retry failed requests once
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <AuthProvider>
        <FilterProvider>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
          {/* Public routes */}
          <Route path="/auth" element={<Auth />} />
          {/* DISABLED: already run, commented to prevent accidental use */}
          {/* <Route path="/reset-passwords" element={<ResetAllPasswords />} /> */}
          <Route path="/auth/xero/callback" element={<XeroCallback />} />
          <Route path="/auth/quickbooks/callback" element={<QuickBooksCallback />} />
          <Route path="/auth/ga4/callback" element={<GA4Callback />} />
          <Route path="/auth/google-ads/callback" element={<GoogleAdsCallback />} />
          <Route path="/onboarding-preview" element={<OnboardingUIPreview />} />
          {/* <Route path="/api-key-checker" element={<ApiKeyChecker />} /> */}
          <Route path="/approve/:invoiceId/:approverId" element={<PublicInvoiceApproval />} />
          <Route path="/approver-dashboard/:approverId" element={<ApproverDashboard />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          
          {/* Permission-protected routes — module key maps to permissionRegistry */}
          {/* Main dashboard = the new group view. The previous dashboard is kept
              unchanged and parked at /dashboard-classic. */}
          {/* Dashboard ("/") = the DYNAMIC, real-data group dashboard (this design,
              wired to live figures, using the app top bar — no duplicate header).
              The static pixel-faithful mockup stays at /group-dashboard for reference. */}
          <Route path="/" element={<PermissionProtectedRoute module="dashboard"><GroupDashboard /></PermissionProtectedRoute>} />
          <Route path="/group-dashboard" element={<GroupDashboardDesign />} />
          <Route path="/dashboard-classic" element={<PermissionProtectedRoute module="dashboard"><Dashboard /></PermissionProtectedRoute>} />
          <Route path="/performance" element={<PermissionProtectedRoute module="performance"><Performance /></PermissionProtectedRoute>} />
          <Route path="/locations/:id" element={<PermissionProtectedRoute module="locations"><LocationDetail /></PermissionProtectedRoute>} />
          <Route path="/cashflow" element={<Navigate to="/cashflow/preparing-statement" replace />} />
          <Route path="/cashflow/preparing-statement" element={<PermissionProtectedRoute module="cash_flow" card="preparing_cashflow_page"><PreparingCashflowStatement /></PermissionProtectedRoute>} />
          <Route path="/cashflow/13-week-forecast" element={<PermissionProtectedRoute module="cash_flow" card="thirteen_week_forecast"><CashflowForecast /></PermissionProtectedRoute>} />
          <Route path="/cashflow/cfo-summary" element={<PermissionProtectedRoute module="cash_flow" card="thirteen_week_forecast"><CashflowCfoSummary /></PermissionProtectedRoute>} />
          <Route path="/cashflow/bills-to-pay" element={<PermissionProtectedRoute module="cash_flow" card="bills_to_pay"><BillsToPay /></PermissionProtectedRoute>} />
          <Route path="/cashflow/growth" element={<PermissionProtectedRoute module="cash_flow" card="cashflow_growth_tab"><CashflowGrowth /></PermissionProtectedRoute>} />
          {/* URL-only module (not in sidebar): Week-0 model builder + 13-week scenario dashboard */}
          <Route path="/cashflow/scenario-studio" element={<ProtectedRoute><CashflowScenarioStudio /></ProtectedRoute>} />
          <Route path="/dev/dentally-webhook-logs" element={<ProtectedRoute><DentallyWebhookLogs /></ProtectedRoute>} />
          <Route path="/dev/pe-sync-inspector" element={<ProtectedRoute><PeSyncInspector /></ProtectedRoute>} />
          <Route path="/profitability" element={<PermissionProtectedRoute module="profitability" card="profitability_analysis"><Profitability /></PermissionProtectedRoute>} />
          <Route path="/profitability/benchmark" element={<Navigate to="/profitability" replace />} />
          <Route path="/profitability/benchmark/:category" element={<PermissionProtectedRoute module="profitability" card="profit_benchmark"><ProfitBenchmarkAction /></PermissionProtectedRoute>} />
          <Route path="/tax" element={<PermissionProtectedRoute module="tax"><Tax /></PermissionProtectedRoute>} />
          <Route path="/budget" element={<PermissionProtectedRoute module="budget"><Budget /></PermissionProtectedRoute>} />
          <Route path="/planning/associates" element={<PermissionProtectedRoute module="budget"><ProfitPlanningByAssociates /></PermissionProtectedRoute>} />
          <Route path="/locations" element={<PermissionProtectedRoute module="locations"><Locations /></PermissionProtectedRoute>} />
          <Route path="/providers/dentist" element={<PermissionProtectedRoute module="providers" card="dentist_tab"><ProvidersDentist /></PermissionProtectedRoute>} />
          <Route path="/providers/therapist" element={<PermissionProtectedRoute module="providers" card="therapist_tab"><ProvidersTherapist /></PermissionProtectedRoute>} />
          <Route path="/providers/hygienist" element={<PermissionProtectedRoute module="providers" card="hygienist_tab"><ProvidersHygienist /></PermissionProtectedRoute>} />
          <Route path="/providers/other" element={<PermissionProtectedRoute module="providers" card="other_tab"><ProvidersOther /></PermissionProtectedRoute>} />
          <Route path="/providers/profit-by-associates" element={<PermissionProtectedRoute module="providers" card="profit_by_associates_tab"><ProfitByAssociates /></PermissionProtectedRoute>} />
          <Route path="/providers/:type/:id/activity" element={<PermissionProtectedRoute module="providers"><ProviderActivity /></PermissionProtectedRoute>} />
          <Route path="/providers/:type/:id" element={<PermissionProtectedRoute module="providers"><ProviderDetail /></PermissionProtectedRoute>} />
          <Route path="/providers" element={<PermissionProtectedRoute module="providers"><Providers /></PermissionProtectedRoute>} />
          <Route path="/settings" element={<PermissionProtectedRoute module="admin_settings"><Settings /></PermissionProtectedRoute>} />
          <Route path="/treatments/insights" element={<PermissionProtectedRoute module="treatments" card="insights_tab"><TreatmentInsights /></PermissionProtectedRoute>} />
          <Route path="/treatments/private" element={<PermissionProtectedRoute module="treatments" card="private_tab"><PrivateTreatment /></PermissionProtectedRoute>} />
          <Route path="/treatments/membership/:planSlug" element={<PermissionProtectedRoute module="treatments" card="membership_tab"><MembershipPlanDetail /></PermissionProtectedRoute>} />
          {/* <Route path="/treatments/membership/comparison" element={<PermissionProtectedRoute module="treatments" card="membership_tab"><MembershipComparison /></PermissionProtectedRoute>} /> */}
          <Route path="/treatments/membership" element={<PermissionProtectedRoute module="treatments" card="membership_tab"><MembershipPerformance /></PermissionProtectedRoute>} />
          <Route path="/treatments/nhs" element={<PermissionProtectedRoute module="treatments" card="nhs_tab"><NHSContractPerformance /></PermissionProtectedRoute>} />
          <Route path="/treatments/nhs/claims" element={<PermissionProtectedRoute module="treatments" card="nhs_tab"><NHSClaims /></PermissionProtectedRoute>} />
          <Route path="/treatments/profitability" element={<Navigate to="/treatments/profit-by-treatments" replace />} />
          <Route path="/treatments/profit-by-treatments" element={<PermissionProtectedRoute module="treatments" card="profit_by_treatments_tab"><ProfitByTreatments /></PermissionProtectedRoute>} />
          <Route path="/treatments/income-report" element={<PermissionProtectedRoute module="treatments"><TreatmentIncomeReport /></PermissionProtectedRoute>} />
          <Route path="/treatments/setup" element={<PermissionProtectedRoute module="treatments" card="setup_treatments_tab"><TreatmentSetup /></PermissionProtectedRoute>} />
          <Route path="/treatments/goals" element={<PermissionProtectedRoute module="treatments" card="profit_goals_tab"><TreatmentProfitGoals /></PermissionProtectedRoute>} />
          <Route path="/treatments" element={<PermissionProtectedRoute module="treatments"><Treatments /></PermissionProtectedRoute>} />
          <Route path="/treatments/:id/edit" element={<PermissionProtectedRoute module="treatments"><TreatmentEdit /></PermissionProtectedRoute>} />
          {/* Hidden dev tool — not in nav. Direct URL only. */}
          <Route path="/dev/treatment-quick-fill" element={<PermissionProtectedRoute module="treatments"><TreatmentQuickFill /></PermissionProtectedRoute>} />
          <Route path="/chairs" element={<PermissionProtectedRoute module="chairs"><Chairs /></PermissionProtectedRoute>} />
          <Route path="/patients" element={<PermissionProtectedRoute module="patients"><Patients /></PermissionProtectedRoute>} />
          <Route path="/accounts-payable" element={<PermissionProtectedRoute module="accounts_payable"><AccountsPayable /></PermissionProtectedRoute>} />
          <Route path="/accounts-payable/approvals" element={<PermissionProtectedRoute module="accounts_payable"><ApproverInvoiceItems /></PermissionProtectedRoute>} />
          <Route path="/lab-fees" element={<PermissionProtectedRoute module="cost_impact" card="lab_fees_tab"><LabFees /></PermissionProtectedRoute>} />
          <Route path="/lab-fees/view" element={<PermissionProtectedRoute module="cost_impact" card="lab_fees_tab"><LabFeesView /></PermissionProtectedRoute>} />
          <Route path="/staff-costs" element={<PermissionProtectedRoute module="cost_impact" card="staff_costs_tab"><StaffCosts /></PermissionProtectedRoute>} />
          <Route path="/operating-leases" element={<PermissionProtectedRoute module="cost_impact" card="operating_leases_tab"><OperatingLeases /></PermissionProtectedRoute>} />
          <Route path="/clinician-costs" element={<PermissionProtectedRoute module="cost_impact" card="clinician_costs_tab"><ClinicianCosts /></PermissionProtectedRoute>} />
          <Route path="/overhead-costs" element={<PermissionProtectedRoute module="cost_impact" card="overhead_costs_tab"><OverheadCosts /></PermissionProtectedRoute>} />
          <Route path="/material-costs" element={<PermissionProtectedRoute module="cost_impact" card="material_costs_tab"><MaterialCosts /></PermissionProtectedRoute>} />
          <Route path="/marketing-costs" element={<PermissionProtectedRoute module="cost_impact" card="marketing_costs_tab"><MarketingCosts /></PermissionProtectedRoute>} />
          <Route path="/marketing" element={<PermissionProtectedRoute module="marketing"><Marketing /></PermissionProtectedRoute>} />
          <Route path="/cost-impact" element={<PermissionProtectedRoute module="cost_impact"><CostImpactDashboard /></PermissionProtectedRoute>} />
          <Route path="/reports" element={<PermissionProtectedRoute module="reports"><Reports /></PermissionProtectedRoute>} />
          <Route path="/financial-reports" element={<PermissionProtectedRoute module="financial_reports"><FinancialReports /></PermissionProtectedRoute>} />
          <Route path="/admin" element={<PermissionProtectedRoute module="admin_settings"><Settings /></PermissionProtectedRoute>} />
          <Route path="/organization" element={<PermissionProtectedRoute module="organization"><Organization /></PermissionProtectedRoute>} />
          <Route path="/provider-types" element={<PermissionProtectedRoute module="provider_types"><ProviderTypes /></PermissionProtectedRoute>} />
          <Route path="/specialties" element={<PermissionProtectedRoute module="specialties"><Specialties /></PermissionProtectedRoute>} />
          <Route path="/sync-summary" element={<PermissionProtectedRoute module="sync_summary"><SyncSummary /></PermissionProtectedRoute>} />
          <Route path="/settings/setup-categories" element={<PermissionProtectedRoute module="admin_settings"><SetupCategories /></PermissionProtectedRoute>} />
          <Route path="/settings/ai-pricing" element={<PermissionProtectedRoute module="admin_settings"><AIPricingSettings /></PermissionProtectedRoute>} />
          <Route path="/ebitda-valuation" element={<PermissionProtectedRoute module="ebitda_to_value" card="enterprise_overview_tab"><EbitdaValuation /></PermissionProtectedRoute>} />
          <Route path="/scenario-simulator" element={<PermissionProtectedRoute module="ebitda_to_value" card="scenario_simulator_tab"><ScenarioSimulator /></PermissionProtectedRoute>} />
          <Route path="/ebitda-bridge" element={<PermissionProtectedRoute module="ebitda_to_value" card="ebitda_bridge_tab"><EbitdaBridge /></PermissionProtectedRoute>} />
          <Route path="/quality-score" element={<PermissionProtectedRoute module="ebitda_to_value" card="quality_score_tab"><QualityScore /></PermissionProtectedRoute>} />
          <Route path="/multiple-engine" element={<PermissionProtectedRoute module="ebitda_to_value" card="multiple_engine_tab"><MultipleEngine /></PermissionProtectedRoute>} />

          {/* These routes don't need module permission — available to all authenticated users */}
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/team" element={<PermissionProtectedRoute module="team_management"><TeamManagement /></PermissionProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/gap-analysis" element={<PermissionProtectedRoute module="ebitda_to_value" card="value_drivers_tab"><GapAnalysis /></PermissionProtectedRoute>} />
          <Route path="/ebitda-settings" element={<PermissionProtectedRoute module="ebitda_to_value" card="settings_adjustments_tab"><EbitdaSettings /></PermissionProtectedRoute>} />
          <Route path="/exit-cockpit" element={<PermissionProtectedRoute module="ebitda_to_value" card="exit_cockpit_tab"><ExitCockpit /></PermissionProtectedRoute>} />
          <Route path="/location-history" element={<PermissionProtectedRoute module="location_history"><LocationHistory /></PermissionProtectedRoute>} />
          <Route path="/practitioner-history" element={<PermissionProtectedRoute module="practitioner_history"><PractitionerHistory /></PermissionProtectedRoute>} />
          <Route path="/practitioner-history/:id" element={<PermissionProtectedRoute module="practitioner_history"><PractitionerHistoryDetail /></PermissionProtectedRoute>} />
          <Route path="/practitioner-activity" element={<PermissionProtectedRoute module="practitioner_activity"><PractitionerActivityReport /></PermissionProtectedRoute>} />
          <Route path="/due-diligence" element={<PermissionProtectedRoute module="ebitda_to_value" card="due_diligence_tab"><DueDiligence /></PermissionProtectedRoute>} />
          <Route path="/group-heatmap" element={<PermissionProtectedRoute module="ebitda_to_value" card="group_heatmap_tab"><GroupHeatmap /></PermissionProtectedRoute>} />
          <Route path="/generate-pdf" element={<PermissionProtectedRoute module="ebitda_to_value" card="generate_pdf_tab"><GeneratePdf /></PermissionProtectedRoute>} />
          <Route path="/roles-permissions" element={<ProtectedRoute><RolesPermissions /></ProtectedRoute>} />

          <Route path="/plaid/statements/:connId" element={<ProtectedRoute><PlaidStatementsPage /></ProtectedRoute>} />
          <Route path="/sage-test" element={<SageTest />} />
          <Route path="/sage-data" element={<SageDataViewer />} />
          <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </FilterProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
