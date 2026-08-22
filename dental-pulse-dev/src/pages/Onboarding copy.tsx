import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from 'react-helmet-async';
import { Loader2, ArrowRight, ArrowLeft, SkipForward } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/hooks/useOnboarding";
import { supabase } from "@/integrations/supabase/client";
import OnboardingProgress from "@/components/onboarding/OnboardingProgress";
import DentallyIntegrationStep, { DentallyIntegrationData } from "@/components/onboarding/DentallyIntegrationStep";
import OrganizationStep, { OrganizationData } from "@/components/onboarding/OrganizationStep";
import PracticeStep, { Practice } from "@/components/onboarding/PracticeStep";
import TeamStep, { TeamMember } from "@/components/onboarding/TeamStep";
import SettingsStep, { SettingsData } from "@/components/onboarding/SettingsStep";
import CompletionStep from "@/components/onboarding/CompletionStep";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

// Steps for Dentally flow
const dentallySteps = [
  { id: 1, title: "Dentally Integration", description: "Connect & sync data" },
];

// Steps for manual (non-Dentally) flow
const manualSteps = [
  { id: 1, title: "Organization", description: "Basic information" },
  { id: 2, title: "Practices", description: "Location details" },
  { id: 3, title: "Team", description: "Add team members" },
  { id: 4, title: "Settings", description: "Configure preferences" },
  { id: 5, title: "Complete", description: "Review & finish" },
];

const initialDentallyIntegration: DentallyIntegrationData = {
  apiKey: "",
  apiEndpoint: "",
  connected: false,
  synced: false,
};

const initialOrganization: OrganizationData = {
  name: "",
  legalName: "",
  website: "",
  email: "",
  phone: "",
  address: "",
  practiceCount: "",
  employeeCount: "",
  description: "",
  logoUrl: "",
};

const initialPractice: Practice = {
  id: "practice-1",
  name: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  phone: "",
  email: "",
  chairCount: "",
  operatingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
};

const initialSettings: SettingsData = {
  fiscalYearStart: "january",
  currency: "USD",
  timezone: "America/New_York",
  dateFormat: "MM/DD/YYYY",
  defaultProviderSplit: "35",
  hygienistPayModel: "hourly",
  emailNotifications: true,
  weeklyReports: true,
  budgetAlerts: true,
  performanceAlerts: false,
  dataRetention: "7years",
  twoFactorRequired: false,
};

const Onboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading, isAuthenticated, profile } = useAuth();
  const { saveOnboarding, skipOnboarding, isSaving } = useOnboarding();
  const [currentStep, setCurrentStep] = useState(1);
  const [isAnimating, setIsAnimating] = useState(false);

  // Toggle for Dentally account - default is OFF (manual flow)
  const [hasDentallyAccount, setHasDentallyAccount] = useState(false);

  const [dentallyIntegration, setDentallyIntegration] = useState<DentallyIntegrationData>(initialDentallyIntegration);
  const [organization, setOrganization] = useState<OrganizationData>(initialOrganization);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [practices, setPractices] = useState<Practice[]>([initialPractice]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [settings, setSettings] = useState<SettingsData>(initialSettings);
  const hasRedirectedRef = useRef(false);
  const hasCheckedOnboardingRef = useRef(false);

  // Get steps based on toggle
  const steps = hasDentallyAccount ? dentallySteps : manualSteps;
  const totalSteps = steps.length;

  // Redirect to auth if not authenticated
  useEffect(() => {
    // Prevent multiple redirects
    if (hasRedirectedRef.current) {
      return;
    }

    if (!authLoading && !isAuthenticated) {
      hasRedirectedRef.current = true;
      navigate('/auth');
      return;
    }

    // Only redirect if user already has an organization AND onboarding is complete
    // Don't redirect during onboarding flow
    if (
      !authLoading && 
      isAuthenticated && 
      profile?.current_organization_id && 
      !hasRedirectedRef.current &&
      !organizationId && // Don't redirect if we're in the middle of onboarding
      !hasCheckedOnboardingRef.current // Prevent multiple checks
    ) {
      hasCheckedOnboardingRef.current = true;
      
      // Check if onboarding is actually completed before redirecting
      const checkOnboardingStatus = async () => {
        try {
          const { data: orgSettings } = await supabase
            .from('organization_settings')
            .select('onboarding_completed')
            .eq('organization_id', profile.current_organization_id)
            .maybeSingle();
          
          // Only redirect if onboarding is completed
          if (orgSettings?.onboarding_completed && !hasRedirectedRef.current) {
            hasRedirectedRef.current = true;
            navigate('/', { replace: true });
          } else {
            // Reset check flag if onboarding not completed (allow re-check on next render if needed)
            hasCheckedOnboardingRef.current = false;
          }
        } catch (error) {
          console.error('Error checking onboarding status:', error);
          hasCheckedOnboardingRef.current = false;
          // If error, don't redirect - let user continue onboarding
        }
      };
      
      checkOnboardingStatus();
    }
  }, [authLoading, isAuthenticated, navigate, profile?.current_organization_id, organizationId]);

  const handleNext = () => {
    // For Dentally flow, navigation is handled automatically
    if (hasDentallyAccount) {
      return;
    }

    // For manual flow, validate current step and move to next
    if (currentStep === 1) {
      // Validate organization data
      if (!organization.name.trim()) {
        toast({
          title: "Required Field",
          description: "Please enter your organization name.",
          variant: "destructive",
        });
        return;
      }
      if (!organization.email.trim()) {
        toast({
          title: "Required Field",
          description: "Please enter your primary email.",
          variant: "destructive",
        });
        return;
      }
    }

    if (currentStep === 2) {
      // Validate at least one practice has name, city, and state (required by backend)
      const hasValidPractice = practices.some(p => p.name.trim() && p.city.trim() && p.state.trim());
      if (!hasValidPractice) {
        toast({
          title: "Required Fields",
          description: "Please enter at least one practice with name, city, and state.",
          variant: "destructive",
        });
        return;
      }
    }

    // Step 3 (Team) and Step 4 (Settings) are optional - no validation required

    // Move to next step or complete
    if (currentStep < totalSteps) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep((prev) => prev + 1);
        setIsAnimating(false);
      }, 150);
    }
  };

  const handleBack = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep((prev) => Math.max(prev - 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  // Handle toggle change - reset step to 1 when switching flows
  const handleToggleChange = (checked: boolean) => {
    setHasDentallyAccount(checked);
    setCurrentStep(1);
    setIsAnimating(false);
  };

  const handleDentallySyncComplete = (orgId: string) => {
    setOrganizationId(orgId);
  };

  // Handle manual flow completion (without Dentally)
  const handleManualComplete = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "Please sign in to continue.",
        variant: "destructive",
      });
      return;
    }

    // Use organization data from manual form
    const organizationData = {
      name: organization.name || "My Organization",
      legalName: organization.legalName || "",
      website: organization.website || "",
      email: organization.email || user.email || "",
      phone: organization.phone || "",
      address: organization.address || "",
      practiceCount: organization.practiceCount || "",
      employeeCount: organization.employeeCount || "",
      description: organization.description || "",
      logoUrl: organization.logoUrl || "",
    };

    const success = await saveOnboarding(organizationData, practices, teamMembers, settings, null);
    if (success) {
      // Use window.location for reliable redirect to dashboard
      window.location.href = '/';
    }
  };

  const handleComplete = async (passedOrgId?: string) => {
    // Use passed orgId if available, otherwise use state
    const orgIdToUse = passedOrgId || organizationId;
    // Fetch current organization data to preserve Dentally sync data
    let organizationData = {
      name: "My Organization",
      legalName: "",
      website: "",
      email: user?.email || "",
      phone: "",
      address: "",
      practiceCount: "",
      employeeCount: "",
      description: "",
      logoUrl: "",
    };

    // If organization exists, fetch its current data to preserve Dentally sync updates
    if (orgIdToUse) {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('name, email, phone, address, logo_url')
        .eq('id', orgIdToUse)
        .single();

      if (orgData) {
        organizationData = {
          name: orgData.name || "My Organization",
          legalName: "",
          website: "",
          email: orgData.email || user?.email || "",
          phone: orgData.phone || "",
          address: orgData.address || "",
          practiceCount: "",
          employeeCount: "",
          description: "",
          logoUrl: orgData.logo_url || "",
        };
      }
    }

    const success = await saveOnboarding(organizationData, practices, teamMembers, settings, orgIdToUse);
    if (success) {
      // Use window.location for reliable redirect to dashboard
      // This ensures profile state is fresh when the page loads
      window.location.href = '/';
    }
  };

  const handleSkip = () => {
    skipOnboarding();
  };

  const renderStep = () => {
    // Dentally flow
    if (hasDentallyAccount) {
      return (
        <DentallyIntegrationStep
          data={dentallyIntegration}
          onChange={setDentallyIntegration}
          onSyncComplete={handleDentallySyncComplete}
          onSyncSuccess={(orgId) => {
            // Automatically complete onboarding after sync (skip summary step)
            handleComplete(orgId);
          }}
        />
      );
    }

    // Manual flow - all steps
    switch (currentStep) {
      case 1:
        return (
          <OrganizationStep
            data={organization}
            onChange={setOrganization}
          />
        );
      case 2:
        return (
          <PracticeStep
            practices={practices}
            onChange={setPractices}
          />
        );
      case 3:
        return (
          <TeamStep
            teamMembers={teamMembers}
            practices={practices}
            onChange={setTeamMembers}
          />
        );
      case 4:
        return (
          <SettingsStep
            data={settings}
            onChange={setSettings}
          />
        );
      case 5:
        return (
          <CompletionStep
            organizationName={organization.name}
            practiceCount={practices.filter(p => p.name.trim()).length}
            teamCount={teamMembers.length}
            onComplete={handleManualComplete}
            isLoading={isSaving}
          />
        );
      default:
        return null;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex flex-col">
      <Helmet>
        <title>Setup Wizard | Dental Pulse</title>
        <meta name="description" content="Complete initial setup of your dental practice with Dentally integration, organization details, and team configuration." />
      </Helmet>
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              {/* <Sparkles className="w-5 h-5 text-primary-foreground" /> */}
              <img src="/icons/dp-white.png" alt="DentPulse Enterprise" className="w-15 h-15" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">DentPulse Enterprise</h1>
              <p className="text-xs text-muted-foreground">Setup Wizard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              disabled={isSaving}
              className="gap-2 text-primary hover:text-primary/80"
            >
              <SkipForward className="w-4 h-4" />
              {isSaving ? 'Skipping...' : 'Skip All Step'}
            </Button>
            <p className="text-sm text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </p>
          </div>
        </div>
      </header>

      {/* Dentally Toggle - Only show on first step */}
      {currentStep === 1 && (
        <div className="py-4 px-6 border-b border-border/30 bg-muted/10">
          <div className="max-w-4xl mx-auto">
            <Card className="p-4 bg-background/50 border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src="/icons/logo-d95916a4.png"
                    alt="Dentally Logo"
                    className="h-8 w-auto object-contain"
                  />
                  <div>
                    <Label htmlFor="dentally-toggle" className="text-sm font-medium cursor-pointer">
                      Do you have a Dentally account?
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {hasDentallyAccount
                        ? "Connect your Dentally account to automatically sync your practice data"
                        : "Set up your organization manually without Dentally integration"}
                    </p>
                  </div>
                </div>
                <Switch
                  id="dentally-toggle"
                  checked={hasDentallyAccount}
                  onCheckedChange={handleToggleChange}
                />
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="py-4 px-6 border-b border-border/30 bg-muted/20">
        <OnboardingProgress steps={steps} currentStep={currentStep} />
      </div>

      {/* Content */}
      <main className="flex-1 flex justify-center py-4">
        <div className="max-w-4xl w-full mx-auto px-6">
          <div
            className={`w-full transition-all duration-150 ${
              isAnimating ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
            }`}
          >
            {renderStep()}
          </div>

          {/* Navigation Buttons - Only for Manual Flow (not on Completion step) */}
          {!hasDentallyAccount && currentStep < totalSteps && (
            <div className="flex justify-between mt-8 pt-6 border-t border-border/30">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1 || isSaving}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <Button
                onClick={handleNext}
                disabled={isSaving}
                className="gap-2"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Back button only on Completion step */}
          {!hasDentallyAccount && currentStep === totalSteps && (
            <div className="flex justify-start mt-8 pt-6 border-t border-border/30">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSaving}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
            </div>
          )}
        </div>
      </main>

    </div>
  );
};

export default Onboarding;
