# Form Module Database Schema Documentation

## Overview

The Form Module uses a **database-as-source-of-truth** architecture where all form definitions, fields, settings, logic rules, themes, and configurations are stored in PostgreSQL tables. The application reads directly from and writes directly to the database, with no local caching or alternative storage mechanisms.

## Core Design Principles

1. **JSONB-First Approach**: Complex nested data structures (fields, settings, logic) are stored as JSONB columns for flexibility and queryability
2. **Single Source of Truth**: Database is the authoritative source for all form data
3. **Version Control**: Forms support versioning with snapshots stored in JSONB
4. **Relational Integrity**: Foreign key constraints ensure data consistency
5. **Audit Trail**: Timestamps and user references track all changes

## Database Tables

### 1. `forms` - Core Form Definitions

The central table storing all form metadata, field definitions, and settings.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, unique form identifier |
| `project_id` | UUID | Optional project grouping (FK to projects table) |
| `slug` | VARCHAR(120) | Unique URL-friendly identifier for public access |
| `title` | VARCHAR(255) | Display title of the form |
| `description` | TEXT | Optional description shown to respondents |
| `fields` | JSONB | Array of form field definitions |
| `settings` | JSONB | Object containing all form configuration |
| `status` | VARCHAR(50) | Lifecycle status: `draft`, `published`, `archived` |
| `created_by` | UUID | User who created the form (FK to users table) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last modification timestamp |

#### Indexes

```sql
-- Primary lookup indexes
CREATE UNIQUE INDEX idx_forms_slug ON forms(slug);
CREATE INDEX idx_forms_project_id ON forms(project_id);
CREATE INDEX idx_forms_created_by_status ON forms(created_by, status);
CREATE INDEX idx_forms_status_updated_at ON forms(status, updated_at DESC);

-- JSONB search indexes
CREATE INDEX idx_forms_fields_gin ON forms USING gin(fields);
CREATE INDEX idx_forms_settings_gin ON forms USING gin(settings);
```

---

### 2. `forms.fields` - Form Field Definitions (JSONB)

Each form has a `fields` JSONB column containing an array of field objects.

#### Field Object Structure

```typescript
{
  id: string;              // Unique field identifier (e.g., "field-abc123")
  type: FormFieldType;     // Field type (see types below)
  label: string;           // Display label shown to users
  placeholder?: string;    // Input placeholder text
  helpText?: string;       // Help description below field
  required?: boolean;      // Whether field must be answered
  options?: string[];      // Choice options for select/radio/checkbox fields
  defaultValue?: string;   // Pre-populated default value
  formula?: string;        // Calculation formula for calculated fields
  width?: "full" | "half"; // Layout width
  validation?: {           // Validation rules
    min?: number;         // Minimum value/length
    max?: number;         // Maximum value/length
    pattern?: string;     // Regex pattern
  };
}
```

#### Supported Field Types

**Text Input Fields**
- `shortText` - Single-line text input
- `longText` - Multi-line textarea
- `email` - Email address with validation
- `phone` - Phone number input
- `number` - Numeric input
- `url` - URL with validation

**Choice Fields**
- `dropdown` - Select dropdown menu
- `radio` - Radio button group
- `checkboxes` - Multiple checkboxes
- `yesNo` - Boolean yes/no toggle
- `rating` - Star/numeric rating
- `ranking` - Order items by preference

**Date & Time Fields**
- `date` - Date picker
- `time` - Time picker
- `dateRange` - Start and end date
- `appointment` - Calendar appointment booking

**Media Fields**
- `file` - File upload
- `imageChoice` - Select from image options
- `signature` - Digital signature canvas
- `camera` - Take photo with device camera

**Structure Fields**
- `section` - Visual section divider with heading
- `pageBreak` - Multi-page form separator
- `heading` - Text heading element
- `divider` - Horizontal line separator

**Commerce Fields**
- `payment` - Payment integration field
- `product` - Product selection with pricing
- `coupon` - Coupon code input

**Identity/Hidden Fields**
- `hidden` - Hidden field with value
- `calculated` - Auto-calculated based on formula

#### Example Field Array

