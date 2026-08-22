import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { Provider, ProviderType, ProviderInsert, ProviderUpdate } from '@/types/provider';
import { PracticeLocation, Region } from '@/types/location';
import { useProviderTypes } from '@/hooks/useProviderTypes';
import { useSpecialties } from '@/hooks/useSpecialties';
import { toast } from 'sonner';

interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: Provider | null;
  onSubmit: (data: Omit<ProviderInsert, 'organization_id'> | ProviderUpdate) => void;
  isLoading?: boolean;
  defaultType?: ProviderType;
  locations?: PracticeLocation[];
  regions?: Region[];
  defaultLocationId?: string | null;
  defaultRegionId?: string | null;
  showLocationDropdown?: boolean;
}

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
  onSubmit,
  isLoading,
  defaultType,
  locations = [],
  regions = [],
  defaultLocationId = null,
  defaultRegionId = null,
  showLocationDropdown = false,
}: ProviderFormDialogProps) {
  const isEditing = !!provider;

  // Fetch provider types and specialties from database
  const { activeProviderTypes, isLoading: isLoadingTypes } = useProviderTypes();
  const { activeSpecialties, isLoading: isLoadingSpecialties } = useSpecialties();

  // Track if form has been initialized for current dialog open
  const initializedRef = useRef(false);
  const lastProviderIdRef = useRef<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    provider_type_id: null as string | null,
    specialty_id: null as string | null,
    revenue: 0,
    patients: 0,
    utilisation: 0,
    location_id: null as string | null,
    region_id: null as string | null,
    practice_id: null as string | null,
  });

  // Get regions for selected location
  const selectedLocation = formData.location_id || formData.practice_id
    ? locations.find(l => l.id === (formData.location_id || formData.practice_id))
    : null;
  
  const availableRegions = selectedLocation && selectedLocation.region_id
    ? regions.filter(r => r.id === selectedLocation.region_id)
    : (defaultRegionId && defaultRegionId !== 'all' 
        ? regions.filter(r => r.id === defaultRegionId)
        : regions);

  // Get selected provider type entity by ID
  const selectedProviderTypeEntity = formData.provider_type_id
    ? activeProviderTypes.find(pt => pt.id === formData.provider_type_id)
    : null;
  
  // Filter specialties based on selected provider type
  // If provider type is selected, show specialties for that type, otherwise show all
  const availableSpecialties = selectedProviderTypeEntity
    ? activeSpecialties.filter(s => 
        !s.provider_type_id || s.provider_type_id === selectedProviderTypeEntity.id
      )
    : activeSpecialties;

  // Initialize form data when dialog opens or provider changes
  useEffect(() => {
    if (!open) {
      // Reset when dialog closes
      initializedRef.current = false;
      lastProviderIdRef.current = null;
      return;
    }
    
    // Check if we need to initialize
    const currentProviderId = provider?.id || null;
    const needsInit = !initializedRef.current || lastProviderIdRef.current !== currentProviderId;
    
    if (!needsInit) return; // Already initialized for this provider/dialog open
    
    // Wait for provider types to load before initializing
    if (isLoadingTypes || activeProviderTypes.length === 0) return;
    
    if (provider) {
      // Use provider_type_id directly
      const providerTypeId = provider.provider_type_id || null;
      
      // Use specialty_id directly
      const specialtyId = provider.specialty_id || null;
      
      setFormData({
        name: provider.name,
        email: provider.email || '',
        phone: provider.phone || '',
        provider_type_id: providerTypeId,
        specialty_id: specialtyId,
        revenue: provider.revenue,
        patients: provider.patients,
        utilisation: provider.utilisation,
        location_id: provider.location_id || null,
        region_id: provider.region_id || null,
        practice_id: provider.practice_id || null,
      });
      
      initializedRef.current = true;
      lastProviderIdRef.current = currentProviderId;
    } else {
      // Set default provider type ID from available types
      const defaultProviderTypeId = defaultType 
        ? activeProviderTypes.find(pt => pt.code === defaultType)?.id 
        : activeProviderTypes[0]?.id 
        || null;
      
      setFormData({
        name: '',
        email: '',
        phone: '',
        provider_type_id: defaultProviderTypeId,
        specialty_id: null,
        revenue: 0,
        patients: 0,
        utilisation: 0,
        location_id: defaultLocationId || null,
        region_id: defaultRegionId && defaultRegionId !== 'all' ? defaultRegionId : null,
        practice_id: defaultLocationId || null,
      });
      
      initializedRef.current = true;
      lastProviderIdRef.current = null;
    }
  }, [open, provider?.id, isLoadingTypes, activeProviderTypes, activeSpecialties, defaultType, defaultLocationId, defaultRegionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate provider_type_id is selected
    if (!formData.provider_type_id) {
      toast.error('Please select a provider type');
      return;
    }

    // Validate provider_type_id exists in active types
    const selectedProviderType = activeProviderTypes.find(pt => pt.id === formData.provider_type_id);
    if (!selectedProviderType) {
      toast.error('Invalid provider type selected');
      return;
    }

    // If specialty is selected, validate it exists
    if (formData.specialty_id) {
      const selectedSpecialty = activeSpecialties.find(s => s.id === formData.specialty_id);
      if (!selectedSpecialty) {
        toast.error('Invalid specialty selected');
        return;
      }
    }

    const avgRevPerPatient = formData.patients > 0
      ? formData.revenue / formData.patients
      : 0;

    // Get region_id from selected location if location is selected
    const finalRegionId = formData.region_id || 
      (formData.location_id ? locations.find(l => l.id === formData.location_id)?.region_id || null : null) ||
      (defaultRegionId && defaultRegionId !== 'all' ? defaultRegionId : null);

    // If location_id is set, use it; otherwise use practice_id for backward compatibility
    // But ensure practice_id is NULL if location_id is set (to avoid foreign key conflicts)
    const finalPracticeId = formData.location_id ? null : (formData.practice_id || null);

    const submitData = {
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      provider_type_id: formData.provider_type_id,
      specialty_id: formData.specialty_id || null,
      location_id: formData.location_id || null,
      region_id: finalRegionId,
      practice_id: finalPracticeId, // Set to NULL if location_id is used
      revenue: formData.revenue,
      patients: formData.patients,
      avg_rev_per_patient: avgRevPerPatient,
      utilisation: formData.utilisation,
    };

    onSubmit(submitData);
  };

  const getProviderTypeLabel = (type: ProviderType) => {
    const providerTypeEntity = activeProviderTypes.find(pt => pt.code === type);
    return providerTypeEntity?.name || type;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Provider' : 'Add New Provider'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the provider information below.'
              : 'Fill in the details to add a new provider.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Dr. John Smith"
                required
              />
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>

            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+44 7700 900000"
              />
            </div>

            <div>
              <Label htmlFor="provider_type">Provider Type *</Label>
              <Select
                value={formData.provider_type_id || ''}
                onValueChange={(value: string) => {
                  if (!value || value.trim() === '') return;
                  
                  // Find provider type by ID
                  const providerType = activeProviderTypes.find(pt => pt.id === value);
                  if (!providerType) return;
                  
                  // Use functional update to ensure we get the latest state
                  setFormData(prev => ({ 
                    ...prev, 
                    provider_type_id: value,
                    specialty_id: null, // Reset specialty when provider type changes
                  }));
                }}
                disabled={isLoadingTypes || activeProviderTypes.length === 0}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingTypes ? "Loading..." : "Select type"} />
                </SelectTrigger>
                <SelectContent>
                  {activeProviderTypes.map((pt) => (
                    <SelectItem key={pt.id} value={pt.id}>
                      {pt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Show specialty dropdown if provider type is selected */}
            {formData.provider_type_id && (
              <div>
                <Label htmlFor="specialty">Specialty</Label>
                <Select
                  value={formData.specialty_id || 'none'}
                  onValueChange={(value) => {
                    const newSpecialtyId = value === 'none' ? null : value;
                    setFormData(prev => ({ ...prev, specialty_id: newSpecialtyId }));
                  }}
                  disabled={isLoadingSpecialties}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingSpecialties ? "Loading..." : "Select specialty"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {availableSpecialties.length > 0 ? (
                      availableSpecialties.map((spec) => (
                        <SelectItem key={spec.id} value={spec.id}>
                          {spec.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No specialties available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Location Dropdown - Show if "All Locations" is selected in TopBar */}
            {showLocationDropdown && locations.length > 0 && (
              <div className="col-span-2">
                <Label htmlFor="location_id">Location</Label>
                <Select
                  value={formData.location_id || 'none'}
                  onValueChange={(value) => {
                    const locationId = value === 'none' ? null : value;
                    const selectedLocation = locationId ? locations.find(l => l.id === locationId) : null;
                    setFormData(prev => ({ 
                      ...prev, 
                      location_id: locationId,
                      region_id: selectedLocation?.region_id || null,
                      practice_id: null, // Set to NULL when using location_id (location_id is from practice_locations, not practices)
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Region Display - Show if location is selected or if we're showing location dropdown */}
            {(formData.location_id || showLocationDropdown) && availableRegions.length > 0 && (
              <div className="col-span-2">
                <Label htmlFor="region_id">Region</Label>
                <Select
                  value={formData.region_id || (defaultRegionId && defaultRegionId !== 'all' ? defaultRegionId : 'none') || 'none'}
                  onValueChange={(value) => {
                    const regionId = value === 'none' ? null : value;
                    setFormData(prev => ({ ...prev, region_id: regionId }));
                  }}
                  disabled={!!formData.location_id} // Disable if location is selected (region comes from location)
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {availableRegions.map((region) => (
                      <SelectItem key={region.id} value={region.id}>
                        {region.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.location_id && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Region is automatically set based on selected location
                  </p>
                )}
                {!formData.location_id && defaultRegionId === 'all' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    All regions are available
                  </p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="revenue">Revenue (MTD)</Label>
              <Input
                id="revenue"
                type="number"
                min="0"
                step="100"
                value={formData.revenue}
                onChange={(e) => setFormData({ ...formData, revenue: Number(e.target.value) })}
                placeholder="0"
              />
            </div>

            <div>
              <Label htmlFor="patients">Patients</Label>
              <Input
                id="patients"
                type="number"
                min="0"
                value={formData.patients}
                onChange={(e) => setFormData({ ...formData, patients: Number(e.target.value) })}
                placeholder="0"
              />
            </div>

            <div>
              <Label htmlFor="utilisation">Utilisation (%)</Label>
              <Input
                id="utilisation"
                type="number"
                min="0"
                max="100"
                value={formData.utilisation}
                onChange={(e) => setFormData({ ...formData, utilisation: Number(e.target.value) })}
                placeholder="0"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !formData.name || !formData.provider_type_id}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
