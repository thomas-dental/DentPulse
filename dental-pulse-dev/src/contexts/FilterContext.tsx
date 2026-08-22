import { createContext, useContext, useState, useMemo, useRef, useCallback, ReactNode } from 'react';
import { DateRange } from '@/utils/dateRangeUtils';

// Storage key for session persistence
const FILTER_STORAGE_KEY = 'dentpulse_filters';

export type DateFilterType = 'this-month' | 'this-quarter' | 'this-year' | 'last-month' | 'last-quarter' | 'last-year' | 'custom' | 'mtd' | 'qtd' | 'ytd' | 'last-12m' | 'yoy';

export interface CustomDateRange {
  from: Date | null;
  to: Date | null;
}

interface FilterState {
  regionId: string | null;
  locationId: string | null;
  dateRangeId: string;
  customDateRange: CustomDateRange | null;
}

export interface FilterContextType {
  selectedRegionId: string | null;
  selectedLocationId: string | null;
  selectedDateRangeId: string;
  customDateRange: CustomDateRange;
  dateRange: DateRange;
  setSelectedRegionId: (id: string | null) => void;
  setSelectedLocationId: (id: string | null) => void;
  setSelectedDateRangeId: (id: string) => void;
  setCustomDateRange: (range: CustomDateRange) => void;
}

// Exported so callers (e.g. the per-practice PDF sections) can render their own
// <FilterContext.Provider> with an overridden value to scope hooks to one location.
export const FilterContext = createContext<FilterContextType | undefined>(undefined);

// Get initial state from sessionStorage (persists during browser session)
const getInitialState = (): FilterState => {
  try {
    const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        regionId: parsed.regionId || null,
        locationId: parsed.locationId || null,
        dateRangeId: parsed.dateRangeId || 'this-month',
        customDateRange: parsed.customDateRange ? {
          from: parsed.customDateRange.from ? new Date(parsed.customDateRange.from) : null,
          to: parsed.customDateRange.to ? new Date(parsed.customDateRange.to) : null,
        } : null,
      };
    }
  } catch (e) {
    console.error('Error reading filter state from sessionStorage:', e);
  }
  return {
    regionId: null,
    locationId: null,
    dateRangeId: 'this-month',
    customDateRange: null,
  };
};

// Save state to sessionStorage
const saveState = (state: FilterState) => {
  try {
    const toSave = {
      ...state,
      customDateRange: state.customDateRange ? {
        from: state.customDateRange.from?.toISOString() || null,
        to: state.customDateRange.to?.toISOString() || null,
      } : null,
    };
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Error saving filter state to sessionStorage:', e);
  }
};

// Calculate date range based on filter type
const calculateDateRange = (filterId: string, customRange: CustomDateRange | null): DateRange => {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  switch (filterId) {
    case 'this-month':
    case 'mtd':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
    case 'this-quarter':
    case 'qtd': {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
      endDate = new Date(now.getFullYear(), currentQuarter * 3 + 3, 0);
      break;
    }
    case 'this-year':
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31);
      break;
    case 'last-month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'last-quarter': {
      const lastQuarter = Math.floor(now.getMonth() / 3) - 1;
      const year = lastQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const quarter = lastQuarter < 0 ? 3 : lastQuarter;
      startDate = new Date(year, quarter * 3, 1);
      endDate = new Date(year, quarter * 3 + 3, 0);
      break;
    }
    case 'last-year':
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
      break;
    case 'last-12m':
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      endDate = now;
      break;
    case 'yoy':
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = now;
      break;
    case 'custom':
      startDate = customRange?.from || new Date(now.getFullYear(), 0, 1);
      endDate = customRange?.to || now;
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  // Set endDate to end-of-day (23:59:59.999) so queries using <= include the entire last day
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

export function FilterProvider({ children }: { children: ReactNode }) {
  // Get initial values from sessionStorage (like PHP session)
  const initialState = getInitialState();

  const [selectedRegionId, setSelectedRegionIdState] = useState<string | null>(initialState.regionId);
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(initialState.locationId);
  const [selectedDateRangeId, setSelectedDateRangeIdState] = useState<string>(initialState.dateRangeId);
  const [customDateRange, setCustomDateRangeState] = useState<CustomDateRange>(
    initialState.customDateRange || { from: null, to: null }
  );

  // Refs track the latest values so saveState always sees current state,
  // avoiding stale closures when multiple setters are called in the same event.
  const regionIdRef = useRef(selectedRegionId);
  const locationIdRef = useRef(selectedLocationId);
  const dateRangeIdRef = useRef(selectedDateRangeId);
  const customDateRangeRef = useRef(customDateRange);

  const persistState = useCallback(() => {
    saveState({
      regionId: regionIdRef.current,
      locationId: locationIdRef.current,
      dateRangeId: dateRangeIdRef.current,
      customDateRange: customDateRangeRef.current,
    });
  }, []);

  // Calculate date range from ID and custom range - recalculate when either changes
  const dateRange = useMemo(() => {
    return calculateDateRange(selectedDateRangeId, customDateRange);
  }, [selectedDateRangeId, customDateRange]);

  const setSelectedRegionId = useCallback((id: string | null) => {
    const newId = id === 'all' ? null : id;
    regionIdRef.current = newId;
    setSelectedRegionIdState(newId);
    persistState();
  }, [persistState]);

  const setSelectedLocationId = useCallback((id: string | null) => {
    locationIdRef.current = id;
    setSelectedLocationIdState(id);
    persistState();
  }, [persistState]);

  const setSelectedDateRangeId = useCallback((id: string) => {
    dateRangeIdRef.current = id;
    setSelectedDateRangeIdState(id);
    persistState();
  }, [persistState]);

  const setCustomDateRange = useCallback((range: CustomDateRange) => {
    customDateRangeRef.current = range;
    setCustomDateRangeState(range);
    persistState();
  }, [persistState]);

  return (
    <FilterContext.Provider
      value={{
        selectedRegionId,
        selectedLocationId,
        selectedDateRangeId,
        customDateRange,
        dateRange,
        setSelectedRegionId,
        setSelectedLocationId,
        setSelectedDateRangeId,
        setCustomDateRange,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
}

// Non-throwing variant for generic hooks that want the active filters when
// available but must not crash if rendered outside a FilterProvider.
export function useOptionalFilters() {
  return useContext(FilterContext);
}
