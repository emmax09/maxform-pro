import { Link, useLocation } from "react-router-dom";
import { ChevronUp, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/*                                                                     */
/* Shared by every public marketing page (Landing, About, Contact) so   */
/* the rhythm - reveal timing, gutters, section labels, heading scale - */
/* stays identical without being re-declared per page.                  */
/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5",
        className,
      )}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

export const Container = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("mx-auto w-full max-w-[1160px] px-5 sm:px-8", className)}>{children}</div>
);

/** Small uppercase section label. */
export const Eyebrow = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <p
    className={cn(
      "mb-4 text-[12px] font-medium uppercase tracking-[0.14em]",
      dark ? "text-white/45" : "text-muted-foreground",
    )}
  >
    {children}
  </p>
);

export const H2 = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h2
    className={cn(
      "text-[clamp(1.75rem,3.6vw,2.5rem)] font-semibold leading-[1.12] text-foreground",
      className,
    )}
  >
    {children}
  </h2>
);

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/**
 * In-page anchors that only exist on the Landing route. From any other
 * marketing page they have to resolve back to `/` first, so the href is
 * rewritten and MarketingPage scrolls to the target once it lands.
 */
const SECTION_LINKS = [
  { label: "Features", hash: "#features" },
  { label: "Use cases", hash: "#use-cases" },
  { label: "Pricing", hash: "#pricing" },
];

const PAGE_LINKS = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

/** Routes that render the Landing page, where the section anchors exist. */
const LANDING_PATHS = new Set(["/", "/pricing"]);

