-- Comprehensive Form Module Schema
-- This migration ensures all form-related tables have proper structure
-- for storing form fields, settings, logic rules, themes, and all configurations

-- ============================================================================
-- CORE FORM TABLES
-- ============================================================================

-- Ensure forms table has all necessary columns
-- The forms table is the central table for all form definitions
DO $$ 
BEGIN
  -- Add slug column if not exists (already handled by migration 005)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'forms' AND column_name = 'slug'
  ) THEN
    ALTER TABLE forms ADD COLUMN slug VARCHAR(120);
  END IF;
END $$;

-- Add comment to forms table
COMMENT ON TABLE forms IS 'Core table storing form definitions with fields, settings, and configurations';
COMMENT ON COLUMN forms.id IS 'Unique identifier for the form';
COMMENT ON COLUMN forms.project_id IS 'Optional project grouping for forms';
COMMENT ON COLUMN forms.slug IS 'URL-friendly unique identifier for public form access';
COMMENT ON COLUMN forms.title IS 'Display title of the form';
COMMENT ON COLUMN forms.description IS 'Optional description shown to form respondents';
COMMENT ON COLUMN forms.fields IS 'JSONB array of form field definitions with types, labels, validation, options, etc.';
COMMENT ON COLUMN forms.settings IS 'JSONB object containing logic rules, theme, payment, notifications, access control, etc.';
COMMENT ON COLUMN forms.status IS 'Current lifecycle status: draft, published, or archived';
COMMENT ON COLUMN forms.created_by IS 'User ID who created this form';
COMMENT ON COLUMN forms.created_at IS 'Timestamp when form was created';
COMMENT ON COLUMN forms.updated_at IS 'Timestamp when form was last updated';

-- ============================================================================
-- FORM FIELD STRUCTURE (stored in forms.fields JSONB column)
-- ============================================================================

-- Field types supported:
-- Text fields: shortText, longText, email, phone, number, url
-- Choice fields: dropdown, radio, checkboxes, yesNo, rating, ranking
-- Date/time fields: date, time, dateRange, appointment
-- Media fields: file, imageChoice, signature, camera
-- Structure fields: section, pageBreak, heading, divider
-- Commerce fields: payment, product, coupon
-- Identity fields: hidden, calculated

-- Each field object in the JSONB array has this structure:
-- {
--   "id": "field-uuid",                    -- Unique field identifier
--   "type": "shortText",                   -- Field type from list above
--   "label": "Your Name",                  -- Display label
--   "placeholder": "Enter your name",      -- Optional placeholder text
--   "helpText": "Help text here",          -- Optional help/description
--   "required": false,                     -- Whether field is required
--   "options": ["Option 1", "Option 2"],   -- For choice-type fields
--   "defaultValue": "",                    -- Optional default value
--   "formula": "{field1} * {field2}",      -- For calculated fields
--   "width": "full",                       -- Layout: "full" or "half"
--   "validation": {                        -- Validation rules
--     "min": 0,                           -- Minimum value/length
--     "max": 100,                         -- Maximum value/length
--     "pattern": "regex"                  -- Regex pattern for validation
--   }
-- }

-- ============================================================================
-- FORM SETTINGS STRUCTURE (stored in forms.settings JSONB column)
-- ============================================================================

-- The settings JSONB object contains multiple configuration sections:

-- 1. LOGIC RULES (settings.logic array)
-- Conditional logic for showing/hiding/requiring fields
-- [
--   {
--     "id": "logic-uuid",
--     "sourceFieldId": "field-uuid",      -- Field to evaluate
--     "operator": "equals",                -- equals, not_equals, contains, greater_than, less_than, is_answered
--     "value": "Yes",                      -- Value to compare against
--     "action": "show",                    -- show, hide, skip_to, require
--     "targetFieldId": "field-uuid"        -- Field to apply action to
--   }
-- ]

-- 2. THEME SETTINGS (settings.theme object)
-- {
--   "accentColor": "#2563EB",             -- Primary brand color
--   "backgroundColor": "#FFFFFF",          -- Form background color
--   "fontFamily": "Inter",                 -- Typography font family
--   "fontSize": 16,                        -- Base font size in pixels
--   "fontWeight": 400,                     -- Font weight (300-800)
--   "lineHeight": 1.5,                     -- Line height multiplier
--   "radius": 6,                           -- Border radius in pixels
--   "buttonStyle": "solid",                -- solid, outline, soft
--   "respondentMode": "auto",              -- auto, light, dark
--   "coverImageUrl": "",                   -- Optional cover image
--   "logoUrl": "",                         -- Optional logo image
--   "customCss": ""                        -- Custom CSS overrides
-- }

