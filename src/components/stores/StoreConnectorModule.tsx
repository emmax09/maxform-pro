import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Store,
  Unplug,
  UsersRound,
  Webhook,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import {
  createCmsConnection,
  disconnectCmsConnection,
  getCmsWorkspace,
  reconnectCmsConnection,
  syncCmsConnection,
  type CmsConnection,
  type CmsPlatform,
  type CmsStoresTab,
  type CmsWorkspace,
  type StoreConnectorTab,
} from "@/lib/cms-stores";
import { officialIntegrationLogoSources } from "@/lib/integration-provider-assets";
import { ConnectionDialog } from "./CmsStoresModule";

type StoreConnectorModuleProps = {
  initialTab?: StoreConnectorTab;
  onTabChange?: (tab: StoreConnectorTab) => void;
  onOpenStores?: (tab?: CmsStoresTab) => void;
};

type ProviderCard = {
  key: string;
  name: string;
  description: string;
  logo: string;
  status: "available" | "coming_soon";
  platform?: CmsPlatform;
  docsUrl: string;
};

const providerCards: ProviderCard[] = [
  { key: "shopify", name: "Shopify", description: "Products, collections, orders and inventory through the Shopify Admin API.", logo: officialIntegrationLogoSources.shopify, status: "available", platform: "shopify", docsUrl: "https://help.shopify.com/en/manual/apps/custom-apps" },
  { key: "woocommerce", name: "WooCommerce", description: "WordPress commerce with products, categories, orders and stock management.", logo: officialIntegrationLogoSources.woocommerce, status: "available", platform: "woocommerce", docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/" },
  { key: "magento", name: "Adobe Commerce", description: "Magento and Adobe Commerce connectivity is on the provider roadmap.", logo: officialIntegrationLogoSources.magento, status: "coming_soon", docsUrl: "https://developer.adobe.com/commerce/webapi/rest/" },
  { key: "bigcommerce", name: "BigCommerce", description: "Products, categories, orders and inventory through the BigCommerce REST API.", logo: officialIntegrationLogoSources.bigcommerce, status: "available", platform: "bigcommerce", docsUrl: "https://docs.bigcommerce.com/developer/docs/admin/intro" },
  { key: "prestashop", name: "PrestaShop", description: "A future connector for stores using the PrestaShop web service.", logo: officialIntegrationLogoSources.prestashop, status: "coming_soon", docsUrl: "https://devdocs.prestashop-project.org/8/webservice/" },
  { key: "wix", name: "Wix", description: "Wix Stores products, collections and orders through the Wix REST API.", logo: officialIntegrationLogoSources.wix, status: "available", platform: "wix", docsUrl: "https://dev.wix.com/docs/go-headless/coding/rest-api/admin/make-api-calls-with-an-api-key" },
  { key: "squarespace", name: "Squarespace", description: "A future connector for Squarespace Commerce sites.", logo: officialIntegrationLogoSources.squarespace, status: "coming_soon", docsUrl: "https://developers.squarespace.com/" },
  { key: "medusa", name: "Medusa", description: "A future connector for self-hosted and composable commerce.", logo: officialIntegrationLogoSources.medusa, status: "coming_soon", docsUrl: "https://docs.medusajs.com/api/store" },
];

const connectorTabs: Array<{ key: StoreConnectorTab; label: string; icon: typeof Store }> = [
  { key: "overview", label: "Overview", icon: Store },
  { key: "providers", label: "Providers", icon: Link2 },
  { key: "connections", label: "Connections", icon: CheckCircle2 },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings2 },
];

const relativeDate = (value: string | null | undefined) => {
  if (!value) return "Never synced";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
};

const providerNames: Record<CmsPlatform, string> = { shopify: "Shopify", woocommerce: "WooCommerce", bigcommerce: "BigCommerce", wix: "Wix" };
const providerName = (platform: CmsPlatform) => providerNames[platform];
const LIVE_REFRESH_INTERVAL_MS = 30_000;

function ProviderLogo({ provider, size = "md" }: { provider: ProviderCard; size?: "sm" | "md" | "lg" }) {
  return <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white dark:bg-white", size === "sm" ? "h-9 w-9 p-1.5" : size === "lg" ? "h-16 w-16 p-3" : "h-12 w-12 p-2")}><img src={provider.logo} alt={`${provider.name} official logo`} className="h-full w-full object-contain" /></span>;
}

