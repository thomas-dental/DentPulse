/**
 * All-Locations setup maps: build a DISTINCT account → category / profit-group
 * assignment across practice locations, then match journals once.
 *
 * Why: Hungerford + Queen Street (etc.) often map the same COA account into
 * different groups. Unioning rows into Map<account, groupId[]> makes one
 * journal line land in multiple groups and inflate totals. For All Locations
 * we keep one assignment per account (stable first-wins by mapping_location_id).
 *
 * Single-location behaviour is unchanged (caller should not use these helpers
 * for conflict resolution, or pass allLocations=false).
 */

export type CategoryMapRow = {
  location_id: string;
  category_range_id: number;
  mapping_location_id?: string | null;
};

export type CategoryMasterRow = {
  id: number;
  name: string;
  range_group: string;
  range_sub_group: string;
  range_order: number;
};

export type CategoryInfo = {
  locationId: string;
  name: string;
  rangeGroup: string;
  rangeSubGroup: string;
  rangeOrder: number;
};

export type GroupAccountRow = {
  group_account_master_id: number;
  account_id: string;
  mapping_location_id?: string | null;
};

function normKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/** Stable order: location-scoped before null; then mapping_location_id; then id. */
function compareMappingRows(
  a: { mapping_location_id?: string | null; category_range_id?: number; group_account_master_id?: number },
  b: { mapping_location_id?: string | null; category_range_id?: number; group_account_master_id?: number },
): number {
  const aLoc = a.mapping_location_id ? 1 : 0;
  const bLoc = b.mapping_location_id ? 1 : 0;
  if (aLoc !== bLoc) return bLoc - aLoc; // location-scoped first
  const aMap = String(a.mapping_location_id ?? "");
  const bMap = String(b.mapping_location_id ?? "");
  if (aMap !== bMap) return aMap.localeCompare(bMap);
  const aId = Number(a.category_range_id ?? a.group_account_master_id ?? 0);
  const bId = Number(b.category_range_id ?? b.group_account_master_id ?? 0);
  return aId - bId;
}

/**
 * Cashflow / Category Range: account (location_id column) → one category.
 * All Locations → first-wins after stable sort (distinct accounts).
 * Single location → last-wins (same as historical overwrite behaviour).
 */
export function buildDistinctCategoryAliasMap(
  categoryMapRows: CategoryMapRow[],
  categoryMasterRows: CategoryMasterRow[],
  options?: { allLocations?: boolean },
): Map<string, CategoryInfo> {
  const allLocations = options?.allLocations === true;
  const locationToCategory = new Map<string, CategoryInfo>();
  const masterById = new Map(categoryMasterRows.map((m) => [m.id, m]));

  const locationScopedCategoryIds = new Set(
    categoryMapRows
      .filter((row) => !!row.mapping_location_id)
      .map((row) => row.category_range_id),
  );

  const orderedRows = [...categoryMapRows].sort(compareMappingRows);

  for (const mapRow of orderedRows) {
    if (!mapRow.mapping_location_id && locationScopedCategoryIds.has(mapRow.category_range_id)) {
      continue;
    }
    const master = masterById.get(mapRow.category_range_id);
    if (!master) continue;
    const key = normKey(mapRow.location_id);
    if (!key) continue;

    if (allLocations && locationToCategory.has(key)) continue;

    locationToCategory.set(key, {
      locationId: mapRow.location_id,
      name: master.name,
      rangeGroup: master.range_group,
      rangeSubGroup: master.range_sub_group,
      rangeOrder: master.range_order ?? 0,
    });
  }

  return locationToCategory;
}

/**
 * Profit groups: account_id → group master ids.
 * All Locations → at most one expense group and one revenue group per account
 * (distinct; first-wins). Single location → may accumulate unique gids (legacy).
 */
export function buildDistinctGroupsByAccount(
  groupAccountRows: GroupAccountRow[],
  options: {
    allLocations: boolean;
    expenseGroupIds: Set<number>;
    revenueGroupIds: Set<number>;
  },
): {
  groupsByAccount: Map<string, number[]>;
  revenueGroupsByAccount: Map<string, number[]>;
} {
  const groupsByAccount = new Map<string, number[]>();
  const revenueGroupsByAccount = new Map<string, number[]>();
  const { allLocations, expenseGroupIds, revenueGroupIds } = options;

  const ordered = [...groupAccountRows].sort(compareMappingRows);

  for (const row of ordered) {
    const key = normKey(row.account_id);
    const gid = Number(row.group_account_master_id);
    if (!key || !Number.isFinite(gid)) continue;

    if (expenseGroupIds.has(gid)) {
      if (allLocations) {
        if (!groupsByAccount.has(key)) groupsByAccount.set(key, [gid]);
      } else {
        const existing = groupsByAccount.get(key) || [];
        if (!existing.includes(gid)) existing.push(gid);
        groupsByAccount.set(key, existing);
      }
    }

    if (revenueGroupIds.has(gid)) {
      if (allLocations) {
        if (!revenueGroupsByAccount.has(key)) revenueGroupsByAccount.set(key, [gid]);
      } else {
        const existing = revenueGroupsByAccount.get(key) || [];
        if (!existing.includes(gid)) existing.push(gid);
        revenueGroupsByAccount.set(key, existing);
      }
    }
  }

  return { groupsByAccount, revenueGroupsByAccount };
}

/**
 * Distinct account keys for a single profit group (category drilldown).
 * All Locations → Set of unique account ids across locations.
 */
export function distinctAccountKeysFromGroupRows(
  groupAccountRows: Array<{ account_id?: string | null }>,
): Set<string> {
  const accountKeySet = new Set<string>();
  for (const row of groupAccountRows) {
    const key = normKey(row.account_id);
    if (key) accountKeySet.add(key);
  }
  return accountKeySet;
}
