import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Loader2, UserPen, Sparkles, History, ListChecks, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { usePermissions } from '@/hooks/usePermissions';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTreatmentCategories } from '@/hooks/useTreatmentCategories';
import { useTreatmentServiceSteps } from '@/hooks/useTreatmentServiceSteps';
import { TreatmentProfitabilityTab } from '@/components/treatments/TreatmentProfitabilityTab';
import { TreatmentAISuggestionsPanel } from '@/components/treatments/TreatmentAISuggestionsPanel';
import { TreatmentSuggestionHistory } from '@/components/treatments/TreatmentSuggestionHistory';
import { TreatmentAddStepsDialog } from '@/components/treatments/TreatmentAddStepsDialog';
import {
  useTreatmentPricingSuggestions,
  SuggestableField,
} from '@/hooks/useTreatmentPricingSuggestions';
import { useAIPricingSettings } from '@/hooks/useAIPricingSettings';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { Treatment, TreatmentUpdate } from '@/types/treatment';
import { toast } from 'sonner';

const TREATMENT_SELECT = `
  id, organization_id, category_id, location_id, region_id,
  treatment_name, treatment_code, description, treatment_type, type_of_treatment,
  price, private_price, nhs_price, nhs_band, duration_minutes,
  requires_followup, is_active, notes, created_at, updated_at, deleted_at,
  created_by, updated_by, no_items, average, percent_fees, hourly_rate,
  average_time_minutes, therapist_time_mins, lab_bill, lab_bill_discount,
  material_cost, therapist_pay_rate, finance_fee, external_id,
  insurance_classification, nhs_treatment_cat, nomenclature, owner,
  patient_description, patient_nomenclature, region, uda_band,
  category:treatment_categories!treatments_category_id_fkey(id, name)
`;

