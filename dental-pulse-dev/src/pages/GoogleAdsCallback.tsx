import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Search,
  Coins,
  Clock,
  Building2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { selectGoogleAdsAccount } from '@/services/integrations/googleAdsService';

type CallbackStatus = 'processing' | 'success' | 'selecting' | 'saving' | 'error';

interface GoogleAdsAccount {
  customerId: string;
  accountName: string;
  currency: string;
  timezone: string;
}

interface GoogleAdsSingleResponse {
  success: boolean;
  multipleAccounts?: false;
  message: string;
  integrationId: string;
  dataRecordId: string;
  organizationId: string;
  userId: string;
  customerId: string;
  hasRefreshToken: boolean;
  account: GoogleAdsAccount;
}

interface GoogleAdsMultiResponse {
  success: boolean;
  multipleAccounts: true;
  message: string;
  integrationId: string;
  organizationId: string;
  userId: string;
  hasRefreshToken: boolean;
  accounts: GoogleAdsAccount[];
}

type GoogleAdsResponseData = GoogleAdsSingleResponse | GoogleAdsMultiResponse;

const GoogleAdsCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [responseData, setResponseData] = useState<GoogleAdsResponseData | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const processedRef = useRef(false);

  useEffect(() => {
    // Prevent double execution in React StrictMode (OAuth codes are single-use)
    if (processedRef.current) return;
    processedRef.current = true;

    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // Handle OAuth errors
      if (error) {
        setStatus('error');
        if (error === 'access_denied') {
          setErrorMessage('Authorization was cancelled. Please try again.');
        } else {
          setErrorMessage(errorDescription || error || 'Authorization failed');
        }
        return;
      }

      // Validate required parameters
      if (!code || !state) {
        setStatus('error');
        setErrorMessage('Missing authorization parameters. Please try connecting again.');
        return;
      }

      try {
        // POST to backend callback endpoint
        const response = await supabase.functions.invoke('google-ads-callback', {
          body: { code, state },
        });

        // Extract the actual error from the edge function response
        if (response.error) {
          // Supabase wraps non-2xx responses — try to get actual error details from data
          const errData = response.data as any;
          const detail = errData?.error || errData?.details || response.error.message || 'Failed to complete authorization';
          console.error('Edge function error:', { error: response.error, data: response.data });
          throw new Error(detail);
        }

        const data = response.data as GoogleAdsResponseData;

        if (!data.success) {
          throw new Error((data as any).error || (data as any).details || 'Failed to connect to Google Ads');
        }

        setResponseData(data);

        if (data.multipleAccounts) {
          // Multiple accounts — let user pick
          setStatus('selecting');
          if (data.accounts.length > 0) {
            setSelectedAccountId(data.accounts[0].customerId);
          }
        } else {
          // Single account — auto-selected
          setStatus('success');

          queryClient.invalidateQueries({ queryKey: ['google-ads-credentials', data.organizationId] });
          queryClient.invalidateQueries({ queryKey: ['google-ads-data', data.organizationId] });
          queryClient.invalidateQueries({ queryKey: ['google-ads-analytics', data.organizationId] });

          toast({
            title: 'Google Ads Connected',
            description: data.message,
          });

          setTimeout(() => {
            navigate('/marketing', { replace: true });
          }, 3000);
        }
      } catch (err: any) {
        console.error('Error completing Google Ads OAuth:', err);
        setStatus('error');
        setErrorMessage(err.message || 'An unexpected error occurred');
      }
    };

    handleCallback();
  }, [searchParams, toast, queryClient, navigate]);

  const handleSelectAccount = async () => {
    if (!responseData || !responseData.multipleAccounts || !selectedAccountId) return;

    const account = responseData.accounts.find((a) => a.customerId === selectedAccountId);
    if (!account) return;

    setStatus('saving');

    try {
      const result = await selectGoogleAdsAccount(
        responseData.organizationId,
        responseData.userId,
        responseData.integrationId,
        account.customerId,
        account.accountName,
        account.currency,
        account.timezone
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to save selected account');
      }

      // Transition to success
      setResponseData({
        ...responseData,
        multipleAccounts: undefined as any,
        customerId: account.customerId,
        account,
        dataRecordId: result.data!.dataId,
        message: 'Google Ads connected successfully!',
      } as GoogleAdsSingleResponse);
      setStatus('success');

      queryClient.invalidateQueries({ queryKey: ['google-ads-credentials', responseData.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-data', responseData.organizationId] });
      queryClient.invalidateQueries({ queryKey: ['google-ads-analytics', responseData.organizationId] });

      toast({
        title: 'Google Ads Connected',
        description: `Connected to ${account.accountName}`,
      });

      setTimeout(() => {
        navigate('/marketing', { replace: true });
      }, 3000);
    } catch (err: any) {
      console.error('Error selecting account:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Failed to save selected account');
    }
  };

  const formatCustomerId = (id: string) => {
    const cleaned = id.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return id;
  };

  const handleGoToMarketing = () => {
    navigate('/marketing', { replace: true });
  };

  const handleTryAgain = () => {
    navigate('/marketing', { replace: true });
  };

  // Get the selected/connected account for success display
  const successAccount: GoogleAdsAccount | null = (() => {
    if (!responseData) return null;
    if (!responseData.multipleAccounts && 'account' in responseData) return responseData.account;
    return null;
  })();

  const successCustomerId: string = (() => {
    if (!responseData) return '';
    if (!responseData.multipleAccounts && 'customerId' in responseData) return responseData.customerId;
    return '';
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-lg border-border/50 shadow-xl">
        <CardHeader className="text-center">
          {/* Processing State */}
          {status === 'processing' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <CardTitle>Connecting to Google Ads</CardTitle>
              <CardDescription>Please wait while we detect your accounts...</CardDescription>
            </>
          )}

          {/* Account Selection State */}
          {status === 'selecting' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-8 h-8 text-blue-500" />
              </div>
              <CardTitle>Select an Account</CardTitle>
              <CardDescription>Multiple Google Ads accounts were found. Please select the one to connect.</CardDescription>
            </>
          )}

          {/* Saving State */}
          {status === 'saving' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <CardTitle>Saving Selection</CardTitle>
              <CardDescription>Connecting your selected account...</CardDescription>
            </>
          )}

          {/* Success State */}
          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <CardTitle className="text-green-600">Successfully Connected!</CardTitle>
              <CardDescription>{responseData?.message}</CardDescription>
            </>
          )}

          {/* Error State */}
          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-red-600">Connection Failed</CardTitle>
              <CardDescription className="text-red-500/80">{errorMessage}</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Account Selection Content */}
          {status === 'selecting' && responseData?.multipleAccounts && (
            <>
              <div className="space-y-2">
                {responseData.accounts.map((account) => (
                  <label
                    key={account.customerId}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedAccountId === account.customerId
                        ? 'border-blue-500 bg-blue-500/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="google-ads-account"
                      value={account.customerId}
                      checked={selectedAccountId === account.customerId}
                      onChange={() => setSelectedAccountId(account.customerId)}
                      className="accent-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{account.accountName}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {formatCustomerId(account.customerId)} &middot; {account.currency} &middot; {account.timezone}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              <Button
                onClick={handleSelectAccount}
                className="w-full"
                size="lg"
                disabled={!selectedAccountId}
              >
                Connect Selected Account
              </Button>
            </>
          )}

          {/* Success Content */}
          {status === 'success' && successAccount && (
            <>
              {/* Connected Account Info */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Connected Account</span>
                  <Badge variant="default" className="ml-auto bg-green-500/10 text-green-600">
                    Active
                  </Badge>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      Customer ID
                    </span>
                    <code className="bg-background px-2 py-1 rounded font-mono">
                      {formatCustomerId(successCustomerId)}
                    </code>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      Currency
                    </span>
                    <span>{successAccount.currency}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Timezone
                    </span>
                    <span>{successAccount.timezone}</span>
                  </div>
                </div>
              </div>

              {/* Auto-redirect notice */}
              <p className="text-sm text-center text-muted-foreground">
                Redirecting to Marketing Dashboard in a few seconds...
              </p>

              {/* Manual redirect button */}
              <Button onClick={handleGoToMarketing} className="w-full" size="lg">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go to Marketing Dashboard
              </Button>
            </>
          )}

          {/* Error Content */}
          {status === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  There was a problem connecting your Google Ads account. This could be due to:
                </p>
                <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                  <li>No Google Ads accounts associated with this Google account</li>
                  <li>Insufficient permissions</li>
                  <li>OAuth authorization was cancelled</li>
                  <li>Network connectivity issues</li>
                </ul>
              </div>

              <Button onClick={handleTryAgain} className="w-full" size="lg">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Marketing
              </Button>
            </div>
          )}

          {/* Processing Content */}
          {status === 'processing' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>Exchanging authorization code...</span>
            </div>
          )}

          {/* Saving Content */}
          {status === 'saving' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving your account selection...</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Helmet>
        <title>Google Ads Integration</title>
        <meta name="description" content="Complete Google Ads OAuth authentication and account configuration for paid advertising data sync." />
      </Helmet>
    </div>
  );
};

export default GoogleAdsCallback;
