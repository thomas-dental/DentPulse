import { useEffect, useState } from 'react';
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
  BarChart3,
  Copy,
  ChevronDown,
  ChevronUp,
  Globe,
  Building2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useOrganization } from '@/hooks/useOrganization';
import { useQueryClient } from '@tanstack/react-query';

type CallbackStatus = 'processing' | 'success' | 'error';

interface PropertyInfo {
  accountId: string;
  accountName: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  propertyType: string;
  websiteUrl: string | null;
  measurementId: string | null;
  timezone: string | null;
  currency: string | null;
  industryCategory: string | null;
}

interface GA4ResponseData {
  success: boolean;
  message: string;
  domain: string;
  selectedProperty: PropertyInfo | null;
  allProperties: PropertyInfo[];
  rawAccountSummaries: any;
}

const GA4Callback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [responseData, setResponseData] = useState<GA4ResponseData | null>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (error) {
        setStatus('error');
        setErrorMessage(errorDescription || error || 'Authorization was denied');
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setErrorMessage('Missing authorization parameters');
        return;
      }

      try {
        const response = await supabase.functions.invoke('ga4-callback', {
          body: { code, state },
        });

        if (response.error) {
          throw new Error(response.error.message || 'Failed to complete authorization');
        }

        if (!response.data?.success) {
          throw new Error(response.data?.error || 'Failed to connect to Google Analytics');
        }

        const data = response.data as GA4ResponseData;
        setResponseData(data);
        setSelectedPropertyId(data.selectedProperty?.propertyId || null);
        setStatus('success');

        toast({
          title: 'Connected to Google Analytics 4',
          description: data.message,
        });
      } catch (err: any) {
        console.error('Error completing GA4 OAuth:', err);
        setStatus('error');
        setErrorMessage(err.message || 'An unexpected error occurred');
      }
    };

    handleCallback();
  }, [searchParams, toast]);

  const handleSelectProperty = async (property: PropertyInfo) => {
    if (!organizationId) return;

    setIsSaving(true);
    setSelectedPropertyId(property.propertyId);

    try {
      // Update the selected property in the database
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
          timezone: property.timezone,
          currency: property.currency,
          industry_category: property.industryCategory,
          property_type: property.propertyType,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId);

      if (error) throw error;

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['ga4-data', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['ga4-analytics', organizationId] });

      toast({
        title: 'Property Selected',
        description: `Now using "${property.propertyName}" for analytics.`,
      });
    } catch (err: any) {
      console.error('Error selecting property:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to select property',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoToMarketing = () => {
    navigate('/marketing', { replace: true });
  };

  const handleCopyResponse = () => {
    if (responseData) {
      navigator.clipboard.writeText(JSON.stringify(responseData, null, 2));
      toast({ title: 'Copied!', description: 'Response data copied to clipboard' });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-3xl border-border/50 shadow-xl">
        <CardHeader className="text-center">
          {status === 'processing' && (
            <>
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <CardTitle>Connecting to Google Analytics</CardTitle>
              <CardDescription>Please wait while we fetch your properties...</CardDescription>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <CardTitle className="text-green-600">Successfully Connected!</CardTitle>
              <CardDescription>{responseData?.message}</CardDescription>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-red-600">Connection Failed</CardTitle>
              <CardDescription>{errorMessage}</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {status === 'success' && responseData && (
            <>
              {/* Available Properties */}
              {responseData.allProperties.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Available GA4 Properties ({responseData.allProperties.length})
                  </h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {responseData.allProperties.map((property) => (
                      <div
                        key={property.propertyId}
                        className={`p-4 rounded-lg border transition-all cursor-pointer ${
                          selectedPropertyId === property.propertyId
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        }`}
                        onClick={() => handleSelectProperty(property)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{property.propertyName}</span>
                              {selectedPropertyId === property.propertyId && (
                                <Badge variant="default" className="text-xs">Selected</Badge>
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
                          {isSaving && selectedPropertyId === property.propertyId && (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <p>No GA4 properties found in your Google Analytics account.</p>
                  <p className="text-sm mt-2">Please create a GA4 property in Google Analytics first.</p>
                </div>
              )}

              {/* Domain Info */}
              {responseData.domain && responseData.domain !== 'not-specified' && responseData.domain !== 'auto-detected' && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <span className="text-sm text-muted-foreground">Domain: </span>
                  <Badge variant="outline">{responseData.domain}</Badge>
                </div>
              )}

              {/* Raw Response Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRawData(!showRawData)}
                className="w-full"
              >
                {showRawData ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                {showRawData ? 'Hide' : 'Show'} Raw API Response
              </Button>

              {showRawData && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={handleCopyResponse}>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                  <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto max-h-96">
                    {JSON.stringify(responseData, null, 2)}
                  </pre>
                </div>
              )}

              {/* Go to Marketing Button */}
              <Button onClick={handleGoToMarketing} className="w-full" size="lg">
                <BarChart3 className="w-4 h-4 mr-2" />
                Go to Marketing Dashboard
              </Button>
            </>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <Button onClick={() => navigate('/marketing', { replace: true })} className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Marketing
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Please try connecting again from the Marketing page.
              </p>
            </div>
          )}

          {status === 'processing' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>Fetching your GA4 properties...</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Helmet>
        <title>Google Analytics 4 Integration</title>
        <meta name="description" content="Complete GA4 OAuth authentication and account property configuration for marketing analytics integration." />
      </Helmet>
    </div>
  );
};

export default GA4Callback;