```json
[
  {
    "id": "field-name-001",
    "type": "shortText",
    "label": "What is your name?",
    "placeholder": "Enter your full name",
    "required": true,
    "width": "full"
  },
  {
    "id": "field-email-002",
    "type": "email",
    "label": "Email address",
    "required": true,
    "width": "half"
  },
  {
    "id": "field-country-003",
    "type": "dropdown",
    "label": "Country",
    "options": ["United States", "Canada", "United Kingdom"],
    "required": false,
    "width": "half"
  }
]
```

---

### 3. `forms.settings` - Form Configuration (JSONB)

The `settings` JSONB column contains multiple configuration sections.

#### Complete Settings Structure

```typescript
{
  // CONDITIONAL LOGIC RULES
  logic: [
    {
      id: string;              // Unique rule identifier
      sourceFieldId: string;   // Field to evaluate
      operator: string;        // Comparison operator (see operators below)
      value: string;          // Value to compare against
      action: string;         // Action to perform (see actions below)
      targetFieldId: string;  // Field to apply action to
    }
  ],
  
  // THEME & STYLING
  theme: {
    accentColor: string;        // Primary brand color (hex)
    backgroundColor: string;    // Form background color (hex)
    fontFamily: string;        // Typography font name
    fontSize: number;          // Base font size in pixels
    fontWeight: number;        // Font weight (300-800)
    lineHeight: number;        // Line height multiplier
    radius: number;            // Border radius in pixels
    buttonStyle: string;       // "solid" | "outline" | "soft"
    respondentMode: string;    // "auto" | "light" | "dark"
    coverImageUrl: string;     // Optional cover image URL
    logoUrl: string;           // Optional logo URL
    customCss: string;         // Custom CSS overrides
  },
  
  // PAYMENT CONFIGURATION
  payment: {
    enabled: boolean;          // Whether payment is required
    mode: string;             // "fixed" | "variable" | "product"
    provider: string;         // "workspace" | "stripe" | "paystack" | "flutterwave" | "opay"
    amount: number;           // Payment amount (for fixed mode)
    currency: string;         // ISO currency code
    allowCoupons: boolean;    // Whether coupon codes are accepted
  },
  
  // CONFIRMATION SETTINGS
  confirmation: {
    type: string;             // "message" | "redirect"
    message: string;          // Thank you message
    redirectUrl: string;      // URL for redirect type
  },
  
  // NOTIFICATION SETTINGS
  notifications: {
    enabled: boolean;         // Whether to send notifications
    recipients: string;       // Comma-separated email addresses
  },
  
  // ACCESS CONTROL
  access: {
    mode: string;            // "public" | "password" | "authenticated"
    password: string;        // Password for protected forms
  },
  
  // RESPONSE LIMITS
  limits: {
    responseLimit: number | null;  // Max responses (null = unlimited)
    onePerEmail: boolean;          // Limit one response per email
  },
  
  // SCHEDULING
  schedule: {
    opensAt: string;         // ISO timestamp when form opens
    closesAt: string;        // ISO timestamp when form closes
  },
  
  // LIFECYCLE & VERSIONING
  lifecycle: string;         // "active" | "paused"
  version: number;          // Current version number
  versions: [               // Version history
    {
      id: string;
      version: number;
      publishedAt: string;
      publishedBy: string;
      fields: FormField[];
      title: string;
      description: string;
    }
  ],
  liveSnapshot: {           // Currently published version
    fields: FormField[];
    theme: object;
    payment: object;
    version: number;
    title: string;
    description: string;
  } | null,
  hasUnpublishedChanges: boolean;
  archivedFromStatus?: string;  // Original status before archiving
}
```

#### Logic Rule Operators

- `equals` - Exact match
- `not_equals` - Does not match
- `contains` - String contains substring
- `greater_than` - Numeric greater than
- `less_than` - Numeric less than
- `is_answered` - Field has any value

#### Logic Rule Actions

- `show` - Show target field
- `hide` - Hide target field
- `require` - Make target field required
- `skip_to` - Jump to target field (for multi-page forms)

---

### 4. `form_submissions` - Response Data

Stores all form responses submitted by users.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, unique submission identifier |
| `form_id` | UUID | Reference to parent form (FK to forms table) |
| `data` | JSONB | Complete submission data including all answers |
| `submitted_by` | UUID | Optional user ID for authenticated submissions |
| `submitted_at` | TIMESTAMP | Submission timestamp |
| `ip_address` | VARCHAR(45) | IP address of submitter |
| `user_agent` | TEXT | Browser user agent string |

