import {
  Check,
  CheckCircle2,
  ExternalLink,
  Heart,
  Mail,
} from "lucide-react";

import type { FormConfirmationSettings } from "@/components/forms/form-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const confirmationIcons = {
  check: CheckCircle2,
  mail: Mail,
  heart: Heart,
  none: Check,
};

type ConfirmationSettingsEditorProps = {
  allowInheritance?: boolean;
  inherited?: FormConfirmationSettings;
  onChange: (value: FormConfirmationSettings) => void;
  value: FormConfirmationSettings;
};

export function ConfirmationSettingsEditor({
  allowInheritance = false,
  inherited,
  onChange,
  value,
}: ConfirmationSettingsEditorProps) {
  const effective =
    allowInheritance && value.useModuleDefault && inherited
      ? inherited
      : value;
  const disabled = allowInheritance && value.useModuleDefault;
  const Icon = confirmationIcons[effective.icon];
  const update = (patch: Partial<FormConfirmationSettings>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <div className="space-y-5">
        {allowInheritance && (
          <div className="flex items-center justify-between gap-6 border-y border-border py-3">
            <div>
              <p className="text-[12px] font-medium">Use module default</p>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                Keep this form synced with the default confirmation design.
              </p>
            </div>
            <Switch
              checked={value.useModuleDefault}
              onCheckedChange={(useModuleDefault) =>
                update({ useModuleDefault })
              }
            />
          </div>
        )}

        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2",
            disabled && "pointer-events-none opacity-55",
          )}
          aria-disabled={disabled}
        >
          <div className="space-y-2">
            <Label>After submission</Label>
            <Select
              value={value.type}
              onValueChange={(type: FormConfirmationSettings["type"]) =>
                update({ type })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="message">Show confirmation</SelectItem>
                <SelectItem value="message_redirect">
                  Confirm, then redirect
                </SelectItem>
                <SelectItem value="redirect">Redirect immediately</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Layout</Label>
            <Select
              value={value.textAlign}
              onValueChange={(textAlign: FormConfirmationSettings["textAlign"]) =>
                update({ textAlign })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="center">Centered</SelectItem>
                <SelectItem value="left">Left aligned</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.type !== "redirect" && (
            <>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="confirmation-title">Title</Label>
                <Input
                  id="confirmation-title"
                  value={value.title}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder="Response received"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="confirmation-copy">Message</Label>
                <Textarea
                  id="confirmation-copy"
                  value={value.message}
                  onChange={(event) => update({ message: event.target.value })}
                  className="min-h-[88px]"
                  placeholder="Thanks. Your response has been received."
                />
              </div>
            </>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="confirmation-submit-button-label">
              Form submit button
            </Label>
            <Input
              id="confirmation-submit-button-label"
              value={value.submitButtonLabel}
              onChange={(event) =>
                update({ submitButtonLabel: event.target.value })
              }
              placeholder="Auto: Submit or Continue to payment"
              maxLength={80}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Choose the label shown on the final form action. Leave it blank
              to use a payment-aware default.
            </p>
          </div>

          {value.type !== "message" && (
            <>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="confirmation-redirect">Redirect URL</Label>
                <Input
                  id="confirmation-redirect"
                  type="url"
                  value={value.redirectUrl}
                  onChange={(event) =>
                    update({ redirectUrl: event.target.value })
                  }
                  placeholder="https://example.com/next"
                />
              </div>
              {value.type === "message_redirect" && (
                <div className="space-y-2">
                  <Label htmlFor="confirmation-delay">
                    Redirect delay (seconds)
                  </Label>
                  <Input
                    id="confirmation-delay"
                    type="number"
                    min={0}
                    max={30}
                    value={value.redirectDelay}
                    onChange={(event) =>
                      update({
                        redirectDelay: Math.min(
                          30,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      })
                    }
                  />
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label>Icon</Label>
            <Select
              value={value.icon}
              onValueChange={(icon: FormConfirmationSettings["icon"]) =>
                update({ icon })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="mail">Mail</SelectItem>
                <SelectItem value="heart">Heart</SelectItem>
                <SelectItem value="none">No icon</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmation-accent">Accent</Label>
            <div className="flex gap-2">
              <input
                id="confirmation-accent"
                type="color"
                value={value.accentColor}
                onChange={(event) =>
                  update({ accentColor: event.target.value.toUpperCase() })
                }
                className="h-10 w-11 shrink-0 rounded-md border border-border bg-transparent p-1"
              />
              <Input
                value={value.accentColor}
                onChange={(event) =>
                  update({ accentColor: event.target.value })
                }
                aria-label="Confirmation accent color"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmation-background">Background</Label>
            <div className="flex gap-2">
              <input
                id="confirmation-background"
                type="color"
                value={value.backgroundColor}
                onChange={(event) =>
                  update({ backgroundColor: event.target.value.toUpperCase() })
                }
                className="h-10 w-11 shrink-0 rounded-md border border-border bg-transparent p-1"
              />
              <Input
                value={value.backgroundColor}
                onChange={(event) =>
                  update({ backgroundColor: event.target.value })
                }
                aria-label="Confirmation background color"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation-button-label">Action label</Label>
            <Input
              id="confirmation-button-label"
              value={value.buttonLabel}
              onChange={(event) =>
                update({ buttonLabel: event.target.value })
              }
              placeholder="Visit our website"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmation-button-url">Action URL</Label>
            <Input
              id="confirmation-button-url"
              type="url"
              value={value.buttonUrl}
              onChange={(event) => update({ buttonUrl: event.target.value })}
              placeholder="https://"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-y border-border py-3">
            <div>
              <p className="text-[11px] font-medium">Submit another response</p>
              <p className="text-[10px] text-muted-foreground">
                Let respondents restart the form
              </p>
            </div>
            <Switch
              checked={value.allowAnotherResponse}
              onCheckedChange={(allowAnotherResponse) =>
                update({ allowAnotherResponse })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-y border-border py-3">
            <div>
              <p className="text-[11px] font-medium">Response summary</p>
              <p className="text-[10px] text-muted-foreground">
                Show submitted answers
              </p>
            </div>
            <Switch
              checked={value.showResponseSummary}
              onCheckedChange={(showResponseSummary) =>
                update({ showResponseSummary })
              }
            />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
          Live preview
        </p>
        <div
          className={cn(
            "flex min-h-[360px] border border-border p-8",
            effective.textAlign === "center"
              ? "items-center justify-center text-center"
              : "items-center text-left",
          )}
          style={{ backgroundColor: effective.backgroundColor }}
        >
          <div className="w-full max-w-[320px]">
            {effective.icon !== "none" && (
              <span
                className={cn(
                  "mb-5 inline-flex h-11 w-11 items-center justify-center rounded-md",
                  effective.textAlign === "center" && "mx-auto",
                )}
                style={{
                  backgroundColor: `${effective.accentColor}18`,
                  color: effective.accentColor,
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
            )}
            <h3 className="text-[21px] font-semibold text-neutral-950">
              {effective.type === "redirect"
                ? "Taking you to the next page"
                : effective.title || "Response received"}
            </h3>
            <p className="mt-2 text-[12px] leading-5 text-neutral-600">
              {effective.type === "redirect"
                ? "Your response has been saved."
                : effective.message ||
                  "Thanks. Your response has been received."}
            </p>
            {effective.type !== "message" && (
              <p className="mt-4 flex items-center gap-1.5 text-[10px] text-neutral-500">
                <ExternalLink className="h-3 w-3" />
                {effective.type === "message_redirect"
                  ? `Redirecting in ${effective.redirectDelay} seconds`
                  : "Redirecting now"}
              </p>
            )}
            {effective.buttonLabel && effective.buttonUrl && (
              <span
                className="mt-6 inline-flex h-10 items-center rounded-md px-4 text-[11px] font-medium text-white"
                style={{ backgroundColor: effective.accentColor }}
              >
                {effective.buttonLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
