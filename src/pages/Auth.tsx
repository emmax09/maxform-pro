import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { Country } from "react-phone-number-input";
import en from "react-phone-number-input/locale/en.json";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from "lucide-react";

import { BrandLogo } from "@/components/BrandLogo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const fieldClassName =
  "h-11 rounded-xl border border-input bg-[hsl(var(--input-background))] text-[14px] shadow-sm transition-colors hover:border-[hsl(var(--input-border-hover))] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0 dark:border-white/10 dark:shadow-none dark:hover:border-white/20";

const iconClassName =
  "pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground";

const visibilityButtonClassName =
  "absolute right-1.5 top-1/2 z-20 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/[0.06]";

const tabsListClassName =
  "grid h-11 w-full grid-cols-2 gap-1 rounded-xl border border-border bg-[hsl(var(--background-secondary))] p-1 dark:border-white/[0.08] dark:bg-white/[0.04]";

/*
 * The default trigger paints `bg-background` (#f8f8f7) on a `bg-muted` track
 * (#f4f4f3) — indistinguishable in the light theme. The active tab gets the
 * brand-subtle tint instead so the selected pill is unmistakable, while the
 * solid orange stays reserved for the submit button.
 */
const tabTriggerClassName =
  "h-9 rounded-lg border border-transparent text-[13px] font-medium transition-all hover:text-foreground data-[state=active]:border-primary/25 data-[state=active]:bg-[hsl(var(--primary-subtle))] data-[state=active]:font-semibold data-[state=active]:text-[hsl(var(--primary-text))] data-[state=active]:shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)] dark:hover:text-white dark:data-[state=active]:border-primary/30 dark:data-[state=active]:bg-primary/[0.14] dark:data-[state=active]:text-primary dark:data-[state=active]:shadow-none";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number | null;
  error?: string;
  required?: boolean;
  hideLabel?: boolean;
  showRequiredIndicator?: boolean;
}

