/**
 * Shared roster rules for Providers List, Profit Goals Settings,
 * Production Data, hours, and NHS/MOS counts.
 *
 * The List used exact `provider_role === "dentist"` and dropped anyone with a
 * blank role from every bucket (including Other). Production used ILIKE
 * `%dentist%`, so the same person could appear on Production Data and vanish
 * from List / Profit Goals. Keep one matcher so those screens cannot drift.
 */

export type ProviderManagementType =
  | "Dentist"
  | "Therapist"
  | "Hygienist"
  | "Other";

export function normalizeProviderRole(
  role: string | null | undefined,
): string {
  return (role ?? "").trim().toLowerCase();
}

export function isHygienistProviderRole(role: string): boolean {
  return role.includes("hygienist") || role.includes("hygiene");
}

export function isTherapistProviderRole(role: string): boolean {
  return role.includes("therapist") || role.includes("therapy");
}

/** Associate page is keyed as "Dentist" internally. */
export function isAssociateProviderRole(role: string): boolean {
  if (!role) return false;
  // Hygienist / therapist titles can contain overlapping words — keep them
  // on their own pages even if the string also mentions associate/principal.
  if (isHygienistProviderRole(role) || isTherapistProviderRole(role)) {
    return false;
  }
  return (
    role.includes("dentist") ||
    role.includes("dental surgeon") ||
    role === "principal" ||
    role.startsWith("principal ") ||
    role === "associate" ||
    role.startsWith("associate ")
  );
}

export function providerMatchesManagementType(
  provider: { provider_role?: string | null },
  providerType: string | null | undefined,
): boolean {
  if (!providerType) return true;
  const role = normalizeProviderRole(provider.provider_role);
  if (providerType === "Dentist") return isAssociateProviderRole(role);
  if (providerType === "Hygienist") return isHygienistProviderRole(role);
  if (providerType === "Therapist") return isTherapistProviderRole(role);
  if (providerType === "Other") {
    // Blank Dentally roles must still appear under Other — otherwise they
    // disappear from Associate, Hygienist, Therapist, AND Other.
    return (
      !isAssociateProviderRole(role) &&
      !isHygienistProviderRole(role) &&
      !isTherapistProviderRole(role)
    );
  }
  return true;
}

export function filterProvidersByManagementType<
  T extends { provider_role?: string | null },
>(
  providers: T[] | null | undefined,
  providerType: string | null | undefined,
): T[] {
  if (!providers?.length) return [];
  if (!providerType) return [...providers];
  return providers.filter((provider) =>
    providerMatchesManagementType(provider, providerType),
  );
}

export function providerMatchesSelectedLocation(
  provider: {
    location_id?: string | null;
    practice_id?: string | null;
  },
  locationId?: string | null,
): boolean {
  if (!locationId || locationId === "all") return true;
  // Unassigned home clinic: still show them so a missing location_id cannot
  // hide a real practitioner from every role page and Profit Goals.
  if (!provider.location_id && !provider.practice_id) return true;
  return (
    provider.location_id === locationId || provider.practice_id === locationId
  );
}