#### Submission Data Structure (JSONB)

```json
{
  "field-name-001": "John Doe",
  "field-email-002": "john@example.com",
  "field-country-003": "United States",
  "field-interests-004": ["Technology", "Design"],
  "_meta": {
    "status": "completed",
    "formVersion": 1,
    "paymentStatus": "pending",
    "referrer": "https://example.com",
    "utm": {
      "source": "google",
      "medium": "cpc",
      "campaign": "spring-2024"
    }
  }
}
```

The `_meta` object contains submission metadata:
- `status`: `"completed"` or `"partial"`
- `formVersion`: Version of form used when submitted
- `paymentStatus`: Payment state if payment enabled
- `referrer`: Referrer URL
- `utm`: UTM tracking parameters

#### Indexes

```sql
CREATE INDEX idx_form_submissions_form_id ON form_submissions(form_id);
CREATE INDEX idx_form_submissions_submitted_at ON form_submissions(submitted_at DESC);
CREATE INDEX idx_form_submissions_form_created ON form_submissions(form_id, submitted_at DESC);
CREATE INDEX idx_form_submissions_data_gin ON form_submissions USING gin(data);
```

---

### 5. `workflows` - Automation Rules

Automation rules triggered by form events (e.g., email notifications, webhooks).

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `form_id` | UUID | Reference to parent form |
| `name` | VARCHAR(255) | Workflow display name |
| `trigger_event` | VARCHAR(100) | Event that triggers workflow |
| `actions` | JSONB | Array of action definitions |
| `enabled` | BOOLEAN | Whether workflow is active |
| `created_by` | UUID | User who created workflow |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last modification timestamp |

#### Workflow Actions Structure (JSONB)

```json
[
  {
    "type": "send_email",
    "to": "recipient@example.com",
    "subject": "New form submission",
    "template": "notification"
  },
  {
    "type": "webhook",
    "url": "https://api.example.com/webhook",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token"
    }
  },
  {
    "type": "create_contact",
    "emailField": "field-email-002",
    "nameField": "field-name-001"
  }
]
```

#### Indexes

```sql
CREATE INDEX idx_workflows_form_id ON workflows(form_id);
CREATE INDEX idx_workflows_actions_gin ON workflows USING gin(actions);
```

---

### 6. `payments` - Payment Transactions

Payment records associated with form submissions.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `submission_id` | UUID | Reference to form submission |
| `amount` | DECIMAL(10,2) | Payment amount |
| `currency` | VARCHAR(10) | ISO currency code (USD, EUR, etc.) |
| `provider` | VARCHAR(50) | Payment provider used |
| `transaction_id` | VARCHAR(255) | External transaction ID |
| `status` | VARCHAR(50) | Payment status |
| `payment_date` | TIMESTAMP | When payment was processed |
| `created_at` | TIMESTAMP | Record creation timestamp |

#### Payment Statuses

- `pending` - Payment initiated but not completed
- `completed` - Payment successfully processed
- `failed` - Payment attempt failed
- `refunded` - Payment was refunded

#### Supported Payment Providers

- `stripe` - Stripe payments
- `paystack` - Paystack (African markets)
- `flutterwave` - Flutterwave (African markets)
- `opay` - OPay (Nigerian market)

#### Indexes

```sql
CREATE INDEX idx_payments_submission_id ON payments(submission_id);
CREATE INDEX idx_payments_status_date ON payments(status, payment_date DESC);
```

---

### 7. `form_module_preferences` - User Preferences

User-specific default settings for new forms.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | User reference (unique) |
| `preferences` | JSONB | Preference settings |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last modification timestamp |

#### Preferences Structure (JSONB)

```json
{
  "accentColor": "#F93D0A",
  "accessMode": "public",
  "confirmationMessage": "Thanks. Your response has been received.",
  "fontFamily": "Inter",
  "notificationsEnabled": true,
  "notificationRecipients": "user@example.com",
  "respondentMode": "auto"
}
```

These preferences are applied as defaults when users create new forms.

#### Indexes

```sql
CREATE INDEX idx_form_module_preferences_user_id ON form_module_preferences(user_id);
```

---

## Common Query Patterns

### Get all forms with response counts

