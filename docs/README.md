# Form Module Documentation

Complete documentation for the Form Module database schema and architecture.

## 📚 Documentation Files

### 1. [Form Module Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md)
**Comprehensive guide to the database design**

This is the main documentation file covering:
- Complete table definitions with all columns
- Detailed JSONB structure explanations
- Field types reference (30+ field types)
- Settings configuration options
- Logic rules and conditional behavior
- Theme and styling options
- Payment integration
- Version control and publishing workflow
- Common query patterns
- Security considerations
- Troubleshooting guide

**👉 Start here for complete understanding**

### 2. [Quick Reference Guide](./FORM_SCHEMA_QUICK_REFERENCE.md)
**Fast lookup for developers**

Quick access to:
- Table overview with ASCII diagrams
- All field types at a glance
- JSONB structures with examples
- Most common SQL queries
- API function signatures
- Logic operators and actions
- JSONB query operators
- Performance tips
- Related files reference

**👉 Use this for day-to-day development**

### 3. [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md)
**Visual representation of the schema**

Includes:
- Complete entity-relationship diagram (Mermaid)
- JSONB structure flowcharts
- Form lifecycle state diagram
- Publishing flow sequence diagram
- Submission flow sequence diagram
- Data access pattern diagram
- Index strategy visualization
- Architecture overview

**👉 Great for understanding relationships visually**

---

## 🎯 Quick Start

### Understanding the Database

The Form Module uses a **database-first architecture**:

1. **All form data lives in PostgreSQL**
   - No local storage or cache
   - Database is the single source of truth

2. **JSONB columns for flexibility**
   - `forms.fields` - array of field definitions
   - `forms.settings` - complete configuration object
   - `form_submissions.data` - response data

3. **Strong referential integrity**
   - Foreign keys enforce relationships
   - Cascade deletes prevent orphaned data

### Core Tables

```
forms                    → Main form definitions
├── fields (JSONB)      → Array of form fields
└── settings (JSONB)    → All configuration

form_submissions         → Response data
└── data (JSONB)        → Field answers + metadata

workflows               → Automation rules
payments                → Payment transactions
form_module_preferences → User defaults
```

### Common Operations

**Create a form:**
```typescript
const form = await createWorkspaceForm(userId, {
  title: "Customer Survey",
  description: "Help us improve",
  fields: [
    {
      id: "field-name",
      type: "shortText",
      label: "Your name",
      required: true
    }
  ]
});
```

**Get all forms:**
```typescript
const forms = await listWorkspaceForms(userId);
```

**Get submissions:**
```typescript
const submissions = await listFormSubmissions(userId, formId);
```

---

## 📖 Documentation Structure

### For New Developers

1. Read the [Quick Reference](./FORM_SCHEMA_QUICK_REFERENCE.md) first
2. Review the [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md) for visual understanding
3. Dive into [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md) for details

### For Experienced Developers

- Use [Quick Reference](./FORM_SCHEMA_QUICK_REFERENCE.md) for lookups
- Check [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md) for specific sections
- Refer to [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md) when working on relationships

### For Database Administrators

- Study [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md) thoroughly
- Review index strategy in [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md)
- Use backup queries from [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md)

---

## 🔑 Key Concepts

### JSONB Storage

The schema uses PostgreSQL JSONB columns extensively:

**Advantages:**
- ✅ Flexible schema evolution
- ✅ No ALTER TABLE migrations for field changes
- ✅ Queryable with GIN indexes
- ✅ Atomic updates
- ✅ Native JSON validation

**Trade-offs:**
- ⚠️ Validation happens at application layer
- ⚠️ Complex queries can be slower than normalized tables
- ⚠️ Requires understanding of JSONB operators

### Field Types (30+ types)

Forms support rich field types organized into categories:

- **Text**: shortText, longText, email, phone, number, url
- **Choice**: dropdown, radio, checkboxes, yesNo, rating, ranking
- **Date/Time**: date, time, dateRange, appointment
- **Media**: file, imageChoice, signature, camera
- **Structure**: section, pageBreak, heading, divider
- **Commerce**: payment, product, coupon
- **Identity**: hidden, calculated

