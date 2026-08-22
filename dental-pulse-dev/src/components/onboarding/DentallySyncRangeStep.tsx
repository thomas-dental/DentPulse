import { useState, useRef } from "react";
import { subMonths, format } from "date-fns";
import { DateRange } from "react-day-picker";
import { CalendarRange, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface DentallySyncRangeStepProps {
  apiKey: string;
  apiEndpoint: string;
  initialRange?: { from?: string; to?: string };
  onRangeChange: (from: string, to: string) => void;
  onBack: () => void;
  onSyncComplete?: (organizationId: string) => void;
  onSyncSuccess?: (organizationId: string) => void;
}

/**
 * Backend onboarding URL — same host logic as syncJobService.
 */
let BACKEND_URL = 'http://localhost:4000';
if (typeof window !== 'undefined' && window?.location?.hostname) {
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname.startsWith('127.');
  const isLAN = hostname.startsWith('192.168.') || hostname.startsWith('10.');
  BACKEND_URL =
    import.meta.env.VITE_SYNC_BACKEND_URL ||
    (isLocal
      ? 'http://localhost:4000'
      : isLAN
        ? ''   // Use Vite dev proxy
        : 'https://dent-enterprise-api.dentpulse.com');
}

const DentallySyncRangeStep = ({
  apiKey,
  apiEndpoint,
  initialRange,
  onRangeChange,
  onBack,
  onSyncComplete,
  onSyncSuccess,
}: DentallySyncRangeStepProps) => {
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const isConnectingRef = useRef(false);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({
    from: initialRange?.from ? new Date(initialRange.from) : subMonths(new Date(), 12),
    to: initialRange?.to ? new Date(initialRange.to) : new Date(),
  }));

  const handleRangeChange = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      onRangeChange(format(range.from, "yyyy-MM-dd"), format(range.to, "yyyy-MM-dd"));
    }
  };

  const handleConnect = async () => {
    if (isConnectingRef.current || isConnecting) return;
    if (!dateRange?.from || !dateRange?.to) {
      toast.error("Please select a from and to date for the initial sync.");
      return;
    }
    if (!user) {
      toast.error("Please sign in to continue.");
      return;
    }

    isConnectingRef.current = true;
    setIsConnecting(true);
    setStatusMessage('Validating API key...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const startDate = format(dateRange.from, "yyyy-MM-dd");
      const endDate = format(dateRange.to, "yyyy-MM-dd");

      setStatusMessage('Setting up organizations & sync...');

      const response = await fetch(`${BACKEND_URL}/api/onboard/dentally`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          api_endpoint: apiEndpoint || 'https://api.dentally.co',
          start_date: startDate,
          end_date: endDate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const result = await response.json();
      const { defaultOrgId, organizations, jobCount } = result;

      console.log(`[Dentally] Onboarding complete: ${organizations.length} orgs, ${jobCount} sync jobs, range ${startDate} to ${endDate}`);

      setSynced(true);
      setStatusMessage(null);

      toast.success(
        `Created ${organizations.length} organization${organizations.length !== 1 ? 's' : ''}! ${jobCount} sync jobs started.`,
        { duration: 4000 }
      );

      // Notify parent with the default org (first created, for navigation)
      if (onSyncComplete) onSyncComplete(defaultOrgId);
      if (onSyncSuccess) {
        setTimeout(() => onSyncSuccess(defaultOrgId), 100);
      }
    } catch (error: any) {
      console.error('Dentally connect error:', error);
      setStatusMessage(null);

      let errorMessage = 'Failed to connect. Please try again.';
      if (error.message?.includes('Invalid Dentally API key')) {
        errorMessage = 'API key is not valid. Please check your key and try again.';
      } else if (error.message?.includes('rate limit') || error.message?.includes('Rate limit')) {
        errorMessage = 'Dentally API rate limit reached. Please wait a minute and try again.';
      } else if (error.message?.includes('No Dentally sites')) {
        errorMessage = 'No Dentally sites found for this API key.';
      } else if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMessage = 'Cannot reach the server. Please check your connection.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    } finally {
      setIsConnecting(false);
      isConnectingRef.current = false;
    }
  };

  return (
    <div className="space-y-8 animate-fade-in w-full relative">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-500">
            <CalendarRange className="w-8 h-8 text-white" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Choose Your Sync Date Range</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Select the date range you'd like to import from Dentally for your first sync. You can sync additional history later from Settings.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Sync Data From <span className="text-destructive">*</span>
          </Label>
          <DateRangePicker
            dateRange={dateRange}
            onDateRangeChange={handleRangeChange}
            disabled={isConnecting || synced}
            placeholder="Pick a date range"
          />
          <p className="text-xs text-muted-foreground">
            Defaults to the last 12 months — pick a custom range if you need more or less history.
          </p>
        </div>

        {!synced ? (
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onBack}
              disabled={isConnecting}
              className="h-12 gap-2"
              size="lg"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <Button
              onClick={handleConnect}
              disabled={isConnecting || !dateRange?.from || !dateRange?.to}
              className="flex-1 h-12 gap-2"
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {statusMessage || 'Connecting...'}
                </>
              ) : (
                <>Connect & Sync</>
              )}
            </Button>
          </div>
        ) : (
          <Button
            disabled
            className="w-full h-12 gap-2 bg-green-600 hover:bg-green-600"
            size="lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            Connected - Syncing Data
          </Button>
        )}
      </div>
    </div>
  );
};

export default DentallySyncRangeStep;