function ConnectionStatus({ status }: { status: CmsConnection["status"] }) {
  const healthy = status === "healthy";
  const syncing = status === "syncing";
  return <Badge variant="outline" className={cn("gap-1.5", healthy && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", syncing && "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300", status === "attention" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", status === "disconnected" && "text-muted-foreground")}><span className={cn("h-1.5 w-1.5 rounded-full", healthy ? "bg-emerald-500" : syncing ? "bg-blue-500" : status === "attention" ? "bg-amber-500" : "bg-muted-foreground")} />{syncing ? "Syncing" : healthy ? "Healthy" : status === "attention" ? "Needs attention" : "Disconnected"}</Badge>;
}

function ConnectorHeader() {
  return <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary"><Store className="h-4 w-4" /> Workspace tools</div><h1 className="mt-2 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">Store connector</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Connect commerce platforms once, then make the same trusted store data available to Connected stores, CRM, orders, analytics and workflows.</p></div><div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><RefreshCw className="h-4 w-4 text-primary" /> Automatic sync on</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Workspace-scoped and encrypted</span></div></div>;
}

function ProviderCardView({ provider, connected, maxConnections, onConnect }: { provider: ProviderCard; connected: CmsConnection[]; maxConnections: number; onConnect: (provider: ProviderCard) => void }) {
  const limitReached = Boolean(provider.platform && connected.length >= maxConnections);
  const availableNow = provider.status === "available" && !limitReached;
  return <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md"><CardContent className="flex flex-1 flex-col p-5"><div className="flex items-start justify-between gap-3"><ProviderLogo provider={provider} size="lg" />{provider.status !== "available" ? <Badge variant="outline">Coming soon</Badge> : limitReached ? <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">At limit</Badge> : <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Available</Badge>}</div><h3 className="mt-5 font-semibold">{provider.name}</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{provider.description}</p>{provider.platform ? <p className="mt-4 text-xs text-muted-foreground">{connected.length} / {maxConnections} active sites connected</p> : <p className="mt-4 text-xs text-muted-foreground">Connector not enabled yet</p>}<div className="mt-5 flex items-center gap-2"><Button className="flex-1" variant={availableNow ? "default" : "outline"} onClick={() => onConnect(provider)} disabled={limitReached} aria-label={limitReached ? `${provider.name} connection limit reached` : provider.status === "available" ? `Connect ${provider.name}` : `View ${provider.name} provider`}>{limitReached ? "Limit reached" : provider.status === "available" ? <><Plus className="mr-2 h-4 w-4" />Connect</> : "View provider"}</Button><a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground" aria-label={`Open ${provider.name} documentation`}><ExternalLink className="h-4 w-4" /></a></div></CardContent></Card>;
}

