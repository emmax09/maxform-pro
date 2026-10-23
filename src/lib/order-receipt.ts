/**
 * The payment receipt, as a PDF.
 *
 * Extracted from the public payment-verification page so the Orders module can
 * hand a customer the same document an operator sees. One implementation: a
 * receipt that differs depending on which screen produced it is a receipt
 * nobody can reconcile against.
 *
 * The input is deliberately structural rather than tied to either caller's
 * types — the public checkout result and the workspace order ledger describe
 * the same sale in different shapes, and both map onto this.
 */
import { jsPDF } from "jspdf";

import { formatCurrency } from "@/lib/regional-options";

export type ReceiptCustomerDetails = {
  firstName?: string;
  lastName?: string;
  company?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  /** The public checkout shape calls it `region`; the ledger calls it
   *  `stateRegion`. Both are accepted so neither caller has to translate. */
  region?: string;
  stateRegion?: string;
  postalCode?: string;
  country?: string;
};

export type ReceiptOrderItem = {
  name: string;
  quantity: number;
  unitAmount?: number;
  totalAmount: number;
};

export type ReceiptOrder = {
  number: string;
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  subtotal?: number;
  discountAmount?: number;
  taxAmount?: number;
  paidAt?: string | null;
  provider?: string;
  providerReference?: string;
  items?: ReceiptOrderItem[];
  billingDetails?: ReceiptCustomerDetails;
};

export type ReceiptWorkspace = {
  accentColor: string;
  logoUrl: string;
  name: string;
};

const addressLines = (customer: ReceiptCustomerDetails | undefined) =>
  [
    customer?.addressLine1,
    customer?.addressLine2,
    [customer?.city, customer?.region || customer?.stateRegion, customer?.postalCode]
      .filter(Boolean)
      .join(", "),
    customer?.country,
  ].filter(Boolean) as string[];

const displayName = (
  customer: ReceiptCustomerDetails | undefined,
  fallback = "",
) =>
  [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
  fallback ||
  "Customer";

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  const parsed = Number.parseInt(value, 16);
  if (!/^[\da-f]{6}$/i.test(value) || Number.isNaN(parsed)) {
    return [37, 99, 235];
  }
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

/** "opay" reads as OPay, everything else is simply capitalised. */
const providerName = (provider: string) =>
  provider === "coupon"
    ? "Coupon"
    : provider === "opay"
      ? "OPay"
      : provider.slice(0, 1).toUpperCase() + provider.slice(1);

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60) || "Customer";

export const downloadOrderReceipt = async (
  order: ReceiptOrder,
  workspace: ReceiptWorkspace,
) => {
  const ink: [number, number, number] = [17, 24, 39];
  const muted: [number, number, number] = [107, 114, 128];
  const faint: [number, number, number] = [229, 231, 235];
  const panel: [number, number, number] = [249, 250, 251];
  const accent = hexToRgb(workspace.accentColor || "#ff5a1f");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 56;
  const contentWidth = pageWidth - marginX * 2;
  let y = 68;

  const hLine = (yPos: number) => {
    doc.setDrawColor(...faint);
    doc.setLineWidth(0.75);
    doc.line(marginX, yPos, pageWidth - marginX, yPos);
  };

  const logo = workspace.logoUrl ? await loadImage(workspace.logoUrl) : null;
  if (logo) {
    try {
      doc.addImage(logo, marginX, y - 22, 30, 30);
    } catch {
      // Cross-origin logos without CORS headers taint the canvas; skip silently.
    }
  } else {
    doc.setFillColor(...accent);
    doc.roundedRect(marginX, y - 22, 30, 30, 6, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(
      workspace.name.trim().slice(0, 1).toUpperCase() || "M",
      marginX + 15,
      y - 1,
      { align: "center" },
    );
  }
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(workspace.name, marginX + 40, y - 1);

  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("RECEIPT", pageWidth - marginX, y - 9, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(order.number, pageWidth - marginX, y + 7, { align: "right" });

  y += 34;
  hLine(y);

  y += 44;
  doc.setTextColor(...accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TOTAL PAID", marginX, y);

  y += 32;
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(formatCurrency(order.amount, order.currency), marginX, y);

  y += 22;
  const paidDate = order.paidAt ? new Date(order.paidAt) : null;
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    paidDate
      ? `Paid ${paidDate.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })} at ${paidDate.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}`
      : "Paid",
    marginX,
    y,
  );

  y += 26;
  hLine(y);

  y += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("PAYMENT DETAILS", marginX, y);
  y += 8;

  const detailRow = (label: string, value: string) => {
    if (!value) return;
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...muted);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ink);
    doc.text(value, pageWidth - marginX, y, { align: "right" });
  };

  detailRow("Order ID", order.number);
  detailRow("Transaction reference", order.providerReference);
  detailRow("Payment method", providerName(order.provider));
  detailRow("Status", "Paid");
  detailRow("Currency", order.currency);

  y += 24;
  hLine(y);

  y += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("ITEM", marginX, y);
  doc.text("AMOUNT", pageWidth - marginX, y, { align: "right" });

  for (const item of order.items) {
    y += 22;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(item.name, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.text(
      formatCurrency(item.totalAmount, order.currency),
      pageWidth - marginX,
      y,
      { align: "right" },
    );
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...muted);
    doc.text(
      `${item.quantity} x ${formatCurrency(item.unitAmount ?? 0, order.currency)}`,
      marginX,
      y,
    );
    y += 12;
  }

  y += 8;
  hLine(y);

  const totalRow = (label: string, value: string, emphasize = false) => {
    y += emphasize ? 28 : 22;
    doc.setFont("helvetica", emphasize ? "bold" : "normal");
    doc.setFontSize(emphasize ? 13 : 10.5);
    doc.setTextColor(...(emphasize ? ink : muted));
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(emphasize ? 15 : 10.5);
    doc.setTextColor(...ink);
    doc.text(value, pageWidth - marginX, y, { align: "right" });
  };

  totalRow("Subtotal", formatCurrency(order.subtotal, order.currency));
  if (order.discountAmount > 0) {
    totalRow(
      "Discount",
      `-${formatCurrency(order.discountAmount, order.currency)}`,
    );
  }
  if (order.taxAmount > 0) {
    totalRow("Tax", formatCurrency(order.taxAmount, order.currency));
  }
  y += 10;
  hLine(y);
  totalRow("Total paid", formatCurrency(order.amount, order.currency), true);

  y += 32;
  const billLines = addressLines(order.billingDetails);
  const panelHeight = 56 + billLines.length * 14;
  doc.setFillColor(...panel);
  doc.roundedRect(marginX, y, contentWidth, panelHeight, 8, 8, "F");
  const innerX = marginX + 18;
  let innerY = y + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text("BILLED TO", innerX, innerY);
  innerY += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(displayName(order.billingDetails, order.customerName), innerX, innerY);
  innerY += 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text(order.customerEmail, innerX, innerY);
  for (const line of billLines) {
    innerY += 14;
    doc.text(line, innerX, innerY);
  }

  y += panelHeight + 34;
  hLine(y);

  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  const thanks = doc.splitTextToSize(
    `Thank you for your payment to ${workspace.name}. Keep this receipt for your records.`,
    contentWidth,
  );
  doc.text(thanks, pageWidth / 2, y, { align: "center" });

  const paidForFilename = order.paidAt ? new Date(order.paidAt) : new Date();
  const datePart = paidForFilename.toISOString().slice(0, 10);
  const namePart = sanitizeFilename(
    displayName(order.billingDetails, order.customerName),
  );
  doc.save(`${namePart}-payment-${datePart}.pdf`);
};
