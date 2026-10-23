import type {
  EmailActiveProvider,
  EmailConnection,
  EmailProviderId,
} from "@/lib/email";

export type EmailProviderChoice = {
  value: string;
  provider: EmailProviderId;
  mode: "managed" | "custom";
  label: string;
  healthy: boolean;
  isActive: boolean;
};

export const emailProviderChoiceValue = (
  provider: EmailProviderId,
  mode: "managed" | "custom",
) => `${mode}:${provider}`;

export const activeEmailProviderChoiceValue = (
  activeProvider: EmailActiveProvider | null | undefined,
) => activeProvider
  ? emailProviderChoiceValue(activeProvider.provider, activeProvider.mode)
  : "none";

export const parseEmailProviderChoiceValue = (
  value: string,
): EmailActiveProvider | null => {
  const [mode, provider, extra] = value.split(":");
  if (extra || (mode !== "managed" && mode !== "custom")) return null;
  if (!new Set<EmailProviderId>(["tosend", "resend", "sender", "smtp", "sendgrid", "postmark", "mailgun", "ses"]).has(provider as EmailProviderId)) return null;
  if (mode === "managed" && provider !== "resend") return null;
  return { mode, provider: provider as EmailProviderId };
};

export const buildEmailProviderChoices = (
  managedConnection: EmailConnection,
  connections: EmailConnection[],
  providerNames: Partial<Record<EmailProviderId, string>>,
): EmailProviderChoice[] => {
  const choices: EmailProviderChoice[] = managedConnection.status === "disconnected" ? [] : [{
      value: emailProviderChoiceValue("resend", "managed"),
      provider: "resend",
      mode: "managed",
      label: "Resend — Managed by MaxForm",
      healthy: managedConnection.status === "connected" && managedConnection.healthOk,
      isActive: managedConnection.isActive,
    }];
  const seen = new Set<EmailProviderId>();
  for (const connection of connections) {
    if (connection.mode !== "custom" || connection.status === "disconnected" || seen.has(connection.provider)) continue;
    seen.add(connection.provider);
    const providerName = providerNames[connection.provider] || connection.provider;
    choices.push({
      value: emailProviderChoiceValue(connection.provider, "custom"),
      provider: connection.provider,
      mode: "custom",
      label: connection.provider === "resend" ? `${providerName} — Custom account` : providerName,
      healthy: connection.status === "connected" && connection.healthOk,
      isActive: connection.isActive || connection.role === "primary",
    });
  }
  return choices;
};
