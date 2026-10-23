# Form Module Schema - Quick Reference

## Table of Contents
- [Tables Overview](#tables-overview)
- [Field Types](#field-types)
- [JSONB Structures](#jsonb-structures)
- [Common Queries](#common-queries)
- [API Functions](#api-functions)

---

## Tables Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FORM MODULE TABLES                       │
└─────────────────────────────────────────────────────────────────┘

forms (Main form definitions)
├── id (UUID, PK)
├── slug (VARCHAR, UNIQUE) ──────────────┐
├── project_id (UUID, FK)                │ Public URL: /f/{slug}
├── title (VARCHAR)                      │
├── description (TEXT)                   │
├── fields (JSONB) ◄─────────────────────┼──── Array of field objects
├── settings (JSONB) ◄───────────────────┼──── Configuration object
├── status (draft|published|archived)    │
├── created_by (UUID, FK) ───────────────┤
├── created_at (TIMESTAMP)               │
└── updated_at (TIMESTAMP)               │
                                         │
form_submissions (Response data)         │
├── id (UUID, PK)                        │
├── form_id (UUID, FK) ──────────────────┘
├── data (JSONB) ◄───────────────────────── Field answers + metadata
├── submitted_by (UUID, FK, nullable)
├── submitted_at (TIMESTAMP)
├── ip_address (VARCHAR)
└── user_agent (TEXT)
         │
         └───┐
             │
payments     │
├── id (UUID, PK)
├── submission_id (UUID, FK) ────────────┘
├── amount (DECIMAL)
├── currency (VARCHAR)
├── provider (VARCHAR)
├── transaction_id (VARCHAR)
├── status (pending|completed|failed|refunded)
├── payment_date (TIMESTAMP)
└── created_at (TIMESTAMP)

workflows (Automation rules)
├── id (UUID, PK)
├── form_id (UUID, FK) ──────────────────┐
├── name (VARCHAR)                       │ Links to forms table
├── trigger_event (VARCHAR)              │
├── actions (JSONB) ◄────────────────────┼──── Array of action objects
├── enabled (BOOLEAN)                    │
├── created_by (UUID, FK)                │
├── created_at (TIMESTAMP)               │
└── updated_at (TIMESTAMP)               │
                                         │
form_module_preferences                  │
├── id (UUID, PK)                        │
├── user_id (UUID, FK, UNIQUE)           │
├── preferences (JSONB) ◄────────────────┘─── User default settings
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

---

## Field Types

### Text Fields
```typescript
shortText   // Single-line input
longText    // Multi-line textarea
email       // Email with validation
phone       // Phone number
number      // Numeric input
url         // URL with validation
```

### Choice Fields
```typescript
dropdown    // Select dropdown
radio       // Radio button group
checkboxes  // Multiple selection
yesNo       // Boolean toggle
rating      // Star/numeric rating
ranking     // Order by preference
```

### Date/Time Fields
```typescript
date        // Date picker
time        // Time picker
dateRange   // Start + end date
appointment // Calendar booking
```

### Media Fields
```typescript
file        // File upload
imageChoice // Select from images
signature   // Digital signature
camera      // Photo capture
```

### Structure Fields
```typescript
section     // Visual divider
pageBreak   // Multi-page separator
heading     // Text heading
divider     // Horizontal line
```

### Commerce Fields
```typescript
payment     // Payment integration
product     // Product selection
coupon      // Coupon code
```

### Identity Fields
```typescript
hidden      // Hidden field
calculated  // Auto-calculated
```

---

## JSONB Structures

### forms.fields Array

```json
[
  {
    "id": "field-{uuid}",
    "type": "shortText",
    "label": "Field Label",
    "placeholder": "Enter text...",
    "helpText": "Help description",
    "required": true,
    "width": "full",
    "validation": {
      "min": 5,
      "max": 100
    }
  }
]
```

### forms.settings Object

```json
{
  "logic": [
    {
      "id": "logic-{uuid}",
      "sourceFieldId": "field-{uuid}",
      "operator": "equals",
      "value": "Yes",
      "action": "show",
      "targetFieldId": "field-{uuid}"
    }
  ],
  "theme": {
    "accentColor": "#F93D0A",
    "fontFamily": "Inter",
    "buttonStyle": "solid"
  },
  "payment": {
    "enabled": true,
    "provider": "stripe",
    "amount": 50.00,
    "currency": "USD"
  },
  "access": {
    "mode": "public"
  },
  "lifecycle": "active",
  "version": 1,
  "liveSnapshot": { /* ... */ },
  "hasUnpublishedChanges": false
}
```

### form_submissions.data Object

```json
{
  "field-{uuid-1}": "Answer 1",
  "field-{uuid-2}": ["Option A", "Option B"],
  "field-{uuid-3}": 42,
  "_meta": {
    "status": "completed",
    "formVersion": 1,
    "paymentStatus": "pending",
    "referrer": "https://example.com",
    "utm": {
      "source": "google",
      "medium": "cpc"
    }
  }
}
```

---

## Common Queries

### Get Forms with Counts

```sql
SELECT 
  f.*,
  COUNT(s.id) as response_count,
  COUNT(p.id) as payment_count
FROM forms f
LEFT JOIN form_submissions s ON s.form_id = f.id
LEFT JOIN payments p ON p.submission_id = s.id
WHERE f.created_by = $1
GROUP BY f.id
ORDER BY f.updated_at DESC;
```

### Find Forms by Field Type

```sql
SELECT DISTINCT f.id, f.title
FROM forms f,
     jsonb_array_elements(f.fields) as field
WHERE field->>'type' = 'payment';
```

### Get Submissions with Specific Answer

```sql
SELECT s.*
FROM form_submissions s
WHERE s.data->>'field-email' LIKE '%@gmail.com';
```

### Payment-Enabled Forms

```sql
SELECT f.id, f.title,
       f.settings->'payment'->>'provider' as provider,
       (f.settings->'payment'->>'amount')::numeric as amount
FROM forms f
WHERE (f.settings->'payment'->>'enabled')::boolean = true;
```

### Forms with Logic Rules

```sql
SELECT f.id, f.title,
       jsonb_array_length(f.settings->'logic') as rule_count
FROM forms f
WHERE jsonb_array_length(f.settings->'logic') > 0;
```

### Completed vs Partial Submissions

```sql
SELECT 
  s.data->'_meta'->>'status' as status,
  COUNT(*) as count
FROM form_submissions s
WHERE s.form_id = $1
GROUP BY s.data->'_meta'->>'status';
```

---

## API Functions

### Form CRUD

```typescript
// List all user forms
listWorkspaceForms(userId: string): Promise<FormRecord[]>

// Create new form
createWorkspaceForm(userId: string, input: {
  title: string;
  description?: string;
  fields?: FormField[];
  settings?: FormSettings;
}): Promise<FormRecord>

// Save form changes
saveWorkspaceForm(userId: string, form: FormRecord): Promise<FormRecord>

// Delete form
deleteWorkspaceForm(userId: string, formId: string): Promise<void>

// Get public form (for respondents)
getPublicForm(formId: string): Promise<FormRecord | null>
```

### Template Operations

```typescript
// Create from template
createFormFromTemplate(
  userId: string,
  template: FormTemplate,
  baseSettings?: FormSettings
): Promise<FormRecord>
```

### Submission Operations

```typescript
// List form submissions
listFormSubmissions(userId: string, formId: string): Promise<FormSubmission[]>

// Submit form (public)
submitPublicForm(
  form: FormRecord,
  answers: Record<string, unknown>,
  meta: { referrer?: string; userAgent?: string; utm?: Record<string, string> }
): Promise<DatabaseRow>

// Update submission
updateFormSubmission(userId: string, submission: FormSubmission): Promise<void>

// Delete submissions
deleteFormSubmissions(
  userId: string,
  formId: string,
  submissionIds: string[]
): Promise<void>
```

### Workflow Operations

```typescript
// List workflows
listFormWorkflows(userId: string, formId: string): Promise<FormWorkflow[]>

// Create workflow
createFormWorkflow(
  userId: string,
  formId: string,
  input: { name: string; actionType: string }
): Promise<FormWorkflow>

// Enable/disable workflow
setFormWorkflowEnabled(
  userId: string,
  workflowId: string,
  enabled: boolean
): Promise<void>

// Delete workflow
deleteFormWorkflow(userId: string, workflowId: string): Promise<void>
```

### Payment Operations

```typescript
// List payments for form
listFormPayments(userId: string, formId: string): Promise<FormPayment[]>
```

### User Preferences

```typescript
// Get user preferences
getFormModulePreferences(userId: string): Promise<FormModulePreferences | null>

// Save user preferences
saveFormModulePreferences(
  userId: string,
  preferences: FormModulePreferences
): Promise<FormModulePreferences>
```

### Utility Functions

```typescript
// Normalize form slug
normalizeFormSlug(value: string): string

// Check slug availability
isFormSlugAvailable(slug: string, formId?: string): Promise<boolean>

// Normalize form settings
normalizeFormSettings(value: unknown): FormSettings
```

---

## Logic Operators & Actions

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | Field value is "Yes" |
| `not_equals` | Does not match | Field value is not "No" |
| `contains` | String contains | Field contains "example" |
| `greater_than` | Numeric > | Field value > 50 |
| `less_than` | Numeric < | Field value < 100 |
| `is_answered` | Has any value | Field is not empty |

### Actions

| Action | Description |
|--------|-------------|
| `show` | Show target field |
| `hide` | Hide target field |
| `require` | Make target field required |
| `skip_to` | Jump to target field (multi-page) |

---

## Form Status Lifecycle

```
┌─────────┐
│  Draft  │ ◄─── New forms start here
└────┬────┘
     │
     │ Publish
     ▼
┌───────────┐
│ Published │ ◄─── Visible to public via /f/{slug}
└─────┬─────┘
      │
      ├─── Pause ──► lifecycle: "paused"
      │
      ├─── Edit ───► hasUnpublishedChanges: true
      │
      └─── Archive ──► status: "archived"
```

---

## JSONB Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `->` | Get JSON object field | `settings -> 'theme'` |
| `->>` | Get JSON object field as text | `settings ->> 'lifecycle'` |
| `#>` | Get JSON object at path | `data #> '{_meta,status}'` |
| `#>>` | Get JSON object at path as text | `data #>> '{_meta,status}'` |
| `@>` | Contains JSON | `data @> '{"field":"value"}'` |
| `<@` | Contained by JSON | `'{"a":1}' <@ data` |
| `?` | Key exists | `settings ? 'payment'` |
| `?|` | Any key exists | `settings ?| array['theme','payment']` |
| `?&` | All keys exist | `settings ?& array['theme','payment']` |

---

## Performance Tips

### Use GIN Indexes for JSONB

```sql
CREATE INDEX idx_forms_settings_gin ON forms USING gin(settings);
```

### Efficient JSONB Queries

```sql
-- GOOD: Uses GIN index
WHERE settings @> '{"payment": {"enabled": true}}'

-- BAD: Cannot use index efficiently
WHERE settings->>'lifecycle' = 'active'
```

### Preload Counts

```sql
-- Include in main query
SELECT f.*, 
  (SELECT COUNT(*) FROM form_submissions WHERE form_id = f.id) as count
FROM forms f;

-- Rather than separate queries
```

### Limit Result Sets

```sql
-- Always use LIMIT for large tables
SELECT * FROM form_submissions 
WHERE form_id = $1 
ORDER BY submitted_at DESC 
LIMIT 100;
```

---

## Data Validation

### Required Validations

- ✅ `forms.slug` must be unique
- ✅ `forms.title` cannot be empty
- ✅ `forms.status` must be one of: draft, published, archived
- ✅ `forms.fields` must be valid JSONB array
- ✅ `forms.settings` must be valid JSONB object
- ✅ Field IDs must be unique within a form
- ✅ Logic rule field IDs must exist in form

### Application-Level Validation

Form validation is primarily handled in TypeScript:
- `src/components/forms/form-types.ts` - Type definitions
- `src/lib/forms.ts` - Data normalization and validation
- `src/components/forms/FormBuilder.tsx` - UI validation

---

## Migration Files

1. **001_initial_schema.sql** - Core tables
2. **002_add_password_reset.sql** - Password reset features
3. **003_add_user_fields.sql** - Extended user fields
4. **004_form_module_preferences.sql** - User preferences
5. **005_form_public_slugs.sql** - Public slug support
6. **006_comprehensive_form_schema.sql** - Documentation (current)

---

## Related Files

- **Types**: `src/components/forms/form-types.ts`
- **Database**: `src/lib/db.ts`
- **Data Access**: `src/lib/forms.ts`
- **UI Builder**: `src/components/forms/FormBuilder.tsx`
- **UI Renderer**: `src/components/forms/FormRenderer.tsx`
- **Module UI**: `src/components/forms/FormsModule.tsx`
- **Templates**: `src/components/forms/form-templates.ts`
- **AI Generator**: `src/components/forms/ai-form-generator.ts`

---

**Quick Start**: Run migrations in order, then use `listWorkspaceForms()` to fetch forms and `createWorkspaceForm()` to create new ones. All data is stored in PostgreSQL with JSONB columns for flexibility.