```sql
SELECT 
  f.*,
  (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id) as response_count
FROM forms f
WHERE f.created_by = 'user-uuid'
ORDER BY f.updated_at DESC;
```

### Get form submissions with metadata

```sql
SELECT 
  s.*,
  s.data->'_meta'->>'status' as submission_status,
  s.data->'_meta'->>'formVersion' as form_version
FROM form_submissions s
WHERE s.form_id = 'form-uuid'
ORDER BY s.submitted_at DESC;
```

### Find forms with specific field types

```sql
SELECT f.id, f.title, field->>'label' as field_label
FROM forms f,
     jsonb_array_elements(f.fields) as field
WHERE field->>'type' = 'payment'
  AND f.status = 'published';
```

### Find forms with conditional logic

```sql
SELECT f.id, f.title,
       jsonb_array_length(f.settings->'logic') as logic_rule_count
FROM forms f
WHERE jsonb_array_length(f.settings->'logic') > 0;
```

### Get payment-enabled forms

```sql
SELECT f.id, f.title,
       f.settings->'payment'->>'provider' as payment_provider,
       (f.settings->'payment'->>'amount')::numeric as amount,
       f.settings->'payment'->>'currency' as currency
FROM forms f
WHERE (f.settings->'payment'->>'enabled')::boolean = true
  AND f.status = 'published';
```

### Get forms by lifecycle state

```sql
-- Published and active
SELECT * FROM forms 
WHERE status = 'published' 
  AND settings->>'lifecycle' = 'active';

-- Published but paused
SELECT * FROM forms 
WHERE status = 'published' 
  AND settings->>'lifecycle' = 'paused';

-- With unpublished changes
SELECT * FROM forms 
WHERE (settings->>'hasUnpublishedChanges')::boolean = true;
```

### Search form submissions by field value

```sql
-- Find submissions where email contains domain
SELECT s.* 
FROM form_submissions s
WHERE s.data->>'field-email-002' LIKE '%@example.com';

-- Find submissions with specific checkbox selection
SELECT s.*
FROM form_submissions s
WHERE s.data->'field-interests-004' @> '"Technology"'::jsonb;
```

---

## Data Flow & Lifecycle

### Form Creation Flow

1. User creates form via `createWorkspaceForm()`
2. System generates unique slug using `createUniqueFormSlug()`
3. Form inserted with status `'draft'`
4. Default settings applied from user preferences
5. Empty fields array initialized

### Form Publishing Flow

1. User edits form fields and settings
2. On publish, current state saved to `settings.liveSnapshot`
3. Version incremented and added to `settings.versions` array
4. Status changed to `'published'`
5. `settings.hasUnpublishedChanges` set to `false`

### Form Submission Flow

1. User fills out form via public URL (`/f/{slug}`)
2. System fetches form using `getPublicForm()`
3. If `liveSnapshot` exists, uses snapshot version
4. Submission created via `submitPublicForm()`
5. Data stored in `form_submissions.data` with metadata
6. If payment enabled, payment record created in `payments` table
7. Workflows triggered (email notifications, webhooks, etc.)

### Draft Changes Flow

1. User edits published form
2. Changes saved to `fields` and `settings` (draft version)
3. `settings.hasUnpublishedChanges` set to `true`
4. Public form continues showing `liveSnapshot` version
5. On republish, new snapshot created and changes go live

---

## JSONB Query Performance

### GIN Indexes

All JSONB columns have GIN (Generalized Inverted Index) indexes for fast querying:

```sql
CREATE INDEX idx_forms_fields_gin ON forms USING gin(fields);
CREATE INDEX idx_forms_settings_gin ON forms USING gin(settings);
CREATE INDEX idx_form_submissions_data_gin ON form_submissions USING gin(data);
```

### Efficient JSONB Queries

```sql
-- Containment operator (@>)
SELECT * FROM forms WHERE settings @> '{"payment": {"enabled": true}}';

-- Path existence operator (?|)
SELECT * FROM forms WHERE settings->'theme' ?| array['accentColor', 'fontFamily'];

-- JSON path queries
SELECT * FROM form_submissions 
WHERE data #>> '{_meta,status}' = 'completed';
```

---

## Backup & Restore Considerations

### Critical Tables for Backup

