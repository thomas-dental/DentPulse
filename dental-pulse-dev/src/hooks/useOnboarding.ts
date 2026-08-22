import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Practice } from '@/components/onboarding/PracticeStep';
import { TeamMember } from '@/components/onboarding/TeamStep';
import { SettingsData } from '@/components/onboarding/SettingsStep';
import { createDefaultIntegrations } from '@/utils/defaultIntegrations';
import { roleSyncService } from '@/services/roleSyncService';
import { createDefaultFoldersForLocationsBatch, FolderService } from '@/utils/defaultFolders';
import { IntegrationSyncEntityService } from '@/services/integrations/integrationSyncEntityService';

interface OrganizationData {
  name: string;
  legalName: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  practiceCount: string;
  employeeCount: string;
  description: string;
  logoUrl?: string;
}

export function useOnboarding() {
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const saveOnboarding = async (
    organization: OrganizationData,
    practices: Practice[],
    teamMembers: TeamMember[],
    settings: SettingsData,
    existingOrganizationId?: string | null
  ) => {
    if (!user) {
      toast.error('Authentication required', {
        description: 'Please sign in to complete onboarding.',
      });
      navigate('/auth');
      return false;
    }

    setIsSaving(true);

    try {
      let organizationId: string;

      // 1. Use existing organization or create new one
      if (existingOrganizationId) {
        organizationId = existingOrganizationId;
        
        // Update organization with provided data only if it's different from current data
        // This preserves Dentally sync data (name, email, phone, address, logo_url)
        const { data: currentOrg } = await supabase
          .from('organizations')
          .select('name, email, phone, address, logo_url')
          .eq('id', organizationId)
          .single();

        const updateData: any = {};
        
        // Only update if the new value is provided and different from current
        // Skip "My Organization" to preserve Dentally sync name
        if (organization.name && 
            organization.name !== 'My Organization' && 
            organization.name !== currentOrg?.name) {
          updateData.name = organization.name;
        }
        if (organization.email && organization.email !== currentOrg?.email) {
          updateData.email = organization.email;
        }
        if (organization.phone && organization.phone !== currentOrg?.phone) {
          updateData.phone = organization.phone;
        }
        if (organization.address && organization.address !== currentOrg?.address) {
          updateData.address = organization.address;
        }
        if (organization.logoUrl && organization.logoUrl !== currentOrg?.logo_url) {
          updateData.logo_url = organization.logoUrl;
        }

        // Only update if there are actual changes
        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('organizations')
            .update(updateData)
            .eq('id', organizationId);

          if (updateError) {
            console.error('Error updating organization:', updateError);
            // Don't throw - this is not critical
          }
        } else {
          console.log('[Onboarding] Organization data already up to date, skipping update');
        }

        // Check if user role already exists
        const { data: existingRole } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (!existingRole) {
          // Create user role as owner if it doesn't exist
          const { error: roleError } = await supabase
            .from('user_roles')
            .insert({
              user_id: user.id,
              organization_id: organizationId,
              role: 'owner',
            } as any);

          if (roleError) throw roleError;
        }
      } else {
        // Create new organization
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .insert({
            name: organization.name,
            email: organization.email,
            phone: organization.phone,
            address: organization.address,
            logo_url: organization.logoUrl || null,
            created_by: user.id,
            user_id: user.id,
          })
          .select()
          .single();

        if (orgError) throw orgError;

        organizationId = orgData.id;

        // 2. Create user role as owner
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            user_id: user.id,
            organization_id: organizationId,
            role: 'owner',
          } as any);

        if (roleError) throw roleError;
      }

      // 3. Create regions and practice locations
      const validPractices = practices.filter(p => p.name && p.city);
      const practiceLocationsData: any[] = []; // Declared outside so it's accessible for folder creation

      if (validPractices.length > 0) {
        // Group practices by city to create regions
        const cityGroups = new Map<string, Practice[]>();
        validPractices.forEach(p => {
          const cityKey = p.city.trim();
          if (!cityGroups.has(cityKey)) {
            cityGroups.set(cityKey, []);
          }
          cityGroups.get(cityKey)!.push(p);
        });

        // Create regions for each city
        const regionMap = new Map<string, string>(); // city -> region_id

        for (const [city, cityPractices] of cityGroups) {
          const regionName = `${city} Region`;

          // Check if region already exists for this organization
          const { data: existingRegion } = await supabase
            .from('regions')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('name', regionName)
            .is('deleted_at', null)
            .single();

          let regionId: string;
          if (existingRegion) {
            regionId = existingRegion.id;
          } else {
            // Create new region
            const { data: newRegion, error: regionError } = await supabase
              .from('regions')
              .insert({
                organization_id: organizationId,
                name: regionName,
                code: city.substring(0, 3).toUpperCase(),
                is_active: true,
                created_by: user.id,
              })
              .select()
              .single();

            if (regionError) throw regionError;
            regionId = newRegion.id;
          }

          regionMap.set(city, regionId);
        }

        // Create or update practice locations (check for existing by organization_id + user_id + location_name)

        for (let index = 0; index < validPractices.length; index++) {
          const p = validPractices[index];
          const regionId = regionMap.get(p.city.trim()) || null;

          // Check if location already exists for this user (by location_name)
          const { data: existingLocations } = await supabase
            .from('practice_locations')
            .select('id, location_name, api_record_unique_id')
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .limit(50);

          // Check by location_name (case-insensitive)
          const existingLoc = existingLocations?.find(
            loc => loc.location_name?.toLowerCase().trim() === p.name.toLowerCase().trim()
          );

          if (existingLoc) {
            // Update existing location
            console.log(`[Onboarding] Location "${p.name}" already exists, updating...`);
            const chairCount = p.chairCount ? parseInt(p.chairCount, 10) : null;
            const { data: updatedLoc, error: updateError } = await supabase
              .from('practice_locations')
              .update({
                region_id: regionId,
                address_line1: p.address,
                city: p.city,
                postal_code: p.zipCode,
                phone: p.phone || null,
                email: p.email || null,
                is_primary: index === 0,
                is_active: true,
                ...(chairCount != null ? { chairs_count: chairCount } : {}),
              })
              .eq('id', existingLoc.id)
              .select()
              .single();

            if (updateError) {
              console.error('Error updating location:', updateError);
            } else if (updatedLoc) {
              practiceLocationsData.push(updatedLoc);
            }
          } else {
            // Create new location
            const chairCountNew = p.chairCount ? parseInt(p.chairCount, 10) : null;
            const { data: newLoc, error: insertError } = await supabase
              .from('practice_locations')
              .insert({
                organization_id: organizationId,
                user_id: user.id,
                region_id: regionId,
                location_name: p.name,
                address_line1: p.address,
                city: p.city,
                postal_code: p.zipCode,
                phone: p.phone || null,
                email: p.email || null,
                is_primary: index === 0,
                is_active: true,
                created_by: user.id,
                ...(chairCountNew != null ? { chairs_count: chairCountNew } : {}),
              })
              .select()
              .single();

            if (insertError) {
              console.error('Error creating location:', insertError);
              throw insertError;
            } else if (newLoc) {
              practiceLocationsData.push(newLoc);
            }
          }
        }

        // Create chair_settings rows for each location with chair data
        for (let index = 0; index < practiceLocationsData.length; index++) {
          const loc = practiceLocationsData[index];
          const practice = validPractices[index];
          const chairs = practice?.chairCount ? parseInt(practice.chairCount, 10) : null;
          if (loc?.id && chairs && chairs > 0) {
            const { error: csError } = await supabase
              .from('chair_settings')
              .upsert(
                {
                  organization_id: organizationId,
                  location_id: loc.id,
                  number_of_chairs: chairs,
                  created_by: user.id,
                  updated_by: user.id,
                },
                { onConflict: 'organization_id,location_id' }
              );
            if (csError) {
              console.error('Error creating chair_settings:', csError);
              // Non-critical, don't throw
            }
          }
        }

        // Update organization address with primary location address
        const primaryLocation = practiceLocationsData.find(loc => loc.is_primary) || practiceLocationsData[0];
        if (primaryLocation && (primaryLocation.address_line1 || primaryLocation.city)) {
          const fullAddress = [
            primaryLocation.address_line1,
            primaryLocation.city,
            primaryLocation.postal_code
          ].filter(Boolean).join(', ');

          const { error: updateOrgError } = await supabase
            .from('organizations')
            .update({ address: fullAddress })
            .eq('id', organizationId);

          if (updateOrgError) {
            console.error('Error updating organization address:', updateOrgError);
            // Don't throw - this is not critical
          }
        }

        // Map old practice IDs to new location IDs
        const practiceIdMap = new Map<string, string>();
        validPractices.forEach((p, i) => {
          if (practiceLocationsData[i]) {
            practiceIdMap.set(p.id, practiceLocationsData[i].id);
          }
        });

        // 4. Create custom roles and invite team members
        const validMembers = teamMembers.filter(m => m.firstName && m.lastName);
        if (validMembers.length > 0) {
          // Map member type to provider/practice role (matches TeamManagement page values)
          const getProviderRole = (type: string) => {
            switch (type) {
              case 'associate': return 'Dentist';
              case 'hygienist': return 'Hygienist';
              case 'therapist': return 'Therapist';
              default: return 'Other';
            }
          };

          // Map member type to custom role name
          const getCustomRoleName = (type: string) => {
            switch (type) {
              case 'associate': return 'Associate';
              case 'hygienist': return 'Hygienist';
              case 'therapist': return 'Therapist';
              default: return 'Other';
            }
          };

          // 4a. Create custom roles for each unique team member type
          const uniqueTypes = [...new Set(validMembers.map(m => m.type))];
          const roleMap = new Map<string, string>(); // type -> custom_role_id

          for (const type of uniqueTypes) {
            const roleName = getCustomRoleName(type);

            // Check if role already exists for this org
            const { data: existingRole } = await supabase
              .from('custom_roles')
              .select('id')
              .eq('organization_id', organizationId)
              .eq('name', roleName)
              .maybeSingle();

            if (existingRole) {
              roleMap.set(type, existingRole.id);
            } else {
              const { data: newRole, error: roleCreateError } = await supabase
                .from('custom_roles')
                .insert({
                  organization_id: organizationId,
                  name: roleName,
                  description: `${roleName} role created during onboarding`,
                })
                .select()
                .single();

              if (roleCreateError) {
                console.error(`Error creating custom role "${roleName}":`, roleCreateError);
              } else {
                roleMap.set(type, newRole.id);
                // Sync new role to Central Auth (fire-and-forget)
                roleSyncService.upsertRole({
                  tenant_platform_id: organizationId,
                  source_role_id: newRole.id,
                  name: newRole.name,
                  description: newRole.description,
                  is_system: false,
                });
              }
            }
          }

          // 4b. Separate members: those with email get full invite, those without just get provider record
          const membersWithEmail = validMembers.filter(m => m.email?.trim());
          const membersWithoutEmail = validMembers.filter(m => !m.email?.trim());

          // 4c. Batch invite members with email via backend endpoint (sequential, no race conditions)
          if (membersWithEmail.length > 0) {
            const userProfile = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
            const inviterName = userProfile.data?.full_name || user.email || 'Team Owner';
            const session = await supabase.auth.getSession();
            const token = session.data.session?.access_token;

            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

            try {
              const inviteResponse = await fetch(`${backendUrl}/api/team/batch-invite`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                  organization_id: organizationId,
                  organization_name: organization.name,
                  inviter_name: inviterName,
                  app_url: window.location.origin,
                  members: membersWithEmail.map(m => ({
                    email: m.email,
                    name: `${m.firstName} ${m.lastName}`,
                    role_type: getProviderRole(m.type),
                    app_role: 'member',
                    custom_role_id: roleMap.get(m.type) || null,
                    location_ids: practiceIdMap.get(m.practiceId) ? [practiceIdMap.get(m.practiceId)] : [],
                    specialization: m.specialty || null,
                  })),
                }),
              });

              const inviteResult = await inviteResponse.json();
              if (inviteResult.summary) {
                console.log(`[Onboarding] Batch invite: ${inviteResult.summary.succeeded} succeeded, ${inviteResult.summary.failed} failed`);
              }
              if (inviteResult.summary?.failed > 0) {
                console.warn('[Onboarding] Failed invites:', inviteResult.results?.filter((r: any) => !r.success));
              }
            } catch (err) {
              console.error('[Onboarding] Batch invite error:', err);
              // Non-blocking — onboarding continues even if invites fail
            }
          }

          // 4d. Create provider records only for members WITHOUT email (no auth user possible)
          if (membersWithoutEmail.length > 0) {
            const providerInserts = membersWithoutEmail.map(m => ({
              organization_id: organizationId,
              location_id: practiceIdMap.get(m.practiceId) || null,
              name: `${m.firstName} ${m.lastName}`,
              email: null,
              phone: m.phone || null,
              photo_url: m.photoUrl || null,
              provider_role: getProviderRole(m.type),
              is_active: true,
            }));

            const { error: providersError } = await supabase
              .from('providers')
              .insert(providerInserts);

            if (providersError) {
              console.error('Error creating providers for members without email:', providersError);
            }
          }
        }
      }

      // 5. Create or update organization settings
      // Check if organization_settings already exists
      const { data: existingSettings } = await supabase
        .from('organization_settings')
        .select('organization_id')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (existingSettings) {
        // Update existing settings
        const { error: settingsError } = await supabase
          .from('organization_settings')
          .update({
            fiscal_year_start: settings.fiscalYearStart,
            currency: settings.currency,
            date_format: settings.dateFormat,
            notifications_enabled: settings.emailNotifications,
            onboarding_completed: true,
          })
          .eq('organization_id', organizationId);

        if (settingsError) throw settingsError;
      } else {
        // Insert new settings
        const { error: settingsError } = await supabase
          .from('organization_settings')
          .insert({
            organization_id: organizationId,
            fiscal_year_start: settings.fiscalYearStart,
            currency: settings.currency,
            date_format: settings.dateFormat,
            notifications_enabled: settings.emailNotifications,
            onboarding_completed: true,
          });

        if (settingsError) throw settingsError;
      }

      // 6. Create default integrations (only if they don't already exist)
      const { data: existingIntegrations } = await supabase
        .from('integrations')
        .select('id')
        .eq('organization_id', organizationId)
        .limit(1);

      if (!existingIntegrations || existingIntegrations.length === 0) {
        const defaultIntegrations = createDefaultIntegrations(organizationId, user.id);

        // Debug: Log what we're inserting
        console.log('Creating default integrations:', JSON.stringify(defaultIntegrations, null, 2));

        const { data: createdIntegrations, error: integrationsError } = await (supabase as any)
          .from('integrations')
          .insert(defaultIntegrations)
          .select();

        if (integrationsError) {
          console.error('Error creating default integrations:', integrationsError);
          // Don't throw - this is not critical for onboarding
        } else {
          console.log('Successfully created integrations:', createdIntegrations);

          // Initialize sync entities for Dentally integrations
          if (createdIntegrations && createdIntegrations.length > 0) {
            for (const integration of createdIntegrations) {
              if (integration.integration_name === 'Dentally') {
                console.log('Initializing sync entities for Dentally integration:', integration.id);
                await IntegrationSyncEntityService.initializeDefaultEntities(integration.id, 'Dentally');
              }
            }
          }
        }
      } else {
        console.log('Integrations already exist, skipping creation');
      }

      // 7. Create default folders for each location
      // Note: Folders require a location_id, so we only create them if locations exist
      const { exists: foldersExist, count: existingFolderCount } = await FolderService.checkFoldersExist(organizationId, user.id);
      if (foldersExist) {
        console.log(`Folders already exist (${existingFolderCount} folders) - skipping creation (likely from Dentally flow)`);
      } else if (validPractices.length > 0 && practiceLocationsData.length > 0) {
        // Create folders for each location
        const locationsForFolders = practiceLocationsData.map(loc => ({
          id: loc.id,
          name: loc.location_name || loc.name || 'Location',
        }));
        console.log('[Onboarding] Creating folders for locations:', locationsForFolders);
        const foldersResult = await createDefaultFoldersForLocationsBatch(organizationId, locationsForFolders, user.id);
        if (foldersResult.success) {
          console.log(`[Onboarding] Created folders for ${foldersResult.created} locations (${foldersResult.existed} already existed)`);
        } else {
          console.error('[Onboarding] Error creating default folders:', foldersResult.errors);
          // Don't throw - this is not critical for onboarding
        }
      } else {
        console.log('[Onboarding] No locations available - skipping folder creation (folders will be created when locations are added)');
      }

      // 8. Update user profile with current organization and mark onboarding as complete
      const { error: profileError } = await updateProfile({ current_organization_id: organizationId });
      
      if (profileError) throw profileError;

      // Note: onboarding_completed is already set in step 5 above

      // 9. Update Central Auth with organization/tenant details (non-blocking)
      updateCentralAuthTenant(user.email, organization.name, organizationId);

      // 10. Team member invitations are handled in step 4 via POST /api/team/batch-invite
      // (creates auth user, team_members, user_role, provider, sends email, syncs to Central Auth — all sequential)

      toast('Welcome aboard! 🎉', {
        description: 'Your organization has been set up successfully.',
      });

      return true;
    } catch (error: any) {
      console.error('Onboarding error:', error);
      toast.error('Setup failed', {
        description: error.message || 'Failed to complete setup. Please try again.',
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const skipOnboarding = async () => {
    if (!user) {
      toast.error('Authentication required', {
        description: 'Please sign in to skip onboarding.',
      });
      navigate('/auth');
      return;
    }

    setIsSaving(true);

    try {
      // Create a minimal organization with default values
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: 'My Organization',
          email: user.email || null,
          phone: null,
          address: null,
          logo_url: null,
          created_by: user.id,
          user_id: user.id,
        })
        .select()
        .single();

      if (orgError) throw orgError;

      const organizationId = orgData.id;

      // Create user role as owner
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: user.id,
          organization_id: organizationId,
          role: 'owner',
        } as any);

      if (roleError) throw roleError;

      // Create default organization settings
      await supabase
        .from('organization_settings')
        .insert({
          organization_id: organizationId,
          fiscal_year_start: 'january',
          currency: 'USD',
          date_format: 'MM/DD/YYYY',
          notifications_enabled: true,
          onboarding_completed: false, // Mark as not completed since they skipped
        });

      // Create default integrations (only if they don't already exist)
      const { data: existingIntegrations } = await supabase
        .from('integrations')
        .select('id')
        .eq('organization_id', organizationId)
        .limit(1);

      if (!existingIntegrations || existingIntegrations.length === 0) {
        const defaultIntegrations = createDefaultIntegrations(organizationId, user.id);

        // Debug: Log what we're inserting
        console.log('Creating default integrations (skip):', JSON.stringify(defaultIntegrations, null, 2));

        const { data: createdIntegrations, error: integrationsError } = await (supabase as any)
          .from('integrations')
          .insert(defaultIntegrations)
          .select();

        if (integrationsError) {
          console.error('Error creating default integrations:', integrationsError);
          // Don't throw - this is not critical
        } else {
          console.log('Successfully created integrations (skip):', createdIntegrations);

          // Initialize sync entities for Dentally integrations
          if (createdIntegrations && createdIntegrations.length > 0) {
            for (const integration of createdIntegrations) {
              if (integration.integration_name === 'Dentally') {
                console.log('Initializing sync entities for Dentally integration (skip):', integration.id);
                await IntegrationSyncEntityService.initializeDefaultEntities(integration.id, 'Dentally');
              }
            }
          }
        }
      } else {
        console.log('Integrations already exist, skipping creation');
      }

      // Skip folder creation in skipOnboarding flow - no locations exist yet
      // Folders require a location_id and will be created when locations are added later
      // (either through manual creation in UI or via Dentally sync)
      console.log('[Onboarding] Skip flow - no locations created, folder creation deferred until locations are added');

      // Update user profile with current organization
      const { error: profileError } = await updateProfile({ current_organization_id: organizationId });

      if (profileError) throw profileError;

      // Update Central Auth with org details (non-blocking)
      updateCentralAuthTenant(user.email, 'My Organization', organizationId);

      toast('Onboarding skipped', {
        description: 'You can complete setup anytime from Settings.',
      });

      // Use window.location for reliable redirect to dashboard
      // This ensures profile state is fresh when the page loads
      window.location.href = '/';
    } catch (error: any) {
      console.error('Skip onboarding error:', error);
      toast.error('Error', {
        description: error.message || 'Failed to skip onboarding. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Update Central Auth with tenant/org details after onboarding completes.
   * Non-blocking — failure does not affect onboarding.
   */
  const updateCentralAuthTenant = async (email: string | undefined, orgName: string, orgId: string) => {
    if (!email) return;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

    try {
      await fetch(`${backendUrl}/api/register-broadcast/update-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          tenant_name: orgName,
          tenant_id: orgId,
        }),
      });
      console.log('[central-auth] Tenant updated in Central Auth after onboarding');
    } catch (err) {
      console.warn('[central-auth] Tenant update failed (non-blocking):', err);
    }
  };

  return {
    saveOnboarding,
    skipOnboarding,
    isSaving,
  };
}
