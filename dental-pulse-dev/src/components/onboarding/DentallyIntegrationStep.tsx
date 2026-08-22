import { Key, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface DentallyIntegrationData {
  apiKey: string;
  apiEndpoint: string;
  connected: boolean; // API key validated + setup complete
  synced: boolean; // Background sync started
  syncStartDate: string; // ISO date (yyyy-MM-dd) — start of initial sync window
  syncEndDate: string; // ISO date (yyyy-MM-dd) — end of initial sync window
}

interface DentallyIntegrationStepProps {
  data: DentallyIntegrationData;
  onChange: (data: DentallyIntegrationData) => void;
  onContinue: () => void;
}

const DentallyIntegrationStep = ({ data, onChange, onContinue }: DentallyIntegrationStepProps) => {
  const updateField = (field: keyof DentallyIntegrationData, value: string | boolean) => {
    onChange({ ...data, [field]: value });
  };

  const handleContinue = () => {
    if (!data.apiKey.trim()) {
      toast.error("Please enter your Dentally API key.");
      return;
    }
    onContinue();
  };

  return (
    <div className="space-y-8 animate-fade-in w-full relative">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <img
            src="/icons/logo-d95916a4.png"
            alt="Dentally Logo"
            style={{ width: '200px', height: '100%', objectFit: 'contain' }}
          />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Connect Dentally</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Enter your Dentally API key to connect and sync your practice data.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="apiKey" className="text-sm font-medium">
            Dentally API Key <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="apiKey"
              type="password"
              placeholder="Enter your Dentally API key"
              value={data.apiKey}
              onChange={(e) => updateField("apiKey", e.target.value)}
              className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You can find your API key in your Dentally account settings
          </p>
        </div>

        {/* Continue Button — moves to the sync date range step */}
        <Button
          onClick={handleContinue}
          disabled={!data.apiKey.trim()}
          className="w-full h-12 gap-2"
          size="lg"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default DentallyIntegrationStep;
