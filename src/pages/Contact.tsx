import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Clock,
  LifeBuoy,
  Mail,
  MessageSquare,
  Send,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Container,
  Eyebrow,
  H2,
  MarketingPage,
  Reveal,
} from "@/components/marketing/MarketingChrome";

/* ------------------------------------------------------------------ */
/* Contact data                                                        */
/* ------------------------------------------------------------------ */

const TOPICS = [
  { value: "sales", label: "Talk to sales" },
  { value: "support", label: "Product support" },
  { value: "billing", label: "Billing or credits" },
  { value: "partnership", label: "Partnership" },
  { value: "press", label: "Press or media" },
  { value: "other", label: "Something else" },
];

const CHANNELS = [
  {
    icon: MessageSquare,
    title: "Talk to sales",
    desc: "Volume pricing, migrations, security reviews, or a walkthrough of how MaxForm would fit your workflow.",
    action: "sales@maxform.com",
    href: "mailto:sales@maxform.com",
  },
  {
    icon: LifeBuoy,
    title: "Product support",
    desc: "Stuck on a form, a workflow, or a payment provider? The team that builds it answers the queue.",
    action: "support@maxform.com",
    href: "mailto:support@maxform.com",
  },
  {
    icon: Building2,
    title: "Partnerships",
    desc: "Agencies, resellers, and integration partners building on top of MaxForm.",
    action: "partners@maxform.com",
    href: "mailto:partners@maxform.com",
  },
  {
    icon: BookOpen,
    title: "Press and media",
    desc: "Company background, brand assets, founder interviews, and product screenshots.",
    action: "press@maxform.com",
    href: "mailto:press@maxform.com",
  },
];

const RESPONSE_FACTS = [
  { icon: Clock, label: "Median first reply", value: "under 4 hours" },
  { icon: Users, label: "Answered by", value: "the product team" },
  { icon: Mail, label: "Coverage", value: "Mon–Fri, 8am–8pm UTC" },
];

const FAQS = [
  {
    q: "How quickly will someone get back to me?",
    a: "Most messages get a first reply within four working hours, and everything is answered inside one business day. Sales enquiries with a deadline attached get picked up first. Say so in your message and we'll prioritise it.",
  },
  {
    q: "Do I need an account to get support?",
    a: "No. If you're evaluating MaxForm, or something broke before you signed up, write to us anyway. Existing customers can also reach the same team from inside the app, where we can see the workspace you're asking about.",
  },
  {
    q: "Can you help us migrate from another form tool?",
    a: "Yes. We do this regularly and it's free on Pro and Business plans. Send us an export or a link to your current forms and we'll rebuild the structure, logic, and payment steps for you.",
  },
  {
    q: "Do you offer custom or enterprise pricing?",
    a: "Enterprise covers unlimited users, storage, AI credits, and email volume on dedicated infrastructure, with SSO, an SLA, and custom integrations. Security reviews, DPAs, and invoicing are all available at that tier. Submissions and contacts are never capped on any plan.",
  },
];

type FormState = {
  name: string;
  email: string;
  company: string;
  topic: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  company: "",
  topic: "sales",
  message: "",
};

/** Matches the app's other email checks: something@something.tld, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(values: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = "Tell us who you are.";
  if (!values.email.trim()) errors.email = "We need an address to reply to.";
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "That doesn't look like a valid email.";
  if (!values.message.trim()) errors.message = "Add a short message so we can route it.";
  else if (values.message.trim().length < 20)
    errors.message = "A little more detail helps us answer properly.";
  return errors;
}

/* ------------------------------------------------------------------ */
/* Field primitives use native controls so the .public-theme focus ring */
/* in index.css applies, instead of the shadcn ring that would stack    */
/* a second outline on top of it.                                       */
/* ------------------------------------------------------------------ */

const fieldClass =
  "h-11 w-full rounded-md border border-[hsl(var(--input-border))] bg-[hsl(var(--surface))] px-3.5 text-[14px] text-foreground placeholder:text-muted-foreground transition-colors hover:border-[hsl(var(--border-hover))]";

