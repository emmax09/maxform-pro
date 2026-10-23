ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ticketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS section_content JSONB NOT NULL DEFAULT '{
    "about": {"heading": "About this event", "body": ""},
    "agenda": [],
    "speakers": [],
    "sponsors": [],
    "faq": [],
    "venue": {"name": "", "address": "", "directions": "", "mapUrl": ""}
  }'::jsonb;

UPDATE events event
SET ticketing_enabled = EXISTS (
  SELECT 1
  FROM event_ticket_types ticket_type
  WHERE ticket_type.event_id = event.id
);

CREATE TABLE IF NOT EXISTS event_module_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organizer_name TEXT NOT NULL DEFAULT '',
  reply_to_email TEXT NOT NULL DEFAULT '',
  support_email TEXT NOT NULL DEFAULT '',
  default_timezone TEXT NOT NULL DEFAULT 'UTC',
  default_access_control TEXT NOT NULL DEFAULT 'public'
    CHECK (default_access_control IN ('public', 'invite_only', 'password')),
  default_ticketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_refund_policy TEXT NOT NULL DEFAULT '',
  registration_confirmation TEXT NOT NULL DEFAULT
    'You are registered. Event details have been sent to your email.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_ticket_design_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme JSONB NOT NULL DEFAULT '{}',
  front_layout JSONB NOT NULL DEFAULT '[]',
  back_layout JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO event_ticket_design_templates (
  id, name, category, description, theme, front_layout, back_layout, sort_order
)
VALUES
  (
    'summit-grid',
    'Summit Grid',
    'Conference',
    'Crisp editorial hierarchy for conferences, product launches, and professional summits.',
    '{"background":"#F7F9FC","accent":"#2457E6","text":"#111827","muted":"#526071","edge":"solid","motif":"grid"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":12,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":37,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee name","x":7,"y":68,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Ticket type","x":7,"y":83,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":74,"y":28,"width":19}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Terms & refund policy","x":8,"y":18,"width":66,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":8,"y":78,"width":66,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":79,"y":57,"width":13}
    ]'::jsonb,
    10
  ),
  (
    'noir-stage',
    'Noir Stage',
    'Concert & Live',
    'High-contrast admission design for concerts, comedy, nightlife, and live performances.',
    '{"background":"#0B0B0D","accent":"#F43F5E","text":"#FFFFFF","muted":"#A1A1AA","edge":"perforated","motif":"bars"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":13,"width":62,"size":"large"},
      {"id":"ticket-type","type":"ticket_type","label":"Ticket type","x":7,"y":48,"width":54,"size":"medium"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":70,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee name","x":7,"y":84,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":75,"y":28,"width":18}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Entry terms","x":8,"y":18,"width":70,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":8,"y":80,"width":70,"size":"small"}
    ]'::jsonb,
    20
  ),
  (
    'atelier-gala',
    'Atelier Gala',
    'Gala & Formal',
    'Restrained luxury for awards, dinners, charity galas, and premium invitations.',
    '{"background":"#FFFCF5","accent":"#9A6A12","text":"#262117","muted":"#766A54","edge":"double","motif":"monogram"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":10,"y":19,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":10,"y":48,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Guest name","x":10,"y":72,"width":58,"size":"medium"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":30,"width":16}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Guest terms","x":10,"y":22,"width":68,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Invitation number","x":10,"y":78,"width":68,"size":"small"}
    ]'::jsonb,
    30
  ),
  (
    'field-notes',
    'Field Notes',
    'Workshop & Class',
    'Warm, practical ticket design for classes, workshops, retreats, and community learning.',
    '{"background":"#F4F8F1","accent":"#297A57","text":"#173D2D","muted":"#5E746A","edge":"solid","motif":"rule"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Workshop name","x":8,"y":14,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Schedule & room","x":8,"y":42,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Participant","x":8,"y":67,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Pass","x":8,"y":83,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":75,"y":29,"width":18}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Workshop notes","x":8,"y":17,"width":72,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Registration number","x":8,"y":80,"width":72,"size":"small"}
    ]'::jsonb,
    40
  ),
  (
    'festival-color',
    'Festival Color',
    'Festival',
    'Expressive color blocking for festivals, fairs, pop-ups, and multi-stage events.',
    '{"background":"#FFF7ED","accent":"#EA580C","text":"#431407","muted":"#9A3412","edge":"perforated","motif":"blocks"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Festival name","x":7,"y":11,"width":60,"size":"large"},
      {"id":"ticket-type","type":"ticket_type","label":"Pass type","x":7,"y":46,"width":55,"size":"medium"},
      {"id":"event-details","type":"event_details","label":"Date & grounds","x":7,"y":67,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":7,"y":82,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":75,"y":27,"width":19}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Festival terms","x":8,"y":18,"width":70,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Pass number","x":8,"y":81,"width":70,"size":"small"}
    ]'::jsonb,
    50
  ),
  (
    'vip-carbon',
    'VIP Carbon',
    'VIP / Premium',
    'A refined dark credential for VIP lounges, backstage, hospitality, and premium tiers.',
    '{"background":"#18181B","accent":"#D4AF37","text":"#FAFAFA","muted":"#A1A1AA","edge":"double","motif":"carbon"}'::jsonb,
    '[
      {"id":"ticket-type","type":"ticket_type","label":"VIP tier","x":8,"y":12,"width":58,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":8,"y":29,"width":58,"size":"large"},
      {"id":"attendee","type":"attendee_name","label":"Guest","x":8,"y":69,"width":58,"size":"medium"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":8,"y":84,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":30,"width":17}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"VIP terms","x":9,"y":19,"width":68,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Credential number","x":9,"y":80,"width":68,"size":"small"}
    ]'::jsonb,
    60
  ),
  (
    'studio-blank',
    'Studio Blank',
    'Blank',
    'A neutral, production-ready canvas for a completely custom design.',
    '{"background":"#FFFFFF","accent":"#65758B","text":"#18181B","muted":"#71717A","edge":"solid","motif":"none"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":12,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":38,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee name","x":7,"y":68,"width":58,"size":"medium"},
      {"id":"qr","type":"qr","label":"Secure QR","x":74,"y":27,"width":19}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Terms & refund policy","x":8,"y":18,"width":72,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":8,"y":80,"width":72,"size":"small"}
    ]'::jsonb,
    90
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  theme = EXCLUDED.theme,
  front_layout = EXCLUDED.front_layout,
  back_layout = EXCLUDED.back_layout,
  active = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

UPDATE event_templates
SET event_defaults = event_defaults ||
  CASE id
    WHEN 'conference-summit' THEN '{"ticketingEnabled": true}'::jsonb
    WHEN 'concert-live' THEN '{"ticketingEnabled": true}'::jsonb
    WHEN 'gala-formal' THEN '{"ticketingEnabled": true}'::jsonb
    ELSE '{"ticketingEnabled": false}'::jsonb
  END,
  updated_at = NOW();

COMMENT ON TABLE event_module_preferences IS
  'Workspace-level defaults used by every new Event while remaining editable without an event.';
COMMENT ON TABLE event_ticket_design_templates IS
  'Database-owned front/back ticket starter designs consumed by Ticket Studio.';
