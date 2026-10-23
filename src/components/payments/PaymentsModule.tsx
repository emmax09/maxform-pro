import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowDownToLine,
  BarChart3,
  BadgePercent,
  Banknote,
  Box,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  HeartPulse,
  ImagePlus,
  Loader2,
  Mail,
  MoreHorizontal,
  PackageOpen,
  Pause,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Trash2,
  TrendingUp,
  Unplug,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  normalizeProductQuantityLimits,
  type PaymentCoupon,
  type PaymentCouponAnalytics,
  type PaymentCouponInput,
  type PaymentCouponTarget,
  type PaymentInvoice,
  type PaymentInvoiceInput,
  type PaymentInventoryAlert,
  type PaymentOrder,
  type PaymentProduct,
  type PaymentProductInput,
  type PaymentProviderConnection,
  type PaymentProviderId,
  type PaymentRefund,
  type PaymentSubscription,
  type PaymentWorkspaceData,
} from "@/components/payments/payment-types";
import { SecureConnectionDialog } from "@/components/shared/SecureConnectionDialog";
import { SharedEmailTemplates } from "@/components/email/SharedEmailTemplates";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { PricingInput } from "@/components/shared/PricingInput";
import {
  TableFilterBar,
  TableFilterSelect,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadCsvFile } from "@/lib/csv";
import { useTableSelection } from "@/hooks/use-table-selection";
import { ProductGalleryUpload } from "@/components/shared/ProductGalleryUpload";
import { uploadFileToStorage } from "@/lib/storage";
import { TagInput } from "@/components/shared/TagInput";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceRegion } from "@/contexts/WorkspaceRegionContext";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import { useWorkspaceIdentity } from "@/hooks/use-workspace-logo";
import {
  beginPaymentProviderConnection,
  cancelPaymentSubscription,
  checkPaymentProviderHealth,
  connectPaymentApiProvider,
  deletePaymentCoupon,
  disconnectPaymentProvider,
  getPaymentProviderAvailability,
  getPaymentCouponAnalytics,
  listPaymentWorkspace,
  acknowledgePaymentInventoryAlert,
  requestPaymentRefund,
  savePaymentCoupon,
  savePaymentInvoice,
  savePaymentProduct,
  setDefaultPaymentProvider,
  setPaymentCouponActive,
  setPaymentProductActive,
  updatePaymentInvoiceStatus,
} from "@/lib/payments";
import { activeFormEditorKey } from "@/lib/form-draft-store";
import { queryKeys } from "@/lib/performance/query-client";
import {
  currencyOptions,
  formatCurrency,
} from "@/lib/regional-options";
import { downloadInvoicePdf } from "@/lib/invoice-document";
import { downloadOrderReceipt } from "@/lib/order-receipt";
import { cn } from "@/lib/utils";

type PaymentSection =
  | "overview"
  | "providers"
  | "email_templates"
  | "orders"
  | "invoices"
  | "subscriptions"
  | "refunds"
  | "coupons"
  | "products"
  | "reports";

const sections: Array<{
  key: PaymentSection;
  label: string;
  icon: typeof CreditCard;
}> = [
  { key: "overview", label: "Overview", icon: TrendingUp },
  { key: "providers", label: "Providers", icon: CreditCard },
  { key: "email_templates", label: "Email templates", icon: Mail },
  { key: "orders", label: "Orders", icon: ShoppingBag },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "subscriptions", label: "Subscriptions", icon: RefreshCw },
  { key: "refunds", label: "Refunds", icon: RotateCcw },
  { key: "coupons", label: "Coupons", icon: BadgePercent },
  { key: "products", label: "Products", icon: Box },
  { key: "reports", label: "Reports", icon: CircleDollarSign },
];

const providerCatalog: Array<{
  id: PaymentProviderId;
  name: string;
  description: string;
  logoUrl: string;
  authType: "oauth" | "api_key";
  accent: string;
}> = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Cards, wallets, and global hosted checkout.",
    logoUrl: "/logos/stripe.jpeg",
    authType: "oauth",
    accent: "#635BFF",
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "PayPal wallet and card checkout for global buyers.",
    logoUrl: "/logos/paypal.jpg",
    authType: "oauth",
    accent: "#0070E0",
  },
  {
    id: "paystack",
    name: "Paystack",
    description: "Cards, bank transfers, USSD, and mobile money.",
    logoUrl: "/logos/paystack.jpeg",
    authType: "api_key",
    accent: "#08A5DB",
  },
  {
    id: "opay",
    name: "OPay",
    description: "OPay merchant collection and hosted payment rails.",
    logoUrl: "/logos/opay.png",
    authType: "api_key",
    accent: "#00B875",
  },
];

const emptyData: PaymentWorkspaceData = {
  connections: [],
  products: [],
  coupons: [],
  couponTargets: [],
  orders: [],
  invoices: [],
  subscriptions: [],
  refunds: [],
  inventoryAlerts: [],
};

const defaultProviderAvailability: Record<
  PaymentProviderId,
  { configured: boolean }
> = {
  stripe: { configured: false },
  paypal: { configured: false },
  paystack: { configured: true },
  opay: { configured: true },
};

const dateValue = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const parseDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toDateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function DatePickerField({
  id,
  onChange,
  placeholder = "Pick a date",
  value,
}: {
  id: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateOnly(value.slice(0, 10));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "h-10 w-full justify-between bg-background px-3 text-left font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate">
            {selected
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                }).format(selected)
              : placeholder}
          </span>
          <CalendarClock className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(toDateOnly(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

const formatDate = (value: string, withTime = false) => {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: withTime ? "numeric" : undefined,
    minute: withTime ? "2-digit" : undefined,
    month: "short",
    year: "numeric",
  }).format(date);
};

