-- Make public form and event accents inherit workspace branding by default.
-- Explicit custom themes are identified by accentColorMode = 'custom' or by a
-- non-legacy colour from before the inheritance field existed.

UPDATE form_module_preferences preferences
SET preferences = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(preferences.preferences, '{}'::jsonb),
          '{accentColor}',
          to_jsonb(COALESCE(NULLIF(company.brand_color, ''), '#236BFE')),
          TRUE
        ),
        '{accentColorMode}',
        '"workspace"'::jsonb,
        TRUE
      ),
      '{confirmation}',
      COALESCE(preferences.preferences->'confirmation', '{}'::jsonb)
        || jsonb_build_object(
          'accentColor',
          COALESCE(NULLIF(company.brand_color, ''), '#236BFE')
        ),
      TRUE
    ),
    updated_at = NOW()
FROM company_settings company
WHERE preferences.user_id = company.user_id
  AND (
    preferences.preferences->>'accentColor' IS NULL
    OR UPPER(preferences.preferences->>'accentColor') IN ('#236BFE', '#2563EB', '#65758B')
    OR UPPER(preferences.preferences->>'accentColor') = UPPER(company.brand_color)
  );

UPDATE forms form
SET settings = jsonb_set(
      COALESCE(form.settings, '{}'::jsonb),
      '{theme}',
      COALESCE(form.settings->'theme', '{}'::jsonb)
        || jsonb_build_object(
          'accentColor', COALESCE(NULLIF(company.brand_color, ''), '#236BFE'),
          'accentColorMode', 'workspace'
        ),
      TRUE
    ),
    updated_at = NOW()
FROM company_settings company
WHERE form.created_by = company.user_id
  AND COALESCE(form.settings->'theme'->>'accentColorMode', 'workspace') <> 'custom'
  AND (
    form.settings->'theme'->>'accentColor' IS NULL
    OR UPPER(form.settings->'theme'->>'accentColor') IN ('#236BFE', '#2563EB', '#65758B')
    OR UPPER(form.settings->'theme'->>'accentColor') = UPPER(company.brand_color)
  );

UPDATE form_settings settings
SET theme = COALESCE(settings.theme, '{}'::jsonb)
      || jsonb_build_object(
        'accentColor', COALESCE(NULLIF(company.brand_color, ''), '#236BFE'),
        'accentColorMode', 'workspace'
      ),
    updated_at = NOW()
FROM forms form
JOIN company_settings company ON company.user_id = form.created_by
WHERE settings.form_id = form.id
  AND COALESCE(settings.theme->>'accentColorMode', 'workspace') <> 'custom'
  AND (
    settings.theme->>'accentColor' IS NULL
    OR UPPER(settings.theme->>'accentColor') IN ('#236BFE', '#2563EB', '#65758B')
    OR UPPER(settings.theme->>'accentColor') = UPPER(company.brand_color)
  );

UPDATE forms form
SET settings = jsonb_set(
      form.settings,
      '{liveSnapshot}',
      form.settings->'liveSnapshot'
        || jsonb_build_object(
          'theme',
          COALESCE(form.settings->'liveSnapshot'->'theme', '{}'::jsonb)
            || jsonb_build_object(
              'accentColor', COALESCE(NULLIF(company.brand_color, ''), '#236BFE'),
              'accentColorMode', 'workspace'
            )
        ),
      TRUE
    ),
    updated_at = NOW()
FROM company_settings company
WHERE form.created_by = company.user_id
  AND jsonb_typeof(form.settings->'liveSnapshot') = 'object'
  AND COALESCE(form.settings->'liveSnapshot'->'theme'->>'accentColorMode', 'workspace') <> 'custom'
  AND (
    form.settings->'liveSnapshot'->'theme'->>'accentColor' IS NULL
    OR UPPER(form.settings->'liveSnapshot'->'theme'->>'accentColor') IN ('#236BFE', '#2563EB', '#65758B')
    OR UPPER(form.settings->'liveSnapshot'->'theme'->>'accentColor') = UPPER(company.brand_color)
  );

UPDATE form_settings settings
SET live_snapshot = settings.live_snapshot
      || jsonb_build_object(
        'theme',
        COALESCE(settings.live_snapshot->'theme', '{}'::jsonb)
          || jsonb_build_object(
            'accentColor', COALESCE(NULLIF(company.brand_color, ''), '#236BFE'),
            'accentColorMode', 'workspace'
          )
      ),
    updated_at = NOW()
FROM forms form
JOIN company_settings company ON company.user_id = form.created_by
WHERE settings.form_id = form.id
  AND jsonb_typeof(settings.live_snapshot) = 'object'
  AND COALESCE(settings.live_snapshot->'theme'->>'accentColorMode', 'workspace') <> 'custom'
  AND (
    settings.live_snapshot->'theme'->>'accentColor' IS NULL
    OR UPPER(settings.live_snapshot->'theme'->>'accentColor') IN ('#236BFE', '#2563EB', '#65758B')
    OR UPPER(settings.live_snapshot->'theme'->>'accentColor') = UPPER(company.brand_color)
  );

UPDATE events event
SET branding = COALESCE(event.branding, '{}'::jsonb)
      || jsonb_build_object(
        'accentColor', COALESCE(NULLIF(company.brand_color, ''), '#236BFE'),
        'accentColorMode', 'workspace'
      ),
    updated_at = NOW()
FROM company_settings company
WHERE event.created_by = company.user_id
  AND COALESCE(event.branding->>'accentColorMode', 'workspace') <> 'custom'
  AND (
    event.branding->>'accentColor' IS NULL
    OR UPPER(event.branding->>'accentColor') IN (
      '#236BFE', '#2563EB', '#65758B', '#DC2626', '#A16207', '#059669', '#0891B2'
    )
    OR UPPER(event.branding->>'accentColor') = UPPER(company.brand_color)
  );
