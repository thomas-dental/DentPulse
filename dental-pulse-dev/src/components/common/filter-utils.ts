import { CommonFilterValues } from "@/components/common/CommonFilterDialog";

type Direction = "asc" | "desc";

function normalizeString(value: unknown) {
  return String(value ?? "").toLowerCase().trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateTime(value: unknown): number | null {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function applyTextFilter<T>(
  items: T[],
  text: string,
  selector: (item: T) => unknown,
) {
  const query = normalizeString(text);
  if (!query) return items;
  return items.filter((item) => normalizeString(selector(item)).includes(query));
}

export function applyMultiTextFilter<T>(
  items: T[],
  text: string,
  selectors: Array<(item: T) => unknown>,
) {
  const query = normalizeString(text);
  if (!query) return items;
  return items.filter((item) =>
    selectors.some((selector) => normalizeString(selector(item)).includes(query)),
  );
}

export function applySelectFilter<T>(
  items: T[],
  selected: string | undefined,
  selector: (item: T) => unknown,
) {
  const value = normalizeString(selected);
  if (!value) return items;
  return items.filter((item) => normalizeString(selector(item)) === value);
}

export function applyBooleanFilter<T>(
  items: T[],
  enabled: boolean | undefined,
  predicate: (item: T) => boolean,
) {
  if (!enabled) return items;
  return items.filter(predicate);
}

export function applyNumberRange<T>(
  items: T[],
  min: string | number | undefined,
  max: string | number | undefined,
  selector: (item: T) => unknown,
) {
  const minValue = toNumber(min);
  const maxValue = toNumber(max);
  if (minValue === null && maxValue === null) return items;

  return items.filter((item) => {
    const value = toNumber(selector(item));
    if (value === null) return false;
    if (minValue !== null && value < minValue) return false;
    if (maxValue !== null && value > maxValue) return false;
    return true;
  });
}

export function applyDateRange<T>(
  items: T[],
  from: string | undefined,
  to: string | undefined,
  selector: (item: T) => unknown,
) {
  const fromTime = toDateTime(from);
  const toTime = toDateTime(to);
  if (fromTime === null && toTime === null) return items;

  return items.filter((item) => {
    const valueTime = toDateTime(selector(item));
    if (valueTime === null) return false;
    if (fromTime !== null && valueTime < fromTime) return false;
    if (toTime !== null && valueTime > toTime) return false;
    return true;
  });
}

export function applySort<T>(
  items: T[],
  selector: (item: T) => unknown,
  direction: Direction = "asc",
) {
  const sign = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = selector(a);
    const bv = selector(b);

    const an = toNumber(av);
    const bn = toNumber(bv);
    if (an !== null && bn !== null) return (an - bn) * sign;

    const ad = toDateTime(av);
    const bd = toDateTime(bv);
    if (ad !== null && bd !== null) return (ad - bd) * sign;

    return normalizeString(av).localeCompare(normalizeString(bv)) * sign;
  });
}

type CommonFilterMap<T> = {
  text?: { key: string; selectors: Array<(item: T) => unknown> };
  select?: Array<{ key: string; selector: (item: T) => unknown }>;
  boolean?: Array<{ key: string; predicate: (item: T) => boolean }>;
  numberRange?: Array<{
    minKey: string;
    maxKey: string;
    selector: (item: T) => unknown;
  }>;
  dateRange?: Array<{
    fromKey: string;
    toKey: string;
    selector: (item: T) => unknown;
  }>;
  sort?: {
    sortByKey: string;
    sortOrderKey: string;
    sortSelectorMap: Record<string, (item: T) => unknown>;
  };
};

export function applyCommonFilters<T>(
  items: T[],
  values: CommonFilterValues,
  config: CommonFilterMap<T>,
) {
  let result = [...items];

  if (config.text) {
    result = applyMultiTextFilter(
      result,
      String(values[config.text.key] ?? ""),
      config.text.selectors,
    );
  }

  (config.select || []).forEach(({ key, selector }) => {
    result = applySelectFilter(result, String(values[key] ?? ""), selector);
  });

  (config.boolean || []).forEach(({ key, predicate }) => {
    result = applyBooleanFilter(result, Boolean(values[key]), predicate);
  });

  (config.numberRange || []).forEach(({ minKey, maxKey, selector }) => {
    result = applyNumberRange(
      result,
      String(values[minKey] ?? ""),
      String(values[maxKey] ?? ""),
      selector,
    );
  });

  (config.dateRange || []).forEach(({ fromKey, toKey, selector }) => {
    result = applyDateRange(
      result,
      String(values[fromKey] ?? ""),
      String(values[toKey] ?? ""),
      selector,
    );
  });

  if (config.sort) {
    const sortBy = String(values[config.sort.sortByKey] ?? "");
    const sortOrderRaw = String(values[config.sort.sortOrderKey] ?? "asc");
    const sortOrder: Direction = sortOrderRaw === "desc" ? "desc" : "asc";
    const selector = config.sort.sortSelectorMap[sortBy];
    if (selector) {
      result = applySort(result, selector, sortOrder);
    }
  }

  return result;
}

