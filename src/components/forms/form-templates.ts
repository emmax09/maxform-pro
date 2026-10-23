import {
  createId,
  type FormField,
  type FormFieldType,
  type FormTemplate,
} from "./form-types";

const field = (
  type: FormFieldType,
  label: string,
  options: Partial<FormField> = {},
): FormField => ({
  id: createId("template-field"),
  label,
  type,
  ...options,
});

const contactFields = () => [
  field("shortText", "Full name", { required: true }),
  field("email", "Email address", { required: true }),
  field("phone", "Phone number"),
  field("longText", "How can we help?", {
    placeholder: "Tell us what you need",
    required: true,
  }),
];

export const formTemplates: FormTemplate[] = [
  {
    id: "contact-form",
    group: "Lead & feedback",
    name: "Contact form",
    description: "Capture qualified inquiries and route them to your team.",
    fields: contactFields(),
  },
  {
    id: "customer-feedback",
    group: "Lead & feedback",
    name: "Customer feedback (NPS)",
    description: "Measure sentiment and collect actionable comments.",
    fields: [
      field("rating", "How likely are you to recommend us?", {
        required: true,
        validation: { min: 0, max: 10 },
      }),
      field("longText", "What is the main reason for your score?"),
      field("email", "Email address"),
    ],
  },
  {
    id: "survey-research",
    group: "Lead & feedback",
    name: "Survey / research",
    description: "Run structured research with choice and ranking questions.",
    fields: [
      field("shortText", "Participant name"),
      field("radio", "How often do you use this product?", {
        options: ["Daily", "Weekly", "Monthly", "Rarely"],
        required: true,
      }),
      field("ranking", "Rank what matters most", {
        options: ["Ease of use", "Price", "Support", "Features"],
      }),
      field("longText", "Anything else we should know?"),
    ],
  },
  {
    id: "job-application",
    group: "People & hiring",
    name: "Job application",
    description: "Collect candidate details, experience, and documents.",
    fields: [
      field("shortText", "Full name", { required: true }),
      field("email", "Email address", { required: true }),
      field("dropdown", "Role", {
        options: ["Design", "Engineering", "Marketing", "Operations"],
        required: true,
      }),
      field("url", "Portfolio or LinkedIn"),
      field("file", "Resume", { required: true }),
      field("longText", "Why would you like to join us?"),
    ],
  },
  {
    id: "employee-onboarding",
    group: "People & hiring",
    name: "Employee onboarding",
    description: "Gather the essentials before a new teammate starts.",
    fields: [
      field("shortText", "Legal name", { required: true }),
      field("email", "Personal email", { required: true }),
      field("date", "Start date", { required: true }),
      field("shortText", "Emergency contact"),
      field("file", "Identity document"),
      field("signature", "Policy acknowledgement", { required: true }),
    ],
  },
  {
    id: "reference-request",
    group: "People & hiring",
    name: "Reference request",
    description: "Collect consistent and confidential reference feedback.",
    fields: [
      field("shortText", "Candidate name", { required: true }),
      field("shortText", "Referee name", { required: true }),
      field("email", "Referee email", { required: true }),
      field("rating", "Overall recommendation", { required: true }),
      field("longText", "Comments"),
    ],
  },
  {
    id: "order-form",
    group: "Commerce",
    name: "Order form",
    description: "Sell products with quantity, coupons, and payment.",
    fields: [
      field("shortText", "Customer name", { required: true }),
      field("email", "Email address", { required: true }),
      field("product", "Choose a product", {
        options: ["Starter", "Professional", "Business"],
        required: true,
      }),
      field("number", "Quantity", {
        required: true,
        validation: { min: 1 },
      }),
      field("coupon", "Coupon code"),
    ],
    payment: { enabled: true, mode: "product" },
  },
  {
    id: "product-preorder",
    group: "Commerce",
    name: "Product pre-order",
    description: "Validate demand and take deposits before launch.",
    fields: [
      field("shortText", "Customer name", { required: true }),
      field("email", "Email address", { required: true }),
      field("imageChoice", "Choose your edition", {
        options: ["Standard", "Limited", "Collector"],
        required: true,
      }),
      field("number", "Quantity", { required: true }),
    ],
    payment: { enabled: true, mode: "fixed", amount: 25 },
  },
  {
    id: "invoice-request",
    group: "Commerce",
    name: "Invoice request",
    description: "Collect billing details and the requested line items.",
    fields: [
      field("shortText", "Company name", { required: true }),
      field("email", "Billing email", { required: true }),
      field("longText", "Items or services", { required: true }),
      field("number", "Expected amount"),
      field("file", "Purchase order"),
    ],
  },
  {
    id: "event-registration",
    group: "Events & ticketing",
    name: "Event registration",
    description: "Register attendees and capture event preferences.",
    fields: [
      field("shortText", "Attendee name", { required: true }),
      field("email", "Email address", { required: true }),
      field("dropdown", "Ticket type", {
        options: ["General", "VIP", "Student"],
        required: true,
      }),
      field("checkboxes", "Sessions", {
        options: ["Opening keynote", "Product lab", "Founder Q&A"],
      }),
      field("yesNo", "Dietary requirements?"),
      field("longText", "Dietary notes"),
    ],
  },
  {
    id: "ticketed-event",
    group: "Events & ticketing",
    name: "Ticketed event checkout",
    description: "Sell event admission and create paid registrations.",
    fields: [
      field("shortText", "Attendee name", { required: true }),
      field("email", "Email address", { required: true }),
      field("product", "Ticket", {
        options: ["General admission", "VIP pass", "Group pass"],
        required: true,
      }),
      field("coupon", "Promo code"),
    ],
    payment: { enabled: true, mode: "product" },
  },
  {
    id: "event-waitlist",
    group: "Events & ticketing",
    name: "Waitlist",
    description: "Capture demand after registrations reach capacity.",
    fields: [
      field("shortText", "Full name", { required: true }),
      field("email", "Email address", { required: true }),
      field("number", "Number of seats", { required: true }),
      field("yesNo", "Notify me about future events"),
    ],
  },
  {
    id: "event-rsvp",
    group: "Events & ticketing",
    name: "RSVP",
    description: "Collect attendance and guest details quickly.",
    fields: [
      field("shortText", "Guest name", { required: true }),
      field("yesNo", "Will you attend?", { required: true }),
      field("number", "Additional guests"),
      field("longText", "Message for the host"),
    ],
  },
  {
    id: "booking-request",
    group: "Scheduling",
    name: "Booking request",
    description: "Collect preferred dates before confirming a booking.",
    fields: [
      field("shortText", "Full name", { required: true }),
      field("email", "Email address", { required: true }),
      field("dateRange", "Preferred date range", { required: true }),
      field("time", "Preferred time"),
      field("longText", "Booking details"),
    ],
  },
  {
    id: "consultation-intake",
    group: "Scheduling",
    name: "Consultation intake",
    description: "Qualify clients before they select an appointment.",
    fields: [
      field("shortText", "Full name", { required: true }),
      field("email", "Email address", { required: true }),
      field("dropdown", "Topic", {
        options: ["Strategy", "Implementation", "Support"],
        required: true,
      }),
      field("longText", "What would you like to accomplish?"),
      field("appointment", "Choose a time", { required: true }),
    ],
  },
  {
    id: "internal-request",
    group: "Operations",
    name: "Internal request / approval",
    description: "Standardize requests and capture approval context.",
    fields: [
      field("shortText", "Requester", { required: true }),
      field("dropdown", "Department", {
        options: ["Finance", "People", "IT", "Operations"],
      }),
      field("longText", "Request", { required: true }),
      field("number", "Estimated cost"),
      field("file", "Supporting document"),
    ],
  },
  {
    id: "incident-report",
    group: "Operations",
    name: "Incident report",
    description: "Document incidents with evidence and follow-up details.",
    fields: [
      field("date", "Incident date", { required: true }),
      field("time", "Incident time"),
      field("dropdown", "Severity", {
        options: ["Low", "Medium", "High", "Critical"],
        required: true,
      }),
      field("longText", "What happened?", { required: true }),
      field("camera", "Photo evidence"),
    ],
  },
  {
    id: "vendor-intake",
    group: "Operations",
    name: "Vendor intake",
    description: "Collect company, compliance, and payment information.",
    fields: [
      field("shortText", "Company name", { required: true }),
      field("email", "Primary contact email", { required: true }),
      field("url", "Company website"),
      field("longText", "Services provided", { required: true }),
      field("file", "Compliance documents"),
      field("signature", "Authorized signature", { required: true }),
    ],
  },
];

export const templateGroups = Array.from(
  new Set(formTemplates.map((template) => template.group)),
);

export function cloneTemplateFields(fields: FormField[]) {
  return fields.map((item) => ({
    ...item,
    id: createId("field"),
    options: item.options ? [...item.options] : undefined,
    validation: item.validation ? { ...item.validation } : undefined,
    config: item.config
      ? {
          ...item.config,
          optionImages: item.config.optionImages
            ? { ...item.config.optionImages }
            : undefined,
          optionPrices: item.config.optionPrices
            ? { ...item.config.optionPrices }
            : undefined,
        }
      : undefined,
  }));
}
