import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

type DatabaseRow = Record<string, unknown>;
type DemoField = {
  id: string;
  type: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  width?: "full" | "half";
};

const databaseUrl =
  process.env.DATABASE_URL || "";
if (!databaseUrl) {
  throw new Error("Demo content requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const configuredEmail = String(process.env.DEMO_USER_EMAIL || "").trim();
const paidFormSlug = "maxform-paid-onboarding-demo";
const eventFormSlug = "maxform-summit-registration-2026";
const eventSlug = "maxform-product-summit-2026";

const findOwner = async () => {
  if (configuredEmail) {
    const rows = (await sql.query(
      `SELECT id, email, full_name
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [configuredEmail],
    )) as DatabaseRow[];
    if (rows[0]) return rows[0];
    throw new Error("DEMO_USER_EMAIL does not match a workspace account.");
  }

  const rows = (await sql.query(
    `SELECT user_account.id, user_account.email, user_account.full_name
     FROM users user_account
     WHERE user_account.email NOT LIKE '%@example.test'
       AND EXISTS (
         SELECT 1
         FROM payment_provider_connections connection
         WHERE connection.user_id = user_account.id
           AND connection.provider = 'paystack'
           AND connection.status = 'connected'
           AND connection.health_ok = TRUE
       )
     ORDER BY
       (
         SELECT COUNT(*) FROM forms form_record
         WHERE form_record.created_by = user_account.id
       ) +
       (
         SELECT COUNT(*) FROM events event_record
         WHERE event_record.created_by = user_account.id
       ) DESC,
       user_account.updated_at DESC
     LIMIT 1`,
  )) as DatabaseRow[];
  if (!rows[0]) {
    throw new Error(
      "No workspace with a healthy connected Paystack account was found.",
    );
  }
  return rows[0];
};

const existingId = async (
  table: "events" | "forms",
  ownerId: string,
  slug: string,
) => {
  const rows = (await sql.query(
    `SELECT id FROM ${table} WHERE created_by = $1 AND slug = $2 LIMIT 1`,
    [ownerId, slug],
  )) as DatabaseRow[];
  return String(rows[0]?.id || randomUUID());
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const savePublishedForm = async (input: {
  id: string;
  ownerId: string;
  title: string;
  slug: string;
  description: string;
  fields: DemoField[];
  payment: Record<string, unknown>;
  theme: Record<string, unknown>;
  confirmation: Record<string, unknown>;
}) => {
  const settings = {
    access: { mode: "public", password: "" },
    confirmation: input.confirmation,
    hasUnpublishedChanges: false,
    lifecycle: "active",
    limits: { onePerEmail: false, responseLimit: null },
    logic: [],
    notifications: { enabled: false, recipients: "" },
    payment: input.payment,
    schedule: { closesAt: "", opensAt: "" },
    theme: input.theme,
    version: 1,
  };
  const liveSnapshot = {
    description: input.description,
    fields: input.fields,
    payment: input.payment,
    theme: input.theme,
    title: input.title,
    version: 1,
  };

  await sql.query(
    `INSERT INTO forms (
       id, title, slug, description, fields, settings, status, created_by,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, 'published', $7, NOW(), NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       slug = EXCLUDED.slug,
       description = EXCLUDED.description,
       fields = EXCLUDED.fields,
       settings = EXCLUDED.settings,
       status = 'published',
       updated_at = NOW()`,
    [
      input.id,
      input.title,
      input.slug,
      input.description,
      JSON.stringify(input.fields),
      JSON.stringify(settings),
      input.ownerId,
    ],
  );

  await sql.query(`DELETE FROM form_fields WHERE form_id = $1`, [input.id]);
  for (const [position, field] of input.fields.entries()) {
    await sql.query(
      `INSERT INTO form_fields (
         form_id, field_id, position, field_type, label, placeholder,
         help_text, required, options, width, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW(), NOW()
       )`,
      [
        input.id,
        field.id,
        position,
        field.type,
        field.label,
        field.placeholder || null,
        field.helpText || null,
        Boolean(field.required),
        field.options ? JSON.stringify(field.options) : null,
        field.width || "full",
      ],
    );
  }

  await sql.query(
    `INSERT INTO form_settings (
       form_id, theme, payment, confirmation, notifications, access_control,
       limits_config, schedule, lifecycle, current_version, live_snapshot,
       has_unpublished_changes, created_at, updated_at
     )
     VALUES (
       $1, $2::jsonb, $3::jsonb, $4::jsonb,
       '{"enabled":false,"recipients":""}'::jsonb,
       '{"mode":"public","password":""}'::jsonb,
       '{"responseLimit":null,"onePerEmail":false}'::jsonb,
       '{"opensAt":"","closesAt":""}'::jsonb,
       'active', 1, $5::jsonb, FALSE, NOW(), NOW()
     )
     ON CONFLICT (form_id) DO UPDATE SET
       theme = EXCLUDED.theme,
       payment = EXCLUDED.payment,
       confirmation = EXCLUDED.confirmation,
       notifications = EXCLUDED.notifications,
       access_control = EXCLUDED.access_control,
       limits_config = EXCLUDED.limits_config,
       schedule = EXCLUDED.schedule,
       lifecycle = 'active',
       current_version = 1,
       live_snapshot = EXCLUDED.live_snapshot,
       has_unpublished_changes = FALSE,
       updated_at = NOW()`,
    [
      input.id,
      JSON.stringify(input.theme),
      JSON.stringify(input.payment),
      JSON.stringify(input.confirmation),
      JSON.stringify(liveSnapshot),
    ],
  );

  await sql.query(`DELETE FROM form_versions WHERE form_id = $1`, [input.id]);
  await sql.query(
    `INSERT INTO form_versions (
       form_id, version_id, version_number, published_at, published_by,
       title, description, fields, created_at
     )
     VALUES ($1, $2, 1, NOW(), $3, $4, $5, $6::jsonb, NOW())`,
    [
      input.id,
      `version-${randomUUID()}`,
      input.ownerId,
      input.title,
      input.description,
      JSON.stringify(input.fields),
    ],
  );
};

const saveCoupon = async (input: {
  ownerId: string;
  code: string;
  name: string;
  percentage: number;
  limit: number;
  targets: Array<{ id: string; type: "event" | "form" }>;
}) => {
  const rows = (await sql.query(
    `SELECT id
     FROM payment_coupons
     WHERE user_id = $1 AND UPPER(code) = UPPER($2)
     LIMIT 1`,
    [input.ownerId, input.code],
  )) as DatabaseRow[];
  if (rows[0]) {
    await sql.query(
      `UPDATE payment_coupons
       SET name = $1,
           discount_type = 'percentage',
           discount_value = $2,
           currency = NULL,
           redemption_limit = $3,
           redemption_limit_per_customer = 2,
           minimum_amount = 0,
           starts_at = NOW() - INTERVAL '1 day',
           ends_at = NOW() + INTERVAL '120 days',
           active = TRUE,
           applies_to = $4::jsonb,
           updated_at = NOW()
       WHERE id = $5`,
      [
        input.name,
        input.percentage,
        input.limit,
        JSON.stringify(input.targets),
        rows[0].id,
      ],
    );
    return;
  }
  await sql.query(
    `INSERT INTO payment_coupons (
       user_id, code, name, discount_type, discount_value, currency,
       redemption_limit, redemption_limit_per_customer, minimum_amount,
       starts_at, ends_at, active, applies_to, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'percentage', $4, NULL, $5, 2, 0,
       NOW() - INTERVAL '1 day', NOW() + INTERVAL '120 days', TRUE,
       $6::jsonb, NOW(), NOW()
     )`,
    [
      input.ownerId,
      input.code,
      input.name,
      input.percentage,
      input.limit,
      JSON.stringify(input.targets),
    ],
  );
};

const owner = await findOwner();
const ownerId = String(owner.id);
const ownerEmail = String(owner.email);
const workspaceRows = (await sql.query(
  `SELECT
     COALESCE(NULLIF(company.company_name, ''), $2) AS workspace_name,
     COALESCE(NULLIF(company.brand_color, ''), '#E11D48') AS accent_color,
     COALESCE(company.company_logo_url, '') AS logo_url,
     COALESCE(region.currency, 'NGN') AS currency
   FROM users user_account
   LEFT JOIN company_settings company ON company.user_id = user_account.id
   LEFT JOIN workspace_regional_settings region
     ON region.user_id = user_account.id
   WHERE user_account.id = $1`,
  [ownerId, String(owner.full_name || "MaxForm")],
)) as DatabaseRow[];
const workspace = workspaceRows[0] || {};
const workspaceName = String(workspace.workspace_name || "MaxForm");
const accentColor = String(workspace.accent_color || "#E11D48");
const logoUrl = String(workspace.logo_url || "");
const currency = String(workspace.currency || "NGN").toUpperCase();
const formAmount = currency === "NGN" ? 15_000 : 75;
const generalTicketPrice = currency === "NGN" ? 25_000 : 125;
const vipTicketPrice = currency === "NGN" ? 60_000 : 300;
const studentTicketPrice = currency === "NGN" ? 12_500 : 60;

const paidFormId = await existingId("forms", ownerId, paidFormSlug);
const eventFormId = await existingId("forms", ownerId, eventFormSlug);
const eventId = await existingId("events", ownerId, eventSlug);

const theme = {
  accentColor,
  backgroundColor: "#F7F8FA",
  buttonStyle: "solid",
  coverImageUrl: "/images/form-templates/commerce.webp",
  customCss: "",
  fontFamily: "Inter",
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  logoUrl,
  radius: 6,
  respondentMode: "light",
};
const paidFormFields: DemoField[] = [
  {
    id: "intro",
    type: "heading",
    label: "Start your next project",
    helpText: `${workspaceName} will review your answers before kickoff.`,
  },
  {
    id: "full-name",
    type: "shortText",
    label: "Full name",
    placeholder: "Your first and last name",
    required: true,
    width: "half",
  },
  {
    id: "email",
    type: "email",
    label: "Work email",
    placeholder: "you@company.com",
    required: true,
    width: "half",
  },
  {
    id: "phone",
    type: "phone",
    label: "Phone number",
    required: true,
    width: "half",
  },
  {
    id: "company",
    type: "shortText",
    label: "Company or organization",
    width: "half",
  },
  {
    id: "service",
    type: "dropdown",
    label: "What do you need?",
    options: [
      "Form and workflow setup",
      "Event registration system",
      "Payments and checkout",
      "Custom workspace build",
    ],
    required: true,
    width: "half",
  },
  {
    id: "budget",
    type: "dropdown",
    label: "Estimated project budget",
    options: [
      "Under 500,000",
      "500,000 - 1,500,000",
      "1,500,000 - 5,000,000",
      "Above 5,000,000",
    ],
    required: true,
    width: "half",
  },
  {
    id: "launch-date",
    type: "date",
    label: "Preferred launch date",
    required: true,
    width: "half",
  },
  {
    id: "timeline",
    type: "radio",
    label: "How soon would you like to begin?",
    options: ["Immediately", "Within 2 weeks", "Within a month", "Still planning"],
    required: true,
    width: "half",
  },
  {
    id: "project-summary",
    type: "longText",
    label: "Tell us about the project",
    placeholder: "Goals, audience, required workflows, and success criteria",
    required: true,
  },
  {
    id: "approval",
    type: "yesNo",
    label: "I confirm the information above is accurate",
    required: true,
  },
  {
    id: "signature",
    type: "signature",
    label: "Authorized signature",
    helpText: "Sign to approve this paid discovery request.",
    required: true,
  },
];
const paidFormPayment = {
  allowCoupons: true,
  amount: formAmount,
  currency,
  enabled: true,
  mode: "fixed",
  productId: "",
  provider: "workspace",
};
await savePublishedForm({
  id: paidFormId,
  ownerId,
  title: "Paid client onboarding",
  slug: paidFormSlug,
  description:
    "Share your requirements and reserve a focused discovery session with our team.",
  fields: paidFormFields,
  payment: paidFormPayment,
  theme,
  confirmation: {
    accentColor,
    allowAnotherResponse: false,
    backgroundColor: "#FFFFFF",
    buttonLabel: "Visit workspace",
    buttonUrl: "/",
    icon: "check",
    message:
      "Your payment and project brief were received. Our team will follow up shortly.",
    redirectDelay: 3,
    redirectUrl: "",
    showResponseSummary: true,
    textAlign: "center",
    title: "Discovery session reserved",
    type: "message",
    useModuleDefault: false,
  },
});

const eventFormFields: DemoField[] = [
  {
    id: "registration-heading",
    type: "heading",
    label: "Reserve your summit pass",
    helpText: "Choose a ticket and tell us who will be attending.",
  },
  {
    id: "full-name",
    type: "shortText",
    label: "Full name",
    required: true,
    width: "half",
  },
  {
    id: "email",
    type: "email",
    label: "Email address",
    required: true,
    width: "half",
  },
  {
    id: "phone",
    type: "phone",
    label: "Phone number",
    required: true,
    width: "half",
  },
  {
    id: "company",
    type: "shortText",
    label: "Company",
    width: "half",
  },
  {
    id: "ticket-selection",
    type: "dropdown",
    label: "Choose your ticket",
    options: ["General admission", "VIP experience", "Student pass"],
    required: true,
  },
  {
    id: "sessions",
    type: "checkboxes",
    label: "Which sessions interest you most?",
    options: [
      "Building better customer journeys",
      "Payments without friction",
      "AI-assisted operations",
      "Designing for trust",
    ],
  },
  {
    id: "dietary",
    type: "longText",
    label: "Dietary or accessibility requirements",
    placeholder: "Share anything the event team should prepare for.",
  },
  {
    id: "event-terms",
    type: "yesNo",
    label: "I agree to the event and refund terms",
    required: true,
  },
];
const eventFormPayment = {
  allowCoupons: true,
  amount: 0,
  currency,
  enabled: true,
  mode: "product",
  productId: "",
  provider: "workspace",
};
await savePublishedForm({
  id: eventFormId,
  ownerId,
  title: "MaxForm Product Summit registration",
  slug: eventFormSlug,
  description:
    "Complete your attendee details, choose a ticket, and continue to secure checkout.",
  fields: eventFormFields,
  payment: eventFormPayment,
  theme: {
    ...theme,
    coverImageUrl: "/images/form-templates/events-ticketing.webp",
  },
  confirmation: {
    accentColor,
    allowAnotherResponse: false,
    backgroundColor: "#FFFFFF",
    buttonLabel: "View event",
    buttonUrl: `/event/${ownerId}/${eventSlug}`,
    icon: "mail",
    message:
      "Your registration is confirmed. Your ticket details will be sent to your email.",
    redirectDelay: 3,
    redirectUrl: "",
    showResponseSummary: true,
    textAlign: "center",
    title: "You are going",
    type: "message",
    useModuleDefault: false,
  },
});

const startsOn = addDays(new Date(), 45);
const endsOn = addDays(startsOn, 1);
const startDate = dateOnly(startsOn);
const endDate = dateOnly(endsOn);
const sectionContent = {
  about: {
    heading: "Ideas, systems, and people shaping the next era of work",
    body:
      "A two-day gathering for product leaders, operators, founders, and creators. Expect practical sessions, candid conversations, and useful connections you can take back to your team.",
  },
  agenda: [
    {
      id: "agenda-opening",
      time: "Day 1 - 9:00 AM",
      title: "Opening keynote: products people trust",
      description: "A practical framework for clarity, confidence, and adoption.",
    },
    {
      id: "agenda-journeys",
      time: "Day 1 - 11:00 AM",
      title: "Building better customer journeys",
      description: "Turn fragmented touchpoints into one coherent experience.",
    },
    {
      id: "agenda-payments",
      time: "Day 2 - 10:00 AM",
      title: "Payments without friction",
      description: "Designing secure checkout flows that convert globally.",
    },
    {
      id: "agenda-ai",
      time: "Day 2 - 1:30 PM",
      title: "AI-assisted operations",
      description: "Where automation helps, where judgment matters, and how to combine both.",
    },
  ],
  speakers: [
    {
      id: "speaker-amara",
      name: "Amara Okafor",
      role: "VP Product, Northstar",
      bio: "Product leader focused on trustworthy systems and emerging markets.",
      imageUrl: "",
    },
    {
      id: "speaker-david",
      name: "David Mensah",
      role: "Founder, Relay Labs",
      bio: "Operator and founder building practical infrastructure for growing teams.",
      imageUrl: "",
    },
    {
      id: "speaker-zainab",
      name: "Zainab Bello",
      role: "Design Director, Assembly",
      bio: "Design leader helping complex products become clear and humane.",
      imageUrl: "",
    },
  ],
  sponsors: [
    {
      id: "sponsor-maxform",
      name: workspaceName,
      website: "",
      logoUrl,
    },
    {
      id: "sponsor-paystack",
      name: "Paystack",
      website: "https://paystack.com",
      logoUrl: "/logos/paystack.jpeg",
    },
  ],
  faq: [
    {
      id: "faq-ticket",
      question: "When will I receive my ticket?",
      answer: "Your unique ticket is issued after checkout is confirmed.",
    },
    {
      id: "faq-transfer",
      question: "Can I transfer my ticket?",
      answer: "Yes. Contact the event team before the transfer deadline.",
    },
    {
      id: "faq-refund",
      question: "What is the refund policy?",
      answer: "Refunds are available up to seven days before the event.",
    },
  ],
  venue: {
    name: "Harbour Conference Centre",
    address: "Victoria Island, Lagos, Nigeria",
    directions: "Arrival and parking instructions will be emailed to registered guests.",
    mapUrl: "https://maps.google.com/?q=Victoria+Island+Lagos",
  },
};
const branding = {
  accentColor,
  backgroundColor: "#F4F7F6",
  borderColor: "#D8E2DF",
  bodyFontSize: "medium",
  buttonTextColor: "#FFFFFF",
  contentWidth: "wide",
  cornerRadius: 8,
  coverImageUrl: "/images/form-templates/events-ticketing.webp",
  fontFamily: "Inter",
  headingFontFamily: "Inter",
  headingWeight: 700,
  heroAlignment: "left",
  heroBackgroundColor: "#102A27",
  heroHeight: "standard",
  heroOverlayOpacity: 45,
  heroTextColor: "#FFFFFF",
  logoUrl,
  mutedTextColor: "#5C6E69",
  surfaceColor: "#FFFFFF",
  textColor: "#142521",
};
const seo = {
  description:
    "Join product leaders and operators for two days of practical sessions in Lagos.",
  shareImageUrl: "/images/form-templates/events-ticketing.webp",
  title: "MaxForm Product Summit 2026",
};
const dailySchedule = [
  { date: startDate, startTime: "09:00", endTime: "17:30" },
  { date: endDate, startTime: "09:30", endTime: "16:30" },
];

await sql.query(
  `INSERT INTO events (
     id, created_by, registration_form_id, template_id, title, slug,
     description, status, location_type, venue_name, address, online_url,
     starts_at, ends_at, timezone, branding, public_sections, seo,
     capacity_total, refund_policy, refund_window_hours, access_control,
     waitlist_enabled, settings, published_at, updated_at, created_at,
     ticketing_enabled, ticket_prefix, ticket_prefix_configured,
     section_content, schedule_type, range_start_date, range_end_date,
     range_schedule_mode, schedule_start_time, schedule_end_time,
     daily_schedule
   )
   VALUES (
     $1, $2, $3, 'conference-summit', 'MaxForm Product Summit 2026', $4,
     'A two-day product, design, operations, and technology summit in Lagos.',
     'on_sale', 'physical', 'Harbour Conference Centre',
     'Victoria Island, Lagos, Nigeria', '',
     $5::timestamptz, $6::timestamptz, 'Africa/Lagos',
     $7::jsonb, $8::jsonb, $9::jsonb, 300,
     'Full refunds are available until seven days before the event.',
     168, 'public', TRUE,
     '{"collectLeads":true,"leadListName":"Summit attendees"}'::jsonb,
     NOW(), NOW(), NOW(), TRUE, 'MFS-', TRUE, $10::jsonb,
     'date_range', $11::date, $12::date, 'daily', '09:00', '16:30',
     $13::jsonb
   )
   ON CONFLICT (id) DO UPDATE SET
     registration_form_id = EXCLUDED.registration_form_id,
     template_id = EXCLUDED.template_id,
     title = EXCLUDED.title,
     slug = EXCLUDED.slug,
     description = EXCLUDED.description,
     status = 'on_sale',
     location_type = EXCLUDED.location_type,
     venue_name = EXCLUDED.venue_name,
     address = EXCLUDED.address,
     online_url = EXCLUDED.online_url,
     starts_at = EXCLUDED.starts_at,
     ends_at = EXCLUDED.ends_at,
     timezone = EXCLUDED.timezone,
     branding = EXCLUDED.branding,
     public_sections = EXCLUDED.public_sections,
     seo = EXCLUDED.seo,
     capacity_total = EXCLUDED.capacity_total,
     refund_policy = EXCLUDED.refund_policy,
     refund_window_hours = EXCLUDED.refund_window_hours,
     access_control = EXCLUDED.access_control,
     waitlist_enabled = EXCLUDED.waitlist_enabled,
     settings = EXCLUDED.settings,
     published_at = COALESCE(events.published_at, NOW()),
     updated_at = NOW(),
     ticketing_enabled = TRUE,
     ticket_prefix = EXCLUDED.ticket_prefix,
     ticket_prefix_configured = TRUE,
     section_content = EXCLUDED.section_content,
     schedule_type = EXCLUDED.schedule_type,
     range_start_date = EXCLUDED.range_start_date,
     range_end_date = EXCLUDED.range_end_date,
     range_schedule_mode = EXCLUDED.range_schedule_mode,
     schedule_start_time = EXCLUDED.schedule_start_time,
     schedule_end_time = EXCLUDED.schedule_end_time,
     daily_schedule = EXCLUDED.daily_schedule`,
  [
    eventId,
    ownerId,
    eventFormId,
    eventSlug,
    `${startDate}T09:00:00+01:00`,
    `${endDate}T16:30:00+01:00`,
    JSON.stringify(branding),
    JSON.stringify(["about", "agenda", "speakers", "sponsors", "faq", "venue"]),
    JSON.stringify(seo),
    JSON.stringify(sectionContent),
    startDate,
    endDate,
    JSON.stringify(dailySchedule),
  ],
);

await sql.query(`DELETE FROM event_sessions WHERE event_id = $1`, [eventId]);
for (const [index, session] of [
  {
    title: "Opening keynote: products people trust",
    description: "A practical framework for clarity, confidence, and adoption.",
    start: `${startDate}T09:00:00+01:00`,
    end: `${startDate}T10:00:00+01:00`,
    location: "Main stage",
  },
  {
    title: "Building better customer journeys",
    description: "A workshop for mapping and improving complete service journeys.",
    start: `${startDate}T11:00:00+01:00`,
    end: `${startDate}T12:30:00+01:00`,
    location: "Studio A",
  },
  {
    title: "Payments without friction",
    description: "Secure checkout architecture for global products.",
    start: `${endDate}T10:00:00+01:00`,
    end: `${endDate}T11:15:00+01:00`,
    location: "Main stage",
  },
  {
    title: "AI-assisted operations",
    description: "A practical operating model for people and automation.",
    start: `${endDate}T13:30:00+01:00`,
    end: `${endDate}T15:00:00+01:00`,
    location: "Studio B",
  },
].entries()) {
  await sql.query(
    `INSERT INTO event_sessions (
       event_id, title, description, starts_at, ends_at, capacity,
       location, sort_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 300, $6, $7, NOW(), NOW())`,
    [
      eventId,
      session.title,
      session.description,
      session.start,
      session.end,
      session.location,
      index,
    ],
  );
}

await sql.query(`DELETE FROM event_ticket_types WHERE event_id = $1`, [eventId]);
const ticketTypeRows: DatabaseRow[] = [];
for (const [index, ticket] of [
  {
    name: "General admission",
    description: "Two-day access, sessions, lunch, and networking.",
    price: generalTicketPrice,
    quantity: 180,
    color: accentColor,
  },
  {
    name: "VIP experience",
    description: "Priority seating, speaker lounge, dinner, and all general benefits.",
    price: vipTicketPrice,
    quantity: 60,
    color: "#111827",
  },
  {
    name: "Student pass",
    description: "Full summit access for currently enrolled students.",
    price: studentTicketPrice,
    quantity: 60,
    color: "#2563EB",
  },
].entries()) {
  const rows = (await sql.query(
    `INSERT INTO event_ticket_types (
       event_id, name, description, price, currency, quantity_available,
       min_per_order, max_per_order, group_multiplier, sales_start,
       sales_end, waitlist_enabled, color, active, sort_order,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, 1, 6, 1, NOW() - INTERVAL '1 day',
       $7::timestamptz, TRUE, $8, TRUE, $9, NOW(), NOW()
     )
     RETURNING id, name`,
    [
      eventId,
      ticket.name,
      ticket.description,
      ticket.price,
      currency,
      ticket.quantity,
      `${startDate}T08:00:00+01:00`,
      ticket.color,
      index,
    ],
  )) as DatabaseRow[];
  ticketTypeRows.push(rows[0]);
}

await sql.query(`DELETE FROM event_ticket_designs WHERE event_id = $1`, [eventId]);
await sql.query(
  `INSERT INTO event_ticket_designs (
     event_id, ticket_type_id, template_id, front_layout, back_layout,
     barcode_format, output_formats, created_at, updated_at
   )
   SELECT $1, NULL, template.id, template.front_layout, template.back_layout,
     'qr', '["digital","pdf"]'::jsonb, NOW(), NOW()
   FROM event_ticket_design_templates template
   WHERE template.id = 'summit-grid'
   LIMIT 1`,
  [eventId],
);

await sql.query(
  `INSERT INTO event_pricing (
     event_id, enabled, amount, currency, label, tax_included,
     discounts_enabled, created_at, updated_at
   )
   VALUES ($1, FALSE, 0, $2, 'Registration fee', TRUE, TRUE, NOW(), NOW())
   ON CONFLICT (event_id) DO UPDATE SET
     enabled = FALSE,
     amount = 0,
     currency = EXCLUDED.currency,
     label = EXCLUDED.label,
     tax_included = TRUE,
     discounts_enabled = TRUE,
     updated_at = NOW()`,
  [eventId, currency],
);

await sql.query(`DELETE FROM event_discount_rules WHERE event_id = $1`, [eventId]);
await sql.query(
  `INSERT INTO event_discount_rules (
     event_id, name, mode, value_type, discount_value, first_n,
     min_quantity, promo_code, redemption_limit, active, sort_order,
     created_at, updated_at
   )
   VALUES
     ($1, 'Early access', 'first_n', 'percentage', 15, 50, 1, '',
      50, TRUE, 0, NOW(), NOW()),
     ($1, 'Team booking', 'group_size', 'percentage', 10, 0, 4, '',
      NULL, TRUE, 1, NOW(), NOW()),
     ($1, 'Launch offer', 'promo_code', 'percentage', 20, 0, 1,
      'BUILD2026', 100, TRUE, 2, NOW(), NOW())`,
  [eventId],
);

const couponTargets = [
  { id: paidFormId, type: "form" as const },
  { id: eventId, type: "event" as const },
];
await saveCoupon({
  ownerId,
  code: "WELCOME20",
  name: "Demo checkout - 20% off",
  percentage: 20,
  limit: 200,
  targets: couponTargets,
});
await saveCoupon({
  ownerId,
  code: "TEST100",
  name: "Demo checkout - free completion",
  percentage: 100,
  limit: 25,
  targets: couponTargets,
});

const checks = (await sql.query(
  `SELECT
     (SELECT COUNT(*) FROM form_fields WHERE form_id = $1)::int AS form_fields,
     (SELECT COUNT(*) FROM form_fields WHERE form_id = $2)::int AS event_fields,
     (SELECT COUNT(*) FROM event_ticket_types
      WHERE event_id = $3 AND active = TRUE)::int AS ticket_types,
     (SELECT COUNT(*) FROM event_sessions WHERE event_id = $3)::int AS sessions,
     (SELECT COUNT(*) FROM event_discount_rules
      WHERE event_id = $3 AND active = TRUE)::int AS discounts,
     (SELECT COUNT(*) FROM payment_provider_connections
      WHERE user_id = $4 AND provider = 'paystack'
        AND status = 'connected' AND health_ok = TRUE)::int AS paystack`,
  [paidFormId, eventFormId, eventId, ownerId],
)) as DatabaseRow[];
const check = checks[0] || {};
if (
  Number(check.form_fields) !== paidFormFields.length ||
  Number(check.event_fields) !== eventFormFields.length ||
  Number(check.ticket_types) !== 3 ||
  Number(check.sessions) !== 4 ||
  Number(check.discounts) !== 3 ||
  Number(check.paystack) !== 1
) {
  throw new Error("Demo content verification did not pass.");
}

console.log(
  JSON.stringify(
    {
      currency,
      event: `/event/${ownerId}/${eventSlug}`,
      eventId,
      form: `/forms/${ownerId}/${paidFormSlug}`,
      formId: paidFormId,
      owner: ownerEmail.replace(/(^.).*(@.*$)/, "$1***$2"),
      paystack: "connected-test-account",
      testCoupons: ["WELCOME20", "TEST100"],
      ticketTypes: ticketTypeRows.map((row) => row.name),
      verified: true,
      workspace: workspaceName,
    },
    null,
    2,
  ),
);
