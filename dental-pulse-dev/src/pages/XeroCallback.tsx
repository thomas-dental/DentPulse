import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { SyncJobService } from '@/services/integrations/syncJobService';

type CallbackStatus = 'processing' | 'success' | 'error';

const XeroCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { organizationId } = useOrganization();
  const hasCalledCallback = useRef(false);

  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      // Prevent double execution (React StrictMode or dependency changes)
      if (hasCalledCallback.current) {
        console.log('[XeroCallback] Callback already executed, skipping...');
        return;
      }
      hasCalledCallback.current = true;

      // Get code and state from URL params
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // Handle Xero error response
      if (error) {
        console.error('Xero OAuth error:', error, errorDescription);
        setStatus('error');
        setErrorMessage(errorDescription || error || 'Authorization was denied');
        return;
      }

      // Validate required parameters
      if (!code || !state) {
        console.error('Missing code or state parameter');
        setStatus('error');
        setErrorMessage('Missing authorization parameters');
        return;
      }

      try {
        console.log('Calling xero-callback with:', { code: code?.substring(0, 10) + '...', state });

        // Call the xero-callback edge function to exchange code for tokens
        const response = await supabase.functions.invoke('xero-callback', {
          body: {
            code: code,
            state: state,
            currentOrigin: window.location.origin, // Pass current origin for dynamic redirect URI
          },
        });

        console.log('xero-callback response:', response);

        // Handle reconnection (same Xero user re-authed — tokens updated on existing integration)
        if (response.data?.reconnected) {
          console.log('Xero tokens refreshed on existing integration:', response.data.integrationId);
          // Continue with sync using the existing integration
        }

        if (response.error) {
          console.error('Edge function error:', response.error);
          // Pull the JSON body out of FunctionsHttpError so the actual Xero
          // error reaches the screen instead of "non-2xx status code".
          let detailedMsg = response.error.message || 'Failed to complete authorization';
          try {
            const ctx = (response.error as any)?.context;
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
          throw new Error(response.data?.error || response.data?.details || 'Failed to connect to Xero');
        }

        // Get organizationId from response if available, otherwise use from hook
        const orgId = response.data?.organizationId || organizationId;
        // The callback resolves the effective integration id (which may differ
        // from `state` — on a new connect the row is created during callback,
        // and on a reconnect a tenant dedupe may transfer to another row).
        const integrationId: string | undefined = response.data?.integrationId
          || (state && !state.startsWith('new:') ? state : undefined);

        // Now sync data for tenants belonging to this specific integration.
        //
        // The sync runs on the Node backend (the active sync engine), NOT in the
        // browser. The old browser-side path called https://api.xero.com directly
        // and was blocked by CORS in production ("No 'Access-Control-Allow-Origin'
        // header"). It also wrote the wrong CoA table — the backend writes
        // xero_chart_of_accounts (which the location mappings + cost pages read)
        // via UPSERT, so a reconnect preserves existing account mappings.
        if (orgId) {
          console.log('[XeroCallback] Triggering backend Xero sync for integration:', integrationId, 'orgId:', orgId);
          setSyncStatus('Syncing Chart of Accounts & Invoices...');
          const syncResult = await SyncJobService.triggerXeroFullSync(orgId, integrationId || undefined);
          if (syncResult.success) {
            console.log(`[XeroCallback] Backend sync queued (${syncResult.jobCount} job(s)).`);
          } else {
            // Non-fatal: the connection itself succeeded; the scheduler will also
            // pick up the sync. Surface a soft warning rather than failing connect.
            console.warn('[XeroCallback] Backend sync trigger failed:', syncResult.error);
          }
          setSyncStatus('');
          console.log('[XeroCallback] Connect flow complete.');
        } else {
          console.warn('[XeroCallback] No organizationId available, skipping data sync');
        }

        // Success!
        setStatus('success');
        if (response.data?.reconnected) {
          // Same Xero login re-authorised: every organisation under that login
          // (including any newly authorised one) lives on the ONE existing
          // connection — no second connection row is created. Say so, otherwise
          // it looks like the connect silently did nothing.
          toast.success('Xero connection updated', {
            description:
              'This Xero account was already connected. All of its organisations — including any you just authorised — are synced under the existing connection.',
          });
        } else {
          toast.success('Connected to Xero', {
            description: 'Your Xero account has been successfully connected and data synced.',
          });
        }

        // If opened as a popup (from onboarding or settings), notify parent and close
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'XERO_AUTH_SUCCESS', organizationId: orgId }, window.location.origin);
          setTimeout(() => window.close(), 1500);
        } else {
          // Standalone redirect fallback
          setTimeout(() => {
            navigate('/settings', { replace: true });
          }, 2000);
        }

      } catch (err: any) {
        console.error('Error completing Xero OAuth:', err);
        setStatus('error');
        setErrorMessage(err.message || 'An unexpected error occurred');
      }
    };

    handleCallback();
  }, [searchParams, navigate, organizationId]);

  const handleGoToSettings = () => {
    navigate('/settings', { replace: true });
  };

  const handleTryAgain = () => {
    navigate('/settings', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md border-border/50 shadow-xl">
        <CardHeader className="text-center">
          {status === 'processing' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <CardTitle>Syncing to Xero</CardTitle>
              <CardDescription>
                Please wait while we complete the sync...
              </CardDescription>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <CardTitle className="text-green-600">Successfully Synced!</CardTitle>
              <CardDescription>
                Your Xero account has been synced. Redirecting to settings...
              </CardDescription>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-red-600">Sync Failed</CardTitle>
              <CardDescription>
                {errorMessage || 'An error occurred while syncing to Xero'}
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'success' && (
            <Button
              onClick={handleGoToSettings}
              className="w-full"
            >
              Go to Settings
            </Button>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <Button
                onClick={handleTryAgain}
                className="w-full"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Settings
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Please check your Xero credentials and try connecting again.
              </p>
            </div>
          )}

          {status === 'processing' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>{syncStatus || 'Exchanging authorization tokens...'}</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Helmet>
        <title>Xero Accounting Integration</title>
        <meta name="description" content="Complete Xero OAuth authentication and accounting software integration configuration." />
      </Helmet>
    </div>
  );
};

export default XeroCallback;
