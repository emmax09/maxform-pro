import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Link2,
  Loader2,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  beginIntegrationConnection,
  connectIntegrationApiKey,
  disconnectIntegrationConnection,
  getIntegrationsWorkspace,
  openIntegrationPopup,
  saveIntegrationWebhook,
  testIntegrationConnection,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationWebhookInput,
  type IntegrationsWorkspace,
} from "@/lib/integrations";
import { officialIntegrationLogoSources } from "@/lib/integration-provider-assets";
import { cn } from "@/lib/utils";

export type IntegrationsTab = "directory" | "connections" | "activity";

type IntegrationsHubProps = {
  userId?: string;
  initialTab?: IntegrationsTab;
  onTabChange?: (tab: IntegrationsTab) => void;
};

const tabs: Array<{ key: IntegrationsTab; label: string; icon: LucideIcon }> = [
  { key: "directory", label: "Directory", icon: Boxes },
  { key: "connections", label: "Connections", icon: Link2 },
  { key: "activity", label: "Activity & health", icon: History },
];


const statusLabel: Record<string, string> = {
  available: "Available",
  coming_soon: "Coming soon",
  configuration_required: "Unavailable",
  not_connected: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  partially_connected: "Partially connected",
  reconnect_required: "Reconnect required",
  expired: "Expired",
  error: "Needs attention",
  disabled: "Disabled",
  revoked: "Revoked",
};

const statusClass: Record<string, string> = {
  connected: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partially_connected: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  configuration_required: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  not_connected: "border-border bg-muted text-muted-foreground",
  reconnect_required: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  expired: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-destructive/25 bg-destructive/10 text-destructive",
  disabled: "border-border bg-muted text-muted-foreground",
  revoked: "border-destructive/25 bg-destructive/10 text-destructive",
  coming_soon: "border-border bg-muted text-muted-foreground",
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Never" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("font-medium", statusClass[status] || statusClass.not_connected)}>{statusLabel[status] || status}</Badge>;
}

function ProviderMark({ provider }: { provider: IntegrationProvider }) {
  const wideLogo = provider.key === "google_workspace" || provider.key === "cal_com";
  return (
    <span className={cn("flex h-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white dark:bg-white", wideLogo ? "w-[96px] px-2" : "w-10 p-2")}>
      <IntegrationLogo provider={provider} />
    </span>
  );
}

function IntegrationLogo({ provider }: { provider: IntegrationProvider }) {
  const source = officialIntegrationLogoSources[provider.key];
  if (!source) return <Webhook className="h-6 w-6 text-foreground" strokeWidth={1.7} aria-label={`${provider.name} integration icon`} />;
  const wide = provider.key === "google_workspace" || provider.key === "cal_com";
  return <img src={source} alt={`${provider.name} official logo`} className={cn("object-contain", wide ? "h-6 w-auto max-w-[84px]" : "h-7 w-7")} loading="eager" />;
}

function ConnectionMark({ connection }: { connection: IntegrationConnection }) {
  const source = officialIntegrationLogoSources[connection.providerKey];
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white p-2 dark:bg-white">
      {source ? <img src={source} alt={`${connection.providerName} official logo`} className="h-7 w-7 object-contain" loading="eager" /> : <Link2 className="h-5 w-5 text-foreground" aria-label={`${connection.providerName} integration icon`} />}
    </span>
  );
}

