import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  Globe2,
  Layers3,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  Store,
  Tags,
  Trash2,
  Users,
  Webhook,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createCmsConnection,
  deleteCmsCategory,
  deleteCmsProduct,
  getCmsWorkspace,
  saveCmsCategory,
  saveCmsProduct,
  type CmsCategory,
  type CmsConnection,
  type CmsCustomField,
  type CmsPlatform,
  type CmsProduct,
  type CmsProductAttribute,
  type CmsProductVariant,
  type CmsProductVariantInput,
  type CmsStoresTab,
  type CmsWorkspace,
  type StoreConnectorTab,
} from "@/lib/cms-stores";
import { officialIntegrationLogoSources } from "@/lib/integration-provider-assets";

type CmsStoresModuleProps = {
  initialTab?: CmsStoresTab;
  onTabChange?: (tab: CmsStoresTab) => void;
  onOpenConnector: (tab?: StoreConnectorTab) => void;
  onOpenOrders?: (connectionId: string) => void;
};

const tabs: Array<{ key: CmsStoresTab; label: string; icon: typeof Store }> = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "analytics", label: "Analytics", icon: Activity },
  { key: "sites", label: "Connected sites", icon: Globe2 },
  { key: "products", label: "Products", icon: Package },
  { key: "categories", label: "Categories", icon: Tags },
  { key: "activity", label: "Sync activity", icon: RefreshCw },
  { key: "settings", label: "Settings", icon: Settings2 },
];

const LIVE_REFRESH_INTERVAL_MS = 30_000;

const platformMeta: Record<CmsPlatform, {
  name: string;
  logo: string;
  color: string;
  description: string;
  urlLabel: string;
  setupUrl: string;
}> = {
  shopify: {
    name: "Shopify",
    logo: officialIntegrationLogoSources.shopify,
    color: "#95BF47",
    description: "Sync products, collections, orders and inventory from Shopify.",
    urlLabel: "Shop domain",
    setupUrl: "https://help.shopify.com/en/manual/apps/custom-apps",
  },
  woocommerce: {
    name: "WooCommerce",
    logo: officialIntegrationLogoSources.woocommerce,
    color: "#96588A",
    description: "Manage WooCommerce products, categories, orders and stock.",
    urlLabel: "Store URL",
    setupUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
  },
  bigcommerce: {
    name: "BigCommerce",
    logo: officialIntegrationLogoSources.bigcommerce,
    color: "#121118",
    description: "Sync BigCommerce products, categories, orders and inventory.",
    urlLabel: "Storefront URL",
    setupUrl: "https://docs.bigcommerce.com/developer/docs/admin/intro",
  },
  wix: {
    name: "Wix",
    logo: officialIntegrationLogoSources.wix,
    color: "#0C6EFC",
    description: "Sync Wix Stores products, collections and orders.",
    urlLabel: "Site URL",
    setupUrl: "https://dev.wix.com/docs/go-headless/coding/rest-api/admin/make-api-calls-with-an-api-key",
  },
};

const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

const date = (value: string | null | undefined) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const relativeDate = (value: string | null | undefined) => {
  if (!value) return "Never synced";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  const minutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
};

const platformName = (platform: CmsPlatform) => platformMeta[platform].name;

function PlatformLogo({ platform, size = "md" }: { platform: CmsPlatform; size?: "sm" | "md" | "lg" }) {
  const meta = platformMeta[platform];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white shadow-xs dark:bg-white",
        size === "sm" ? "h-8 w-8 p-1.5" : size === "lg" ? "h-16 w-16 p-3" : "h-11 w-11 p-2",
      )}
    >
      <img src={meta.logo} alt={`${meta.name} logo`} className="h-full w-full object-contain" />
    </span>
  );
}

