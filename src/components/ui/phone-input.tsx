import * as React from "react";
import PhoneNumberInput from "react-phone-number-input/input";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumber,
  type Country,
} from "react-phone-number-input";
import en from "react-phone-number-input/locale/en.json";
import "react-phone-number-input/style.css";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CountryFlagIcon } from "@/components/ui/country-select";
import { cn } from "@/lib/utils";

const countries = getCountries();

export interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: string;
  onChange?: (value: string | undefined) => void;
  country?: Country;
  defaultCountry?: Country;
  onCountryChange?: (country: Country) => void;
  overlayTheme?: "light" | "dark";
}

const PhoneInputComponent = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      className,
      value,
      onChange,
      country: controlledCountry,
      defaultCountry = "US",
      onCountryChange,
      overlayTheme,
      disabled,
      ...props
    },
    ref,
  ) => {
    const inferredCountry = value
      ? parsePhoneNumber(value)?.country
      : undefined;
    const [internalCountry, setInternalCountry] = React.useState<Country>(
      controlledCountry || inferredCountry || defaultCountry,
    );
    const [countrySearch, setCountrySearch] = React.useState("");
    const country = controlledCountry || internalCountry;
    const filteredCountries = React.useMemo(() => {
      const query = countrySearch.trim().toLowerCase();
      if (!query) return countries;
      return countries.filter((countryOption) => {
        const callingCode = getCountryCallingCode(countryOption);
        return (
          en[countryOption]?.toLowerCase().includes(query) ||
          countryOption.toLowerCase().includes(query) ||
          callingCode.includes(query.replace(/^\+/, ""))
        );
      });
    }, [countrySearch]);

    React.useEffect(() => {
      if (controlledCountry) return;
      const nextCountry = value ? parsePhoneNumber(value)?.country : undefined;
      if (nextCountry) setInternalCountry(nextCountry);
    }, [controlledCountry, value]);

    React.useEffect(() => {
      if (!controlledCountry && !value) setInternalCountry(defaultCountry);
    }, [controlledCountry, defaultCountry, value]);

    React.useEffect(() => {
      if (!controlledCountry || !value) return;
      const parsed = parsePhoneNumber(value);
      if (!parsed?.country || parsed.country === controlledCountry) return;
      onChange?.(
        `+${getCountryCallingCode(controlledCountry)}${parsed.nationalNumber}`,
      );
    }, [controlledCountry, onChange, value]);

    const handleCountryChange = (nextCountry: Country) => {
      const currentCallingCode = getCountryCallingCode(country);
      const nextCallingCode = getCountryCallingCode(nextCountry);
      const digits = (value || "").replace(/\D/g, "");
      const nationalDigits = digits.startsWith(currentCallingCode)
        ? digits.slice(currentCallingCode.length)
        : digits;

      setInternalCountry(nextCountry);
      onCountryChange?.(nextCountry);
      onChange?.(`+${nextCallingCode}${nationalDigits}`);
    };

    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)}>
        <Select
          value={country}
          onValueChange={(nextCountry: Country) =>
            handleCountryChange(nextCountry)
          }
          onOpenChange={(open) => {
            if (!open) setCountrySearch("");
          }}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-10 w-auto min-w-[96px] shrink-0 gap-1.5 whitespace-nowrap px-3 text-[13px]"
            aria-label="Phone country"
          >
            <div className="flex items-center gap-2">
              <CountryFlagIcon country={country} />
              <span className="font-medium">+{getCountryCallingCode(country)}</span>
            </div>
          </SelectTrigger>
          <SelectContent
            className="max-h-[320px]"
            themeMode={overlayTheme}
          >
            <div className="px-2 pb-1">
              <input
                type="search"
                value={countrySearch}
                onChange={(event) => setCountrySearch(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search country or code"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Search phone countries"
              />
            </div>
            {filteredCountries.map((countryOption) => {
              return (
                <SelectItem key={countryOption} value={countryOption}>
                  <span className="flex min-w-[240px] items-center gap-3">
                    <CountryFlagIcon country={countryOption} />
                    <span className="min-w-0 flex-1 truncate">
                      {en[countryOption]}
                    </span>
                    <span className="text-muted-foreground">
                      +{getCountryCallingCode(countryOption)}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <PhoneNumberInput
          ref={ref}
          country={country}
          value={value || undefined}
          onChange={(nextValue) => onChange?.(nextValue)}
          disabled={disabled}
          className={cn(
            "flex h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-[14px] ring-offset-background",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          {...props}
        />
      </div>
    );
  }
);

PhoneInputComponent.displayName = "PhoneInput";

export { PhoneInputComponent as PhoneInput };
