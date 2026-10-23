import type { ReactNode } from "react";

import {
  colorInputValue,
  type SpacingSide,
} from "@/components/shared/style-values";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Shared property-panel controls used by the form, event, and ticket builders. */

export function EditorSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="min-w-0 max-w-full overflow-hidden border-b border-border px-5 py-5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="min-w-0 max-w-full">{action}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ColorControl({
  fallback,
  id,
  label,
  onChange,
  placeholder = "Inherit",
  value,
}: {
  fallback: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string | undefined;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input
          id={id}
          type="color"
          value={colorInputValue(value, fallback)}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 rounded-md border border-border bg-transparent p-1"
        />
        <Input
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={`${label} color value`}
        />
      </div>
    </div>
  );
}

export function StyleNumberInput({
  id,
  label,
  max = 80,
  min = 0,
  onChange,
  placeholder,
  step,
  unit = "px",
  value,
}: {
  id: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  step?: number;
  unit?: string;
  value: number | undefined;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) => {
            if (event.target.value === "") {
              onChange(undefined);
              return;
            }
            const nextValue = Number(event.target.value);
            if (Number.isNaN(nextValue)) return;
            onChange(Math.min(max, Math.max(min, nextValue)));
          }}
          className={cn(unit && "pr-10")}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

export function SpacingControlGroup({
  baseId,
  label,
  max = 64,
  min = 0,
  onChange,
  placeholder,
  unit = "px",
  values,
}: {
  baseId: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (side: SpacingSide, value: number | undefined) => void;
  placeholder?: string;
  unit?: string;
  values: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Top", values.top],
            ["Right", values.right],
            ["Bottom", values.bottom],
            ["Left", values.left],
          ] as Array<[SpacingSide, number | undefined]>
        ).map(([side, value]) => (
          <StyleNumberInput
            key={side}
            id={`${baseId}-${side.toLowerCase()}`}
            label={side}
            value={value}
            placeholder={placeholder}
            max={max}
            min={min}
            unit={unit}
            onChange={(nextValue) => onChange(side, nextValue)}
          />
        ))}
      </div>
    </div>
  );
}

/** Small segmented control for a short list of mutually exclusive values. */
export function SegmentedControl<Value extends string | number>({
  ariaLabel,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  onChange: (value: Value) => void;
  options: Array<{ value: Value; label: ReactNode; title?: string }>;
  value: Value | undefined;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "grid gap-1 rounded-md border border-border p-1",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "grid h-8 place-items-center rounded text-[11px] capitalize transition",
            value === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
