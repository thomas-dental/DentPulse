import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ChevronDown,
  Calendar,
  User,
  Settings,
  LogOut,
  Shield,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { usePermissions } from "@/hooks/usePermissions";
import { useModuleAccess } from "@/hooks/useModuleAccess";
import { useLocations } from "@/hooks/useLocations";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFilters } from "@/contexts/FilterContext";
import { SyncStatusIndicator } from "./TopBar/SyncStatusIndicator";
import { PeSyncInspectorLink } from "./TopBar/PeSyncInspectorLink";
import { NotificationDropdown } from "./TopBar/NotificationDropdown";
import {
  ChartDateFilter,
  DateFilterType,
  getDateFilterLabel,
} from "@/components/ui/chart-date-filter";

interface TopBarProps {
  sidebarCollapsed?: boolean;
}

export function TopBar({ sidebarCollapsed }: TopBarProps) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { currentRole, isOwner } = useUserRole();
  const { roleName } = usePermissions();
  const { isModuleEnabled } = useModuleAccess();
  const {
    regions: dynamicRegions,
    allAvailableLocations,
    userLocations,
    isLoading: isLoadingLocations,
  } = useLocations();
  const organizationId = profile?.current_organization_id;

  // Financial header: hide locations flagged exclude_from_financial_display (e.g. Saint Catherine's)
  const displayLocations = useMemo(
    () =>
      (allAvailableLocations || []).filter(
        (l: any) => !l.exclude_from_financial_display,
      ),
    [allAvailableLocations],
  );

  // Optional Xero tracking labels for the location dropdown (Settings / Integrations mapping)
  const { data: locationTrackingLabels = {} } = useQuery({
    queryKey: ["location-tracking-labels", organizationId],
    enabled: !!organizationId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await (supabase as any)
        .from("platform_integration_organization_mapping")
        .select(
          "location_id, xero_tracking_category_name, xero_tracking_option_name",
        )
        .eq("organization_id", organizationId);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((row: any) => {
        if (!row.location_id) return;
        const label = [row.xero_tracking_category_name, row.xero_tracking_option_name]
          .filter(Boolean)
          .join(" · ");
        if (label) map[row.location_id] = label;
      });
      return map;
    },
  });
  // If user has restricted locations (not owner), hide "All Locations" option
  const hasRestrictedLocations = userLocations.length > 0 && !isOwner();
  const {
    selectedRegionId,
    setSelectedRegionId,
    selectedLocationId,
    setSelectedLocationId,
    selectedDateRangeId,
    setSelectedDateRangeId,
    customDateRange,
    setCustomDateRange,
  } = useFilters();

  // Clear selection if the chosen location was hidden from financial display
  useEffect(() => {
    if (!selectedLocationId) return;
    const hidden = (allAvailableLocations || []).find(
      (l: any) => l.id === selectedLocationId && l.exclude_from_financial_display,
    );
    if (hidden) setSelectedLocationId(null);
  }, [selectedLocationId, allAvailableLocations, setSelectedLocationId]);

  // Fetch all orgs this user belongs to (for org switcher)
  const { data: userOrgs = [] } = useQuery({
    queryKey: ["user_orgs", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data: roles } = await (supabase as any)
        .from("user_roles")
        .select("organization_id, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (!roles || roles.length <= 1) return []; // No switcher needed for single org
      const orgIds = roles.map((r: any) => r.organization_id);
      const { data: orgs } = await (supabase as any)
        .from("organizations")
        .select("id, name")
        .in("id", orgIds);
      return (orgs || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === profile?.current_organization_id) return;
    await (supabase as any)
      .from("profiles")
      .update({ current_organization_id: orgId })
      .eq("user_id", user?.id);
    // Hard reload to refresh all data with the new org
    window.location.href = "/";
  };

  // Auto-select location for restricted users (e.g. user mapped to 1 location only)
  useEffect(() => {
    if (hasRestrictedLocations && displayLocations.length > 0) {
      // If no location selected or "All" is selected, auto-pick first assigned location
      if (
        !selectedLocationId ||
        !displayLocations.some((l) => l.id === selectedLocationId)
      ) {
        setSelectedLocationId(displayLocations[0].id);
      }
    }
  }, [
    hasRestrictedLocations,
    displayLocations,
    selectedLocationId,
    setSelectedLocationId,
  ]);

  // Local search state (not persisted in URL)
  const [searchQuery, setSearchQuery] = useState("");

  // Get the display label for the selected date filter
  const dateFilterLabel = getDateFilterLabel(
    selectedDateRangeId as DateFilterType,
  );

  // Use dynamic regions if available, otherwise fallback to default
  const defaultRegions = [
    { id: "all", name: "All Regions" },
    { id: "north", name: "Region North" },
    { id: "south", name: "Region South" },
    { id: "london", name: "Region London" },
  ];

  const availableRegions = useMemo(() => {
    return dynamicRegions && dynamicRegions.length > 0
      ? [
          { id: "all", name: "All Regions" },
          ...dynamicRegions.map((r) => ({ id: r.id, name: r.name })),
        ]
      : defaultRegions;
  }, [dynamicRegions]);

  // Get selected region object from context ID
  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return availableRegions[0]; // "All Regions"
    return (
      availableRegions.find((r) => r.id === selectedRegionId) ||
      availableRegions[0]
    );
  }, [selectedRegionId, availableRegions]);

  // Get selected location name from context ID
  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return "All";
    const location = displayLocations?.find((l) => l.id === selectedLocationId);
    if (!location) return "All";
    const tracking = locationTrackingLabels[location.id];
    return tracking
      ? `${location.location_name} (${tracking})`
      : location.location_name;
  }, [selectedLocationId, displayLocations, locationTrackingLabels]);

  const handleSignOut = async () => {
    // Cancel in-flight queries first so they can't re-populate cache after clear
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    // Do NOT navigate here — ProtectedRoute will redirect to /auth once
    // isAuthenticated updates, avoiding a race condition where Auth.tsx
    // still sees isAuthenticated=true and bounces the user back to dashboard.
  };

  const displayName =
    profile?.full_name || user?.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const getRoleBadgeVariant = () => {
    switch (currentRole) {
      case "owner":
        return "default";
      case "admin":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getRoleLabel = () => {
    switch (currentRole) {
      case "owner":
        return "Owner";
      case "admin":
        return "Admin";
      case "member":
        return "Member";
      default:
        return null;
    }
  };

  return (
    <header
      className={cn(
        "fixed top-0 right-0 h-16 bg-card border-b border-border flex items-center justify-between px-6 z-40 transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-[17.5rem]",
      )}
    >
      {/* Left Section - Filters */}
      <div className="flex items-center gap-3">
        {/* Region Selector */}
        {/* <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 gap-2 font-normal">
              <span className="text-sm">Region:</span>
              <span className="font-medium">{selectedRegion.name}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {availableRegions.map((region) => (
              <DropdownMenuItem
                key={region.id}
                onClick={() =>
                  setSelectedRegionId(region.id === "all" ? null : region.id)
                }
                className={cn(selectedRegion.id === region.id && "bg-accent")}
              >
                {region.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu> */}

        {/* Location Selector (if locations available) */}
        {isLoadingLocations ? (
          <div className="h-9 w-36 bg-muted animate-pulse rounded-md" />
        ) : (
          displayLocations &&
          displayLocations.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 font-normal">
                  <span className=" text-sm">Location:</span>
                  <span className="font-medium">{selectedLocationName}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-56 w-auto max-h-[300px] overflow-y-auto"
              >
                {!hasRestrictedLocations && (
                  <DropdownMenuItem
                    onClick={() => setSelectedLocationId(null)}
                    className={cn(!selectedLocationId && "bg-accent")}
                  >
                    All Locations
                  </DropdownMenuItem>
                )}
                {displayLocations.map((location) => {
                  const tracking = locationTrackingLabels[location.id];
                  return (
                  <DropdownMenuItem
                    key={location.id}
                    onClick={() => setSelectedLocationId(location.id)}
                    className={cn(
                      selectedLocationId === location.id && "bg-accent",
                    )}
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{location.location_name}</span>
                      {tracking && (
                        <span className="text-[10px] text-muted-foreground">
                          {tracking}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}

        {/* Date Range Selector - Using ChartDateFilter component */}
        <ChartDateFilter
          filter={selectedDateRangeId as DateFilterType}
          onFilterChange={(filter) => setSelectedDateRangeId(filter)}
          customRange={customDateRange}
          onCustomRangeChange={setCustomDateRange}
          align="start"
          trigger={
            <Button variant="outline" className="h-9 gap-2 font-normal">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{dateFilterLabel}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          }
        />
      </div>

      {/* Center Section - Search */}
      <div className="flex-1 max-w-md mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search locations, metrics, codes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-secondary border-0"
          />
        </div>
      </div>

      {/* Right Section - Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <NotificationDropdown />

        {/* Sync Status Indicator */}
        <SyncStatusIndicator />
        <PeSyncInspectorLink />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 font-normal">
              <Avatar className="w-7 h-7">
                <AvatarImage
                  src={profile?.avatar_url || undefined}
                  alt={displayName}
                />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium">{displayName}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <div className="px-2 py-2 border-b border-border">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              {getRoleLabel() && (
                <Badge variant={getRoleBadgeVariant()} className="mt-2 gap-1">
                  <Shield className="w-3 h-3" />
                  {getRoleLabel()}
                </Badge>
              )}
            </div>
            {userOrgs.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Switch Organization
                  </p>
                  {userOrgs.map((org) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleSwitchOrg(org.id)}
                      className="cursor-pointer gap-2"
                    >
                      <Building2 className="w-4 h-4" />
                      <span className="flex-1 truncate">{org.name}</span>
                      {org.id === profile?.current_organization_id && (
                        <Check className="w-4 h-4 text-green-500" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => navigate("/profile")}
              className="cursor-pointer"
            >
              <User className="w-4 h-4 mr-2" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate("/settings")}
              className="cursor-pointer"
            >
              <Settings className="w-4 h-4 mr-2" />
              Preferences
            </DropdownMenuItem>
            {isOwner() && isModuleEnabled("team_management") && (
              <DropdownMenuItem
                onClick={() => navigate("/team")}
                className="cursor-pointer"
              >
                <Users className="w-4 h-4 mr-2" />
                Team Management
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
