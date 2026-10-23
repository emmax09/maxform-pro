/**
 * Builds the workspace invoice document used by the Payments module.
 * Keeping this in one place makes the invoice downloadable from every invoice
 * row without coupling the document to the table or dialog state.
 */
import { jsPDF } from "jspdf";

import type { PaymentInvoice } from "@/components/payments/payment-types";
import { formatCurrency } from "@/lib/regional-options";

export type InvoiceDocumentWorkspace = {
  accentColor: string;
  logoUrl: string;
  name: string;
};

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
  const value = normalized.length === 3
    ? normalized.split("").map((channel) => channel + channel).join("")
    : normalized;
  const parsed = Number.parseInt(value, 16);
  if (!/^[\da-f]{6}$/i.test(value) || Number.isNaN(parsed)) {
    return [37, 99, 235];
  }
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

const safeDate = (value: string) => {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
};

const safeFilePart = (value: string) =>
  value.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").slice(0, 70) || "invoice";

export const downloadInvoicePdf = async (
  invoice: PaymentInvoice,
  workspace: InvoiceDocumentWorkspace,
) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 56;
  const contentWidth = pageWidth - margin * 2;
  const ink: [number, number, number] = [17, 24, 39];
  const muted: [number, number, number] = [107, 114, 128];
  const faint: [number, number, number] = [229, 231, 235];
  const panel: [number, number, number] = [249, 250, 251];
  const accent = hexToRgb(workspace.accentColor || "#2563eb");
  let y = 68;

  const line = (at: number) => {
    doc.setDrawColor(...faint);
    doc.setLineWidth(0.75);
    doc.line(margin, at, pageWidth - margin, at);
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - 56) return;
    doc.addPage();
    y = 58;
    line(y);
    y += 24;
  };

  const logo = workspace.logoUrl ? await loadImage(workspace.logoUrl) : null;
  if (logo) {
    try {
      doc.addImage(logo, margin, y - 22, 30, 30);
    } catch {
      // An external logo without CORS headers should not block an invoice.
    }
  } else {
    doc.setFillColor(...accent);
    doc.roundedRect(margin, y - 22, 30, 30, 6, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(workspace.name.trim().slice(0, 1).toUpperCase() || "M", margin + 15, y - 1, { align: "center" });
  }
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(workspace.name.trim() || "Workspace", margin + 40, y - 1);
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("INVOICE", pageWidth - margin, y - 9, { align: "right" });
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(invoice.invoiceNumber, pageWidth - margin, y + 7, { align: "right" });

  y += 34;
  line(y);
  y += 38;
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("BILL TO", margin, y);
  doc.text("INVOICE DETAILS", pageWidth - margin - 180, y);
  y += 18;
  doc.setTextColor(...ink);
  doc.setFontSize(11);
  doc.text(invoice.customerName || "Customer", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  doc.text(invoice.customerEmail || "No email recorded", margin, y + 16);
  doc.text(`Issued ${safeDate(invoice.createdAt)}`, pageWidth - margin - 180, y);
  doc.text(`Due ${safeDate(invoice.dueAt)}`, pageWidth - margin - 180, y + 16);
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.text(invoice.status.toUpperCase(), pageWidth - margin - 180, y + 32);

  y += 62;
  line(y);
  y += 26;
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DESCRIPTION", margin, y);
  doc.text("QTY", pageWidth - margin - 150, y, { align: "right" });
  doc.text("AMOUNT", pageWidth - margin, y, { align: "right" });

  for (const item of invoice.lineItems) {
    const total = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
    const description = doc.splitTextToSize(item.name || "Item", contentWidth - 210) as string[];
    ensureSpace(Math.max(30, description.length * 13 + 18));
    y += 22;
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(description, margin, y);
    doc.setTextColor(...muted);
    doc.text(String(item.quantity), pageWidth - margin - 150, y, { align: "right" });
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.text(formatCurrency(total, invoice.currency), pageWidth - margin, y, { align: "right" });
    y += (description.length - 1) * 13;
  }

  y += 18;
  line(y);
  const totalRow = (label: string, amount: number, emphasize = false) => {
    y += emphasize ? 28 : 21;
    doc.setFont("helvetica", emphasize ? "bold" : "normal");
    doc.setFontSize(emphasize ? 13 : 10.5);
    doc.setTextColor(...(emphasize ? ink : muted));
    doc.text(label, pageWidth - margin - 180, y);
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(emphasize ? 15 : 10.5);
    doc.text(formatCurrency(amount, invoice.currency), pageWidth - margin, y, { align: "right" });
  };
  totalRow("Amount due", invoice.amountDue, true);
  if (invoice.amountPaid > 0) totalRow("Amount paid", invoice.amountPaid);
  totalRow("Balance", Math.max(0, invoice.amountDue - invoice.amountPaid), true);

  if (invoice.memo.trim()) {
    ensureSpace(64);
    y += 34;
    const memoLines = doc.splitTextToSize(invoice.memo.trim(), contentWidth - 36) as string[];
    const panelHeight = 34 + memoLines.length * 13;
    doc.setFillColor(...panel);
    doc.roundedRect(margin, y, contentWidth, panelHeight, 8, 8, "F");
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("NOTE", margin + 18, y + 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(memoLines, margin + 18, y + 36);
    y += panelHeight;
  }

  y = Math.min(y + 42, pageHeight - 44);
  line(y);
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Issued by ${workspace.name.trim() || "Workspace"}`, pageWidth / 2, y + 22, { align: "center" });
  doc.save(`${safeFilePart(invoice.invoiceNumber)}-${safeFilePart(invoice.customerName)}.pdf`);
};
