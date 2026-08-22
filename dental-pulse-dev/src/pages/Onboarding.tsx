import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from 'react-helmet-async';
import { Loader2, ArrowRight, ArrowLeft, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/hooks/useOnboarding";
import { supabase } from "@/integrations/supabase/client";
import OnboardingProgress from "@/components/onboarding/OnboardingProgress";
import DentallyIntegrationStep, { DentallyIntegrationData } from "@/components/onboarding/DentallyIntegrationStep";
import DentallySyncRangeStep from "@/components/onboarding/DentallySyncRangeStep";
import AccountingSoftwareStep from "@/components/onboarding/AccountingSoftwareStep";
import OrganizationStep, { OrganizationData } from "@/components/onboarding/OrganizationStep";
import PracticeStep, { Practice } from "@/components/onboarding/PracticeStep";
import TeamStep, { TeamMember } from "@/components/onboarding/TeamStep";
import SettingsStep, { SettingsData } from "@/components/onboarding/SettingsStep";
import CompletionStep from "@/components/onboarding/CompletionStep";
import { Button } from "@/components/ui/button";

// Steps for Dentally flow (step 0 = card selector)
const dentallySteps = [
  { id: 0, title: "Setup",                description: "Choose your path" },
  { id: 1, title: "Dentally Integration", description: "Enter your API key" },
  { id: 2, title: "Sync Date Range",      description: "Choose data history" },
  { id: 3, title: "Accounting Software",  description: "Connect your accounting platform" },
];

// Steps for manual (non-Dentally) flow (step 0 = card selector)
const manualSteps = [
  { id: 0, title: "Setup",        description: "Choose your path" },
  { id: 1, title: "Organization", description: "Basic information" },
  { id: 2, title: "Practices",    description: "Location details" },
  { id: 3, title: "Team",         description: "Add team members" },
  { id: 4, title: "Settings",     description: "Configure preferences" },
  { id: 5, title: "Complete",     description: "Review & finish" },
];

const initialDentallyIntegration: DentallyIntegrationData = {
  apiKey: "",
  apiEndpoint: "",
  connected: false,
  synced: false,
  syncStartDate: "",
  syncEndDate: "",
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
  const [showErrors, setShowErrors] = useState(false);

  // Flow selector: null = showing card picker, 'dentally' | 'manual' = flow chosen
  const [flowSelected, setFlowSelected] = useState<'dentally' | 'manual' | null>(null);
  const hasDentallyAccount = flowSelected === 'dentally';

  const [dentallyIntegration, setDentallyIntegration] = useState<DentallyIntegrationData>(initialDentallyIntegration);
  const [organization, setOrganization] = useState<OrganizationData>(initialOrganization);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [practices, setPractices] = useState<Practice[]>([initialPractice]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [settings, setSettings] = useState<SettingsData>(initialSettings);
  const hasRedirectedRef = useRef(false);
  const hasCheckedOnboardingRef = useRef(false);

  // Pre-fill organization email and phone from user data when available
  useEffect(() => {
    if (user && !organization.email) {
      setOrganization(prev => ({
        ...prev,
        email: prev.email || user.email || "",
        phone: prev.phone || user.phone || "",
      }));
    }
  }, [user]);

  // Reset validation errors when practices or team members are added/removed
  useEffect(() => {
    setShowErrors(false);
  }, [practices.length, teamMembers.length]);

  // Get steps based on toggle (step 0 = card selector, not a form step)
  const steps = hasDentallyAccount ? dentallySteps : manualSteps;
  const totalSteps = steps.length; // includes step 0
  const formStepCount = totalSteps - 1; // actual form steps (1..n)

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
      // Validate organization data - all required fields marked with *
      const hasErrors = !organization.name.trim() || !organization.email.trim() || !organization.phone.trim() || !organization.practiceCount.trim();
      if (hasErrors) {
        setShowErrors(true);
        toast({
          title: "Required Fields",
          description: "Please fill in all required fields marked with *.",
          variant: "destructive",
        });
        return;
      }
    }

    if (currentStep === 2) {
      // Validate all practices have required fields filled
      const allPracticesValid = practices.every(p =>
        p.name.trim() &&
        p.address.trim() &&
        p.city.trim() &&
        p.zipCode.trim()
      );
      if (!allPracticesValid) {
        setShowErrors(true);
        const invalidCount = practices.filter(p =>
          !p.name.trim() || !p.address.trim() || !p.city.trim() || !p.zipCode.trim()
        ).length;
        toast({
          title: "Required Fields",
          description: `Please fill in all required fields marked with * for ${invalidCount > 1 ? `all ${invalidCount} practices` : "the practice"}.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (currentStep === 3 && teamMembers.length > 0) {
      // Validate all added team members have required fields filled (firstName, lastName, email, phone)
      const allMembersValid = teamMembers.every(m =>
        m.firstName.trim() && m.lastName.trim() && m.email.trim() && m.phone.trim()
      );
      if (!allMembersValid) {
        setShowErrors(true);
        const invalidCount = teamMembers.filter(m =>
          !m.firstName.trim() || !m.lastName.trim() || !m.email.trim() || !m.phone.trim()
        ).length;
        toast({
          title: "Required Fields",
          description: `Please fill in all required fields marked with * for ${invalidCount > 1 ? `all ${invalidCount} team members` : "the team member"}.`,
          variant: "destructive",
        });
        return;
      }
    }

    // Step 4 (Settings) is optional - no validation required

    // Move to next step or complete
    setShowErrors(false);
    if (currentStep < formStepCount) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep((prev) => prev + 1);
        setIsAnimating(false);
      }, 150);
    }
  };

  const handleBack = async () => {
    if (currentStep === 1) {
      // On step 1, go back to flow selector
      handleBackToSelector();
      return;
    }
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep((prev) => Math.max(prev - 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  // Handle flow card selection
  const handleFlowSelect = (flow: 'dentally' | 'manual') => {
    setFlowSelected(flow);
    setCurrentStep(1);
    setIsAnimating(false);
  };

  // Back to card selector
  const handleBackToSelector = () => {
    setFlowSelected(null);
    setCurrentStep(1);
    setIsAnimating(false);
  };

  const handleDentallySyncComplete = (orgId: string) => {
    setOrganizationId(orgId);
    // Advance to accounting software step
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep(3);
      setIsAnimating(false);
    }, 150);
  };

  // Advance from token entry to the sync date range step
  const handleDentallyTokenContinue = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep(2);
      setIsAnimating(false);
    }, 150);
  };

  // Return from the sync date range step to token entry
  const handleDentallyRangeBack = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep(1);
      setIsAnimating(false);
    }, 150);
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
      if (currentStep === 3 && organizationId) {
        return (
          <AccountingSoftwareStep
            organizationId={organizationId}
            onComplete={() => handleComplete(organizationId)}
          />
        );
      }
      if (currentStep === 2) {
        return (
          <DentallySyncRangeStep
            apiKey={dentallyIntegration.apiKey}
            apiEndpoint={dentallyIntegration.apiEndpoint}
            initialRange={{ from: dentallyIntegration.syncStartDate, to: dentallyIntegration.syncEndDate }}
            onRangeChange={(from, to) =>
              setDentallyIntegration((prev) => ({ ...prev, syncStartDate: from, syncEndDate: to }))
            }
            onBack={handleDentallyRangeBack}
            onSyncComplete={handleDentallySyncComplete}
            onSyncSuccess={(orgId) => {
              // Move to accounting software step instead of completing directly
              handleDentallySyncComplete(orgId);
            }}
          />
        );
      }
      return (
        <DentallyIntegrationStep
          data={dentallyIntegration}
          onChange={setDentallyIntegration}
          onContinue={handleDentallyTokenContinue}
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
            showErrors={showErrors}
          />
        );
      case 2:
        return (
          <PracticeStep
            practices={practices}
            onChange={setPractices}
            showErrors={showErrors}
          />
        );
      case 3:
        return (
          <TeamStep
            teamMembers={teamMembers}
            practices={practices}
            onChange={setTeamMembers}
            showErrors={showErrors}
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
        <title>Onboarding | DentPulse</title>
        <meta name="description" content="Complete initial setup of your dental practice with Dentally integration, organization details, and team configuration." />
      </Helmet>
      {/* Header */}      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 flex items-center justify-center mx-auto">
              {/* <Sparkles className="w-5 h-5 text-primary-foreground" /> */}
              {/* <img src="/icons/dp-white.png" alt="DentPulse Enterprise" className="w-15 h-15" /> */}
              <img
  src="https://fpqesehkowpvxraommsc.supabase.co/storage/v1/object/public/site-logo/DentPulseLogoDark.png"
  alt="DentPulse Enterprise"
  
/>
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">DentPulse Enterprise</h1>
              <p className="text-xs text-muted-foreground">Setup Wizard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {flowSelected !== null && (
              <p className="text-sm text-muted-foreground">
                Step {currentStep} of {totalSteps - 1}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/auth");
              }}
              className="gap-2 text-primary hover:text-primary/80"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Login
            </Button>
          </div>
        </div>
      </header>

      {/* Flow selector cards — shown until the user picks a path */}
      {flowSelected === null ? (
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-2xl space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">How do you manage your dental data?</h2>
              <p className="text-sm text-muted-foreground">Choose your setup path — you can always change this later from Settings.</p>
            </div>

            <div className="flex gap-5 justify-center flex-wrap">
              {[
                { id: 'dentally' as const, title: 'Yes, I use Dentally', subtitle: 'Connect your Dentally account for automatic data sync', color: '#2563EB', bg: 'rgba(37,99,235,0.08)' },
                { id: 'manual'   as const, title: "I don't use Dentally", subtitle: 'Set up your organisation manually in a few steps',     color: '#7C3AED', bg: 'rgba(124,58,237,0.08)' },
              ].map((card, i) => (
                <div
                  key={card.id}
                  onClick={() => handleFlowSelect(card.id)}
                  style={{ '--card-delay': `${i * 120}ms`, '--p-color': card.color, '--p-bg': card.bg } as React.CSSProperties}
                  className="ob-flow-card relative flex flex-col items-center gap-3 p-6 w-52 rounded-2xl border cursor-pointer"
                >
                  <div
                    className={card.id === 'dentally' ? 'w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-500' : 'w-16 h-16 rounded-2xl flex items-center justify-center'}
                    style={card.id !== 'dentally' ? { background: card.bg, border: `1.5px solid ${card.color}30` } : undefined}
                  >
                    {card.id === 'dentally'
                      ? <span className="text-2xl">🦷</span>
                      : <ClipboardList className="w-8 h-8" style={{ color: card.color }} />
                    }
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-semibold text-sm text-foreground leading-tight">{card.title}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{card.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <style>{`
            @keyframes obCardSlideUp {
              from { opacity: 0; translate: 0 16px; }
              to   { opacity: 1; translate: 0 0; }
            }
            .ob-flow-card {
              background: hsl(var(--card));
              animation: obCardSlideUp 0.45s cubic-bezier(0.22,1,0.36,1) both;
              animation-delay: var(--card-delay, 0ms);
              transition: transform .35s cubic-bezier(0.34,1.56,0.64,1), box-shadow .25s ease, border-color .25s ease, background .25s ease;
            }
            .ob-flow-card:hover {
              transform: translateY(-8px);
              background: var(--p-bg);
              border-color: var(--p-color) !important;
              box-shadow: 0 16px 40px color-mix(in srgb, var(--p-color) 18%, transparent);
            }
          `}</style>
        </div>
      ) : null}

      {/* Progress + Content — only shown after flow is selected */}
      {flowSelected !== null && <>

      {/* Progress bar — step 0 is clickable to return to card selector */}
      <div className="py-4 px-6 border-b border-border/30 bg-muted/20">
        <OnboardingProgress
          steps={steps}
          currentStep={currentStep}
          onStepClick={(stepId) => { if (stepId === 0) handleBackToSelector(); }}
        />
      </div>

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
          {!hasDentallyAccount && currentStep < formStepCount && (
            <div className="flex justify-between mt-8 pt-6 border-t border-border/30">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSaving}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                {currentStep === 1 ? 'Change setup path' : 'Back'}
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
          {!hasDentallyAccount && currentStep === formStepCount && (
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

      </>}

    </div>
  );
};

export default Onboarding;