function ConnectionCard({ connection, onSync, onReconnect, onDisconnect, working }: { connection: CmsConnection; onSync: () => void; onReconnect: () => void; onDisconnect: () => void; working: boolean }) {
  const provider = providerCards.find((item) => item.platform === connection.platform);
  const webhookSync = connection.webhookRegistered && connection.platform !== "wix";
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><ProviderLogo provider={provider || providerCards[0]} size="md" /><div className="min-w-0"><p className="truncate font-semibold">{connection.name}</p><p className="truncate text-xs text-muted-foreground">{providerName(connection.platform)} · {connection.storeUrl.replace(/^https?:\/\//, "")}</p></div></div><ConnectionStatus status={connection.status} /></div><div className="mt-5 grid grid-cols-3 gap-2 border-y border-border py-4 text-center"><div><p className="text-lg font-semibold">{connection.counts.products}</p><p className="text-[11px] text-muted-foreground">Products</p></div><div><p className="text-lg font-semibold">{connection.counts.categories}</p><p className="text-[11px] text-muted-foreground">Categories</p></div><div><p className="text-lg font-semibold">{connection.counts.orders}</p><p className="text-[11px] text-muted-foreground">Orders</p></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5">{webhookSync ? <Webhook className="h-3.5 w-3.5 text-emerald-600" /> : <RefreshCw className="h-3.5 w-3.5" />}{webhookSync ? "Webhooks + fallback" : connection.platform === "wix" ? "Scheduled sync" : "Reconciliation fallback"}</span><span>{relativeDate(connection.lastSyncedAt)}</span></div>{connection.lastError && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">{connection.lastError}</p>}<div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onSync} disabled={working || connection.status === "disconnected"}>{working && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Sync now</Button>{(connection.status === "attention" || connection.status === "disconnected") && <Button size="sm" variant="outline" onClick={onReconnect} disabled={working}>Reconnect</Button>}{connection.status !== "disconnected" && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDisconnect} disabled={working}><Unplug className="mr-1.5 h-3.5 w-3.5" />Disconnect</Button>}</div></CardContent></Card>;
}

function ConnectorOverview({ workspace, onProviders, onConnections }: { workspace: CmsWorkspace; onProviders: () => void; onConnections: () => void }) {
  const healthy = workspace.connections.filter((connection) => connection.status === "healthy").length;
  return <div className="space-y-6"><div className="relative overflow-hidden rounded-2xl border border-border bg-linear-to-br from-primary/10 via-card to-card p-6 sm:p-8"><div className="relative z-10 max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Commerce connection layer</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">One connection, every module.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Store connector manages secure provider access. Connected stores consumes the synchronized catalog and orders, while CRM, analytics and workflows can use the same workspace-scoped events.</p><div className="mt-5 flex flex-wrap gap-2"><Button onClick={onProviders}><Link2 className="mr-2 h-4 w-4" />Browse providers</Button><Button variant="outline" onClick={onConnections}>View connections</Button></div></div><div className="pointer-events-none absolute -right-10 -top-12 hidden h-56 w-56 rounded-full border-28 border-primary/10 sm:block" /></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Connections</p><p className="mt-2 text-2xl font-semibold">{workspace.connections.length}</p><p className="mt-1 text-xs text-muted-foreground">Active store accounts</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Healthy</p><p className="mt-2 text-2xl font-semibold">{healthy}</p><p className="mt-1 text-xs text-muted-foreground">Ready for module use</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Platforms</p><p className="mt-2 text-2xl font-semibold">{new Set(workspace.connections.map((connection) => connection.platform)).size}</p><p className="mt-1 text-xs text-muted-foreground">Connected platform types</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Module bridge</p><p className="mt-2 text-2xl font-semibold">Live</p><p className="mt-1 text-xs text-muted-foreground">CRM · analytics · workflows</p></CardContent></Card></div><div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>How the connection layer works</CardTitle><CardDescription>Provider access is stored once and reused safely.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Credentials are encrypted server-side and never returned to the browser.</p><p className="flex gap-2"><Webhook className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Webhooks and scheduled reconciliation keep Connected stores current.</p><p className="flex gap-2"><UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />CRM and other modules consume workspace-scoped customer and commerce events.</p></CardContent></Card><Card><CardHeader><CardTitle>Connected stores</CardTitle><CardDescription>Open the operating surface for synced products and orders.</CardDescription></CardHeader><CardContent><div className="space-y-3">{workspace.connections.slice(0, 3).map((connection) => <div key={connection.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="flex min-w-0 items-center gap-3"><ProviderLogo provider={providerCards.find((item) => item.platform === connection.platform) || providerCards[0]} size="sm" /><span className="truncate text-sm font-medium">{connection.name}</span></div><ConnectionStatus status={connection.status} /></div>)}{!workspace.connections.length && <p className="py-4 text-sm text-muted-foreground">No store connections yet.</p>}</div><Button variant="ghost" className="mt-3 px-0" onClick={onConnections}>Manage all connections <ArrowRight className="ml-2 h-4 w-4" /></Button></CardContent></Card></div></div>;
}

function ProvidersTab({ workspace, onConnect }: { workspace: CmsWorkspace; onConnect: (provider: ProviderCard) => void }) {
  const [search, setSearch] = useState("");
  const maxConnections = workspace.limits.maxPerPlatform;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providerCards
      .map((provider, index) => {
        const connected = provider.platform
          ? workspace.connections.filter((connection) => connection.platform === provider.platform && connection.status !== "disconnected")
          : [];
        const availableNow = provider.status === "available" && connected.length < maxConnections;
        const availabilityRank = provider.status !== "available" ? 2 : availableNow ? 0 : 1;
        return { provider, connected, availabilityRank, index };
      })
      .filter(({ provider }) => `${provider.name} ${provider.description}`.toLowerCase().includes(query))
      .sort((left, right) => left.availabilityRank - right.availabilityRank || left.index - right.index);
  }, [maxConnections, search, workspace]);
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Provider directory</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Commerce providers</h2><p className="mt-1 text-sm text-muted-foreground">Available providers and connection slots appear first. Roadmap providers stay visible below them, and each supported provider allows two active sites per workspace.</p></div><div className="relative w-full sm:w-72"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search providers" /></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{filtered.map(({ provider, connected }) => <ProviderCardView key={provider.key} provider={provider} connected={connected} maxConnections={maxConnections} onConnect={onConnect} />)}</div></div>;
}

function ConnectionsTab({ workspace, onSync, onReconnect, onDisconnect, workingId, onOpenStores }: { workspace: CmsWorkspace; onSync: (id: string) => void; onReconnect: (id: string) => void; onDisconnect: (id: string) => void; workingId: string | null; onOpenStores: () => void }) {
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Workspace connections</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Connected providers</h2><p className="mt-1 text-sm text-muted-foreground">These are the same encrypted connections used by Connected stores.</p></div><Button variant="outline" onClick={onOpenStores}>Open Connected stores <ArrowRight className="ml-2 h-4 w-4" /></Button></div>{workspace.connections.length ? <div className="grid gap-4 lg:grid-cols-2">{workspace.connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} working={workingId === connection.id} onSync={() => onSync(connection.id)} onReconnect={() => onReconnect(connection.id)} onDisconnect={() => onDisconnect(connection.id)} />)}</div> : <Card><CardContent className="flex min-h-[230px] flex-col items-center justify-center px-6 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted"><Unplug className="h-5 w-5 text-muted-foreground" /></span><h3 className="mt-4 font-semibold">No providers connected</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">Choose a provider from the Providers tab to start.</p></CardContent></Card>}</div>;
}

