/**
 * The Variable button.
 *
 * Writers should never have to type `{{contact.firstName}}` or remember which
 * fields exist, so the token is only ever written by this menu — the list shows
 * a plain label and what it resolves to.
 */
import { useState } from "react";
import { Braces, ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { campaignVariableGroups } from "./campaign-variables";

export function CampaignVariablePicker({
  onInsert,
  className,
  size = "sm",
}: {
  onInsert: (token: string) => void;
  className?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const groups = campaignVariableGroups
    .map((group) => ({
      ...group,
      variables: group.variables.filter(
        (variable) =>
          !query ||
          variable.label.toLowerCase().includes(query) ||
          variable.sample.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.variables.length > 0);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={cn("gap-1.5", className)}
        >
          <Braces className="h-3.5 w-3.5" />
          Variable
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="border-b border-border p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a variable"
              aria-label="Find a variable"
              className="h-8 pl-8 text-[12px]"
            />
          </div>
        </div>

        <div className="dashboard-scroll max-h-[320px] overflow-y-auto p-1.5">
          {groups.length ? (
            groups.map((group) => (
              <div key={group.key} className="mb-1.5 last:mb-0">
                <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {group.label}
                </p>
                {group.variables.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    onClick={() => {
                      onInsert(variable.token);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="text-[12.5px]">{variable.label}</span>
                    <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
                      {variable.sample}
                    </span>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <p className="px-2 py-8 text-center text-[11.5px] text-muted-foreground">
              Nothing matches that.
            </p>
          )}
        </div>

        <p className="border-t border-border px-3 py-2 text-[10.5px] leading-4 text-muted-foreground">
          Inserted where your cursor is. Each recipient sees their own value.
        </p>
      </PopoverContent>
    </Popover>
  );
}
