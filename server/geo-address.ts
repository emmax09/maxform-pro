import type { IncomingMessage, ServerResponse } from "node:http";

import { getCountryForTimezone } from "countries-and-timezones";
import cscModule from "countries-states-cities";

type CscCountry = { id: number; iso2: string; name: string };
type CscState = { id: number; name: string; state_code: string; country_code: string };
type CscCity = { name?: string };
type CscApi = {
  getAllCountries: () => CscCountry[];
  getStatesOfCountry: (countryId: number) => CscState[];
  getCitiesOfState: (stateId: number) => CscCity[];
};

// The package's CJS build sets `exports.default`, but depending on how this
// file is loaded (tsx, Vite's dev SSR transform, a bundler), the default
// export may or may not be auto-unwrapped. Handle both shapes defensively.
const csc = (
  typeof (cscModule as unknown as CscApi).getAllCountries === "function"
    ? cscModule
    : (cscModule as unknown as { default: CscApi }).default
) as CscApi;

type GeoOption = {
  description?: string;
  keywords?: string;
  label: string;
  value: string;
};

class GeoAddressError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
  cacheControl = "public, max-age=86400",
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const countryCode = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new GeoAddressError("Choose a valid country.");
  }
  return normalized;
};

const stateCode = (value: string) => value.trim();

const uniqueCities = (cities: Array<{ name?: string }>): GeoOption[] => {
  const seen = new Set<string>();
  return cities.flatMap((city) => {
    const name = String(city.name || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ label: name, value: name }];
  });
};

const countryIdFor = (country: string) => {
  const record = csc
    .getAllCountries()
    .find((entry) => entry.iso2 === country);
  if (!record) throw new GeoAddressError("Choose a valid country.");
  return record.id;
};

const statesFor = (country: string): GeoOption[] =>
  csc.getStatesOfCountry(countryIdFor(country)).map((state) => ({
    description: state.state_code,
    keywords: `${state.state_code} ${state.country_code}`,
    label: state.name,
    value: String(state.id),
  }));

const citiesFor = (_country: string, state: string): GeoOption[] => {
  if (!state) return [];
  const cities = csc.getCitiesOfState(Number(state));
  return uniqueCities(cities);
};

type SubmissionCountry = {
  country: string;
  countryCode: string;
  source: "edge" | "ip" | "locale" | "timezone";
};

const countryLookupCache = new Map<
  string,
  { expiresAt: number; value: SubmissionCountry | null }
>();

const headerValue = (request: IncomingMessage, name: string) => {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
};

const countryForCode = (value: string) => {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const country = csc.getAllCountries().find((entry) => entry.iso2 === code);
  return country
    ? ({ country: country.name, countryCode: code } as const)
    : null;
};

export const requestIp = (request: IncomingMessage) => {
  const forwarded = headerValue(request, "x-forwarded-for")
    .split(",")[0]
    ?.trim();
  return (forwarded || request.socket.remoteAddress || "")
    .trim()
    .replace(/^::ffff:/i, "")
    .slice(0, 80);
};

const publiclyRoutableIp = (value: string) => {
  if (!value || value === "::1" || value === "0.0.0.0") return false;
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(value)) {
    return false;
  }
  return /^[0-9a-f:.]+$/i.test(value);
};

const browserFallbackCountry = (url: URL): SubmissionCountry | null => {
  const locale = String(url.searchParams.get("locale") || "").trim();
  try {
    const region = new Intl.Locale(locale).region || "";
    const match = countryForCode(region);
    if (match) return { ...match, source: "locale" };
  } catch {
    // Locale is advisory only; continue with the browser timezone.
  }
  const timezone = String(url.searchParams.get("timezone") || "").trim();
  try {
    const country = getCountryForTimezone(timezone);
    const match = countryForCode(String(country?.id || ""));
    if (match) return { ...match, source: "timezone" };
  } catch {
    // A missing timezone should never prevent a form response from saving.
  }
  return null;
};

export const countryForRequest = async (
  request: IncomingMessage,
  url: URL,
): Promise<SubmissionCountry | null> => {
  for (const header of [
    "cf-ipcountry",
    "x-vercel-ip-country",
  ]) {
    const match = countryForCode(headerValue(request, header));
    if (match) return { ...match, source: "edge" };
  }

  const ip = requestIp(request);
  const canUseIpCache = publiclyRoutableIp(ip);
  const cached = canUseIpCache ? countryLookupCache.get(ip) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let resolved: SubmissionCountry | null = null;
  if (canUseIpCache) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await fetch(
        `https://ipwho.is/${encodeURIComponent(ip)}`,
        { signal: controller.signal },
      );
      const value = (await response.json()) as {
        country?: unknown;
        country_code?: unknown;
        success?: unknown;
      };
      const match = countryForCode(String(value.country_code || ""));
      if (response.ok && value.success !== false && match) {
        resolved = {
          ...match,
          country:
            typeof value.country === "string" && value.country.trim()
              ? value.country.trim()
              : match.country,
          source: "ip",
        };
      }
    } catch {
      // Fall through to the browser's locale and timezone signals.
    } finally {
      clearTimeout(timeout);
    }
  }
  resolved ||= browserFallbackCountry(url);
  if (canUseIpCache) {
    countryLookupCache.set(ip, {
      expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
      value: resolved,
    });
  }
  return resolved;
};

export async function handleGeoAddress(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "GET") {
      throw new GeoAddressError("This address action is not available.", 404);
    }
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "states";
    if (action === "country") {
      const location = await countryForRequest(request, url);
      json(
        response,
        200,
        {
          country: location?.country || "",
          countryCode: location?.countryCode || "",
          source: location?.source || "unavailable",
        },
        "private, no-store",
      );
      return;
    }
    const country = countryCode(url.searchParams.get("country") || "");
    if (action === "states") {
      json(response, 200, { options: statesFor(country) });
      return;
    }
    if (action === "cities") {
      json(response, 200, {
        options: citiesFor(country, stateCode(url.searchParams.get("state") || "")),
      });
      return;
    }
    throw new GeoAddressError("This address action is not available.", 404);
  } catch (error) {
    if (error instanceof GeoAddressError) {
      json(response, error.status, { error: error.message });
      return;
    }
    json(response, 500, {
      error: "Address options could not be loaded right now.",
    });
  }
}
