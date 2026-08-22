import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, DropdownProps, CaptionProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// Custom dropdown components with labels
const MonthDropdown = ({ value, onChange, ...props }: DropdownProps) => {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium text-foreground whitespace-nowrap">Month:</span>
      <select
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={cn(
          "h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[120px]",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        )}
        {...props}
      >
        {months.map((month, index) => (
          <option key={index} value={index}>
            {month}
          </option>
        ))}
      </select>
    </div>
  );
};

const YearDropdown = ({ value, onChange, fromYear, toYear, ...props }: DropdownProps & { fromYear?: number; toYear?: number }) => {
  const startYear = fromYear || 2020;
  const endYear = toYear || 2030;
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium text-foreground whitespace-nowrap">Year:</span>
      <select
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={cn(
          "h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[80px]",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        )}
        {...props}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
};

// Custom Caption component to wrap dropdowns with labels
const CustomCaption = (props: CaptionProps) => {
  const { displayMonth, locale } = props;
  
  // Check if we're using dropdown layout
  if (props.captionLayout === "dropdown-buttons" || props.captionLayout === "dropdown") {
    return (
      <div className={cn("flex justify-center pt-1 relative items-center")}>
        <div className="flex justify-center gap-2 items-center">
          {props.components?.Dropdown && (
            <>
              {props.components.Dropdown({ name: "month", displayMonth, locale, ...props })}
              {props.components.Dropdown({ name: "year", displayMonth, locale, ...props })}
            </>
          )}
        </div>
      </div>
    );
  }
  
  // Default caption rendering
  return (
    <div className={cn("flex justify-center pt-1 relative items-center")}>
      {props.components?.CaptionLabel && (
        <div className={cn("text-sm font-medium")}>
          {props.components.CaptionLabel({ displayMonth, locale, ...props })}
        </div>
      )}
    </div>
  );
};

function Calendar({ className, classNames, showOutsideDays = true, weekStartsOn = 1, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        caption_dropdowns: "flex justify-center gap-2 items-center",
        dropdown: "h-8 rounded-md border border-input bg-background px-2 text-sm",
        dropdown_month: "h-8 rounded-md border border-input bg-background px-2 text-sm",
        dropdown_year: "h-8 rounded-md border border-input bg-background px-2 text-sm",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
        Dropdown: (dropdownProps) => {
          if (dropdownProps.name === "month") {
            return <MonthDropdown {...dropdownProps} />;
          }
          if (dropdownProps.name === "year") {
            return <YearDropdown {...dropdownProps} fromYear={props.fromYear} toYear={props.toYear} />;
          }
          return null;
        },
        ...props.components,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
