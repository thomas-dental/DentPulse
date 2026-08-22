/**
 * GA4ConnectionCard Component
 * Displays GA4 connection status and allows connecting/disconnecting Google Analytics
 *
 * FLOW (same as Google Ads):
 * 1. Click "Connect Google Analytics" button
 * 2. Direct OAuth redirect (no credentials or domain needed)
 * 3. Callback fetches properties and auto-selects first one
 * 4. User can change property after connecting
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  BarChart3,
  Unlink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Globe,
} from 'lucide-react';
import { useGA4Analytics } from '@/hooks/useGA4Analytics';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

// Google "G" logo component (same as GoogleAdsConnectionCard)
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

interface GA4ConnectionCardProps {
  className?: string;
}

export function GA4ConnectionCard({ className }: GA4ConnectionCardProps) {
  const {
    connectionStatus,
    isConnected,
    credentials,
    ga4Data,
    initiateOAuth,
    disconnect,
    refreshAnalytics,
    isInitiatingOAuth,
    isDisconnecting,
  } = useGA4Analytics();

  const { session } = useAuth();
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showPropertyDialog, setShowPropertyDialog] = useState(false);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isSavingProperty, setIsSavingProperty] = useState(false);
  const [availableProperties, setAvailableProperties] = useState<any[]>([]);

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

  const handleConnectGA4 = async () => {
    await initiateOAuth();
  };

  // Fetch available GA4 properties using edge function (handles token refresh)
  const handleFetchProperties = async () => {
    if (!credentials?.id || !session?.access_token) {
      toast({
        title: 'Not Connected',
        description: 'Please connect to Google Analytics first.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoadingProperties(true);
    setShowPropertyDialog(true);

    try {
      // Call edge function to fetch properties (handles token refresh)
      const response = await supabase.functions.invoke('ga4-properties', {
        body: { integrationId: credentials.id },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch properties');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch GA4 properties');
      }

      const properties = response.data.properties || [];
      setAvailableProperties(properties);

      if (properties.length === 0) {
        toast({
          title: 'No Properties Found',
          description: 'No GA4 properties found in your Google Analytics account.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error fetching properties:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch GA4 properties.',
        variant: 'destructive',
      });
      setShowPropertyDialog(false);
    } finally {
      setIsLoadingProperties(false);
    }
  };

  // Handle selecting a different property
  const handleSelectProperty = async (property: any) => {
    if (!organizationId) return;

    setIsSavingProperty(true);

    try {
      // Update the GA4 data record with the new property
      const { error } = await (supabase as any)
        .from('platform_integration_google_analytics_data')
        .update({
          property_id: property.propertyId,
          property_name: property.propertyName,
          property_code: property.propertyCode,
          website_url: property.websiteUrl,
          measurement_id: property.measurementId,
          account_id: property.accountId,
          account_name: property.accountName,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId);

      if (error) throw error;

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['ga4-data', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['ga4-analytics', organizationId] });

      toast({
        title: 'Property Changed',
        description: `Now using "${property.propertyName}" for analytics.`,
      });

      setShowPropertyDialog(false);
    } catch (error: any) {
      console.error('Error selecting property:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to change property.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingProperty(false);
    }
  };

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Google Analytics 4</CardTitle>
                <CardDescription className="text-xs">
                  Connect to view real marketing data
                </CardDescription>
              </div>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Not Connected - Show Connect Button */}
          {connectionStatus === 'disconnected' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sign in with Google to connect your Google Analytics account.
              </p>

              <Button
                onClick={handleConnectGA4}
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
                    Connect Google Analytics
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Connecting State */}
          {connectionStatus === 'connecting' && (
            <div className="flex flex-col items-center justify-center py-6 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Connecting to Google Analytics...</p>
            </div>
          )}

          {/* Error State (when not connected) */}
          {connectionStatus === 'error' && !isConnected && (
            <div className="flex flex-col items-center justify-center py-6 space-y-3">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-muted-foreground">Failed to connect to Google Analytics</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshAnalytics()}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGA4}
                  disabled={isInitiatingOAuth}
                >
                  <GoogleLogo className="w-3 h-3 mr-1" />
                  Reconnect
                </Button>
              </div>
            </div>
          )}

          {/* Connected State - Show Data */}
          {(connectionStatus === 'connected' || connectionStatus === 'error') && isConnected && (
            <div className="space-y-4">
              {/* Domain/Property Display */}
              {ga4Data ? (
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-green-600" />
                    <div>
                      <p className="text-sm font-medium">{ga4Data.property_name || ga4Data.domain}</p>
                      {ga4Data.account_name && (
                        <p className="text-xs text-muted-foreground">
                          Account: {ga4Data.account_name}
                        </p>
                      )}
                    </div>
                  </div>
                  {ga4Data.website_url && (
                    <p className="text-xs text-muted-foreground">
                      Website: {ga4Data.website_url}
                    </p>
                  )}
                  {ga4Data.measurement_id && (
                    <p className="text-xs text-muted-foreground">
                      Measurement ID: {ga4Data.measurement_id}
                    </p>
                  )}
                  {ga4Data.property_id && (
                    <p className="text-xs text-muted-foreground">
                      Property ID: {ga4Data.property_id}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground bg-amber-500/10 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 inline mr-2 text-amber-600" />
                  Connected but no GA4 property data found.
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchProperties}
                  disabled={isLoadingProperties}
                >
                  {isLoadingProperties ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <BarChart3 className="w-3 h-3 mr-1" />
                  )}
                  Change Property
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshAnalytics()}
                  disabled={!ga4Data?.property_id}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
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
                      <AlertDialogTitle>Disconnect Google Analytics?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove your GA4 connection. You'll need to reconnect to view real
                        analytics data. Mock data will be displayed instead.
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

      {/* Property Selection Dialog */}
      <Dialog open={showPropertyDialog} onOpenChange={setShowPropertyDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select GA4 Property</DialogTitle>
            <DialogDescription>
              Choose which GA4 property to use for analytics data.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {isLoadingProperties ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading properties...</span>
              </div>
            ) : availableProperties.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {availableProperties.map((property) => (
                  <div
                    key={property.propertyId}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      ga4Data?.property_id === property.propertyId
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    }`}
                    onClick={() => handleSelectProperty(property)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{property.propertyName}</span>
                          {ga4Data?.property_id === property.propertyId && (
                            <Badge variant="default" className="text-xs">Current</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>Account: {property.accountName}</div>
                          <div>Property ID: {property.propertyId}</div>
                          {property.websiteUrl && (
                            <div className="flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {property.websiteUrl}
                            </div>
                          )}
                          {property.measurementId && (
                            <div>Measurement ID: <code className="bg-muted px-1 rounded">{property.measurementId}</code></div>
                          )}
                        </div>
                      </div>
                      {isSavingProperty && ga4Data?.property_id !== property.propertyId && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No GA4 properties found in your account.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPropertyDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
