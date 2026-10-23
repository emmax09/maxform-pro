/**
 * MaxForm pricing: a hybrid model. The subscription unlocks the platform and
 * its core business tools with no volume caps on relationship data (contacts,
 * documents, submissions). Only the resources that directly cost money to run
 * are metered: AI credits, storage, and outbound email volume.
 */

export type PlanId = "trial" | "starter" | "pro" | "business" | "enterprise";

/** A metered allowance. `null` means unlimited. */
export type Allowance = number | null;

export type PlanLimits = {
  /** Bytes of workspace storage. */
  storageBytes: Allowance;
  /** AI credits granted each billing period. */
  aiCredits: Allowance;
  /** Outbound emails included each billing period. */
  emails: Allowance;
  /** How many forms may exist. Never a cap on responses. */
  forms: Allowance;
  /** Seats included. */
  users: Allowance;
};

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in USD. `null` for the custom enterprise tier. */
  monthlyPrice: number | null;
  /** Highlighted on the pricing grid. */
  featured?: boolean;
  /** Trial length in days, when the plan is a trial. */
  trialDays?: number;
  limits: PlanLimits;
  /** Everything this plan adds on top of the one before it. */
  features: string[];
  /** Copy for the primary action. */
  cta: string;
};

const GB = 1024 * 1024 * 1024;

export const PLANS: Plan[] = [
  {
    id: "trial",
    name: "Free trial",
    tagline: "Every feature, no card required",
    monthlyPrice: 0,
    trialDays: 7,
    limits: {
      storageBytes: 2 * GB,
      aiCredits: 500,
      emails: 1000,
      forms: null,
      users: 1,
    },
    features: [
      "CRM & contacts",
      "Forms, documents & file manager",
      "Events, appointments & email campaigns",
      "AI features & workflow automation",
      "Mobile access",
    ],
    cta: "Start free trial",
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "For freelancers and solo founders",
    monthlyPrice: 5.99,
    limits: {
      storageBytes: 10 * GB,
      aiCredits: 2000,
      emails: 5000,
      forms: 5,
      users: 1,
    },
    features: [
      "1 user",
      "CRM & contacts",
      "Forms, documents & file manager",
      "Events & appointments",
      "Email campaigns",
      "Workflow automation",
      "Calendar & dashboard",
      "Mobile access",
    ],
    cta: "Choose Starter",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing businesses",
    monthlyPrice: 12.99,
    featured: true,
    limits: {
      storageBytes: 50 * GB,
      aiCredits: 10000,
      emails: 25000,
      forms: null,
      users: 5,
    },
    features: [
      "5 team members",
      "Unlimited custom forms",
      "Shared calendar & teams",
      "Custom pipelines",
      "Reports",
      "Advanced automation",
      "API access",
      "Branding options",
    ],
    cta: "Choose Pro",
  },
  {
    id: "business",
    name: "Business",
    tagline: "For companies managing multiple teams",
    monthlyPrice: 24.99,
    limits: {
      storageBytes: 250 * GB,
      aiCredits: 50000,
      emails: 100000,
      forms: null,
      users: 20,
    },
    features: [
      "20 users",
      "Advanced permissions",
      "Audit logs",
      "Priority support",
      "Team dashboards",
      "Webhooks",
      "Integrations",
    ],
    cta: "Choose Business",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For organisations with their own requirements",
    monthlyPrice: null,
    limits: {
      storageBytes: null,
      aiCredits: null,
      emails: null,
      forms: null,
      users: null,
    },
    features: [
      "Unlimited users",
      "Unlimited storage",
      "Dedicated infrastructure",
      "Dedicated support & SLA",
      "SSO",
      "Custom integrations",
      "Unlimited API access",
    ],
    cta: "Talk to sales",
  },
];

export type BillingCycle = "monthly" | "yearly";

/** Paying yearly is billed for ten months, so two are free. */
export const YEARLY_FREE_MONTHS = 2;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Total charged once a year, or null when the plan has no fixed price. */
export const yearlyPrice = (plan: Plan) =>
  plan.monthlyPrice === null
    ? null
    : round2(plan.monthlyPrice * (12 - YEARLY_FREE_MONTHS));

