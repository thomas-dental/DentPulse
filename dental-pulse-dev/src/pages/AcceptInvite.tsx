import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, XCircle, CheckCircle, LogIn } from 'lucide-react';
import { toast } from 'sonner';

interface InviteMember {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role_type: string;
  invite_status: string;
  invite_expires_at: string;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, session, loading: authLoading } = useAuth();

  const [member, setMember] = useState<InviteMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For existing users who need to sign in manually
  const [showSignIn, setShowSignIn] = useState(false);
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // 1. Fetch invite from team_members by token
  useEffect(() => {
    if (!token) { setError('Invalid invitation link.'); setLoading(false); return; }

    (async () => {
      const { data, error: fetchErr } = await (supabase as any)
        .from('team_members')
        .select('id, organization_id, name, email, role_type, invite_status, invite_expires_at')
        .eq('invite_token', token)
        .single();

      if (fetchErr || !data) {
        setError('Invitation not found or has been removed.');
        setLoading(false);
        return;
      }

      if (data.invite_status === 'accepted' || data.invite_status === 'active') {
        setAccepted(true);
        setLoading(false);
        return;
      }

      if (data.invite_status === 'cancelled') {
        setError('This invitation has been cancelled.');
        setLoading(false);
        return;
      }

      if (data.invite_expires_at && new Date(data.invite_expires_at) < new Date()) {
        setError('This invitation has expired. Please ask the organization owner to send a new one.');
        setLoading(false);
        return;
      }

      setMember(data);
      setLoading(false);
    })();
  }, [token]);

  // 2. When authenticated + invite loaded → accept automatically
  useEffect(() => {
    if (authLoading || !member) return;
    if (user && session && !accepting && !accepted) {
      acceptInvitation();
    } else if (!user && !authLoading && member) {
      // User arrived at page but not authenticated
      // This happens if they typed the URL directly or the magic link expired
      setShowSignIn(true);
    }
  }, [user, session, authLoading, member]);

  async function acceptInvitation() {
    if (!member || !user || accepting || accepted) return;
    setAccepting(true);

    try {
      // Edge Function already created user_role and set profile.current_organization_id.
      // Just mark the team_members invite as accepted and ensure user_id is linked.
      await (supabase as any)
        .from('team_members')
        .update({
          user_id: user.id,
          invite_status: 'accepted',
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', member.id);

      // Ensure profile org is set (safety net)
      await (supabase as any)
        .from('profiles')
        .update({ current_organization_id: member.organization_id })
        .eq('user_id', user.id);

      setAccepted(true);
      setAccepting(false);
      toast.success('Welcome! You\'ve joined the organization.');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      console.error('Accept invite error:', err);
      setError('Something went wrong. Please try again.');
      setAccepting(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    setSigningIn(true);

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: member.email,
      password,
    });

    if (signInErr) {
      toast.error(signInErr.message);
      setSigningIn(false);
      return;
    }

    // Auth state change will trigger acceptInvitation via useEffect
    setSigningIn(false);
    setShowSignIn(false);
  }

  // ── Render ──────────────────────────────────────────────────

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Invitation Error</h2>
            <p className="text-muted-foreground mb-6">{error}</p>
            <Button variant="outline" onClick={() => navigate('/auth')}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">You're in!</h2>
            <p className="text-muted-foreground mb-6">Your invitation has been accepted successfully.</p>
            <Button onClick={() => navigate('/auth')}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepting || (user && member)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Joining the team...</h2>
            <p className="text-muted-foreground">Setting up your access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fallback: user not authenticated, show sign-in form
  if (showSignIn && member) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in to accept invite</CardTitle>
            <CardDescription>
              Sign in with your <strong>{member.email}</strong> account to join as <strong>{member.role_type}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={member.email} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
              </div>
              <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-700" disabled={signingIn}>
                {signingIn ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                Sign In & Join
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
