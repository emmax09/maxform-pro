/**
 * Client for the new-user onboarding flow.
 *
 * Every step posts its own answers, so an interrupted signup resumes rather
 * than restarting.
 */

export type OnboardingState = {
  businessName: string;
  businessType: string;
  industry: string;
  /** Hex, e.g. "#236BFE". Required before onboarding can complete. */
  brandColor: string;
  /** Data URI or https URL; empty when the brand has no artwork yet. */
  logoUrl: string;
  teamSize: string;
  websiteUrl: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  goals: string[];
  modules: string[];
  referralSource: string;
  currentStep: number;
  completed: boolean;
  skipped: boolean;
  /** The composed one-line address other modules read. */
  mailingAddress: string;
};

export type OnboardingAnswers = Partial<
  Omit<OnboardingState, "completed" | "skipped" | "mailingAddress">
>;

const token = () => localStorage.getItem("access_token") || "";

const request = async <T>(
  action: "state" | "save" | "complete" | "skip",
  input?: OnboardingAnswers,
) => {
  const accessToken = token();
  if (!accessToken) throw new Error("Sign in again to continue.");
  const response = await fetch(`/api/onboarding?action=${action}`, {
    method: input || action !== "state" ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(input || action !== "state"
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      input || action !== "state"
        ? JSON.stringify({ input: input || {} })
        : undefined,
  });
  const value = (await response.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(value.error || "Account setup is temporarily unavailable.");
  }
  return value.result as T;
};

export const getOnboardingState = () => request<OnboardingState>("state");

export const saveOnboardingStep = (input: OnboardingAnswers) =>
  request<OnboardingState>("save", input);

export const completeOnboarding = (input: OnboardingAnswers) =>
  request<OnboardingState>("complete", input);

export const skipOnboarding = () => request<OnboardingState>("skip");