function ConnectorActivity({ workspace }: { workspace: CmsWorkspace }) {
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connection health</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Activity</h2><p className="mt-1 text-sm text-muted-foreground">Provider syncs and webhook results shared with Connected stores.</p></div>{workspace.syncEvents.length ? <Card><CardContent className="p-0"><div className="divide-y divide-border">{workspace.syncEvents.map((event) => <div key={event.id} className="flex items-start gap-4 p-5"><span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", event.status === "success" ? "bg-emerald-500/10 text-emerald-600" : event.status === "failed" ? "bg-red-500/10 text-red-600" : "bg-blue-500/10 text-blue-600")}>{event.status === "success" ? <CheckCircle2 className="h-4 w-4" /> : event.status === "failed" ? <XCircle className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="font-medium capitalize">{event.eventType.replace(/[._]/g, " ")}</p><p className="mt-1 text-sm text-muted-foreground">{event.storeName} · {event.message || "Sync completed."}</p></div><time className="shrink-0 text-xs text-muted-foreground">{relativeDate(event.occurredAt)}</time></div>)}</div></CardContent></Card> : <Card><CardContent className="flex min-h-[230px] items-center justify-center text-sm text-muted-foreground">No connection activity yet.</CardContent></Card>}</div>;
}

function ConnectorSettings({ workspace }: { workspace: CmsWorkspace }) {
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connection policy</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Settings</h2><p className="mt-1 text-sm text-muted-foreground">Security and availability rules for the shared store connection layer.</p></div><Card><CardHeader><CardTitle>Platform limits</CardTitle><CardDescription>Limits are enforced server-side for every workspace member.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Shopify</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.shopifyUsed} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">WooCommerce</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.woocommerceUsed} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">BigCommerce</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.bigcommerceUsed || 0} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Wix</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.wixUsed || 0} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div></CardContent></Card><Card><CardContent className="space-y-3 p-5 text-sm text-muted-foreground"><p className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Provider credentials stay encrypted and workspace-scoped.</p><p className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />A scheduled reconciliation keeps connections useful even when the dashboard is closed.</p><p className="flex gap-2"><Webhook className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Native webhooks are registered when the public app URL is configured; Wix connections use scheduled reconciliation.</p></CardContent></Card></div>;
}