Each field type has specific properties and validation rules documented in the schema.

### Conditional Logic

Forms support powerful conditional logic:

```typescript
{
  "sourceFieldId": "field-country",
  "operator": "equals",
  "value": "USA",
  "action": "show",
  "targetFieldId": "field-state"
}
```

**Operators**: equals, not_equals, contains, greater_than, less_than, is_answered  
**Actions**: show, hide, require, skip_to

### Versioning & Publishing

Forms have a sophisticated versioning system:

1. **Draft mode**: Edit freely without affecting live form
2. **Publish**: Creates snapshot in `settings.liveSnapshot`
3. **Continue editing**: Draft changes tracked via `hasUnpublishedChanges`
4. **Republish**: Updates live version with new snapshot

Public URLs always serve the `liveSnapshot` version for consistency.

---

## 🗂️ Related Source Files

### Type Definitions
```
src/components/forms/form-types.ts
```
TypeScript interfaces that map directly to database schema.

### Data Access Layer
```
src/lib/db.ts           - Database connection and query wrapper
src/lib/forms.ts        - Form CRUD operations and business logic
```

### UI Components
```
src/components/forms/FormsModule.tsx    - Main form management UI
src/components/forms/FormBuilder.tsx    - Form editor interface
src/components/forms/FormRenderer.tsx   - Public form display
src/components/forms/form-templates.ts  - Predefined form templates
```

### Database Migrations
```
migrations/001_initial_schema.sql               - Core tables
migrations/004_form_module_preferences.sql      - User preferences
migrations/005_form_public_slugs.sql            - Public URL support
migrations/006_comprehensive_form_schema.sql    - Documentation (this doc)
```

---

## 🔍 Search & Filter Examples

### Find forms by field type

```sql
SELECT f.id, f.title, field->>'label' as field_label
FROM forms f,
     jsonb_array_elements(f.fields) as field
WHERE field->>'type' = 'payment';
```

### Find submissions by answer

```sql
SELECT s.*
FROM form_submissions s
WHERE s.data->>'field-email' LIKE '%@example.com';
```

### Find forms with logic rules

```sql
SELECT f.id, f.title,
       jsonb_array_length(f.settings->'logic') as rule_count
FROM forms f
WHERE jsonb_array_length(f.settings->'logic') > 0;
```

### Payment-enabled forms

```sql
SELECT f.id, f.title,
       f.settings->'payment'->>'provider' as provider
FROM forms f
WHERE (f.settings->'payment'->>'enabled')::boolean = true;
```

More examples in [Quick Reference](./FORM_SCHEMA_QUICK_REFERENCE.md).

---

## ⚡ Performance Considerations

### Indexes

The schema includes strategic indexes:

**B-Tree Indexes** (for equality and range queries)
- Primary keys
- Foreign keys
- Composite indexes on common query patterns

**GIN Indexes** (for JSONB queries)
- `forms.fields`
- `forms.settings`
- `form_submissions.data`
- `workflows.actions`

### Query Optimization Tips

1. **Use containment operator for JSONB**
   ```sql
   -- GOOD: Uses GIN index
   WHERE settings @> '{"payment": {"enabled": true}}'
   ```

2. **Preload aggregates**
   ```sql
   SELECT f.*, 
     (SELECT COUNT(*) FROM form_submissions WHERE form_id = f.id) as count
   FROM forms f;
   ```

3. **Limit result sets**
   ```sql
   SELECT * FROM form_submissions 
   ORDER BY submitted_at DESC 
   LIMIT 100;
   ```

More tips in [Quick Reference](./FORM_SCHEMA_QUICK_REFERENCE.md).

---

## 🔒 Security Notes

### Access Control

- Forms are scoped to users via `created_by` column
- All queries include user ID checks
- Public forms accessible via unique `slug`

### Sensitive Data

- Form access passwords stored in `settings.access.password`
- Payment provider credentials should be encrypted
- PII in submissions subject to GDPR compliance

### Public Endpoints

