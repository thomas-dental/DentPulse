import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, Trash2, ShieldCheck, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import type { PlaidVerification, PlaidPerson } from '@/hooks/usePlaidOnboarding';

interface Props {
  orgId: string;
  verification: PlaidVerification;
  onComplete: (v: PlaidVerification) => void;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline'; color: string }> = {
  pending:       { label: 'Pending',       variant: 'outline',   color: 'text-muted-foreground' },
  in_progress:   { label: 'In Progress',   variant: 'secondary', color: 'text-blue-600' },
  verified:      { label: 'Verified',      variant: 'default',   color: 'text-green-600' },
  failed:        { label: 'Failed',        variant: 'outline',   color: 'text-red-600' },
  manual_review: { label: 'Manual Review', variant: 'outline',   color: 'text-amber-600' },
};

export function Step2Identity({ orgId, verification, onComplete }: Props) {
  const [people,    setPeople]    = useState<PlaidPerson[]>(verification.people);
  const [showForm,  setShowForm]  = useState(people.length === 0);
  const [loading,   setLoading]   = useState<string | null>(null); // personId or 'add'
  const [form, setForm] = useState({ firstName: '', lastName: '', role: 'control_person', ownershipPercent: '100' });

  const allVerified = people.length > 0 && people.every(p => p.status === 'verified');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleAddPerson = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required');
      return;
    }
    setLoading('add');
    try {
      const res = await PlaidService.addPerson({
        orgId,
        verificationId: verification.id,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        ownershipPercent: parseFloat(form.ownershipPercent) || 100,
      });
      setPeople(p => [...p, res.person]);
      setShowForm(false);
      setForm({ firstName: '', lastName: '', role: 'control_person', ownershipPercent: '100' });
    } catch (e: any) {
      toast.error('Error', { description: e.message });
    } finally {
      setLoading(null);
    }
  };

  const handleRemovePerson = async (personId: string) => {
    setLoading(personId);
    try {
      await PlaidService.removePerson(personId);
      setPeople(p => p.filter(x => x.id !== personId));
    } catch (e: any) {
      toast.error('Error', { description: e.message });
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyPerson = async (person: PlaidPerson) => {
    setLoading(person.id);
    try {
      const tokenRes = await PlaidService.getPersonIdvToken(person.id);

      if (tokenRes.sandboxMode) {
        // Sandbox simulation — immediately submit result
        toast.info('Sandbox mode: simulating verification…');
        const resultRes = await PlaidService.submitPersonIdvResult(person.id);
        setPeople(p => p.map(x => x.id === person.id ? { ...x, status: resultRes.status } : x));
        if (resultRes.status === 'verified') toast.success('Identity verified');
        else toast.error('Verification failed (simulated)');
        return;
      }

      // Open Plaid IDV Link — for now just record the result
      // (In a full implementation, open Plaid Link with tokenRes.linkToken)
      toast.info('IDV link token received — open Plaid Link here');
    } catch (e: any) {
      toast.error('Error', { description: e.message });
    } finally {
      setLoading(null);
    }
  };

  const handleContinue = async () => {
    const stateRes = await PlaidService.getOnboardingState(orgId);
    onComplete(stateRes.verification);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Identity Verification</h3>
          <p className="text-xs text-muted-foreground">Verify all control persons and beneficial owners</p>
        </div>
      </div>

      {/* People list */}
      <div className="space-y-2">
        {people.map(person => {
          const cfg = STATUS_CONFIG[person.status] || STATUS_CONFIG.pending;
          const isThisLoading = loading === person.id;
          return (
            <div key={person.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                {person.first_name[0]}{person.last_name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{person.first_name} {person.last_name}</p>
                <p className="text-xs text-muted-foreground capitalize">{person.role.replace('_', ' ')} · {person.ownership_percent ?? 100}%</p>
              </div>
              {person.status === 'verified' ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <>
                  <Badge variant={cfg.variant} className={`text-[10px] shrink-0 ${cfg.color}`}>
                    {cfg.label}
                  </Badge>
                  <Button
                    size="sm"
                    variant={person.status === 'failed' ? 'destructive' : 'outline'}
                    className="text-xs px-2 shrink-0"
                    disabled={isThisLoading}
                    onClick={() => handleVerifyPerson(person)}
                  >
                    {isThisLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                    {person.status === 'failed' && <span className="ml-1">Retry</span>}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="px-1.5 text-muted-foreground hover:text-destructive shrink-0"
                disabled={isThisLoading}
                onClick={() => handleRemovePerson(person.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Add person form */}
      {showForm && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Person</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First Name *</Label>
              <Input placeholder="John" value={form.firstName} onChange={set('firstName')} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last Name *</Label>
              <Input placeholder="Smith" value={form.lastName} onChange={set('lastName')} className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={form.role}
                onChange={set('role')}
              >
                <option value="control_person">Control Person</option>
                <option value="beneficial_owner">Beneficial Owner</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ownership %</Label>
              <Input type="number" min="0" max="100" value={form.ownershipPercent} onChange={set('ownershipPercent')} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 gap-1" onClick={handleAddPerson} disabled={loading === 'add'}>
              {loading === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Add Person
            </Button>
            {people.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            )}
          </div>
        </div>
      )}

      {!showForm && people.length > 0 && (
        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setShowForm(true)}>
          <Plus className="w-3 h-3" /> Add Another Person
        </Button>
      )}

      {!allVerified && people.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Verify all people above before continuing.
        </div>
      )}

      <Button
        onClick={handleContinue}
        disabled={!allVerified}
        className="w-full gap-2"
      >
        Continue to Bank Connection →
      </Button>
    </div>
  );
}
