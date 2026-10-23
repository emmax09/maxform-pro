# Form Module Database Schema - Executive Summary

## Overview

The Form Module implements a **database-as-source-of-truth** architecture where all form definitions, field configurations, settings, logic rules, themes, and submission data are stored in PostgreSQL. The application reads directly from and writes directly to the database with no intermediate caching layer.

## Core Architecture

### Database-First Design

```
┌──────────────────────────────────────────────────────┐
│                    Application Layer                  │
│  (React Components + TypeScript Business Logic)      │
└──────────────────┬───────────────────────────────────┘
                   │
                   │ Direct SQL Queries
                   │
┌──────────────────▼───────────────────────────────────┐
│                  PostgreSQL Database                  │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ forms table                                 │    │
│  │  - fields (JSONB array)                     │    │
│  │  - settings (JSONB object)                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ form_submissions table                      │    │
│  │  - data (JSONB object)                      │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  workflows, payments, form_module_preferences        │
└───────────────────────────────────────────────────────┘
```

### Why JSONB?

The schema uses PostgreSQL's JSONB data type for complex nested structures:

**Benefits:**
- ✅ Schema flexibility - add new field types without migrations
- ✅ Queryable - GIN indexes enable fast JSONB queries
- ✅ Atomic updates - entire configurations updated in single transaction
- ✅ Type safety - validated at application layer via TypeScript
- ✅ Version control - easy to snapshot and compare versions

**Trade-offs:**
- ⚠️ Validation logic lives in application code
- ⚠️ Complex queries can be less performant than normalized tables
- ⚠️ Requires understanding JSONB operators (@>, ->>, etc.)

## Core Tables

### 1. `forms` - Form Definitions

The main table storing all form metadata and configuration.

**Key Columns:**
- `id` (UUID) - Unique identifier
- `slug` (VARCHAR) - Public URL path (e.g., `/f/customer-survey`)
- `fields` (JSONB) - **Array of 30+ field type definitions**
- `settings` (JSONB) - **Complete configuration object**
- `status` (VARCHAR) - `draft`, `published`, or `archived`

**Storage Model:**
```json
{
  "fields": [
    {
      "id": "field-abc123",
      "type": "shortText",
      "label": "Your Name",
      "required": true,
      "validation": { "min": 2, "max": 100 }
    }
  ],
  "settings": {
    "logic": [...],      // Conditional rules
    "theme": {...},      // Colors, fonts, styling
    "payment": {...},    // Payment configuration
    "access": {...},     // Public/password/authenticated
    "liveSnapshot": {...} // Published version
  }
}
```

### 2. `form_submissions` - Response Data

Stores all form responses with complete field answers and metadata.

**Key Columns:**
- `form_id` (UUID FK) - Links to parent form
- `data` (JSONB) - **All field answers mapped by field ID**
- `submitted_at` (TIMESTAMP) - Submission time

**Storage Model:**
```json
{
  "field-abc123": "John Doe",
  "field-def456": "john@example.com",
  "_meta": {
    "status": "completed",
    "formVersion": 1,
    "paymentStatus": "pending",
    "utm": { "source": "google" }
  }
}
```

### 3. Supporting Tables

- **`workflows`** - Automation rules (email, webhooks)
- **`payments`** - Payment transaction records
- **`form_module_preferences`** - User default settings

## Comprehensive Feature Set

### 30+ Field Types

**Text Input:** shortText, longText, email, phone, number, url  
**Choices:** dropdown, radio, checkboxes, yesNo, rating, ranking  
**Date/Time:** date, time, dateRange, appointment  
**Media:** file, imageChoice, signature, camera  
**Structure:** section, pageBreak, heading, divider  
**Commerce:** payment, product, coupon  
**Identity:** hidden, calculated  

### Conditional Logic

Forms support sophisticated branching logic:

```typescript
{
  sourceFieldId: "field-country",
  operator: "equals",        // equals, not_equals, contains, etc.
  value: "USA",
  action: "show",            // show, hide, require, skip_to
  targetFieldId: "field-state"
}
```

### Theming & Customization

Complete visual customization stored in `settings.theme`:

- Colors (accent, background)
- Typography (font family, size, weight)
- Layout (border radius, button style)
- Dark/light mode
- Custom CSS

### Payment Integration

Built-in payment support with multiple providers:

