import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import type { PlaidVerification } from '@/hooks/usePlaidOnboarding';

interface Props {
  orgId: string;
  existing: PlaidVerification | null;
  onComplete: (v: PlaidVerification) => void;
}

export function Step1Business({ orgId, existing, onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    legalName:             existing?.legal_name             || '',
    companiesHouseNumber:  existing?.companies_house_number || '',
    tradingName:           existing?.trading_name           || '',
    address:               existing?.address                || '',
    industry:              existing?.industry               || 'Dental practice',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.legalName.trim()) {
      toast.error('Legal business name is required');
      return;
    }
    setLoading(true);
    try {
      const res = await PlaidService.saveBusinessStep({ orgId, ...form });
      toast.success(res.message || 'Business verified');
      // Fetch fresh state so wizard has the new verificationId + kyb_status
      const stateRes = await PlaidService.getOnboardingState(orgId);
      onComplete(stateRes.verification);
    } catch (e: any) {
      toast.error('Error', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Business Verification</h3>
          <p className="text-xs text-muted-foreground">Tell us about your dental practice</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="legalName">Legal Business Name <span className="text-red-500">*</span></Label>
          <Input
            id="legalName"
            placeholder="e.g. Bright Smile Dental Ltd"
            value={form.legalName}
            onChange={set('legalName')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="chNumber">Companies House Number</Label>
            <Input
              id="chNumber"
              placeholder="e.g. 12345678"
              value={form.companiesHouseNumber}
              onChange={set('companiesHouseNumber')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tradingName">Trading Name</Label>
            <Input
              id="tradingName"
              placeholder="e.g. Bright Smile Dental"
              value={form.tradingName}
              onChange={set('tradingName')}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">Business Address</Label>
          <Input
            id="address"
            placeholder="e.g. 10 Harley Street, London W1G 9PH"
            value={form.address}
            onChange={set('address')}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            value={form.industry}
            onChange={set('industry')}
          />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={loading} className="w-full gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? 'Verifying…' : 'Continue to Identity Verification →'}
      </Button>
    </div>
  );
}
