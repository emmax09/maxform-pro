/**
 * Merge variables read as `{{event.name}}` everywhere they were shown, which
 * is template syntax leaking into the interface. These helpers turn a stored
 * string into readable text with the variables shown as tokens, while the
 * stored value keeps its braces — only the presentation changes.
 */
export const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

const overrides: Record<string, string> = {
  "workspace.name": "Workspace",
  "contact.name": "Contact name",
  "contact.email": "Contact email",
  "action.url": "Action link",
  "unsubscribe.link": "Unsubscribe link",
  "campaign.message": "Campaign message",
  "campaign.subject": "Campaign subject",
};

/** `event.startTime` becomes "Event start time". */
export const variableLabel = (path: string) => {
  const key = path.trim();
  if (overrides[key]) return overrides[key];
  const words = key
    .split(".")
    .join(" ")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

/** Plain-text form, for places that cannot host an element (title, alt, aria). */
export const variablePlainText = (value: string) =>
  String(value || "").replace(VARIABLE_PATTERN, (_match, path: string) => variableLabel(path));

export const hasVariables = (value: string) => {
  VARIABLE_PATTERN.lastIndex = 0;
  return VARIABLE_PATTERN.test(String(value || ""));
};