-- 3. PAYMENT SETTINGS (settings.payment object)
-- {
--   "enabled": false,                      -- Whether payment is enabled
--   "mode": "fixed",                       -- fixed, variable, product
--   "provider": "workspace",               -- workspace, stripe, paystack, flutterwave, opay
--   "amount": 0,                           -- Payment amount (for fixed mode)
--   "currency": "USD",                     -- Currency code
--   "allowCoupons": false                  -- Whether to allow coupon codes
-- }

-- 4. CONFIRMATION SETTINGS (settings.confirmation object)
-- {
--   "type": "message",                     -- message or redirect
--   "message": "Thanks for your response", -- Success message
--   "redirectUrl": ""                      -- URL for redirect type
-- }

-- 5. NOTIFICATION SETTINGS (settings.notifications object)
-- {
--   "enabled": true,                       -- Whether to send notifications
--   "recipients": "email@example.com"      -- Comma-separated email addresses
-- }

-- 6. ACCESS CONTROL (settings.access object)
-- {
--   "mode": "public",                      -- public, password, authenticated
--   "password": ""                         -- Password for password-protected forms
-- }

-- 7. RESPONSE LIMITS (settings.limits object)
-- {
--   "responseLimit": null,                 -- Max number of responses (null = unlimited)
--   "onePerEmail": false                   -- Limit to one response per email
-- }

-- 8. SCHEDULE (settings.schedule object)
-- {
--   "opensAt": "",                         -- ISO timestamp when form opens
--   "closesAt": ""                         -- ISO timestamp when form closes
-- }

-- 9. LIFECYCLE & VERSIONING
-- {
--   "lifecycle": "active",                 -- active or paused
--   "version": 0,                          -- Current version number
--   "versions": [                          -- Version history array
--     {
--       "id": "version-uuid",
--       "version": 1,
--       "publishedAt": "2024-01-01T00:00:00Z",
--       "publishedBy": "user-uuid",
--       "fields": [...],                  -- Snapshot of fields at publish time
--       "title": "Form Title",
--       "description": "Description"
--     }
--   ],
--   "liveSnapshot": {                      -- Current live version snapshot
--     "fields": [...],                    -- Live form fields
--     "theme": {...},                     -- Live theme settings
--     "payment": {...},                   -- Live payment settings
--     "version": 1,                       -- Live version number
--     "title": "Live Title",
--     "description": "Live Description"
--   },
--   "hasUnpublishedChanges": false,        -- Whether draft differs from live
--   "archivedFromStatus": "published"      -- Original status before archiving
-- }

-- ============================================================================
-- FORM SUBMISSIONS TABLE
-- ============================================================================

COMMENT ON TABLE form_submissions IS 'Stores all form responses submitted by users';
COMMENT ON COLUMN form_submissions.id IS 'Unique identifier for the submission';
COMMENT ON COLUMN form_submissions.form_id IS 'Reference to the parent form';
COMMENT ON COLUMN form_submissions.data IS 'JSONB object containing all field answers and metadata';
COMMENT ON COLUMN form_submissions.submitted_by IS 'Optional user ID if authenticated submission';
COMMENT ON COLUMN form_submissions.submitted_at IS 'Timestamp when form was submitted';
COMMENT ON COLUMN form_submissions.ip_address IS 'IP address of the submitter';
COMMENT ON COLUMN form_submissions.user_agent IS 'Browser user agent string';

-- Submission data structure (form_submissions.data JSONB):
-- {
--   "field-uuid-1": "Answer value 1",      -- Field ID mapped to answer
--   "field-uuid-2": ["Option 1", "Option 2"], -- Array for multi-select
--   "field-uuid-3": 42,                    -- Numeric answer
--   "_meta": {                             -- Metadata object
--     "status": "completed",                -- completed or partial
--     "formVersion": 1,                     -- Version of form used
--     "paymentStatus": "pending",           -- Payment status if applicable
--     "referrer": "https://example.com",    -- Referrer URL
--     "utm": {                              -- UTM tracking parameters
--       "source": "google",
--       "medium": "cpc",
--       "campaign": "spring-2024"
--     }
--   }
-- }

