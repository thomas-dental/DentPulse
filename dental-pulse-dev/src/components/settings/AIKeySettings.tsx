import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Key, Check, Loader2, AlertCircle } from 'lucide-react';

export function AIKeySettings() {
  const { profile } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const orgId = profile?.current_organization_id;

  useEffect(() => {
    if (!orgId) return;
    loadKey();
  }, [orgId]);

  async function loadKey() {
    const { data } = await supabase
      .from('ai_org_settings')
      .select('claude_api_key')
      .eq('organization_id', orgId!)
      .single();

    if (data?.claude_api_key) {
      setHasKey(true);
      // Show masked version
      const key = data.claude_api_key;
      setApiKey(key.substring(0, 12) + '•'.repeat(20) + key.substring(key.length - 6));
    }
  }

  async function handleSave() {
    if (!orgId || !apiKey || apiKey.includes('•')) {
      toast.error('Please enter a valid API key');
      return;
    }

    const cleanedKey = apiKey.trim();
    if (!cleanedKey.startsWith('sk-ant-')) {
      toast.error('Invalid API key format — Anthropic keys start with "sk-ant-"');
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

      // Upsert via direct Supabase (service role handles this, but we use the user's key)
      const { error } = await supabase
        .from('ai_org_settings')
        .upsert({
          organization_id: orgId,
          claude_api_key: cleanedKey,
        }, { onConflict: 'organization_id' });

      if (error) throw error;

      setHasKey(true);
      const masked = cleanedKey.substring(0, 12) + '•'.repeat(20) + cleanedKey.substring(cleanedKey.length - 6);
      setApiKey(masked);
      setShowKey(false);
      toast.success(`AI API key saved (${cleanedKey.length} chars)`);
    } catch (err: any) {
      toast.error('Failed to save API key: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!orgId) return;

    setTesting(true);
    setTestResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

      const res = await fetch(`${backendUrl}/api/chatbot/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: 'hello', sessionId: null }),
      });

      if (res.ok) {
        setTestResult('success');
        toast.success('AI connection test passed!');
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult('error');
        toast.error('AI test failed: ' + (data.error || 'Unknown error'));
      }
    } catch {
      setTestResult('error');
      toast.error('AI test failed: Could not connect');
    } finally {
      setTesting(false);
    }
  }

  function handleEditKey() {
    setApiKey('');
    setShowKey(true);
    setTestResult(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          AI Configuration
        </CardTitle>
        <CardDescription>
          Configure the Anthropic Claude API key for your organisation's AI chatbot.
          This key is used for the V2 advanced chatbot with tool-use capabilities.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          {hasKey ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              <Check className="w-3 h-3 mr-1" /> Configured
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertCircle className="w-3 h-3 mr-1" /> Not configured
            </Badge>
          )}
        </div>

        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="claude-key">Claude API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="claude-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {hasKey && (
              <Button variant="outline" size="sm" onClick={handleEditKey}>
                Change
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Get your API key from{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              console.anthropic.com
            </a>
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving || !apiKey || apiKey.includes('•')}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
            Save Key
          </Button>
          {hasKey && (
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {testResult === 'success' ? '✓ Connected' : testResult === 'error' ? '✗ Failed' : 'Test Connection'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