- **Providers:** Stripe, Paystack, Flutterwave, OPay
- **Modes:** Fixed amount, variable amount, product-based
- **Features:** Coupon codes, currency selection

### Access Control

Flexible access modes:
- **Public** - Anyone with link
- **Password** - Protected with password
- **Authenticated** - Login required

### Versioning & Publishing

Sophisticated version control system:

1. **Draft Mode** - Edit without affecting live form
2. **Publish** - Create snapshot in `settings.liveSnapshot`
3. **Continue Editing** - Track changes via `hasUnpublishedChanges`
4. **Republish** - Push new version live

**Key Benefit:** Public URLs always show stable published version while you continue editing.

## Data Flow

### Form Creation → Publishing → Submission

```
1. CREATE FORM
   ├─ User: createWorkspaceForm()
   ├─ Generate unique slug
   └─ INSERT INTO forms (status='draft')

2. EDIT & PUBLISH
   ├─ User: saveWorkspaceForm()
   ├─ Create settings.liveSnapshot
   ├─ Increment version
   └─ UPDATE forms (status='published')

3. PUBLIC ACCESS
   ├─ Visitor: GET /f/{slug}
   ├─ Fetch form via getPublicForm()
   └─ Render liveSnapshot.fields

4. SUBMIT FORM
   ├─ Visitor: submitPublicForm()
   ├─ Validate answers
   ├─ Process payment (if enabled)
   ├─ INSERT INTO form_submissions
   └─ Trigger workflows
```

## Performance Optimization

### Indexes

**B-Tree Indexes** (standard queries)
- Primary keys, foreign keys
- Composite: `(created_by, status)`, `(form_id, submitted_at)`

**GIN Indexes** (JSONB queries)
```sql
CREATE INDEX idx_forms_fields_gin ON forms USING gin(fields);
CREATE INDEX idx_forms_settings_gin ON forms USING gin(settings);
CREATE INDEX idx_form_submissions_data_gin ON form_submissions USING gin(data);
```

### Query Patterns

**Efficient JSONB Queries:**
```sql
-- GOOD: Uses GIN index
WHERE settings @> '{"payment": {"enabled": true}}'

-- OKAY: Functional but slower
WHERE settings->>'lifecycle' = 'active'
```

## Documentation Files

Complete documentation available in `/docs`:

1. **[FORM_MODULE_DATABASE_SCHEMA.md](./docs/FORM_MODULE_DATABASE_SCHEMA.md)**  
   📘 **Comprehensive guide** (150+ pages worth of content)
   - Complete table definitions
   - All JSONB structures
   - Query patterns
   - Security considerations
   - Troubleshooting

2. **[FORM_SCHEMA_QUICK_REFERENCE.md](./docs/FORM_SCHEMA_QUICK_REFERENCE.md)**  
   ⚡ **Quick lookup guide**
   - Common queries
   - API functions
   - Field types
   - JSONB operators
   - Performance tips

3. **[FORM_SCHEMA_ER_DIAGRAM.md](./docs/FORM_SCHEMA_ER_DIAGRAM.md)**  
   🎨 **Visual diagrams** (Mermaid format)
   - Entity relationships
   - State diagrams
   - Sequence flows
   - Architecture

4. **[README.md](./docs/README.md)**  
   📖 **Documentation index**
   - How to use the docs
   - Quick start guide
   - File organization

## Migration Files

Schema evolution managed through SQL migrations:

```
migrations/
├── 001_initial_schema.sql            # Core tables
├── 004_form_module_preferences.sql   # User preferences
├── 005_form_public_slugs.sql         # Public URL support
└── 006_comprehensive_form_schema.sql # Documentation & comments
```

## Code Organization

### TypeScript Types

**`src/components/forms/form-types.ts`**
- All TypeScript interfaces
- Maps 1:1 to database schema
- Used throughout application

Key types:
- `FormRecord` → forms table
- `FormField` → forms.fields array element
- `FormSettings` → forms.settings object
- `FormSubmission` → form_submissions table

### Data Access Layer

**`src/lib/forms.ts`**
- All database operations
- Data normalization
- Business logic

Functions:
- `listWorkspaceForms()` - Get user's forms
- `createWorkspaceForm()` - Create new form
- `saveWorkspaceForm()` - Update form
- `listFormSubmissions()` - Get responses
- `submitPublicForm()` - Public submission

