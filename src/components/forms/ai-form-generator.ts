import {
  cloneTemplateFields,
  formTemplates,
} from "@/components/forms/form-templates";
import {
  createId,
  type FormField,
  type FormFieldType,
  type FormTemplate,
} from "@/components/forms/form-types";

export type GeneratedFormDraft = {
  description: string;
  fields: FormField[];
  paymentRequested: boolean;
  sourceLabel: string;
  title: string;
};

type Intent = {
  keywords: string[];
  templateId: string;
};

type FieldHint = {
  keywords: string[];
  label: string;
  type: FormFieldType;
};

const intents: Intent[] = [
  {
    templateId: "job-application",
    keywords: ["job application", "candidate", "hiring", "recruit", "resume", "cv"],
  },
  {
    templateId: "employee-onboarding",
    keywords: ["employee onboarding", "new employee", "new hire"],
  },
  {
    templateId: "customer-feedback",
    keywords: ["customer feedback", "nps", "satisfaction", "feedback survey"],
  },
  {
    templateId: "survey-research",
    keywords: ["research survey", "questionnaire", "market research", "survey"],
  },
  {
    templateId: "ticketed-event",
    keywords: ["ticketed event", "sell tickets", "event checkout", "paid event"],
  },
  {
    templateId: "event-registration",
    keywords: ["event registration", "conference registration", "register attendees"],
  },
  {
    templateId: "event-rsvp",
    keywords: ["rsvp", "guest list"],
  },
  {
    templateId: "booking-request",
    keywords: ["booking request", "book a service", "reservation"],
  },
  {
    templateId: "consultation-intake",
    keywords: ["consultation", "client intake", "discovery call"],
  },
  {
    templateId: "order-form",
    keywords: ["order form", "purchase order", "take orders", "sell products"],
  },
  {
    templateId: "product-preorder",
    keywords: ["pre-order", "preorder", "product launch order"],
  },
  {
    templateId: "invoice-request",
    keywords: ["invoice request", "billing request"],
  },
  {
    templateId: "incident-report",
    keywords: ["incident report", "accident report", "safety report"],
  },
  {
    templateId: "vendor-intake",
    keywords: ["vendor intake", "supplier onboarding", "vendor onboarding"],
  },
  {
    templateId: "internal-request",
    keywords: ["internal request", "approval request", "employee request"],
  },
  {
    templateId: "contact-form",
    keywords: ["contact form", "lead capture", "contact us", "enquiry", "inquiry"],
  },
];

const fieldHints: FieldHint[] = [
  {
    keywords: ["full name", "your name", "contact name", "name"],
    label: "Full name",
    type: "shortText",
  },
  {
    keywords: ["email address", "email"],
    label: "Email address",
    type: "email",
  },
  {
    keywords: ["phone number", "telephone", "phone"],
    label: "Phone number",
    type: "phone",
  },
  {
    keywords: ["company name", "organization", "organisation", "company"],
    label: "Company name",
    type: "shortText",
  },
  {
    keywords: ["website", "url"],
    label: "Website",
    type: "url",
  },
  {
    keywords: ["postal address", "home address", "address"],
    label: "Address",
    type: "address",
  },
  {
    keywords: ["gps", "coordinates", "current location", "geolocation"],
    label: "Location",
    type: "location",
  },
  {
    keywords: ["appointment", "booking slot", "available time"],
    label: "Preferred appointment",
    type: "appointment",
  },
  {
    keywords: ["date"],
    label: "Preferred date",
    type: "date",
  },
  {
    keywords: ["time"],
    label: "Preferred time",
    type: "time",
  },
  {
    keywords: ["resume", "cv"],
    label: "Resume or CV",
    type: "file",
  },
  {
    keywords: ["file upload", "attachment", "document upload"],
    label: "Supporting document",
    type: "file",
  },
  {
    keywords: ["multiple files", "attachments", "supporting documents"],
    label: "Supporting documents",
    type: "multipleFiles",
  },
  {
    keywords: ["signature", "sign"],
    label: "Signature",
    type: "signature",
  },
  {
    keywords: ["photo", "camera", "image evidence"],
    label: "Photo",
    type: "camera",
  },
  {
    keywords: ["rating", "score"],
    label: "Rating",
    type: "rating",
  },
  {
    keywords: ["matrix", "grid question"],
    label: "Evaluation matrix",
    type: "matrix",
  },
  {
    keywords: ["multi-select", "select multiple", "multiple selections"],
    label: "Select all that apply",
    type: "multiSelect",
  },
  {
    keywords: ["budget", "estimated cost"],
    label: "Budget",
    type: "number",
  },
  {
    keywords: ["quantity"],
    label: "Quantity",
    type: "number",
  },
  {
    keywords: ["comments", "comment", "message", "details", "description", "feedback"],
    label: "Additional details",
    type: "longText",
  },
];

const hasPhrase = (value: string, phrase: string) =>
  new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
    value,
  );