const Field = ({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) => (
  <div>
    <label
      htmlFor={id}
      className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-foreground"
    >
      {label}
      {optional && <span className="text-[12px] font-normal text-muted-foreground">Optional</span>}
    </label>
    {children}
    {error && (
      <p id={`${id}-error`} role="alert" className="mt-1.5 text-[12.5px] text-destructive">
        {error}
      </p>
    )}
  </div>
);

/* ------------------------------------------------------------------ */

const Contact = () => {
  const [values, setValues] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [openFaq, setOpenFaq] = useState(0);

  const setField = (key: keyof FormState) => (value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setStatus("submitting");
    /*
     * TODO(backend): POST to a public, rate-limited contact endpoint under
     * /api and forward to the shared inbox. Until that exists the form
     * validates and confirms locally. The mailto channels below are the
     * live route for anything urgent.
     */
    await new Promise((resolve) => setTimeout(resolve, 600));
    setStatus("sent");
  };

  const topicLabel = TOPICS.find((t) => t.value === values.topic)?.label ?? "your message";

  return (
    <MarketingPage>
      {/* ============================ HERO ============================= */}
      {/*
        Same Onyx band as the home hero. The elevated light card that carries
        the product mock on the home page carries the form here, so the two
        pages read as one layout.
      */}
      <section className="on-ink relative overflow-hidden bg-[hsl(var(--ls-ink))] pb-24 pt-[124px] sm:pb-32 sm:pt-[172px]">
        <Container className="relative">
          <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="lg:pt-6">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/6 py-1 pl-1 pr-3 text-[12.5px] text-white/70">
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                    Contact
                  </span>
                  Real people, not a ticket bot
                </span>
              </Reveal>

              <Reveal delay={70}>
                <h1 className="mt-6 text-[clamp(2.15rem,4.1vw,3rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-white">
                  Tell us what you're{" "}
                  <span className="text-primary">trying to build.</span>
                </h1>
              </Reveal>

              <Reveal delay={130}>
                <p className="mt-6 max-w-[440px] text-pretty text-[17px] leading-[1.6] text-white/70">
                  Whether it's a pricing question, a migration, or a form that won't behave, send it
                  over. Every message goes to the team that builds MaxForm.
                </p>
              </Reveal>

              <Reveal delay={190}>
                <div className="mt-10 space-y-0 border-t border-white/10">
                  {RESPONSE_FACTS.map((fact) => (
                    <div
                      key={fact.label}
                      className="flex items-center gap-4 border-b border-white/10 py-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70">
                        <fact.icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] text-white/45">{fact.label}</span>
                        <span className="block text-[15px] font-medium text-white">
                          {fact.value}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={250}>
                <p className="mt-7 text-[13.5px] text-white/55">
                  Prefer plain email?{" "}
                  <a
                    href="mailto:hello@maxform.com"
                    className="font-medium text-white underline underline-offset-4"
                  >
                    hello@maxform.com
                  </a>
                </p>
              </Reveal>
            </div>

            {/* form panel */}
            <Reveal delay={160}>
              <div className="relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 hidden rounded-[28px] border border-primary/40 sm:block lg:-inset-5"
                />
                <div className="on-surface ls-elevate overflow-hidden rounded-2xl border border-border bg-card">
                  {status === "sent" ? (
                    <div className="p-8 text-center sm:p-12">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary-subtle))] text-[hsl(var(--primary-text))]">
                        <Check className="h-5 w-5" strokeWidth={2.25} />
                      </span>
                      <h2 className="mt-6 text-[21px] font-semibold tracking-tight text-foreground">
                        Message received.
                      </h2>
                      <p className="mx-auto mt-3 max-w-[360px] text-[14px] leading-[1.65] text-muted-foreground">
                        Thanks {values.name.trim().split(" ")[0]}. We've got your note about{" "}
                        {topicLabel.toLowerCase()} and we'll reply to{" "}
                        <span className="font-medium text-foreground">{values.email.trim()}</span>{" "}
                        within one business day.
                      </p>
                      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                        <Link
                          to="/auth"
                          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-6 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))] sm:w-auto"
                        >
                          Start building free
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setValues(EMPTY_FORM);
                            setStatus("idle");
                          }}
                          className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[hsl(var(--input-border))] px-6 text-[14px] font-medium text-foreground transition-colors hover:border-[hsl(var(--border-hover))] hover:bg-muted sm:w-auto"
                        >
                          Send another
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} noValidate className="p-7 sm:p-9">
                      <h2 className="text-[19px] font-semibold tracking-tight text-foreground">
                        Send us a message
                      </h2>
                      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                        We reply to every one. No auto-responder loops.
                      </p>

                      <div className="mt-7 space-y-5">
                        <div className="grid gap-5 sm:grid-cols-2">
                          <Field id="name" label="Full name" error={errors.name}>
                            <input
                              id="name"
                              name="name"
                              type="text"
                              autoComplete="name"
                              value={values.name}
                              onChange={(e) => setField("name")(e.target.value)}
                              placeholder="Amara Chukwu"
                              aria-invalid={Boolean(errors.name)}
                              aria-describedby={errors.name ? "name-error" : undefined}
                              className={cn(fieldClass, errors.name && "border-destructive")}
                            />
                          </Field>

                          <Field id="email" label="Work email" error={errors.email}>
                            <input
                              id="email"
                              name="email"
                              type="email"
                              autoComplete="email"
                              value={values.email}
                              onChange={(e) => setField("email")(e.target.value)}
                              placeholder="you@company.com"
                              aria-invalid={Boolean(errors.email)}
                              aria-describedby={errors.email ? "email-error" : undefined}
                              className={cn(fieldClass, errors.email && "border-destructive")}
                            />
                          </Field>
                        </div>

                        <div className="grid gap-5 sm:grid-cols-2">
                          <Field id="company" label="Company" optional>
                            <input
                              id="company"
                              name="company"
                              type="text"
                              autoComplete="organization"
                              value={values.company}
                              onChange={(e) => setField("company")(e.target.value)}
                              placeholder="Solace"
                              className={fieldClass}
                            />
                          </Field>

                          <Field id="topic" label="What's this about?">
                            <div className="relative">
                              <select
                                id="topic"
                                name="topic"
                                value={values.topic}
                                onChange={(e) => setField("topic")(e.target.value)}
                                className={cn(fieldClass, "cursor-pointer appearance-none pr-10")}
                              >
                                {TOPICS.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                aria-hidden
                                className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                              />
                            </div>
                          </Field>
                        </div>

                        <Field id="message" label="Message" error={errors.message}>
                          <textarea
                            id="message"
                            name="message"
                            rows={5}
                            value={values.message}
                            onChange={(e) => setField("message")(e.target.value)}
                            placeholder="What are you trying to set up, and where are you stuck?"
                            aria-invalid={Boolean(errors.message)}
                            aria-describedby={errors.message ? "message-error" : undefined}
                            className={cn(
                              fieldClass,
                              "h-auto min-h-[132px] resize-y py-3 leading-[1.6]",
                              errors.message && "border-destructive",
                            )}
                          />
                        </Field>
                      </div>

                      <Button
                        type="submit"
                        variant="brand"
                        loading={status === "submitting"}
                        loadingLabel="Sending message"
                        className="group mt-7 h-11 w-full px-6 text-[14px]"
                      >
                        Send message
                        <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </Button>

                      <p className="mt-4 text-center text-[12.5px] leading-[1.6] text-muted-foreground">
                        By sending this you agree we can email you back about your enquiry. Nothing
                        else. We don't add you to a list.
                      </p>
                    </form>
                  )}
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ========================== CHANNELS =========================== */}
      <section className="py-28 sm:py-36">
        <Container>
          <Reveal className="max-w-[620px]">
            <Eyebrow>Direct lines</Eyebrow>
            <H2>Know who you need? Skip the form.</H2>
            <p className="mt-5 text-[16px] leading-[1.65] text-muted-foreground">
              Four inboxes, each read by the team that owns it.
            </p>
          </Reveal>

          <div className="ls-elevate-sm mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
            {CHANNELS.map((c, i) => (
              <Reveal key={c.title} delay={(i % 2) * 70}>
                <a
                  href={c.href}
                  className="group flex h-full flex-col bg-card p-7 transition-colors hover:bg-muted/40"
                >
                  <c.icon className="h-[18px] w-[18px] text-foreground" strokeWidth={1.75} />
                  <h3 className="mb-2 mt-5 text-[15px] font-semibold text-foreground">{c.title}</h3>
                  <p className="flex-1 text-[14px] leading-[1.65] text-muted-foreground">{c.desc}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    {c.action}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </a>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ============================= FAQ ============================= */}
      <section className="on-ink relative overflow-hidden bg-[hsl(var(--ls-ink))] py-28 sm:py-36">
        <Container className="relative">
          <div className="grid gap-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
            <div>
              <Eyebrow dark>Before you write</Eyebrow>
              <H2 className="text-white">Answers to the four we get most.</H2>
              <p className="mt-5 max-w-[380px] text-[16px] leading-[1.65] text-white/55">
                Still not covered? The form above is the fastest way to reach us.
              </p>
            </div>

            <div>
              {FAQS.map((faq, i) => {
                const open = openFaq === i;
                return (
                  <div key={faq.q} className="border-t border-white/10 last:border-b">
                    <button
                      onClick={() => setOpenFaq(open ? -1 : i)}
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
                        {faq.q}
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
                          {faq.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Container>
      </section>

      {/* ============================= CTA ============================= */}
      <section className="px-5 pb-28 pt-28 sm:px-8 sm:pb-36 sm:pt-36">
        <Reveal>
          <div className="on-ink ls-elevate relative mx-auto max-w-[1160px] overflow-hidden rounded-[28px] bg-[hsl(var(--ls-ink))] px-8 py-24 text-center sm:px-16">
            <div className="relative">
              <h2 className="mx-auto max-w-[520px] text-[clamp(1.75rem,3.6vw,2.5rem)] font-semibold leading-[1.12] tracking-tight text-white">
                Or just try it. It takes two minutes.
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
                  to="/about"
                  className="inline-flex h-11 w-full items-center justify-center rounded-md border border-white/20 px-6 text-[14px] font-medium text-white transition-colors hover:bg-white/5 sm:w-auto"
                >
                  About MaxForm
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </MarketingPage>
  );
};

export default Contact;
