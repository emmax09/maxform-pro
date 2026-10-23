import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ContactRound,
  CreditCard,
  Database,
  FileText,
  Home,
  LayoutGrid,
  Lock,
  Plus,
  Search,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  AI_CREDIT_COSTS,
  AI_CREDIT_PACKS,
  CREDIT_ROLLOVER_DAYS,
  EMAIL_ALLOWANCE_RULE,
  EMAIL_PACKS,
  PAID_PLANS,
  STORAGE_PACKS,
  UNCAPPED,
  YEARLY_FREE_MONTHS,
  effectiveMonthlyPrice,
  formatAllowance,
  formatPrice,
  planById,
  yearlyPrice,
  type BillingCycle,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import {
  Container,
  Eyebrow,
  H2,
  MarketingPage,
  Reveal,
} from "@/components/marketing/MarketingChrome";

const PAYMENT_RAILS = [
  { name: "Stripe", logo: "/logos/stripe.jpeg" },
  { name: "Paystack", logo: "/logos/paystack.jpeg" },
  { name: "Flutterwave", logo: "/logos/flutterwave.jpeg" },
  { name: "Opay", logo: "/logos/opay.png" },
  { name: "PayPal", logo: "/logos/paypal.jpg" },
];

const WORKFLOW_DEMO_STATES = [
  {
    label: "Workflow ready to run",
    detail: "Waiting for the next response",
    dotClass: "bg-primary",
    duration: 6000,
  },
  {
    label: "Automation running",
    detail: "Sending email and updating CRM",
    dotClass: "bg-primary",
    duration: 6500,
  },
  {
    label: "Workflow completed",
    detail: "All actions finished successfully",
    dotClass: "bg-success",
    duration: 5500,
  },
] as const;

/**
 * Plan features stay collapsed so every card is the same short height. The
 * list is real markup, just hidden, so it stays available to search and to
 * assistive tech through the disclosure button.
 */
