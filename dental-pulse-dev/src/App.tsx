import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PermissionProtectedRoute } from "@/components/auth/PermissionProtectedRoute";
import { PlatformAdminRoute } from "@/components/auth/PlatformAdminRoute";
import { AuthProvider } from "@/hooks/useAuth";
import { FilterProvider } from "@/contexts/FilterContext";
import "@/utils/triggerSyncJob"; // Make triggerSyncJob available globally for console access
import Dashboard from "./pages/Dashboard";
import GroupDashboard from "./pages/GroupDashboard";
import GroupDashboardDesign from "./pages/GroupDashboardDesign";
import Performance from "./pages/Performance";
import LocationDetail from "./pages/LocationDetail";
import PreparingCashflowStatement from "./pages/PreparingCashflowStatement";
import CashflowForecast from "./pages/CashflowForecast";
import CashflowCfoSummary from "./pages/CashflowCfoSummary";
import CashflowGrowth from "./pages/CashflowGrowth";
import BillsToPay from "./pages/BillsToPay";
import Budget from "./pages/Budget";
import Reports from "./pages/Reports";
import FinancialReports from "./pages/FinancialReports";
import Profitability from "./pages/Profitability";
import ProfitBenchmarkAction from "./pages/ProfitBenchmarkAction";
import Tax from "./pages/Tax";
import Providers from "./pages/Providers";
import ProviderDetail from "./pages/ProviderDetail";
import ProviderActivity from "./pages/ProviderActivity";
import Treatments from "./pages/Treatments";
import TreatmentSetup from "./pages/TreatmentSetup";
import TreatmentInsights from "./pages/TreatmentInsights";
import PrivateTreatment from "./pages/PrivateTreatment";
import MembershipPerformance from "./pages/MembershipPerformance";
import TreatmentEdit from "./pages/TreatmentEdit";
import TreatmentQuickFill from "./pages/dev/TreatmentQuickFill";
import NHSContractPerformance from "./pages/NHSContractPerformance";
import NHSClaims from "./pages/NHSClaims";
import MembershipPlanDetail from "./pages/MembershipPlanDetail";
// import MembershipComparison from "./pages/MembershipComparison";
import TreatmentProfitGoals from "./pages/TreatmentProfitGoals";
import Chairs from "./pages/Chairs";
import Patients from "./pages/Patients";
import AccountsPayable from "./pages/AccountsPayable";
import ApproverInvoiceItems from "./pages/ApproverInvoiceItems";
import PublicInvoiceApproval from "./pages/PublicInvoiceApproval";
import ApproverDashboard from "./pages/ApproverDashboard";
import AcceptInvite from "./pages/AcceptInvite";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import TeamManagement from "./pages/TeamManagement";
import Auth from "./pages/Auth";
// DISABLED: already run, commented to prevent accidental use
// import ResetAllPasswords from "./pages/ResetAllPasswords";
import NotFound from "./pages/NotFound";
import LabFees from "./pages/LabFees";
import LabFeesView from "./pages/LabFeesView";
import StaffCosts from "./pages/StaffCosts";
import OperatingLeases from "./pages/OperatingLeases";
import ClinicianCosts from "./pages/ClinicianCosts";
import OverheadCosts from "./pages/OverheadCosts";
import MaterialCosts from "./pages/MaterialCosts";
import MarketingCosts from "./pages/MarketingCosts";
import Marketing from "./pages/Marketing";
import CostImpactDashboard from "./pages/CostImpactDashboard";
import Organization from "./pages/Organization";
import Locations from "./pages/Locations";
import ProviderTypes from "./pages/ProviderTypes";
import Specialties from "./pages/Specialties";
import ProvidersDentist from "./pages/ProvidersDentist";
import ProvidersTherapist from "./pages/ProvidersTherapist";
import ProvidersHygienist from "./pages/ProvidersHygienist";
import ProvidersOther from "./pages/ProvidersOther";
import ProfitPlanningByAssociates from "./pages/ProfitPlanningByAssociates";
import ProfitByAssociates from "./pages/ProfitByAssociates";
import ProfitByTreatments from "./pages/ProfitByTreatments";
import TreatmentIncomeReport from "./pages/TreatmentIncomeReport";
import XeroCallback from "./pages/XeroCallback";
import SageTest from "./pages/SageTest";
import SageDataViewer from "./pages/SageDataViewer";
import QuickBooksCallback from "./pages/QuickBooksCallback";
import { SyncSummary } from "./pages/SyncSummary";
import SetupCategories from "./pages/SetupCategories";
import AIPricingSettings from "./pages/AIPricingSettings";
import GA4Callback from "./pages/GA4Callback";
import GoogleAdsCallback from "./pages/GoogleAdsCallback";
import Notifications from "./pages/Notifications";
import OnboardingUIPreview from "./pages/OnboardingUIPreview";
// import ApiKeyChecker from "./pages/ApiKeyChecker";
import EbitdaValuation from "./pages/EbitdaValuation";
import ScenarioSimulator from "./pages/ScenarioSimulator";
import EbitdaBridge from "./pages/EbitdaBridge";
import QualityScore from "./pages/QualityScore";
import MultipleEngine from "./pages/MultipleEngine";
import GapAnalysis from "./pages/GapAnalysis";
import EbitdaSettings from "./pages/EbitdaSettings";
import ExitCockpit from "./pages/ExitCockpit";
import DueDiligence from "./pages/DueDiligence";
import GroupHeatmap from "./pages/GroupHeatmap";
import GeneratePdf from "./pages/GeneratePdf";
import RolesPermissions from "./pages/RolesPermissions";
import PractitionerHistory from "./pages/PractitionerHistory";
import PractitionerHistoryDetail from "./pages/PractitionerHistoryDetail";
import PractitionerActivityReport from "./pages/PractitionerActivityReport";
import LocationHistory from "./pages/LocationHistory";
import PlaidStatementsPage from "./pages/PlaidStatementsPage";
import CashflowScenarioStudio from "./pages/CashflowScenarioStudio";
import DentallyWebhookLogs from "./pages/DentallyWebhookLogs";
import PlatformAdminOrganizations from "./pages/PlatformAdminOrganizations";

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
          <Route path="/profitability" element={<PermissionProtectedRoute module="profitability" card="profitability_analysis"><Profitability /></PermissionProtectedRoute>} />
          <Route path="/profitability/benchmark" element={<Navigate to="/profitability" replace />} />
          <Route path="/profitability/benchmark/:category" element={<PermissionProtectedRoute module="profitability" card="profit_benchmark"><ProfitBenchmarkAction /></PermissionProtectedRoute>} />
          <Route path="/tax" element={<PermissionProtectedRoute module="tax"><Tax /></PermissionProtectedRoute>} />
          <Route path="/budget" element={<PermissionProtectedRoute module="budget"><Budget /></PermissionProtectedRoute>} />
          <Route path="/planning/associates" element={<PermissionProtectedRoute module="providers"><ProfitPlanningByAssociates /></PermissionProtectedRoute>} />
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
          <Route path="/platform-admin/organizations" element={<PlatformAdminRoute><PlatformAdminOrganizations /></PlatformAdminRoute>} />

          <Route path="/plaid/statements/:connId" element={<ProtectedRoute><PlaidStatementsPage /></ProtectedRoute>} />
          <Route path="/sage-test" element={<SageTest />} />
          <Route path="/sage-data" element={<SageDataViewer />} />
          <Route path="*" element={<NotFound />} />
          </Routes>
        </FilterProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
