import type { PublicIssuedEventTicket } from "@/lib/checkout";

export type PublicTicketDownload = {
  tickets: PublicIssuedEventTicket[];
  workspace: {
    accentColor: string;
    logoUrl: string;
    name: string;
  };
};

export const getPublicTicketDownload = async (token: string) => {
  const response = await fetch(
    `/api/events/tickets?action=download&token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } },
  );
  const value = (await response.json().catch(() => ({}))) as PublicTicketDownload & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      value.message || "This ticket link is invalid or no longer available.",
    );
  }
  return value;
};