-- ============================================================================
-- FORM WORKFLOWS/AUTOMATIONS TABLE
-- ============================================================================

COMMENT ON TABLE workflows IS 'Automation rules triggered by form events';
COMMENT ON COLUMN workflows.id IS 'Unique identifier for the workflow';
COMMENT ON COLUMN workflows.form_id IS 'Reference to the parent form';
COMMENT ON COLUMN workflows.name IS 'Display name of the workflow';
COMMENT ON COLUMN workflows.trigger_event IS 'Event that triggers this workflow (e.g., form_submitted)';
COMMENT ON COLUMN workflows.actions IS 'JSONB array of action definitions to execute';
COMMENT ON COLUMN workflows.enabled IS 'Whether this workflow is currently active';
COMMENT ON COLUMN workflows.created_by IS 'User ID who created this workflow';
COMMENT ON COLUMN workflows.created_at IS 'Timestamp when workflow was created';
COMMENT ON COLUMN workflows.updated_at IS 'Timestamp when workflow was last updated';

-- Workflow actions structure (workflows.actions JSONB):
-- [
--   {
--     "type": "send_email",                -- Action type
--     "to": "recipient@example.com",       -- Action-specific configuration
--     "subject": "New submission",
--     "template": "notification"
--   },
--   {
--     "type": "webhook",
--     "url": "https://api.example.com/webhook",
--     "method": "POST",
--     "headers": {...}
--   }
-- ]

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================

COMMENT ON TABLE payments IS 'Payment transactions associated with form submissions';
COMMENT ON COLUMN payments.id IS 'Unique identifier for the payment';
COMMENT ON COLUMN payments.submission_id IS 'Reference to the form submission';
COMMENT ON COLUMN payments.amount IS 'Payment amount in decimal format';
COMMENT ON COLUMN payments.currency IS 'ISO currency code (USD, EUR, etc.)';
COMMENT ON COLUMN payments.provider IS 'Payment provider used (stripe, paystack, flutterwave, opay)';
COMMENT ON COLUMN payments.transaction_id IS 'External transaction ID from payment provider';
COMMENT ON COLUMN payments.status IS 'Payment status: pending, completed, failed, refunded';
COMMENT ON COLUMN payments.payment_date IS 'Timestamp when payment was processed';
COMMENT ON COLUMN payments.created_at IS 'Timestamp when payment record was created';

-- ============================================================================
-- FORM MODULE PREFERENCES TABLE
-- ============================================================================

COMMENT ON TABLE form_module_preferences IS 'User-specific default preferences for form creation';
COMMENT ON COLUMN form_module_preferences.id IS 'Unique identifier';
COMMENT ON COLUMN form_module_preferences.user_id IS 'Reference to the user';
COMMENT ON COLUMN form_module_preferences.preferences IS 'JSONB object containing user preferences';
COMMENT ON COLUMN form_module_preferences.created_at IS 'Timestamp when preferences were created';
COMMENT ON COLUMN form_module_preferences.updated_at IS 'Timestamp when preferences were last updated';

-- Form module preferences structure (form_module_preferences.preferences JSONB):
-- {
--   "accentColor": "#65758B",              -- Default accent color for new forms
--   "accessMode": "public",                -- Default access mode (public or authenticated)
--   "confirmationMessage": "Thanks...",    -- Default confirmation message
--   "fontFamily": "Inter",                 -- Default font family
--   "notificationsEnabled": true,          -- Default notification setting
--   "notificationRecipients": "",          -- Default notification emails
--   "respondentMode": "auto"               -- Default respondent theme mode
-- }

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Additional indexes for form queries
CREATE INDEX IF NOT EXISTS idx_forms_created_by_status 
  ON forms(created_by, status);