### UI Components

**`src/components/forms/`**
- `FormsModule.tsx` - Main management UI
- `FormBuilder.tsx` - Drag-drop builder
- `FormRenderer.tsx` - Public form display

## Security Considerations

### Access Control

- All forms scoped to `created_by` user
- Public forms accessed via unique `slug`
- Row-level security possible for multi-tenancy

### Sensitive Data

- Access passwords stored (should be hashed)
- Payment credentials should be encrypted
- PII in submissions subject to GDPR

### Public Endpoints

- Rate limiting recommended
- CAPTCHA for spam prevention
- Input validation required

## Common Operations

### Create Form from Scratch

```typescript
const form = await createWorkspaceForm(userId, {
  title: "Customer Survey",
  description: "Help us improve our service",
  fields: [
    {
      id: createId("field"),
      type: "shortText",
      label: "Your name",
      required: true
    },
    {
      id: createId("field"),
      type: "email",
      label: "Email address",
      required: true
    }
  ]
});
```

### Query Forms with Specific Field

```sql
SELECT f.id, f.title
FROM forms f,
     jsonb_array_elements(f.fields) as field
WHERE field->>'type' = 'payment';
```

### Get Submissions with Metadata

```sql
SELECT 
  s.*,
  s.data->'_meta'->>'status' as submission_status,
  s.data->'_meta'->>'paymentStatus' as payment_status
FROM form_submissions s
WHERE s.form_id = $1
ORDER BY s.submitted_at DESC;
```

## Key Benefits

### For Developers

✅ **Type Safety** - Full TypeScript coverage  
✅ **Flexibility** - Add features without migrations  
✅ **Queryable** - JSONB with GIN indexes  
✅ **Version Control** - Built-in versioning system  
✅ **Documentation** - Comprehensive docs

### For Users

✅ **Rich Features** - 30+ field types  
✅ **Conditional Logic** - Dynamic forms  
✅ **Payment Support** - Multiple providers  
✅ **Customization** - Full theming  
✅ **Analytics** - Built-in tracking

### For Business

✅ **Scalable** - PostgreSQL proven at scale  
✅ **Reliable** - ACID transactions  
✅ **Auditable** - Complete history  
✅ **Extensible** - Easy to add features  
✅ **Standards-Based** - SQL + JSON

## Schema Statistics

```
Tables:               7 (forms, submissions, workflows, payments, etc.)
Total Columns:        ~60 across all tables
JSONB Columns:        5 (fields, settings, data, actions, preferences)
Indexes:              ~20 (B-Tree + GIN)
Field Types:          30+ supported types
Logic Operators:      6 (equals, contains, greater_than, etc.)
Logic Actions:        4 (show, hide, require, skip_to)
Payment Providers:    4 (Stripe, Paystack, Flutterwave, OPay)
```

## Next Steps

1. **Understand the Schema**
   - Read [Quick Reference](./docs/FORM_SCHEMA_QUICK_REFERENCE.md)
   - Review [ER Diagrams](./docs/FORM_SCHEMA_ER_DIAGRAM.md)

2. **Explore the Code**
   - Check `form-types.ts` for TypeScript types
   - Review `lib/forms.ts` for data access
   - Examine `FormBuilder.tsx` for UI

3. **Run Migrations**
   ```bash
   psql $DATABASE_URL -f migrations/001_initial_schema.sql
   # ... run all migrations in order
   ```

4. **Start Building**
   - Create forms via API
   - Query with SQL
   - Build features

## Support & Resources

- **Full Documentation:** `/docs/FORM_MODULE_DATABASE_SCHEMA.md`
- **Quick Reference:** `/docs/FORM_SCHEMA_QUICK_REFERENCE.md`
- **Visual Diagrams:** `/docs/FORM_SCHEMA_ER_DIAGRAM.md`
- **Migration Files:** `/migrations/*.sql`
- **Type Definitions:** `src/components/forms/form-types.ts`
- **Data Access:** `src/lib/forms.ts`

---

**Schema Version:** 006  
**Last Updated:** 2024-01-15  
**Database:** PostgreSQL 14+  
**Status:** ✅ Production Ready

This comprehensive database schema provides a solid foundation for a full-featured form builder with enterprise-grade capabilities.
