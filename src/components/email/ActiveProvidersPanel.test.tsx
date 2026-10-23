import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActiveProvidersPanel } from "@/components/email/EmailModule";
import type { EmailConnection, EmailProviderId, EmailProviderSchema } from "@/lib/email";

const connection = (overrides: Partial<EmailConnection> = {}): EmailConnection => ({
  id: "connection-1",
  provider: "smtp",
  mode: "custom",
  credentialHint: "mailbox@example.com",
  role: "none",
  isActive: false,
  status: "connected",
  healthOk: true,
  validationMode: "delivery",
  accessMode: "send",
  lastHealthCheckAt: null,
  lastVerifiedAt: null,
  lastError: "",
  createdAt: null,
  inboundEnabled: false,
  eventsEnabled: false,
  ...overrides,
});

const schemas = Object.fromEntries(
  (["resend", "smtp", "sendgrid", "postmark", "mailgun", "ses"] as EmailProviderId[]).map((provider) => [
    provider,
    { name: provider === "smtp" ? "SMTP" : provider, description: "Test provider" },
  ]),
) as Record<EmailProviderId, EmailProviderSchema>;

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: () => undefined,
});

const renderPanel = (onRole: (provider: EmailProviderId, role: "active") => Promise<void>) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveProvidersPanel
        connections={[connection()]}
        managedConnection={connection({ id: "managed-resend", provider: "resend", mode: "managed", status: "disconnected", healthOk: false })}
        schemas={schemas}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onHealth={vi.fn()}
        onRole={onRole}
        onManagedRole={vi.fn()}
        working={false}
      />
    </QueryClientProvider>,
  );
};

describe("ActiveProvidersPanel", () => {
  it("keeps Set active loading only until the activation promise settles", async () => {
    let finish: (() => void) | undefined;
    const onRole = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPanel(onRole);

    fireEvent.click(screen.getByRole("combobox", { name: "Active delivery provider" }));
    fireEvent.click(await screen.findByRole("option", { name: /SMTP/ }));

    const button = screen.getByRole("button", { name: "Set active" });
    fireEvent.click(button);

    expect(onRole).toHaveBeenCalledWith("smtp", "active");
    expect(screen.getByRole("button", { name: /Saving/ })).toHaveAttribute("aria-busy", "true");

    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Set active" })).toHaveAttribute("aria-busy", "false"));
    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
  });
});
