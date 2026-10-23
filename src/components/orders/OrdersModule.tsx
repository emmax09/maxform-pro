/**
 * Orders — the whole workspace's sales, in one place.
 *
 * Forms, events, invoices, subscriptions and manual sales all write the same
 * ledger, so this module reads it once and lets the tab decide the filter.
 * Money is acted on in Payments: refunds, providers and payouts live there, and
 * this screen links across rather than duplicating them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Ban,
  CalendarClock,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  Inbox,
  Layers,
  Loader2,
  Package,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Ticket,
  Trash2,
  TrendingUp,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  TableBulkActions,
  TablePagination,
  TableRowSelect,
  TableSelectionBar,
  type TableBulkAction,
} from "@/components/shared/TableFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadOrderReceipt } from "@/lib/order-receipt";
import { formatCurrency } from "@/lib/regional-options";
import { useWorkspaceIdentity } from "@/hooks/use-workspace-logo";
import {
  cancelOrders,
  deleteOrders,
  downloadOrdersCsv,
  exportOrders,
  getOrderDetail,
  getOrdersSummary,
  listOrderItems,
  listOrders,
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_LABELS,
  orderSourceLink,
  paymentsLink,
  SETTLED_STATUSES,
  type OrderDetail,
  type WorkspaceOrder,
} from "@/lib/orders";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ORDERS_TAB,
  ORDER_TAB_SOURCE,
  ORDER_TABS,
  type OrdersTab,
} from "@/components/orders/order-tabs";
import {
  getCmsOrders,
  refundCmsOrder,
  updateCmsOrder,
  type CmsOrder,
  type CmsPlatform,
} from "@/lib/cms-stores";
import { officialIntegrationLogoSources } from "@/lib/integration-provider-assets";

const tabMeta: Record<OrdersTab, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: TrendingUp },
  all: { label: "All orders", icon: ShoppingBag },
  forms: { label: "Forms", icon: ClipboardList },
  events: { label: "Events", icon: Ticket },
  invoices: { label: "Invoices", icon: ReceiptText },
  subscriptions: { label: "Subscriptions", icon: RefreshCw },
  store_orders: { label: "Store orders", icon: ShoppingBag },
  items: { label: "Items sold", icon: Package },
};

/** Settled, in flight, or lost — the three states an operator acts on. */
const statusTone = (status: string) => {
  if (status === "paid") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "refunded" || status === "partially_refunded") {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-destructive/10 text-destructive";
  }
  return "bg-muted text-muted-foreground";
};

const sourceIcon: Record<string, LucideIcon> = {
  form: ClipboardList,
  event: Ticket,
  invoice: ReceiptText,
  subscription: RefreshCw,
  manual: Wallet,
};

/** "12 Mar" — short enough that 30 days of ticks do not collide. */
const chartDayLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * Axis ticks read better as $1.2K than as $1,200.00.
 *
 * Built here rather than through formatCurrency, which pins two decimal places
 * after spreading its options — every tick came out as "0.00" and then clipped.
 */
const compactMoney = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(Math.round(value));
  }
};

const shortDate = (value: string) =>
  value ? new Date(value).toLocaleDateString() : "—";

const longDate = (value: string) =>
  value ? new Date(value).toLocaleString() : "—";

/**
 * The chart palette, as roles.
 *
 * Declared once on a wrapper and consumed by name so light and dark swap in one
 * place, and so the charts are written against roles rather than raw hex. The
 * dark steps are chosen for the dark surface, not flipped from the light ones.
 */
const vizRoot = [
  "[--viz-series:#2a78d6] dark:[--viz-series:#3987e5]",
  "[--viz-good:#0ca30c] dark:[--viz-good:#0ca30c]",
  "[--viz-warning:#fab219] dark:[--viz-warning:#fab219]",
  "[--viz-critical:#d03b3b] dark:[--viz-critical:#d03b3b]",
  "[--viz-grid:#e6e5e1] dark:[--viz-grid:#2e2e2c]",
].join(" ");