const titleCase = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const createField = (
  type: FormFieldType,
  label: string,
  required = false,
): FormField => ({
  id: createId("field"),
  label,
  placeholder:
    type === "shortText" ||
    type === "longText" ||
    type === "email" ||
    type === "phone" ||
    type === "number" ||
    type === "url" ||
    type === "password"
      ? `Enter ${label.toLowerCase()}`
      : undefined,
  required,
  type,
  width: "full",
  config:
    type === "matrix"
      ? { matrixRows: ["Criterion 1", "Criterion 2", "Criterion 3"] }
      : type === "multipleFiles"
        ? { acceptedFileTypes: "any", maxFileSizeMb: 5, maxFiles: 5 }
        : undefined,
  options:
    type === "matrix"
      ? ["Poor", "Fair", "Good", "Excellent"]
      : type === "multiSelect"
        ? ["Option 1", "Option 2", "Option 3"]
        : undefined,
});

const findIntent = (prompt: string) => {
  let best: { intent: Intent; score: number } | null = null;
  intents.forEach((intent) => {
    const score = intent.keywords.reduce(
      (total, keyword) => total + (hasPhrase(prompt, keyword) ? keyword.length : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) best = { intent, score };
  });
  return best?.intent || null;
};

const findHint = (value: string) =>
  fieldHints.find((hint) =>
    hint.keywords.some((keyword) => hasPhrase(value, keyword)),
  );

const fieldExists = (fields: FormField[], hint: FieldHint) => {
  const hintWords = hint.label.toLowerCase().split(/\s+/);
  return fields.some((field) => {
    const label = field.label.toLowerCase();
    return (
      label === hint.label.toLowerCase() ||
      hintWords.some((word) => word.length > 3 && label.includes(word))
    );
  });
};

const extractRequestedSegments = (prompt: string) => {
  const match = prompt.match(
    /(?:include|collect|capture|ask for|fields?)(?:\s+fields?)?\s*:?\s+([^.!?\n]+)/i,
  );
  if (!match?.[1]) return [];
  return match[1]
    .split(/,|\band\b/gi)
    .map((value) =>
      value
        .replace(/\b(required|optional|please|the user'?s?|their|a|an)\b/gi, "")
        .trim(),
    )
    .filter((value) => value.length >= 2 && value.length <= 48)
    .slice(0, 12);
};

const extractTitle = (prompt: string, fallback: string) => {
  const named = prompt.match(
    /\b(?:called|named|titled)\s+["']?([^"',.!?]{2,64})/i,
  )?.[1];
  if (!named) return fallback;
  return titleCase(
    named.replace(/\b(?:with|that|which|including|collecting)\b.*$/i, "").trim(),
  );
};

export function generateFormFromPrompt(
  rawPrompt: string,
  templates: FormTemplate[] = formTemplates,
): GeneratedFormDraft {
  const prompt = rawPrompt.trim();
  const normalized = prompt.toLowerCase();
  const intent = findIntent(normalized);
  const template = intent
    ? templates.find((item) => item.id === intent.templateId)
    : null;
  const fields: FormField[] = template
    ? cloneTemplateFields(template.fields)
    : [];
  const requireEverything =
    /\b(all fields|required fields|everything required)\b/i.test(prompt);

  fieldHints.forEach((hint) => {
    if (
      hint.keywords.some((keyword) => hasPhrase(normalized, keyword)) &&
      !fieldExists(fields, hint)
    ) {
      fields.push(createField(hint.type, hint.label, requireEverything));
    }
  });

  extractRequestedSegments(prompt).forEach((segment) => {
    const hint = findHint(segment);
    if (hint) {
      if (!fieldExists(fields, hint)) {
        fields.push(
          createField(
            hint.type,
            hint.label,
            requireEverything || /\brequired\b/i.test(segment),
          ),
        );
      }
      return;
    }
    const label = titleCase(segment.replace(/\bfield\b/gi, "").trim());
    if (
      label &&
      !fields.some((field) => field.label.toLowerCase() === label.toLowerCase())
    ) {
      fields.push(createField("shortText", label, requireEverything));
    }
  });

  if (fields.length === 0) {
    fields.push(
      createField("shortText", "Full name", true),
      createField("email", "Email address", true),
      createField("longText", "Additional details"),
    );
  }

  if (requireEverything) {
    fields.forEach((field) => {
      if (!["heading", "divider", "section", "pageBreak", "html"].includes(field.type)) {
        field.required = true;
      }
    });
  }

  const fallbackTitle = template?.name || "Custom form";
  const title = extractTitle(prompt, fallbackTitle);
  const paymentRequested =
    Boolean(template?.payment?.enabled) ||
    /\b(payment|checkout|charge|paid|sell|ticket price)\b/i.test(prompt);

  return {
    description:
      template?.description ||
      `Please complete ${title.toLowerCase()} and submit your response.`,
    fields,
    paymentRequested,
    sourceLabel: template ? `Based on ${template.name}` : "Built from your brief",
    title,
  };
}
