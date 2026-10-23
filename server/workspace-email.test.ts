import { describe, expect, it } from "vitest";

import {
  publicEmailErrorMessage,
  shouldEnforceWorkspaceHourlyEmailLimit,
  shouldRetryWorkspaceEmailDelivery,
  staleEmailRecoveryDecision,
} from "./workspace-email";

describe("workspace email stale-send recovery", () => {
  it("requeues an interrupted send below the attempt limit", () => {
    expect(staleEmailRecoveryDecision(1)).toBe("queued");
    expect(staleEmailRecoveryDecision(2)).toBe("queued");
  });

  it("stops retrying an interrupted send at the attempt limit", () => {
    expect(staleEmailRecoveryDecision(3)).toBe("failed");
    expect(staleEmailRecoveryDecision(5)).toBe("failed");
  });

  it("redacts technical and secret-bearing messages before they reach the dashboard", () => {
    expect(publicEmailErrorMessage("MAXFORM_MANAGED_RESEND_API_KEY is missing")).toBe("The email provider needs attention.");
    expect(publicEmailErrorMessage('Provider response {"api_key":"secret-value"}')).toBe("The email provider needs attention.");
    expect(publicEmailErrorMessage("This sender domain is not verified. Check the DNS records and try again.")).toBe("This sender domain is not verified. Check the DNS records and try again.");
  });
});

describe("workspace email delivery policy", () => {
  it("does not apply the generic hourly log cap while staging a durable campaign wave", () => {
    expect(
      shouldEnforceWorkspaceHourlyEmailLimit({
        emailClassification: "CAMPAIGN",
        autoDeliver: false,
      }),
    ).toBe(false);
    expect(
      shouldEnforceWorkspaceHourlyEmailLimit({
        templateKey: "campaign_send",
        autoDeliver: false,
      }),
    ).toBe(false);
  });

  it("keeps the hourly log cap for interactive and non-campaign email", () => {
    expect(
      shouldEnforceWorkspaceHourlyEmailLimit({
        emailClassification: "CAMPAIGN",
        autoDeliver: true,
      }),
    ).toBe(true);
    expect(
      shouldEnforceWorkspaceHourlyEmailLimit({
        emailClassification: "TRANSACTIONAL",
        autoDeliver: false,
      }),
    ).toBe(true);
    expect(shouldEnforceWorkspaceHourlyEmailLimit({})).toBe(true);
  });

  it("keeps temporary retries for durable worker delivery", () => {
    expect(
      shouldRetryWorkspaceEmailDelivery({
        retryable: true,
        attemptCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldRetryWorkspaceEmailDelivery({
        retryable: true,
        attemptCount: 3,
      }),
    ).toBe(false);
  });

  it("never turns an interactive send into a delayed queued retry", () => {
    expect(
      shouldRetryWorkspaceEmailDelivery({
        retryable: true,
        attemptCount: 1,
        retryOnTemporaryFailure: false,
      }),
    ).toBe(false);
  });
});
