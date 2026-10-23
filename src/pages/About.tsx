import { Link } from "react-router-dom";
import {
  ArrowRight,
  Compass,
  CreditCard,
  Globe2,
  Handshake,
  Layers,
  ShieldCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  Container,
  Eyebrow,
  H2,
  MarketingPage,
  Reveal,
} from "@/components/marketing/MarketingChrome";

/* ------------------------------------------------------------------ */

const STATS = [
  { value: "50K+", label: "Active users" },
  { value: "2M+", label: "Forms created" },
  { value: "100M+", label: "Submissions collected" },
  { value: "150+", label: "Countries served" },
];

const VALUES = [
  {
    icon: Layers,
    title: "One tool, not five",
    desc: "Every feature we ship has to remove a subscription somewhere else. If it only adds another tab, it doesn't make the cut.",
  },
  {
    icon: Zap,
    title: "Automate the boring half",
    desc: "Collecting the answer is the easy part. We measure ourselves on what happens in the seconds after someone hits submit.",
  },
  {
    icon: Globe2,
    title: "Built for everywhere",
    desc: "Local payment rails, local currencies, local address formats. A team in Lagos should get the same product as one in Berlin.",
  },
  {
    icon: ShieldCheck,
    title: "Boring about security",
    desc: "Encryption in transit and at rest, granular permissions, and GDPR-ready handling. Never a feature we trade away for speed.",
  },
  {
    icon: Compass,
    title: "Clear over clever",
    desc: "No jargon in the product, no dark patterns in the pricing, no surprises on the invoice. You should always know where you stand.",
  },
  {
    icon: Handshake,
    title: "Customers set the roadmap",
    desc: "Most of what we shipped last year started as a support conversation. We build with the people who use it daily.",
  },
];

const MILESTONES = [
  {
    year: "2021",
    label: "The first version",
    detail: "A weekend form builder for our own agency intake",
  },
  {
    year: "2022",
    label: "Workflows shipped",
    detail: "Approvals, emails, and webhooks fire after submit",
  },
  {
    year: "2023",
    label: "Payments went global",
    detail: "Stripe, Paystack, Flutterwave, Opay, and PayPal",
  },
  {
    year: "2024",
    label: "CRM built in",
    detail: "Every response became a contact with full history",
  },
  {
    year: "2025",
    label: "Events and ticketing",
    detail: "Registration, tickets, and revenue in one workspace",
  },
];

const TEAM = [
  { name: "Amara Chukwu", role: "Co-founder & CEO", initials: "AC" },
  { name: "Daniel Osei", role: "Co-founder & CTO", initials: "DO" },
  { name: "Priya Nandan", role: "Head of Product", initials: "PN" },
  { name: "Tobi Adeyemi", role: "Head of Engineering", initials: "TA" },
  { name: "Lena Fischer", role: "Design Lead", initials: "LF" },
  { name: "Marcus Bell", role: "Customer Success", initials: "MB" },
];

const PRINCIPLES = [
  "Ship small, ship often",
  "Support is everyone's job",
  "Default to the simpler option",
];

