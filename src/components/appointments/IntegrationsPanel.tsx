/**
 * Scheduling integrations.
 *
 * A card can be in one of five states and each one needs a different action, so
 * the card resolves the state once and the footer follows from it:
 *
 *   unavailable      the server has no client credentials for this provider
 *   disconnected     nothing stored yet
 *   connected        a usable token, refreshed automatically
 *   needs_reconnect  the token expired and could not be refreshed
 *   error            the last live check failed for some other reason
 *
 * "Connected" here means a token was exchanged and the provider confirmed the
 * account, not that a row exists.
 */
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SecureConnectionDialog } from "@/components/shared/SecureConnectionDialog";
import { cn } from "@/lib/utils";
import type { AppointmentsWorkspace, SchedulingToolProvider } from "@/lib/appointments";
import {
  connectSchedulingKey,
  disconnectSchedulingTool,
  getSchedulingProviders,
  prepareSchedulingConnection,
  schedulingProvidersQueryKey,
  testSchedulingConnection,
  type SchedulingProviderStatus,
} from "@/lib/scheduling-integrations";
import { ProviderLogo } from "./provider-logos";
import { SectionHeading } from "./SectionHeading";
import { providerCategories, providerMeta } from "./appointment-format";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";

type CardState = "unavailable" | "disconnected" | "connected" | "needs_reconnect" | "error";

/** Providers that accept a pasted key instead of, or as well as, a sign-in. */
const keyInstructions: Partial<Record<SchedulingToolProvider, string>> = {
  cal_com: "Cal.com → Settings → Developer → API keys. Create a key with no expiry.",
  calendly: "Calendly → Integrations → API & webhooks → Personal access tokens.",
};