export function StoreConnectorModule({ initialTab = "overview", onTabChange, onOpenStores }: StoreConnectorModuleProps) {
  const [tab, setTab] = useState<StoreConnectorTab>(initialTab);
  const [workspace, setWorkspace] = useState<CmsWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<CmsPlatform>("shopify");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [disconnectingConnection, setDisconnectingConnection] = useState<CmsConnection | null>(null);
  const selectTab = (next: StoreConnectorTab) => { setTab(next); onTabChange?.(next); };
  useEffect(() => setTab(initialTab), [initialTab]);
  const refresh = useCallback(async (quiet = false) => { if (refreshInFlight.current) return; refreshInFlight.current = true; if (quiet) setRefreshing(true); else setLoading(true); try { setWorkspace(await getCmsWorkspace()); } catch (error) { if (!quiet) toast.error(error instanceof Error ? error.message : "Store connector could not be loaded."); } finally { setLoading(false); setRefreshing(false); refreshInFlight.current = false; } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") void refresh(true);
    };
    const interval = window.setInterval(refreshWhenVisible, LIVE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  const mutateConnection = async (id: string, operation: (connectionId: string) => Promise<CmsWorkspace>, message: string) => { setWorkingId(id); try { setWorkspace(await operation(id)); toast.success(message); } catch (error) { toast.error(error instanceof Error ? error.message : "The connection could not be updated."); } finally { setWorkingId(null); } };
  const requestDisconnect = (id: string) => {
    const connection = workspace?.connections.find((item) => item.id === id);
    if (connection) setDisconnectingConnection(connection);
  };
  const disconnect = async () => {
    const connection = disconnectingConnection;
    if (!connection) return;
    setWorkingId(connection.id);
    try {
      await disconnectCmsConnection(connection.id);
      setDisconnectingConnection(null);
      await refresh(true);
      toast.success("Store disconnected and workspace data removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The provider could not be disconnected.");
    } finally {
      setWorkingId(null);
    }
  };
  const connect = (provider: ProviderCard) => { if (!provider.platform) { toast.info(`${provider.name} is listed as coming soon. Its connector is not enabled yet.`); return; } setConnectPlatform(provider.platform); setConnectionOpen(true); };
  if (loading && !workspace) return <div className="space-y-6"><div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="h-12 w-full animate-pulse rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />)}</div></div>;
  if (!workspace) return <div className="space-y-6"><ConnectorHeader /><Card><CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center"><XCircle className="h-7 w-7 text-destructive" /><p className="font-medium">Store connector could not be loaded.</p><Button variant="outline" onClick={() => void refresh()}>Try again</Button></CardContent></Card></div>;
  return <div className="space-y-6 pb-10"><ConnectorHeader /><div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Store connector sections">{connectorTabs.map(({ key, label, icon: Icon }) => { const active = tab === key; return <button key={key} type="button" role="tab" aria-selected={active} onClick={() => selectTab(key)} className={cn("flex h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{label}</button>; })}<Button variant="ghost" size="sm" className="ml-auto" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Refresh</Button></div>{tab === "overview" && <ConnectorOverview workspace={workspace} onProviders={() => selectTab("providers")} onConnections={() => selectTab("connections")} />}{tab === "providers" && <ProvidersTab workspace={workspace} onConnect={connect} />}{tab === "connections" && <ConnectionsTab workspace={workspace} workingId={workingId} onSync={(id) => void mutateConnection(id, syncCmsConnection, "Store synchronized")} onReconnect={(id) => void mutateConnection(id, reconnectCmsConnection, "Store reconnected")} onDisconnect={requestDisconnect} onOpenStores={() => onOpenStores?.("sites")} />}{tab === "activity" && <ConnectorActivity workspace={workspace} />}{tab === "settings" && <ConnectorSettings workspace={workspace} />}<ConnectionDialog open={connectionOpen} initialPlatform={connectPlatform} onOpenChange={setConnectionOpen} onCreated={async (input) => { try { const nextWorkspace = await createCmsConnection(input); setWorkspace(nextWorkspace); const defaultName = `${providerName(input.platform)} store`; const created = nextWorkspace.connections.find((connection) => connection.platform === input.platform && connection.name === (input.name.trim() || defaultName)); if (created?.status === "attention") toast.warning("Provider saved, but its first sync needs attention."); else toast.success("Provider connected"); if (onOpenStores) onOpenStores("sites"); else selectTab("connections"); } catch (error) { toast.error(error instanceof Error ? error.message : "The provider could not be connected."); throw error; } }} /><AlertDialog open={Boolean(disconnectingConnection)} onOpenChange={(open) => { if (!open && !workingId) setDisconnectingConnection(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Disconnect {disconnectingConnection?.name || "this store"}?</AlertDialogTitle><AlertDialogDescription asChild><div className="space-y-3 text-left"><p>This removes the store connection and all synchronized data for this site from this workspace.</p><ul className="list-disc space-y-1 pl-5"><li>Products, variations, categories, orders, sync history and store analytics will be removed from MaxForm.</li><li>Store-derived Orders, Payments and CRM activity will also be removed.</li><li>Future webhook deliveries will no longer be processed, and automatic synchronization will stop. Reconnecting requires a new sync.</li></ul><p className="font-medium text-foreground">Your actual products, orders and settings on {disconnectingConnection?.platformName || "the provider"} will not be deleted.</p><p>This action cannot be undone from MaxForm.</p></div></AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={Boolean(workingId)}>Keep connected</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={Boolean(workingId)} onClick={(event) => { event.preventDefault(); void disconnect(); }}>{workingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{workingId ? "Disconnecting…" : "Disconnect and remove data"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}