/** A compact figure. The number is the chart — no one-bar bar charts. */
function StatTile({
  label,
  value,
  hint,
  hero = false,
}: {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate font-semibold tracking-tight tabular-nums",
          hero ? "text-[30px] leading-none" : "text-[19px] leading-tight",
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Shared tooltip shell, so every chart on the screen reads the same. */
function VizTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: Array<{ name: string; value: string }>;
}) {
  if (!active) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-md">
      {label && (
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      )}
      {rows.map((row) => (
        <p key={row.name} className="text-[12.5px] font-medium tabular-nums">
          {row.value}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {row.name}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * Magnitude across named categories, ranked.
 *
 * One hue for every bar, deliberately: shading each bar darker-where-bigger
 * would double-encode length as colour and spend the only free channel on
 * something the bar already says.
 */
function RankedBars({
  rows,
  currency,
  emptyLabel,
}: {
  rows: Array<{ key: string; label: string; value: number; meta?: string }>;
  currency: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-[12.5px] text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  const largest = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]">
              {row.label}
              {row.meta && (
                <span className="ml-1.5 text-muted-foreground">{row.meta}</span>
              )}
            </span>
            <span className="shrink-0 text-[12.5px] font-medium tabular-nums">
              {formatCurrency(row.value, currency)}
            </span>
          </div>
          {/* 4px rounded data-end, anchored to a recessive track. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (row.value / largest) * 100)}%`,
                backgroundColor: "var(--viz-series)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Part-to-whole across three states that genuinely mean good / needs-attention
 * / lost, so this is the one place the status palette belongs. Each segment
 * carries its own label — colour never carries the meaning alone.
 */
function StatusBar({
  settled,
  open,
  lost,
}: {
  settled: number;
  open: number;
  lost: number;
}) {
  const total = settled + open + lost;
  if (total === 0) return null;
  const segments = [
    { key: "settled", label: "Settled", value: settled, color: "var(--viz-good)" },
    { key: "open", label: "Awaiting", value: open, color: "var(--viz-warning)" },
    { key: "lost", label: "Failed", value: lost, color: "var(--viz-critical)" },
  ].filter((segment) => segment.value > 0);

  return (
    <div className="space-y-2">
      {/* A 2px surface gap keeps adjacent fills from reading as one block. */}
      <div className="flex h-2 gap-0.5 overflow-hidden">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full rounded-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li
            key={segment.key}
            className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="font-medium text-foreground tabular-nums">
              {segment.value}
            </span>
            {segment.label}
          </li>
        ))}
      </ul>
    </div>
  );
}


function OrdersTable({
  orders,
  currency,
  loading,
  onOpen,
  selected,
  onToggle,
}: {
  orders: WorkspaceOrder[];
  currency: string;
  loading: boolean;
  onOpen: (order: WorkspaceOrder) => void;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading orders
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
        <Inbox className="h-5 w-5 text-muted-foreground" />
        <p className="text-[14px] font-medium">No orders here yet</p>
        <p className="max-w-[380px] text-[12.5px] text-muted-foreground">
          Orders appear as soon as a form, event, invoice or subscription takes
          a payment.
        </p>
      </div>
    );
  }
  return (
    // Scrolls inside its own container so a narrow window never drags the page.
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44px]">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead className="min-w-[130px]">Order</TableHead>
            <TableHead className="min-w-[190px]">Customer</TableHead>
            <TableHead className="min-w-[150px]">Source</TableHead>
            <TableHead className="min-w-[110px]">Status</TableHead>
            <TableHead className="min-w-[110px] text-right">Total</TableHead>
            <TableHead className="min-w-[110px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const Icon = sourceIcon[order.sourceType] || ShoppingBag;
            return (
              <TableRow
                key={order.id}
                data-state={selected.has(order.id) ? "selected" : undefined}
                className="cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                role="button"
                tabIndex={0}
                aria-label={`View order ${order.orderNumber || order.id}`}
                onClick={() => onOpen(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(order);
                  }
                }}
              >
                <TableCell className="w-[44px]">
                  <TableRowSelect
                    checked={selected.has(order.id)}
                    onCheckedChange={(checked) => onToggle(order.id, checked)}
                    label={`Select order ${order.orderNumber}`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {order.orderNumber || "—"}
                  {order.itemCount > 0 && (
                    <span className="ml-2 text-[12px] text-muted-foreground">
                      {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <p className="truncate text-[13.5px]">
                    {order.customerName || "—"}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {order.customerEmail}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {order.sourceLabel ||
                        ORDER_SOURCE_LABELS[
                          order.sourceType as keyof typeof ORDER_SOURCE_LABELS
                        ] ||
                        order.sourceType}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                      statusTone(order.status),
                    )}
                  >
                    {ORDER_STATUS_LABELS[order.status] || order.status}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(order.totalAmount, order.currency || currency)}
                  {order.refundedAmount > 0 && (
                    <p className="text-[11.5px] font-normal text-amber-600 dark:text-amber-400">
                      −{formatCurrency(order.refundedAmount, order.currency || currency)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">
                  {shortDate(order.paidAt || order.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const storeOrderStatusTone = (status: string) => {
  const normalized = normalizeStoreOrderStatus(status);
  if (["paid", "completed", "fulfilled"].includes(normalized)) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (["refunded", "partially_refunded", "on_hold"].includes(normalized)) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  if (["cancelled", "canceled", "failed"].includes(normalized)) {
    return "bg-destructive/10 text-destructive";
  }
  return "bg-muted text-muted-foreground";
};

const normalizeStoreOrderStatus = (status: string) =>
  status.toLowerCase().replace(/-/g, "_").trim();

const storeOrderStatusLabel = (status: string) =>
  status.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Pending";

const storePlatformLabel = (platform: CmsOrder["platform"]) => {
  if (platform === "shopify") return "Shopify";
  if (platform === "woocommerce") return "WooCommerce";
  if (platform === "bigcommerce") return "BigCommerce";
  return "Wix";
};

function StorePlatformLogo({ platform }: { platform: CmsOrder["platform"] }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-1 dark:bg-white">
      <img
        src={officialIntegrationLogoSources[platform]}
        alt={`${storePlatformLabel(platform)} logo`}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

function StoreOrdersTable({
  orders,
  loading,
  onOpen,
  selected,
  onToggle,
}: {
  orders: CmsOrder[];
  loading: boolean;
  onOpen: (order: CmsOrder) => void;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading store orders
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
        <ShoppingBag className="h-5 w-5 text-muted-foreground" />
        <p className="text-[14px] font-medium">No store orders in this view</p>
        <p className="max-w-[420px] text-[12.5px] text-muted-foreground">
          Orders from connected Shopify, WooCommerce, BigCommerce and Wix sites
          appear here after the first sync.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44px]">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead className="min-w-[150px]">Order</TableHead>
            <TableHead className="min-w-[170px]">Store</TableHead>
            <TableHead className="min-w-[190px]">Customer</TableHead>
            <TableHead className="min-w-[120px]">Status</TableHead>
            <TableHead className="min-w-[120px]">Fulfilment</TableHead>
            <TableHead className="min-w-[110px] text-right">Total</TableHead>
            <TableHead className="min-w-[120px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              data-state={selected.has(order.id) ? "selected" : undefined}
              className="cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
              role="button"
              tabIndex={0}
              aria-label={`View store order ${order.orderNumber || order.id}`}
              onClick={() => onOpen(order)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(order);
                }
              }}
            >
              <TableCell className="w-[44px]">
                <TableRowSelect
                  checked={selected.has(order.id)}
                  onCheckedChange={(checked) => onToggle(order.id, checked)}
                  label={`Select store order ${order.orderNumber}`}
                />
              </TableCell>
              <TableCell>
                <p className="font-medium">{order.orderNumber || "—"}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  {storePlatformLabel(order.platform)}
                </p>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <StorePlatformLogo platform={order.platform} />
                  <span className="truncate text-[12.5px]">{order.storeName}</span>
                </span>
              </TableCell>
              <TableCell>
                <p className="truncate text-[13px]">{order.customerName || "Guest"}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {order.customerEmail || "No email"}
                </p>
              </TableCell>
              <TableCell>
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium", storeOrderStatusTone(order.status))}>
                  {storeOrderStatusLabel(order.status)}
                </span>
              </TableCell>
              <TableCell className="text-[12.5px] text-muted-foreground">
                {order.fulfillmentStatus ? storeOrderStatusLabel(order.fulfillmentStatus) : "Not started"}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatCurrency(order.total, order.currency || "USD")}
              </TableCell>
              <TableCell className="text-[12.5px] text-muted-foreground">
                {shortDate(order.createdAt || order.updatedAt || "")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type StoreOrderExportRow = Record<string, string | number>;

const downloadStoreCsv = (
  rows: StoreOrderExportRow[],
  columns: string[],
  filename: string,
) => {
  if (rows.length === 0) return;
  const escape = (value: unknown) => {
    const cell = String(value ?? "");
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const storeOrderExportColumns = [
  "order_id",
  "order_number",
  "store",
  "platform",
  "status",
  "fulfillment_status",
  "customer_name",
  "customer_email",
  "total",
  "currency",
  "payment_gateway",
  "tracking_number",
  "created_at",
  "updated_at",
];

const storeOrderExportRows = (orders: CmsOrder[]): StoreOrderExportRow[] =>
  orders.map((order) => ({
    order_id: order.id,
    order_number: order.orderNumber,
    store: order.storeName,
    platform: storePlatformLabel(order.platform),
    status: storeOrderStatusLabel(order.status),
    fulfillment_status: storeOrderStatusLabel(order.fulfillmentStatus),
    customer_name: order.customerName || "Guest",
    customer_email: order.customerEmail,
    total: order.total,
    currency: order.currency,
    payment_gateway: order.paymentGateway,
    tracking_number: order.trackingNumber,
    created_at: order.createdAt || "",
    updated_at: order.updatedAt || "",
  }));

const storeOrderCurrency = (orders: CmsOrder[]) => {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const currency = order.currency || "USD";
    counts.set(currency, (counts.get(currency) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "USD";
};

const buildStoreAnalysisExportRows = (orders: CmsOrder[], currency: string): StoreOrderExportRow[] => {
  const reportOrders = orders.filter((order) => (order.currency || "USD") === currency);
  const revenue = reportOrders.reduce((sum, order) => sum + order.total, 0);
  const bySite = new Map<string, { platform: string; orders: number; revenue: number }>();
  const byStatus = new Map<string, number>();
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const order of orders) {
    const site = bySite.get(order.connectionId) || { platform: storePlatformLabel(order.platform), orders: 0, revenue: 0 };
    site.orders += 1;
    if ((order.currency || "USD") === currency) site.revenue += order.total;
    bySite.set(order.connectionId, site);
    const status = storeOrderStatusLabel(order.status);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    if ((order.currency || "USD") === currency && order.createdAt) {
      const day = order.createdAt.slice(0, 10);
      const point = byDay.get(day) || { orders: 0, revenue: 0 };
      point.orders += 1;
      point.revenue += order.total;
      byDay.set(day, point);
    }
  }
  const rows: StoreOrderExportRow[] = [
    { section: "summary", metric: "Orders", value: orders.length, currency: "" },
    { section: "summary", metric: "Revenue", value: revenue, currency },
    { section: "summary", metric: "Average order value", value: reportOrders.length ? revenue / reportOrders.length : 0, currency },
    ...[...bySite.entries()].map(([siteId, value]) => ({ section: "site", metric: siteId, value: value.revenue, currency, orders: value.orders, platform: value.platform })),
    ...[...byStatus.entries()].map(([status, count]) => ({ section: "status", metric: status, value: count, currency: "", orders: count })),
    ...[...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, point]) => ({ section: "trend", metric: day, value: point.revenue, currency, orders: point.orders })),
  ];
  return rows;
};

function StoreOrdersAnalytics({ orders, currency, mixedCurrencies }: { orders: CmsOrder[]; currency: string; mixedCurrencies: boolean }) {
  const reportOrders = useMemo(
    () => orders.filter((order) => (order.currency || "USD") === currency),
    [orders, currency],
  );
  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; orders: number; revenue: number }>();
    for (const order of reportOrders) {
      if (!order.createdAt) continue;
      const day = order.createdAt.slice(0, 10);
      const current = byDay.get(day) || { day, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += order.total;
      byDay.set(day, current);
    }
    return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day)).slice(-30);
  }, [reportOrders]);
  const siteRows = useMemo(() => {
    const bySite = new Map<string, { name: string; platform: string; orders: number; revenue: number }>();
    for (const order of orders) {
      const current = bySite.get(order.connectionId) || { name: order.storeName, platform: storePlatformLabel(order.platform), orders: 0, revenue: 0 };
      current.orders += 1;
      if ((order.currency || "USD") === currency) current.revenue += order.total;
      bySite.set(order.connectionId, current);
    }
    return [...bySite.entries()]
      .sort((left, right) => right[1].revenue - left[1].revenue || right[1].orders - left[1].orders)
      .slice(0, 8)
      .map(([id, value]) => ({ key: id, label: value.name, meta: `${value.orders} orders · ${value.platform}`, value: value.revenue }));
  }, [orders, currency]);
  const statusRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      const status = storeOrderStatusLabel(order.status);
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [orders]);
  const maxStatus = Math.max(...statusRows.map(([, count]) => count), 1);

  return (
    <div className={cn("space-y-4", vizRoot)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Store order analysis</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Revenue and site comparisons use {currency}. Order counts include every currency.
          </p>
        </div>
        {mixedCurrencies && <Badge variant="outline">Multiple currencies</Badge>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div><h3 className="text-[13px] font-semibold">Revenue trend</h3><p className="text-[11.5px] text-muted-foreground">Last 30 reporting days in {currency}</p></div>
            <span className="text-[11.5px] text-muted-foreground">{reportOrders.length} orders</span>
          </div>
          {trend.length === 0 ? <p className="flex min-h-[220px] items-center justify-center text-center text-[12.5px] text-muted-foreground">No dated orders in this view.</p> : <div className="mt-4 h-[230px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}><defs><linearGradient id="store-orders-revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-series)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--viz-series)" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="3 3" /><XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={chartDayLabel} tick={{ fontSize: 10, fill: "currentColor" }} className="text-muted-foreground" /><YAxis tickLine={false} axisLine={false} width={58} tick={{ fontSize: 10, fill: "currentColor" }} className="text-muted-foreground" tickFormatter={(value: number) => compactMoney(value, currency)} /><Tooltip cursor={{ stroke: "var(--viz-grid)", strokeWidth: 1 }} content={({ active, label, payload }) => <VizTooltip active={active} label={chartDayLabel(String(label || ""))} rows={[{ name: "revenue", value: formatCurrency(Number(payload?.[0]?.value || 0), currency) }, { name: "orders", value: String(payload?.[0]?.payload?.orders || 0) }]} />} /><Area type="monotone" dataKey="revenue" stroke="var(--viz-series)" strokeWidth={2} fill="url(#store-orders-revenue-fill)" activeDot={{ r: 4, strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>}
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-semibold">Order status mix</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">All selected sites and currencies</p>
          {statusRows.length === 0 ? <p className="py-12 text-center text-[12.5px] text-muted-foreground">No orders in this view.</p> : <ul className="mt-4 space-y-3">{statusRows.map(([status, count]) => <li key={status}><div className="flex items-center justify-between gap-3 text-[12px]"><span>{status}</span><span className="font-medium tabular-nums">{count} · {Math.round((count / orders.length) * 100)}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (count / maxStatus) * 100)}%` }} /></div></li>)}</ul>}
        </div>
      </div>
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between gap-3"><div><h3 className="text-[13px] font-semibold">Connected site performance</h3><p className="text-[11.5px] text-muted-foreground">Ranked by revenue in {currency}; order count remains cross-currency.</p></div><span className="text-[11.5px] text-muted-foreground">{siteRows.length} sites</span></div>
        <div className="mt-4"><RankedBars currency={currency} emptyLabel="No site data in this view." rows={siteRows} /></div>
      </div>
    </div>
  );
}

function StoreOrderDialog({
  order,
  onOpenChange,
  onSaved,
}: {
  order: CmsOrder | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(order?.status || "");
    setNote("");
    setTrackingNumber(order?.trackingNumber || "");
    setRefundAmount("");
  }, [order]);

  const run = async (action: () => Promise<void>, success: string) => {
    setSaving(true);
    try {
      await action();
      await onSaved();
      toast.success(success);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The store order update failed.");
    } finally {
      setSaving(false);
    }
  };

  const update = () => {
    if (!order) return;
    return run(
      async () => {
        await updateCmsOrder({
          connectionId: order.connectionId,
          orderId: order.id,
          status,
          note,
          trackingNumber,
        });
      },
      "Store order updated",
    );
  };

  const refund = () => {
    if (!order) return;
    if (!window.confirm(`Refund ${order.orderNumber || "this order"} at ${order.storeName}?`)) return;
    const amount = refundAmount.trim() ? Number(refundAmount) : undefined;
    if (amount != null && (!Number.isFinite(amount) || amount <= 0 || amount > order.total)) {
      toast.error("Enter a valid refund amount no greater than the order total.");
      return;
    }
    return run(
      async () => {
        await refundCmsOrder({
          connectionId: order.connectionId,
          orderId: order.id,
          amount,
          reason: note,
        });
      },
      "Store refund requested",
    );
  };

  const wix = order?.platform === "wix";
  const shopify = order?.platform === "shopify";
  const canEditStatus = order?.platform === "woocommerce" || order?.platform === "bigcommerce";
  const fullRefundOnly = shopify || order?.platform === "bigcommerce";
  const hasUpdate = wix
    ? status.toLowerCase().replace(/-/g, "_") === "cancelled" && status !== order?.status
    : canEditStatus
      ? Boolean(note.trim() || trackingNumber.trim() || (status && status !== order?.status))
      : Boolean(note.trim() || trackingNumber.trim());

  return (
    <Dialog open={Boolean(order)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order && <StorePlatformLogo platform={order.platform} />}
            {order?.orderNumber || "Store order"}
          </DialogTitle>
          <DialogDescription>
            {order
              ? `${order.storeName} · ${order.customerName || "Guest"} · ${order.customerEmail || "No email"}`
              : "Loading store order"}
          </DialogDescription>
        </DialogHeader>
        {order && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{storePlatformLabel(order.platform)}</Badge>
              <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium", storeOrderStatusTone(order.status))}>
                {storeOrderStatusLabel(order.status)}
              </span>
              {order.fulfillmentStatus && <Badge variant="secondary">{storeOrderStatusLabel(order.fulfillmentStatus)}</Badge>}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[80px] text-right">Qty</TableHead>
                    <TableHead className="w-[130px] text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lineItems.map((item, index) => (
                    <TableRow key={`${item.externalId || item.name}-${index}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.total, order.currency || "USD")}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={2} className="text-right font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(order.total, order.currency || "USD")}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="store-order-status">Order status</Label>
                <select
                  id="store-order-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  disabled={saving || (!canEditStatus && !wix)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {wix ? (
                    <>
                      <option value={status}>{storeOrderStatusLabel(status)}</option>
                      <option value="cancelled">Cancelled</option>
                    </>
                  ) : !canEditStatus ? (
                    <option value={status}>{storeOrderStatusLabel(status)}</option>
                  ) : (
                    <>
                      <option value="pending">Pending</option>
                      <option value="processing">Processing</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="refunded">Refunded</option>
                    </>
                  )}
                </select>
                {wix && <p className="text-[11.5px] text-muted-foreground">Wix updates from MaxForm support cancellation; other edits stay in Wix.</p>}
                {shopify && <p className="text-[11.5px] text-muted-foreground">Shopify order status is managed by Shopify; add a note or tracking number here.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="store-order-tracking">Tracking number</Label>
                <Input id="store-order-tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Optional tracking number" maxLength={160} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="store-order-note">Operator note</Label>
              <Textarea id="store-order-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={shopify ? "Shopify requires a note or tracking number for an update." : "Optional note sent to the store"} maxLength={1000} />
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[180px] flex-1 space-y-2">
                  <Label htmlFor="store-order-refund">Refund amount</Label>
                  <Input id="store-order-refund" type="number" min="0.01" max={order.total} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder={`Full refund · ${order.total.toFixed(2)}`} disabled={wix || fullRefundOnly} />
                </div>
                <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={saving || wix} onClick={refund}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {wix ? "Refund in Wix" : "Refund order"}
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                {wix ? "Wix refunds must be completed in Wix; this dashboard still keeps the synced order visible." : fullRefundOnly ? "This provider currently supports full refunds from MaxForm. The request is sent to the provider and synchronized again before this dialog closes." : "Refunds are sent to the connected provider and the order is synchronized again before this dialog closes."}
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
              <Button type="button" onClick={update} disabled={saving || !hasUpdate}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save order update
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type StoreOrderPeriod = "7" | "30" | "90" | "all";

function StoreOrdersPanel({ userId, initialSite }: { userId?: string; initialSite?: string }) {
  const [search, setSearch] = useState("");
  const [site, setSite] = useState(initialSite || "all");
  const [platform, setPlatform] = useState<"all" | CmsPlatform>("all");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState<StoreOrderPeriod>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [openOrder, setOpenOrder] = useState<CmsOrder | null>(null);
  const storeOrders = useQuery({
    enabled: Boolean(userId),
    queryKey: ["cms-orders", userId || "anonymous"],
    queryFn: getCmsOrders,
  });
  const allOrders = useMemo(() => storeOrders.data || [], [storeOrders.data]);
  const sites = useMemo(() => {
    const values = new Map<string, string>();
    for (const order of allOrders) values.set(order.connectionId, order.storeName);
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allOrders]);
  const platforms = useMemo(() => [...new Set(allOrders.map((order) => order.platform))], [allOrders]);
  const periodStart = useMemo(() => {
    if (period === "all") return null;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(period) - 1));
    return start.getTime();
  }, [period]);
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allOrders.filter((order) => {
      if (periodStart != null) {
        const createdAt = order.createdAt ? new Date(order.createdAt).getTime() : Number.NaN;
        if (!Number.isFinite(createdAt) || createdAt < periodStart) return false;
      }
      if (site !== "all" && order.connectionId !== site) return false;
      if (platform !== "all" && order.platform !== platform) return false;
      if (status !== "all" && normalizeStoreOrderStatus(order.status) !== status) return false;
      if (!needle) return true;
      return [order.orderNumber, order.storeName, order.customerName, order.customerEmail, order.externalId]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [allOrders, periodStart, search, site, platform, status]);
  const rows = filteredOrders;
  const currency = useMemo(() => storeOrderCurrency(filteredOrders), [filteredOrders]);
  const currencies = useMemo(() => new Set(filteredOrders.map((order) => order.currency || "USD")), [filteredOrders]);
  const mixedCurrencies = currencies.size > 1;
  const reportOrders = useMemo(() => filteredOrders.filter((order) => (order.currency || "USD") === currency), [filteredOrders, currency]);
  const revenue = useMemo(() => reportOrders.reduce((sum, order) => sum + order.total, 0), [reportOrders]);
  const averageOrder = reportOrders.length ? revenue / reportOrders.length : 0;
  const settledCount = filteredOrders.filter((order) => ["paid", "completed", "fulfilled"].includes(normalizeStoreOrderStatus(order.status))).length;
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const pageOrders = useMemo(() => filteredOrders.slice((page - 1) * pageSize, page * pageSize), [filteredOrders, page, pageSize]);
  const selectedOrders = useMemo(() => filteredOrders.filter((order) => selected.has(order.id)), [filteredOrders, selected]);
  const cancellableOrders = selectedOrders.filter((order) => order.platform !== "shopify" && !["cancelled", "canceled", "refunded"].includes(normalizeStoreOrderStatus(order.status)));
  useEffect(() => {
    setSite(initialSite || "all");
  }, [initialSite]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search, site, platform, status, period, pageSize]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const reload = async () => {
    await storeOrders.refetch();
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filteredOrders.map((order) => order.id)) : new Set());
  };
  const exportOrders = (orders: CmsOrder[], label: string) => {
    if (!orders.length) return;
    downloadStoreCsv(storeOrderExportRows(orders), storeOrderExportColumns, `store-orders-${label}-${Date.now()}.csv`);
    toast.success(`${orders.length} store order${orders.length === 1 ? "" : "s"} exported.`);
  };
  const exportAnalysis = () => {
    if (!filteredOrders.length) return;
    const rows = buildStoreAnalysisExportRows(filteredOrders, currency);
    downloadStoreCsv(rows, ["section", "metric", "value", "currency", "orders", "platform"], `store-orders-analysis-${Date.now()}.csv`);
    toast.success("Store order analysis exported.");
  };
  const cancelSelected = async () => {
    if (!cancellableOrders.length) {
      toast.info("No selected orders can be cancelled from MaxForm. Shopify orders must be managed in Shopify.");
      return;
    }
    if (!window.confirm(`Cancel ${cancellableOrders.length} selected store order${cancellableOrders.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    let cancelled = 0;
    let failed = 0;
    for (const order of cancellableOrders) {
      try {
        await updateCmsOrder({ connectionId: order.connectionId, orderId: order.id, status: "cancelled", note: "Cancelled from MaxForm" });
        cancelled += 1;
      } catch {
        failed += 1;
      }
    }
    await reload();
    setSelected(new Set());
    setBulkBusy(false);
    if (failed) toast.warning(`${cancelled} order${cancelled === 1 ? "" : "s"} cancelled; ${failed} could not be updated.`);
    else toast.success(`${cancelled} store order${cancelled === 1 ? "" : "s"} cancelled.`);
  };
  const bulkActions: TableBulkAction[] = [
    { key: "export-selected", label: "Export selected", icon: <Download className="h-3.5 w-3.5" />, disabled: bulkBusy, onSelect: () => exportOrders(selectedOrders, "selected") },
    { key: "cancel-selected", label: "Cancel selected", icon: <Ban className="h-3.5 w-3.5" />, disabled: bulkBusy || !cancellableOrders.length, destructive: true, separatorBefore: true, onSelect: () => void cancelSelected() },
  ];

  return (
    <section className="space-y-5" aria-busy={storeOrders.isFetching || bulkBusy}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">Orders synchronized from every connected commerce site. Filters, analysis and exports use the same workspace-scoped order set.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{rows.length} shown · {formatCurrency(revenue, currency)} in this view{allOrders.length > rows.length ? " · filtered" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" variant="outline" size="sm"><a href="/dashboard?tab=stores&section=products"><Package className="h-3.5 w-3.5" />Manage listings</a></Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportOrders(filteredOrders, "filtered")} disabled={!filteredOrders.length}><Download className="h-3.5 w-3.5" />Export orders</Button>
          <Button type="button" variant="outline" size="sm" onClick={exportAnalysis} disabled={!filteredOrders.length}><TrendingUp className="h-3.5 w-3.5" />Export analysis</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={storeOrders.isFetching || bulkBusy}><RefreshCw className={cn("h-3.5 w-3.5", storeOrders.isFetching && "animate-spin")} />Refresh</Button>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3"><div><h2 className="text-[15px] font-semibold">Overview</h2><p className="mt-0.5 text-[12px] text-muted-foreground">A workspace-wide view of orders across every connected site.</p></div><span className="text-[11.5px] text-muted-foreground">{sites.length} connected sites</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Orders in view" value={String(filteredOrders.length)} hint="Across selected sites" />
        <StatTile label={`Revenue · ${currency}`} value={formatCurrency(revenue, currency)} hint={mixedCurrencies ? "Other currencies remain separate" : "Filtered order totals"} hero />
        <StatTile label={`Average order · ${currency}`} value={formatCurrency(averageOrder, currency)} hint="Reporting currency only" />
        <StatTile label="Settled rate" value={filteredOrders.length ? `${Math.round((settledCount / filteredOrders.length) * 100)}%` : "0%"} hint={`${settledCount} paid or completed`} />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, store or customer" className="h-9 pl-9 text-[13px]" aria-label="Search store orders" /></div>
        <select aria-label="Filter store orders by period" value={period} onChange={(event) => setPeriod(event.target.value as StoreOrderPeriod)} className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All synced time</option></select>
        <select aria-label="Filter store orders by site" value={site} onChange={(event) => setSite(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"><option value="all">All connected sites</option>{sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select aria-label="Filter store orders by provider" value={platform} onChange={(event) => setPlatform(event.target.value as "all" | CmsPlatform)} className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"><option value="all">All providers</option>{platforms.map((value) => <option key={value} value={value}>{storePlatformLabel(value)}</option>)}</select>
        <select aria-label="Filter store orders by status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"><option value="all">Any status</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="on_hold">On hold</option><option value="paid">Paid</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option><option value="failed">Failed</option></select>
      </div>
      {mixedCurrencies && <p className="text-[12px] text-muted-foreground">This workspace has multiple currencies. Counts include all currencies; revenue cards and charts use the most common currency ({currency}), and exports include each order&apos;s original currency.</p>}
      <div className="flex items-baseline justify-between gap-3"><div><h2 className="text-[15px] font-semibold">Analysis</h2><p className="mt-0.5 text-[12px] text-muted-foreground">Trend, status and connected-site performance for the active filters.</p></div></div>
      <StoreOrdersAnalytics orders={filteredOrders} currency={currency} mixedCurrencies={mixedCurrencies} />
      <div className="flex items-baseline justify-between gap-3"><div><h2 className="text-[15px] font-semibold">All store orders</h2><p className="mt-0.5 text-[12px] text-muted-foreground">Select rows for bulk actions, open an order for details, or move through the pages.</p></div><span className="text-[11.5px] text-muted-foreground">{filteredOrders.length} matching orders</span></div>
      {storeOrders.isError ? <div className="flex items-center gap-2 py-10 text-[14px] text-destructive"><CircleAlert className="h-4 w-4" />Store orders could not be loaded. Open Connected stores to check your access and connection health.</div> : filteredOrders.length > 0 ? <><TableSelectionBar totalCount={filteredOrders.length} selectedCount={selected.size} allSelected={selected.size > 0 && selected.size === filteredOrders.length} partiallySelected={selected.size > 0 && selected.size < filteredOrders.length} onToggleAll={toggleAll} onClear={() => setSelected(new Set())} itemLabel="store orders">{selected.size > 0 && <TableBulkActions actions={bulkActions} label="Bulk actions" />}</TableSelectionBar><StoreOrdersTable orders={pageOrders} loading={storeOrders.isLoading} onOpen={setOpenOrder} selected={selected} onToggle={toggleOne} /><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">Rows per page<select aria-label="Store orders per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><TablePagination page={page} pageCount={pageCount} pageSize={pageSize} totalCount={filteredOrders.length} onPageChange={setPage} itemLabel="store orders" /></div></> : <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center"><ShoppingBag className="h-5 w-5 text-muted-foreground" /><p className="text-[14px] font-medium">No store orders in this view</p><p className="max-w-[420px] text-[12.5px] text-muted-foreground">Orders from connected Shopify, WooCommerce, BigCommerce and Wix appear here after the first sync.</p></div>}
      <StoreOrderDialog order={openOrder} onOpenChange={(open) => { if (!open) setOpenOrder(null); }} onSaved={async () => { await reload(); }} />
    </section>
  );
}

/**
 * An identifier row. These are the values a customer quotes and an operator
 * pastes into a provider dashboard, so each one is selectable and copyable
 * rather than merely displayed.
 */
function IdRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <code className="select-all break-all font-mono text-[11.5px]">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            toast.success(`${label} copied.`);
          }}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
      </dd>
    </div>
  );
}

function OrderDetailDialog({
  orderId,
  currency,
  onOpenChange,
}: {
  orderId: string;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const identity = useWorkspaceIdentity();
  const detail = useQuery<OrderDetail>({
    enabled: Boolean(orderId),
    queryKey: ["order-detail", orderId],
    queryFn: () => getOrderDetail(orderId),
  });
  const data = detail.data;
  const order = data?.order;
  const orderCurrency = order?.currency || currency;
  const sourceHref = order ? orderSourceLink(order) : "";

  return (
    <Dialog open={Boolean(orderId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Order {order?.orderNumber || ""}</DialogTitle>
          <DialogDescription>
            {order
              ? `${order.customerName || order.customerEmail} · ${longDate(order.paidAt || order.createdAt)}`
              : "Loading"}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading order
          </div>
        ) : detail.isError || !order ? (
          <div className="flex items-center gap-2 py-10 text-[14px] text-destructive">
            <CircleAlert className="h-4 w-4" />
            This order could not be loaded.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium",
                  statusTone(order.status),
                )}
              >
                {ORDER_STATUS_LABELS[order.status] || order.status}
              </span>
              <Badge variant="outline">
                {ORDER_SOURCE_LABELS[
                  order.sourceType as keyof typeof ORDER_SOURCE_LABELS
                ] || order.sourceType}
              </Badge>
              {order.provider && (
                <Badge variant="secondary" className="capitalize">
                  {order.provider}
                </Badge>
              )}
              {order.campaignName && (
                <Badge variant="outline">Campaign: {order.campaignName}</Badge>
              )}
            </div>

            {order.failureReason && (
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-[12.5px] text-destructive">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {order.failureReason}
              </p>
            )}

            {data.items.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[70px] text-right">Qty</TableHead>
                      <TableHead className="w-[110px] text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="text-[13px] font-medium">{item.name}</p>
                          {(item.variantName || item.sku) && (
                            <p className="text-[11.5px] text-muted-foreground">
                              {[item.variantName, item.sku]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-[13px]">
                          {item.quantity}
                          {item.refundedQuantity > 0 && (
                            <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                              {item.refundedQuantity} refunded
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-[13px]">
                          {formatCurrency(item.totalAmount, orderCurrency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <dl className="space-y-1.5 rounded-md border border-border p-4 text-[13px]">
              {[
                ["Subtotal", order.subtotal],
                ...(order.discountAmount
                  ? ([["Discount", -order.discountAmount]] as const)
                  : []),
                ...(order.taxAmount ? ([["Tax", order.taxAmount]] as const) : []),
                ...(order.shippingAmount
                  ? ([["Shipping", order.shippingAmount]] as const)
                  : []),
              ].map(([label, amount]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{formatCurrency(Number(amount), orderCurrency)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-border pt-1.5 font-semibold">
                <dt>Total</dt>
                <dd>{formatCurrency(order.totalAmount, orderCurrency)}</dd>
              </div>
              {order.refundedAmount > 0 && (
                <div className="flex justify-between gap-4 text-amber-600 dark:text-amber-400">
                  <dt>Refunded</dt>
                  <dd>−{formatCurrency(order.refundedAmount, orderCurrency)}</dd>
                </div>
              )}
            </dl>

            {/* The trail an operator follows when a customer asks about a
                payment: which order, which attempt, which provider record. */}
            <dl className="divide-y divide-border rounded-md border border-border px-4 py-2">
              <IdRow label="Order number" value={order.orderNumber} />
              <IdRow label="Order ID" value={order.id} />
              <IdRow label="Provider reference" value={order.providerReference} />
              {data.payments.map((payment) => (
                <IdRow
                  key={`txn-${payment.id}`}
                  label="Transaction ID"
                  value={payment.transactionId}
                />
              ))}
              {data.payments.map((payment) => (
                <IdRow
                  key={`pay-${payment.id}`}
                  label="Payment ID"
                  value={payment.id}
                />
              ))}
              {order.contactId && (
                <IdRow label="Contact ID" value={order.contactId} />
              )}
            </dl>

            <dl className="space-y-1.5 rounded-md border border-border p-4 text-[13px]">
              <div className="flex flex-wrap justify-between gap-4">
                <dt className="text-muted-foreground">Placed</dt>
                <dd>{longDate(order.createdAt)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-4">
                <dt className="text-muted-foreground">Paid</dt>
                <dd>{order.paidAt ? longDate(order.paidAt) : "Not yet paid"}</dd>
              </div>
              {order.paymentMethodSummary && (
                <div className="flex flex-wrap justify-between gap-4">
                  <dt className="text-muted-foreground">Payment method</dt>
                  <dd>{order.paymentMethodSummary}</dd>
                </div>
              )}
              <div className="flex flex-wrap justify-between gap-4">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-right">
                  {order.contactName || order.customerName || "—"}
                  <span className="block text-[12px] text-muted-foreground">
                    {order.customerEmail}
                  </span>
                </dd>
              </div>
            </dl>

            {data.payments.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Payment attempts
                </p>
                {data.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-[12.5px]"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatCurrency(payment.amount, payment.currency)}
                      <span className="capitalize text-muted-foreground">
                        {payment.provider}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {ORDER_STATUS_LABELS[payment.status] || payment.status} ·{" "}
                      {longDate(payment.paidAt || payment.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {data.refunds.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Refunds
                </p>
                {data.refunds.map((refund) => (
                  <div
                    key={refund.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-[12.5px]"
                  >
                    <span className="flex items-center gap-2">
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatCurrency(refund.amount, refund.currency)}
                      {refund.reason ? ` · ${refund.reason}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {ORDER_STATUS_LABELS[refund.status] || refund.status} ·{" "}
                      {shortDate(refund.completedAt || refund.requestedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Payments owns the money actions; this is the way across. */}
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void downloadOrderReceipt(
                    {
                      number: order.orderNumber,
                      amount: order.totalAmount,
                      currency: orderCurrency,
                      customerName: order.contactName || order.customerName,
                      customerEmail: order.customerEmail,
                      subtotal: order.subtotal,
                      discountAmount: order.discountAmount,
                      taxAmount: order.taxAmount,
                      paidAt: order.paidAt || null,
                      provider: order.provider,
                      // The transaction id is what makes a receipt checkable
                      // against the provider; fall back to the order's own
                      // reference when no attempt was recorded.
                      providerReference:
                        data.payments[0]?.transactionId ||
                        order.providerReference,
                      items: data.items.map((item) => ({
                        name: item.variantName
                          ? `${item.name} (${item.variantName})`
                          : item.name,
                        quantity: item.quantity,
                        unitAmount: item.unitPrice,
                        totalAmount: item.totalAmount,
                      })),
                    },
                    {
                      accentColor: "#F93D0A",
                      logoUrl: identity.logoUrl || "",
                      name: identity.workspaceName || "Workspace",
                    },
                  ).catch(() => toast.error("The receipt could not be built."));
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Receipt
              </Button>
              {sourceHref && (
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={sourceHref}>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Open{" "}
                    {ORDER_SOURCE_LABELS[
                      order.sourceType as keyof typeof ORDER_SOURCE_LABELS
                    ] || "source"}
                  </a>
                </Button>
              )}
              <Button asChild type="button" variant="outline" size="sm">
                <a href={paymentsLink("refunds")}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Refund in Payments
                </a>
              </Button>
              <Button asChild type="button" variant="outline" size="sm">
                <a href={paymentsLink("orders")}>
                  <CreditCard className="h-3.5 w-3.5" />
                  Payment record
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OrdersModule({
  initialTab,
  initialSite,
  onTabChange,
  userId,
}: {
  initialTab?: OrdersTab;
  initialSite?: string;
  onTabChange?: (tab: OrdersTab) => void;
  userId?: string;
}) {
  const [tab, setTab] = useState<OrdersTab>(initialTab || DEFAULT_ORDERS_TAB);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [openOrderId, setOpenOrderId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (initialTab && initialTab !== tab) setTab(initialTab);
    // Only follows the deep link; local tab clicks own the state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Typing filters after a pause rather than on every keystroke: each change
  // is a database round trip.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const source = ORDER_TAB_SOURCE[tab] || "";
  const listEnabled = tab !== "overview" && tab !== "items" && tab !== "store_orders";

  const summary = useQuery({
    enabled: Boolean(userId),
    queryKey: ["orders-summary", userId || "anonymous"],
    queryFn: () => getOrdersSummary(30),
  });

  const orders = useQuery({
    enabled: Boolean(userId) && listEnabled,
    queryKey: [
      "orders-list",
      userId || "anonymous",
      source,
      status,
      appliedSearch,
      page,
    ],
    queryFn: () =>
      listOrders({
        source,
        status: status === "all" ? "" : status,
        search: appliedSearch,
        page,
        pageSize: 50,
      }),
  });

  const items = useQuery({
    enabled: Boolean(userId) && tab === "items",
    queryKey: ["orders-items", userId || "anonymous", page],
    queryFn: () => listOrderItems({ page, pageSize: 50 }),
  });

  // A workspace can take more than one currency; summing across them would be
  // meaningless, so the dominant one labels the totals and the rest are named.
  const currency = summary.data?.currencies[0]?.currency || "USD";
  const mixedCurrencies = (summary.data?.currencies.length || 0) > 1;

  const selectTab = useCallback(
    (next: OrdersTab) => {
      setTab(next);
      setPage(1);
      onTabChange?.(next);
    },
    [onTabChange],
  );

  const rows = useMemo(() => orders.data?.orders || [], [orders.data]);

  // A selection only means anything against the rows it was made on, so it is
  // dropped whenever the filter, tab or page changes underneath it.
  useEffect(() => {
    setSelected(new Set());
  }, [tab, source, status, appliedSearch, page]);

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((order) => order.id)) : new Set());
    },
    [rows],
  );

  const selectedOrders = useMemo(
    () => rows.filter((order) => selected.has(order.id)),
    [rows, selected],
  );
  // Deleting an order that took money would destroy the record a refund is
  // reconciled against, so the action is offered only when nothing settled is
  // in the selection. The server refuses it regardless.
  const settledSelected = selectedOrders.filter((order) =>
    SETTLED_STATUSES.includes(order.status),
  ).length;

  const afterMutation = useCallback(
    async (message: string) => {
      setSelected(new Set());
      // Cancelling or deleting moves money out of the totals and the item
      // aggregates as well as the list, so all three are re-read.
      await Promise.all([orders.refetch(), summary.refetch(), items.refetch()]);
      toast.success(message);
    },
    [orders, summary, items],
  );

  const runBulk = useCallback(
    async (action: () => Promise<string>) => {
      setBusy(true);
      try {
        const message = await action();
        await afterMutation(message);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That action did not complete.",
        );
      } finally {
        setBusy(false);
      }
    },
    [afterMutation],
  );

  const bulkActions: TableBulkAction[] = [
    {
      key: "export",
      label: "Export as CSV",
      icon: <Download className="h-3.5 w-3.5" />,
      disabled: busy,
      onSelect: () =>
        void runBulk(async () => {
          const result = await exportOrders([...selected]);
          downloadOrdersCsv(result.rows, `orders-${Date.now()}.csv`);
          return `${result.rows.length} order${result.rows.length === 1 ? "" : "s"} exported.`;
        }),
    },
    {
      key: "cancel",
      label: "Cancel unpaid orders",
      icon: <XCircle className="h-3.5 w-3.5" />,
      disabled: busy,
      separatorBefore: true,
      onSelect: () =>
        void runBulk(async () => {
          const result = await cancelOrders([...selected]);
          return `${result.cancelled} order${result.cancelled === 1 ? "" : "s"} cancelled.`;
        }),
    },
    {
      key: "delete",
      label:
        settledSelected > 0
          ? `${settledSelected} paid order${settledSelected === 1 ? "" : "s"} cannot be deleted`
          : "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      destructive: true,
      disabled: busy || settledSelected > 0,
      // Removing an order is not reversible and it is a financial record, so
      // the menu asks rather than acts.
      onSelect: () => setConfirmDelete(true),
    },
  ];

  const totals = summary.data?.totals;
  const trend = useMemo(() => summary.data?.trend || [], [summary.data]);
  const bySource = useMemo(
    () =>
      (summary.data?.bySource || []).map((entry) => ({
        ...entry,
        label:
          ORDER_SOURCE_LABELS[
            entry.sourceType as keyof typeof ORDER_SOURCE_LABELS
          ] || entry.sourceType,
      })),
    [summary.data],
  );

  return (
    <div className="space-y-6 pb-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <ShoppingBag className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
              Workspace sales
            </span>
          </div>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight sm:text-[34px]">
            Orders
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Every sale the workspace has taken — including connected store
            orders — in one dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" variant="outline" size="sm">
            <a href={paymentsLink("overview")}>
              <CreditCard className="h-3.5 w-3.5" />
              Payments
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={orders.isFetching || summary.isFetching}
            onClick={() => {
              void summary.refetch();
              void orders.refetch();
            }}
          >
            {orders.isFetching || summary.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <nav
        className="dashboard-scroll flex flex-wrap gap-1 border-b border-border"
        aria-label="Orders sections"
      >
        {ORDER_TABS.map((key) => {
          const Icon = tabMeta[key].icon;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[12px]",
                active
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tabMeta[key].label}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && (
        <section className={cn("space-y-4", vizRoot)}>
          {summary.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading summary
            </div>
          ) : (
            <>
              {/* The headline numbers, in one bordered strip rather than four
                  floating cards — fewer edges to read past. */}
              <div className="grid divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
                <StatTile
                  hero
                  label="Net revenue"
                  value={formatCurrency(totals?.net || 0, currency)}
                  hint={`Last ${summary.data?.days || 30} days${mixedCurrencies ? " · mixed currencies" : ""}`}
                />
                <StatTile
                  label="Orders"
                  value={String(totals?.orders || 0)}
                  hint={`${totals?.settled || 0} settled`}
                />
                <StatTile
                  label="Awaiting payment"
                  value={formatCurrency(totals?.outstanding || 0, currency)}
                  hint={`${totals?.open || 0} open order${totals?.open === 1 ? "" : "s"}`}
                />
                <StatTile
                  label="Refunded"
                  value={formatCurrency(totals?.refunded || 0, currency)}
                  hint={
                    totals?.gross
                      ? `${Math.round(((totals.refunded || 0) / totals.gross) * 100)}% of gross`
                      : "Nothing returned"
                  }
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                {/* Revenue over time. One series, so no legend — the title
                    names it — and one axis, never two. */}
                <div className="flex flex-col rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[13px] font-semibold">Revenue over time</h2>
                    <p className="text-[11.5px] text-muted-foreground">
                      Settled orders, last {summary.data?.days || 30} days
                    </p>
                  </div>
                  {trend.length === 0 ? (
                    <p className="flex flex-1 items-center justify-center py-12 text-center text-[12.5px] text-muted-foreground">
                      No orders in this period.
                    </p>
                  ) : (
                    <div className="mt-3 min-h-[210px] flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={trend}
                          margin={{ top: 6, right: 8, bottom: 0, left: 4 }}
                        >
                          <defs>
                            <linearGradient
                              id="orders-revenue-fill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="var(--viz-series)"
                                stopOpacity={0.22}
                              />
                              <stop
                                offset="100%"
                                stopColor="var(--viz-series)"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            vertical={false}
                            stroke="var(--viz-grid)"
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="day"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            minTickGap={40}
                            tickFormatter={chartDayLabel}
                            tick={{ fontSize: 11, fill: "currentColor" }}
                            className="text-muted-foreground"
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={6}
                            width={62}
                            tick={{ fontSize: 11, fill: "currentColor" }}
                            className="text-muted-foreground"
                            tickFormatter={(value: number) =>
                              compactMoney(value, currency)
                            }
                          />
                          <Tooltip
                            cursor={{
                              stroke: "var(--viz-grid)",
                              strokeWidth: 1,
                            }}
                            content={({ active, label, payload }) => (
                              <VizTooltip
                                active={active}
                                label={chartDayLabel(String(label ?? ""))}
                                rows={[
                                  {
                                    name: "settled",
                                    value: formatCurrency(
                                      Number(payload?.[0]?.value ?? 0),
                                      currency,
                                    ),
                                  },
                                ]}
                              />
                            )}
                          />
                          <Area
                            type="monotone"
                            dataKey="gross"
                            stroke="var(--viz-series)"
                            strokeWidth={2}
                            fill="url(#orders-revenue-fill)"
                            activeDot={{ r: 4, strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-4">
                    <h2 className="text-[13px] font-semibold">How orders ended</h2>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {totals?.orders || 0} order
                      {totals?.orders === 1 ? "" : "s"} in this period
                    </p>
                    <div className="mt-3">
                      <StatusBar
                        settled={totals?.settled || 0}
                        open={totals?.open || 0}
                        lost={totals?.lost || 0}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <h2 className="text-[13px] font-semibold">
                      Where sales come from
                    </h2>
                    <div className="mt-3">
                      <RankedBars
                        currency={currency}
                        emptyLabel="No orders in this period."
                        rows={bySource.map((entry) => ({
                          key: entry.sourceType,
                          label: entry.label,
                          meta: `${entry.orders}`,
                          value: entry.gross,
                        }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[13px] font-semibold">Best sellers</h2>
                  <button
                    type="button"
                    onClick={() => selectTab("items")}
                    className="text-[11.5px] font-medium text-primary hover:underline"
                  >
                    All items sold
                  </button>
                </div>
                <div className="mt-3">
                  <RankedBars
                    currency={currency}
                    emptyLabel="No items sold in this period."
                    rows={(summary.data?.topProducts || [])
                      .slice(0, 5)
                      .map((product) => ({
                        key: `${product.name}-${product.sku}`,
                        label: product.name,
                        meta: `×${product.quantity}`,
                        value: product.revenue,
                      }))}
                  />
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "items" && (
        <section className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Everything sold in the last {items.data?.days || 30} days, across
            every module.
          </p>
          {items.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading items
            </div>
          ) : items.isError ? (
            <div className="flex items-center gap-2 py-10 text-[14px] text-destructive">
              <CircleAlert className="h-4 w-4" />
              Items could not be loaded.
            </div>
          ) : (items.data?.items.length || 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
              <Package className="h-5 w-5 text-muted-foreground" />
              <p className="text-[14px] font-medium">Nothing sold yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="min-w-[120px]">SKU</TableHead>
                      <TableHead className="w-[100px] text-right">Orders</TableHead>
                      <TableHead className="w-[100px] text-right">Sold</TableHead>
                      <TableHead className="w-[130px] text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.data?.items.map((item) => (
                      <TableRow key={`${item.name}-${item.sku}`}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-[12.5px] text-muted-foreground">
                          {item.sku || "—"}
                        </TableCell>
                        <TableCell className="text-right">{item.orders}</TableCell>
                        <TableCell className="text-right">
                          {item.quantity}
                          {item.refundedQuantity > 0 && (
                            <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                              {item.refundedQuantity} refunded
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.revenue, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={items.data?.page || 1}
                pageCount={items.data?.pageCount || 1}
                pageSize={items.data?.pageSize || 50}
                totalCount={items.data?.total || 0}
                onPageChange={setPage}
                itemLabel="items"
              />
            </>
          )}
        </section>
      )}

      {tab === "store_orders" && <StoreOrdersPanel userId={userId} initialSite={initialSite} />}

      {listEnabled && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order number, customer or source"
                className="h-9 pl-9 text-[13px]"
                aria-label="Search orders"
              />
            </div>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-[170px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="open">Awaiting payment</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partially_refunded">Part refunded</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild type="button" variant="outline" size="sm" className="h-9">
              <a href={paymentsLink("reports")}>
                <Download className="h-3.5 w-3.5" />
                Reports
              </a>
            </Button>
          </div>

          {orders.data && orders.data.total > 0 && (
            <p className="text-[12.5px] text-muted-foreground">
              {orders.data.total} order{orders.data.total === 1 ? "" : "s"} ·{" "}
              {formatCurrency(orders.data.filteredGross, currency)} settled
              {orders.data.filteredRefunded > 0 &&
                ` · ${formatCurrency(orders.data.filteredRefunded, currency)} refunded`}
            </p>
          )}

          {rows.length > 0 && (
            <TableSelectionBar
              totalCount={rows.length}
              selectedCount={selected.size}
              allSelected={selected.size > 0 && selected.size === rows.length}
              partiallySelected={selected.size > 0 && selected.size < rows.length}
              onToggleAll={toggleAll}
              onClear={() => setSelected(new Set())}
              itemLabel="orders"
            >
              {selected.size > 0 && (
                <TableBulkActions actions={bulkActions} label="Bulk actions" />
              )}
            </TableSelectionBar>
          )}

          {orders.isError ? (
            <div className="flex items-center gap-2 py-10 text-[14px] text-destructive">
              <CircleAlert className="h-4 w-4" />
              Orders could not be loaded.
            </div>
          ) : (
            <OrdersTable
              orders={rows}
              currency={currency}
              loading={orders.isLoading}
              onOpen={(order) => setOpenOrderId(order.id)}
              selected={selected}
              onToggle={toggleOne}
            />
          )}

          <TablePagination
            page={orders.data?.page || 1}
            pageCount={orders.data?.pageCount || 1}
            pageSize={orders.data?.pageSize || 50}
            totalCount={orders.data?.total || 0}
            onPageChange={setPage}
            itemLabel="orders"
          />
        </section>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} order{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This removes the order and its items for good. Only orders that
              never took payment can be deleted — to close one without losing
              the record, cancel it instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Keep them
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                const ids = [...selected];
                setConfirmDelete(false);
                void runBulk(async () => {
                  const result = await deleteOrders(ids);
                  return `${result.deleted} order${result.deleted === 1 ? "" : "s"} deleted.`;
                });
              }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <OrderDetailDialog
        orderId={openOrderId}
        currency={currency}
        onOpenChange={(open) => {
          if (!open) setOpenOrderId("");
        }}
      />
    </div>
  );
}

export default OrdersModule;
