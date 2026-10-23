import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

type TicketDownloadScope = {
  eventId: string;
  orderId?: string;
  attendeeId?: string;
};

type ParsedTicketDownloadScope = TicketDownloadScope & { version: 1 };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const downloadSecret = () => {
  const secret =
    process.env.EVENT_TICKET_DOWNLOAD_SECRET ||
    process.env.EVENT_TICKET_SECRET ||
    process.env.JWT_SECRET ||
    "";
  if (secret.length < 32) throw new Error("TICKET_SERVICE_UNAVAILABLE");
  return createHash("sha256").update(secret).digest();
};

const encode = (value: Buffer) => value.toString("base64url");
const decode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_TOKEN_ENCODING");
  const decoded = Buffer.from(value, "base64url");
  // Buffer.from accepts non-canonical trailing base64 bits. Re-encoding makes
  // sure a one-character mutation cannot decode to the original bytes.
  if (encode(decoded) !== value) throw new Error("INVALID_TOKEN_ENCODING");
  return decoded;
};

/**
 * Creates an opaque, signed-and-encrypted public ticket link. The link carries
 * no readable ticket or workspace identifiers and is invalidated by the
 * server when the referenced ticket is no longer valid.
 */
export const createEventTicketDownloadToken = (scope: TicketDownloadScope) => {
  if (!uuidPattern.test(scope.eventId)) throw new Error("INVALID_TICKET_SCOPE");
  if (scope.orderId && !uuidPattern.test(scope.orderId)) {
    throw new Error("INVALID_TICKET_SCOPE");
  }
  if (scope.attendeeId && !uuidPattern.test(scope.attendeeId)) {
    throw new Error("INVALID_TICKET_SCOPE");
  }
  if (!scope.orderId && !scope.attendeeId) {
    throw new Error("INVALID_TICKET_SCOPE");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", downloadSecret(), iv);
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      e: scope.eventId,
      o: scope.orderId || "",
      a: scope.attendeeId || "",
    }),
    "utf8",
  );
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `mft1.${encode(iv)}.${encode(encrypted)}.${encode(cipher.getAuthTag())}`;
};

export const parseEventTicketDownloadToken = (
  token: string,
): ParsedTicketDownloadScope | null => {
  const [prefix, ivText, encryptedText, tagText] = token.trim().split(".");
  if (prefix !== "mft1" || !ivText || !encryptedText || !tagText) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      downloadSecret(),
      decode(ivText),
    );
    decipher.setAuthTag(decode(tagText));
    const payload = Buffer.concat([
      decipher.update(decode(encryptedText)),
      decipher.final(),
    ]).toString("utf8");
    const value = JSON.parse(payload) as Record<string, unknown>;
    const eventId = String(value.e || "");
    const orderId = String(value.o || "");
    const attendeeId = String(value.a || "");
    if (
      Number(value.v) !== 1 ||
      !uuidPattern.test(eventId) ||
      (!orderId && !attendeeId) ||
      (orderId && !uuidPattern.test(orderId)) ||
      (attendeeId && !uuidPattern.test(attendeeId))
    ) {
      return null;
    }
    return { version: 1, eventId, orderId: orderId || undefined, attendeeId: attendeeId || undefined };
  } catch {
    return null;
  }
};