1. **forms** - Contains all form definitions (most critical)
2. **form_submissions** - Contains all response data
3. **payments** - Contains all payment transactions
4. **workflows** - Contains automation rules
5. **form_module_preferences** - User preferences

### Full Form Export Query

```sql
SELECT 
  f.*,
  (
    SELECT json_agg(s)
    FROM form_submissions s
    WHERE s.form_id = f.id
  ) as submissions,
  (
    SELECT json_agg(w)
    FROM workflows w
    WHERE w.form_id = f.id
  ) as workflows,
  (
    SELECT json_agg(p)
    FROM payments p
    JOIN form_submissions s ON s.id = p.submission_id
    WHERE s.form_id = f.id
  ) as payments
FROM forms f
WHERE f.id = 'form-uuid';
```

---

## Migration History

- **001_initial_schema.sql** - Initial database setup with all core tables
- **004_form_module_preferences.sql** - Added user preferences table
- **005_form_public_slugs.sql** - Added slug column and unique index
- **006_comprehensive_form_schema.sql** - Documentation and validation (this migration)

---

## TypeScript Types Reference

The database schema maps directly to TypeScript types defined in `src/components/forms/form-types.ts`:

- `FormRecord` → `forms` table row
- `FormField` → Element in `forms.fields` JSONB array
- `FormSettings` → `forms.settings` JSONB object
- `FormSubmission` → `form_submissions` table row
- `FormWorkflow` → `workflows` table row
- `FormPayment` → `payments` table row
- `FormModulePreferences` → `form_module_preferences.preferences` JSONB object

---

## Security Considerations

### Row-Level Security (RLS)

For multi-tenant deployments, consider implementing RLS:

```sql
-- Enable RLS on forms table
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own forms
CREATE POLICY forms_isolation_policy ON forms
  FOR ALL
  USING (created_by = current_user_id());
```

### Sensitive Data

- **Passwords in access control**: Stored hashed in `settings.access.password`
- **Payment provider keys**: Should be stored encrypted or in separate secrets management
- **User emails in submission data**: Consider GDPR compliance for data retention

### Public Form Access

Forms with status `'published'` are accessible via public URLs using the `slug` column. Ensure:
- Slugs are not guessable (include random component)
- Rate limiting on public submission endpoints
- CAPTCHA for spam prevention
- Validation of all submission data

---

## Monitoring & Analytics

### Key Metrics to Track

```sql
-- Forms by status
SELECT status, COUNT(*) 
FROM forms 
GROUP BY status;

-- Submissions per day
SELECT DATE(submitted_at), COUNT(*) 
FROM form_submissions 
GROUP BY DATE(submitted_at) 
ORDER BY DATE(submitted_at) DESC;

-- Average response time (if tracked)
-- Payment conversion rate
SELECT 
  COUNT(*) as total_submissions,
  COUNT(p.id) as paid_submissions,
  (COUNT(p.id)::float / COUNT(*)::float * 100) as conversion_rate
FROM form_submissions s
LEFT JOIN payments p ON p.submission_id = s.id;

-- Popular field types
SELECT field->>'type' as field_type, COUNT(*) as usage_count
FROM forms,
     jsonb_array_elements(fields) as field
GROUP BY field->>'type'
ORDER BY usage_count DESC;
```

---

## Troubleshooting

### Form not appearing in list

Check form ownership and status:
```sql
SELECT id, title, status, created_by
FROM forms
WHERE id = 'form-uuid';
```

### Submissions not counting

Verify foreign key relationship:
```sql
SELECT COUNT(*) as submission_count
FROM form_submissions
WHERE form_id = 'form-uuid';
```

### Unpublished changes not showing

Check settings flags:
```sql
SELECT 
  id,
  title,
  status,
  settings->>'hasUnpublishedChanges' as has_changes,
  settings->'liveSnapshot' as live_version
FROM forms
WHERE id = 'form-uuid';
```

---

## Future Enhancements

Potential schema additions for future features:

1. **Form Analytics Table** - Detailed analytics events
2. **Form Templates Table** - User-created reusable templates
3. **Collaboration Table** - Multi-user form editing
4. **Form AB Tests Table** - A/B test variants
5. **Submission Webhooks Table** - Webhook delivery status
6. **Form Folders/Tags** - Better organization

---

**Last Updated**: 2024-01-15  
**Migration Version**: 006  
**Database Version**: PostgreSQL 14+