const providerHighlights: Record<string, string[]> = {
  google_workspace: ["Calendar, Meet, Drive, Docs and Sheets", "Gmail sending for workflows", "Event, form, CRM and appointment workflows"],
  microsoft_365: ["Outlook Calendar and Teams", "OneDrive, Word and Excel", "Event and form workflows"],
  zoom: ["Create online meetings", "Event and appointment links"],
  slack: ["Send workspace messages", "Form and event alerts"],
  airtable: ["Write records to bases", "Sync CRM and form data"],
  hubspot: ["Sync contacts and leads", "Keep CRM activity connected"],
  notion: ["Create connected pages", "Save form and CRM context"],
  calendly: ["Read scheduling availability", "Connect booking workflows"],
  cal_com: ["Read scheduling availability", "Connect booking workflows"],
  dropbox: ["Read and write files", "Store workflow outputs"],
  box: ["Read and write files", "Store workflow outputs"],
  custom_webhook: ["Send secure HTTP requests", "Map form and event data"],
  zapier: ["Send workflow events", "Connect external automations"],
  make: ["Send workflow events", "Connect external automations"],
};

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function IntegrationsHub({
  userId,
  initialTab = "directory",
  onTabChange,
}: IntegrationsHubProps) {
  const queryClient = useQueryClient();
  const [localTab, setLocalTab] = useState<IntegrationsTab>(initialTab);
  const activeTab = onTabChange ? initialTab : localTab;
  const selectTab = (tab: IntegrationsTab) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [connectProvider, setConnectProvider] = useState<IntegrationProvider | null>(null);
  const [availabilityProvider, setAvailabilityProvider] = useState<IntegrationProvider | null>(null);
  const [webhookProvider, setWebhookProvider] = useState<IntegrationProvider | null>(null);
  const [webhookConnection, setWebhookConnection] = useState<IntegrationConnection | null>(null);
  const [connectWorking, setConnectWorking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const connectionWindowRef = useRef<Window | null>(null);
  const connectionPollRef = useRef<number | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);

  const clearConnectionAttempt = useCallback((notice = "") => {
    if (connectionPollRef.current !== null) window.clearInterval(connectionPollRef.current);
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    connectionPollRef.current = null;
    connectionTimeoutRef.current = null;
    connectionWindowRef.current = null;
    setConnectWorking(false);
    if (notice) toast.info(notice);
  }, []);

  const workspaceQuery = useQuery<IntegrationsWorkspace>({
    queryKey: ["integrations-workspace", userId],
    queryFn: getIntegrationsWorkspace,
    enabled: Boolean(userId),
    staleTime: 15_000,
  });
  const workspace = workspaceQuery.data;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "maxform:connection-result") return;
      if (event.data.status === "connected") {
        toast.success("Integration connected");
        void queryClient.invalidateQueries({ queryKey: ["integrations-workspace", userId] });
      } else if (event.data.status === "error") {
        toast.error("The provider could not be connected.");
      }
      clearConnectionAttempt();
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearConnectionAttempt();
    };
  }, [clearConnectionAttempt, queryClient, userId]);

  const categories = useMemo(() => ["all", ...Array.from(new Set((workspace?.providers || []).filter((provider) => provider.category !== "email").map((provider) => provider.category)))], [workspace?.providers]);
  const filteredProviders = useMemo(() => {
    const value = search.trim().toLowerCase();
    return (workspace?.providers || []).filter((provider) => provider.category !== "email").filter((provider) => {
      const matchesSearch = !value || `${provider.name} ${provider.description} ${provider.category}`.toLowerCase().includes(value);
      return matchesSearch && (category === "all" || provider.category === category);
    });
  }, [category, search, workspace?.providers]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations-workspace", userId] });
  };

  const startConnection = async (provider: IntegrationProvider) => {
    if (provider.status === "coming_soon" || provider.availability === "coming_soon") {
      setAvailabilityProvider(provider);
      return;
    }
    if (!provider.platformConfigured) {
      setAvailabilityProvider(provider);
      return;
    }
    if (provider.authType === "webhook") {
      setWebhookConnection(null);
      setWebhookProvider(provider);
      return;
    }
    if (provider.authType === "api_key" && ["calendly", "cal_com"].includes(provider.key)) {
      setConnectProvider(provider);
      return;
    }
    setConnectWorking(true);
    try {
      const url = await beginIntegrationConnection(provider.key, provider.capabilities[0] || "");
      const popup = openIntegrationPopup(url);
      if (!popup) {
        clearConnectionAttempt("Allow pop-ups to connect this provider, then try again.");
        return;
      }
      connectionWindowRef.current = popup;
      connectionPollRef.current = window.setInterval(() => {
        if (connectionWindowRef.current?.closed) clearConnectionAttempt("The connection window was closed before the account finished connecting.");
      }, 500);
      connectionTimeoutRef.current = window.setTimeout(() => clearConnectionAttempt("The connection timed out. You can try again."), 120_000);
      toast.info("Complete the secure connection in the provider window.");
    } catch (error) {
      clearConnectionAttempt();
      toast.error(error instanceof Error ? error.message : "The provider could not be connected.");
    }
  };

  const submitApiKey = async () => {
    if (!connectProvider || !apiKey.trim()) return;
    setConnectWorking(true);
    try {
      await connectIntegrationApiKey(connectProvider.key, apiKey.trim());
      toast.success(`${connectProvider.name} connected`);
      setConnectProvider(null);
      setApiKey("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The provider rejected that key.");
    } finally {
      setConnectWorking(false);
    }
  };

  const testConnection = async (connection: IntegrationConnection) => {
    setWorkingId(connection.id);
    try {
      const result = await testIntegrationConnection(connection.id);
      if (!result.ok) throw new Error(result.error || "The provider rejected this connection.");
      toast.success(`${connection.providerName} is healthy${result.statusCode ? ` · HTTP ${result.statusCode}` : ""}${result.durationMs ? ` · ${result.durationMs}ms` : ""}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The connection could not be tested.");
    } finally {
      setWorkingId(null);
    }
  };

  const disconnect = async (connection: IntegrationConnection) => {
    const dependencyTotal = connection.dependencyCount + connection.enabledModuleCount;
    const dependencyMessage = dependencyTotal
      ? `This connection is used by ${dependencyTotal} workflow or module reference${dependencyTotal === 1 ? "" : "s"}. Disconnect it anyway?`
      : `Disconnect ${connection.providerName}?`;
    if (!window.confirm(dependencyMessage)) return;
    setWorkingId(connection.id);
    try {
      await disconnectIntegrationConnection(connection.id, true);
      toast.success(`${connection.providerName} disconnected`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The connection could not be disconnected.");
    } finally {
      setWorkingId(null);
    }
  };

  if (workspaceQuery.isLoading) {
    return <div className="space-y-6" role="status" aria-label="Loading integrations"><div className="h-12 w-80 animate-pulse rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-3"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div><div className="h-[420px] animate-pulse rounded-xl bg-muted" /></div>;
  }

  if (workspaceQuery.isError || !workspace) {
    return <EmptyState icon={Unplug} title="Integrations could not be loaded" description="Refresh the workspace and try again. Your existing module connections have not been changed." />;
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary"><Cable className="h-4 w-4" /> Workspace tools</div>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">Integrations hub</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Connect your workspace once, use compatible providers throughout MaxForm, and keep every integration health check in one place.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Credentials stay server-side and are never shown here.</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Connected" value={workspace.summary.connectedCount} icon={CheckCircle2} tone="text-emerald-600" />
        <SummaryCard label="Provider directory" value={workspace.summary.providerCount} icon={Boxes} tone="text-primary" />
        <SummaryCard label="Needs attention" value={workspace.summary.attentionCount} icon={AlertTriangle} tone={workspace.summary.attentionCount ? "text-amber-600" : "text-muted-foreground"} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Integration sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => selectTab(tab.key)} className={cn("flex h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{tab.label}</button>;
        })}
      </div>

      {activeTab === "directory" && <DirectoryTab categories={categories} category={category} filteredProviders={filteredProviders} onCategoryChange={setCategory} onConnect={startConnection} search={search} setSearch={setSearch} connectWorking={connectWorking} />}
      {activeTab === "connections" && <ConnectionsTab connections={workspace.connections} workingId={workingId} refreshing={workspaceQuery.isFetching} onRefresh={refresh} onTest={testConnection} onDisconnect={disconnect} onEdit={(connection) => { const provider = workspace.providers.find((item) => item.key === connection.providerKey); if (!provider) return; setWebhookConnection(connection); setWebhookProvider(provider); }} />}
      {activeTab === "activity" && <ActivityTab workspace={workspace} />}

      <Dialog open={Boolean(connectProvider)} onOpenChange={(open) => { if (!open && !connectWorking) { setConnectProvider(null); setApiKey(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect {connectProvider?.name}</DialogTitle><DialogDescription>Paste a personal access key. MaxForm validates it before storing an encrypted server-side credential.</DialogDescription></DialogHeader>
          <div className="space-y-2 py-2"><Label htmlFor="integration-api-key">API key</Label><Input id="integration-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste the key" autoComplete="off" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setConnectProvider(null)} disabled={connectWorking}>Cancel</Button><Button onClick={() => void submitApiKey()} disabled={!apiKey.trim() || connectWorking}>{connectWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect securely</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(availabilityProvider)} onOpenChange={(open) => { if (!open) setAvailabilityProvider(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{availabilityProvider?.name} is not available yet</DialogTitle>
            <DialogDescription>
              This provider connection is not available in this workspace yet. Try again after the provider has been enabled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvailabilityProvider(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WebhookConnectionDialog provider={webhookProvider} connection={webhookConnection} onOpenChange={(open) => { if (!open) { setWebhookProvider(null); setWebhookConnection(null); } }} onSaved={refresh} />
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-muted", tone)}><Icon className="h-4 w-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold text-foreground">{value}</p></div></CardContent></Card>;
}

function DirectoryTab({ categories, category, filteredProviders, onCategoryChange, onConnect, search, setSearch, connectWorking }: { categories: string[]; category: string; filteredProviders: IntegrationProvider[]; onCategoryChange: (value: string) => void; onConnect: (provider: IntegrationProvider) => void; search: string; setSearch: (value: string) => void; connectWorking: boolean }) {
  const groups = [
    { key: "connected", label: "Connected", description: "Providers already active in this workspace.", providers: filteredProviders.filter((provider) => ["connected", "partially_connected", "reconnect_required", "expired", "error"].includes(provider.status)) },
    { key: "available", label: "Available", description: "Connect a provider once and use it across compatible MaxForm modules.", providers: filteredProviders.filter((provider) => ["available", "not_connected"].includes(provider.status)) },
    { key: "configuration", label: "Needs configuration", description: "These providers need platform credentials before they can be connected.", providers: filteredProviders.filter((provider) => provider.status === "configuration_required") },
    { key: "coming_soon", label: "Coming soon", description: "These adapters are visible for planning but are not connectable yet.", providers: filteredProviders.filter((provider) => provider.status === "coming_soon") },
  ].map((group) => ({ ...group, providers: [...group.providers].sort((a, b) => a.name.localeCompare(b.name)) })).filter((group) => group.providers.length);
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row md:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search providers, capabilities, or categories" className="pl-9" /></div><div className="flex flex-wrap gap-1">{categories.map((item) => <button key={item} type="button" onClick={() => onCategoryChange(item)} className={cn("rounded-md px-3 py-2 text-xs capitalize", category === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{item === "all" ? "All providers" : item}</button>)}</div></div>
    {groups.map((group) => <section key={group.key} className="space-y-3"><div><h2 className="text-sm font-semibold text-foreground">{group.label}</h2><p className="mt-1 text-xs text-muted-foreground">{group.description}</p></div><PaginatedCardGrid items={group.providers} pageSize={12} itemLabel={`${group.label.toLowerCase()} providers`} getKey={(provider) => provider.key} resetKey={`${category}:${search}`} renderItem={(provider) => <ProviderCard provider={provider} onConnect={onConnect} connectWorking={connectWorking} />} /></section>)}
    {!filteredProviders.length && <EmptyState icon={Search} title="No providers match" description="Try a different provider name or category." />}
  </div>;
}

function ProviderCard({ provider, onConnect, connectWorking }: { provider: IntegrationProvider; onConnect: (provider: IntegrationProvider) => void; connectWorking: boolean }) {
  const comingSoon = provider.status === "coming_soon" || provider.availability === "coming_soon";
  const statusVisible = comingSoon || ["connected", "partially_connected", "reconnect_required", "expired", "error", "disabled", "revoked"].includes(provider.status);
  const highlights = providerHighlights[provider.key] || provider.capabilities.slice(0, 3);
  return <Card className={cn("flex h-full flex-col", comingSoon && "opacity-55 grayscale")}><CardHeader className="space-y-4"><div className="flex items-start justify-between gap-3"><ProviderMark provider={provider} />{statusVisible && <StatusBadge status={provider.status} />}</div><div className="min-w-0"><CardTitle className="text-base">{provider.name}</CardTitle><p className="mt-1 text-xs capitalize text-muted-foreground">{provider.category}</p></div></CardHeader><CardContent className="flex flex-1 flex-col"><p className="text-sm leading-6 text-muted-foreground">{provider.description}</p><div className="mt-4 space-y-2">{highlights.map((highlight) => <div key={highlight} className="flex items-start gap-2 text-xs text-muted-foreground"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>{highlight}</span></div>)}</div><div className="mt-auto flex items-center justify-between gap-2 pt-5"><span className="text-xs text-muted-foreground">{comingSoon ? "Adapter in progress" : provider.connectedCount ? `${provider.connectedCount} connected` : ""}</span>{comingSoon ? <Button size="sm" variant="outline" disabled>Coming soon</Button> : <Button size="sm" variant={provider.connectedCount ? "outline" : "default"} onClick={() => onConnect(provider)} disabled={connectWorking}>{connectWorking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{provider.connectedCount ? "Connect another" : "Connect"}</Button>}</div></CardContent></Card>;
}

function WebhookConnectionDialog({ provider, connection, onOpenChange, onSaved }: { provider: IntegrationProvider | null; connection: IntegrationConnection | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [method, setMethod] = useState<IntegrationWebhookInput["method"]>("POST");
  const [authType, setAuthType] = useState<IntegrationWebhookInput["authType"]>("none");
  const [authHeader, setAuthHeader] = useState("X-API-Key");
  const [authSecret, setAuthSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const [queryText, setQueryText] = useState("{}");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setName(connection?.connectionName || "");
    setEndpointUrl(connection?.metadata.endpointUrl || "");
    setMethod((connection?.metadata.method as IntegrationWebhookInput["method"]) || "POST");
    setAuthType((connection?.metadata.authType as IntegrationWebhookInput["authType"]) || "none");
    setAuthHeader(connection?.metadata.authHeader || "X-API-Key");
    setAuthSecret("");
    setUsername("");
    setPassword("");
    setHeadersText("{}");
    setQueryText("{}");
    setBodyTemplate("");
  }, [connection, provider]);

  const parseMap = (value: string, label: string) => {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const input: IntegrationWebhookInput = {
        providerKey: provider?.key === "make" ? provider.key : "custom_webhook",
        connectionId: connection?.id,
        name: name.trim(), endpointUrl: endpointUrl.trim(), method, authType,
        headers: parseMap(headersText, "Headers"), query: parseMap(queryText, "Query parameters"), bodyTemplate,
        authHeader: authType === "api_key" ? authHeader.trim() : undefined,
        authSecret: authType === "bearer" || authType === "api_key" ? authSecret : undefined,
        username: authType === "basic" ? username : undefined,
        password: authType === "basic" ? password : undefined,
      };
      const result = await saveIntegrationWebhook(input);
      toast.success(`${provider?.name || "Webhook"} saved`);
      await onSaved();
      onOpenChange(false);
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The webhook could not be saved.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={Boolean(provider)} onOpenChange={(open) => { if (!saving) onOpenChange(open); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{connection ? "Edit" : "Connect"} {provider?.name || "custom webhook"}</DialogTitle><DialogDescription>Send MaxForm form, event, CRM, or automation data to a secure HTTP endpoint. Secrets are encrypted and never shown after saving.</DialogDescription></DialogHeader>
      <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-2 pr-1 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="integration-webhook-name">Connection name</Label><Input id="integration-webhook-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Lead delivery" /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="integration-webhook-url">Destination URL</Label><Input id="integration-webhook-url" type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://example.com/maxform" /><p className="text-xs text-muted-foreground">HTTPS destinations are required. Local and private network addresses are blocked.</p></div>
        <div className="space-y-2"><Label>HTTP method</Label><Select value={method} onValueChange={(value) => setMethod(value as IntegrationWebhookInput["method"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["POST", "PUT", "PATCH", "DELETE", "GET"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Authentication</Label><Select value={authType} onValueChange={(value) => setAuthType(value as IntegrationWebhookInput["authType"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="bearer">Bearer token</SelectItem><SelectItem value="api_key">API key header</SelectItem><SelectItem value="basic">Basic authentication</SelectItem></SelectContent></Select></div>
        {(authType === "bearer" || authType === "api_key") && <div className="space-y-2 sm:col-span-2"><Label>{authType === "api_key" ? "Header name and secret" : "Bearer token"}</Label><div className="grid gap-2 sm:grid-cols-2">{authType === "api_key" && <Input value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} placeholder="X-API-Key" />}<Input type="password" value={authSecret} onChange={(event) => setAuthSecret(event.target.value)} placeholder={connection?.metadata.hasSecret ? "Leave blank to keep the saved secret" : "Secret"} autoComplete="new-password" /></div></div>}
        {authType === "basic" && <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2"><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="off" /><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={connection?.metadata.hasSecret ? "Leave blank to keep the saved password" : "Password"} autoComplete="new-password" /></div>}
        <div className="space-y-2"><Label htmlFor="integration-webhook-headers">Headers JSON</Label><Textarea id="integration-webhook-headers" value={headersText} onChange={(event) => setHeadersText(event.target.value)} className="min-h-24 font-mono text-xs" placeholder='{"X-Workspace":"acme"}' /></div>
        <div className="space-y-2"><Label htmlFor="integration-webhook-query">Query parameters JSON</Label><Textarea id="integration-webhook-query" value={queryText} onChange={(event) => setQueryText(event.target.value)} className="min-h-24 font-mono text-xs" placeholder='{"source":"maxform"}' /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="integration-webhook-body">Request body template (optional)</Label><Textarea id="integration-webhook-body" value={bodyTemplate} onChange={(event) => setBodyTemplate(event.target.value)} className="min-h-28 font-mono text-xs" placeholder="Leave empty to send the standard MaxForm event payload." /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !name.trim() || !endpointUrl.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save webhook</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ConnectionsTab({ connections, workingId, refreshing, onRefresh, onTest, onDisconnect, onEdit }: { connections: IntegrationConnection[]; workingId: string | null; refreshing: boolean; onRefresh: () => Promise<void>; onTest: (connection: IntegrationConnection) => void; onDisconnect: (connection: IntegrationConnection) => void; onEdit: (connection: IntegrationConnection) => void }) {
  if (!connections.length) return <EmptyState icon={Link2} title="No connections yet" description="Choose a provider from the Directory tab to connect your workspace." />;
  return <div className="space-y-4"><div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"><div><p className="text-sm font-medium text-foreground">Connected accounts</p><p className="mt-1 text-xs text-muted-foreground">Refresh after completing a provider connection in another window.</p></div><Button size="sm" variant="outline" onClick={() => void onRefresh()} disabled={refreshing}>{refreshing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Refresh connections</Button></div><PaginatedCardGrid items={connections} pageSize={12} itemLabel="connections" getKey={(connection) => connection.id} renderItem={(connection) => <Card><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div className="flex min-w-0 items-center gap-3"><ConnectionMark connection={connection} /><div className="min-w-0"><CardTitle className="truncate text-base">{connection.providerName}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{connection.accountLabel}</p></div></div><StatusBadge status={connection.status} /></CardHeader><CardContent><div className="space-y-2 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><span>Available in</span><span className="font-medium text-foreground">{connection.enabledModuleCount || "Compatible modules"}</span></div><div className="flex justify-between gap-3"><span>Last healthy check</span><span className="text-right text-foreground">{formatDate(connection.lastSuccessAt)}</span></div>{connection.credentialHint && <div className="flex justify-between gap-3"><span>Credential</span><span className="font-mono text-foreground">{connection.credentialHint}</span></div>}</div>{connection.lastError && connection.status !== "not_connected" && <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{connection.lastError}</p>}<div className="mt-5 flex flex-wrap gap-2">{["custom_webhook", "zapier", "make"].includes(connection.providerKey) && <Button size="sm" variant="outline" onClick={() => onEdit(connection)} disabled={workingId === connection.id}>Edit</Button>}<Button size="sm" variant="outline" onClick={() => onTest(connection)} disabled={workingId === connection.id || connection.status === "configuration_required"}>{workingId === connection.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Test</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDisconnect(connection)} disabled={workingId === connection.id}>Disconnect</Button></div></CardContent></Card>} /></div>;
}

function ActivityTab({ workspace }: { workspace: IntegrationsWorkspace }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution health</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every central authorization check is recorded without request payloads or credentials.
          </p>
        </CardHeader>
        <CardContent>
          {workspace.logs.length ? (
            <div className="space-y-3">
              {workspace.logs.slice(0, 12).map((log) => (
                <div key={log.id} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <span className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    log.status === "succeeded"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : log.status === "running"
                        ? "bg-sky-500/10 text-sky-600"
                        : "bg-destructive/10 text-destructive",
                  )}>
                    {log.status === "succeeded" ? <Check className="h-3.5 w-3.5" /> : log.status === "running" ? <Clock3 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{log.actionKey || "Integration action"}</p>
                      <span className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{log.moduleKey} · {log.capability}{log.errorMessage ? ` · ${log.errorMessage}` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No integration activity recorded yet.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit trail</CardTitle>
          <p className="text-sm text-muted-foreground">Connection, access, default, and disconnect changes for this workspace.</p>
        </CardHeader>
        <CardContent>
          {workspace.audit.length ? (
            <div className="space-y-3">
              {workspace.audit.slice(0, 12).map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{entry.eventType.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.providerKey || "Workspace"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No changes recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