const expiryLabel = (value: string | null) => {
  if (!value) return "";
  const at = new Date(value).valueOf();
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((at - Date.now()) / 60000);
  // A token in the past is not a problem on its own — it is refreshed on the
  // next call — so this reads as maintenance information, not an alarm.
  if (minutes <= 0) return "renews on next use";
  if (minutes < 60) return `renews in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `renews in ${hours}h` : `renews in ${Math.round(hours / 24)}d`;
};

const lastCheckedLabel = (value: string | null) => {
  if (!value) return "";
  const at = new Date(value).valueOf();
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `checked ${hours}h ago` : `checked ${Math.round(hours / 24)}d ago`;
};

export function IntegrationsPanel({
  data,
  onRefresh,
}: {
  data: AppointmentsWorkspace;
  onRefresh: () => Promise<unknown> | unknown;
}) {
  const [oauthProvider, setOauthProvider] = useState<SchedulingToolProvider | null>(null);
  const [keyProvider, setKeyProvider] = useState<SchedulingToolProvider | null>(null);
  const [confirmProvider, setConfirmProvider] = useState<SchedulingToolProvider | null>(null);
  const [testing, setTesting] = useState<SchedulingToolProvider | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const providersQuery = useQuery({
    queryKey: schedulingProvidersQueryKey,
    queryFn: getSchedulingProviders,
    retry: false,
    // Server credentials only change on redeploy, so this need not be chatty.
    staleTime: 5 * 60 * 1000,
  });

  const status = providersQuery.data?.providers;
  const byProvider = new Map(data.connections.map((item) => [item.provider, item]));

  const cardState = (provider: SchedulingToolProvider): CardState => {
    const connection = byProvider.get(provider);
    if (connection) {
      // A row without a credential is a leftover from the placeholder connect
      // action; it cannot be used, so it is not "connected".
      if (!connection.hasCredential || connection.status === "needs_reconnect") {
        return "needs_reconnect";
      }
      if (connection.status === "error") return "error";
      return "connected";
    }
    // Availability only matters when there is nothing stored — an existing
    // connection stays manageable even if the client id was later removed.
    if (status && !status[provider]?.configured) return "unavailable";
    return "disconnected";
  };

  const runTest = async (provider: SchedulingToolProvider) => {
    setTesting(provider);
    try {
      const result = await testSchedulingConnection(provider);
      if (result.ok) toast.success(`${providerMeta[provider].name} is responding.`);
      else toast.error(result.error || `${providerMeta[provider].name} rejected the token.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That connection could not be checked.",
      );
    } finally {
      setTesting(null);
      await onRefresh();
    }
  };

  const runDisconnect = async () => {
    if (!confirmProvider) return;
    setDisconnecting(true);
    try {
      const result = await disconnectSchedulingTool(confirmProvider);
      toast.success(
        result.revoked
          ? `${providerMeta[confirmProvider].name} disconnected and access revoked.`
          : `${providerMeta[confirmProvider].name} disconnected.`,
      );
      setConfirmProvider(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That account could not be disconnected.",
      );
    } finally {
      setDisconnecting(false);
      await onRefresh();
    }
  };

  const startConnect = (provider: SchedulingToolProvider, providerStatus?: SchedulingProviderStatus) => {
    if (providerStatus?.authType === "api_key") setKeyProvider(provider);
    else setOauthProvider(provider);
  };

  const prepare = useCallback(async () => {
    if (!oauthProvider) throw new Error("No provider selected");
    return prepareSchedulingConnection(oauthProvider);
  }, [oauthProvider]);

  return (
    <div>
      <SectionHeading
        title="Integrations"
        description="Connect the calendar, video and scheduling tools your workspace already runs on. Each one signs in with its own provider — MaxForm never sees your password."
      />

      {providersQuery.isError ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
          The list of available providers could not be loaded, so connecting is unavailable right
          now. Existing connections are unaffected.
        </p>
      ) : null}

      <div className="mt-5 space-y-6">
        {providerCategories.map((category) => {
          const providers = (Object.keys(providerMeta) as SchedulingToolProvider[]).filter(
            (provider) => providerMeta[provider].category === category.key,
          );
          return (
            <section key={category.key}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-[13px] font-semibold">{category.label}</h3>
                <p className="text-[11px] text-muted-foreground">{category.note}</p>
              </div>
              <PaginatedCardGrid
                items={providers}
                pageSize={12}
                itemLabel={`${category.label.toLowerCase()} providers`}
                getKey={(provider) => provider}
                renderItem={(provider) => {
                  const meta = providerMeta[provider];
                  const connection = byProvider.get(provider);
                  const providerStatus = status?.[provider];
                  const state = cardState(provider);
                  const busy = testing === provider;

                  return (
                    <div
                      key={provider}
                      className={cn(
                        "flex flex-col rounded-xl border bg-card p-4 transition-colors",
                        state === "connected" && "border-emerald-500/30",
                        state === "needs_reconnect" && "border-amber-500/40",
                        state === "error" && "border-destructive/40",
                        (state === "disconnected" || state === "unavailable") && "border-border",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <ProviderLogo
                          provider={provider}
                          className={cn(
                            "h-9 w-9 shrink-0 rounded-md",
                            state === "unavailable" && "opacity-45 grayscale",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold">{meta.name}</p>
                          <StateLine state={state} />
                          {connection?.accountLabel ? (
                            <p
                              className="mt-0.5 truncate text-[10px] text-muted-foreground"
                              title={connection.accountLabel}
                            >
                              {connection.accountLabel}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <p className="mt-3 flex-1 text-[11px] leading-4 text-muted-foreground">
                        {meta.blurb}
                      </p>

                      {state === "unavailable" ? (
                        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                          No {meta.name} app is configured on this server yet.{" "}
                          {providerStatus?.setupUrl ? (
                            <a
                              href={providerStatus.setupUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                            >
                              Register one <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ) : null}
                        </p>
                      ) : null}

                      {connection?.lastError && state !== "connected" ? (
                        <p className="mt-2 rounded-md bg-destructive/5 p-2 text-[10px] leading-4 text-destructive">
                          {connection.lastError}
                        </p>
                      ) : null}

                      {state === "connected" ? (
                        <p className="mt-2 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                          {connection?.authType === "api_key" ? (
                            <span>API key</span>
                          ) : (
                            <span>{expiryLabel(connection?.tokenExpiresAt ?? null)}</span>
                          )}
                          <span>{lastCheckedLabel(connection?.lastSyncedAt ?? null)}</span>
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {state === "connected" || state === "error" ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px]"
                              disabled={busy}
                              onClick={() => void runTest(provider)}
                            >
                              {busy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              Test
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => setConfirmProvider(provider)}
                            >
                              Disconnect
                            </Button>
                          </>
                        ) : null}

                        {state === "needs_reconnect" ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => setConfirmProvider(provider)}
                            >
                              Remove
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => startConnect(provider, providerStatus)}
                            >
                              Reconnect
                            </Button>
                          </>
                        ) : null}

                        {state === "disconnected" ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={providersQuery.isLoading}
                            onClick={() => startConnect(provider, providerStatus)}
                          >
                            {providersQuery.isLoading ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : null}
                            Connect
                          </Button>
                        ) : null}

                        {state === "unavailable" && keyInstructions[provider] ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => setKeyProvider(provider)}
                          >
                            <KeyRound className="h-3 w-3" />
                            Use an API key
                          </Button>
                        ) : null}

                        {state === "unavailable" && !keyInstructions[provider] ? (
                          <Button type="button" size="sm" className="h-7 text-[11px]" disabled>
                            Connect
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                }}
              />
            </section>
          );
        })}
      </div>

      <section className="mt-6 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[12px] font-semibold">What connecting Calendly or Cal.com does</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              It is a migration bridge, not a takeover. Every new booking made on your existing
              account is pushed here as a Contact and an Appointment, so your CRM stays the single
              source of truth for who booked what — while the booking page itself stays theirs. When
              you are ready to switch fully, build a native booking page and stop using them.
            </p>
          </div>
        </div>
      </section>

      {oauthProvider ? (
        <SecureConnectionDialog
          open
          name={providerMeta[oauthProvider].name}
          description={`You will sign in to ${providerMeta[oauthProvider].name} and approve access. MaxForm stores an encrypted token, never your password, and you can disconnect at any time.`}
          prepareConnection={prepare}
          onConnected={async () => {
            await onRefresh();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setOauthProvider(null);
              void onRefresh();
            }
          }}
        />
      ) : null}

      {keyProvider ? (
        <ApiKeyDialog
          provider={keyProvider}
          onClose={() => setKeyProvider(null)}
          onConnected={onRefresh}
        />
      ) : null}

      <AlertDialog
        open={Boolean(confirmProvider)}
        onOpenChange={(open) => {
          if (!open) setConfirmProvider(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {confirmProvider ? providerMeta[confirmProvider].name : "this account"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              MaxForm will delete the stored token and, where the provider supports it, revoke
              access. Bookings already made stay in your workspace. New bookings will stop syncing
              until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnecting}
              onClick={(event) => {
                // The dialog closes itself on action; keep it open until the
                // request settles so the result is visible.
                event.preventDefault();
                void runDisconnect();
              }}
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StateLine({ state }: { state: CardState }) {
  const config: Record<CardState, { dot: string; text: string; label: string }> = {
    connected: {
      dot: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-300",
      label: "Connected",
    },
    needs_reconnect: {
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      label: "Reconnect needed",
    },
    error: { dot: "bg-destructive", text: "text-destructive", label: "Not responding" },
    disconnected: {
      dot: "bg-muted-foreground/50",
      text: "text-muted-foreground",
      label: "Not connected",
    },
    unavailable: {
      dot: "bg-muted-foreground/30",
      text: "text-muted-foreground",
      label: "Not available",
    },
  };
  const { dot, text, label } = config[state];
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[10px]">
      <span className={cn("inline-flex h-1.5 w-1.5 rounded-full", dot)} />
      <span className={text}>{label}</span>
    </p>
  );
}

/**
 * API key connect.
 *
 * The key is verified against the provider before it is saved, so a bad paste
 * fails here with the provider's own reason rather than becoming a connection
 * that quietly never works.
 */
function ApiKeyDialog({
  provider,
  onClose,
  onConnected,
}: {
  provider: SchedulingToolProvider;
  onClose: () => void;
  onConnected: () => Promise<unknown> | unknown;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const meta = providerMeta[provider];

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await connectSchedulingKey(provider, apiKey.trim());
      toast.success(`${meta.name} connected as ${result.accountLabel}.`);
      await onConnected();
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "That key could not be verified.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <div className="mb-3 flex items-center gap-3">
            <ProviderLogo provider={provider} className="h-10 w-10 rounded-md" />
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <KeyRound className="h-3.5 w-3.5" />
              Stored encrypted
            </span>
          </div>
          <DialogTitle>Connect {meta.name}</DialogTitle>
          <DialogDescription>
            {meta.name} has no sign-in flow for individual accounts, so it connects with an API
            key. {keyInstructions[provider]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="scheduling-api-key" className="text-[12px]">
            API key
          </Label>
          <Input
            id="scheduling-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && apiKey.trim() && !saving) void submit();
            }}
            placeholder="Paste the key here"
          />
          {error ? (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              The key is checked against {meta.name} before it is saved.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !apiKey.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