/** What the plan works out to per month on the chosen cycle. */
export const effectiveMonthlyPrice = (plan: Plan, cycle: BillingCycle) => {
  if (plan.monthlyPrice === null) return null;
  if (cycle === "monthly") return plan.monthlyPrice;
  const yearly = yearlyPrice(plan);
  return yearly === null ? null : round2(yearly / 12);
};

export const formatPrice = (value: number | null) =>
  value === null ? "Custom" : `$${value.toFixed(2)}`;

export const planById = (id: string): Plan =>
  PLANS.find((plan) => plan.id === id) || PLANS[0];

export const PAID_PLANS = PLANS.filter(
  (plan) => plan.id !== "trial" && plan.id !== "enterprise",
);

/** What never has a cap, on any plan, including the trial. */
export const UNCAPPED = [
  "Form responses & submissions",
  "Contacts",
  "Documents",
  "Events & ticket sales",
] as const;

export type AddOnPack = {
  id: string;
  label: string;
  price: number;
  /** Units granted: credits, bytes, or emails depending on the group. */
  units: number;
  /** Monthly recurring rather than a one-time purchase. */
  recurring?: boolean;
};

export const AI_CREDIT_PACKS: AddOnPack[] = [
  { id: "ai-1k", label: "1,000 credits", price: 2.99, units: 1000 },
  { id: "ai-5k", label: "5,000 credits", price: 9.99, units: 5000 },
  { id: "ai-10k", label: "10,000 credits", price: 17.99, units: 10000 },
  { id: "ai-50k", label: "50,000 credits", price: 69.99, units: 50000 },
];

/** Purchased credits stay usable for this long while the plan is active. */
export const CREDIT_ROLLOVER_DAYS = 90;

export const STORAGE_PACKS: AddOnPack[] = [
  { id: "storage-10", label: "+10 GB", price: 1.99, units: 10 * GB, recurring: true },
  { id: "storage-50", label: "+50 GB", price: 4.99, units: 50 * GB, recurring: true },
  { id: "storage-100", label: "+100 GB", price: 7.99, units: 100 * GB, recurring: true },
  { id: "storage-500", label: "+500 GB", price: 24.99, units: 500 * GB, recurring: true },
];

export const EMAIL_PACKS: AddOnPack[] = [
  { id: "email-10k", label: "10,000 emails", price: 3.99, units: 10000 },
  { id: "email-50k", label: "50,000 emails", price: 14.99, units: 50000 },
  { id: "email-100k", label: "100,000 emails", price: 24.99, units: 100000 },
];

/**
 * What each AI action draws from the credit pool. Published so a workspace can
 * see where its credits went instead of guessing.
 */
export const AI_CREDIT_COSTS: Array<{
  action: string;
  credits: number;
  where: string;
}> = [
  { action: "Generate a form", credits: 10, where: "Forms" },
  { action: "Generate a workflow", credits: 10, where: "Automations" },
  { action: "Summarize a contact", credits: 2, where: "CRM assistant" },
  { action: "Score a lead", credits: 2, where: "CRM assistant" },
  { action: "Predict deal outcome", credits: 5, where: "CRM assistant" },
  { action: "Draft an email", credits: 3, where: "Email campaigns" },
  { action: "Detect duplicate contacts", credits: 1, where: "CRM" },
];

/**
 * Outbound email and the plan allowance.
 *
 * A workspace sends through its own connected provider (Resend, SMTP, …) and
 * is billed by that provider directly, so those sends do not draw down the
 * plan allowance. The allowance covers sending on MaxForm's shared sender.
 */
export const EMAIL_ALLOWANCE_RULE =
  "Sends through your own connected provider are billed by that provider and do not count against this allowance.";

export const formatPlanPrice = (plan: Plan) =>
  plan.monthlyPrice === null
    ? "Custom"
    : `$${plan.monthlyPrice.toFixed(2)}`;

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const gb = bytes / GB;
  if (gb >= 1) return `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
};

export const formatAllowance = (
  value: Allowance,
  kind: "bytes" | "count",
) => {
  if (value === null) return "Unlimited";
  return kind === "bytes" ? formatBytes(value) : value.toLocaleString();
};

/** Percentage of an allowance consumed, capped at 100. Unlimited reads 0. */
export const usagePercent = (used: number, allowance: Allowance) => {
  if (allowance === null || allowance <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, used) / allowance) * 100));
};

export const remainingAllowance = (used: number, allowance: Allowance) =>
  allowance === null ? null : Math.max(0, allowance - Math.max(0, used));
