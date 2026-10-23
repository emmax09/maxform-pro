export type GeoAddressOption = {
  description?: string;
  keywords?: string;
  label: string;
  value: string;
};

const getAddressOptions = async (url: string) => {
  const response = await fetch(url);
  const value = (await response.json().catch(() => ({}))) as {
    error?: string;
    options?: GeoAddressOption[];
  };
  if (!response.ok) {
    throw new Error(value.error || "Address options could not be loaded.");
  }
  return value.options || [];
};

export const getCountryStates = (country: string) =>
  getAddressOptions(
    `/api/geo/address?action=states&country=${encodeURIComponent(country)}`,
  );

export const getCountryCities = (country: string, state = "") =>
  getAddressOptions(
    `/api/geo/address?action=cities&country=${encodeURIComponent(
      country,
    )}&state=${encodeURIComponent(state)}`,
  );

/** Records location against a saved public response using the request IP. */
export const recordPublicSubmissionLocation = async (
  formId: string,
  submissionId: string,
) => {
  if (!formId || !submissionId) return "";
  try {
    const response = await fetch("/api/forms/submission-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, submissionId }),
      cache: "no-store",
    });
    const value = (await response.json().catch(() => ({}))) as {
      country?: unknown;
    };
    if (!response.ok) return "";
    return typeof value.country === "string" ? value.country.trim() : "";
  } catch {
    // Location analytics must never block a legitimate response.
    return "";
  }
};