function PlanFeatures({
  features,
  planId,
}: {
  features: string[];
  planId: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = `plan-features-${planId}`;
  return (
    <div className="my-5">
      <button
        type="button"
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-[12px] font-medium text-foreground transition-colors hover:text-[hsl(var(--primary-text))]"
      >
        What&apos;s included
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul id={listId} className="mt-3 space-y-2.5">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-[13px] text-muted-foreground"
            >
              <Check
                className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary-text))]"
                strokeWidth={2.5}
              />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Landing = () => {
  const [openStep, setOpenStep] = useState(0);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [workflowDemoIndex, setWorkflowDemoIndex] = useState(0);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(
      () => setWorkflowDemoIndex((current) => (current + 1) % WORKFLOW_DEMO_STATES.length),
      WORKFLOW_DEMO_STATES[workflowDemoIndex].duration,
    );
    return () => window.clearTimeout(timer);
  }, [workflowDemoIndex]);

  const workflowDemo = WORKFLOW_DEMO_STATES[workflowDemoIndex];

  const steps = [
    {
      title: "Build and publish",
      body: "Start from a template or drag in any of 40+ field types. Add conditional logic, validation, and your own branding, then ship to a link, your domain, or an embed.",
    },
    {
      title: "Automate on submit",
      body: "The moment someone submits, MaxForm gets to work: routing approvals, sending email, firing webhooks, taking payment, and creating the contact record.",
    },
    {
      title: "Track and grow",
      body: "Every response lands in smart tables and your built-in CRM. Filter, export, and watch completion rates so you know exactly what to tune next.",
    },
  ];

  const testimonials = [
    {
      quote:
        "We replaced four separate tools with MaxForm. Onboarding now runs itself from the moment a client submits the intake form.",
      name: "Amara Chukwu",
      role: "Operations Lead, Solace",
      initials: "AC",
    },
    {
      quote:
        "Built-in payments and CRM meant we launched event registration in an afternoon instead of a whole sprint.",
      name: "Daniel Osei",
      role: "Founder, Kepler Events",
      initials: "DO",
    },
    {
      quote:
        "Conditional logic and automated approvals cut our HR request turnaround from days down to a couple of hours.",
      name: "Priya Nandan",
      role: "People Ops, Northwind",
      initials: "PN",
    },
  ];

  return (
    <MarketingPage>
      {/* ============================ HERO ============================= */}
      {/*
        HERO: a full-bleed Onyx band in BOTH themes (marked .on-ink so the
        semantic tokens resolve against a dark surface). Deliberately flat:
        the brand system forbids gradient / glowing backgrounds, so depth
        comes from the elevated product panel rather than a colour wash.
      */}
      <section className="on-ink relative flex items-center overflow-hidden bg-[hsl(var(--ls-ink))] pb-16 pt-[108px] sm:pb-24 sm:pt-[144px] lg:min-h-[880px] lg:pb-28 lg:pt-[150px]">
        <Container className="relative">
          <div className="grid items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10">
            {/* copy */}
            <div>
              <Reveal>
                <Link
                  to="/auth"
                  className="group inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/6 py-1 pl-1 pr-3 text-[11.5px] text-white/70 transition-colors hover:border-white/30 sm:text-[12.5px]"
                >
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                    New
                  </span>
                  <span className="truncate">Automations that run after submit</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Reveal>

              <Reveal delay={70}>
                <h1 className="mt-5 text-[clamp(2rem,9vw,3rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-white sm:mt-6 sm:text-[clamp(2.15rem,4.1vw,3rem)]">
                  <span className="whitespace-nowrap">Build forms.</span>{" "}
                  <span className="whitespace-nowrap">Run events.</span>{" "}
                  <span className="whitespace-nowrap text-primary">Collect payments.</span>
                </h1>
              </Reveal>

              <Reveal delay={130}>
                <p className="mt-5 max-w-[460px] text-pretty text-[16px] leading-[1.6] text-white/70 sm:mt-6 sm:text-[17px]">
                  Build forms, launch events, sell tickets, and collect payments from one
                  workspace. MaxForm automates every follow-up and keeps your responses,
                  customers, and revenue connected.
                </p>
              </Reveal>

              <Reveal delay={190}>
                <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:items-center">
                  <Link
                    to="/auth"
                    className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-7 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))] sm:h-12 sm:text-[15px]"
                  >
                    Start for free
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    to="/#features"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-white px-7 text-[14px] font-semibold text-[hsl(var(--ls-ink))] transition-opacity hover:opacity-90 sm:h-12 sm:text-[15px]"
                  >
                    Explore
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={250}>
                <div className="mt-6 flex w-full items-center justify-between gap-1.5 sm:mt-7 sm:justify-start sm:gap-x-7">
                  {["Free trial included", "No submission limits", "Cancel anytime"].map((f) => (
                    <span
                      key={f}
                      className="flex whitespace-nowrap items-center gap-1.5 text-[9px] text-white/55 min-[360px]:text-[10px] sm:gap-2 sm:text-[13.5px]"
                    >
                      <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-primary sm:h-1 sm:w-1" />
                      {f}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            {/* visual: brand frame + product panel + portrait + status pill */}
            <Reveal delay={160}>
              <div className="relative mx-auto w-full max-w-[680px] lg:max-w-none">
                {/*
                  Offset outline behind the panel, echoing the reference
                  layout. Drawn as a bordered box in the brand colour rather
                  than a gradient, per the brand system.
                */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 hidden rounded-[28px] border border-primary/40 sm:block lg:-inset-5"
                />
              {/*
                Mirrors the real signed-in home screen (see
                components/dashboard/HomeDashboard.tsx + AppSidebar.tsx): same
                headline, metric tiles, and nav, rebuilt in markup so it stays
                sharp at any size and follows the active theme.
              */}
                <div className="on-surface ls-elevate overflow-hidden rounded-2xl border border-border bg-card">
                  {/* window chrome */}
                  <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/50 px-3.5">
                    <div className="flex gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-foreground/15" />
                      <span className="h-2 w-2 rounded-full bg-foreground/15" />
                      <span className="h-2 w-2 rounded-full bg-foreground/15" />
                    </div>
                    <div className="ml-2 flex h-5 max-w-[220px] flex-1 items-center truncate rounded border border-border bg-background px-2 text-[10px] text-muted-foreground">
                      maxform.com/dashboard
                    </div>
                  </div>

                  <div className="flex">
                    {/* sidebar */}
                    <aside className="hidden w-[148px] shrink-0 border-r border-border bg-muted/25 py-3 sm:block">
                      <div className="px-3 pb-3">
                        <BrandLogo markSize={13} wordmarkClassName="text-[11px]" />
                      </div>
                      <nav className="space-y-0.5 px-2">
                        {[
                          { icon: Home, label: "Home", active: true },
                          { icon: LayoutGrid, label: "Projects" },
                          { icon: FileText, label: "Forms" },
                          { icon: Workflow, label: "Workflows" },
                          { icon: CreditCard, label: "Payments" },
                          { icon: Users, label: "Contacts" },
                          { icon: BarChart3, label: "Analytics" },
                          { icon: Settings, label: "Settings" },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className={cn(
                              "flex items-center gap-2 rounded px-2 py-[5px] text-[11px]",
                              item.active
                                ? "bg-[hsl(var(--surface-selected))] font-medium text-[hsl(var(--primary-text))]"
                                : "text-muted-foreground",
                            )}
                          >
                            <item.icon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                            <span className="truncate">{item.label}</span>
                          </div>
                        ))}
                      </nav>
                    </aside>

                    {/* main panel */}
                    <div className="min-w-0 flex-1">
                      <div className="border-b border-border p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-[hsl(var(--primary-subtle))] text-[9px] font-semibold text-[hsl(var(--primary-text))]">
                              MF
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-medium leading-4 text-foreground">
                                MaxForm Studio
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">Pro workspace</p>
                            </div>
                          </div>
                          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                            <span className="flex h-6 items-center gap-1.5 rounded border border-border px-2 text-[10px] text-muted-foreground">
                              <Search className="h-2.5 w-2.5" />
                              Search
                            </span>
                            <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
                              <Plus className="h-3 w-3" />
                            </span>
                          </div>
                        </div>

                        <h3 className="mt-4 text-[17px] font-semibold leading-tight tracking-tight text-foreground sm:text-[19px]">
                          Your workspace, at a glance.
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                          <span>Mon, 28 Jul</span>
                          <span className="h-0.5 w-0.5 rounded-full bg-border" />
                          <span className="inline-flex items-center gap-1 text-success">
                            <span className="h-1 w-1 rounded-full bg-success" />
                            All systems normal
                          </span>
                        </div>
                      </div>

                      {/* metric tiles */}
                      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-4">
                        {[
                          { icon: FileText, label: "Forms", value: "24" },
                          { icon: ContactRound, label: "Responses", value: "12,480" },
                          { icon: Workflow, label: "Workflows", value: "8" },
                          { icon: Check, label: "Setup", value: "3/3" },
                        ].map((m, i) => (
                          <div
                            key={m.label}
                            className={cn(
                              "min-w-0 p-3.5",
                              i % 2 === 1 && "border-l border-border",
                              i > 1 && "border-t border-border",
                              "lg:border-t-0 lg:border-l",
                              i === 0 && "lg:border-l-0",
                            )}
                          >
                            <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground">
                              <m.icon className="h-3 w-3" strokeWidth={1.75} />
                            </span>
                            <p className="mt-2.5 truncate text-[10px] text-muted-foreground">{m.label}</p>
                            <p className="mt-0.5 truncate text-[17px] font-semibold leading-none text-foreground">
                              {m.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* recent activity */}
                      <div className="hidden p-4 sm:block sm:p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-foreground">Recent activity</p>
                          <span className="text-[10px] text-muted-foreground">Live</span>
                        </div>
                        <div className="space-y-0">
                          {[
                            { label: "Customer intake", meta: "Payment captured · $500.00" },
                            { label: "Event signup", meta: "Contact created" },
                            { label: "Leave request", meta: "Awaiting approval" },
                          ].map((row, i, arr) => (
                            <div
                              key={row.label}
                              className={cn(
                                "flex items-center gap-2.5 py-2.5",
                                i !== arr.length - 1 && "border-b border-border",
                              )}
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                                <FileText className="h-3 w-3" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium text-foreground">
                                  {row.label}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {row.meta}
                                </span>
                              </span>
                              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="absolute -bottom-3 left-5 z-20 hidden items-center gap-2 rounded-full border border-white/10 bg-[hsl(var(--brand-onyx))]/95 px-3 py-1.5 text-[10px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md sm:inline-flex">
                  <span className="relative flex h-2 w-2">
                    {workflowDemoIndex === 1 && (
                      <span className="absolute inset-0 rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                    )}
                    <span className={cn("relative h-2 w-2 rounded-full", workflowDemo.dotClass)} />
                  </span>
                  Live automation
                </div>

                {/* Brand-matched, full-body portrait with a transparent edge-safe cutout. */}
                <div className="pointer-events-none absolute bottom-[-430px] right-[-150px] z-10 hidden w-[560px] select-none lg:block xl:bottom-[-560px] xl:right-[-200px] xl:w-[745px]">
                  <img
                    src="/images/home-person-brand.png"
                    alt=""
                    aria-hidden
                    loading="eager"
                    className="h-auto w-full object-contain object-bottom"
                  />
                </div>

                {/*
                  Wide status pill overlapping the panel, matching the
                  reference. Built in markup so it themes with the brand
                  instead of shipping a flat image.
                */}
                <div className="relative z-20 mx-auto mt-3 flex min-h-[52px] w-[calc(100%-1rem)] max-w-[320px] items-center gap-2.5 rounded-xl border border-border bg-card/95 py-2 pl-3.5 pr-2 shadow-xs backdrop-blur-md sm:absolute sm:-left-6 sm:bottom-28 sm:mx-0 sm:mt-0 sm:min-h-[62px] sm:w-[min(330px,86%)] sm:max-w-none sm:gap-3 sm:rounded-full sm:border-primary/35 sm:bg-[hsl(var(--primary-subtle))]/95 sm:py-2.5 sm:pl-4 sm:shadow-[0_10px_30px_-7px_rgba(0,0,0,0.42)] lg:left-28 lg:bottom-36">
                  <span className="flex min-w-0 flex-1 items-center gap-2.5" aria-live="polite">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      {workflowDemoIndex === 1 && (
                        <span className="absolute inset-0 rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                      )}
                      <span className={cn("relative h-2.5 w-2.5 rounded-full", workflowDemo.dotClass)} />
                    </span>
                    <span
                      key={workflowDemo.label}
                      className="flex min-w-0 flex-col animate-in fade-in slide-in-from-bottom-1 duration-500 motion-reduce:animate-none"
                    >
                      <span className="truncate text-[12px] font-semibold leading-4 text-foreground sm:text-[13px]">
                        {workflowDemo.label}
                      </span>
                      <span className="mt-0.5 truncate text-[9.5px] leading-3.5 text-muted-foreground">
                        {workflowDemo.detail}
                      </span>
                    </span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:h-9 sm:w-9 sm:rounded-full">
                    <Workflow
                      className={cn("h-4 w-4", workflowDemoIndex === 1 && "motion-safe:animate-pulse")}
                      strokeWidth={2.25}
                    />
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ==================== PAYMENT RAILS STRIP ===================== */}
      <section className="border-y border-border bg-[hsl(var(--ls-tint))]">
        <Container className="py-12 sm:py-16 lg:py-20">
          <Reveal>
            <div className="flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
              <p className="max-w-[280px] text-[14px] leading-[1.6] text-muted-foreground lg:text-left">
                Take payments on the rails your customers already trust
              </p>
              <div
                role="region"
                aria-label="Supported payment providers"
                tabIndex={0}
                className="-mx-5 flex snap-x snap-mandatory items-center gap-7 overflow-x-auto px-5 pb-2 scroll-px-5 scrollbar-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-x-10 sm:gap-y-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:gap-x-12"
              >
                {PAYMENT_RAILS.map((rail) => (
                  <div key={rail.name} className="group/rail flex min-w-max snap-start items-center gap-2.5">
                    <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-md border border-border bg-[hsl(var(--surface))] p-1.5">
                      <img
                        src={rail.logo}
                        alt=""
                        aria-hidden
                        className="h-full w-full object-contain"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    </span>
                    <span className="text-[14px] font-medium text-foreground/80">{rail.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* =========================== FEATURES ========================= */}
      <section id="features" className="py-20 sm:py-28 lg:py-36">
        <Container>
          <Reveal className="max-w-[620px]">
            <Eyebrow>Why MaxForm</Eyebrow>
            <H2>Everything you're paying five tools for, in one.</H2>
            <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
              Most builders stop at collecting the response. MaxForm keeps going, so the follow-up,
              the money, and the record all happen without you.
            </p>
          </Reveal>

          <p className="mt-6 inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground sm:hidden">
            Swipe to explore
            <ArrowRight className="h-3.5 w-3.5" />
          </p>

          <div
            role="region"
            aria-label="MaxForm features"
            tabIndex={0}
            className="-mx-5 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 scroll-px-5 scrollbar-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:mt-12 sm:grid sm:grid-cols-2 sm:gap-px sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:bg-border sm:px-0 sm:pb-0 lg:mt-16 lg:grid-cols-3"
          >
            {[
              {
                icon: LayoutGrid,
                title: "Visual form builder",
                desc: "Drag in 40+ field types, branch with conditional logic, and match your brand exactly. No code at any point.",
              },
              {
                icon: Workflow,
                title: "Workflow automation",
                desc: "Approvals, emails, webhooks, and tasks fire the instant a response lands. Chain as many as you need.",
              },
              {
                icon: CreditCard,
                title: "Global payments",
                desc: "Stripe, Paystack, Flutterwave, Opay, and PayPal built in. Charge in the currency your customer expects.",
              },
              {
                icon: Database,
                title: "Built-in CRM",
                desc: "Every submission becomes a contact record with full history, notes, and tags. No sync, no export.",
              },
              {
                icon: Lock,
                title: "Secure by default",
                desc: "256-bit encryption in transit and at rest, GDPR-ready data handling, and granular team permissions.",
              },
              {
                icon: ArrowUpRight,
                title: "Ship anywhere",
                desc: "Share a link, embed on your site, or host on your own domain. Every form is responsive out of the box.",
              },
            ].map((f, i) => (
              <Reveal
                key={f.title}
                delay={(i % 3) * 70}
                className="w-[82vw] max-w-[320px] shrink-0 snap-center first:snap-start sm:w-auto sm:max-w-none sm:shrink"
              >
                <div className="group h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-muted/40 sm:rounded-none sm:border-0 sm:p-7">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-[hsl(var(--primary-text))]">
                    <f.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <h3 className="mb-2 mt-5 text-[15px] font-semibold text-foreground">{f.title}</h3>
                  <p className="text-[14px] leading-[1.65] text-muted-foreground">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ==================== PROCESS + STATS (DARK) ================== */}
      <section className="on-ink relative overflow-hidden bg-[hsl(var(--ls-ink))] py-20 sm:py-28 lg:py-36">
        <Container className="relative">
          <div className="grid gap-10 sm:gap-14 lg:grid-cols-2 lg:gap-20">
            <div>
              <Eyebrow dark>How it works</Eyebrow>
              <H2 className="text-white">From form to finished work.</H2>
              <p className="mt-5 max-w-[420px] text-[16px] leading-[1.65] text-white/55">
                Three steps, and the last two run themselves.
              </p>

              <div className="mt-10">
                {steps.map((step, i) => {
                  const open = openStep === i;
                  return (
                    <div key={step.title} className="border-t border-white/10 last:border-b">
                      <button
                        onClick={() => setOpenStep(open ? -1 : i)}
                        className="flex w-full items-center gap-4 py-5 text-left"
                        aria-expanded={open}
                      >
                        <span
                          className={cn(
                            "font-mono text-[12px] tabular-nums transition-colors",
                            open ? "text-white" : "text-white/35",
                          )}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={cn(
                            "flex-1 text-[16px] font-medium transition-colors",
                            open ? "text-white" : "text-white/60",
                          )}
                        >
                          {step.title}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform duration-300",
                            open ? "rotate-180 text-white" : "text-white/35",
                          )}
                        />
                      </button>
                      <div
                        className={cn(
                          "grid overflow-hidden transition-all duration-300 ease-out",
                          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <div className="min-h-0">
                          <p className="pb-6 pl-9 pr-6 text-[14px] leading-[1.7] text-white/50">
                            {step.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* automation timeline visual */}
            <Reveal delay={120}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-9">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-white/40">
                    Run log
                  </span>
                  <span className="flex items-center gap-1.5 rounded bg-success/15 px-2 py-1 text-[11px] font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    Live
                  </span>
                </div>

                <div className="space-y-0">
                  {[
                    { t: "0.0s", label: "Form submitted", detail: "customer-intake" },
                    { t: "0.2s", label: "Contact created", detail: "CRM record #4820" },
                    { t: "0.5s", label: "Payment captured", detail: "$500.00 via Stripe" },
                    { t: "0.9s", label: "Welcome email sent", detail: "Template: onboarding" },
                    { t: "1.2s", label: "Approval requested", detail: "Assigned to Ops" },
                  ].map((row, i, arr) => (
                    <div key={row.label} className="relative flex gap-4 pb-6 last:pb-0">
                      {i !== arr.length - 1 && (
                        <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-white/12" />
                      )}
                      <span className="relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-[hsl(var(--ls-ink))] bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[14px] font-medium text-white">{row.label}</span>
                          <span className="font-mono text-[11px] tabular-nums text-white/35">{row.t}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-white/45">{row.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

        </Container>
      </section>

      {/* ========================== USE CASES ========================= */}
      <section id="use-cases" className="py-20 sm:py-28 lg:py-36">
        <Container>
          <Reveal className="max-w-[620px]">
            <Eyebrow>Use cases</Eyebrow>
            <H2>One platform, every intake you run.</H2>
          </Reveal>

          <p className="mt-6 inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground md:hidden">
            Swipe through use cases
            <ArrowRight className="h-3.5 w-3.5" />
          </p>

          <div
            role="region"
            aria-label="MaxForm use cases"
            tabIndex={0}
            className="-mx-5 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 scroll-px-5 scrollbar-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-scrollbar]:hidden md:mx-0 md:mt-12 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 lg:mt-16"
          >
            {[
              {
                title: "Customer intake & onboarding",
                desc: "Collect details, create the CRM record, send the welcome sequence, and route the contract for signature.",
                meta: "Sales · Agencies",
              },
              {
                title: "Event registration & ticketing",
                desc: "Take registrations and deposits, issue tickets, and keep the attendee list current automatically.",
                meta: "Events · Community",
              },
              {
                title: "Order forms & payments",
                desc: "Build product or quote forms with conditional pricing, file uploads, and checkout in one flow.",
                meta: "Commerce · Services",
              },
              {
                title: "HR requests & approvals",
                desc: "Leave requests, expense claims, and purchase orders with multi-step approval and status tracking.",
                meta: "Internal ops · People",
              },
            ].map((u, i) => (
              <Reveal
                key={u.title}
                delay={(i % 2) * 80}
                className="w-[84vw] max-w-[340px] shrink-0 snap-center first:snap-start md:w-auto md:max-w-none md:shrink"
              >
                <Link
                  to="/auth"
                  className="group flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:[box-shadow:0_1px_2px_hsl(222_24%_7%/0.04),0_10px_24px_-8px_hsl(222_24%_7%/0.09),0_28px_56px_-20px_hsl(222_24%_7%/0.12)] dark:hover:shadow-none sm:p-8"
                >
                  <div>
                    <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--primary-text))]">
                      {u.meta}
                    </div>
                    <h3 className="text-[19px] font-semibold leading-snug tracking-tight text-foreground">
                      {u.title}
                    </h3>
                    <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">{u.desc}</p>
                  </div>
                  <span className="mt-7 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    Explore
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ======================== TESTIMONIALS ======================== */}
      <section className="border-y border-border bg-[hsl(var(--ls-tint))] py-20 sm:py-28 lg:py-36">
        <Container>
          <div className="grid gap-10 sm:gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <Reveal>
              <Eyebrow>Customers</Eyebrow>
              <H2>Teams that stopped doing it by hand.</H2>
              <div className="mt-8 flex items-center gap-3">
                {testimonials.map((t, i) => (
                  <button
                    key={t.name}
                    onClick={() => setActiveTestimonial(i)}
                    aria-label={`Show testimonial from ${t.name}`}
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      i === activeTestimonial
                        ? "w-8 bg-primary"
                        : "w-4 bg-[hsl(var(--border-strong))] hover:bg-[hsl(var(--border-hover))]",
                    )}
                  />
                ))}
              </div>
            </Reveal>

            <Reveal delay={100}>
              <figure className="ls-elevate-sm rounded-2xl border border-border bg-card p-6 sm:p-10">
                <blockquote className="text-[clamp(1.125rem,2.2vw,1.375rem)] font-medium leading-normal tracking-tight text-foreground">
                  “{testimonials[activeTestimonial].quote}”
                </blockquote>
                <figcaption className="mt-8 flex items-center gap-3 border-t border-border pt-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[12px] font-semibold text-foreground">
                    {testimonials[activeTestimonial].initials}
                  </span>
                  <span>
                    <span className="block text-[14px] font-medium text-foreground">
                      {testimonials[activeTestimonial].name}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">
                      {testimonials[activeTestimonial].role}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* =========================== PRICING ========================== */}
      <section id="pricing" className="py-20 sm:py-28 lg:py-36">
        <Container>
          <Reveal className="mx-auto max-w-[660px] text-center">
            <Eyebrow>Pricing</Eyebrow>
            <H2>One subscription. No caps on your work.</H2>
            <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
              Your plan unlocks the whole platform: CRM, forms, documents,
              events, appointments, automations. Only three things are counted,
              and every plan includes an allowance of each. Responses,
              contacts, and documents are never metered.
            </p>
          </Reveal>

          <Reveal delay={60} className="mt-8 flex flex-wrap justify-center gap-2">
            {UNCAPPED.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground"
              >
                <Check
                  className="h-3.5 w-3.5 text-[hsl(var(--primary-text))]"
                  strokeWidth={2.5}
                />
                Unlimited {item.toLowerCase()}
              </span>
            ))}
          </Reveal>

          <Reveal delay={90} className="mt-10 flex justify-center">
            <div
              role="radiogroup"
              aria-label="Billing cycle"
              className="relative inline-flex items-center rounded-full border border-border bg-card p-1"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-foreground transition-transform duration-300 ease-out",
                  billingCycle === "yearly"
                    ? "translate-x-[calc(100%+0.5rem)]"
                    : "translate-x-0",
                )}
                style={{ left: "0.25rem" }}
              />
              {(
                [
                  ["monthly", "Monthly"],
                  ["yearly", "Yearly"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={billingCycle === value}
                  onClick={() => setBillingCycle(value)}
                  className={cn(
                    "relative z-10 h-9 min-w-[104px] rounded-full px-5 text-[13px] font-medium transition-colors duration-200",
                    billingCycle === value
                      ? "text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Reveal>

          <p className="mt-4 text-center text-[12px] text-muted-foreground">
            {billingCycle === "yearly"
              ? `Billed once a year. ${YEARLY_FREE_MONTHS} months free.`
              : `Switch to yearly and get ${YEARLY_FREE_MONTHS} months free.`}
          </p>

          <p className="mt-6 inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground lg:hidden">
            Swipe to compare plans
            <ArrowRight className="h-3.5 w-3.5" />
          </p>

          <div
            role="region"
            aria-label="MaxForm pricing plans"
            tabIndex={0}
            className="-mx-5 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 pt-3 scroll-px-5 scrollbar-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-scrollbar]:hidden lg:mx-0 lg:mt-14 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-0"
          >
            {[planById("trial"), ...PAID_PLANS].map((plan, i) => (
              <Reveal
                key={plan.id}
                delay={i * 80}
                className="w-[84vw] max-w-[340px] shrink-0 snap-center first:snap-start lg:w-auto lg:max-w-none lg:shrink"
              >
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-2xl border p-6 transition-all duration-300",
                    plan.featured
                      ? "ls-elevate border-foreground/20 bg-card"
                      : "border-border bg-card hover:-translate-y-1 hover:border-foreground/15 hover:[box-shadow:0_10px_24px_-8px_hsl(222_24%_7%/0.09)] dark:hover:shadow-none",
                  )}
                >
                  {plan.featured && (
                    <span className="absolute -top-2.5 left-6 rounded bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-primary-foreground">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-[14px] font-medium text-foreground">
                    {plan.name}
                  </h3>
                  <p className="mt-1 min-h-9 text-[12px] leading-normal text-muted-foreground">
                    {plan.tagline}
                  </p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-[34px] font-semibold leading-none tracking-tight text-foreground">
                      {formatPrice(effectiveMonthlyPrice(plan, billingCycle))}
                    </span>
                    {plan.monthlyPrice ? (
                      <span className="text-[13px] text-muted-foreground">
                        /month
                      </span>
                    ) : null}
                  </div>
                  {plan.trialDays ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Everything included for {plan.trialDays} days
                    </p>
                  ) : plan.monthlyPrice && billingCycle === "yearly" ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {formatPrice(yearlyPrice(plan))} billed yearly ·{" "}
                      {formatAllowance(plan.limits.users, "count")}{" "}
                      {plan.limits.users === 1 ? "user" : "users"}
                    </p>
                  ) : (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {formatAllowance(plan.limits.users, "count")}{" "}
                      {plan.limits.users === 1 ? "user" : "users"}
                    </p>
                  )}

                  <dl className="mt-6 space-y-2 rounded-lg bg-muted/50 p-3.5">
                    {[
                      ["AI credits", formatAllowance(plan.limits.aiCredits, "count")],
                      ["Storage", formatAllowance(plan.limits.storageBytes, "bytes")],
                      ["Emails", formatAllowance(plan.limits.emails, "count")],
                      ["Custom forms", formatAllowance(plan.limits.forms, "count")],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-baseline justify-between gap-3 text-[12px]"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <PlanFeatures features={plan.features} planId={plan.id} />

                  <Link
                    to="/auth"
                    className={cn(
                      "inline-flex h-10 w-full items-center justify-center rounded-md text-[14px] font-medium transition-all",
                      plan.featured
                        ? "bg-primary text-primary-foreground hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))]"
                        : "border border-[hsl(var(--input-border))] text-foreground hover:border-[hsl(var(--border-hover))] hover:bg-muted",
                    )}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-6 flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <h3 className="text-[16px] font-semibold text-foreground">
                  {planById("enterprise").name}
                </h3>
                <p className="mt-1.5 max-w-[560px] text-[13px] leading-[1.6] text-muted-foreground">
                  {planById("enterprise").features.join(" · ")}.
                </p>
              </div>
              <Link
                to="/contact"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--input-border))] px-5 text-[14px] font-medium text-foreground transition-colors hover:border-[hsl(var(--border-hover))] hover:bg-muted"
              >
                {planById("enterprise").cta}
              </Link>
            </div>
          </Reveal>

          {/* ---------------------- ADD-ONS ---------------------- */}
          {/* ------------------ CREDITS & ADD-ONS ------------------ */}
          <div id="add-ons" className="mt-20 scroll-mt-24 sm:mt-28">
            <Reveal className="mx-auto max-w-[660px] text-center">
              <Eyebrow>Allowances &amp; add-ons</Eyebrow>
              <H2>Storage, email, and AI credits.</H2>
              <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
                Storage and email volume are plain monthly allowances. Credits
                are a separate currency spent only by AI actions, and nothing
                else in MaxForm touches them. Everything below is optional: it
                only matters once you pass what your plan already includes.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              <Reveal delay={70}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <h3 className="text-[14px] font-medium text-foreground">
                      What spends an AI credit
                    </h3>
                    <p className="mt-0.5 text-[12px] leading-normal text-muted-foreground">
                      AI actions only. Forms, contacts, documents, events, and
                      automations never cost credits.
                    </p>
                  </div>
                  <ul className="flex-1 divide-y divide-border">
                    {AI_CREDIT_COSTS.map((cost) => (
                      <li
                        key={cost.action}
                        className="flex items-center justify-between gap-4 px-5 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] text-foreground">
                            {cost.action}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {cost.where}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-medium text-foreground">
                          {cost.credits}
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                            {cost.credits === 1 ? "credit" : "credits"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-border bg-muted/40 px-5 py-4 text-[12px] leading-[1.6] text-muted-foreground">
                    {EMAIL_ALLOWANCE_RULE}
                  </p>
                </div>
              </Reveal>

              <Reveal delay={140}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-4">
                    <h3 className="text-[14px] font-medium text-foreground">
                      Top-up packs
                    </h3>
                    <p className="mt-0.5 text-[12px] leading-normal text-muted-foreground">
                      Buy more of one allowance without moving up a plan
                    </p>
                  </div>
                  <div className="flex-1 divide-y divide-border">
                    {[
                      {
                        title: "AI credits",
                        note: `One-time · rolls over ${CREDIT_ROLLOVER_DAYS} days`,
                        packs: AI_CREDIT_PACKS,
                      },
                      {
                        title: "Storage",
                        note: "Monthly · added to your quota",
                        packs: STORAGE_PACKS,
                      },
                      {
                        title: "Email volume",
                        note: "One-time · this period only",
                        packs: EMAIL_PACKS,
                      },
                    ].map((group) => (
                      <div key={group.title} className="px-5 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <h4 className="text-[13px] font-medium text-foreground">
                            {group.title}
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            {group.note}
                          </span>
                        </div>
                        <ul className="mt-2.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                          {group.packs.map((pack) => (
                            <li
                              key={pack.id}
                              className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-b-0"
                            >
                              <span className="text-[12px] text-muted-foreground">
                                {pack.label}
                              </span>
                              <span className="text-[12px] font-medium text-foreground">
                                ${pack.price.toFixed(2)}
                                {pack.recurring ? (
                                  <span className="text-[10px] font-normal text-muted-foreground">
                                    /mo
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>

          <Reveal delay={110}>
            <p className="mt-14 text-center text-[14px] text-muted-foreground">
              Need something this page doesn&apos;t cover?{" "}
              <Link
                to="/contact"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Talk to sales
              </Link>
            </p>
          </Reveal>
        </Container>
      </section>

      {/* ============================= CTA ============================ */}
      <section className="px-5 pb-20 sm:px-8 sm:pb-28 lg:pb-36">
        <Reveal>
          <div className="on-ink ls-elevate relative mx-auto max-w-[1160px] overflow-hidden rounded-[24px] bg-[hsl(var(--ls-ink))] px-6 py-16 text-center sm:rounded-[28px] sm:px-16 sm:py-24">
            <div className="relative">
              <h2 className="mx-auto max-w-[520px] text-[clamp(1.75rem,3.6vw,2.5rem)] font-semibold leading-[1.12] tracking-tight text-white">
                Build your first form in under two minutes.
              </h2>
              <p className="mx-auto mt-5 max-w-[420px] text-[15px] leading-[1.65] text-white/55">
                Free to start. No credit card, no submission limits, no setup call.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to="/auth"
                  className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))] sm:w-auto"
                >
                  Start building free
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/contact"
                  className="inline-flex h-11 w-full items-center justify-center rounded-md border border-white/20 px-6 text-[14px] font-medium text-white transition-colors hover:bg-white/5 sm:w-auto"
                >
                  Talk to sales
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </MarketingPage>
  );
};

export default Landing;
