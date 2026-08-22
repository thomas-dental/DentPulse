/**
 * GoogleAdsConnectionCard Component
 * Displays Google Ads connection status and allows connecting/disconnecting via OAuth
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Search,
  Unlink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  CreditCard,
  TrendingDown,
  MousePointer,
  Target,
} from 'lucide-react';
import { useGoogleAdsData } from '@/hooks/useGoogleAdsData';

// Google "G" logo component
const GoogleLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

interface GoogleAdsConnectionCardProps {
  className?: string;
}

export function GoogleAdsConnectionCard({ className }: GoogleAdsConnectionCardProps) {
  const {
    connectionStatus,
    isConnected,
    googleAdsData,
    analyticsData,
    isLoadingAnalytics,
    isRefreshingAnalytics,
    initiateOAuth,
    disconnect,
    refreshData,
    isInitiatingOAuth,
    isDisconnecting,
  } = useGoogleAdsData();

  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="secondary">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Connecting
          </Badge>
        );
      case 'syncing':
        return (
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Syncing
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Unlink className="w-3 h-3 mr-1" />
            Not Connected
          </Badge>
        );
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setShowDisconnectDialog(false);
  };

  const handleSignInWithGoogle = async () => {
    await initiateOAuth();
  };

  const formatCurrency = (value: number, currency: string = 'GBP') => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-GB').format(value);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Search className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">Google Ads</CardTitle>
              <CardDescription className="text-xs">
                Connect to view ad spend and campaign data
              </CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Not Connected - Show Sign in with Google Button */}
        {connectionStatus === 'disconnected' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in with Google to connect your Google Ads account.
            </p>

            <Button
              onClick={handleSignInWithGoogle}
              variant="outline"
              className="w-full bg-white hover:bg-gray-50 border-gray-300 text-gray-700"
              disabled={isInitiatingOAuth}
            >
              {isInitiatingOAuth ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <GoogleLogo className="w-4 h-4 mr-2" />
                  Connect Google Ads
                </>
              )}
            </Button>
          </div>
        )}

        {/* Connecting State */}
        {connectionStatus === 'connecting' && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Connecting to Google Ads...</p>
          </div>
        )}

        {/* Syncing State */}
        {connectionStatus === 'syncing' && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Syncing Google Ads data...</p>
            <p className="text-xs text-muted-foreground">This may take a moment</p>
          </div>
        )}

        {/* Error State (when not connected with data) */}
        {connectionStatus === 'error' && !isConnected && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-muted-foreground">Failed to sync Google Ads data</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshData()}
                disabled={isRefreshingAnalytics}
              >
                {isRefreshingAnalytics ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSignInWithGoogle}
                disabled={isInitiatingOAuth}
              >
                <GoogleLogo className="w-3 h-3 mr-1" />
                Reconnect
              </Button>
            </div>
          </div>
        )}

        {/* Connected State - Show Metrics */}
        {(connectionStatus === 'connected' || connectionStatus === 'error') && isConnected && (
          <div className="space-y-4">
            {/* Account Info */}
            {googleAdsData && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">
                    {analyticsData?.accountInfo?.accountName || googleAdsData.account_name || 'Google Ads Account'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Customer ID: {googleAdsData.customer_id}
                </p>
                {googleAdsData.last_sync_at && (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {new Date(googleAdsData.last_sync_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* Quick Metrics */}
            {(analyticsData || isLoadingAnalytics) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <CreditCard className="w-3 h-3" />
                    <span className="text-xs">Total Spend</span>
                  </div>
                  {isLoadingAnalytics ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatCurrency(analyticsData?.accountMetrics?.totalSpend || 0, analyticsData?.accountInfo?.currency || 'GBP')}
                    </p>
                  )}
                </div>

                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Target className="w-3 h-3" />
                    <span className="text-xs">Conversions</span>
                  </div>
                  {isLoadingAnalytics ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatNumber(analyticsData?.accountMetrics?.totalConversions || 0)}
                    </p>
                  )}
                </div>

                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <MousePointer className="w-3 h-3" />
                    <span className="text-xs">Clicks</span>
                  </div>
                  {isLoadingAnalytics ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatNumber(analyticsData?.accountMetrics?.totalClicks || 0)}
                    </p>
                  )}
                </div>

                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <TrendingDown className="w-3 h-3" />
                    <span className="text-xs">Cost/Conv.</span>
                  </div>
                  {isLoadingAnalytics ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatCurrency(analyticsData?.accountMetrics?.costPerConversion || 0, analyticsData?.accountInfo?.currency || 'GBP')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshData()}
                disabled={isRefreshingAnalytics}
              >
                {isRefreshingAnalytics ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Refresh
              </Button>

              <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Unlink className="w-3 h-3 mr-1" />
                    Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect Google Ads?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove your Google Ads connection. You'll need to sign in again
                      to view ad data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDisconnect}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        'Disconnect'
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