function PasswordField({
  id,
  label,
  value,
  placeholder,
  visible,
  onChange,
  onToggle,
  autoComplete,
  minLength = 8,
  error,
  required = true,
  hideLabel = false,
  showRequiredIndicator = true,
}: PasswordFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      {!hideLabel && (
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
          {required && showRequiredIndicator && (
            <span className="ml-1 text-destructive">*</span>
          )}
        </Label>
      )}
      <div className="relative">
        <Lock className={iconClassName} />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength ?? undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`${fieldClassName} pl-10 pr-11 ${
            error
              ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15"
              : ""
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          className={visibilityButtonClassName}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function AuthBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -left-36 -top-36 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl dark:bg-primary/[0.025]" />
      <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl dark:bg-primary/[0.025]" />
      <div className="absolute inset-0 opacity-[0.22] [background-image:radial-gradient(hsl(var(--border-strong))_1px,transparent_1px)] [background-size:24px_24px] dark:opacity-0" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.5h3.2c1.9-1.8 3.1-4.4 3.1-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2 1-3.5 1a5.9 5.9 0 0 1-5.5-4.1H3.2v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.1L6.5 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.9c1.6 0 3 .5 4.1 1.6l3-3A10 10 0 0 0 3.2 7.5l3.3 2.6A5.9 5.9 0 0 1 12 5.9Z"
      />
    </svg>
  );
}

function GoogleAuthButton({
  loading,
  mode,
  onClick,
}: {
  loading: boolean;
  mode: "signin" | "signup";
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      loading={loading}
      loadingLabel={
        mode === "signin" ? "Signing in with Google" : "Signing up with Google"
      }
      className="h-11 w-full gap-3 rounded-xl border-input bg-[hsl(var(--input-background))] px-4 text-[13px] font-semibold text-foreground shadow-sm hover:border-[hsl(var(--input-border-hover))] hover:bg-muted/70 hover:text-foreground dark:border-white/10 dark:shadow-none dark:hover:border-white/20 dark:hover:bg-white/[0.06]"
    >
      <GoogleIcon />
      {mode === "signin" ? "Continue with Google" : "Sign up with Google"}
    </Button>
  );
}

function AuthVisualPanel() {
  return (
    <aside className="relative hidden min-h-[720px] overflow-hidden border-r border-white/[0.08] bg-[hsl(var(--brand-onyx))] text-white lg:block">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/[0.09] blur-3xl" />
        <div className="absolute -bottom-40 -left-28 h-96 w-96 rounded-full bg-primary/[0.06] blur-3xl" />
      </div>

      <Link
        to="/"
        aria-label="MaxForm home"
        className="absolute left-9 top-9 z-30 w-fit rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 [&_[data-brand-mark]]:!text-primary [&>span>span:last-child]:!text-white xl:left-11 xl:top-11"
      >
        <BrandLogo markSize={26} wordmarkClassName="text-[16px]" />
      </Link>

      <div className="absolute left-9 top-[150px] z-10 w-[270px] rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.7)] xl:left-11 xl:w-[292px]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              MaxForm workspace
            </p>
            <p className="mt-1 text-[15px] font-semibold text-white">
              Lead capture
            </p>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-primary">
            Live
          </span>
        </div>
        <div className="mt-5 space-y-3">
          <div className="rounded-xl border border-white/[0.08] bg-black/10 p-3">
            <div className="h-1.5 w-14 rounded-full bg-white/30" />
            <div className="mt-2.5 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04]" />
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/10 p-3">
            <div className="h-1.5 w-20 rounded-full bg-white/30" />
            <div className="mt-2.5 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04]" />
          </div>
          <div className="h-9 rounded-lg bg-primary" />
        </div>
      </div>

      <img
        src="/images/home-person-brand.png"
        alt="MaxForm user working on a laptop"
        className="absolute -bottom-4 -right-32 z-20 h-[530px] w-auto max-w-none object-contain object-bottom xl:-right-28 xl:h-[560px]"
      />

      <div className="absolute bottom-9 left-9 z-30 rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3 shadow-xl xl:bottom-11 xl:left-11">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Built into MaxForm
        </p>
        <p className="mt-1 text-[12px] font-medium text-white/90">
          Forms · Workflows · Payments
        </p>
      </div>
    </aside>
  );
}

export default function Auth() {
  const {
    user,
    loading,
    signIn,
    signInWithGoogle,
    signUp,
    requestPasswordReset,
    resetPassword,
  } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupWorkspaceName, setSignupWorkspaceName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupPhone, setSignupPhone] = useState<string | undefined>("");
  const [signupCountry, setSignupCountry] = useState("");

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirmPassword, setShowSignupConfirmPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const [signupErrors, setSignupErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});

  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetStep, setResetStep] = useState<"request" | "reset" | "success">(
    "request",
  );
  const [generatedToken, setGeneratedToken] = useState("");

  if (loading) {
    return (
      <div className="public-theme flex min-h-[100svh] items-center justify-center bg-background dark:bg-[hsl(var(--ls-ink))]">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/dashboard" replace />;

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await signIn(loginEmail, loginPassword);
      toast({
        title: "Welcome back!",
        description: "Redirecting to your dashboard...",
      });
      setTimeout(() => navigate("/dashboard"), 100);
    } catch (error: unknown) {
      toast({
        title: "Login failed",
        description: getErrorMessage(error, "Sign in failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async (intent: "signin" | "signup") => {
    setIsGoogleSubmitting(true);
    try {
      await signInWithGoogle(intent);
      toast({
        title: intent === "signup" ? "Account ready!" : "Welcome back!",
        description: "Taking you to your MaxForm workspace...",
      });
      navigate("/dashboard");
    } catch (error: unknown) {
      toast({
        title:
          intent === "signup"
            ? "Google sign up failed"
            : "Google sign in failed",
        description: getErrorMessage(
          error,
          "Google authentication could not be completed.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleSignup = async (event: FormEvent) => {
    event.preventDefault();
    setSignupErrors({});

    const errors: { password?: string; confirmPassword?: string } = {};
    if (signupPassword.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }
    if (signupPassword !== signupConfirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }
    if (Object.keys(errors).length > 0) {
      setSignupErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const countryName = signupCountry
        ? en[signupCountry as keyof typeof en]
        : "";

      await signUp({
        email: signupEmail,
        password: signupPassword,
        workspaceName: signupWorkspaceName,
        phone: signupPhone || "",
        country: countryName || signupCountry,
      });
      toast({
        title: "Account created!",
        description: "Welcome to MaxForm. Redirecting to your dashboard...",
      });
      setTimeout(() => navigate("/dashboard"), 100);
    } catch (error: unknown) {
      toast({
        title: "Signup failed",
        description: getErrorMessage(error, "An error occurred during signup"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetEmail) {
      toast({
        title: "Email or username required",
        description: "Enter the email address or username for your account",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(resetEmail);
      setGeneratedToken(result.token);
      setResetStep("reset");
      toast({
        title: "Reset token generated",
        description: "Use the token below to reset your password",
      });
    } catch (error: unknown) {
      toast({
        title: "Request failed",
        description: getErrorMessage(error, "Password reset request failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetToken || !newPassword) {
      toast({
        title: "Missing fields",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both passwords match",
        variant: "destructive",
      });
      return;
    }
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword(resetToken, newPassword);
      setResetStep("success");
      toast({
        title: "Password reset successful",
        description: "You can now sign in with your new password",
      });
    } catch (error: unknown) {
      toast({
        title: "Reset failed",
        description: getErrorMessage(error, "Password reset failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = () => {
    setShowPasswordReset(false);
    setResetStep("request");
    setResetEmail("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setGeneratedToken("");
  };

  if (showPasswordReset) {
    return (
      <div className="public-theme relative min-h-[100svh] overflow-x-hidden bg-background dark:bg-[hsl(var(--ls-ink))]">
        <AuthBackground />

        <main className="relative flex min-h-[100svh] items-start justify-center px-3 py-4 sm:px-6 sm:py-8">
          <section className="my-auto w-full max-w-[480px] rounded-[24px] border border-border/80 bg-card/95 p-5 shadow-[0_24px_80px_-30px_rgba(18,18,20,0.28)] backdrop-blur dark:border-white/[0.08] dark:bg-card dark:shadow-[0_24px_70px_-32px_rgba(0,0,0,0.6)] dark:backdrop-blur-none sm:rounded-[28px] sm:p-8">
            <div className="mb-7 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/[0.06]"
              >
                <ArrowLeft className="h-4 w-4" />
                Sign in
              </button>
              <Link
                to="/"
                aria-label="MaxForm home"
                className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <BrandLogo markSize={22} wordmarkClassName="text-[15px]" />
              </Link>
            </div>

            <div className="mb-6">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </div>
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-foreground sm:text-[30px]">
                {resetStep === "success"
                  ? "Password updated"
                  : "Reset your password"}
              </h1>
              <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                {resetStep === "request" &&
                  "Enter your email and we’ll help you regain access."}
                {resetStep === "reset" &&
                  "Use the reset token to choose a new, secure password."}
                {resetStep === "success" &&
                  "Your account is secure and ready for you to sign in."}
              </p>
            </div>

            {resetStep === "request" && (
              <form onSubmit={handleRequestPasswordReset} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className="text-[13px] font-medium">
                    Email or username
                  </Label>
                  <div className="relative">
                    <Mail className={iconClassName} />
                    {/* Not type="email": a member provisioned by a workspace
                        owner may only have their username to hand, and the
                        browser would refuse to submit one from an email field.
                        The server accepts either. */}
                    <Input
                      id="reset-email"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="you@example.com"
                      value={resetEmail}
                      onChange={(event) => setResetEmail(event.target.value)}
                      required
                      className={`${fieldClassName} pl-10`}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="brand"
                  className="h-11 w-full rounded-xl text-[14px] font-semibold shadow-sm"
                  loading={isSubmitting}
                  loadingLabel="Sending reset token"
                >
                  Send reset token
                </Button>
              </form>
            )}

            {resetStep === "reset" && (
              <div className="space-y-5">
                {generatedToken && (
                  <Alert className="rounded-xl border-primary/30 bg-primary/5">
                    <AlertDescription className="text-[13px]">
                      <div className="mb-2 font-semibold">Your reset token</div>
                      <code className="block break-all rounded-lg border bg-background p-3 font-mono text-[11px]">
                        {generatedToken}
                      </code>
                      <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        Copy this token and paste it below. In production, it
                        would be sent by email.
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-token" className="text-[13px] font-medium">
                      Reset token
                    </Label>
                    <Input
                      id="reset-token"
                      type="text"
                      placeholder="Paste your reset token"
                      value={resetToken}
                      onChange={(event) => setResetToken(event.target.value)}
                      required
                      className={`${fieldClassName} font-mono text-[12px]`}
                    />
                  </div>
                  <PasswordField
                    id="new-password"
                    label="New password"
                    value={newPassword}
                    placeholder="At least 8 characters"
                    visible={showNewPassword}
                    onChange={setNewPassword}
                    onToggle={() => setShowNewPassword((visible) => !visible)}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    id="confirm-new-password"
                    label="Confirm new password"
                    value={confirmPassword}
                    placeholder="Repeat your new password"
                    visible={showConfirmNewPassword}
                    onChange={setConfirmPassword}
                    onToggle={() =>
                      setShowConfirmNewPassword((visible) => !visible)
                    }
                    autoComplete="new-password"
                  />
                  <Button
                    type="submit"
                    variant="brand"
                    className="h-11 w-full rounded-xl text-[14px] font-semibold shadow-sm"
                    loading={isSubmitting}
                    loadingLabel="Resetting password"
                  >
                    Reset password
                  </Button>
                </form>
              </div>
            )}

            {resetStep === "success" && (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--success-border))] bg-[hsl(var(--success-background))] p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <p className="text-[13px] leading-5 text-foreground">
                    Your password has been reset successfully. You can now use
                    it to access your account.
                  </p>
                </div>
                <Button
                  onClick={handleBackToLogin}
                  variant="brand"
                  className="h-11 w-full rounded-xl text-[14px] font-semibold"
                >
                  Go to sign in
                </Button>
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="public-theme relative min-h-[100svh] overflow-x-hidden bg-background dark:bg-[hsl(var(--ls-ink))]">
      <AuthBackground />

      <main className="relative flex min-h-[100svh] items-start justify-center px-3 py-3 sm:px-6 sm:py-6 lg:px-8 lg:py-4">
        <section className="my-auto grid w-full max-w-[980px] overflow-hidden rounded-[24px] border border-border/80 bg-card/95 shadow-[0_28px_90px_-32px_rgba(18,18,20,0.30)] backdrop-blur dark:border-white/[0.08] dark:bg-card dark:shadow-[0_28px_80px_-36px_rgba(0,0,0,0.65)] dark:backdrop-blur-none sm:rounded-[30px] lg:grid-cols-[0.9fr_1.1fr]">
          <AuthVisualPanel />

          <div className="flex min-w-0 flex-col p-5 sm:p-8 lg:p-8 xl:px-12 xl:py-10">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/[0.06]"
              >
                <ArrowLeft className="h-4 w-4" />
                Home
              </button>
              <Link
                to="/"
                aria-label="MaxForm home"
                className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 lg:hidden"
              >
                <BrandLogo markSize={22} wordmarkClassName="text-[14px]" />
              </Link>
            </div>

            <div className="mx-auto mt-7 w-full max-w-[440px] sm:mt-9 lg:my-auto">
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--primary-text))]">
                  {activeTab === "login" ? "Welcome back" : "Get started free"}
                </p>
                <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-foreground sm:text-[34px]">
                  {activeTab === "login"
                    ? "Sign in to your account"
                    : "Create your MaxForm account"}
                </h1>
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  {activeTab === "login"
                    ? "Enter your details to continue to your workspace."
                    : "Set up your workspace and start building better forms."}
                </p>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  setActiveTab(value as "login" | "signup")
                }
                className="mt-6"
              >
                <TabsList className={tabsListClassName}>
                  <TabsTrigger value="login" className={tabTriggerClassName}>
                    Sign in
                  </TabsTrigger>
                  <TabsTrigger value="signup" className={tabTriggerClassName}>
                    Sign up
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-6">
                  <GoogleAuthButton
                    mode="signin"
                    loading={isGoogleSubmitting}
                    onClick={() => void handleGoogleAuth("signin")}
                  />
                  <div className="my-4 flex items-center gap-3">
                    <span className="h-px flex-1 bg-border dark:bg-white/[0.08]" />
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      or use email
                    </span>
                    <span className="h-px flex-1 bg-border dark:bg-white/[0.08]" />
                  </div>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-email" className="text-[13px] font-medium">
                        Email or username
                      </Label>
                      <div className="relative">
                        <Mail className={iconClassName} />
                        {/* Members added by a workspace owner are given a
                            username alongside their address, and the mail they
                            receive shows both. */}
                        <Input
                          id="login-email"
                          type="text"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="you@example.com"
                          value={loginEmail}
                          onChange={(event) => setLoginEmail(event.target.value)}
                          required
                          className={`${fieldClassName} pl-10`}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="login-password"
                          className="text-[13px] font-medium"
                        >
                          Password
                        </Label>
                        <button
                          type="button"
                          onClick={() => setShowPasswordReset(true)}
                          className="rounded text-[12px] font-medium text-[hsl(var(--primary-text))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <PasswordField
                        id="login-password"
                        label="Password"
                        value={loginPassword}
                        placeholder="Enter your password"
                        visible={showLoginPassword}
                        onChange={setLoginPassword}
                        onToggle={() =>
                          setShowLoginPassword((visible) => !visible)
                        }
                        autoComplete="current-password"
                        minLength={null}
                        hideLabel
                        showRequiredIndicator={false}
                      />
                    </div>

                    <Button
                      type="submit"
                      variant="brand"
                      className="h-11 w-full rounded-xl text-[14px] font-semibold shadow-sm"
                      loading={isSubmitting}
                      loadingLabel="Signing in"
                    >
                      Sign in
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="mt-5">
                  <GoogleAuthButton
                    mode="signup"
                    loading={isGoogleSubmitting}
                    onClick={() => void handleGoogleAuth("signup")}
                  />
                  <div className="my-3.5 flex items-center gap-3">
                    <span className="h-px flex-1 bg-border dark:bg-white/[0.08]" />
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      or use email
                    </span>
                    <span className="h-px flex-1 bg-border dark:bg-white/[0.08]" />
                  </div>
                  <form onSubmit={handleSignup} className="space-y-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="signup-workspace-name"
                          className="text-[13px] font-medium"
                        >
                          Workspace name <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <Building2 className={iconClassName} />
                          <Input
                            id="signup-workspace-name"
                            type="text"
                            autoComplete="organization"
                            placeholder="Acme Events"
                            value={signupWorkspaceName}
                            onChange={(event) =>
                              setSignupWorkspaceName(event.target.value)
                            }
                            required
                            className={`${fieldClassName} pl-10`}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label
                          htmlFor="signup-email"
                          className="text-[13px] font-medium"
                        >
                          Email <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <Mail className={iconClassName} />
                          <Input
                            id="signup-email"
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={signupEmail}
                            onChange={(event) =>
                              setSignupEmail(event.target.value)
                            }
                            required
                            className={`${fieldClassName} pl-10`}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3.5 sm:grid-cols-[minmax(170px,0.82fr)_minmax(0,1.18fr)]">
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor="signup-country"
                          className="text-[13px] font-medium"
                        >
                          Country
                        </Label>
                        <CountrySelect
                          id="signup-country"
                          value={signupCountry}
                          onChange={setSignupCountry}
                          placeholder="Select your country"
                          className="h-11 rounded-xl border-input bg-[hsl(var(--input-background))] text-[14px] shadow-sm hover:border-[hsl(var(--input-border-hover))] focus:ring-primary/20 dark:border-white/10 dark:shadow-none dark:hover:border-white/20"
                        />
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor="signup-phone"
                          className="text-[13px] font-medium"
                        >
                          Phone number
                        </Label>
                        <PhoneInput
                          id="signup-phone"
                          value={signupPhone}
                          onChange={setSignupPhone}
                          country={
                            (signupCountry || undefined) as Country | undefined
                          }
                          defaultCountry={(signupCountry || "US") as Country}
                          onCountryChange={setSignupCountry}
                          autoComplete="tel"
                          placeholder="Phone number"
                          className="[&_button]:h-11 [&_button]:min-w-[92px] [&_button]:rounded-xl [&_button]:bg-[hsl(var(--input-background))] [&_button]:px-2.5 [&_input]:h-11 [&_input]:w-full [&_input]:rounded-xl [&_input]:bg-[hsl(var(--input-background))] dark:[&_button]:border-white/10 dark:[&_button]:shadow-none dark:[&_input]:border-white/10"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3.5">
                      <PasswordField
                        id="signup-password"
                        label="Password"
                        value={signupPassword}
                        placeholder="At least 8 characters"
                        visible={showSignupPassword}
                        onChange={(value) => {
                          setSignupPassword(value);
                          if (signupErrors.password) {
                            setSignupErrors((previous) => ({
                              ...previous,
                              password: undefined,
                            }));
                          }
                        }}
                        onToggle={() =>
                          setShowSignupPassword((visible) => !visible)
                        }
                        autoComplete="new-password"
                        error={signupErrors.password}
                      />
                      <PasswordField
                        id="signup-confirm-password"
                        label="Confirm password"
                        value={signupConfirmPassword}
                        placeholder="Repeat password"
                        visible={showSignupConfirmPassword}
                        onChange={(value) => {
                          setSignupConfirmPassword(value);
                          if (signupErrors.confirmPassword) {
                            setSignupErrors((previous) => ({
                              ...previous,
                              confirmPassword: undefined,
                            }));
                          }
                        }}
                        onToggle={() =>
                          setShowSignupConfirmPassword((visible) => !visible)
                        }
                        autoComplete="new-password"
                        error={signupErrors.confirmPassword}
                      />
                    </div>

                    <Button
                      type="submit"
                      variant="brand"
                      className="h-11 w-full rounded-xl text-[14px] font-semibold shadow-sm"
                      loading={isSubmitting}
                      loadingLabel="Creating account"
                    >
                      Create account
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
                By continuing, you agree to our{" "}
                <Link
                  to="/terms"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  to="/privacy"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