const About = () => {
  const [activePrinciple, setActivePrinciple] = useState(0);

  return (
    <MarketingPage>
      {/* ============================ HERO ============================= */}
      {/*
        Same full-bleed Onyx band as the home hero (.on-ink so the semantic
        tokens resolve against a dark surface), with the copy column paired to
        an elevated light panel instead of the product mock.
      */}
      <section className="on-ink relative overflow-hidden bg-[hsl(var(--ls-ink))] pb-24 pt-[124px] sm:pb-32 sm:pt-[172px]">
        <Container className="relative">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/6 py-1 pl-1 pr-3 text-[12.5px] text-white/70">
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                    About
                  </span>
                  Building since 2021
                </span>
              </Reveal>

              <Reveal delay={70}>
                <h1 className="mt-6 text-[clamp(2.15rem,4.1vw,3rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-white">
                  We got tired of gluing{" "}
                  <span className="text-primary">five tools together.</span>
                </h1>
              </Reveal>

              <Reveal delay={130}>
                <p className="mt-6 max-w-[500px] text-pretty text-[17px] leading-[1.6] text-white/70">
                  MaxForm started inside a small agency that was paying for a form builder, an
                  automation tool, a payment page, an email sender, and a CRM, then spending its
                  evenings keeping all five in sync. We decided that should just be one product.
                </p>
              </Reveal>

              <Reveal delay={190}>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    to="/auth"
                    className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))]"
                  >
                    Start for free
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    to="/contact"
                    className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-[15px] font-semibold text-[hsl(var(--ls-ink))] transition-opacity hover:opacity-90"
                  >
                    Talk to the team
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={250}>
                <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-2">
                  {["Remote-first", "Profitable since 2023", "42 people"].map((f) => (
                    <span key={f} className="flex items-center gap-2 text-[13.5px] text-white/55">
                      <span className="h-1 w-1 rounded-full bg-primary" />
                      {f}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            {/* Mission panel matching the elevated hero card on the home page. */}
            <Reveal delay={160}>
              <div className="relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 hidden rounded-[28px] border border-primary/40 sm:block lg:-inset-5"
                />
                <div className="on-surface ls-elevate overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border p-7 sm:p-8">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-[hsl(var(--primary-subtle))] text-[hsl(var(--primary-text))]">
                      <Compass className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Our mission
                    </p>
                    <p className="mt-3 text-[19px] font-semibold leading-[1.4] tracking-tight text-foreground">
                      Let any team collect what they need, get paid for it, and follow up
                      automatically, without hiring a developer.
                    </p>
                  </div>

                  <div className="p-7 sm:p-8">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      How we work
                    </p>
                    <div className="mt-4 space-y-0">
                      {PRINCIPLES.map((principle, i) => (
                        <button
                          key={principle}
                          onMouseEnter={() => setActivePrinciple(i)}
                          onFocus={() => setActivePrinciple(i)}
                          onClick={() => setActivePrinciple(i)}
                          className={cn(
                            "flex w-full items-center gap-3 border-b border-border py-3 text-left transition-colors last:border-b-0",
                            i === activePrinciple ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "font-mono text-[12px] tabular-nums transition-colors",
                              i === activePrinciple ? "text-primary" : "text-muted-foreground",
                            )}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-[14px] font-medium">{principle}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ========================= STATS STRIP ========================= */}
      <section className="border-y border-border bg-[hsl(var(--ls-tint))]">
        <Container className="py-10">
          <Reveal>
            <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="text-center lg:text-left">
                  <div className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-tight text-foreground">
                    {s.value}
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      {/* ============================ STORY ============================ */}
      <section className="py-28 sm:py-36">
        <Container>
          <div className="grid gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
            <Reveal>
              <Eyebrow>Our story</Eyebrow>
              <H2>Built by the people doing the manual work.</H2>
            </Reveal>

            <Reveal delay={100}>
              <div className="space-y-5 text-[16px] leading-[1.75] text-muted-foreground">
                <p>
                  In 2021 we were running a small agency. Every new client meant the same routine: a
                  form to collect their brief, a spreadsheet to track it, an invoice to chase, a
                  welcome email to write, and a CRM record someone had to remember to create. Five
                  tools, four logins, and a handoff that broke roughly every other week.
                </p>
                <p>
                  So we built the missing piece: the part that runs{" "}
                  <span className="font-medium text-foreground">after</span> the form is submitted.
                  Once approvals, emails, payments, and contact records fired on their own, onboarding
                  stopped being a job. Clients noticed. They asked to use it too.
                </p>
                <p>
                  Today MaxForm powers intake, registration, order forms, and internal approvals for
                  teams in more than 150 countries. The company is remote-first and has been
                  profitable since 2023, which means we answer to the people paying for the product
                  rather than to a funding round.
                </p>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* =========================== VALUES ============================ */}
      <section className="border-t border-border py-28 sm:py-36">
        <Container>
          <Reveal className="max-w-[620px]">
            <Eyebrow>What we believe</Eyebrow>
            <H2>Six rules we actually hold ourselves to.</H2>
            <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
              These aren't posters on a wall. They're the questions we ask before anything ships.
            </p>
          </Reveal>

          <div className="ls-elevate-sm mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {VALUES.map((v, i) => (
              <Reveal key={v.title} delay={(i % 3) * 70}>
                <div className="group h-full bg-card p-7 transition-colors hover:bg-muted/40">
                  <v.icon className="h-[18px] w-[18px] text-foreground" strokeWidth={1.75} />
                  <h3 className="mb-2 mt-5 text-[15px] font-semibold text-foreground">{v.title}</h3>
                  <p className="text-[14px] leading-[1.65] text-muted-foreground">{v.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ==================== MILESTONES (DARK BAND) =================== */}
      <section className="on-ink relative overflow-hidden bg-[hsl(var(--ls-ink))] py-28 sm:py-36">
        <Container className="relative">
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
            <div>
              <Eyebrow dark>The road so far</Eyebrow>
              <H2 className="text-white">Four years, one idea.</H2>
              <p className="mt-5 max-w-[420px] text-[16px] leading-[1.65] text-white/55">
                Every release since the first weekend build has moved in the same direction: fewer
                tools between a question and the work it kicks off.
              </p>

              <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
                {[
                  { icon: Workflow, label: "Workflows run daily", value: "1.4M" },
                  { icon: CreditCard, label: "Processed for customers", value: "$820.00M" },
                ].map((m) => (
                  <div key={m.label} className="bg-[hsl(var(--ls-ink))] p-6">
                    <m.icon className="h-[18px] w-[18px] text-white/70" strokeWidth={1.75} />
                    <div className="mt-4 text-[24px] font-semibold tracking-tight text-white">
                      {m.value}
                    </div>
                    <p className="mt-1 text-[13px] text-white/45">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline using the same construction as the home page run log. */}
            <Reveal delay={120}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-9">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-white/40">
                    Milestones
                  </span>
                  <span className="flex items-center gap-1.5 rounded bg-success/15 px-2 py-1 text-[11px] font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    Shipping
                  </span>
                </div>

                <div className="space-y-0">
                  {MILESTONES.map((row, i, arr) => (
                    <div key={row.year} className="relative flex gap-4 pb-6 last:pb-0">
                      {i !== arr.length - 1 && (
                        <span
                          aria-hidden
                          className="absolute left-[5px] top-4 h-full w-px bg-white/12"
                        />
                      )}
                      <span className="relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-[hsl(var(--ls-ink))] bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[14px] font-medium text-white">{row.label}</span>
                          <span className="font-mono text-[11px] tabular-nums text-white/35">
                            {row.year}
                          </span>
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

      {/* ============================ TEAM ============================= */}
      <section className="border-y border-border bg-[hsl(var(--ls-tint))] py-28 sm:py-36">
        <Container>
          <Reveal className="max-w-[620px]">
            <Eyebrow>The team</Eyebrow>
            <H2>Small team, long attention span.</H2>
            <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
              Forty-two people across eleven time zones. Everyone, including both founders, spends
              time in the support queue.
            </p>
          </Reveal>

          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((person, i) => (
              <Reveal key={person.name} delay={(i % 3) * 80}>
                <div className="ls-elevate-sm flex h-full items-center gap-4 rounded-2xl border border-border bg-card p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-foreground">
                    {person.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {person.name}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {person.role}
                    </span>
                  </span>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={110}>
            <p className="mt-10 text-[14px] text-muted-foreground">
              We're usually hiring across engineering, design, and support.{" "}
              <Link to="/contact" className="font-medium text-foreground underline underline-offset-4">
                Get in touch
              </Link>
            </p>
          </Reveal>
        </Container>
      </section>

      {/* ============================= CTA ============================= */}
      <section className="px-5 pb-28 pt-28 sm:px-8 sm:pb-36 sm:pt-36">
        <Reveal>
          <div className="on-ink ls-elevate relative mx-auto max-w-[1160px] overflow-hidden rounded-[28px] bg-[hsl(var(--ls-ink))] px-8 py-24 text-center sm:px-16">
            <div className="relative">
              <h2 className="mx-auto max-w-[520px] text-[clamp(1.75rem,3.6vw,2.5rem)] font-semibold leading-[1.12] tracking-tight text-white">
                Come build the boring parts away with us.
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

export default About;