function MarketingNav() {
  const { resolvedTheme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const onLanding = LANDING_PATHS.has(pathname);
  const sectionHref = (hash: string) => (onLanding ? hash : `/${hash}`);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className="hero-light fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:pt-4">
      <div
        className={cn(
          "mx-auto flex h-16 w-full max-w-[1160px] items-center justify-between rounded-full border pl-4 pr-2.5 transition-all duration-300 sm:pl-5 sm:pr-3",
          scrolled
            ? "border-[hsl(var(--border))] bg-white/95 shadow-[0_8px_30px_-12px_hsl(var(--shadow-color)/0.16)] backdrop-blur-xl"
            : "border-[hsl(var(--border))] bg-white/88 shadow-[0_4px_18px_-12px_hsl(var(--shadow-color)/0.12)] backdrop-blur-xl",
        )}
      >
        <Link to="/" className="shrink-0">
          <BrandLogo
            markSize={18}
            wordmarkClassName="text-[15px] text-foreground"
          />
        </Link>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1.5 lg:flex xl:gap-2.5">
          {SECTION_LINKS.map((l) => (
            <a
              key={l.label}
              href={sectionHref(l.hash)}
              className={cn(
                "whitespace-nowrap rounded-full px-3 py-2 text-[13px] transition-colors xl:px-3.5 xl:text-[14px]",
                scrolled
                  ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {l.label}
            </a>
          ))}
          {PAGE_LINKS.map((l) => {
            const active = pathname === l.to;
            return (
              <Link
                key={l.label}
                to={l.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-2 text-[13px] transition-colors xl:px-3.5 xl:text-[14px]",
                  scrolled
                    ? active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    : active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className={cn(
              "relative flex h-10 w-10 items-center justify-center rounded-full transition-colors",
              scrolled
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </button>

          <Link
            to="/auth"
            className={cn(
              "hidden h-10 items-center rounded-full px-4 text-[14px] transition-colors sm:inline-flex",
              scrolled
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            className="hidden h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))] sm:inline-flex"
          >
            Start free
          </Link>

          <button
            onClick={() => setMobileMenuOpen(true)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full transition-colors lg:hidden",
              "text-foreground hover:bg-muted",
            )}
            aria-label="Open menu"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="right"
          className="public-theme hero-light flex h-dvh max-h-dvh w-[min(340px,calc(100vw-16px))] flex-col overflow-hidden bg-background p-0 sm:w-[340px]"
        >
          <SheetHeader className="shrink-0 border-b border-border px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6 sm:pt-6">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center">
                <BrandLogo markSize={18} wordmarkClassName="text-[15px]" />
              </SheetTitle>
              <SheetClose asChild>
                <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </button>
              </SheetClose>
            </div>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <nav className="modern-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-5 py-5 sm:py-6">
              {SECTION_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={sectionHref(l.hash)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex min-h-12 items-center rounded-xl px-4 py-3 text-[15px] text-foreground transition-colors hover:bg-muted"
                >
                  {l.label}
                </a>
              ))}
              {PAGE_LINKS.map((l) => (
                <Link
                  key={l.label}
                  to={l.to}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={pathname === l.to ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center rounded-xl px-4 py-3 text-[15px] transition-colors hover:bg-muted",
                    pathname === l.to ? "bg-muted font-medium text-foreground" : "text-foreground",
                  )}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="shrink-0 space-y-2.5 border-t border-border px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:py-6">
              <Link
                to="/auth"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-[hsl(var(--input-border))] text-[14px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:bg-[hsl(var(--primary-hover))]"
              >
                Start free
              </Link>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function MarketingFooter() {
  const { pathname } = useLocation();
  const onLanding = LANDING_PATHS.has(pathname);

  const columns = [
    {
      heading: "Product",
      links: SECTION_LINKS.map((l) => ({
        label: l.label,
        href: onLanding ? l.hash : `/${l.hash}`,
      })),
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Contact", href: "/contact" },
      ],
    },
    {
      heading: "Get started",
      links: [
        { label: "Sign in", href: "/auth" },
        { label: "Create account", href: "/auth" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <Container className="py-10 sm:py-16">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-12">
          <div className="col-span-2 flex flex-col items-center text-center md:col-span-1 md:block md:text-left">
            <BrandLogo markSize={18} wordmarkClassName="text-[15px]" />
            <p className="mt-4 max-w-[260px] text-[14px] leading-[1.65] text-muted-foreground">
              Forms, workflows, payments, and CRM in one platform. Build once, automate everything.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.heading} className="hidden md:block">
              <h4 className="text-[13px] font-medium text-foreground">{col.heading}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith("#") ? (
                      <a
                        href={l.href}
                        className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        to={l.href}
                        className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-center sm:mt-14 sm:pt-8 md:flex-row md:text-left">
          <p className="text-[13px] text-muted-foreground">
            © {new Date().getFullYear()} MaxForm. All rights reserved.
          </p>
          <div className="hidden items-center gap-5 md:flex">
            <Link to="/contact" className="text-[13px] text-muted-foreground hover:text-foreground">
              Privacy
            </Link>
            <Link to="/contact" className="text-[13px] text-muted-foreground hover:text-foreground">
              Terms
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */

/**
 * The public marketing shell: brand theme scope, Onyx browser canvas, the
 * floating nav, the footer, and the scroll-to-top affordance. Pages supply
 * only their own sections.
 */
export function MarketingPage({ children }: { children: ReactNode }) {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 500);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("landing-page-active");
    document.body.classList.add("landing-page-active");
    return () => {
      document.documentElement.classList.remove("landing-page-active");
      document.body.classList.remove("landing-page-active");
    };
  }, []);

  /*
   * Cross-page anchors ("/#pricing" from About) arrive as a client-side
   * navigation, which React Router does not scroll for. Land at the top on a
   * plain route change, or at the requested section when one is named.
   */
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const target = document.querySelector(hash);
    if (!target) return;
    const frame = window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return (
    <div className="public-theme min-h-screen overflow-x-hidden bg-background text-[15px] leading-relaxed text-muted-foreground antialiased">
      <MarketingNav />
      {children}
      <MarketingFooter />

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-lg transition-all duration-300 hover:bg-muted sm:bottom-8 sm:right-8"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
