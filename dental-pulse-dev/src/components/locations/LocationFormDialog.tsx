import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PracticeLocation, PracticeLocationInsert, PracticeLocationUpdate, Region } from '@/types/location';

interface LocationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: PracticeLocation | null;
  regions?: Region[];
  onSubmit: (data: Omit<PracticeLocationInsert, 'organization_id' | 'created_by'> | PracticeLocationUpdate) => void;
  isLoading?: boolean;
}

export function LocationFormDialog({
  open,
  onOpenChange,
  location,
  regions = [],
  onSubmit,
  isLoading,
}: LocationFormDialogProps) {
  const isEditing = !!location;

  const [formData, setFormData] = useState({
    region_id: '',
    location_name: '',
    location_code: '',
    email: '',
    phone: '',
    fax: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'USA',
    timezone: 'America/New_York',
    is_primary: false,
    is_active: true,
    notes: '',
  });

  useEffect(() => {
    if (open) {
      if (location) {
        // Edit mode - populate with existing data
        setFormData({
          region_id: location.region_id || '',
          location_name: location.location_name,
          location_code: location.location_code || '',
          email: location.email || '',
          phone: location.phone || '',
          fax: location.fax || '',
          address_line1: location.address_line1 || '',
          address_line2: location.address_line2 || '',
          city: location.city || '',
          state: location.state || '',
          postal_code: location.postal_code || '',
          country: location.country || 'USA',
          timezone: location.timezone || 'America/New_York',
          is_primary: location.is_primary,
          is_active: location.is_active,
          notes: location.notes || '',
        });
      } else {
        // Create mode - reset to default values
        setFormData({
          region_id: '',
          location_name: '',
          location_code: '',
          email: '',
          phone: '',
          fax: '',
          address_line1: '',
          address_line2: '',
          city: '',
          state: '',
          postal_code: '',
          country: 'USA',
          timezone: 'America/New_York',
          is_primary: false,
          is_active: true,
          notes: '',
        });
      }
    }
  }, [location, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Ensure region_id is properly handled: empty string or 'none' becomes null, otherwise use the UUID
    const regionId = formData.region_id === 'none' || !formData.region_id || formData.region_id.trim() === '' 
      ? null 
      : formData.region_id;

    const submitData = {
      region_id: regionId,
      location_name: formData.location_name,
      location_code: formData.location_code || null,
      email: formData.email || null,
      phone: formData.phone || null,
      fax: formData.fax || null,
      address_line1: formData.address_line1 || null,
      address_line2: formData.address_line2 || null,
      city: formData.city || null,
      state: formData.state || null,
      postal_code: formData.postal_code || null,
      country: formData.country || null,
      timezone: formData.timezone || null,
      is_primary: formData.is_primary,
      is_active: formData.is_active,
      notes: formData.notes || null,
    };

    console.log('Submitting location data with region_id:', submitData.region_id);
    onSubmit(submitData);
  };

  const timezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'Europe/London',
    'Europe/Paris',
    'Asia/Dubai',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];

  // Debug logging
  useEffect(() => {
    console.log('LocationFormDialog - open prop changed:', open);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isEditing ? 'Edit Location' : 'Add New Location'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the location information below. All fields are optional except location name.'
              : 'Fill in the details to add a new practice location. Location name is required.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="location_name">Location Name *</Label>
              <Input
                id="location_name"
                value={formData.location_name}
                onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
                placeholder="London Office"
                required
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="location_code">Location Code</Label>
              <Input
                id="location_code"
                value={formData.location_code}
                onChange={(e) => setFormData({ ...formData, location_code: e.target.value })}
                placeholder="LON-001"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="region_id">Region</Label>
              <Select
                value={formData.region_id || 'none'}
                onValueChange={(value) => setFormData({ ...formData, region_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="location@example.com"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+1 (555) 123-4567"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="fax">Fax</Label>
              <Input
                id="fax"
                value={formData.fax}
                onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
                placeholder="+1 (555) 123-4568"
                disabled={isEditing}
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="address_line1">Address Line 1</Label>
              <Input
                id="address_line1"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
                placeholder="123 Main Street"
                disabled={isEditing}
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="address_line2">Address Line 2</Label>
              <Input
                id="address_line2"
                value={formData.address_line2}
                onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                placeholder="Suite 100"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="New York"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="NY"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                placeholder="10001"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="USA"
                disabled={isEditing}
              />
            </div>

            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={formData.timezone}
                onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes about this location..."
                rows={3}
                disabled={isEditing}
              />
            </div>

            <div className="col-span-2 flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="is_primary"
                  checked={formData.is_primary}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
                  disabled={isEditing}
                />
                <Label htmlFor="is_primary">Primary Location</Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  disabled={isEditing}
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
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
            <Button type="submit" disabled={isLoading || !formData.location_name}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