CREATE INDEX IF NOT EXISTS idx_forms_status_updated_at 
  ON forms(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_submitted_at 
  ON form_submissions(submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created 
  ON form_submissions(form_id, submitted_at DESC);

-- GIN indexes for JSONB columns to enable efficient querying
CREATE INDEX IF NOT EXISTS idx_forms_fields_gin 
  ON forms USING gin(fields);

CREATE INDEX IF NOT EXISTS idx_forms_settings_gin 
  ON forms USING gin(settings);

CREATE INDEX IF NOT EXISTS idx_form_submissions_data_gin 
  ON form_submissions USING gin(data);

CREATE INDEX IF NOT EXISTS idx_workflows_actions_gin 
  ON workflows USING gin(actions);

-- Index for payment queries
CREATE INDEX IF NOT EXISTS idx_payments_status_date 
  ON payments(status, payment_date DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get form response count (can be used in queries)
CREATE OR REPLACE FUNCTION get_form_response_count(form_uuid UUID)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) 
    FROM form_submissions 
    WHERE form_id = form_uuid
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if form has unpublished changes
CREATE OR REPLACE FUNCTION form_has_unpublished_changes(form_row forms)
RETURNS BOOLEAN AS $$
DECLARE
  settings_obj JSONB;
BEGIN
  settings_obj := form_row.settings;
  RETURN COALESCE(
    (settings_obj->>'hasUnpublishedChanges')::boolean, 
    false
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get form lifecycle state
CREATE OR REPLACE FUNCTION get_form_lifecycle(form_row forms)
RETURNS TEXT AS $$
DECLARE
  settings_obj JSONB;
BEGIN
  IF form_row.status = 'archived' THEN
    RETURN 'archived';
  ELSIF form_row.status = 'draft' THEN
    RETURN 'draft';
  END IF;
  
  settings_obj := form_row.settings;
  IF (settings_obj->'lifecycle'->>'lifecycle') = 'paused' THEN
    RETURN 'paused';
  ELSIF COALESCE((settings_obj->>'hasUnpublishedChanges')::boolean, false) THEN
    RETURN 'update_ready';
  ELSE
    RETURN 'published';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- DATA VALIDATION CONSTRAINTS
-- ============================================================================

-- Add check constraint for valid field types (informational - not enforced on JSONB)
COMMENT ON COLUMN forms.fields IS 
  'JSONB array of field objects. Valid field types: shortText, longText, email, phone, number, url, dropdown, radio, checkboxes, yesNo, rating, ranking, date, time, dateRange, appointment, file, imageChoice, signature, camera, section, pageBreak, heading, divider, payment, product, coupon, hidden, calculated';

-- Add check constraint for logic operators (informational)
COMMENT ON COLUMN forms.settings IS 
  'JSONB object. Logic operators: equals, not_equals, contains, greater_than, less_than, is_answered. Logic actions: show, hide, skip_to, require. Payment providers: workspace, stripe, paystack, flutterwave, opay';

-- ============================================================================
-- SAMPLE QUERIES FOR REFERENCE
-- ============================================================================

-- Query forms with response counts
-- SELECT 
--   f.*,
--   (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id) as response_count
-- FROM forms f
-- WHERE f.created_by = 'user-uuid'
-- ORDER BY f.updated_at DESC;

-- Query submissions with partial vs completed status
-- SELECT 
--   s.*,
--   s.data->'_meta'->>'status' as submission_status,
--   s.data->'_meta'->>'formVersion' as form_version
-- FROM form_submissions s
-- WHERE s.form_id = 'form-uuid'
-- ORDER BY s.submitted_at DESC;

-- Query forms with specific field types
-- SELECT f.id, f.title
-- FROM forms f,
--      jsonb_array_elements(f.fields) as field
-- WHERE field->>'type' = 'payment'
--   AND f.status = 'published';

-- Query forms with logic rules
-- SELECT f.id, f.title,
--        jsonb_array_length(f.settings->'logic') as logic_count
-- FROM forms f
-- WHERE jsonb_array_length(f.settings->'logic') > 0;

-- Query payment-enabled forms
-- SELECT f.id, f.title,
--        f.settings->'payment'->>'provider' as payment_provider,
--        (f.settings->'payment'->>'amount')::numeric as amount
-- FROM forms f
-- WHERE (f.settings->'payment'->>'enabled')::boolean = true
--   AND f.status = 'published';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- This migration documents and validates the comprehensive form module schema.
-- All form data (fields, settings, logic, themes, payment) is stored as JSONB
-- in the forms table, providing maximum flexibility while maintaining structure
-- through application-level validation and TypeScript types.
