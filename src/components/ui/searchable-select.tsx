import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchableSelectFilter } from "@/lib/searchable-select-filter";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  description?: string;
  keywords?: string;
  label: string;
  leading?: React.ReactNode;
  value: string;
};

type SearchableSelectProps = {
  className?: string;
  disabled?: boolean;
  emptyText?: string;
  id?: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  value: string;
};

const optionSearchValue = (option: SearchableSelectOption) =>
  `${option.value} ${option.label} ${option.keywords || ""}`;

export function SearchableSelect({
  className,
  disabled,
  emptyText = "No matches found.",
  id,
  onChange,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  value,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const selected = options.find((option) => option.value === value);
  const resultCount = React.useMemo(
    () =>
      search
        ? options.filter(
            (option) =>
              searchableSelectFilter(optionSearchValue(option), search) > 0,
          ).length
        : options.length,
    [options, search],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between px-3 text-[14px] font-normal",
            "hover:bg-accent hover:text-foreground",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.leading}
            <span className="truncate">
              {selected?.label || placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command filter={searchableSelectFilter}>
          <div className="relative">
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
              className="pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandList className="dashboard-scroll max-h-[320px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={optionSearchValue(option)}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="gap-3 py-2.5"
              >
                {option.leading}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0 text-primary",
                    value === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
          {search && (
            <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              {resultCount.toLocaleString()}{" "}
              {resultCount === 1 ? "result" : "results"}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
