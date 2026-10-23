import { useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function TagInput({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string[]) => void;
  placeholder?: string;
  value: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (rawValue: string) => {
    const next = rawValue.trim().replace(/,+$/g, "");
    if (!next) return;
    const nextValues = [...new Set([...value, next])].slice(0, 20);
    onChange(nextValues);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "min-h-10 rounded-md border border-input bg-background px-2 py-1.5",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        )}
      >
        {value.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {value.map((item) => (
              <span
                key={item}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"
              >
                <span className="max-w-[180px] truncate">{item}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-primary/15"
                  onClick={() => onChange(value.filter((entry) => entry !== item))}
                  aria-label={`Remove ${item}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          id={id}
          value={draft}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (nextValue.includes(",")) {
              const nextValues = nextValue
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
              onChange(
                [...new Set([...value, ...nextValues])].slice(0, 20),
              );
              setDraft("");
              return;
            }
            setDraft(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
            if (event.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          placeholder={value.length ? "Add another category" : placeholder}
          className="h-7 border-0 px-1 text-[12px] shadow-none focus-visible:ring-0"
          aria-describedby={`${id}-hint`}
        />
      </div>
      <p id={`${id}-hint`} className="text-[10px] leading-4 text-muted-foreground">
        Type a category and press Enter. You can add up to 20.
      </p>
    </div>
  );
}