function StatusBadge({ status }: { status: CmsConnection["status"] }) {
  const healthy = status === "healthy";
  const syncing = status === "syncing";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        healthy && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        syncing && "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        status === "attention" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        status === "disconnected" && "border-muted-foreground/30 bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", healthy ? "bg-emerald-500" : syncing ? "bg-blue-500" : status === "attention" ? "bg-amber-500" : "bg-muted-foreground")} />
      {syncing ? "Syncing" : healthy ? "Healthy" : status === "attention" ? "Needs attention" : "Disconnected"}
    </Badge>
  );
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof Store; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "default" }: { icon: typeof Store; label: string; value: string | number; detail: string; tone?: "default" | "green" | "orange" | "blue" }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tone === "green" ? "bg-emerald-500/10 text-emerald-600" : tone === "orange" ? "bg-orange-500/10 text-orange-600" : tone === "blue" ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground")}><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function SiteCard({ connection, onManage, onViewOrders }: { connection: CmsConnection; onManage: () => void; onViewOrders?: () => void }) {
  const webhookSync = connection.webhookRegistered && connection.platform !== "wix";
  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformLogo platform={connection.platform} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{connection.name}</p>
              <p className="truncate text-xs text-muted-foreground">{platformName(connection.platform)} · {connection.storeUrl.replace(/^https?:\/\//, "")}</p>
            </div>
          </div>
          <StatusBadge status={connection.status} />
        </div>
        {connection.lastError && connection.status === "attention" && (
          <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{connection.lastError}</span></div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-2 border-y border-border py-4 text-center">
          <div><p className="text-lg font-semibold">{connection.counts.products}</p><p className="text-[11px] text-muted-foreground">Products</p></div>
          <div><p className="text-lg font-semibold">{connection.counts.categories}</p><p className="text-[11px] text-muted-foreground">Categories</p></div>
          <div><p className="text-lg font-semibold">{connection.counts.orders}</p><p className="text-[11px] text-muted-foreground">Orders</p></div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">{webhookSync ? <Webhook className="h-3.5 w-3.5 text-emerald-600" /> : <RefreshCw className="h-3.5 w-3.5" />}{webhookSync ? "Webhooks + fallback" : connection.platform === "wix" ? "Scheduled sync" : "Reconciliation fallback"}</span>
          <span>{relativeDate(connection.lastSyncedAt)}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Connection controls live in Store connector.</span>
          <div className="flex flex-wrap gap-2">
            {onViewOrders ? <Button size="sm" variant="outline" onClick={onViewOrders}><ShoppingBag className="mr-1.5 h-3.5 w-3.5" />View orders</Button> : <Button asChild size="sm" variant="outline"><a href={`/dashboard?tab=orders&section=store_orders&site=${encodeURIComponent(connection.id)}`}><ShoppingBag className="mr-1.5 h-3.5 w-3.5" />View orders</a></Button>}
            <Button size="sm" variant="outline" onClick={onManage}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Manage connection</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ workspace, onSites, onAdd }: { workspace: CmsWorkspace; onSites: () => void; onAdd: () => void }) {
  const recent = workspace.syncEvents.slice(0, 5);
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-linear-to-br from-primary/10 via-card to-card p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Commerce command center</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your connected stores, in sync.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Connect Shopify, WooCommerce, BigCommerce or Wix and manage the products, categories and orders your team already runs — from one workspace.</p>
          <div className="mt-5 flex flex-wrap gap-2"><Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Connect a store</Button><Button variant="outline" onClick={onSites}>View connected sites</Button></div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-12 hidden h-56 w-56 rounded-full border-28 border-primary/10 sm:block" />
        <div className="pointer-events-none absolute bottom-6 right-16 hidden h-16 w-16 rounded-2xl bg-primary/10 sm:block"><Store className="m-5 h-6 w-6 text-primary/60" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Globe2} label="Connected sites" value={workspace.summary.connectedSites} detail={`${workspace.summary.healthySites} healthy`} tone="blue" />
        <MetricCard icon={Package} label="Products" value={workspace.summary.products} detail="Cached across stores" />
        <MetricCard icon={ShoppingBag} label="Orders" value={workspace.summary.orders} detail="Latest synced orders" tone="orange" />
        <MetricCard icon={CircleDollarSign} label="Store revenue" value={money(workspace.summary.revenue, workspace.summary.currency)} detail="From cached orders" tone="green" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Connected sites</CardTitle><CardDescription>Health and live sync status for each store.</CardDescription></div><Button size="sm" variant="ghost" onClick={onSites}>View all <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Button></div></CardHeader><CardContent>{workspace.connections.length ? <div className="grid gap-3 sm:grid-cols-2">{workspace.connections.slice(0, 4).map((connection) => <div key={connection.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="flex min-w-0 items-center gap-3"><PlatformLogo platform={connection.platform} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-medium">{connection.name}</p><p className="text-xs text-muted-foreground">{connection.counts.products} products · {relativeDate(connection.lastSyncedAt)}</p></div></div><StatusBadge status={connection.status} /></div>)}</div> : <EmptyPanel icon={Store} title="No stores connected" description="Connect your first Shopify, WooCommerce, BigCommerce or Wix store to start managing commerce here." action={<Button size="sm" onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Connect a store</Button>} />}</CardContent></Card>
        <Card><CardHeader><CardTitle>Recent syncs</CardTitle><CardDescription>What MaxForm has updated recently.</CardDescription></CardHeader><CardContent>{recent.length ? <div className="space-y-3">{recent.map((event) => <div key={event.id} className="flex gap-3"><span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", event.status === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>{event.status === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{event.eventType.replace(/[._]/g, " ")}</p><p className="truncate text-xs text-muted-foreground">{event.storeName} · {relativeDate(event.occurredAt)}</p></div></div>)}</div> : <p className="py-8 text-sm text-muted-foreground">Sync activity will appear here after a store is connected.</p>}</CardContent></Card>
      </div>
    </div>
  );
}

function AnalyticsTab({ workspace }: { workspace: CmsWorkspace }) {
  const bars = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(now.getDate() - (6 - index));
      const key = day.toISOString().slice(0, 10);
      const total = workspace.orders.filter((order) => order.createdAt?.slice(0, 10) === key).reduce((sum, order) => sum + order.total, 0);
      return { label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day), total };
    });
  }, [workspace.orders]);
  const max = Math.max(...bars.map((bar) => bar.total), 1);
  return <div className="space-y-6"><SectionHeading eyebrow="Store performance" title="Analytics" description="A clean view of the commerce data cached from your connected sites." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={CircleDollarSign} label="Revenue" value={money(workspace.summary.revenue, workspace.summary.currency)} detail="All cached store orders" tone="green" /><MetricCard icon={ShoppingBag} label="Orders" value={workspace.summary.orders} detail="Across connected sites" tone="orange" /><MetricCard icon={Users} label="Sites" value={workspace.summary.connectedSites} detail="Connected commerce systems" tone="blue" /><MetricCard icon={Activity} label="Healthy" value={`${workspace.summary.healthySites}/${workspace.summary.connectedSites}`} detail="Live sync health" /></div><Card><CardHeader><CardTitle>Revenue, last 7 days</CardTitle><CardDescription>Based on the latest synchronized orders.</CardDescription></CardHeader><CardContent><div className="flex h-64 items-end gap-3 border-b border-l border-border px-3 pb-0 pt-6 sm:gap-5">{bars.map((bar) => <div key={bar.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-muted-foreground">{bar.total ? money(bar.total, workspace.summary.currency) : "—"}</span><div className="w-full rounded-t-lg bg-primary/80 transition-all" style={{ height: `${Math.max(4, (bar.total / max) * 78)}%` }} /><span className="pb-2 text-xs text-muted-foreground">{bar.label}</span></div>)}</div></CardContent></Card></div>;
}

function SitesTab({ workspace, onAdd, onManageConnection, onViewOrders }: { workspace: CmsWorkspace; onAdd: () => void; onManageConnection: () => void; onViewOrders?: (connectionId: string) => void }) {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState<"all" | CmsPlatform>("all");
  const [status, setStatus] = useState<"all" | CmsConnection["status"]>("all");
  const filtered = workspace.connections.filter((connection) => (!search.trim() || `${connection.name} ${connection.storeUrl}`.toLowerCase().includes(search.trim().toLowerCase())) && (platform === "all" || connection.platform === platform) && (status === "all" || connection.status === status));
  return <div className="space-y-6"><SectionHeading eyebrow="Store connections" title="Connected sites" description="Connected sites is the shared read view. Store connector owns credentials, sync, reconnect and disconnect actions." action={<Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Connect a site</Button>} /><div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search connected sites" className="pl-9" /></div><select value={platform} onChange={(event) => setPlatform(event.target.value as "all" | CmsPlatform)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All platforms</option><option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option><option value="bigcommerce">BigCommerce</option><option value="wix">Wix</option></select><select value={status} onChange={(event) => setStatus(event.target.value as "all" | CmsConnection["status"])} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All health</option><option value="healthy">Healthy</option><option value="attention">Needs attention</option><option value="disconnected">Disconnected</option></select></div>{filtered.length ? <div className="grid gap-4 lg:grid-cols-2">{filtered.map((connection) => <SiteCard key={connection.id} connection={connection} onManage={onManageConnection} onViewOrders={onViewOrders ? () => onViewOrders(connection.id) : undefined} />)}</div> : <EmptyPanel icon={Globe2} title="No matching sites" description={workspace.connections.length ? "Try a different search or filter." : "Connect Shopify, WooCommerce, BigCommerce or Wix to bring store operations into this workspace."} action={!workspace.connections.length ? <Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Connect a site</Button> : undefined} />}</div>;
}

function ProductsTab({ workspace, categories, onSave, onDelete }: { workspace: CmsWorkspace; categories: CmsCategory[]; onSave: (input: Parameters<typeof saveCmsProduct>[0]) => Promise<void>; onDelete: (connectionId: string, productId: string) => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("all");
  const [editing, setEditing] = useState<CmsProduct | null | undefined>(undefined);
  const filtered = workspace.products.filter((product) => (!search.trim() || `${product.title} ${product.sku} ${product.vendor}`.toLowerCase().includes(search.trim().toLowerCase())) && (connectionId === "all" || product.connectionId === connectionId));
  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Commerce catalog"
        title="Products"
        description="Create, edit and remove products on the connected store, then keep a searchable cache here."
        action={<Button onClick={() => setEditing(null)} disabled={!workspace.connections.length}><Plus className="mr-2 h-4 w-4" />Add product</Button>}
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, SKU or vendor" className="pl-9" /></div>
        <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All connected sites</option>{workspace.connections.filter((connection) => connection.status !== "disconnected").map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select>
      </div>
      {filtered.length ? (
        <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Product</th><th className="px-5 py-3 font-medium">Site</th><th className="px-5 py-3 font-medium">Type / status</th><th className="px-5 py-3 font-medium">Inventory</th><th className="px-5 py-3 font-medium">Price</th><th className="px-5 py-3" /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id} className="border-b border-border last:border-0"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-10 w-10 overflow-hidden rounded-lg bg-muted">{product.imageUrl && <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />}</div><div><p className="font-medium">{product.title}</p><p className="text-xs text-muted-foreground">{product.sku || "No SKU"}{product.variants.length ? ` · ${product.variants.length} variations` : ""}</p></div></div></td><td className="px-5 py-4 text-muted-foreground">{product.storeName}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-1.5"><Badge variant="outline" className="capitalize">{product.status.toLowerCase()}</Badge>{product.productType === "variable" && <Badge variant="secondary">Variable</Badge>}</div></td><td className="px-5 py-4 text-muted-foreground">{product.inventoryQuantity == null ? "Not tracked" : product.inventoryQuantity}</td><td className="px-5 py-4 font-medium">{money(product.salePrice ?? product.price, product.currency)}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" aria-label={`Edit ${product.title}`} onClick={() => setEditing(product)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${product.title}`} onClick={() => void onDelete(product.connectionId, product.id)}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}</tbody></table></div></CardContent></Card>
      ) : <EmptyPanel icon={Package} title="No products in this view" description={workspace.connections.length ? "Sync a connected site or create a product to begin." : "Connect a store before managing products."} />}
      {editing !== undefined && <ProductDialog open onOpenChange={(open) => !open && setEditing(undefined)} product={editing || null} categories={categories} connections={workspace.connections.filter((connection) => connection.status !== "disconnected")} onSave={async (input) => { await onSave(input); setEditing(undefined); }} />}
    </div>
  );
}

function CategoriesTab({ workspace, onSave, onDelete }: { workspace: CmsWorkspace; onSave: (input: Parameters<typeof saveCmsCategory>[0]) => Promise<void>; onDelete: (connectionId: string, categoryId: string) => Promise<void> }) {
  const [editing, setEditing] = useState<CmsCategory | null | undefined>(undefined);
  const [connectionId, setConnectionId] = useState("all");
  const filtered = workspace.categories.filter((category) => connectionId === "all" || category.connectionId === connectionId);
  return <div className="space-y-6"><SectionHeading eyebrow="Catalog structure" title="Categories & collections" description="Organize each connected site independently using its native category system." action={<Button onClick={() => setEditing(null)} disabled={!workspace.connections.length}><Plus className="mr-2 h-4 w-4" />Add category</Button>} /><div className="flex justify-end"><select aria-label="Filter categories by connected site" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All connected sites</option>{workspace.connections.filter((connection) => connection.status !== "disconnected").map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></div>{filtered.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((category) => <Card key={category.id}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Tags className="h-5 w-5" /></span><div><p className="font-medium">{category.name}</p><p className="text-xs capitalize text-muted-foreground">{category.type} · {category.storeName}</p></div></div><Badge variant="secondary">{category.productCount} products</Badge></div><div className="mt-4 flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(category)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void onDelete(category.connectionId, category.id)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button></div></CardContent></Card>)}</div> : <EmptyPanel icon={Tags} title="No categories in this view" description={workspace.connections.length ? "Sync a connected site or choose another site filter." : "Connect a store before managing categories."} />}{editing !== undefined && <CategoryDialog open onOpenChange={(open) => !open && setEditing(undefined)} category={editing || null} connections={workspace.connections.filter((connection) => connection.status !== "disconnected")} onSave={async (input) => { await onSave(input); setEditing(undefined); }} />}</div>;
}

function ActivityTab({ workspace }: { workspace: CmsWorkspace }) {
  const [connectionId, setConnectionId] = useState("all");
  const events = workspace.syncEvents.filter((event) => connectionId === "all" || event.connectionId === connectionId);
  return <div className="space-y-6"><SectionHeading eyebrow="Reliability" title="Sync activity" description="Every site has an independent webhook, lease and reconciliation history." /><div className="flex justify-end"><select aria-label="Filter sync activity by connected site" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All connected sites</option>{workspace.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></div>{events.length ? <Card><CardContent className="p-0"><div className="divide-y divide-border">{events.map((event) => <div key={event.id} className="flex items-start gap-4 p-5"><span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", event.status === "success" ? "bg-emerald-500/10 text-emerald-600" : event.status === "failed" ? "bg-red-500/10 text-red-600" : "bg-blue-500/10 text-blue-600")}>{event.status === "success" ? <CheckCircle2 className="h-4 w-4" /> : event.status === "failed" ? <XCircle className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium capitalize">{event.eventType.replace(/[._]/g, " ")}</p><Badge variant="outline" className="capitalize">{event.direction}</Badge><span className="text-xs text-muted-foreground">{event.storeName}</span></div><p className="mt-1 text-sm text-muted-foreground">{event.message || "Sync completed."}</p></div><time className="shrink-0 text-xs text-muted-foreground">{date(event.occurredAt)}</time></div>)}</div></CardContent></Card> : <EmptyPanel icon={Activity} title="No sync activity in this view" description={workspace.connections.length ? "Choose another site or wait for the next reconciliation." : "Connect a store to start seeing webhook and reconciliation events."} />}</div>;
}

function SettingsTab({ workspace }: { workspace: CmsWorkspace }) {
  return <div className="space-y-6"><SectionHeading eyebrow="Connected stores" title="Settings" description="Connection limits, security and synchronization behavior for this workspace." /><Card><CardHeader><CardTitle>Workspace limits</CardTitle><CardDescription>Two sites are allowed for each provider, independently of the other providers.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Shopify sites</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.shopifyUsed} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">WooCommerce sites</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.woocommerceUsed} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">BigCommerce sites</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.bigcommerceUsed || 0} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Wix sites</p><p className="mt-1 text-2xl font-semibold">{workspace.limits.wixUsed || 0} <span className="text-sm font-normal text-muted-foreground">/ {workspace.limits.maxPerPlatform}</span></p></div></CardContent></Card><Card><CardHeader><CardTitle>Automatic sync</CardTitle><CardDescription>Updates continue while the dashboard is closed.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p className="flex gap-2"><Webhook className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Shopify, WooCommerce and BigCommerce use provider webhooks for low-latency updates when the public app URL is configured.</p><p className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Every site is reconciled by the server scheduler every minute when webhooks are unavailable; Wix uses this fallback by design.</p><p className="flex gap-2"><Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Each connection has an independent sync lease, so one slow or unavailable site cannot block the others. Credentials remain encrypted and workspace-scoped.</p></CardContent></Card></div>;
}

export function ConnectionDialog({ open, onOpenChange, onCreated, initialPlatform = "shopify" }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (input: Parameters<typeof createCmsConnection>[0]) => Promise<void>; initialPlatform?: CmsPlatform }) {
  const [platform, setPlatform] = useState<CmsPlatform>("shopify");
  const [name, setName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [storeHash, setStoreHash] = useState("");
  const [wixApiKey, setWixApiKey] = useState("");
  const [wixSiteId, setWixSiteId] = useState("");
  const [saving, setSaving] = useState(false);
  const meta = platformMeta[platform];
  useEffect(() => { if (!open) return; setPlatform(initialPlatform); setName(""); setStoreUrl(""); setAccessToken(""); setConsumerKey(""); setConsumerSecret(""); setStoreHash(""); setWixApiKey(""); setWixSiteId(""); }, [initialPlatform, open]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const credentials = platform === "shopify"
        ? { accessToken }
        : platform === "woocommerce"
          ? { consumerKey, consumerSecret }
          : platform === "bigcommerce"
            ? { accessToken, storeHash }
            : { apiKey: wixApiKey, siteId: wixSiteId };
      await onCreated({ platform, name: name.trim() || meta.name, storeUrl: storeUrl.trim(), credentials });
      onOpenChange(false);
    } catch {
      // The parent owns the toast and keeps the dialog open when the request fails.
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <PlatformLogo platform={platform} size="md" />
            <div className="min-w-0">
              <DialogTitle>Connect {meta.name}</DialogTitle>
              <DialogDescription>{meta.description} Credentials are encrypted and scoped to this workspace.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <PlatformLogo platform={platform} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{meta.name}</p>
                <p className="text-xs text-muted-foreground">{platform === "shopify" ? "Admin API" : platform === "wix" ? "Site API" : "REST API"}</p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">Workspace connection</Badge>
          </div>
          <div className="space-y-2"><Label htmlFor="cms-store-name">Connection name</Label><Input id="cms-store-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={`e.g. ${meta.name} main store`} maxLength={160} /></div>
          <div className="space-y-2"><Label htmlFor="cms-store-url">{meta.urlLabel}</Label><Input id="cms-store-url" value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder={platform === "shopify" ? "your-store.myshopify.com" : "https://yourstore.com"} required /><p className="text-xs text-muted-foreground">Use the public store or site domain, not a checkout or admin URL.</p></div>
          {platform === "shopify" ? <div className="space-y-2"><Label htmlFor="cms-shopify-token">Admin API access token</Label><Input id="cms-shopify-token" type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="shpat_…" autoComplete="new-password" required /></div> : platform === "woocommerce" ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cms-consumer-key">Consumer key</Label><Input id="cms-consumer-key" type="password" value={consumerKey} onChange={(event) => setConsumerKey(event.target.value)} placeholder="ck_…" autoComplete="new-password" required /></div><div className="space-y-2"><Label htmlFor="cms-consumer-secret">Consumer secret</Label><Input id="cms-consumer-secret" type="password" value={consumerSecret} onChange={(event) => setConsumerSecret(event.target.value)} placeholder="cs_…" autoComplete="new-password" required /></div></div> : platform === "bigcommerce" ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cms-bigcommerce-token">API access token</Label><Input id="cms-bigcommerce-token" type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Paste your BigCommerce token" autoComplete="new-password" required /></div><div className="space-y-2"><Label htmlFor="cms-bigcommerce-hash">Store hash</Label><Input id="cms-bigcommerce-hash" value={storeHash} onChange={(event) => setStoreHash(event.target.value)} placeholder="abc123" required /></div></div> : <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cms-wix-api-key">API key</Label><Input id="cms-wix-api-key" type="password" value={wixApiKey} onChange={(event) => setWixApiKey(event.target.value)} placeholder="Paste your Wix API key" autoComplete="new-password" required /></div><div className="space-y-2"><Label htmlFor="cms-wix-site-id">Site ID</Label><Input id="cms-wix-site-id" value={wixSiteId} onChange={(event) => setWixSiteId(event.target.value)} placeholder="Your Wix site ID" required /></div></div>}
          <details className="group rounded-xl border border-border bg-muted/30 p-4"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">Setup guide <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="mt-3 space-y-2 text-sm text-muted-foreground">{platform === "shopify" ? <><p>In Shopify admin, create a custom app and grant Products, Orders, and Collections read/write access. Copy the Admin API access token once.</p><a href={meta.setupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open Shopify setup guide <ExternalLink className="h-3.5 w-3.5" /></a></> : platform === "woocommerce" ? <><p>In WordPress, open WooCommerce → Settings → Advanced → REST API, add a key with Read/Write permissions, then paste both values here.</p><a href={meta.setupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open WooCommerce setup guide <ExternalLink className="h-3.5 w-3.5" /></a></> : platform === "bigcommerce" ? <><p>Create a BigCommerce store-level API account with Catalog, Orders and Store Information permissions. Copy its access token and the store hash from the API account details.</p><a href={meta.setupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open BigCommerce setup guide <ExternalLink className="h-3.5 w-3.5" /></a></> : <><p>Create an API key in the Wix API Key Manager, grant the Stores and eCommerce permissions you need, then copy the site ID from your Wix dashboard or site details.</p><a href={meta.setupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open Wix setup guide <ExternalLink className="h-3.5 w-3.5" /></a></>}</div></details>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect and sync</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ProductVariantDraft = {
  draftId: string;
  externalId: string;
  title: string;
  status: string;
  sku: string;
  price: string;
  compareAtPrice: string;
  inventoryQuantity: string;
  inventoryManaged: boolean;
  imageUrl: string;
  attributes: Record<string, string>;
  customFields: CmsCustomField[];
  deletedCustomFieldIds: number[];
  deletedCustomFields: Array<{ id: number; key: string }>;
};

const draftId = () => `draft-${Math.random().toString(36).slice(2)}`;

const cleanCustomFields = (fields: CmsCustomField[]) =>
  fields
    .map((field) => ({ ...field, key: field.key.trim() }))
    .filter((field) => field.key)
    .slice(0, 200);

const variantAttributeText = (attributes: Record<string, unknown> | undefined) =>
  Object.entries(attributes || {})
    .map(([name, option]) => `${name}=${String(option ?? "").trim()}`)
    .filter((entry) => entry.split("=")[1])
    .join(", ");

const parseVariantAttributes = (value: string): Record<string, string> =>
  Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        if (separator < 1) return ["", ""];
        return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
      })
      .filter(([name, option]) => name && option),
  );

const makeVariantDraft = (variant: CmsProductVariant | CmsProductVariantInput): ProductVariantDraft => ({
  draftId: draftId(),
  externalId: variant.externalId || "",
  title: variant.title || "",
  status: variant.status || "publish",
  sku: variant.sku || "",
  price: variant.price == null ? "" : String(variant.price),
  compareAtPrice: variant.compareAtPrice == null ? "" : String(variant.compareAtPrice),
  inventoryQuantity: variant.inventoryQuantity == null ? "" : String(variant.inventoryQuantity),
  inventoryManaged: variant.inventoryManaged ?? variant.inventoryQuantity != null,
  imageUrl: variant.imageUrl || "",
  attributes: Object.fromEntries(Object.entries(variant.attributes || {}).map(([name, option]) => [name, String(option ?? "")])),
  customFields: (variant.customFields || []).map((field) => ({ ...field })),
  deletedCustomFieldIds: "deletedCustomFieldIds" in variant && variant.deletedCustomFieldIds ? [...variant.deletedCustomFieldIds] : [],
  deletedCustomFields: "deletedCustomFields" in variant && variant.deletedCustomFields ? variant.deletedCustomFields.map((field) => ({ ...field })) : [],
});

function CustomFieldsEditor({ label, fields, onChange, onRemove }: { label: string; fields: CmsCustomField[]; onChange: (fields: CmsCustomField[]) => void; onRemove?: (field: CmsCustomField) => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">WooCommerce REST metadata used by plugins and custom fields.</p></div><Button type="button" size="sm" variant="outline" onClick={() => onChange([...fields, { key: "", value: "", valueType: "string" }])}><Plus className="mr-1.5 h-3.5 w-3.5" />Add field</Button></div>
      {fields.length ? <div className="space-y-2">{fields.map((field, index) => <div key={`${field.id || "new"}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1.2fr_8rem_auto]"><Input aria-label={`${label} key ${index + 1}`} value={field.key} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="custom_field_key" /><Input aria-label={`${label} value ${index + 1}`} value={field.value} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="Value or JSON" /><select aria-label={`${label} type ${index + 1}`} value={field.valueType || "string"} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, valueType: event.target.value as CmsCustomField["valueType"] } : item))} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="json">JSON</option></select><Button type="button" size="icon" variant="ghost" aria-label={`Remove ${label} field ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => { onRemove?.(field); onChange(fields.filter((_, itemIndex) => itemIndex !== index)); }}><Trash2 className="h-4 w-4" /></Button></div>)}</div> : <p className="text-xs text-muted-foreground">No custom fields added. Existing plugin fields are loaded when WooCommerce exposes them through REST.</p>}
    </div>
  );
}

function ProductAttributesEditor({ attributes, onChange }: { attributes: CmsProductAttribute[]; onChange: (attributes: CmsProductAttribute[]) => void }) {
  const update = (index: number, patch: Partial<CmsProductAttribute>) => onChange(attributes.map((attribute, attributeIndex) => attributeIndex === index ? { ...attribute, ...patch } : attribute));
  return <div className="space-y-3 rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Variable attributes</p><p className="text-xs text-muted-foreground">Define the options WooCommerce uses to build and validate variations.</p></div><Button type="button" size="sm" variant="outline" onClick={() => onChange([...attributes, { name: "", options: [], visible: true, variation: true, position: attributes.length }])}><Plus className="mr-1.5 h-3.5 w-3.5" />Add attribute</Button></div>{attributes.length ? <div className="space-y-2">{attributes.map((attribute, index) => <div key={`${attribute.id || "new"}-${index}`} className="grid gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_1.5fr_auto_auto_auto]"><Input aria-label={`Attribute ${index + 1} name`} value={attribute.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="Color" /><Input aria-label={`Attribute ${index + 1} options`} value={attribute.options.join(", ")} onChange={(event) => update(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} placeholder="Black, White" /><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={attribute.variation} onChange={(event) => update(index, { variation: event.target.checked })} />Used for variations</label><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={attribute.visible} onChange={(event) => update(index, { visible: event.target.checked })} />Visible</label><Button type="button" size="icon" variant="ghost" aria-label={`Remove attribute ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => onChange(attributes.filter((_, attributeIndex) => attributeIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}</div> : <p className="text-xs text-muted-foreground">No attributes yet. Add options such as Color or Size before adding variations.</p>}</div>;
}

function ProductDialog({ open, onOpenChange, product, categories, connections, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; product: CmsProduct | null; categories: CmsCategory[]; connections: CmsConnection[]; onSave: (input: Parameters<typeof saveCmsProduct>[0]) => Promise<void> }) {
  const [connectionId, setConnectionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [inventory, setInventory] = useState("");
  const [inventoryManaged, setInventoryManaged] = useState(false);
  const [status, setStatus] = useState("draft");
  const [productType, setProductType] = useState("simple");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [imagesText, setImagesText] = useState("");
  const [attributes, setAttributes] = useState<CmsProductAttribute[]>([]);
  const [customFields, setCustomFieldsState] = useState<CmsCustomField[]>([]);
  const [deletedCustomFieldIds, setDeletedCustomFieldIds] = useState<number[]>([]);
  const [deletedCustomFields, setDeletedCustomFields] = useState<Array<{ id: number; key: string }>>([]);
  const [variants, setVariants] = useState<ProductVariantDraft[]>([]);
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const customFieldsRef = useRef<CmsCustomField[]>([]);
  const syncingCustomFieldsRef = useRef(false);
  const setCustomFields = (fields: CmsCustomField[]) => {
    if (!syncingCustomFieldsRef.current) {
      const removed = customFieldsRef.current.filter((field) => field.id && !fields.some((next) => next.id === field.id));
      if (removed.length) {
        setDeletedCustomFields((current) => [
          ...current,
          ...removed.filter((field) => !current.some((item) => item.id === field.id)).map((field) => ({ id: field.id as number, key: field.key })),
        ]);
      }
    }
    customFieldsRef.current = fields;
    setCustomFieldsState(fields);
  };

  useEffect(() => {
    if (!open) return;
    const initialType = ["simple", "variable", "grouped", "external"].includes(product?.productType || "") ? product?.productType || "simple" : "simple";
    setConnectionId(product?.connectionId || connections[0]?.id || "");
    setTitle(product?.title || "");
    setDescription(product?.description || "");
    setShortDescription(product?.shortDescription || "");
    setSku(product?.sku || "");
    setPrice(product?.price == null ? "" : String(product.price));
    setCompareAtPrice(product?.compareAtPrice == null ? "" : String(product.compareAtPrice));
    setInventory(product?.inventoryQuantity == null ? "" : String(product.inventoryQuantity));
    setInventoryManaged(product?.inventoryManaged ?? product?.inventoryQuantity != null);
    setStatus(product?.status || "draft");
    setProductType(initialType);
    setCategoryIds(product?.categoryIds || []);
    setImagesText(product?.images?.length ? product.images.join("\n") : product?.imageUrl || "");
    setAttributes((product?.attributes || []).map((attribute, index) => ({ ...attribute, options: [...attribute.options], position: attribute.position ?? index })));
    const initialCustomFields = (product?.customFields || []).map((field) => ({ ...field }));
    syncingCustomFieldsRef.current = true;
    setCustomFields(initialCustomFields);
    syncingCustomFieldsRef.current = false;
    setDeletedCustomFieldIds([]);
    setDeletedCustomFields([]);
    setVariants((product?.variants || []).map(makeVariantDraft));
    setDeletedVariantIds([]);
  }, [connections, open, product]);

  const selectedConnection = connections.find((connection) => connection.id === connectionId);
  const isWooCommerce = selectedConnection?.platform === "woocommerce" || product?.platform === "woocommerce";
  const isVariable = isWooCommerce && productType === "variable";
  const availableCategories = categories.filter((category) => category.connectionId === connectionId && category.type === "category");
  const updateVariant = (index: number, patch: Partial<ProductVariantDraft>) => setVariants((current) => current.map((variant, variantIndex) => {
    if (variantIndex !== index) return variant;
    const removed = patch.customFields
      ? variant.customFields.filter((field) => field.id && !patch.customFields?.some((next) => next.id === field.id))
      : [];
    return {
      ...variant,
      ...patch,
      ...(removed.length ? {
        deletedCustomFields: [
          ...variant.deletedCustomFields,
          ...removed.filter((field) => !variant.deletedCustomFields.some((item) => item.id === field.id)).map((field) => ({ id: field.id as number, key: field.key })),
        ],
      } : {}),
    };
  }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connectionId) return;
    const normalizedAttributes = attributes.map((attribute, index) => ({ ...attribute, name: attribute.name.trim(), options: attribute.options.map((option) => option.trim()).filter(Boolean), position: index })).filter((attribute) => attribute.name && attribute.options.length);
    const normalizedVariants: CmsProductVariantInput[] = variants
      .filter((variant) => variant.externalId || variant.title || variant.sku || variant.price || variant.compareAtPrice || variant.inventoryQuantity || variant.imageUrl || Object.keys(variant.attributes).length || variant.customFields.length)
      .map((variant) => ({
        externalId: variant.externalId || undefined,
        title: variant.title.trim() || undefined,
        status: variant.status,
        sku: variant.sku.trim(),
        price: Number(variant.price) || 0,
        compareAtPrice: variant.compareAtPrice === "" ? null : Number(variant.compareAtPrice) || 0,
        inventoryQuantity: variant.inventoryManaged && variant.inventoryQuantity !== "" ? Number(variant.inventoryQuantity) || 0 : null,
        inventoryManaged: variant.inventoryManaged,
        imageUrl: variant.imageUrl.trim(),
        attributes: variant.attributes,
        customFields: cleanCustomFields(variant.customFields),
        deletedCustomFieldIds: variant.deletedCustomFieldIds,
        deletedCustomFields: variant.deletedCustomFields,
      }));
    setSaving(true);
    try {
      await onSave({
        connectionId,
        productId: product?.id,
        title: title.trim(),
        description,
        shortDescription,
        status,
        productType: isWooCommerce ? productType : product?.productType,
        sku: sku.trim(),
        price: Number(price) || 0,
        compareAtPrice: compareAtPrice === "" ? null : Number(compareAtPrice) || 0,
        inventoryQuantity: inventoryManaged && inventory !== "" ? Number(inventory) || 0 : null,
        inventoryManaged,
        categoryIds: isWooCommerce ? categoryIds : undefined,
        images: isWooCommerce ? imagesText.split("\n").map((image) => image.trim()).filter(Boolean) : undefined,
        attributes: isVariable ? normalizedAttributes : undefined,
        customFields: isWooCommerce ? cleanCustomFields(customFields) : undefined,
        deletedCustomFieldIds: isWooCommerce ? deletedCustomFieldIds : undefined,
        deletedCustomFields: isWooCommerce ? deletedCustomFields : undefined,
        variants: isVariable ? normalizedVariants : undefined,
        deletedVariantIds: isVariable ? deletedVariantIds : undefined,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>{isWooCommerce ? "WooCommerce product data is synchronized back after each save, including variations and plugin metadata." : "The change is sent to the selected store, then cached in MaxForm."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-6">
          <div className="space-y-2"><Label>Connected site</Label><select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} disabled={Boolean(product)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {platformName(connection.platform)}</option>)}</select></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2"><Label htmlFor="cms-product-title">Title</Label><Input id="cms-product-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} /></div>
            <div className="space-y-2"><Label htmlFor="cms-product-short-description">Short description</Label><Textarea id="cms-product-short-description" value={shortDescription} onChange={(event) => setShortDescription(event.target.value)} className="min-h-[88px]" /></div>
            <div className="space-y-2"><Label htmlFor="cms-product-description">Description</Label><Textarea id="cms-product-description" value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-[88px]" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label htmlFor="cms-product-sku">SKU</Label><Input id="cms-product-sku" value={sku} onChange={(event) => setSku(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="cms-product-price">{isVariable ? "Default price (optional)" : "Price"}</Label><Input id="cms-product-price" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required={!isVariable} /></div>
            <div className="space-y-2"><Label htmlFor="cms-product-compare-price">Compare-at price</Label><Input id="cms-product-compare-price" type="number" min="0" step="0.01" value={compareAtPrice} onChange={(event) => setCompareAtPrice(event.target.value)} placeholder="Optional" /></div>
            <div className="space-y-2"><Label htmlFor="cms-product-inventory">Inventory quantity</Label><Input id="cms-product-inventory" type="number" min="0" step="1" value={inventory} onChange={(event) => setInventory(event.target.value)} placeholder={inventoryManaged ? "0" : "Not tracked"} disabled={!inventoryManaged} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-muted/20 p-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inventoryManaged} onChange={(event) => setInventoryManaged(event.target.checked)} />Track inventory</label><div className="flex min-w-48 flex-1 items-center gap-3"><Label htmlFor="cms-product-status">Status</Label><select id="cms-product-status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="draft">Draft</option><option value="publish">Published</option><option value="pending">Pending review</option><option value="private">Private</option><option value="active">Active</option></select></div></div>
          {isWooCommerce && <div className="space-y-5 rounded-2xl border border-primary/20 bg-primary/3 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="cms-product-type">WooCommerce product type</Label><select id="cms-product-type" value={productType} onChange={(event) => setProductType(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="simple">Simple</option><option value="variable">Variable</option><option value="grouped">Grouped</option><option value="external">External / affiliate</option></select><p className="text-xs text-muted-foreground">Variable products keep the parent attributes and each variation in sync with WooCommerce.</p></div>
              <div className="space-y-2"><Label htmlFor="cms-product-categories">Categories</Label><select id="cms-product-categories" multiple value={categoryIds} onChange={(event) => setCategoryIds(Array.from(event.target.selectedOptions).map((option) => option.value))} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{availableCategories.length ? availableCategories.map((category) => <option key={category.externalId} value={category.externalId}>{category.name}</option>) : <option value="" disabled>No synchronized categories for this site</option>}</select><p className="text-xs text-muted-foreground">Use Ctrl/Cmd-click to select multiple categories.</p></div>
            </div>
            <div className="space-y-2"><Label htmlFor="cms-product-images">Product image URLs</Label><Textarea id="cms-product-images" value={imagesText} onChange={(event) => setImagesText(event.target.value)} placeholder="One public image URL per line" className="min-h-20" /><p className="text-xs text-muted-foreground">WooCommerce will update the product gallery from these URLs.</p></div>
            {isVariable && <>
              <ProductAttributesEditor attributes={attributes} onChange={setAttributes} />
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Variations</p><p className="text-xs text-muted-foreground">Edit price, sale price, SKU, stock, image, attributes and metadata for every WooCommerce variation.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setVariants([...variants, makeVariantDraft({ externalId: "", title: "", status: "publish", sku: "", price: 0, compareAtPrice: null, inventoryQuantity: null, inventoryManaged: false, imageUrl: "", attributes: {}, customFields: [] })])}><Plus className="mr-1.5 h-3.5 w-3.5" />Add variation</Button></div>
                {variants.length ? <div className="space-y-4">{variants.map((variant, index) => <div key={variant.draftId} className="space-y-4 rounded-xl border border-border/80 bg-background p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Variation {index + 1}{variant.externalId ? ` · #${variant.externalId}` : " · New"}</p><p className="text-xs text-muted-foreground">Enter attributes as <code className="rounded bg-muted px-1">Color=Black, Size=Large</code>.</p></div><Button type="button" size="icon" variant="ghost" aria-label={`Remove variation ${index + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => { if (variant.externalId) setDeletedVariantIds((current) => Array.from(new Set([...current, variant.externalId]))); setVariants((current) => current.filter((_, variantIndex) => variantIndex !== index)); }}><Trash2 className="h-4 w-4" /></Button></div>
                  <div className="space-y-2"><Label htmlFor={`cms-variation-attributes-${index}`}>Variation attributes</Label><Input id={`cms-variation-attributes-${index}`} value={variantAttributeText(variant.attributes)} onChange={(event) => updateVariant(index, { attributes: parseVariantAttributes(event.target.value) })} placeholder="Color=Black, Size=Large" /></div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div className="space-y-2 lg:col-span-2"><Label htmlFor={`cms-variation-title-${index}`}>Variation note</Label><Input id={`cms-variation-title-${index}`} value={variant.title} onChange={(event) => updateVariant(index, { title: event.target.value })} placeholder="Optional description" /></div><div className="space-y-2"><Label htmlFor={`cms-variation-sku-${index}`}>SKU</Label><Input id={`cms-variation-sku-${index}`} value={variant.sku} onChange={(event) => updateVariant(index, { sku: event.target.value })} /></div><div className="space-y-2"><Label htmlFor={`cms-variation-price-${index}`}>Price</Label><Input id={`cms-variation-price-${index}`} type="number" min="0" step="0.01" value={variant.price} onChange={(event) => updateVariant(index, { price: event.target.value })} /></div><div className="space-y-2"><Label htmlFor={`cms-variation-compare-${index}`}>Compare-at</Label><Input id={`cms-variation-compare-${index}`} type="number" min="0" step="0.01" value={variant.compareAtPrice} onChange={(event) => updateVariant(index, { compareAtPrice: event.target.value })} placeholder="Optional" /></div></div>
                  <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor={`cms-variation-stock-${index}`}>Stock</Label><Input id={`cms-variation-stock-${index}`} type="number" min="0" step="1" value={variant.inventoryQuantity} onChange={(event) => updateVariant(index, { inventoryQuantity: event.target.value })} disabled={!variant.inventoryManaged} placeholder="Not tracked" /></div><div className="space-y-2"><Label htmlFor={`cms-variation-image-${index}`}>Image URL</Label><Input id={`cms-variation-image-${index}`} value={variant.imageUrl} onChange={(event) => updateVariant(index, { imageUrl: event.target.value })} placeholder="Optional" /></div><div className="flex items-end gap-4 pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={variant.inventoryManaged} onChange={(event) => updateVariant(index, { inventoryManaged: event.target.checked })} />Track stock</label><select aria-label={`Variation ${index + 1} status`} value={variant.status} onChange={(event) => updateVariant(index, { status: event.target.value })} className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="publish">Published</option><option value="draft">Draft</option><option value="private">Private</option></select></div></div>
                  <CustomFieldsEditor label={`Variation ${index + 1} custom fields`} fields={variant.customFields} onChange={(fields) => updateVariant(index, { customFields: fields })} />
                </div>)}</div> : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No variations yet. Add one after defining the parent attributes.</p>}
              </div>
            </>}
            <CustomFieldsEditor label="Product custom fields" fields={customFields} onChange={setCustomFields} />
          </div>}
          {!isWooCommerce && <p className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">This editor keeps the provider-neutral fields for {selectedConnection?.platformName || "this store"}. WooCommerce-specific variations and plugin metadata are available when a WooCommerce connection is selected.</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !connectionId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save product</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ open, onOpenChange, category, connections, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; category: CmsCategory | null; connections: CmsConnection[]; onSave: (input: Parameters<typeof saveCmsCategory>[0]) => Promise<void> }) {
  const [connectionId, setConnectionId] = useState(category?.connectionId || connections[0]?.id || "");
  const [name, setName] = useState(category?.name || "");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { await onSave({ connectionId, categoryId: category?.id, name }); onOpenChange(false); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{category ? "Edit category" : "Add category"}</DialogTitle><DialogDescription>Categories are created on the connected site and synchronized back here.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label>Connected site</Label><select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} disabled={Boolean(category)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></div><div className="space-y-2"><Label htmlFor="cms-category-name">Name</Label><Input id="cms-category-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={300} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !connectionId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save category</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function CmsStoresModule({ initialTab = "overview", onTabChange, onOpenConnector, onOpenOrders }: CmsStoresModuleProps) {
  const [tab, setTab] = useState<CmsStoresTab>(initialTab);
  const [workspace, setWorkspace] = useState<CmsWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const refreshInFlight = useRef(false);
  const selectTab = (next: string) => { const value = next as CmsStoresTab; setTab(value); onTabChange?.(value); };
  useEffect(() => setTab(initialTab), [initialTab]);
  const refresh = useCallback(async (quiet = false) => { if (refreshInFlight.current) return; refreshInFlight.current = true; if (quiet) setRefreshing(true); else setLoading(true); try { setError(""); setWorkspace(await getCmsWorkspace()); } catch (requestError) { if (!quiet) setError(requestError instanceof Error ? requestError.message : "Connected stores could not be loaded."); } finally { setLoading(false); setRefreshing(false); refreshInFlight.current = false; } }, []);
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
  const runWorkspaceMutation = useCallback(async (operation: () => Promise<CmsWorkspace>, success: string) => { try { setWorkspace(await operation()); toast.success(success); } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "The store update could not be completed."); throw requestError; } }, []);
  const saveProduct = async (input: Parameters<typeof saveCmsProduct>[0]) => { await runWorkspaceMutation(() => saveCmsProduct(input), input.productId ? "Product updated" : "Product created"); };
  const removeProduct = async (connectionId: string, productId: string) => { if (!window.confirm("Delete this product from the connected store?")) return; await runWorkspaceMutation(() => deleteCmsProduct(connectionId, productId), "Product deleted"); };
  const saveCategory = async (input: Parameters<typeof saveCmsCategory>[0]) => { await runWorkspaceMutation(() => saveCmsCategory(input), input.categoryId ? "Category updated" : "Category created"); };
  const removeCategory = async (connectionId: string, categoryId: string) => { if (!window.confirm("Delete this category from the connected store?")) return; await runWorkspaceMutation(() => deleteCmsCategory(connectionId, categoryId), "Category deleted"); };
  if (loading && !workspace) return <div className="space-y-6"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-10 w-full animate-pulse rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />)}</div><div className="h-72 animate-pulse rounded-2xl border border-border bg-card" /></div>;
  if (!workspace) return <div className="space-y-5"><SectionHeading title="Connected stores" description="Commerce connections for this workspace." /><div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-destructive" /><div><p className="font-medium">Connected stores could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">{error || "Try again in a moment."}</p><Button className="mt-4" variant="outline" onClick={() => void refresh()}>Try again</Button></div></div></div></div>;
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div className="flex items-start gap-3"><div className="hidden rounded-2xl bg-primary/10 p-3 text-primary sm:block"><Store className="h-6 w-6" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Workspace commerce</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Connected stores</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Manage multiple Shopify, WooCommerce, BigCommerce and Wix sites from one workspace. Orders remain synchronized into the main Orders, CRM and Payments modules.</p></div></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href="/dashboard?tab=orders&section=store_orders"><ShoppingBag className="mr-2 h-4 w-4" />Store orders</a></Button><Button variant="outline" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh</Button><Button onClick={() => onOpenConnector("providers")}><Plus className="mr-2 h-4 w-4" />Connect store</Button></div></div><div role="tablist" aria-label="Connected stores sections" className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5">{tabs.map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => selectTab(key)} className={cn("inline-flex min-w-max items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:text-sm", tab === key && "bg-background text-foreground") }><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>{tab === "overview" && <OverviewTab workspace={workspace} onSites={() => selectTab("sites")} onAdd={() => onOpenConnector("providers")} />}{tab === "analytics" && <AnalyticsTab workspace={workspace} />}{tab === "sites" && <SitesTab workspace={workspace} onAdd={() => onOpenConnector("providers")} onManageConnection={() => onOpenConnector("connections")} onViewOrders={onOpenOrders} />}{tab === "products" && <ProductsTab workspace={workspace} categories={workspace.categories} onSave={saveProduct} onDelete={removeProduct} />}{tab === "categories" && <CategoriesTab workspace={workspace} onSave={saveCategory} onDelete={removeCategory} />}{tab === "activity" && <ActivityTab workspace={workspace} />}{tab === "settings" && <SettingsTab workspace={workspace} />}</div>;
}