const statusClasses = (status: string) => {
  if (["paid", "active", "connected", "succeeded"].includes(status)) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (
    ["pending", "processing", "open", "trialing", "partially_refunded"].includes(
      status,
    )
  ) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (["failed", "overdue", "past_due", "attention"].includes(status)) {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  return "bg-muted text-muted-foreground";
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-2 py-1 text-[10px] font-medium capitalize",
        statusClasses(status),
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function EmptyPanel({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof CreditCard;
  title: string;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center border-y border-border px-5 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[14px] font-semibold">{title}</h3>
      <p className="mt-2 max-w-[420px] text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function MetricStrip({
  items,
}: {
  items: Array<{
    icon: typeof CreditCard;
    label: string;
    meta?: string;
    value: string;
  }>;
}) {
  return (
    <div
      className="grid border-y border-border"
      style={{
        gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))`,
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="min-w-0 border-b border-border px-4 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate text-[11px]">{item.label}</span>
            </div>
            <p className="mt-3 truncate text-[22px] font-semibold tabular-nums">
              {item.value}
            </p>
            {item.meta && (
              <p className="mt-1 truncate text-[10px] text-muted-foreground">
                {item.meta}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverviewPanel({
  currency,
  data,
  onNavigate,
  onOrder,
}: {
  currency: string;
  data: PaymentWorkspaceData;
  onNavigate: (section: PaymentSection) => void;
  onOrder: (order: PaymentOrder) => void;
}) {
  const confirmedOrders = data.orders.filter(
    (order) =>
      ["paid", "partially_refunded", "refunded"].includes(order.status) &&
      order.currency === currency,
  );
  const revenue = confirmedOrders.reduce(
    (sum, order) =>
      sum + Math.max(0, order.totalAmount - order.refundedAmount),
    0,
  );
  const pending = data.orders.filter((order) =>
    ["pending", "processing"].includes(order.status),
  );
  const refundable = data.orders.filter(
    (order) =>
      ["paid", "partially_refunded"].includes(order.status) &&
      order.totalAmount > order.refundedAmount,
  );
  const chartData = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (13 - index));
      const key = date.toISOString().slice(0, 10);
      const dayOrders = confirmedOrders.filter(
        (order) => new Date(order.paidAt || order.createdAt).toISOString().slice(0, 10) === key,
      );
      return {
        date: new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
        }).format(date),
        orders: dayOrders.length,
        revenue: dayOrders.reduce(
          (sum, order) =>
            sum + Math.max(0, order.totalAmount - order.refundedAmount),
          0,
        ),
      };
    });
  }, [confirmedOrders]);
  const providerData = providerCatalog
    .map((provider) => ({
      fill: provider.accent,
      name: provider.name,
      value: confirmedOrders
        .filter((order) => order.provider === provider.id)
        .reduce(
          (sum, order) =>
            sum + Math.max(0, order.totalAmount - order.refundedAmount),
          0,
        ),
    }))
    .filter((item) => item.value > 0);

  return (
    <div className="space-y-9">
      <MetricStrip
        items={[
          {
            icon: CircleDollarSign,
            label: "Net revenue",
            value: formatCurrency(revenue, currency),
            meta: `${confirmedOrders.length} confirmed ${confirmedOrders.length === 1 ? "order" : "orders"}`,
          },
          {
            icon: ShoppingBag,
            label: "All orders",
            value: data.orders.length.toLocaleString(),
            meta: `${pending.length} awaiting confirmation`,
          },
          {
            icon: RefreshCw,
            label: "Active subscriptions",
            value: data.subscriptions
              .filter((item) => item.status === "active")
              .length.toLocaleString(),
            meta: `${data.subscriptions.length} total`,
          },
          {
            icon: RotateCcw,
            label: "Available to refund",
            value: refundable.length.toLocaleString(),
            meta: `${data.refunds.length} refund requests`,
          },
        ]}
      />

      {data.connections.length === 0 && (
        <button
          type="button"
          onClick={() => onNavigate("providers")}
          className="flex w-full items-center gap-4 border-y border-border bg-amber-500/5 px-4 py-4 text-left transition-colors hover:bg-amber-500/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">
              Connect a provider before collecting payments
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Forms and paid event tickets stay protected until a merchant
              account is ready.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.8fr)]">
        <section className="min-w-0">
          <div className="flex items-end justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-[15px] font-semibold">Revenue trend</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Confirmed payments in {currency}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">14 days</span>
          </div>
          <div className="mt-5 h-[270px]">
            {confirmedOrders.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="paymentRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    axisLine={false}
                    dataKey="date"
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    axisLine={false}
                    fontSize={10}
                    tickFormatter={(value) =>
                      formatCurrency(Number(value), currency, {
                        currencyDisplay: "narrowSymbol",
                        notation: "compact",
                      })
                    }
                    tickLine={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--popover-foreground))",
                      fontSize: 12,
                    }}
                    formatter={(value: number) => formatCurrency(value, currency)}
                  />
                  <Area
                    dataKey="revenue"
                    fill="url(#paymentRevenueFill)"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center border-y border-border text-[12px] text-muted-foreground">
                Revenue appears after the first confirmed payment.
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="border-b border-border pb-3">
            <h3 className="text-[15px] font-semibold">By provider</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Share of confirmed volume
            </p>
          </div>
          {providerData.length ? (
            <>
              <div className="mx-auto mt-5 h-[170px] max-w-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={providerData}
                      dataKey="value"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={3}
                    >
                      {providerData.map((item) => (
                        <Cell key={item.name} fill={item.fill} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number) =>
                        formatCurrency(value, currency)
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {providerData.map((provider) => (
                  <div
                    key={provider.name}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: provider.fill }}
                      />
                      {provider.name}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(provider.value, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex min-h-[220px] items-center justify-center border-b border-border text-center text-[12px] text-muted-foreground">
              Provider distribution appears with paid orders.
            </div>
          )}
        </section>
      </div>

      <section>
        <div className="flex items-end justify-between border-b border-border pb-3">
          <div>
            <h3 className="text-[15px] font-semibold">Recent orders</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Latest activity from forms, events, and invoices
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("orders")}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>
        {data.orders.length ? (
          <div className="divide-y divide-border">
            {data.orders.slice(0, 6).map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => onOrder(order)}
                className="grid w-full gap-2 py-4 text-left transition-colors hover:bg-muted/30 sm:grid-cols-[150px_minmax(0,1fr)_120px_120px] sm:items-center sm:px-2"
              >
                <span className="font-mono text-[11px] font-medium">
                  {order.orderNumber}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">
                    {order.customerName || order.customerEmail || "Customer"}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {order.sourceName || order.sourceType}
                  </span>
                </span>
                <StatusBadge status={order.status} />
                <span className="text-right text-[12px] font-semibold tabular-nums">
                  {formatCurrency(order.totalAmount, order.currency)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={ShoppingBag}
            title="No orders yet"
            description="Orders will appear here as customers complete paid forms, event registrations, invoices, and subscriptions."
          />
        )}
      </section>
    </div>
  );
}

function ProvidersPanel({
  availability,
  connections,
  onConnect,
  onDefault,
  onDisconnect,
  onHealth,
  workingProvider,
}: {
  availability: Record<PaymentProviderId, { configured: boolean }>;
  connections: PaymentProviderConnection[];
  onConnect: (provider: PaymentProviderId) => void;
  onDefault: (connection: PaymentProviderConnection) => void;
  onDisconnect: (connection: PaymentProviderConnection) => void;
  onHealth: (connection: PaymentProviderConnection) => void;
  workingProvider: PaymentProviderId | null;
}) {
  const connected = connections.filter(
    (connection) => connection.status === "connected",
  );
  return (
    <div className="space-y-9">
      <div>
        <h2 className="text-[20px] font-semibold">Merchant providers</h2>
        <p className="mt-2 max-w-[680px] text-[13px] leading-6 text-muted-foreground">
          Money moves directly into your connected merchant accounts. MaxForm
          never receives or holds your balance.
        </p>
      </div>

      <PaginatedCardGrid
        items={providerCatalog}
        pageSize={12}
        itemLabel="payment providers"
        getKey={(provider) => provider.id}
        renderItem={(provider) => {
          const connection = connections.find(
            (item) => item.provider === provider.id,
          );
          const busy = workingProvider === provider.id;
          return (
            <article
              className="rounded-md border border-border bg-card p-5"
            >
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-2">
                  <img
                    src={provider.logoUrl}
                    alt={`${provider.name} logo`}
                    className="h-full w-full object-contain"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-semibold">{provider.name}</h3>
                    {connection ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-[10px] font-medium",
                          connection.healthOk
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-300",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            connection.healthOk
                              ? "bg-emerald-500"
                              : "bg-rose-500",
                          )}
                        />
                        {connection.healthOk ? "Healthy" : "Needs attention"}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        Not connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {provider.description}
                  </p>
                </div>
              </div>

              {connection && (
                <div className="mt-5 border-y border-border py-3">
                  <p className="truncate text-[12px] font-medium">
                    {connection.externalAccountName || provider.name}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {connection.credentialHint ||
                      connection.externalAccountId ||
                      "Connected merchant account"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                    <span>
                      Checked{" "}
                      {connection.lastCheckedAt
                        ? formatDate(connection.lastCheckedAt, true)
                        : "on connection"}
                    </span>
                    {connection.isDefault && (
                      <span className="font-medium text-primary">
                        Workspace default
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {connection ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onHealth(connection)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HeartPulse className="h-3.5 w-3.5" />
                      )}
                      Check health
                    </Button>
                    {!connection.isDefault && connected.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDefault(connection)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Make default
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDisconnect(connection)}
                      disabled={busy}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onConnect(provider.id)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    Connect {provider.name}
                  </Button>
                )}
              </div>
            </article>
          );
        }}
      />

      <div className="flex items-start gap-3 border-y border-border py-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-[12px] font-medium">Protected account boundary</p>
          <p className="mt-1 max-w-[760px] text-[11px] leading-5 text-muted-foreground">
            Card numbers never pass through MaxForm. OAuth tokens and provider
            keys are encrypted server-side and are never returned to this
            dashboard after connection.
          </p>
        </div>
      </div>
    </div>
  );
}

function TableToolbar({
  children,
  query,
  setQuery,
}: {
  children?: React.ReactNode;
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <TableFilterBar>
      <TableSearchField
        value={query}
        onValueChange={setQuery}
        placeholder="Search"
        aria-label="Search table"
      />
      {children}
    </TableFilterBar>
  );
}

function OrdersPanel({
  orders,
  onOrder,
}: {
  orders: PaymentOrder[];
  onOrder: (order: PaymentOrder) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visible = orders.filter((order) => {
    const matchesQuery =
      `${order.orderNumber} ${order.customerName} ${order.customerEmail} ${order.sourceName}`
        .toLowerCase()
        .includes(query.toLowerCase());
    return matchesQuery && (status === "all" || order.status === status);
  });
  const selection = useTableSelection(visible.map((order) => order.id));
  const selectedOrders = visible.filter((order) =>
    selection.selectedVisibleIds.includes(order.id),
  );
  return (
    <div className="space-y-5">
      <TableToolbar query={query} setQuery={setQuery}>
        <TableFilterSelect
          value={status}
          onValueChange={setStatus}
          label="Filter orders by status"
          className="sm:w-[190px]"
          options={[
            { value: "all", label: "All statuses" },
            { value: "paid", label: "Paid" },
            { value: "pending", label: "Pending" },
            { value: "processing", label: "Processing" },
            { value: "failed", label: "Failed" },
            { value: "refunded", label: "Refunded" },
          ]}
        />
      </TableToolbar>
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="orders"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-orders-selected.csv",
              ["Order", "Customer", "Email", "Provider", "Status", "Total"],
              selectedOrders.map((order) => [
                order.orderNumber,
                order.customerName,
                order.customerEmail,
                order.provider,
                order.status,
                order.totalAmount,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {visible.length ? (
        <div className="border-y border-border">
          <div className="hidden grid-cols-[36px_140px_minmax(0,1fr)_100px_110px_130px_32px] gap-4 border-b border-border px-3 py-3 text-[10px] font-semibold uppercase text-muted-foreground md:grid">
            <span />
            <span>Order</span>
            <span>Customer</span>
            <span>Provider</span>
            <span>Status</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {visible.map((order) => (
              <div
                key={order.id}
                onClick={() => onOrder(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOrder(order);
                  }
                }}
                role="button"
                tabIndex={0}
                className="grid w-full grid-cols-[36px_minmax(0,1fr)] gap-3 px-3 py-4 text-left hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 [&>*:not(:first-child)]:col-start-2 md:grid-cols-[36px_140px_minmax(0,1fr)_100px_110px_130px_32px] md:items-center md:gap-4 md:[&>*:not(:first-child)]:col-start-auto"
              >
                <TableRowSelect
                  checked={selection.isSelected(order.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(order.id, checked)
                  }
                  label={`Select order ${order.orderNumber}`}
                  className="-ml-2"
                />
                <span>
                  <span className="block font-mono text-[11px] font-semibold">
                    {order.orderNumber}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {formatDate(order.createdAt)}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">
                    {order.customerName || "Customer"}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {order.customerEmail || order.sourceName}
                  </span>
                </span>
                <span className="text-[11px] capitalize text-muted-foreground">
                  {order.provider || "Not selected"}
                </span>
                <StatusBadge status={order.status} />
                <span className="text-right text-[12px] font-semibold tabular-nums">
                  {formatCurrency(order.totalAmount, order.currency)}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel
          icon={ShoppingBag}
          title={orders.length ? "No matching orders" : "No orders yet"}
          description={
            orders.length
              ? "Change the status filter or clear the search."
              : "Customer purchases from forms, events, invoices, and subscriptions will appear here."
          }
        />
      )}
    </div>
  );
}

function ProductsPanel({
  alerts,
  currency,
  onAcknowledgeAlert,
  onEdit,
  onToggle,
  products,
}: {
  alerts: PaymentInventoryAlert[];
  currency: string;
  onAcknowledgeAlert: (alert: PaymentInventoryAlert) => void;
  onEdit: (product: PaymentProduct) => void;
  onToggle: (product: PaymentProduct) => void;
  products: PaymentProduct[];
}) {
  const [query, setQuery] = useState("");
  const visible = products.filter((product) =>
    `${product.name} ${product.sku} ${product.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((product) => product.id));
  const selectedProducts = visible.filter((product) =>
    selection.selectedVisibleIds.includes(product.id),
  );
  return (
    <div className="space-y-5">
      {alerts.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">Inventory needs attention</p>
              <div className="mt-3 space-y-2">
                {alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className="flex flex-col gap-2 border-t border-amber-500/20 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium">
                        {alert.productName}{alert.variantName ? ` · ${alert.variantName}` : ""}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {alert.quantity} remaining · alert threshold {alert.threshold}
                      </p>
                    </div>
                    {alert.status === "open" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onAcknowledgeAlert(alert)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {alerts.length > 8 && (
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Showing the 8 most recent alerts. Resolve or restock items to clear them.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <TableToolbar query={query} setQuery={setQuery} />
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="products"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-products-selected.csv",
              ["Product", "SKU", "Billing", "Price", "Currency", "Status"],
              selectedProducts.map((product) => [
                product.name,
                product.sku,
                product.billingType,
                product.price,
                product.currency || currency,
                product.active ? "active" : "archived",
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {visible.length ? (
        <PaginatedCardGrid
          items={visible}
          pageSize={12}
          itemLabel="products"
          getKey={(product) => product.id}
          resetKey={query}
          renderItem={(product) => (
            <article
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <TableRowSelect
                  checked={selection.isSelected(product.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(product.id, checked)
                  }
                  label={`Select ${product.name}`}
                  className="-ml-2 -mt-1"
                />
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PackageOpen className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-[13px] font-semibold">
                      {product.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={`Actions for ${product.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(product)}>
                          <Settings2 className="mr-2 h-4 w-4" />
                          Edit product
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onToggle(product)}>
                          {product.active ? (
                            <Pause className="mr-2 h-4 w-4" />
                          ) : (
                            <Check className="mr-2 h-4 w-4" />
                          )}
                          {product.active ? "Archive" : "Activate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {product.sku || product.sourceType.replace("_", " ")}
                  </p>
                </div>
              </div>
              <p className="mt-4 line-clamp-2 min-h-10 text-[11px] leading-5 text-muted-foreground">
                {product.description || "No description"}
              </p>
              <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
                <div>
                  <p className="text-[15px] font-semibold tabular-nums">
                    {formatCurrency(product.price, product.currency || currency)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {product.billingType === "recurring"
                      ? `per ${product.billingInterval}`
                      : "one-time"}
                  </p>
                </div>
                <StatusBadge status={product.active ? "active" : "archived"} />
              </div>
            </article>
          )}
        />
      ) : (
        <EmptyPanel
          icon={PackageOpen}
          title={products.length ? "No matching products" : "No products yet"}
          description="Create reusable prices for forms and events. Event ticket products are also synchronized into this catalog."
        />
      )}
    </div>
  );
}

function CouponsPanel({
  coupons,
  currency,
  couponTargets,
  onAnalytics,
  onDelete,
  onEdit,
  onToggle,
}: {
  coupons: PaymentCoupon[];
  currency: string;
  couponTargets: PaymentCouponTarget[];
  onAnalytics: (coupon: PaymentCoupon) => void;
  onDelete: (coupon: PaymentCoupon) => void;
  onEdit: (coupon: PaymentCoupon) => void;
  onToggle: (coupon: PaymentCoupon) => void;
}) {
  const [query, setQuery] = useState("");
  const targetNames = useMemo(
    () =>
      new Map(
        couponTargets.map((target) => [
          `${target.type}:${target.id}`,
          target.name,
        ]),
      ),
    [couponTargets],
  );
  const visible = coupons.filter((coupon) =>
    `${coupon.code} ${coupon.name} ${coupon.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((coupon) => coupon.id));
  const selectedCoupons = visible.filter((coupon) =>
    selection.selectedVisibleIds.includes(coupon.id),
  );
  const scopeLabel = (coupon: PaymentCoupon) => {
    const target = coupon.directTarget || coupon.appliesTo[0];
    const productScope = coupon.eligibleProductIds?.length
      ? ` · ${coupon.eligibleProductIds.length} eligible product${coupon.eligibleProductIds.length === 1 ? "" : "s"}`
      : "";
    if (!target) return `All coupon-enabled paid checkouts${productScope}`;
    const name = targetNames.get(`${target.type}:${target.id}`) || "Linked checkout";
    if (coupon.appliesTo.length > 1) {
      return `${name} + ${coupon.appliesTo.length - 1} more${productScope}`;
    }
    return `${target.type === "event" ? "Event" : "Form"}: ${name}${productScope}`;
  };
  return (
    <div className="space-y-5">
      <TableToolbar query={query} setQuery={setQuery} />
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="coupons"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-coupons-selected.csv",
              ["Code", "Name", "Type", "Value", "Redemptions", "Status"],
              selectedCoupons.map((coupon) => [
                coupon.code,
                coupon.name,
                coupon.discountType,
                coupon.discountValue,
                coupon.redemptionCount,
                coupon.active ? "active" : "inactive",
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {visible.length ? (
        <div className="border-y border-border">
          <div className="hidden grid-cols-[36px_150px_minmax(0,1fr)_130px_130px_100px_40px] gap-4 border-b border-border px-3 py-3 text-[10px] font-semibold uppercase text-muted-foreground md:grid">
            <span />
            <span>Code</span>
            <span>Name</span>
            <span>Discount</span>
            <span>Redemptions</span>
            <span>Status</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {visible.map((coupon) => (
              <div
                key={coupon.id}
                className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 px-3 py-4 [&>*:not(:first-child)]:col-start-2 md:grid-cols-[36px_150px_minmax(0,1fr)_130px_130px_100px_40px] md:items-center md:gap-4 md:[&>*:not(:first-child)]:col-start-auto"
              >
                <TableRowSelect
                  checked={selection.isSelected(coupon.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(coupon.id, checked)
                  }
                  label={`Select coupon ${coupon.code}`}
                  className="-ml-2"
                />
                <span className="font-mono text-[12px] font-semibold">
                  {coupon.code}
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-[12px]">
                    {coupon.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {scopeLabel(coupon)}
                  </span>
                  {coupon.description && (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
                      {coupon.description}
                    </span>
                  )}
                </div>
                <span className="text-[12px] font-medium">
                  {coupon.discountType === "percentage"
                    ? `${coupon.discountValue}%`
                    : formatCurrency(
                        coupon.discountValue,
                        coupon.currency || currency,
                      )}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {coupon.redemptionCount}
                  {coupon.redemptionLimit
                    ? ` / ${coupon.redemptionLimit}`
                    : " / unlimited"}
                </span>
                <StatusBadge status={coupon.active ? "active" : "inactive"} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                      aria-label={`Actions for ${coupon.code}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onAnalytics(coupon)}>
                      <BarChart3 className="mr-2 h-4 w-4" />
                      View analytics
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(coupon)}>
                      <Settings2 className="mr-2 h-4 w-4" />
                      Edit coupon
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onToggle(coupon)}>
                      {coupon.active ? "Deactivate" : "Activate"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete(coupon)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete coupon
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel
          icon={Tag}
          title={coupons.length ? "No matching coupons" : "No coupons yet"}
          description="Create controlled discounts for paid forms, event registration, and ticket checkout."
        />
      )}
    </div>
  );
}

function CouponAnalyticsDialog({
  coupon,
  onOpenChange,
  open,
  userId,
}: {
  coupon: PaymentCoupon | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  userId: string;
}) {
  const [analytics, setAnalytics] = useState<PaymentCouponAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !coupon) return;
    let active = true;
    setLoading(true);
    setError("");
    setAnalytics(null);
    void getPaymentCouponAnalytics(userId, coupon.id)
      .then((result) => {
        if (active) setAnalytics(result);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Coupon analytics could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coupon, open, userId]);

  const dateLabel = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? "-"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[min(820px,90dvh)] max-w-[860px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 p-2 text-primary">
              <BarChart3 className="h-4 w-4" />
            </span>
            Coupon analytics{coupon ? ` · ${coupon.code}` : ""}
          </DialogTitle>
          <DialogDescription>
            Redemption activity and realized discount performance for this coupon.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading coupon activity
          </div>
        ) : error ? (
          <div className="border border-destructive/30 bg-destructive/5 p-4 text-[12px] text-destructive">
            {error}
          </div>
        ) : analytics ? (
          <div className="space-y-6 py-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Redeemed", analytics.redeemedCount],
                ["Reserved", analytics.reservedCount],
                ["Released", analytics.releasedCount],
                ["Unique customers", analytics.uniqueCustomers],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-border bg-muted/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-2 text-[24px] font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {analytics.totals.length > 0 && (
              <section>
                <h3 className="text-[13px] font-semibold">Realized value</h3>
                <div className="mt-3 divide-y divide-border border-y border-border">
                  {analytics.totals.map((total) => (
                    <div
                      key={total.currency}
                      className="grid gap-2 py-3 text-[12px] sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-8"
                    >
                      <span className="font-medium">{total.currency}</span>
                      <span className="text-muted-foreground">
                        {total.redemptions} redeemed
                      </span>
                      <span className="text-right tabular-nums">
                        {formatCurrency(total.discountAmount, total.currency)} off · {" "}
                        {formatCurrency(total.revenueAfterDiscount, total.currency)} collected
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold">Recent uses</h3>
                <span className="text-[10px] text-muted-foreground">
                  Last {analytics.recentRedemptions.length} redemptions
                </span>
              </div>
              {analytics.recentRedemptions.length ? (
                <div className="mt-3 divide-y divide-border border-y border-border">
                  {analytics.recentRedemptions.map((redemption) => (
                    <div
                      key={`${redemption.orderNumber}-${redemption.createdAt}`}
                      className="grid gap-2 py-3 text-[11px] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {redemption.customerName || redemption.customerEmail || "Checkout customer"}
                        </p>
                        <p className="mt-0.5 truncate text-muted-foreground">
                          {redemption.sourceName} · {redemption.orderNumber}
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        {redemption.status === "redeemed"
                          ? `Redeemed ${dateLabel(redemption.redeemedAt)}`
                          : `${redemption.status === "reserved" ? "Reserved" : "Released"} ${dateLabel(redemption.createdAt)}`}
                      </p>
                      <p className="text-left tabular-nums sm:text-right">
                        {formatCurrency(redemption.discountAmount, redemption.currency)} off
                        <span className="block text-muted-foreground">
                          {formatCurrency(redemption.totalAmount, redemption.currency)} total
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 border-y border-border py-10 text-center text-[12px] text-muted-foreground">
                  No one has used this coupon yet.
                </div>
              )}
            </section>
            <p className="text-[10px] leading-5 text-muted-foreground">
              IP and device identifiers are hashed for rate-limit enforcement and are never shown here.
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoicesPanel({
  invoices,
  onEdit,
  onDownload,
  onStatus,
}: {
  invoices: PaymentInvoice[];
  onEdit: (invoice: PaymentInvoice) => void;
  onDownload: (invoice: PaymentInvoice) => void;
  onStatus: (
    invoice: PaymentInvoice,
    status: PaymentInvoice["status"],
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = invoices.filter((invoice) =>
    `${invoice.invoiceNumber} ${invoice.customerName} ${invoice.customerEmail}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((invoice) => invoice.id));
  const selectedInvoices = visible.filter((invoice) =>
    selection.selectedVisibleIds.includes(invoice.id),
  );
  return (
    <div className="space-y-5">
      <TableToolbar query={query} setQuery={setQuery} />
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="invoices"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-invoices-selected.csv",
              [
                "Invoice",
                "Customer",
                "Email",
                "Status",
                "Due date",
                "Amount due",
                "Currency",
              ],
              selectedInvoices.map((invoice) => [
                invoice.invoiceNumber,
                invoice.customerName,
                invoice.customerEmail,
                invoice.status,
                invoice.dueAt,
                invoice.amountDue,
                invoice.currency,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {visible.length ? (
        <div className="border-y border-border">
          <div className="divide-y divide-border">
            {visible.map((invoice) => (
              <div
                key={invoice.id}
                className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 px-3 py-4 [&>*:not(:first-child)]:col-start-2 md:grid-cols-[36px_150px_minmax(0,1fr)_110px_130px_120px_40px] md:items-center md:gap-4 md:[&>*:not(:first-child)]:col-start-auto"
              >
                <TableRowSelect
                  checked={selection.isSelected(invoice.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(invoice.id, checked)
                  }
                  label={`Select invoice ${invoice.invoiceNumber}`}
                  className="-ml-2"
                />
                <span>
                  <span className="block font-mono text-[11px] font-semibold">
                    {invoice.invoiceNumber}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {formatDate(invoice.createdAt)}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">
                    {invoice.customerName}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {invoice.customerEmail}
                  </span>
                </span>
                <StatusBadge status={invoice.status} />
                <span className="text-[11px] text-muted-foreground">
                  Due {formatDate(invoice.dueAt)}
                </span>
                <span className="text-right text-[12px] font-semibold">
                  {formatCurrency(invoice.amountDue, invoice.currency)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                      aria-label={`Actions for ${invoice.invoiceNumber}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDownload(invoice)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download invoice
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(invoice)}>
                      <Settings2 className="mr-2 h-4 w-4" />
                      Edit invoice
                    </DropdownMenuItem>
                    {invoice.status === "draft" && (
                      <DropdownMenuItem
                        onClick={() => onStatus(invoice, "open")}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Mark as sent
                      </DropdownMenuItem>
                    )}
                    {["draft", "open", "overdue"].includes(invoice.status) && (
                      <DropdownMenuItem
                        onClick={() => onStatus(invoice, "paid")}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Mark paid
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onStatus(invoice, "void")}
                      className="text-destructive"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Void invoice
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel
          icon={FileText}
          title={invoices.length ? "No matching invoices" : "No invoices yet"}
          description="Create itemized invoices, track delivery and due dates, and reconcile payment status from one place."
        />
      )}
    </div>
  );
}

function SubscriptionsPanel({
  currency,
  data,
  onCancel,
}: {
  currency: string;
  data: PaymentWorkspaceData;
  onCancel: (subscription: PaymentSubscription) => void;
}) {
  const active = data.subscriptions.filter((item) =>
    ["active", "trialing"].includes(item.status),
  );
  const recurring = active
    .filter((item) => item.currency === currency)
    .reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="space-y-7">
      <MetricStrip
        items={[
          {
            icon: RefreshCw,
            label: "Active subscriptions",
            value: active.length.toLocaleString(),
          },
          {
            icon: Banknote,
            label: "Recurring value",
            value: formatCurrency(recurring, currency),
          },
          {
            icon: AlertCircle,
            label: "Past due",
            value: data.subscriptions
              .filter((item) => item.status === "past_due")
              .length.toLocaleString(),
          },
        ]}
      />
      {data.subscriptions.length ? (
        <div className="border-y border-border divide-y divide-border">
          {data.subscriptions.map((subscription) => (
            <div
              key={subscription.id}
              className="grid gap-3 px-3 py-4 md:grid-cols-[minmax(0,1fr)_120px_100px_145px_120px_36px] md:items-center md:gap-4"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold">
                  {subscription.productName}
                </span>
                <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                  {subscription.customerEmail}
                </span>
              </span>
              <span className="text-[11px] capitalize text-muted-foreground">
                {subscription.provider || "Provider"}
              </span>
              <StatusBadge status={subscription.status} />
              <span className="text-[11px] text-muted-foreground">
                Renews {formatDate(subscription.currentPeriodEnd)}
              </span>
              <span className="text-right text-[12px] font-semibold">
                {formatCurrency(subscription.amount, subscription.currency)}
                <span className="font-normal text-muted-foreground">
                  /{subscription.intervalUnit}
                </span>
              </span>
              <span className="flex justify-end">
                {["active", "trialing", "past_due", "paused"].includes(
                  subscription.status,
                ) && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Cancel subscription"
                    onClick={() => onCancel(subscription)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={RefreshCw}
          title="No subscriptions yet"
          description="Recurring products and their customer billing status will appear here after checkout."
        />
      )}
    </div>
  );
}

function RefundsPanel({
  onRequest,
  orders,
  refunds,
}: {
  onRequest: (order: PaymentOrder) => void;
  orders: PaymentOrder[];
  refunds: PaymentRefund[];
}) {
  const eligible = orders.filter(
    (order) =>
      order.status === "paid" &&
      Boolean(order.provider) &&
      order.totalAmount > order.refundedAmount,
  );
  return (
    <div className="space-y-7">
      {eligible.length > 0 && (
        <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-medium">Issue a refund</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Refunds always return through the provider used for the original
              payment.
            </p>
          </div>
          <Button type="button" onClick={() => onRequest(eligible[0])}>
            <RotateCcw className="h-4 w-4" />
            New refund
          </Button>
        </div>
      )}
      {refunds.length ? (
        <div className="border-y border-border divide-y divide-border">
          {refunds.map((refund) => (
            <div
              key={refund.id}
              className="grid gap-3 px-3 py-4 md:grid-cols-[150px_minmax(0,1fr)_110px_110px_130px] md:items-center md:gap-4"
            >
              <span>
                <span className="block font-mono text-[11px] font-semibold">
                  {refund.orderNumber}
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {formatDate(refund.requestedAt)}
                </span>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {refund.reason}
              </span>
              <span className="text-[11px] capitalize">{refund.provider}</span>
              <StatusBadge status={refund.status} />
              <span className="text-right text-[12px] font-semibold">
                {formatCurrency(refund.amount, refund.currency)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={RotateCcw}
          title="No refunds"
          description="Refund requests and their provider confirmation status will appear here."
          action={
            eligible.length ? (
              <Button type="button" onClick={() => onRequest(eligible[0])}>
                Request refund
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function ReportsPanel({
  currency,
  data,
}: {
  currency: string;
  data: PaymentWorkspaceData;
}) {
  const paid = data.orders.filter(
    (order) =>
      ["paid", "partially_refunded", "refunded"].includes(order.status) &&
      order.currency === currency,
  );
  const bySource = ["form", "event", "invoice", "subscription"].map(
    (source) => ({
      name: source[0].toUpperCase() + source.slice(1),
      revenue: paid
        .filter((order) => order.sourceType === source)
        .reduce(
          (sum, order) =>
            sum + Math.max(0, order.totalAmount - order.refundedAmount),
          0,
        ),
    }),
  );
  const byProduct = new Map<string, number>();
  paid.forEach((order) =>
    order.items.forEach((item) =>
      byProduct.set(
        item.name,
        (byProduct.get(item.name) || 0) +
          item.totalAmount *
            (order.totalAmount > 0
              ? Math.max(0, order.totalAmount - order.refundedAmount) /
                order.totalAmount
              : 1),
      ),
    ),
  );
  const productRows = Array.from(byProduct, ([name, revenue]) => ({
    name,
    revenue,
  }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const exportCsv = () => {
    const rows = [
      [
        "Order",
        "Date",
        "Customer",
        "Email",
        "Source",
        "Provider",
        "Status",
        "Currency",
        "Total",
      ],
      ...data.orders.map((order) => [
        order.orderNumber,
        order.createdAt,
        order.customerName,
        order.customerEmail,
        order.sourceType,
        order.provider || "",
        order.status,
        order.currency,
        order.totalAmount.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `maxform-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="space-y-9">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold">Revenue reports</h2>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Confirmed payment performance in the workspace currency.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="border-b border-border pb-3">
            <h3 className="text-[14px] font-semibold">Revenue by source</h3>
          </div>
          <div className="mt-5 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySource}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={10}
                  tickFormatter={(value) =>
                    formatCurrency(Number(value), currency, {
                      currencyDisplay: "narrowSymbol",
                      notation: "compact",
                    })
                  }
                />
                <RechartsTooltip
                  formatter={(value: number) => formatCurrency(value, currency)}
                />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section>
          <div className="border-b border-border pb-3">
            <h3 className="text-[14px] font-semibold">Top products</h3>
          </div>
          {productRows.length ? (
            <div className="mt-3 divide-y divide-border">
              {productRows.map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 py-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {item.name}
                  </span>
                  <span className="text-[12px] font-semibold">
                    {formatCurrency(item.revenue, currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={Box}
              title="No product revenue yet"
              description="Product performance appears after itemized orders are paid."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ProductDialog({
  currency,
  onOpenChange,
  onSave,
  open,
  product,
  working,
}: {
  currency: string;
  onOpenChange: (open: boolean) => void;
  onSave: (input: PaymentProductInput) => void;
  open: boolean;
  product: PaymentProduct | null;
  working: boolean;
}) {
  const [draft, setDraft] = useState<PaymentProductInput>({
    name: "",
    description: "",
    shortDescription: "",
    sku: "",
    price: 0,
    salePrice: null,
    currency,
    billingType: "one_time",
    billingInterval: null,
    imageUrl: "",
    imageGallery: [],
    promotionalBanner: "",
    category: "",
    categories: [],
    status: "active",
    availabilityStartAt: "",
    availabilityEndAt: "",
    minQuantity: 1,
    maxQuantity: 1000,
    onePerCustomer: false,
    hideWhenSoldOut: false,
    taxable: false,
    taxRate: 0,
    requiresShipping: false,
    trackInventory: false,
    inventoryQuantity: 0,
    lowStockThreshold: 5,
    allowBackorder: false,
    weightGrams: 0,
    options: [],
    variants: [],
    active: true,
  });

  const updateDraftWithQuantityLimits = (
    patch: Partial<PaymentProductInput>,
  ) => {
    setDraft((current) =>
      normalizeProductQuantityLimits({ ...current, ...patch }),
    );
  };

  useEffect(() => {
    if (!open) return;
    setDraft(
      normalizeProductQuantityLimits(
        product
          ? {
            id: product.id,
            name: product.name,
            description: product.description,
            shortDescription: product.shortDescription || "",
            sku: product.sku,
            price: product.price,
            salePrice: product.salePrice ?? null,
            currency: product.currency,
            billingType: product.billingType,
            billingInterval: product.billingInterval,
            imageUrl: product.imageUrl,
            imageGallery: product.imageGallery || [],
            promotionalBanner: product.promotionalBanner || "",
            category: product.category || "",
            categories: product.categories || (product.category ? [product.category] : []),
            status: product.status || (product.active ? "active" : "hidden"),
            availabilityStartAt: product.availabilityStartAt || "",
            availabilityEndAt: product.availabilityEndAt || "",
            minQuantity: product.minQuantity ?? 1,
            maxQuantity: product.maxQuantity ?? 1000,
            onePerCustomer: Boolean(product.onePerCustomer),
            hideWhenSoldOut: Boolean(product.hideWhenSoldOut),
            taxable: product.taxable,
            taxRate: product.taxRate,
            requiresShipping: product.requiresShipping,
            trackInventory: product.trackInventory,
            inventoryQuantity: product.inventoryQuantity,
            lowStockThreshold: product.lowStockThreshold,
            allowBackorder: product.allowBackorder,
            weightGrams: product.weightGrams,
            options: product.options,
            variants: product.variants,
            active: product.active,
          }
          : {
            name: "",
            description: "",
            shortDescription: "",
            sku: "",
            price: 0,
            salePrice: null,
            currency,
            billingType: "one_time",
            billingInterval: null,
            imageUrl: "",
            imageGallery: [],
            promotionalBanner: "",
            category: "",
            categories: [],
            status: "active",
            availabilityStartAt: "",
            availabilityEndAt: "",
            minQuantity: 1,
            maxQuantity: 1000,
            onePerCustomer: false,
            hideWhenSoldOut: false,
            taxable: false,
            taxRate: 0,
            requiresShipping: false,
            trackInventory: false,
            inventoryQuantity: 0,
            lowStockThreshold: 5,
            allowBackorder: false,
            weightGrams: 0,
            options: [],
            variants: [],
            active: true,
            },
      ),
    );
  }, [currency, open, product]);
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      toast.error("Choose an image smaller than 2 MB.");
      return;
    }
    void uploadFileToStorage(file, {
      purpose: "product_image",
      visibility: "public",
    })
      .then((stored) => {
        if (!stored.url) throw new Error("The public image URL is unavailable.");
        setDraft((current) => ({
          ...current,
          imageUrl: stored.url,
        }));
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "The image could not upload.",
        ),
      );
  };
  const quantityCeiling = draft.trackInventory
    ? Math.min(1000, Math.max(0, Math.floor(draft.inventoryQuantity || 0)))
    : 1000;
  const quantityInputMinimum = quantityCeiling === 0 ? 0 : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>
            Reuse this product in paid forms, events, invoices, and subscriptions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payment-product-name">Product name</Label>
            <Input
              id="payment-product-name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Consultation package"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-product-sku">SKU</Label>
            <Input
              id="payment-product-sku"
              value={draft.sku}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sku: event.target.value.toUpperCase().replace(/\s+/g, "-"),
                })
              }
              placeholder="CONSULT-01"
            />
          </div>
          <div className="space-y-2">
            <Label>Billing type</Label>
            <Select
              value={draft.billingType}
              onValueChange={(billingType: PaymentProduct["billingType"]) =>
                setDraft({
                  ...draft,
                  billingType,
                  billingInterval:
                    billingType === "recurring"
                      ? draft.billingInterval || "month"
                      : null,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">One-time</SelectItem>
                <SelectItem value="recurring">Recurring</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PricingInput
            id="payment-product-price"
            label="Price"
            currency={draft.currency}
            value={draft.price}
            onValueChange={(price) => setDraft({ ...draft, price })}
          />
          <div className="space-y-2">
            <Label>Currency</Label>
            <SearchableSelect
              value={draft.currency}
              onChange={(nextCurrency) =>
                setDraft({ ...draft, currency: nextCurrency })
              }
              options={currencyOptions.map((option) => ({
                value: option.code,
                label: `${option.code} - ${option.name}`,
                description: option.countries.slice(0, 2).join(", "),
              }))}
              searchPlaceholder="Search currency..."
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payment-product-image">Product image</Label>
            <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
              {draft.imageUrl ? (
                <div className="relative aspect-video">
                  <img src={draft.imageUrl} alt="Product preview" className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-linear-to-t from-black/70 to-transparent p-3 pt-8">
                    <Button type="button" variant="secondary" size="sm" asChild>
                      <label htmlFor="payment-product-image" className="cursor-pointer">Replace image</label>
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setDraft({ ...draft, imageUrl: "" })}>Remove</Button>
                  </div>
                </div>
              ) : (
                <label htmlFor="payment-product-image" className="flex min-h-36 cursor-pointer flex-col items-center justify-center px-5 text-center hover:bg-accent/50">
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  <span className="mt-3 text-[12px] font-medium">Upload product image</span>
                  <span className="mt-1 text-[10px] text-muted-foreground">PNG, JPG, or WebP · up to 2 MB</span>
                </label>
              )}
              <input id="payment-product-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="sr-only" />
            </div>
          </div>
          <ProductGalleryUpload
            id="payment-product-gallery"
            value={draft.imageGallery || []}
            onChange={(imageGallery) => setDraft({ ...draft, imageGallery })}
          />
          {draft.billingType === "recurring" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Billing interval</Label>
              <Select
                value={draft.billingInterval || "month"}
                onValueChange={(
                  billingInterval: NonNullable<PaymentProduct["billingInterval"]>,
                ) => setDraft({ ...draft, billingInterval })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="quarter">Quarterly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payment-product-description">Description</Label>
            <Textarea
              id="payment-product-description"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              className="min-h-[90px]"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payment-product-short-description">Short description</Label>
            <Textarea
              id="payment-product-short-description"
              value={draft.shortDescription || ""}
              onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })}
              rows={2}
              placeholder="A concise description for product cards."
            />
          </div>
          <PricingInput
            id="payment-product-sale-price"
            label="Sale price (optional)"
            currency={draft.currency}
            value={draft.salePrice || 0}
            onValueChange={(salePrice) => setDraft({ ...draft, salePrice: salePrice || null })}
          />
          <TagInput
            id="payment-product-categories"
            label="Categories"
            value={draft.categories || []}
            onChange={(categories) =>
              setDraft({
                ...draft,
                categories,
                category: categories[0] || "",
              })
            }
            placeholder="Category"
          />
          <div className="space-y-2">
            <Label htmlFor="payment-product-banner">Promotional badge</Label>
            <Input
              id="payment-product-banner"
              value={draft.promotionalBanner || ""}
              onChange={(event) => setDraft({ ...draft, promotionalBanner: event.target.value })}
              placeholder="Best seller"
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={draft.status || "active"}
              onValueChange={(status: NonNullable<PaymentProductInput["status"]>) =>
                setDraft({ ...draft, status, active: status === "active" })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="sold_out">Sold out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-4 border-y border-border py-5 sm:col-span-2">
            <div>
              <p className="text-[13px] font-semibold">Inventory and fulfilment</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stock is reserved when checkout starts and consumed after payment.
              </p>
            </div>
            <div className="space-y-3 border-y border-border py-4">
              <div>
                <Label>Quantity limits</Label>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Set the minimum and maximum units one customer can order.
                  {draft.trackInventory
                    ? ` Maximum is capped at ${quantityCeiling} unit${quantityCeiling === 1 ? "" : "s"} by current stock.`
                    : " Turn on inventory tracking to cap the maximum by stock."}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="payment-product-min-quantity">
                    Minimum quantity per order
                  </Label>
                  <Input
                    id="payment-product-min-quantity"
                    type="number"
                    min={quantityInputMinimum}
                    max={quantityCeiling}
                    value={draft.minQuantity ?? 1}
                    aria-label="Minimum quantity per order"
                    onChange={(event) =>
                      updateDraftWithQuantityLimits({
                        minQuantity: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payment-product-max-quantity">
                    Maximum quantity per order
                  </Label>
                  <Input
                    id="payment-product-max-quantity"
                    type="number"
                    min={quantityInputMinimum}
                    max={quantityCeiling}
                    value={draft.maxQuantity ?? 1000}
                    aria-label="Maximum quantity per order"
                    onChange={(event) =>
                      updateDraftWithQuantityLimits({
                        maxQuantity: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-4 border border-border p-3">
                <span className="text-[12px] font-medium">Track inventory</span>
                <Switch
                  checked={draft.trackInventory}
                  onCheckedChange={(trackInventory) =>
                    updateDraftWithQuantityLimits({ trackInventory })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-4 border border-border p-3">
                <span className="text-[12px] font-medium">Allow backorders</span>
                <Switch
                  checked={draft.allowBackorder}
                  onCheckedChange={(allowBackorder) =>
                    setDraft({ ...draft, allowBackorder })
                  }
                />
              </label>
              {draft.trackInventory && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="payment-product-stock">Stock quantity</Label>
                    <Input
                      id="payment-product-stock"
                      type="number"
                      min="0"
                      value={draft.inventoryQuantity}
                      onChange={(event) =>
                        updateDraftWithQuantityLimits({
                          inventoryQuantity: Math.max(
                            0,
                            Number(event.target.value) || 0,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payment-product-low-stock">Low-stock alert at</Label>
                    <Input
                      id="payment-product-low-stock"
                      type="number"
                      min="0"
                      value={draft.lowStockThreshold}
                      onChange={(event) => setDraft({
                        ...draft,
                        lowStockThreshold: Math.max(0, Number(event.target.value) || 0),
                      })}
                    />
                  </div>
                </>
              )}
              <label className="flex items-center justify-between gap-4 border border-border p-3">
                <span className="text-[12px] font-medium">Requires shipping</span>
                <Switch
                  checked={draft.requiresShipping}
                  onCheckedChange={(requiresShipping) =>
                    setDraft({ ...draft, requiresShipping })
                  }
                />
              </label>
              {draft.requiresShipping && (
                <div className="space-y-2">
                  <Label htmlFor="payment-product-weight">Weight (grams)</Label>
                  <Input
                    id="payment-product-weight"
                    type="number"
                    min="0"
                    value={draft.weightGrams}
                    onChange={(event) => setDraft({
                      ...draft,
                      weightGrams: Math.max(0, Number(event.target.value) || 0),
                    })}
                  />
                </div>
              )}
              <label className="flex items-center justify-between gap-4 border border-border p-3">
                <span className="text-[12px] font-medium">Taxable</span>
                <Switch
                  checked={draft.taxable}
                  onCheckedChange={(taxable) => setDraft({ ...draft, taxable })}
                />
              </label>
              {draft.taxable && (
                <div className="space-y-2">
                  <Label htmlFor="payment-product-tax">Tax rate (%)</Label>
                  <Input
                    id="payment-product-tax"
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    value={draft.taxRate}
                    onChange={(event) => setDraft({
                      ...draft,
                      taxRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    })}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-4 sm:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold">Product variations</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Add size, color, plan, or any other purchasable combination.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft({
                  ...draft,
                  variants: [
                    ...draft.variants,
                    {
                      name: `Variant ${draft.variants.length + 1}`,
                      sku: "",
                      price: draft.price,
                      optionValues: {},
                      imageUrl: "",
                      trackInventory: draft.trackInventory,
                      inventoryQuantity: 0,
                      lowStockThreshold: draft.lowStockThreshold,
                      allowBackorder: draft.allowBackorder,
                      active: true,
                      sortOrder: draft.variants.length,
                    },
                  ],
                })}
              >
                <Plus className="h-4 w-4" />
                Add variant
              </Button>
            </div>
            {draft.variants.map((variant, index) => (
              <div key={variant.id || index} className="grid gap-3 border border-border p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Variant name</Label>
                  <Input
                    value={variant.name}
                    onChange={(event) => setDraft({
                      ...draft,
                      variants: draft.variants.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Variant SKU</Label>
                  <Input
                    value={variant.sku}
                    onChange={(event) => setDraft({
                      ...draft,
                      variants: draft.variants.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, sku: event.target.value.toUpperCase().replace(/\s+/g, "-") }
                          : item,
                      ),
                    })}
                  />
                </div>
                <PricingInput
                  id={`payment-product-variant-price-${index}`}
                  label="Variant price"
                  currency={draft.currency}
                  value={variant.price}
                  onValueChange={(price) => setDraft({
                    ...draft,
                    variants: draft.variants.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, price } : item,
                    ),
                  })}
                />
                <div className="space-y-2">
                  <Label>Options</Label>
                  <Input
                    aria-label={`Variant ${index + 1} options`}
                    placeholder="Color: Black, Size: Large"
                    value={Object.entries(variant.optionValues)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(", ")}
                    onChange={(event) => {
                      const optionValues = Object.fromEntries(
                        event.target.value.split(",")
                          .map((part) => part.split(":"))
                          .filter((parts) => parts.length >= 2 && parts[0].trim() && parts.slice(1).join(":").trim())
                          .map((parts) => [parts[0].trim(), parts.slice(1).join(":").trim()]),
                      );
                      setDraft({
                        ...draft,
                        options: [...new Set([...draft.options, ...Object.keys(optionValues)])],
                        variants: draft.variants.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, optionValues } : item,
                        ),
                      });
                    }}
                  />
                </div>
                <label className="flex items-center justify-between gap-4 border border-border p-3">
                  <span className="text-[12px] font-medium">Track variant stock</span>
                  <Switch
                    checked={variant.trackInventory}
                    onCheckedChange={(trackInventory) => setDraft({
                      ...draft,
                      variants: draft.variants.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, trackInventory } : item,
                      ),
                    })}
                  />
                </label>
                {variant.trackInventory && (
                  <div className="space-y-2">
                    <Label>Variant stock</Label>
                    <Input
                      type="number"
                      min="0"
                      value={variant.inventoryQuantity}
                      onChange={(event) => setDraft({
                        ...draft,
                        variants: draft.variants.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, inventoryQuantity: Math.max(0, Number(event.target.value) || 0) }
                            : item,
                        ),
                      })}
                    />
                  </div>
                )}
                <div className="flex justify-end sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft({
                      ...draft,
                      variants: draft.variants.filter((_, itemIndex) => itemIndex !== index),
                    })}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove variant
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="sm:col-span-2">
            <Label>Product image</Label>
            <div className="mt-2 flex items-center gap-4 border-y border-border py-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {draft.imageUrl ? (
                  <img
                    src={draft.imageUrl}
                    alt="Product preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                )}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" asChild>
                  <label>
                    <ImagePlus className="h-4 w-4" />
                    {draft.imageUrl ? "Replace image" : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={upload}
                    />
                  </label>
                </Button>
                {draft.imageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft({ ...draft, imageUrl: "" })}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave(normalizeProductQuantityLimits(draft))}
            disabled={working || !draft.name.trim() || draft.price < 0}
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Save product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CouponDialog({
  coupon,
  currency,
  onOpenCouponSettings,
  targets,
  onOpenChange,
  onSave,
  open,
  working,
}: {
  coupon: PaymentCoupon | null;
  currency: string;
  onOpenCouponSettings: (target: PaymentCouponTarget) => void;
  targets: PaymentCouponTarget[];
  onOpenChange: (open: boolean) => void;
  onSave: (input: PaymentCouponInput) => void;
  open: boolean;
  working: boolean;
}) {
  const [draft, setDraft] = useState<PaymentCouponInput>({
    code: "",
    name: "",
    description: "",
    discountType: "percentage",
    discountValue: 10,
    currency: null,
    redemptionLimit: null,
    redemptionLimitPerCustomer: null,
    redemptionLimitPerIdentity: null,
    minimumAmount: 0,
    maximumDiscount: null,
    appliesTo: [],
    startsAt: "",
    endsAt: "",
    active: true,
    eligibleProductIds: [],
    excludedProductIds: [],
  });
  const [scope, setScope] = useState<"all" | "selected">("selected");
  const [targetQuery, setTargetQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    setScope(coupon ? (coupon.appliesTo.length ? "selected" : "all") : "selected");
    setTargetQuery("");
    setDraft(
      coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            name: coupon.name,
            description: coupon.description || "",
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            currency: coupon.currency,
            redemptionLimit: coupon.redemptionLimit,
            redemptionLimitPerCustomer:
              coupon.redemptionLimitPerCustomer,
            redemptionLimitPerIdentity:
              coupon.redemptionLimitPerIdentity,
            minimumAmount: coupon.minimumAmount,
            maximumDiscount: coupon.maximumDiscount,
            appliesTo: coupon.appliesTo,
            startsAt: coupon.startsAt.slice(0, 16),
            endsAt: coupon.endsAt.slice(0, 16),
            active: coupon.active,
            eligibleProductIds: coupon.eligibleProductIds || [],
            excludedProductIds: coupon.excludedProductIds || [],
          }
        : {
            code: "",
            name: "",
            description: "",
            discountType: "percentage",
            discountValue: 10,
            currency: null,
            redemptionLimit: null,
            redemptionLimitPerCustomer: null,
            redemptionLimitPerIdentity: null,
            minimumAmount: 0,
            maximumDiscount: null,
            appliesTo: [],
            startsAt: "",
            endsAt: "",
            active: true,
            eligibleProductIds: [],
            excludedProductIds: [],
          },
    );
  }, [coupon, open]);
  const visibleTargets = targets.filter((target) =>
    `${target.name} ${target.detail} ${target.type}`
      .toLowerCase()
      .includes(targetQuery.toLowerCase()),
  );
  const availableTargets = visibleTargets.filter(
    (target) => target.couponsEnabled,
  );
  const selectedTargetKeys = new Set(
    draft.appliesTo.map((target) => `${target.type}:${target.id}`),
  );
  const disabledTargets = visibleTargets.filter(
    (target) =>
      !target.couponsEnabled &&
      (Boolean(targetQuery.trim()) ||
        selectedTargetKeys.has(`${target.type}:${target.id}`)),
  );
  const toggleTarget = (target: PaymentCouponTarget) => {
    const key = `${target.type}:${target.id}`;
    setDraft({
      ...draft,
      appliesTo: selectedTargetKeys.has(key)
        ? draft.appliesTo.filter(
            (item) => `${item.type}:${item.id}` !== key,
          )
        : [...draft.appliesTo, { id: target.id, type: target.type }],
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[min(820px,90dvh)] max-w-[720px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{coupon ? "Edit coupon" : "New coupon"}</DialogTitle>
          <DialogDescription>
            Create a controlled discount for paid forms, event registration,
            and ticket checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-code">Code</Label>
            <Input
              id="payment-coupon-code"
              value={draft.code}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  code: event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9_-]/g, ""),
                })
              }
              placeholder="WELCOME20"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-name">Internal name</Label>
            <Input
              id="payment-coupon-name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Welcome campaign"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payment-coupon-description">Description (optional)</Label>
            <Textarea
              id="payment-coupon-description"
              value={draft.description || ""}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={2}
              placeholder="A short note for your team."
            />
          </div>
          <div className="space-y-2">
            <Label>Discount type</Label>
            <Select
              value={draft.discountType}
              onValueChange={(discountType: PaymentCoupon["discountType"]) =>
                setDraft({
                  ...draft,
                  discountType,
                  currency: discountType === "fixed" ? currency : null,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PricingInput
            id="payment-coupon-value"
            label="Discount"
            kind={
              draft.discountType === "percentage" ? "percentage" : "currency"
            }
            currency={draft.currency || currency}
            max={draft.discountType === "percentage" ? 100 : undefined}
            min={0.01}
            value={draft.discountValue}
            onValueChange={(discountValue) =>
              setDraft({ ...draft, discountValue })
            }
          />
          {draft.discountType === "percentage" && (
            <PricingInput
              id="payment-coupon-maximum"
              label="Maximum discount (optional)"
              currency={currency}
              min={0}
              value={draft.maximumDiscount || 0}
              onValueChange={(maximumDiscount) =>
                setDraft({
                  ...draft,
                  maximumDiscount: maximumDiscount || null,
                })
              }
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-limit">Total redemption limit</Label>
            <Input
              id="payment-coupon-limit"
              type="number"
              min="1"
              value={draft.redemptionLimit ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  redemptionLimit: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              placeholder="Unlimited"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-customer-limit">
              Limit per customer
            </Label>
            <Input
              id="payment-coupon-customer-limit"
              type="number"
              min="1"
              value={draft.redemptionLimitPerCustomer ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  redemptionLimitPerCustomer: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              placeholder="Unlimited"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-identity-limit">
              Limit per IP / device
            </Label>
            <Input
              id="payment-coupon-identity-limit"
              type="number"
              min="1"
              value={draft.redemptionLimitPerIdentity ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  redemptionLimitPerIdentity: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              placeholder="Unlimited"
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Uses an anonymous device fingerprint and network signal to block
              further uses from the same device or IP address.
            </p>
          </div>
          <PricingInput
            id="payment-coupon-minimum"
            label="Minimum order"
            currency={draft.currency || currency}
            value={draft.minimumAmount}
            onValueChange={(minimumAmount) =>
              setDraft({ ...draft, minimumAmount })
            }
          />
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-start">Starts</Label>
            <Input
              id="payment-coupon-start"
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) =>
                setDraft({ ...draft, startsAt: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-coupon-end">Expires</Label>
            <Input
              id="payment-coupon-end"
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) =>
                setDraft({ ...draft, endsAt: event.target.value })
              }
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Applies to</Label>
            <Select
              value={scope}
              onValueChange={(value: "all" | "selected") => {
                setScope(value);
                if (value === "all") {
                  setDraft({ ...draft, appliesTo: [] });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selected">
                  Selected forms and events
                </SelectItem>
                <SelectItem value="all">
                  All coupon-enabled paid checkouts
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "selected" && (
            <div className="space-y-3 sm:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={targetQuery}
                  onChange={(event) => setTargetQuery(event.target.value)}
                  placeholder="Search paid forms and events"
                  className="pl-9"
                />
              </div>
              <div className="dashboard-scroll max-h-52 overflow-y-auto border-y border-border">
                {availableTargets.length ? (
                  <div className="divide-y divide-border">
                    {availableTargets.map((target) => {
                      const selected = selectedTargetKeys.has(
                        `${target.type}:${target.id}`,
                      );
                      return (
                        <button
                          key={`${target.type}:${target.id}`}
                          type="button"
                          onClick={() => toggleTarget(target)}
                          className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-muted/60"
                          aria-pressed={selected}
                        >
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {selected && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">
                              {target.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                              {target.type === "event" ? "Event" : "Form"} ·{" "}
                              {target.detail}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {disabledTargets.length ? (
                  <div
                    className={cn(
                      availableTargets.length && "border-t border-border",
                    )}
                  >
                    {disabledTargets.map((target) => (
                      <div
                        key={`${target.type}:${target.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/5 px-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium">
                            {target.name}
                          </p>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                            Coupons are turned off for this {target.type}. Turn
                            them on in the builder before assigning this coupon.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenCouponSettings(target)}
                          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Open {target.type} builder
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!availableTargets.length && !disabledTargets.length && (
                  <p className="px-2 py-7 text-center text-[12px] text-muted-foreground">
                    {targets.length
                      ? "No paid checkout matches this search."
                      : "Configure pricing on a form or event first."}
                  </p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {draft.appliesTo.length
                  ? `${draft.appliesTo.length} checkout${
                      draft.appliesTo.length === 1 ? "" : "s"
                    } selected`
                  : "Select at least one checkout."}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-5 border-y border-border py-4 sm:col-span-2">
            <div>
              <p className="text-[12px] font-medium">Active coupon</p>
              <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                Turn this off to save the coupon without accepting it at
                checkout.
              </p>
            </div>
            <Switch
              checked={draft.active}
              onCheckedChange={(active) => setDraft({ ...draft, active })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave(draft)}
            disabled={
              working ||
              !draft.code.trim() ||
              !draft.name.trim() ||
              draft.discountValue <= 0 ||
              (scope === "selected" && draft.appliesTo.length === 0)
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Save coupon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const emptyInvoice = (currency: string): PaymentInvoiceInput => ({
  customerName: "",
  customerEmail: "",
  amountDue: 0,
  currency,
  dueAt: "",
  memo: "",
  lineItems: [
    {
      id: crypto.randomUUID(),
      name: "",
      quantity: 1,
      unitPrice: 0,
    },
  ],
});

function InvoiceDialog({
  currency,
  invoice,
  onOpenChange,
  onSave,
  open,
  working,
}: {
  currency: string;
  invoice: PaymentInvoice | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: PaymentInvoiceInput) => void;
  open: boolean;
  working: boolean;
}) {
  const [draft, setDraft] = useState<PaymentInvoiceInput>(
    emptyInvoice(currency),
  );
  useEffect(() => {
    if (!open) return;
    setDraft(
      invoice
        ? {
            id: invoice.id,
            customerName: invoice.customerName,
            customerEmail: invoice.customerEmail,
            amountDue: invoice.amountDue,
            currency: invoice.currency,
            dueAt: invoice.dueAt.slice(0, 10),
            memo: invoice.memo,
            lineItems: invoice.lineItems,
          }
        : emptyInvoice(currency),
    );
  }, [currency, invoice, open]);
  const updateLine = (
    id: string,
    patch: Partial<PaymentInvoiceInput["lineItems"][number]>,
  ) => {
    const lineItems = draft.lineItems.map((line) =>
      line.id === id ? { ...line, ...patch } : line,
    );
    setDraft({
      ...draft,
      lineItems,
      amountDue: lineItems.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice,
        0,
      ),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[720px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoice ? "Edit invoice" : "New invoice"}</DialogTitle>
          <DialogDescription>
            Build an itemized invoice in the workspace currency.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-customer-name">Customer name</Label>
            <Input
              id="invoice-customer-name"
              value={draft.customerName}
              onChange={(event) =>
                setDraft({ ...draft, customerName: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-customer-email">Customer email</Label>
            <Input
              id="invoice-customer-email"
              type="email"
              value={draft.customerEmail}
              onChange={(event) =>
                setDraft({ ...draft, customerEmail: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-due-date">Due date</Label>
            <DatePickerField
              id="invoice-due-date"
              value={draft.dueAt}
              onChange={(dueAt) => setDraft({ ...draft, dueAt })}
              placeholder="Pick due date"
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <SearchableSelect
              value={draft.currency}
              onChange={(nextCurrency) =>
                setDraft({ ...draft, currency: nextCurrency })
              }
              options={currencyOptions.map((option) => ({
                value: option.code,
                label: `${option.code} - ${option.name}`,
              }))}
            />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <Label>Line items</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    lineItems: [
                      ...draft.lineItems,
                      {
                        id: crypto.randomUUID(),
                        name: "",
                        quantity: 1,
                        unitPrice: 0,
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add line
              </Button>
            </div>
            <div className="divide-y divide-border">
              {draft.lineItems.map((line) => (
                <div
                  key={line.id}
                  className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_90px_150px_36px]"
                >
                  <Input
                    value={line.name}
                    onChange={(event) =>
                      updateLine(line.id, { name: event.target.value })
                    }
                    placeholder="Description"
                    aria-label="Invoice line description"
                  />
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.id, {
                        quantity: Math.max(1, Number(event.target.value)),
                      })
                    }
                    aria-label="Invoice line quantity"
                  />
                  <PricingInput
                    id={`invoice-line-${line.id}`}
                    label="Unit price"
                    currency={draft.currency}
                    value={line.unitPrice}
                    onValueChange={(unitPrice) =>
                      updateLine(line.id, { unitPrice })
                    }
                    className="[&>label]:sr-only [&>div]:mt-0"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const lineItems = draft.lineItems.filter(
                        (item) => item.id !== line.id,
                      );
                      setDraft({
                        ...draft,
                        lineItems,
                        amountDue: lineItems.reduce(
                          (sum, item) =>
                            sum + item.quantity * item.unitPrice,
                          0,
                        ),
                      });
                    }}
                    disabled={draft.lineItems.length === 1}
                    className="flex h-10 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"
                    aria-label="Remove invoice line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="invoice-memo">Memo</Label>
            <Textarea
              id="invoice-memo"
              value={draft.memo}
              onChange={(event) =>
                setDraft({ ...draft, memo: event.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-between border-y border-border py-4 sm:col-span-2">
            <span className="text-[13px] font-medium">Invoice total</span>
            <span className="text-[18px] font-semibold">
              {formatCurrency(draft.amountDue, draft.currency)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave(draft)}
            disabled={
              working ||
              !draft.customerName.trim() ||
              !/^\S+@\S+\.\S+$/.test(draft.customerEmail) ||
              draft.amountDue <= 0 ||
              draft.lineItems.some((line) => !line.name.trim())
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Save invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderKeyDialog({
  onOpenChange,
  onSave,
  open,
  provider,
  working,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (credentials: Record<string, string>) => void;
  open: boolean;
  provider: Extract<PaymentProviderId, "paystack" | "opay"> | null;
  working: boolean;
}) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setCredentials({});
  }, [open, provider]);
  const definition = providerCatalog.find((item) => item.id === provider);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-2">
              {definition && (
                <img
                  src={definition.logoUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Encrypted connection
            </span>
          </div>
          <DialogTitle>Connect {definition?.name}</DialogTitle>
          <DialogDescription>
            Credentials are sent directly to the secure server, validated once,
            encrypted, and never displayed again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {provider === "paystack" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="paystack-public-key">Public key</Label>
                <Input
                  id="paystack-public-key"
                  value={credentials.publicKey || ""}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      publicKey: event.target.value,
                    })
                  }
                  autoComplete="off"
                  placeholder="pk_..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paystack-secret-key">Secret key</Label>
                <Input
                  id="paystack-secret-key"
                  type="password"
                  value={credentials.secretKey || ""}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      secretKey: event.target.value,
                    })
                  }
                  autoComplete="new-password"
                  placeholder="sk_..."
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="opay-merchant-id">Merchant ID</Label>
                <Input
                  id="opay-merchant-id"
                  value={credentials.merchantId || ""}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      merchantId: event.target.value,
                    })
                  }
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opay-public-key">Public key</Label>
                <Input
                  id="opay-public-key"
                  value={credentials.publicKey || ""}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      publicKey: event.target.value,
                    })
                  }
                  autoComplete="off"
                  placeholder="OPAYPUB..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opay-secret-key">Secret key</Label>
                <Input
                  id="opay-secret-key"
                  type="password"
                  value={credentials.secretKey || ""}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      secretKey: event.target.value,
                    })
                  }
                  autoComplete="new-password"
                  placeholder="OPAYPRV..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opay-country">Merchant country code</Label>
                <Input
                  id="opay-country"
                  value={credentials.country || "NG"}
                  maxLength={2}
                  onChange={(event) =>
                    setCredentials({
                      ...credentials,
                      country: event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, ""),
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave(credentials)}
            disabled={
              working ||
              (provider === "paystack"
                ? !credentials.publicKey || !credentials.secretKey
                : !credentials.merchantId ||
                  !credentials.publicKey ||
                  !credentials.secretKey ||
                  !(credentials.country || "NG"))
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify and connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDialog({
  onOpenChange,
  onRefund,
  open,
  order,
}: {
  onOpenChange: (open: boolean) => void;
  onRefund: (order: PaymentOrder) => void;
  open: boolean;
  order: PaymentOrder | null;
}) {
  const workspaceIdentity = useWorkspaceIdentity();
  if (!order) return null;
  const refundable =
    order.status === "paid" &&
    Boolean(order.provider) &&
    order.totalAmount > order.refundedAmount;
  const receiptReady = ["paid", "partially_refunded", "refunded"].includes(order.status);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order.orderNumber}</DialogTitle>
          <DialogDescription>
            Created {formatDate(order.createdAt, true)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid border-y border-border sm:grid-cols-3">
          <div className="border-b border-border py-4 sm:border-b-0 sm:border-r sm:pr-4">
            <p className="text-[10px] text-muted-foreground">Status</p>
            <div className="mt-2">
              <StatusBadge status={order.status} />
            </div>
          </div>
          <div className="border-b border-border py-4 sm:border-b-0 sm:border-r sm:px-4">
            <p className="text-[10px] text-muted-foreground">Provider</p>
            <p className="mt-2 text-[12px] font-medium capitalize">
              {order.provider || "Not selected"}
            </p>
          </div>
          <div className="py-4 sm:pl-4">
            <p className="text-[10px] text-muted-foreground">Total</p>
            <p className="mt-2 text-[14px] font-semibold">
              {formatCurrency(order.totalAmount, order.currency)}
            </p>
          </div>
        </div>
        <section>
          <h3 className="text-[12px] font-semibold">Customer</h3>
          <div className="mt-3 border-y border-border py-3">
            <p className="text-[12px] font-medium">
              {order.customerName || "Customer"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {order.customerEmail || "No email recorded"}
            </p>
            {order.contactId ? (
              <p className="mt-2 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                Synced to CRM contact
              </p>
            ) : null}
          </div>
        </section>
        <section>
          <h3 className="text-[12px] font-semibold">Items</h3>
          {order.items.length ? (
            <div className="mt-3 divide-y divide-border border-y border-border">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_60px_120px] gap-3 py-3 text-[11px]"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground">× {item.quantity}</span>
                  <span className="text-right font-medium">
                    {formatCurrency(item.totalAmount, order.currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 border-y border-border py-4 text-[11px] text-muted-foreground">
              No itemized lines were recorded.
            </p>
          )}
        </section>
        <div className="space-y-2 border-y border-border py-4 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(order.subtotal, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span>-{formatCurrency(order.discountAmount, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCurrency(order.taxAmount, order.currency)}</span>
          </div>
          {order.refundedAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Refunded</span>
              <span>
                -{formatCurrency(order.refundedAmount, order.currency)}
              </span>
            </div>
          )}
          <div className="flex justify-between pt-2 text-[13px] font-semibold">
            <span>Total</span>
            <span>{formatCurrency(order.totalAmount, order.currency)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {receiptReady && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void downloadOrderReceipt(
                  {
                    number: order.orderNumber,
                    amount: order.totalAmount,
                    currency: order.currency,
                    customerName: order.customerName,
                    customerEmail: order.customerEmail,
                    subtotal: order.subtotal,
                    discountAmount: order.discountAmount,
                    taxAmount: order.taxAmount,
                    paidAt: order.paidAt || null,
                    provider: order.provider || "",
                    providerReference: order.providerReference,
                    items: order.items.map((item) => ({
                      name: item.variantName ? `${item.name} (${item.variantName})` : item.name,
                      quantity: item.quantity,
                      unitAmount: item.unitPrice,
                      totalAmount: item.totalAmount,
                    })),
                  },
                  {
                    accentColor: "#F93D0A",
                    logoUrl: workspaceIdentity.logoUrl || "",
                    name: workspaceIdentity.workspaceName || "Workspace",
                  },
                ).catch(() => toast.error("The receipt could not be built."));
              }}
            >
              <Download className="h-4 w-4" />
              Receipt
            </Button>
          )}
          {refundable && (
            <Button type="button" onClick={() => onRefund(order)}>
              <RotateCcw className="h-4 w-4" />
              Refund
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  onOpenChange,
  onSave,
  open,
  order,
  orders,
  working,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (input: { amount: number; orderId: string; reason: string }) => void;
  open: boolean;
  order: PaymentOrder | null;
  orders: PaymentOrder[];
  working: boolean;
}) {
  const eligible = useMemo(
    () =>
      orders.filter(
        (item) =>
          item.status === "paid" &&
          Boolean(item.provider) &&
          item.totalAmount > item.refundedAmount,
      ),
    [orders],
  );
  const [orderId, setOrderId] = useState("");
  const selected =
    eligible.find((item) => item.id === orderId) || order || eligible[0] || null;
  const available = selected
    ? selected.totalAmount - selected.refundedAmount
    : 0;
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    const next = order || eligible[0] || null;
    setOrderId(next?.id || "");
    setAmount(
      next ? Math.max(0, next.totalAmount - next.refundedAmount) : 0,
    );
    setReason("");
  }, [eligible, open, order]);
  useEffect(() => {
    if (selected) {
      setAmount(selected.totalAmount - selected.refundedAmount);
    }
  }, [selected]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Request refund</DialogTitle>
          <DialogDescription>
            The refund will use the same provider as the original charge.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Order</Label>
            <Select value={selected?.id || ""} onValueChange={setOrderId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an order" />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.orderNumber} -{" "}
                    {formatCurrency(
                      item.totalAmount - item.refundedAmount,
                      item.currency,
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <PricingInput
              id="refund-amount"
              label="Refund amount"
              currency={selected.currency}
              max={available}
              min={0.01}
              value={amount}
              onValueChange={setAmount}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason</Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Customer requested a cancellation"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              selected &&
              onSave({ amount, orderId: selected.id, reason: reason.trim() })
            }
            disabled={
              working ||
              !selected ||
              amount <= 0 ||
              amount > available ||
              !reason.trim()
            }
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentsModule({ userId }: { userId?: string }) {
  const { currency } = useWorkspaceRegion();
  const workspaceIdentity = useWorkspaceIdentity();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section") as PaymentSection | null;
  const initialSection = sections.some((item) => item.key === requestedSection)
    ? requestedSection!
    : "overview";
  const [section, setSectionState] =
    useState<PaymentSection>(initialSection);
  const [data, setData] = useState<PaymentWorkspaceData>(emptyData);
  const [loading, setLoading] = useState(Boolean(userId));
  const [loadFailed, setLoadFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [workingProvider, setWorkingProvider] =
    useState<PaymentProviderId | null>(null);
  const [availability, setAvailability] = useState<
    Record<PaymentProviderId, { configured: boolean }>
  >(defaultProviderAvailability);
  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<PaymentProduct | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<PaymentCoupon | null>(null);
  const [analyticsCoupon, setAnalyticsCoupon] = useState<PaymentCoupon | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] =
    useState<PaymentInvoice | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PaymentOrder | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundOrder, setRefundOrder] = useState<PaymentOrder | null>(null);
  const [oauthProvider, setOauthProvider] = useState<
    Extract<PaymentProviderId, "stripe" | "paypal"> | null
  >(null);
  const [keyProvider, setKeyProvider] = useState<
    Extract<PaymentProviderId, "paystack" | "opay"> | null
  >(null);
  const [disconnectTarget, setDisconnectTarget] =
    useState<PaymentProviderConnection | null>(null);
  const [subscriptionToCancel, setSubscriptionToCancel] =
    useState<PaymentSubscription | null>(null);
  const workspaceQuery = usePersistentQuery<PaymentWorkspaceData>({
    cacheKey: `payments::workspace::${userId || "__none"}`,
    cacheScope: "payments",
    enabled: Boolean(userId),
    persist: false,
    queryFn: () => listPaymentWorkspace(userId!),
    queryKey: queryKeys.payments.workspace(userId),
    tags: ["payments", userId || ""],
  });
  const availabilityQuery = usePersistentQuery<
    Record<PaymentProviderId, { configured: boolean }>
  >({
    cacheKey: "payments::availability",
    cacheScope: "payments",
    persist: false,
    queryFn: () =>
      getPaymentProviderAvailability().catch(
        () => defaultProviderAvailability,
      ),
    queryKey: queryKeys.payments.availability(),
    tags: ["payments"],
  });

  const load = useCallback(async () => {
    if (!userId) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    const [workspaceResult, availabilityResult] = await Promise.all([
      workspaceQuery.refetch(),
      availabilityQuery.refetch(),
    ]);
    if (workspaceResult.data) {
      setData(workspaceResult.data);
    } else {
      setLoadFailed(true);
    }
    if (availabilityResult.data) setAvailability(availabilityResult.data);
    setLoading(false);
  }, [availabilityQuery, userId, workspaceQuery]);

  useEffect(() => {
    if (!userId) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    if (workspaceQuery.data) {
      setData(workspaceQuery.data);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    if (workspaceQuery.isError) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setLoading(workspaceQuery.isInitialLoading);
  }, [
    userId,
    workspaceQuery.data,
    workspaceQuery.isError,
    workspaceQuery.isInitialLoading,
  ]);

  useEffect(() => {
    if (availabilityQuery.data) setAvailability(availabilityQuery.data);
  }, [availabilityQuery.data]);

  useEffect(() => {
    if (!userId || data === emptyData || loadFailed) return;
    queryClient.setQueryData(queryKeys.payments.workspace(userId), data);
  }, [data, loadFailed, queryClient, userId]);

  useEffect(() => {
    if (
      requestedSection &&
      sections.some((item) => item.key === requestedSection) &&
      requestedSection !== section
    ) {
      setSectionState(requestedSection);
    }
  }, [requestedSection, section]);

  const setSection = (nextSection: PaymentSection) => {
    setSectionState(nextSection);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "payments");
    next.set("section", nextSection);
    next.delete("view");
    setSearchParams(next);
  };

  const saveProduct = async (input: PaymentProductInput) => {
    if (!userId) return;
    setWorking(true);
    try {
      await savePaymentProduct(userId, input);
      await load();
      setProductOpen(false);
      toast.success("Product saved");
    } catch (error) {
      toast.error(
        error instanceof Error && /unique|duplicate/i.test(error.message)
          ? "That SKU is already used by another product."
          : "The product could not be saved. Check the details and try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  const saveCoupon = async (input: PaymentCouponInput) => {
    if (!userId) return;
    setWorking(true);
    try {
      const saved = await savePaymentCoupon(userId, input);
      setData((current) => ({
        ...current,
        coupons: current.coupons.some((coupon) => coupon.id === saved.id)
          ? current.coupons.map((coupon) =>
              coupon.id === saved.id ? saved : coupon,
            )
          : [saved, ...current.coupons],
      }));
      setCouponOpen(false);
      toast.success("Coupon saved");
    } catch (error) {
      toast.error(
        error instanceof Error && /unique|duplicate/i.test(error.message)
          ? "That coupon code already exists."
          : "The coupon could not be saved. Check the details and try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  const openCouponSettings = (target: PaymentCouponTarget) => {
    if (!userId) return;
    try {
      if (target.type === "form") {
        sessionStorage.setItem(activeFormEditorKey(userId), target.id);
        sessionStorage.setItem(`maxform:selected-form:${userId}`, target.id);
        sessionStorage.setItem(
          `maxform:form-builder-mode:${target.id}`,
          "payment",
        );
      } else {
        sessionStorage.setItem(`maxform:active-event:${userId}`, target.id);
        sessionStorage.setItem(
          `maxform:active-event-tab:${userId}`,
          "pricing",
        );
      }
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
    setCouponOpen(false);
    setSearchParams({
      tab: target.type === "form" ? "forms" : "events",
      section: "all",
    });
  };

  const deleteCoupon = async (coupon: PaymentCoupon) => {
    if (!userId) return;
    if (!window.confirm(`Delete ${coupon.code}? This cannot be undone.`)) return;
    setWorking(true);
    try {
      await deletePaymentCoupon(userId, coupon.id);
      setData((current) => ({
        ...current,
        coupons: current.coupons.filter((item) => item.id !== coupon.id),
      }));
      if (analyticsCoupon?.id === coupon.id) setAnalyticsCoupon(null);
      toast.success("Coupon deleted");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The coupon could not be deleted.",
      );
    } finally {
      setWorking(false);
    }
  };

  const saveInvoice = async (input: PaymentInvoiceInput) => {
    if (!userId) return;
    setWorking(true);
    try {
      await savePaymentInvoice(userId, input);
      await load();
      setInvoiceOpen(false);
      toast.success("Invoice saved");
    } catch {
      toast.error("The invoice could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const downloadInvoice = (invoice: PaymentInvoice) => {
    void downloadInvoicePdf(invoice, {
      accentColor: "#F93D0A",
      logoUrl: workspaceIdentity.logoUrl || "",
      name: workspaceIdentity.workspaceName || "Workspace",
    })
      .then(() => toast.success("Invoice downloaded"))
      .catch(() => toast.error("The invoice could not be built."));
  };

  const connect = (provider: PaymentProviderId) => {
    if (provider === "stripe" || provider === "paypal") {
      if (!availability[provider].configured) {
        toast.error(
          `${providerCatalog.find((item) => item.id === provider)?.name} connection is not available yet.`,
          {
            description:
              "The platform connection is still being configured. No workspace settings were changed.",
          },
        );
        return;
      }
      setOauthProvider(provider);
      return;
    }
    setKeyProvider(provider);
  };

  const connectKey = async (credentials: Record<string, string>) => {
    if (!keyProvider) return;
    setWorking(true);
    setWorkingProvider(keyProvider);
    try {
      await connectPaymentApiProvider(keyProvider, credentials);
      await load();
      setKeyProvider(null);
      toast.success(
        `${providerCatalog.find((item) => item.id === keyProvider)?.name} connected`,
      );
    } catch (error) {
      toast.error("The account could not be verified.", {
        description:
          error instanceof Error && error.message
            ? error.message
            : "Check the merchant credentials and make sure the provider account is active.",
      });
    } finally {
      setWorking(false);
      setWorkingProvider(null);
    }
  };

  const health = async (connection: PaymentProviderConnection) => {
    setWorkingProvider(connection.provider);
    try {
      const result = await checkPaymentProviderHealth(connection.provider);
      await load();
      if (result.health.ok) {
        toast.success("Provider connection is healthy");
      } else {
        toast.error("Provider needs attention", {
          description:
            result.health.error ||
            connection.lastError ||
            "Reconnect this provider or check the merchant account.",
        });
      }
    } catch (error) {
      toast.error("Provider check failed", {
        description:
          error instanceof Error && error.message
            ? error.message
            : "The provider could not be reached right now.",
      });
    } finally {
      setWorkingProvider(null);
    }
  };

  const makeDefault = async (connection: PaymentProviderConnection) => {
    if (!userId) return;
    setWorkingProvider(connection.provider);
    try {
      await setDefaultPaymentProvider(userId, connection.id);
      await load();
      toast.success(
        `${providerCatalog.find((item) => item.id === connection.provider)?.name} is now the workspace default`,
      );
    } catch {
      toast.error("The default provider could not be updated.");
    } finally {
      setWorkingProvider(null);
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget) return;
    setWorkingProvider(disconnectTarget.provider);
    try {
      await disconnectPaymentProvider(disconnectTarget.provider);
      await load();
      setDisconnectTarget(null);
      toast.success("Provider disconnected");
    } catch {
      toast.error("The provider could not be disconnected.", {
        description:
          "Resolve active billing or pending payment activity, then try again.",
      });
    } finally {
      setWorkingProvider(null);
    }
  };

  const requestRefund = async (input: {
    amount: number;
    orderId: string;
    reason: string;
  }) => {
    setWorking(true);
    try {
      await requestPaymentRefund(input);
      await load();
      setRefundOpen(false);
      setSelectedOrder(null);
      toast.success("Refund submitted");
    } catch {
      toast.error("The refund could not be submitted.", {
        description:
          "The original provider may be unavailable. Nothing was deducted.",
      });
    } finally {
      setWorking(false);
    }
  };

  const acknowledgeInventoryAlert = async (alert: PaymentInventoryAlert) => {
    try {
      await acknowledgePaymentInventoryAlert(alert.id);
      setData((current) => ({
        ...current,
        inventoryAlerts: current.inventoryAlerts.map((item) =>
          item.id === alert.id ? { ...item, status: "acknowledged" } : item,
        ),
      }));
      toast.success("Inventory alert acknowledged");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The inventory alert could not be updated.",
      );
    }
  };

  const cancelSubscription = async () => {
    if (!subscriptionToCancel) return;
    setWorking(true);
    try {
      await cancelPaymentSubscription(subscriptionToCancel.id);
      await load();
      setSubscriptionToCancel(null);
      toast.success("Subscription cancelled");
    } catch {
      toast.error("The subscription could not be cancelled.", {
        description:
          "The provider did not accept the change. No local billing status was altered.",
      });
    } finally {
      setWorking(false);
    }
  };

  const action =
    section === "products"
      ? {
          label: "New product",
          icon: Plus,
          onClick: () => {
            setEditingProduct(null);
            setProductOpen(true);
          },
        }
      : section === "coupons"
        ? {
            label: "New coupon",
            icon: Plus,
            onClick: () => {
              setEditingCoupon(null);
              setCouponOpen(true);
            },
          }
        : section === "invoices"
          ? {
              label: "New invoice",
              icon: Plus,
              onClick: () => {
                setEditingInvoice(null);
                setInvoiceOpen(true);
              },
            }
          : section === "refunds"
            ? {
                label: "New refund",
                icon: RotateCcw,
                onClick: () => {
                  setRefundOrder(null);
                  setRefundOpen(true);
                },
              }
            : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <EmptyPanel
        icon={AlertCircle}
        title="Payments could not be loaded"
        description="The workspace payment data is temporarily unavailable. Your existing records were not changed."
        action={
          <Button type="button" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight">Payments</h1>
          <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-muted-foreground">
            Orders, billing, providers, and revenue across every form and event.
          </p>
        </div>
        {action && (
          <Button type="button" onClick={action.onClick}>
            <action.icon className="h-4 w-4" />
            {action.label}
          </Button>
        )}
      </header>

      <nav
        className="dashboard-scroll dashboard-scroll-x mt-6 flex gap-7 overflow-x-auto border-b border-border"
        aria-label="Payment views"
      >
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 text-[13px] transition-colors",
                section === item.key
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              {section === item.key && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-primary" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-8">
        {section === "overview" && (
          <OverviewPanel
            currency={currency}
            data={data}
            onNavigate={setSection}
            onOrder={setSelectedOrder}
          />
        )}
        {section === "providers" && (
          <ProvidersPanel
            availability={availability}
            connections={data.connections}
            onConnect={connect}
            onDefault={(connection) => void makeDefault(connection)}
            onDisconnect={setDisconnectTarget}
            onHealth={(connection) => void health(connection)}
            workingProvider={workingProvider}
          />
        )}
        {section === "email_templates" && (
          <SharedEmailTemplates module="payments" />
        )}
        {section === "orders" && (
          <OrdersPanel orders={data.orders} onOrder={setSelectedOrder} />
        )}
        {section === "invoices" && (
          <InvoicesPanel
            invoices={data.invoices}
            onEdit={(invoice) => {
              setEditingInvoice(invoice);
              setInvoiceOpen(true);
            }}
            onDownload={downloadInvoice}
            onStatus={async (invoice, status) => {
              if (!userId) return;
              try {
                await updatePaymentInvoiceStatus(userId, invoice.id, status);
                await load();
                toast.success("Invoice updated");
              } catch {
                toast.error("The invoice could not be updated.");
              }
            }}
          />
        )}
        {section === "subscriptions" && (
          <SubscriptionsPanel
            currency={currency}
            data={data}
            onCancel={setSubscriptionToCancel}
          />
        )}
        {section === "refunds" && (
          <RefundsPanel
            orders={data.orders}
            refunds={data.refunds}
            onRequest={(order) => {
              setRefundOrder(order);
              setRefundOpen(true);
            }}
          />
        )}
        {section === "coupons" && (
          <CouponsPanel
            coupons={data.coupons}
            currency={currency}
            couponTargets={data.couponTargets}
            onAnalytics={setAnalyticsCoupon}
            onDelete={(coupon) => void deleteCoupon(coupon)}
            onEdit={(coupon) => {
              setEditingCoupon(coupon);
              setCouponOpen(true);
            }}
            onToggle={async (coupon) => {
              if (!userId) return;
              await setPaymentCouponActive(userId, coupon.id, !coupon.active);
              setData((current) => ({
                ...current,
                coupons: current.coupons.map((item) =>
                  item.id === coupon.id
                    ? { ...item, active: !coupon.active }
                    : item,
                ),
              }));
            }}
          />
        )}
        {section === "products" && (
          <ProductsPanel
            alerts={data.inventoryAlerts}
            currency={currency}
            onAcknowledgeAlert={(alert) => void acknowledgeInventoryAlert(alert)}
            products={data.products}
            onEdit={(product) => {
              setEditingProduct(product);
              setProductOpen(true);
            }}
            onToggle={async (product) => {
              if (!userId) return;
              await setPaymentProductActive(userId, product.id, !product.active);
              await load();
            }}
          />
        )}
        {section === "reports" && (
          <ReportsPanel currency={currency} data={data} />
        )}
      </div>

      <ProductDialog
        currency={currency}
        onOpenChange={setProductOpen}
        onSave={(input) => void saveProduct(input)}
        open={productOpen}
        product={editingProduct}
        working={working}
      />
      <CouponDialog
        coupon={editingCoupon}
        currency={currency}
        onOpenCouponSettings={openCouponSettings}
        targets={data.couponTargets}
        onOpenChange={setCouponOpen}
        onSave={(input) => void saveCoupon(input)}
        open={couponOpen}
        working={working}
      />
      {userId && (
        <CouponAnalyticsDialog
          coupon={analyticsCoupon}
          onOpenChange={(open) => {
            if (!open) setAnalyticsCoupon(null);
          }}
          open={Boolean(analyticsCoupon)}
          userId={userId}
        />
      )}
      <InvoiceDialog
        currency={currency}
        invoice={editingInvoice}
        onOpenChange={setInvoiceOpen}
        onSave={(input) => void saveInvoice(input)}
        open={invoiceOpen}
        working={working}
      />
      <OrderDialog
        onOpenChange={(open) => {
          if (!open) setSelectedOrder(null);
        }}
        onRefund={(order) => {
          setRefundOrder(order);
          setRefundOpen(true);
        }}
        open={Boolean(selectedOrder)}
        order={selectedOrder}
      />
      <RefundDialog
        onOpenChange={setRefundOpen}
        onSave={(input) => void requestRefund(input)}
        open={refundOpen}
        order={refundOrder}
        orders={data.orders}
        working={working}
      />
      <ProviderKeyDialog
        onOpenChange={(open) => {
          if (!open) setKeyProvider(null);
        }}
        onSave={(credentials) => void connectKey(credentials)}
        open={Boolean(keyProvider)}
        provider={keyProvider}
        working={working}
      />
      {oauthProvider && (
        <SecureConnectionDialog
          open
          name={
            providerCatalog.find((item) => item.id === oauthProvider)?.name ||
            "provider"
          }
          description="Authorize MaxForm to create hosted checkout sessions in your merchant account. Your dashboard stays open."
          logoUrl={
            providerCatalog.find((item) => item.id === oauthProvider)?.logoUrl
          }
          onOpenChange={(open) => {
            if (!open) setOauthProvider(null);
          }}
          prepareConnection={() =>
            beginPaymentProviderConnection(oauthProvider)
          }
          onConnected={async () => {
            await load();
            toast.success("Payment provider connected");
          }}
        />
      )}
      <Dialog
        open={Boolean(subscriptionToCancel)}
        onOpenChange={(open) => {
          if (!open) setSubscriptionToCancel(null);
        }}
      >
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Cancel subscription?</DialogTitle>
            <DialogDescription>
              Future renewals will stop at the payment provider. Existing
              orders and invoices will remain in the workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="border-y border-border py-4">
            <p className="text-[13px] font-medium">
              {subscriptionToCancel?.productName}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {subscriptionToCancel?.customerEmail}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSubscriptionToCancel(null)}
            >
              Keep active
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void cancelSubscription()}
              disabled={working}
            >
              {working && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Disconnect provider?</DialogTitle>
            <DialogDescription>
              New checkouts using this provider will pause. Existing orders and
              payment history remain available.
            </DialogDescription>
          </DialogHeader>
          <div className="border-y border-border py-4 text-[12px]">
            {disconnectTarget?.externalAccountName ||
              providerCatalog.find(
                (item) => item.id === disconnectTarget?.provider,
              )?.name}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisconnectTarget(null)}
            >
              Keep connected
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void disconnect()}
              disabled={Boolean(workingProvider)}
            >
              {workingProvider && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
