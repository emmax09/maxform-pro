import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencyOption } from "@/lib/regional-options";

type PricingInputProps = {
  className?: string;
  currency?: string;
  disabled?: boolean;
  id: string;
  kind?: "currency" | "percentage";
  label: string;
  max?: number;
  min?: number;
  onValueChange: (value: number) => void;
  value: number;
};

const boundedValue = (value: number, min: number, max?: number) => {
  const finiteValue = Number.isFinite(value) ? value : min;
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, finiteValue));
};

export function PricingInput({
  className,
  currency = "USD",
  disabled,
  id,
  kind = "currency",
  label,
  max,
  min = 0,
  onValueChange,
  value,
}: PricingInputProps) {
  const focused = useRef(false);
  const [displayValue, setDisplayValue] = useState(() =>
    boundedValue(value, min, max).toFixed(2),
  );
  const prefix =
    kind === "percentage"
      ? "%"
      : currencyOption(currency)?.symbol || currency.toUpperCase();

  useEffect(() => {
    if (!focused.current) {
      setDisplayValue(boundedValue(value, min, max).toFixed(2));
    }
  }, [max, min, value]);

  const commit = () => {
    focused.current = false;
    const nextValue = boundedValue(Number(displayValue || 0), min, max);
    setDisplayValue(nextValue.toFixed(2));
    onValueChange(nextValue);
  };

  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {kind === "currency" ? ` (${currency.toUpperCase()})` : " (%)"}
      </Label>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
          {prefix}
        </span>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={displayValue}
          disabled={disabled}
          onFocus={(input) => {
            focused.current = true;
            input.currentTarget.select();
          }}
          onChange={(input) => {
            const nextValue = input.target.value.replace(/,/g, "");
            if (!/^\d*(?:\.\d{0,2})?$/.test(nextValue)) return;
            setDisplayValue(nextValue);
            const parsed = Number(nextValue);
            if (Number.isFinite(parsed)) {
              onValueChange(boundedValue(parsed, min, max));
            }
          }}
          onBlur={commit}
          className="pl-10 tabular-nums"
          aria-label={`${label} value`}
        />
      </div>
    </div>
  );
}