Forms with `status='published'` are publicly accessible:
- Implement rate limiting
- Consider CAPTCHA for spam prevention
- Validate all submission data

More details in [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md) security section.

---

## 🛠️ Troubleshooting

### Form not appearing

```sql
SELECT id, title, status, created_by
FROM forms
WHERE id = 'form-uuid';
```

### Submissions not counting

```sql
SELECT COUNT(*) 
FROM form_submissions
WHERE form_id = 'form-uuid';
```

### Unpublished changes not showing

```sql
SELECT 
  settings->>'hasUnpublishedChanges' as has_changes,
  settings->'liveSnapshot' IS NOT NULL as has_snapshot
FROM forms
WHERE id = 'form-uuid';
```

More troubleshooting in [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md).

---

## 📦 Backup & Export

### Export single form with all data

```sql
SELECT 
  f.*,
  (SELECT json_agg(s) FROM form_submissions s WHERE s.form_id = f.id) as submissions,
  (SELECT json_agg(w) FROM workflows w WHERE w.form_id = f.id) as workflows,
  (SELECT json_agg(p) 
   FROM payments p 
   JOIN form_submissions s ON s.id = p.submission_id 
   WHERE s.form_id = f.id) as payments
FROM forms f
WHERE f.id = 'form-uuid';
```

### Critical tables for backup

1. `forms` - Form definitions
2. `form_submissions` - Response data
3. `payments` - Payment records
4. `workflows` - Automation rules
5. `form_module_preferences` - User settings

---

## 🚀 Future Enhancements

Potential schema additions documented in [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md):

- Form analytics events table
- User-created template library
- Multi-user collaboration
- A/B testing support
- Webhook delivery status
- Folder/tag organization

---

## 📝 Migration Management

### Current Migration Version: 006

**Migration History:**
1. `001_initial_schema.sql` - Core tables and relationships
2. `002_add_password_reset.sql` - Password reset functionality
3. `003_add_user_fields.sql` - Extended user profile fields
4. `004_form_module_preferences.sql` - User default preferences
5. `005_form_public_slugs.sql` - Public URL slug support
6. `006_comprehensive_form_schema.sql` - Documentation and validation

### Applying Migrations

Migrations should be run in order:

```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
psql $DATABASE_URL -f migrations/002_add_password_reset.sql
psql $DATABASE_URL -f migrations/003_add_user_fields.sql
psql $DATABASE_URL -f migrations/004_form_module_preferences.sql
psql $DATABASE_URL -f migrations/005_form_public_slugs.sql
psql $DATABASE_URL -f migrations/006_comprehensive_form_schema.sql
```

---

## 💬 Getting Help

### Documentation Questions

1. Check [Quick Reference](./FORM_SCHEMA_QUICK_REFERENCE.md) for fast answers
2. Search [Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md) for detailed info
3. Review [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md) for visual clarification

### Code Questions

1. Check TypeScript types in `src/components/forms/form-types.ts`
2. Review data access functions in `src/lib/forms.ts`
3. Examine UI implementation in `src/components/forms/`

### Database Questions

1. Review table definitions in migration files
2. Check indexes and constraints in schema documentation
3. Examine helper functions in migration 006

---

## ✅ Schema Validation Checklist

Use this checklist when working with the schema:

**Creating Forms:**
- [ ] Form has unique slug
- [ ] Fields array is valid JSONB
- [ ] Each field has unique ID
- [ ] Settings object follows structure
- [ ] Status is draft/published/archived
- [ ] created_by references valid user

**Publishing Forms:**
- [ ] liveSnapshot created
- [ ] Version incremented
- [ ] Version added to versions array
- [ ] hasUnpublishedChanges set to false
- [ ] Status changed to published

**Handling Submissions:**
- [ ] All required fields answered
- [ ] Field IDs match form fields
- [ ] _meta object included
- [ ] Form ID is valid
- [ ] Payment created if enabled

---

**Last Updated**: 2024-01-15  
**Schema Version**: 006  
**Database**: PostgreSQL 14+  

For questions or contributions, please refer to the main project README.