export default function TreatmentEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId, organization } = useOrganization();
  const queryClient = useQueryClient();
  const { categories, isLoading: isCategoriesLoading } = useTreatmentCategories();
  const { steps: allTreatmentSteps, setTreatmentSteps, isSettingTreatmentSteps } = useTreatmentServiceSteps();
  const [isAddStepsOpen, setIsAddStepsOpen] = useState(false);
  const { locations } = useLocations();
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { can } = usePermissions();
  const canUpdate = can('treatments', 'update', 'setup_treatments_tab');
  const { settings: aiPricingSettings } = useAIPricingSettings(organizationId);
  const aiSuggestions = useTreatmentPricingSuggestions(
    aiPricingSettings
      ? {
          systemPrompt: aiPricingSettings.system_prompt,
          modelName: aiPricingSettings.model_name,
          maxTokens: aiPricingSettings.max_tokens,
          webSearchEnabled: aiPricingSettings.web_search_enabled,
          webSearchToolVersion: aiPricingSettings.web_search_tool_version,
          regenerateAfterSeconds: aiPricingSettings.regenerate_after_seconds,
        }
      : undefined,
  );

  // Fetch single treatment by ID — fast, no need to load entire list
  const { data: treatment, isLoading } = useQuery({
    queryKey: ['treatment', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('treatments')
        .select(TREATMENT_SELECT)
        .eq('id', id)
        .is('deleted_at', null)
        .single();

      if (error) throw error;

      // Normalise the joined category
      let category = null;
      if (data.category) {
        const raw = Array.isArray(data.category) ? data.category[0] : data.category;
        if (raw?.id && raw?.name) category = { id: raw.id, name: raw.name };
      }
      return { ...data, category } as Treatment;
    },
    enabled: !!id,
  });

  // Update mutation — lightweight, no bulk fetch
  const updateMutation = useMutation({
    mutationFn: async ({ id: treatmentId, ...updates }: TreatmentUpdate) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await (supabase as any)
        .from('treatments')
        .update({ ...updates, updated_by: user.id })
        .eq('id', treatmentId)
        .select(TREATMENT_SELECT)
        .single();
      if (error) throw error;
      return data as Treatment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment', id] });
      queryClient.invalidateQueries({ queryKey: ['treatments'] });
    },
  });

  const [formData, setFormData] = useState({
    treatment_code: '',
    treatment_name: '',
    category_id: '' as string | null,
    price: 0,
    duration_minutes: 0,
    therapist_time_mins: 0,
    lab_bill: 0,
    lab_bill_discount: 0,
    material_cost: 0,
    percent_fees: 0,
    therapist_pay_rate: 0,
    hourly_rate: 0,
    finance_fee: 0,
    average_time_minutes: 0,
  });

  // Track which fields had AI suggestions applied during this edit session,
  // so we can log them to treatment_ai_suggested_pricing on save.
  const [appliedAIValues, setAppliedAIValues] = useState<
    Partial<Record<SuggestableField, number>>
  >({});
  const [lastApplyAction, setLastApplyAction] = useState<'single' | 'all' | null>(null);

  // Reset applied tracking when navigating to a different treatment
  useEffect(() => {
    setAppliedAIValues({});
    setLastApplyAction(null);
  }, [id]);

  // Auto-load the most recent saved AI suggestion when the treatment loads,
  // so the panel doesn't reset to "Generate Suggestions" on every visit.
  // No API call — just reads from treatment_ai_suggested_pricing.
  useEffect(() => {
    if (!treatment) return;
    const orgLocs = (locations as any[]).filter(
      (l) => l.organization_id === treatment.organization_id,
    );
    const selectedLoc = selectedLocationId
      ? orgLocs.find((l) => l.id === selectedLocationId)
      : null;
    const treatmentLoc = treatment.location_id
      ? orgLocs.find((l) => l.id === treatment.location_id)
      : null;
    const refLoc = selectedLoc || treatmentLoc;
    aiSuggestions.loadLastApplied(treatment, {
      marketArea: [refLoc?.city, refLoc?.state].filter(Boolean).join(', '),
      areaPostalCode: refLoc?.postal_code ?? null,
      areaCity: refLoc?.city ?? null,
      areaState: refLoc?.state ?? null,
      areaCountry: refLoc?.country ?? null,
      locationName: refLoc?.location_name ?? undefined,
      organizationName: organization?.name,
    });
    // Only run when the treatment id changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatment?.id]);

  useEffect(() => {
    if (treatment) {
      setFormData({
        treatment_code: treatment.treatment_code || '',
        treatment_name: treatment.treatment_name || '',
        category_id: treatment.category_id || '',
        price: treatment.price || 0,
        duration_minutes: treatment.duration_minutes || 0,
        therapist_time_mins: treatment.therapist_time_mins || 0,
        lab_bill: treatment.lab_bill || 0,
        lab_bill_discount: treatment.lab_bill_discount || 0,
        material_cost: treatment.material_cost || 0,
        percent_fees: treatment.percent_fees || 0,
        therapist_pay_rate: treatment.therapist_pay_rate || 0,
        hourly_rate: treatment.hourly_rate || 0,
        finance_fee: treatment.finance_fee || 0,
        average_time_minutes: treatment.average_time_minutes || 0,
      });
    }
  }, [treatment, categories]);

  const handleNumberChange = (field: string, value: string) => {
    const num = value === '' ? 0 : parseFloat(value);
    setFormData((prev) => ({ ...prev, [field]: isNaN(num) ? 0 : num }));
  };

  const includedSteps = treatment
    ? allTreatmentSteps.filter((s) => s.mapped_treatment_id === treatment.id)
    : [];

  const handleRemoveStep = async (stepId: string) => {
    if (!treatment) return;
    await setTreatmentSteps({ treatmentId: treatment.id, rows: [], removedStepIds: [stepId] });
  };

  const aiCurrentValues: Record<SuggestableField, number> = {
    price: formData.price,
    duration_minutes: formData.duration_minutes,
    therapist_time_mins: formData.therapist_time_mins,
    lab_bill: formData.lab_bill,
    lab_bill_discount: formData.lab_bill_discount,
    material_cost: formData.material_cost,
    percent_fees: formData.percent_fees,
    therapist_pay_rate: formData.therapist_pay_rate,
    hourly_rate: formData.hourly_rate,
    finance_fee: formData.finance_fee,
    average_time_minutes: formData.average_time_minutes,
  };

  const handleGenerateAI = (force = false) => {
    console.debug('[ai-pricing] handleGenerateAI clicked', {
      hasTreatment: !!treatment,
      treatmentId: treatment?.id,
      force,
    });
    if (!treatment) {
      console.warn('[ai-pricing] handleGenerateAI bailed — treatment is null');
      return;
    }

    const orgLocations = (locations as any[]).filter(
      (l) => l.organization_id === treatment.organization_id,
    );
    const selectedLoc = selectedLocationId
      ? orgLocations.find((l) => l.id === selectedLocationId)
      : null;
    const treatmentLoc = treatment.location_id
      ? orgLocations.find((l) => l.id === treatment.location_id)
      : null;

    let peerLocationIds: string[] | null = null;
    let excludeLocationId: string | null = null;
    let scopeLabel = 'All locations';

    if (selectedLocationId) {
      peerLocationIds = orgLocations
        .filter((l) => l.id !== selectedLocationId)
        .map((l) => l.id);
      scopeLabel = `Pricing for ${selectedLoc?.location_name || 'selected location'} — peers exclude this location`;
    } else if (selectedRegionId) {
      peerLocationIds = orgLocations
        .filter((l) => l.region_id === selectedRegionId)
        .filter((l) => l.id !== treatment.location_id)
        .map((l) => l.id);
      scopeLabel = `Region scope — peers within selected region`;
    } else {
      excludeLocationId = treatment.location_id || null;
    }

    const refLoc = selectedLoc || treatmentLoc;
    const autoMarketArea = [refLoc?.city, refLoc?.state]
      .filter(Boolean)
      .join(', ');

    const locationName =
      selectedLoc?.location_name ?? treatmentLoc?.location_name ?? undefined;

    aiSuggestions.generate(
      treatment,
      aiCurrentValues,
      {
        locationName,
        organizationName: organization?.name,
        marketArea: autoMarketArea,
        peerLocationIds,
        excludeLocationId,
        scopeLabel,
        areaPostalCode: refLoc?.postal_code ?? null,
        areaCity: refLoc?.city ?? null,
        areaState: refLoc?.state ?? null,
        areaCountry: refLoc?.country ?? null,
      },
      { force },
    );
  };

  const handleApplySuggestion = (field: SuggestableField, value: number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setAppliedAIValues((prev) => ({ ...prev, [field]: value }));
    setLastApplyAction('single');
    toast.success(`Applied AI suggestion for ${field.replace(/_/g, ' ')}`);
  };

  const orgLocationsForHint = (locations as any[]).filter(
    (l) => l.organization_id === treatment?.organization_id,
  );
  const refLocationForHint =
    (selectedLocationId && orgLocationsForHint.find((l) => l.id === selectedLocationId)) ||
    (treatment?.location_id && orgLocationsForHint.find((l) => l.id === treatment.location_id)) ||
    null;
  const scopeHint = selectedLocationId
    ? `Suggesting prices for ${refLocationForHint?.location_name ?? 'selected location'} — peers exclude this location`
    : selectedRegionId
      ? 'Suggesting prices for selected region — peers within the region'
      : 'Suggesting across all locations — peers exclude this treatment’s location';

  const handleApplyAllSuggestions = () => {
    const sugs = aiSuggestions.analysis?.suggestions;
    if (!sugs) return;
    const appliedThisRun: Partial<Record<SuggestableField, number>> = {};
    setFormData((prev) => {
      const next = { ...prev };
      (Object.keys(sugs) as SuggestableField[]).forEach((field) => {
        const v = sugs[field]?.value;
        if (typeof v === 'number') {
          (next as any)[field] = v;
          appliedThisRun[field] = v;
        }
      });
      return next;
    });
    setAppliedAIValues((prev) => ({ ...prev, ...appliedThisRun }));
    setLastApplyAction('all');
    toast.success('Applied all AI suggestions');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!treatment || !formData.treatment_name.trim()) return;

    try {
      await updateMutation.mutateAsync({
        id: treatment.id,
        treatment_code: formData.treatment_code || null,
        treatment_name: formData.treatment_name,
        category_id: formData.category_id || null,
        price: formData.price,
        duration_minutes: formData.duration_minutes,
        therapist_time_mins: formData.therapist_time_mins,
        lab_bill: formData.lab_bill,
        lab_bill_discount: formData.lab_bill_discount,
        material_cost: formData.material_cost,
        percent_fees: formData.percent_fees,
        therapist_pay_rate: formData.therapist_pay_rate,
        hourly_rate: formData.hourly_rate,
        finance_fee: formData.finance_fee,
        average_time_minutes: formData.average_time_minutes,
      });

      // If the user applied any AI suggestion(s) during this edit session,
      // log a history row to treatment_ai_suggested_pricing.
      const appliedFieldNames = Object.keys(appliedAIValues) as SuggestableField[];
      if (appliedFieldNames.length > 0 && aiSuggestions.analysis) {
        const analysisData = aiSuggestions.analysis;
        const area = analysisData.areaBenchmark ?? null;
        const refLoc = selectedLocationId
          ? orgLocationsForHint.find((l) => l.id === selectedLocationId)
          : (treatment.location_id
              ? orgLocationsForHint.find((l) => l.id === treatment.location_id)
              : null);

        const { error: logError } = await (supabase as any)
          .from('treatment_ai_suggested_pricing')
          .insert({
            organization_id: treatment.organization_id,
            treatment_id: treatment.id,
            location_id: refLoc?.id ?? treatment.location_id ?? null,
            applied_by: user?.id ?? null,
            apply_action: lastApplyAction ?? 'single',
            summary: analysisData.summary ?? null,
            currency: analysisData.currency ?? null,
            scope_label: analysisData.scopeLabel ?? null,
            peer_count: analysisData.peerCount ?? 0,
            area_match_level: area?.match_level ?? null,
            area_geo_level: area?.geo_level ?? null,
            area_geo_label: area?.geo_label ?? null,
            area_clinic_count: area?.clinic_count ?? null,
            area_sample_count: area?.sample_count ?? null,
            ai_suggestions: analysisData.suggestions,
            applied_fields: appliedAIValues,
          });

        if (logError) {
          // Non-fatal — treatment already saved successfully
          console.error('[ai-pricing] history log insert failed:', logError);
        }
      }

      setAppliedAIValues({});
      setLastApplyAction(null);
      toast.success('Treatment updated successfully');
      navigate('/treatments/setup');
    } catch (error) {
      toast.error('Failed to update treatment');
    }
  };

  if (isLoading || isCategoriesLoading) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading treatment...</p>
        </div>
      </MainLayout>
    );
  }

  if (!treatment) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <p className="text-lg text-muted-foreground">Treatment not found</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/treatments/setup')}>
            Back to Treatment Setup
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Treatment - {treatment.treatment_name} - DentalPulse</title>
      </Helmet>

      <div className="space-y-6 pt-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/treatments/setup')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Treatment</h1>
        </div>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList>
            <TabsTrigger value="edit" className="gap-2">
              <UserPen className="h-4 w-4" />
              Edit Treatment
            </TabsTrigger>
            <TabsTrigger value="steps-included" className="gap-2">
              <ListChecks className="h-4 w-4" />
              Treatment List Incl.
            </TabsTrigger>
            <TabsTrigger value="profitability" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Profitability By Treatment
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              Suggestion History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="edit">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Treatment Details</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="treatment_code">Code *</Label>
                      <Input
                        id="treatment_code"
                        value={formData.treatment_code}
                        onChange={(e) =>
                          setFormData({ ...formData, treatment_code: e.target.value })
                        }
                        placeholder="Treatment code"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="treatment_name">Name *</Label>
                      <Input
                        id="treatment_name"
                        value={formData.treatment_name}
                        onChange={(e) =>
                          setFormData({ ...formData, treatment_name: e.target.value })
                        }
                        placeholder="Treatment name"
                        required
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="category_id">Category *</Label>
                      <Select
                        value={formData.category_id || ''}
                        onValueChange={(value) =>
                          setFormData({ ...formData, category_id: value || null })
                        }
                        disabled={!canUpdate}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="price">Amount *</Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => handleNumberChange('price', e.target.value)}
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="duration_minutes">Dentist Time Mins *</Label>
                      <Input
                        id="duration_minutes"
                        type="number"
                        value={formData.duration_minutes}
                        onChange={(e) =>
                          handleNumberChange('duration_minutes', e.target.value)
                        }
                        placeholder="0"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="therapist_time_mins">Therapist Time Mins *</Label>
                      <Input
                        id="therapist_time_mins"
                        type="number"
                        value={formData.therapist_time_mins}
                        onChange={(e) =>
                          handleNumberChange('therapist_time_mins', e.target.value)
                        }
                        placeholder="0"
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="lab_bill">Lab Bill</Label>
                      <Input
                        id="lab_bill"
                        type="number"
                        step="0.01"
                        value={formData.lab_bill}
                        onChange={(e) => handleNumberChange('lab_bill', e.target.value)}
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="lab_bill_discount">Lab Bill Discount</Label>
                      <Input
                        id="lab_bill_discount"
                        type="number"
                        step="0.01"
                        value={formData.lab_bill_discount}
                        onChange={(e) =>
                          handleNumberChange('lab_bill_discount', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="material_cost">Material Cost *</Label>
                      <Input
                        id="material_cost"
                        type="number"
                        step="0.01"
                        value={formData.material_cost}
                        onChange={(e) =>
                          handleNumberChange('material_cost', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="percent_fees">Associate Pay (%) *</Label>
                      <Input
                        id="percent_fees"
                        type="number"
                        step="0.01"
                        value={formData.percent_fees}
                        onChange={(e) =>
                          handleNumberChange('percent_fees', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="therapist_pay_rate">Therapist Pay Rate *</Label>
                      <Input
                        id="therapist_pay_rate"
                        type="number"
                        step="0.01"
                        value={formData.therapist_pay_rate}
                        onChange={(e) =>
                          handleNumberChange('therapist_pay_rate', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="hourly_rate">
                        Operating Cost Per Surgery Per Hour *
                      </Label>
                      <Input
                        id="hourly_rate"
                        type="number"
                        step="0.01"
                        value={formData.hourly_rate}
                        onChange={(e) =>
                          handleNumberChange('hourly_rate', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>

                    <div>
                      <Label htmlFor="finance_fee">Finance Fee (%) *</Label>
                      <Input
                        id="finance_fee"
                        type="number"
                        step="0.01"
                        value={formData.finance_fee}
                        onChange={(e) =>
                          handleNumberChange('finance_fee', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div>
                      <Label htmlFor="average_time_minutes">
                        Completion Time Used Mins
                      </Label>
                      <Input
                        id="average_time_minutes"
                        type="number"
                        value={formData.average_time_minutes}
                        onChange={(e) =>
                          handleNumberChange('average_time_minutes', e.target.value)
                        }
                        placeholder="0"
                        disabled={!canUpdate}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate('/treatments/setup')}
                      disabled={updateMutation.isPending}
                    >
                      Cancel
                    </Button>
                    {canUpdate && (
                    <Button
                      type="submit"
                      disabled={updateMutation.isPending || !formData.treatment_name.trim()}
                    >
                      {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            <div className="lg:col-span-1">
              <TreatmentAISuggestionsPanel
                analysis={aiSuggestions.analysis}
                isLoading={aiSuggestions.isLoading}
                error={aiSuggestions.error}
                currentValues={aiCurrentValues}
                canApply={canUpdate}
                scopeHint={scopeHint}
                globalCooldownAt={aiSuggestions.globalCooldownAt}
                globalCooldownTtl={aiSuggestions.regenerateAfterSeconds}
                onGenerate={handleGenerateAI}
                onApply={handleApplySuggestion}
                onApplyAll={handleApplyAllSuggestions}
              />
            </div>
            </div>
          </TabsContent>

          <TabsContent value="steps-included">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Treatment List Incl.</CardTitle>
                {canUpdate && (
                  <Button size="sm" className="gap-2" onClick={() => setIsAddStepsOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Add Steps
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border-r border-b border-black">Step Code</TableHead>
                        <TableHead className="border-r border-b border-black">Step Name</TableHead>
                        <TableHead className="text-center border-r border-b border-black">Is Main Treatment</TableHead>
                        <TableHead className="text-right border-r border-b border-black">Completion Time (mins)</TableHead>
                        {canUpdate && <TableHead className="text-center border-r border-b border-black">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {includedSteps.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={canUpdate ? 5 : 4} className="text-center py-8 text-muted-foreground border-r border-b border-black">
                            No steps added yet. Click "Add Steps" to build this treatment's step list.
                          </TableCell>
                        </TableRow>
                      ) : (
                        includedSteps.map((step) => (
                          <TableRow key={step.id}>
                            <TableCell className="border-r border-b border-black">{step.service_code || '-'}</TableCell>
                            <TableCell className="font-medium border-r border-b border-black">{step.service_name}</TableCell>
                            <TableCell className="text-center border-r border-b border-black">{step.is_main_treatment_step ? 'Yes' : 'No'}</TableCell>
                            <TableCell className="text-right border-r border-b border-black">{step.completion_time_used_mins ?? '-'}</TableCell>
                            {canUpdate && (
                              <TableCell className="text-center border-r border-b border-black">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveStep(step.id)}
                                  disabled={isSettingTreatmentSteps}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {treatment && (
              <TreatmentAddStepsDialog
                open={isAddStepsOpen}
                onOpenChange={setIsAddStepsOpen}
                treatment={treatment}
                allSteps={allTreatmentSteps}
                onSave={async (rows, removedStepIds) => {
                  await setTreatmentSteps({ treatmentId: treatment.id, rows, removedStepIds });
                }}
                isSaving={isSettingTreatmentSteps}
              />
            )}
          </TabsContent>

          <TabsContent value="profitability">
            <TreatmentProfitabilityTab treatment={treatment} />
          </TabsContent>

          <TabsContent value="history">
            <TreatmentSuggestionHistory
              treatmentId={treatment.id}
              onReapply={(fieldValues) => {
                // Mirror the apply-from-history into form state and mark them
                // as AI-applied so the next Save logs them again.
                const numericValues = Object.fromEntries(
                  Object.entries(fieldValues).filter(
                    ([, v]) => typeof v === 'number',
                  ),
                ) as Partial<Record<SuggestableField, number>>;
                if (Object.keys(numericValues).length === 0) return;
                setFormData((prev) => ({ ...prev, ...numericValues }));
                setAppliedAIValues((prev) => ({ ...prev, ...numericValues }));
                setLastApplyAction('all');
                toast.success(
                  `Re-applied ${Object.keys(numericValues).length} value(s) from history`,
                );
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
