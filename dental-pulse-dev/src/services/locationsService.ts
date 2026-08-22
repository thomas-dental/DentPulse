import { supabase } from '@/integrations/supabase/client';

export interface FetchedLocation {
  id: string;
  location_code: string;
  location_name: string;
  region_id: string;
  region_name?: string;
}

export interface FetchedRegion {
  id: string;
  name: string;
}

/**
 * Fetch all practice locations from the database
 */
export async function fetchPracticeLocations(organizationId: string): Promise<FetchedLocation[]> {
  try {
    if (!organizationId) {
      console.warn('Organization ID is required to fetch practice locations');
      return [];
    }

    const { data, error } = await supabase
      .from('practice_locations')
      .select(`
        id,
        location_code,
        location_name,
        region_id,
        regions (name)
      `)
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (error) throw error;

    console.log(`Fetched ${data?.length || 0} practice locations for org ${organizationId}`);
    const result = (data || []).map((loc: any) => ({
      id: loc.id,
      location_code: loc.location_code || '',
      location_name: loc.location_name,
      region_id: loc.region_id || '',
      region_name: loc.regions?.name,
    }));
    console.log('Mapped locations:', result);
    return result;
  } catch (error) {
    console.error('Error fetching practice locations:', error);
    return [];
  }
}

/**
 * Fetch all regions from the database
 */
export async function fetchRegions(organizationId: string): Promise<FetchedRegion[]> {
  try {
    if (!organizationId) {
      console.warn('Organization ID is required to fetch regions');
      return [];
    }

    const { data, error } = await supabase
      .from('regions')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (error) throw error;

    console.log(`Fetched ${data?.length || 0} regions for org ${organizationId}`);
    console.log('Regions data:', data);
    return data || [];
  } catch (error) {
    console.error('Error fetching regions:', error);
    return [];
  }
}
