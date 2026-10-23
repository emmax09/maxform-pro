/**
 * New-user onboarding.
 *
 * Six short steps, one question-set each, in the order someone can actually
 * answer them: who you are, how you look, what you want, which tools, where you
 * are, and a confirmation. Each step saves on the way out, so closing the tab
 * halfway resumes here rather than starting over.
 *
 * Two steps are load-bearing rather than survey filler:
 *
 *  - Brand. The colour and logo are what every published surface renders from,
 *    so they are collected up front and written through to the workspace's
 *    company_settings on completion. The colour is deliberately not pre-filled:
 *    a default would turn a required question into one you click past.
 *  - Address. This is the postal address marketing email is legally required to
 *    carry, asked once here instead of blocking someone later at the moment
 *    they are trying to send their first campaign.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  MapPin,
  Palette,
  PartyPopper,
  Pipette,
  Blocks,
  Target,
  Upload,
  type LucideIcon,
} from "lucide-react";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnboardingAnswers, OnboardingState } from "@/lib/onboarding";
import { DEFAULT_BRAND_COLOR } from "@/lib/brand-color";
import { cn } from "@/lib/utils";

const steps: Array<{
  key: string;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}> = [
  {
    key: "business",
    label: "Business",
    title: "Tell us about your business",
    subtitle: "This names your workspace and signs the email you send.",
    icon: Building2,
  },
  {
    key: "brand",
    label: "Brand",
    title: "Set up your brand",
    subtitle:
      "Your colour and logo carry across every form, ticket, invoice and campaign you send. We need these before you publish anything.",
    icon: Palette,
  },
  {
    key: "goals",
    label: "Goals",
    title: "What do you want to get done?",
    subtitle: "Pick as many as apply. It shapes what we put in front of you.",
    icon: Target,
  },
  {
    key: "modules",
    label: "Tools",
    title: "Which tools do you need first?",
    subtitle: "Everything stays available — this just sets your starting point.",
    icon: Blocks,
  },
  {
    key: "address",
    label: "Address",
    title: "Where is your business based?",
    subtitle:
      "Marketing email is required by law to carry a physical address. We add it to your campaign footer so you are covered from day one.",
    icon: MapPin,
  },
  {
    key: "done",
    label: "Finish",
    title: "You are all set",
    subtitle: "Here is what we have. You can change any of it later in Settings.",
    icon: PartyPopper,
  },
];

const businessTypes = [
  "Agency",
  "E-commerce",
  "Education",
  "Events",
  "Freelance / solo",
  "Hospitality",
  "Non-profit",
  "Professional services",
  "SaaS / software",
  "Other",
];

const teamSizes = ["Just me", "2–10", "11–50", "51–200", "200+"];

const goalOptions = [
  { value: "collect-responses", label: "Collect form responses" },
  { value: "sell-tickets", label: "Sell event tickets" },
  { value: "take-payments", label: "Take payments online" },
  { value: "grow-list", label: "Grow an email list" },
  { value: "run-campaigns", label: "Run email campaigns" },
  { value: "manage-leads", label: "Manage leads and deals" },
  { value: "get-signatures", label: "Get documents signed" },
  { value: "understand-data", label: "Understand my data" },
];

const moduleOptions = [
  { value: "forms", label: "Forms", hint: "Build and share forms" },
  { value: "events", label: "Events", hint: "Tickets and attendees" },
  { value: "payments", label: "Payments", hint: "Checkout and orders" },
  { value: "crm", label: "CRM", hint: "Contacts, leads, deals" },
  { value: "campaigns", label: "Campaigns", hint: "Marketing email" },
  { value: "documents", label: "Documents", hint: "E-signatures" },
];

const referralSources = [
  "Search engine",
  "Social media",
  "A friend or colleague",
  "An event or webinar",
  "An article or newsletter",
  "Other",
];

/**
 * A starting palette, not a restriction — the picker beside it takes any hex.
 * These are chosen to stay legible as a button colour on white, which is what
 * a brand colour is mostly used for here.
 */
const brandSwatches = [
  DEFAULT_BRAND_COLOR,
  "#635BFF",
  "#0F766E",
  "#DB2777",
  "#EA580C",
  "#16A34A",
  "#7C3AED",
  "#0F172A",
];

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Neutral stand-in so the preview reads as "not chosen yet", not as a choice. */
const UNSET_BRAND_PREVIEW = "#94A3B8";

