import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// QuickBooks OAuth callback. Mirrors XeroCallback, but Phase 1 = OAuth ONLY:
// it exchanges the code for tokens (via the quickbooks-callback edge fn) and
// stops there. No Chart-of-Accounts / invoice sync yet — that's Phase 2 (no
// quickbooks_* tables exist). Intuit appends `realmId` (QBO company id) to the
// redirect; it is mandatory and forwarded to the callback fn.

type CallbackStatus = 'processing' | 'success' | 'error';

const QuickBooksCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasCalledCallback = useRef(false);

  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      if (hasCalledCallback.current) {
        console.log('[QuickBooksCallback] Callback already executed, skipping...');
        return;
      }
      hasCalledCallback.current = true;

      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const realmId = searchParams.get('realmId');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (error) {
        console.error('QuickBooks OAuth error:', error, errorDescription);
        setStatus('error');
        setErrorMessage(errorDescription || error || 'Authorization was denied');
        return;
      }

      if (!code || !state) {
        console.error('Missing code or state parameter');
        setStatus('error');
        setErrorMessage('Missing authorization parameters');
        return;
      }
      if (!realmId) {
        // Without the company id no QuickBooks API call is possible.
        console.error('Missing realmId from QuickBooks redirect');
        setStatus('error');
        setErrorMessage('QuickBooks did not return a company id (realmId). Please try connecting again.');
        return;
      }

      try {
        console.log('Calling quickbooks-callback with:', { code: code.substring(0, 10) + '...', state, realmId });

        const response = await supabase.functions.invoke('quickbooks-callback', {
          body: { code, state, realmId },
        });

        console.log('quickbooks-callback response:', response);

        if (response.data?.reconnected) {
          console.log('QuickBooks tokens refreshed on existing integration:', response.data.integrationId);
        }

        if (response.error) {
          console.error('Edge function error:', response.error);
          // Pull the JSON body out of FunctionsHttpError so the real Intuit
          // error reaches the screen instead of "non-2xx status code".
          let detailedMsg = response.error.message || 'Failed to complete authorization';
          try {
            const ctx = (response.error as { context?: { text?: () => Promise<string> } })?.context;
            if (ctx && typeof ctx.text === 'function') {
              const bodyText = await ctx.text();
              console.error('Edge function response body:', bodyText);
              try {
                const parsed = JSON.parse(bodyText);
                detailedMsg = parsed.details || parsed.error || parsed.message || detailedMsg;
              } catch {
                if (bodyText) detailedMsg = bodyText;
              }
            }
          } catch (e) {
            console.error('Could not extract error body:', e);
          }
          throw new Error(detailedMsg);
        }

        if (!response.data?.success) {
          console.error('Response data error:', response.data);
          throw new Error(response.data?.error || response.data?.details || 'Failed to connect to QuickBooks');
        }

        // Phase 1: OAuth complete. (Data sync arrives in Phase 2.)
        setStatus('success');
        toast.success('Connected to QuickBooks', {
          description: 'Your QuickBooks company has been connected.',
        });

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'QUICKBOOKS_AUTH_SUCCESS' }, window.location.origin);
          setTimeout(() => window.close(), 1500);
        } else {
          setTimeout(() => {
            navigate('/settings', { replace: true });
          }, 2000);
        }
      } catch (err) {
        console.error('Error completing QuickBooks OAuth:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  const goToSettings = () => navigate('/settings', { replace: true });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md border-border/50 shadow-xl">
        <CardHeader className="text-center">
          {status === 'processing' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <CardTitle>Connecting to QuickBooks</CardTitle>
              <CardDescription>Please wait while we complete the connection...</CardDescription>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <CardTitle className="text-green-600">Successfully Connected!</CardTitle>
              <CardDescription>
                Your QuickBooks company has been connected. Redirecting to settings...
              </CardDescription>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-red-600">Connection Failed</CardTitle>
              <CardDescription>{errorMessage || 'An error occurred while connecting to QuickBooks'}</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'success' && (
            <Button onClick={goToSettings} className="w-full">Go to Settings</Button>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <Button onClick={goToSettings} className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Settings
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Please check your QuickBooks credentials and try connecting again.
              </p>
            </div>
          )}

          {status === 'processing' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>Exchanging authorization tokens...</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Helmet>
        <title>QuickBooks Accounting Integration</title>
        <meta name="description" content="Complete QuickBooks OAuth authentication and accounting software integration configuration." />
      </Helmet>
    </div>
  );
};

export default QuickBooksCallback;
