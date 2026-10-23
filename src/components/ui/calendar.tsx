import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DayPicker,
  useDayPicker,
  useNavigation,
  type CaptionProps,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

type CalendarPanel = "month" | "year" | null;

const monthFormatter = (locale?: string) =>
  new Intl.DateTimeFormat(locale, { month: "short" });

const monthHeadingFormatter = (locale?: string) =>
  new Intl.DateTimeFormat(locale, { month: "long" });

const monthBoundary = (
  value: Date | undefined,
  year: number | undefined,
  edge: "start" | "end",
) => {
  if (value) return new Date(value.getFullYear(), value.getMonth(), 1);
  if (year) return new Date(year, edge === "start" ? 0 : 11, 1);
  return undefined;
};

const sameMonth = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth();

const yearPageStart = (year: number, minYear: number, maxYear: number) => {
  const pageSize = 12;
  const base = Math.floor(year / pageSize) * pageSize;
  const maxStart = Math.max(minYear, maxYear - pageSize + 1);
  return Math.min(Math.max(base, minYear), maxStart);
};

function ModernCalendarCaption({ displayIndex, displayMonth, id }: CaptionProps) {
  const dayPicker = useDayPicker();
  const { displayMonths, goToMonth, nextMonth, previousMonth } =
    useNavigation();
  const localeCode = dayPicker.locale?.code;
  const monthNames = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        monthFormatter(localeCode).format(new Date(2020, month, 1)),
      ),
    [localeCode],
  );
  const [panel, setPanel] = React.useState<CalendarPanel>(null);
  const minMonth =
    monthBoundary(dayPicker.fromMonth, undefined, "start") ||
    monthBoundary(dayPicker.fromDate, undefined, "start") ||
    monthBoundary(undefined, dayPicker.fromYear, "start") ||
    new Date(new Date().getFullYear() - 100, 0, 1);
  const maxMonth =
    monthBoundary(dayPicker.toMonth, undefined, "end") ||
    monthBoundary(dayPicker.toDate, undefined, "end") ||
    monthBoundary(undefined, dayPicker.toYear, "end") ||
    new Date(new Date().getFullYear() + 20, 11, 1);
  const minYear = minMonth.getFullYear();
  const maxYear = maxMonth.getFullYear();
  const currentYear = displayMonth.getFullYear();
  const [yearStart, setYearStart] = React.useState(() =>
    yearPageStart(currentYear, minYear, maxYear),
  );

  React.useEffect(() => {
    if (panel === "year") {
      setYearStart(yearPageStart(currentYear, minYear, maxYear));
    }
  }, [currentYear, maxYear, minYear, panel]);

  const resolvedIndex =
    displayIndex ??
    displayMonths.findIndex((month) => sameMonth(month, displayMonth));
  const firstMonth = resolvedIndex <= 0;
  const lastMonth = resolvedIndex >= displayMonths.length - 1;
  const hidePrevious = dayPicker.numberOfMonths > 1 && !firstMonth;
  const hideNext = dayPicker.numberOfMonths > 1 && !lastMonth;
  const monthLabel = monthHeadingFormatter(localeCode).format(displayMonth);
  const monthButtonLabel = `Change month, currently ${monthLabel}`;
  const yearButtonLabel = `Change year, currently ${currentYear}`;
  const years = Array.from({ length: 12 }, (_, index) => yearStart + index);
  const previousYearPage = Math.max(minYear, yearStart - 12);
  const nextYearPage = Math.min(
    Math.max(minYear, maxYear - 11),
    yearStart + 12,
  );
  const today = new Date(
    dayPicker.today.getFullYear(),
    dayPicker.today.getMonth(),
    1,
  );
  const todayAvailable = today >= minMonth && today <= maxMonth;

  const goToVisibleMonth = (month: number, year = currentYear) => {
    const next = new Date(year, month, 1);
    if (next < minMonth || next > maxMonth) return;
    goToMonth(next);
    setPanel(null);
  };

  const goToVisibleYear = (year: number) => {
    const minAllowedMonth = year === minYear ? minMonth.getMonth() : 0;
    const maxAllowedMonth = year === maxYear ? maxMonth.getMonth() : 11;
    const month = Math.min(
      Math.max(displayMonth.getMonth(), minAllowedMonth),
      maxAllowedMonth,
    );
    goToVisibleMonth(month, year);
  };

  return (
    <div
      id={id}
      className="relative px-10 pb-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") setPanel(null);
      }}
    >
      <div className="flex h-9 items-center justify-center">
        {!hidePrevious ? (
          <button
            type="button"
            aria-label="Previous month"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "absolute left-0 h-8 w-8 bg-background p-0 shadow-sm",
            )}
            disabled={!previousMonth}
            onClick={() => previousMonth && goToMonth(previousMonth)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="absolute left-0 h-8 w-8" />
        )}

        <div className="flex items-center rounded-md bg-muted/70 p-1">
          <button
            type="button"
            aria-expanded={panel === "month"}
            aria-label={monthButtonLabel}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-sm px-3 text-sm font-medium transition-colors hover:bg-background hover:text-foreground",
              panel === "month" && "bg-background text-foreground shadow-sm",
            )}
            onClick={() =>
              setPanel((current) => (current === "month" ? null : "month"))
            }
          >
            {monthLabel}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
          <button
            type="button"
            aria-expanded={panel === "year"}
            aria-label={yearButtonLabel}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-sm px-3 text-sm font-medium tabular-nums transition-colors hover:bg-background hover:text-foreground",
              panel === "year" && "bg-background text-foreground shadow-sm",
            )}
            onClick={() =>
              setPanel((current) => (current === "year" ? null : "year"))
            }
          >
            {currentYear}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
        </div>

        {!hideNext ? (
          <button
            type="button"
            aria-label="Next month"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "absolute right-0 h-8 w-8 bg-background p-0 shadow-sm",
            )}
            disabled={!nextMonth}
            onClick={() => nextMonth && goToMonth(nextMonth)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <span className="absolute right-0 h-8 w-8" />
        )}
      </div>

      {panel && (
        <div className="absolute left-1/2 top-11 z-30 w-[262px] -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          {panel === "month" ? (
            <div className="grid grid-cols-3 gap-1">
              {monthNames.map((name, month) => {
                const value = new Date(currentYear, month, 1);
                const disabled = value < minMonth || value > maxMonth;
                const selected = month === displayMonth.getMonth();
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "h-9 rounded-sm px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35",
                      selected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                    onClick={() => goToVisibleMonth(month)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous years"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-background p-0",
                  )}
                  disabled={yearStart <= minYear}
                  onClick={() => setYearStart(previousYearPage)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold tabular-nums">
                  {yearStart} - {Math.min(yearStart + 11, maxYear)}
                </span>
                <button
                  type="button"
                  aria-label="Next years"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-background p-0",
                  )}
                  disabled={yearStart + 11 >= maxYear}
                  onClick={() => setYearStart(nextYearPage)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {years.map((year) => {
                  const disabled = year < minYear || year > maxYear;
                  const selected = year === currentYear;
                  return (
                    <button
                      key={year}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        "h-9 rounded-sm px-2 text-sm font-medium tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35",
                        selected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                      onClick={() => goToVisibleYear(year)}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {todayAvailable && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                type="button"
                className="h-8 w-full rounded-sm text-sm font-medium text-primary transition-colors hover:bg-accent"
                onClick={() => {
                  goToMonth(today);
                  setPanel(null);
                }}
              >
                Jump to today
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Calendar({
  captionLayout = "buttons",
  className,
  classNames,
  components,
  fromDate,
  fromMonth,
  fromYear,
  showOutsideDays = true,
  toDate,
  toMonth,
  toYear,
  ...props
}: CalendarProps) {
  const currentYear = new Date().getFullYear();
  const resolvedFromYear =
    fromYear ?? (fromDate || fromMonth ? undefined : currentYear - 100);
  const resolvedToYear =
    toYear ?? (toDate || toMonth ? undefined : currentYear + 20);

  return (
    <DayPicker
      captionLayout={captionLayout}
      fromDate={fromDate}
      fromMonth={fromMonth}
      fromYear={resolvedFromYear}
      showOutsideDays={showOutsideDays}
      toDate={toDate}
      toMonth={toMonth}
      toYear={resolvedToYear}
      className={cn("w-max p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "relative space-y-3",
        caption: "relative",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-8 w-8 bg-background p-0 opacity-80 shadow-sm hover:opacity-100",
        ),
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
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
        Caption: ModernCalendarCaption,
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
        ...components,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