/** Initials stand in for a logo until there is one, so the preview is never empty. */
const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("") || "?";

function StepRail({ activeIndex }: { activeIndex: number }) {
  return (
    <ol
      aria-label="Setup steps"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                current
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : (
                <step.icon className="h-3 w-3" />
              )}
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span className="hidden h-px w-3 bg-border sm:block" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A large, tappable multi-select tile. */
function ChoiceTile({
  label,
  hint,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={cn(
        "flex min-h-[62px] w-full items-start gap-2.5 rounded-xl border p-3.5 text-left transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-xs"
          : "border-border hover:border-muted-foreground/40 hover:bg-accent/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40",
        )}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight">
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function OnboardingFlow({
  initial,
  onSaveStep,
  onComplete,
  onSkip,
  fullName,
}: {
  initial: OnboardingState;
  onSaveStep: (answers: OnboardingAnswers) => Promise<unknown>;
  onComplete: (answers: OnboardingAnswers) => Promise<unknown>;
  onSkip: () => Promise<unknown>;
  fullName?: string;
}) {
  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(steps.length - 1, Math.max(0, initial.currentStep)),
  );
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    businessName: initial.businessName,
    businessType: initial.businessType,
    industry: initial.industry,
    // Deliberately not defaulted. A pre-filled colour would make the "required"
    // brand question something you click past without ever choosing.
    brandColor: initial.brandColor,
    logoUrl: initial.logoUrl,
    teamSize: initial.teamSize,
    websiteUrl: initial.websiteUrl,
    addressLine1: initial.addressLine1,
    addressLine2: initial.addressLine2,
    city: initial.city,
    stateRegion: initial.stateRegion,
    postalCode: initial.postalCode,
    country: initial.country,
    goals: initial.goals,
    modules: initial.modules,
    referralSource: initial.referralSource,
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const step = steps[stepIndex];
  const patch = (next: OnboardingAnswers) => {
    setError("");
    setAnswers((current) => ({ ...current, ...next }));
  };
  const toggle = (key: "goals" | "modules", value: string) => {
    const current = answers[key] || [];
    patch({
      [key]: current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    });
  };

  useEffect(() => {
    // Each step starts at the top on small screens, where the panel scrolls.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepIndex]);

  // Two things are genuinely required. The business name names the workspace
  // and signs outgoing email; the brand colour is what every published surface
  // renders from, so finishing without it would leave forms, tickets and
  // campaigns looking unconfigured. Everything else can wait.
  const blocked = useMemo(() => {
    if (step.key === "business" && !answers.businessName?.trim()) {
      return "Add your business or workspace name to continue.";
    }
    if (
      step.key === "brand" &&
      !/^#[0-9A-Fa-f]{6}$/.test(answers.brandColor || "")
    ) {
      return "Choose the colour that represents your brand.";
    }
    return "";
  }, [answers.brandColor, answers.businessName, step.key]);

  const advance = async () => {
    if (blocked) {
      setError(blocked);
      return;
    }
    setWorking(true);
    try {
      const last = stepIndex === steps.length - 1;
      if (last) {
        await onComplete({ ...answers, currentStep: stepIndex });
      } else {
        await onSaveStep({ ...answers, currentStep: stepIndex + 1 });
        setStepIndex(stepIndex + 1);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  };

  const summary = [
    ["Business", answers.businessName || "Not set"],
    ["Type", answers.businessType || "Not set"],
    ["Team", answers.teamSize || "Not set"],
    [
      "Brand",
      `${answers.brandColor || "Not chosen"}${
        answers.logoUrl ? " · logo added" : " · initials"
      }`,
    ],
    [
      "Goals",
      answers.goals?.length
        ? `${answers.goals.length} selected`
        : "None yet",
    ],
    [
      "Address",
      [answers.addressLine1, answers.city, answers.country]
        .filter(Boolean)
        .join(", ") || "Not added yet",
    ],
  ] as const;

  return (
    <div className="min-h-dvh bg-muted/30 px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[680px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <BrandLogo markSize={18} wordmarkClassName="text-[13px]" />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Step {stepIndex + 1} of {steps.length} · about a minute
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={working}
            onClick={() => void onSkip()}
          >
            Skip for now
          </Button>
        </header>

        <div className="mb-5">
          <StepRail activeIndex={stepIndex} />
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-7">
          <div className="mb-5">
            <h1 className="text-[20px] font-semibold tracking-tight sm:text-[23px]">
              {stepIndex === 0 && fullName
                ? `Welcome, ${fullName.split(" ")[0]}`
                : step.title}
            </h1>
            <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">
              {stepIndex === 0 && fullName ? step.title + "." : ""}{" "}
              {step.subtitle}
            </p>
          </div>

          {step.key === "business" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-business-name">
                  Business or workspace name
                </Label>
                <Input
                  id="onboarding-business-name"
                  value={answers.businessName || ""}
                  onChange={(event) =>
                    patch({ businessName: event.target.value })
                  }
                  placeholder="Acme Events"
                  autoFocus
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-business-type">
                    What kind of business?
                  </Label>
                  <Select
                    value={answers.businessType || ""}
                    onValueChange={(value) => patch({ businessType: value })}
                  >
                    <SelectTrigger id="onboarding-business-type">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {businessTypes.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-team-size">How many of you?</Label>
                  <Select
                    value={answers.teamSize || ""}
                    onValueChange={(value) => patch({ teamSize: value })}
                  >
                    <SelectTrigger id="onboarding-team-size">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamSizes.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-website">Website (optional)</Label>
                <Input
                  id="onboarding-website"
                  value={answers.websiteUrl || ""}
                  onChange={(event) => patch({ websiteUrl: event.target.value })}
                  placeholder="acmeevents.com"
                />
              </div>
            </div>
          ) : null}

          {step.key === "brand" ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label id="onboarding-brand-color-label">Brand colour</Label>
                <div
                  role="radiogroup"
                  aria-labelledby="onboarding-brand-color-label"
                  className="flex flex-wrap gap-2"
                >
                  {brandSwatches.map((swatch) => {
                    const active =
                      (answers.brandColor || "").toUpperCase() === swatch;
                    return (
                      <button
                        key={swatch}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`Brand colour ${swatch}`}
                        onClick={() => patch({ brandColor: swatch })}
                        style={{ backgroundColor: swatch }}
                        className={cn(
                          "h-9 w-9 rounded-full transition-all",
                          active
                            ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                            : "ring-1 ring-border hover:scale-105",
                        )}
                      />
                    );
                  })}
                  {/* Reads as "pick your own", not as a ninth preset: the
                      conic wheel and pipette keep it distinct from the swatch
                      that is currently selected. */}
                  <label
                    title="Use your own colour"
                    className="relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-border transition-transform hover:scale-105"
                    style={{
                      background:
                        "conic-gradient(#EF4444, #F59E0B, #22C55E, #06B6D4, #3B82F6, #A855F7, #EF4444)",
                    }}
                  >
                    <span className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full bg-background/90">
                      <Pipette className="h-3 w-3" />
                    </span>
                    <input
                      aria-label="Custom brand colour"
                      type="color"
                      value={answers.brandColor || DEFAULT_BRAND_COLOR}
                      onChange={(event) =>
                        patch({ brandColor: event.target.value.toUpperCase() })
                      }
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  {answers.brandColor ? (
                    <span className="flex h-9 items-center rounded-full border border-border px-2.5 font-mono text-[11px] text-muted-foreground">
                      {answers.brandColor}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="onboarding-logo">Logo (optional)</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="onboarding-logo"
                    className="flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-3 transition-colors hover:border-muted-foreground/50 hover:bg-accent/30"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {answers.logoUrl ? (
                        <img
                          src={answers.logoUrl}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">
                        {answers.logoUrl ? "Logo added" : "Upload your logo"}
                      </span>
                      <span className="block text-[10.5px] leading-4 text-muted-foreground">
                        PNG, JPG, WebP or SVG up to 2 MB. Skip it and we use
                        your initials until you have one.
                      </span>
                    </span>
                  </label>
                  <input
                    id="onboarding-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > MAX_LOGO_BYTES) {
                        setError("Choose a logo smaller than 2 MB.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () =>
                        patch({ logoUrl: String(reader.result || "") });
                      reader.readAsDataURL(file);
                    }}
                  />
                  {answers.logoUrl ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => patch({ logoUrl: "" })}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* The preview is the point of the step: it shows what the colour
                  and logo actually do before they are committed. */}
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  How it will look
                </p>
                <div className="overflow-hidden rounded-xl border border-border">
                  <div
                    className="flex items-center gap-2.5 px-4 py-3"
                    style={{ backgroundColor: answers.brandColor || UNSET_BRAND_PREVIEW }}
                  >
                    {answers.logoUrl ? (
                      <img
                        src={answers.logoUrl}
                        alt=""
                        className="h-7 w-7 rounded-md bg-white/90 object-contain p-0.5"
                      />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-[11px] font-semibold text-white">
                        {monogram(answers.businessName || "")}
                      </span>
                    )}
                    <span className="truncate text-[13px] font-semibold text-white">
                      {answers.businessName || "Your business"}
                    </span>
                  </div>
                  <div className="space-y-2.5 bg-background px-4 py-4">
                    <p className="text-[12px] text-muted-foreground">
                      This is how a form, ticket, or campaign from you will be
                      headed.
                    </p>
                    <span
                      className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-white"
                      style={{
                        backgroundColor: answers.brandColor || UNSET_BRAND_PREVIEW,
                      }}
                    >
                      Primary action
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step.key === "goals" ? (
            <div
              role="group"
              aria-label="Goals"
              className="grid gap-2.5 sm:grid-cols-2"
            >
              {goalOptions.map((option) => (
                <ChoiceTile
                  key={option.value}
                  label={option.label}
                  selected={(answers.goals || []).includes(option.value)}
                  onToggle={() => toggle("goals", option.value)}
                />
              ))}
            </div>
          ) : null}

          {step.key === "modules" ? (
            <div
              role="group"
              aria-label="Tools"
              className="grid gap-2.5 sm:grid-cols-2"
            >
              {moduleOptions.map((option) => (
                <ChoiceTile
                  key={option.value}
                  label={option.label}
                  hint={option.hint}
                  selected={(answers.modules || []).includes(option.value)}
                  onToggle={() => toggle("modules", option.value)}
                />
              ))}
            </div>
          ) : null}

          {step.key === "address" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-address1">Street address</Label>
                <Input
                  id="onboarding-address1"
                  value={answers.addressLine1 || ""}
                  onChange={(event) =>
                    patch({ addressLine1: event.target.value })
                  }
                  placeholder="1 Example Street"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-address2">
                  Suite, floor, unit (optional)
                </Label>
                <Input
                  id="onboarding-address2"
                  value={answers.addressLine2 || ""}
                  onChange={(event) =>
                    patch({ addressLine2: event.target.value })
                  }
                  placeholder="Suite 400"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-city">City</Label>
                  <Input
                    id="onboarding-city"
                    value={answers.city || ""}
                    onChange={(event) => patch({ city: event.target.value })}
                    placeholder="Lagos"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-state">State or region</Label>
                  <Input
                    id="onboarding-state"
                    value={answers.stateRegion || ""}
                    onChange={(event) =>
                      patch({ stateRegion: event.target.value })
                    }
                    placeholder="Lagos State"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-postal">Postal code</Label>
                  <Input
                    id="onboarding-postal"
                    value={answers.postalCode || ""}
                    onChange={(event) =>
                      patch({ postalCode: event.target.value })
                    }
                    placeholder="100001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboarding-country">Country</Label>
                  <Input
                    id="onboarding-country"
                    value={answers.country || ""}
                    onChange={(event) => patch({ country: event.target.value })}
                    placeholder="Nigeria"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step.key === "done" ? (
            <div className="space-y-5">
              <dl className="divide-y divide-border rounded-xl border border-border">
                {summary.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 py-2.5"
                  >
                    <dt className="text-[11px] uppercase tracking-[.06em] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="max-w-[62%] text-right text-[12.5px]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-referral">
                  How did you hear about us? (optional)
                </Label>
                <Select
                  value={answers.referralSource || ""}
                  onValueChange={(value) => patch({ referralSource: value })}
                >
                  <SelectTrigger id="onboarding-referral">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {referralSources.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive"
            >
              {error}
            </p>
          ) : null}
        </section>

        <footer className="mt-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={working || stepIndex === 0}
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button type="button" disabled={working} onClick={() => void advance()}>
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : stepIndex === steps.length - 1 ? (
              <Check className="h-4 w-4" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {stepIndex === steps.length - 1 ? "Go to my workspace" : "Continue"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
