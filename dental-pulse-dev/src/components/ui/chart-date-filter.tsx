/**
 * ChartDateFilter - Reusable date filter dropdown with 3-dot menu
 * Uses Ant Design RangePicker for custom date selection
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Calendar as CalendarIcon } from 'lucide-react';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs from 'dayjs';

export type DateFilterType = 'this-month' | 'this-quarter' | 'this-year' | 'last-month' | 'last-quarter' | 'last-year' | 'custom';

/** Get display name for a date filter type */
export function getDateFilterLabel(filter: DateFilterType): string {
  switch (filter) {
    case 'this-month': return 'This Month';
    case 'this-quarter': return 'This Quarter';
    case 'this-year': return 'This Year';
    case 'last-month': return 'Last Month';
    case 'last-quarter': return 'Last Quarter';
    case 'last-year': return 'Last Year';
    case 'custom': return 'Custom Range';
    default: return 'This Month';
  }
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface CustomRange {
  from: Date | null;
  to: Date | null;
}

export interface ChartDateFilterProps {
  filter: DateFilterType;
  onFilterChange: (filter: DateFilterType) => void;
  customRange: CustomRange;
  onCustomRangeChange: (range: CustomRange) => void;
  className?: string;
  /** Custom trigger element - if provided, replaces the default 3-dot icon button */
  trigger?: React.ReactNode;
  /** Alignment for dropdown content */
  align?: 'start' | 'center' | 'end';
  /**
   * Restrict which preset options are shown. Custom Date Range is always
   * shown regardless. Defaults to all six presets.
   */
  allowedFilters?: Array<Exclude<DateFilterType, 'custom'>>;
}

/**
 * Calculate date range based on selected filter
 */
export function calculateDateRangeFromFilter(
  filter: DateFilterType,
  customRange: CustomRange
): DateRange {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  switch (filter) {
    case 'this-month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
    case 'this-quarter': {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
      endDate = new Date(now.getFullYear(), currentQuarter * 3 + 3, 0);
      break;
    }
    case 'this-year':
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
    case 'custom':
      startDate = customRange.from || new Date(now.getFullYear(), 0, 1);
      endDate = customRange.to || new Date();
      break;
    default:
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31);
  }

  return { startDate, endDate };
}

/**
 * Hook to manage chart date filter state
 */
export function useChartDateFilter(defaultFilter: DateFilterType = 'this-year') {
  const [filter, setFilter] = useState<DateFilterType>(defaultFilter);
  const [customRange, setCustomRange] = useState<CustomRange>({
    from: null,
    to: null,
  });

  const dateRange = useMemo(
    () => calculateDateRangeFromFilter(filter, customRange),
    [filter, customRange]
  );

  return {
    filter,
    setFilter,
    customRange,
    setCustomRange,
    dateRange,
  };
}

export function ChartDateFilter({
  filter,
  onFilterChange,
  customRange,
  onCustomRangeChange,
  className,
  trigger,
  align = 'end',
  allowedFilters,
}: ChartDateFilterProps) {
  const showPreset = (f: Exclude<DateFilterType, 'custom'>) =>
    !allowedFilters || allowedFilters.includes(f);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleDropdownOpenChange = (open: boolean) => {
    // Don't close the dropdown while the Ant Design picker calendar is open
    if (!open && pickerOpen) return;
    setDropdownOpen(open);
    if (open) {
      // Always show preset options first so user can switch away from custom
      setShowCustomPicker(false);
    } else {
      setShowCustomPicker(false);
      setPickerOpen(false);
    }
  };

  // Check if a click target is inside an Ant Design picker portal
  const isAntPickerClick = (e: Event) => {
    const target = e.target as HTMLElement;
    return !!target?.closest?.('.ant-picker-dropdown, .ant-picker');
  };

  return (
    <DropdownMenu modal={false} open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className={className}>
            <MoreVertical className="w-4 h-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={showCustomPicker ? 'w-auto min-w-[320px]' : 'w-[220px]'}
        onPointerDownOutside={(e) => {
          if (isAntPickerClick(e)) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isAntPickerClick(e)) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (showCustomPicker) e.preventDefault();
        }}
      >
        {showCustomPicker ? (
          <div className="p-3">
            <div className="flex flex-col gap-2">
              <Label className="text-sm text-muted-foreground">Select Date Range</Label>
              <ConfigProvider
                theme={{
                  token: {
                    colorPrimary: 'hsl(244, 48%, 25%)',
                    colorPrimaryBg: '#e6f4ff',
                    colorPrimaryBgHover: '#bae0ff',
                  },
                }}
              >
                <DatePicker.RangePicker
                  value={[
                    customRange.from ? dayjs(customRange.from) : null,
                    customRange.to ? dayjs(customRange.to) : null,
                  ]}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      onCustomRangeChange({
                        from: dates[0].toDate(),
                        to: dates[1].toDate(),
                      });
                      onFilterChange('custom');
                      setPickerOpen(false);
                      setDropdownOpen(false);
                      setShowCustomPicker(false);
                    }
                  }}
                  onOpenChange={(open) => setPickerOpen(open)}
                  format="DD-MM-YYYY"
                  className="w-full"
                  autoFocus
                />
              </ConfigProvider>
            </div>
          </div>
        ) : (
          <>
            {showPreset('this-month') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('this-month')}
                className={filter === 'this-month' ? 'bg-accent' : ''}
              >
                This Month
              </DropdownMenuItem>
            )}
            {showPreset('this-quarter') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('this-quarter')}
                className={filter === 'this-quarter' ? 'bg-accent' : ''}
              >
                This Quarter
              </DropdownMenuItem>
            )}
            {showPreset('this-year') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('this-year')}
                className={filter === 'this-year' ? 'bg-accent' : ''}
              >
                This Year
              </DropdownMenuItem>
            )}
            {showPreset('last-month') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('last-month')}
                className={filter === 'last-month' ? 'bg-accent' : ''}
              >
                Last Month
              </DropdownMenuItem>
            )}
            {showPreset('last-quarter') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('last-quarter')}
                className={filter === 'last-quarter' ? 'bg-accent' : ''}
              >
                Last Quarter
              </DropdownMenuItem>
            )}
            {showPreset('last-year') && (
              <DropdownMenuItem
                onClick={() => onFilterChange('last-year')}
                className={filter === 'last-year' ? 'bg-accent' : ''}
              >
                Last Year
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                setShowCustomPicker(true);
              }}
              className={filter === 'custom' ? 'bg-accent' : ''}
            >
              <span className="flex-1">Custom Date Range</span>
              <CalendarIcon className="w-4 h-4" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
