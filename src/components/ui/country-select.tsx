/* eslint-disable react-refresh/only-export-components */

import * as React from "react";
import { getCountries } from "react-phone-number-input/input";
import type { Country } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import en from "react-phone-number-input/locale/en.json";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CountrySelectProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const countries = getCountries();

export function CountryFlagIcon({ country }: { country: Country }) {
  const Flag = flags[country];
  if (!Flag) return null;

  return (
    <span
      className="country-flag inline-flex h-4 w-6 shrink-0 overflow-hidden rounded-[2px]"
      title={en[country]}
    >
      <Flag title={en[country]} />
    </span>
  );
}

export function countryCodeFromValue(value?: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return countries.find(
    (country) =>
      country.toLowerCase() === normalized ||
      en[country]?.toLowerCase() === normalized,
  );
}

export const countryNameForCode = (country: Country) =>
  en[country] || country;

const CountrySelect = React.forwardRef<HTMLButtonElement, CountrySelectProps>(
  ({ id, value, onChange, placeholder = "Select country", className, disabled }, ref) => {
    const [search, setSearch] = React.useState("");

    const filteredCountries = React.useMemo(() => {
      if (!search) return countries;
      const searchLower = search.toLowerCase();
      return countries.filter((country) => {
        const countryName = en[country]?.toLowerCase() || "";
        return countryName.includes(searchLower) || country.toLowerCase().includes(searchLower);
      });
    }, [search]);

    const selectedCountryName = value ? en[value as keyof typeof en] : "";
    const selectedCountry = value as Country | undefined;

    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger 
          id={id}
          ref={ref}
          className={cn(
            "h-10 overflow-hidden text-[14px]",
            className
          )}
        >
          <SelectValue placeholder={placeholder}>
            {selectedCountry && (
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <CountryFlagIcon country={selectedCountry} />
                <span className="truncate">{selectedCountryName}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          <div className="px-2 pb-1">
            <input
              type="text"
              placeholder="Search countries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 px-2 text-[13px] rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {filteredCountries.map((country) => {
            const countryName = en[country as keyof typeof en];
            
            return (
              <SelectItem 
                key={country} 
                value={country}
                className="text-[13px]"
              >
                <span className="flex min-w-[240px] items-center gap-3">
                  <CountryFlagIcon country={country} />
                  <span className="min-w-0 flex-1 truncate">{countryName}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }
);

CountrySelect.displayName = "CountrySelect";

export { CountrySelect };
