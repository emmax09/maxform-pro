-- Rebuilds the system ticket template gallery with detailed front and back
-- designs. Every template keeps the mandatory secure QR on the front, so the
-- event_ticket_design_templates front-QR constraint still holds. Workspace
-- templates and workspace overrides are never touched: they are the rows with
-- created_by set, and this migration only writes system rows.

INSERT INTO event_ticket_design_templates (
  id, name, category, description, theme, front_layout, back_layout, sort_order
)
VALUES
  (
    'summit-grid',
    'Summit Grid',
    'Conference',
    'Crisp editorial hierarchy for conferences, product launches, and professional summits.',
    '{"background": "#F7F9FC", "accent": "#2457E6", "text": "#111827", "muted": "#526071", "edge": "solid", "motif": "grid"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"CONFERENCE PASS","x":7,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":17,"width":59,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":40,"width":59,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":7,"y":56,"width":59,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Access level","x":7,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"Doors open 45 minutes before the opening keynote.","x":7,"y":88,"width":59,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":73,"y":23,"width":19}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Attendee information","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"This pass admits one named attendee. Photo ID may be requested at registration. Sessions are recorded and may be published.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Registration desk · help@yourevent.com","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    10
  ),
  (
    'noir-stage',
    'Noir Stage',
    'Concert & Live',
    'High-contrast admission with a tear-off stub for concerts, comedy, and nightlife.',
    '{"background": "#0B0B0D", "accent": "#F43F5E", "text": "#FFFFFF", "muted": "#A1A1AA", "edge": "perforated", "motif": "bars"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"ADMIT ONE","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":6.5,"y":56,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Standing / seated","x":6.5,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"No re-entry once the headline set begins.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Before you arrive","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Doors open one hour before showtime. Small bags only. Latecomers are seated at a suitable break. Tickets are non-transferable once scanned.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Box office · tickets@yourvenue.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    20
  ),
  (
    'atelier-gala',
    'Atelier Gala',
    'Gala & Formal',
    'Restrained luxury with a double frame for awards nights, dinners, and charity galas.',
    '{"background": "#FFFCF5", "accent": "#9A6A12", "text": "#262117", "muted": "#766A54", "edge": "double", "motif": "monogram"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"AN INVITATION","x":4,"y":10,"width":62,"size":"small","align":"center"},
      {"id":"event-name","type":"event_name","label":"Event name","x":4,"y":17,"width":62,"size":"large","align":"center"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":4,"y":41,"width":62,"size":"small","align":"center"},
      {"id":"attendee","type":"attendee_name","label":"Guest","x":4,"y":56,"width":62,"size":"medium","align":"center"},
      {"id":"ticket-type","type":"ticket_type","label":"Seating","x":4,"y":75,"width":62,"size":"small","align":"center"},
      {"id":"note","type":"custom_text","label":"Black tie. Carriages at midnight.","x":4,"y":89,"width":62,"size":"small","align":"center"},
      {"id":"qr","type":"qr","label":"Secure QR","x":75,"y":24,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Evening programme","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"Reception at 6:30 PM, dinner served at 7:30 PM. This invitation admits the named guest only and should be presented on arrival.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Concierge · guests@yourgala.com","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Invitation number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    30
  ),
  (
    'field-notes',
    'Field Notes',
    'Workshop & Class',
    'Warm, practical design for classes, workshops, retreats, and community learning.',
    '{"background": "#F4F8F1", "accent": "#297A57", "text": "#173D2D", "muted": "#5E746A", "edge": "solid", "motif": "rule"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"WORKSHOP PLACE","x":7,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":17,"width":59,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":40,"width":59,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Participant","x":7,"y":56,"width":59,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Session","x":7,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"Materials and refreshments are included.","x":7,"y":88,"width":59,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":73,"y":23,"width":19}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"What to bring","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"Arrive 15 minutes early for setup. Bring a laptop and notebook. Places may be transferred to a colleague up to 24 hours before the session.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Facilitator · learn@yourstudio.com","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Registration number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    40
  ),
  (
    'festival-color',
    'Festival Color',
    'Festival',
    'Expressive color blocking and a stub for festivals, fairs, pop-ups, and multi-stage events.',
    '{"background": "#FFF7ED", "accent": "#EA580C", "text": "#431407", "muted": "#9A3412", "edge": "perforated", "motif": "blocks"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"FESTIVAL PASS","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":6.5,"y":56,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Pass type","x":6.5,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"Wristband exchange at Gate B from 10:00 AM.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"On the grounds","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Keep this pass on you at all times. Re-entry is allowed with a valid wristband. The programme may change due to weather.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Info tent · hello@yourfestival.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    50
  ),
  (
    'vip-carbon',
    'VIP Carbon',
    'VIP & Premium',
    'A refined dark credential for VIP lounges, backstage access, and hospitality tiers.',
    '{"background": "#18181B", "accent": "#D4AF37", "text": "#FAFAFA", "muted": "#A1A1AA", "edge": "double", "motif": "carbon"}'::jsonb,
    '[
      {"id":"ticket-type","type":"ticket_type","label":"Tier","x":7,"y":10,"width":42,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":24,"width":59,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":47,"width":59,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Guest","x":7,"y":63,"width":59,"size":"medium"},
      {"id":"note","type":"custom_text","label":"Lounge access from 5:00 PM · Host: N. Adeyemi","x":7,"y":84,"width":59,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":74,"y":22,"width":18}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Hospitality details","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"This credential is issued to the named guest and is not transferable. Please present it to lounge staff on entry and keep it visible backstage.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Guest relations · vip@yourevent.com","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Credential number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    60
  ),
  (
    'stadium-pass',
    'Stadium Pass',
    'Sports',
    'Bold matchday admission with block, row, and seat lines plus a scannable stub.',
    '{"background": "#0A1A2F", "accent": "#A3E635", "text": "#F8FAFC", "muted": "#94A3B8", "edge": "perforated", "motif": "chevron"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"MATCHDAY TICKET","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Kick-off & ground","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Supporter","x":6.5,"y":56,"width":40,"size":"medium"},
      {"id":"seat","type":"custom_text","label":"BLOCK 12 · ROW H · SEAT 24","x":6.5,"y":80,"width":46,"size":"small"},
      {"id":"ticket-type","type":"ticket_type","label":"Stand","x":52,"y":74,"width":16,"size":"small"},
      {"id":"note","type":"custom_text","label":"Gates open 90 minutes before kick-off.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Ground regulations","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Persistent standing, pyrotechnics, and alcohol in view of the pitch are prohibited. This ticket may be withdrawn without refund for breach of ground regulations.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Ticket office · tickets@yourclub.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    70
  ),
  (
    'cinema-reel',
    'Cinema Reel',
    'Film & Screening',
    'Classic cinema stub with screen, seat, and certification lines for screenings and premieres.',
    '{"background": "#14110F", "accent": "#F59E0B", "text": "#FAF7F2", "muted": "#A8A29E", "edge": "perforated", "motif": "stripes"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"ADMIT ONE · SCREEN 3","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Film title","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Screening & cinema","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Booked for","x":6.5,"y":56,"width":40,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Seat class","x":6.5,"y":74,"width":30,"size":"small"},
      {"id":"rating","type":"custom_text","label":"CERT 15 · RUNTIME 118 MIN","x":38,"y":80,"width":30,"size":"small"},
      {"id":"note","type":"custom_text","label":"Trailers begin 12 minutes before the feature.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"House rules","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Please silence devices before the feature begins. Recording of any part of the screening is prohibited and will be reported.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Front of house · boxoffice@yourcinema.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    80
  ),
  (
    'midnight-neon',
    'Midnight Neon',
    'Nightlife',
    'Saturated late-night energy with a sunburst wash for club nights and after-parties.',
    '{"background": "#0A0714", "accent": "#8B5CF6", "text": "#F5F3FF", "muted": "#A5A0C0", "edge": "perforated", "motif": "rays"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"GUEST LIST · 18+","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":6.5,"y":56,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Entry","x":6.5,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"Entry closes at 1:00 AM. Dress code applies.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Door policy","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Photo ID is required for every guest. Management reserves the right to refuse entry. This ticket is void once it has been scanned at the door.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Door team · guestlist@yourclub.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    90
  ),
  (
    'bloom-invite',
    'Bloom Invite',
    'Wedding & Private',
    'Soft, centered typography for weddings, showers, anniversaries, and private celebrations.',
    '{"background": "#FFF5F7", "accent": "#C2708A", "text": "#3F2732", "muted": "#8A6B75", "edge": "double", "motif": "waves"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"TOGETHER WITH THEIR FAMILIES","x":4,"y":10,"width":62,"size":"small","align":"center"},
      {"id":"event-name","type":"event_name","label":"Event name","x":4,"y":17,"width":62,"size":"large","align":"center"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":4,"y":41,"width":62,"size":"small","align":"center"},
      {"id":"attendee","type":"attendee_name","label":"Guest","x":4,"y":56,"width":62,"size":"medium","align":"center"},
      {"id":"ticket-type","type":"ticket_type","label":"Admits","x":4,"y":75,"width":62,"size":"small","align":"center"},
      {"id":"note","type":"custom_text","label":"Reception to follow · Kindly RSVP","x":4,"y":89,"width":62,"size":"small","align":"center"},
      {"id":"qr","type":"qr","label":"Secure QR","x":75,"y":24,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"The day at a glance","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"Ceremony at 2:00 PM followed by drinks on the lawn. Dinner is served at 6:00 PM. Please let us know of any dietary requirements in advance.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"With love · rsvp@ourwedding.com","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Invitation number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    100
  ),
  (
    'civic-cause',
    'Civic Cause',
    'Community & Charity',
    'Friendly and legible for fundraisers, town halls, volunteer days, and member events.',
    '{"background": "#F2FBFA", "accent": "#0F766E", "text": "#10322F", "muted": "#56736F", "edge": "solid", "motif": "dots"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"COMMUNITY TICKET","x":7,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":17,"width":59,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":40,"width":59,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Supporter","x":7,"y":56,"width":59,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Supporter tier","x":7,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"Every ticket funds one place for a local family.","x":7,"y":88,"width":59,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":73,"y":23,"width":19}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Thank you","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"Your ticket is a donation to the programme and is non-refundable, though it may be transferred to another supporter at any time before the event.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Volunteers · hello@yourcause.org","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    110
  ),
  (
    'dev-terminal',
    'Dev Terminal',
    'Tech Meetup',
    'Terminal-inspired dark pass for meetups, hackathons, and developer conferences.',
    '{"background": "#0B1120", "accent": "#34D399", "text": "#E2E8F0", "muted": "#7C8CA5", "edge": "solid", "motif": "grid"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"> admit --one","x":7,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":17,"width":59,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":40,"width":59,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Handle","x":7,"y":56,"width":45,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Track","x":7,"y":74,"width":30,"size":"small"},
      {"id":"wifi","type":"custom_text","label":"WIFI: guest · PASS: buildthings","x":40,"y":80,"width":27,"size":"small"},
      {"id":"note","type":"custom_text","label":"Talks start at 6:30 PM. Pizza from 6:00 PM.","x":7,"y":88,"width":59,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":73,"y":23,"width":19}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Code of conduct","x":7,"y":11,"width":86,"size":"medium"},
      {"id":"terms","type":"terms","label":"Be excellent to each other. Harassment of any kind ends your attendance without refund. Report concerns to any organizer wearing a green lanyard.","x":7,"y":30,"width":86,"size":"small"},
      {"id":"support","type":"custom_text","label":"Organizers · crew@yourmeetup.dev","x":7,"y":78,"width":50,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":62,"y":72,"width":31,"size":"small","align":"right"}
    ]'::jsonb,
    120
  ),
  (
    'boarding-pass',
    'Boarding Pass',
    'Travel & Tour',
    'Airline-style stub with route, gate, and boarding lines for tours, trips, and transfers.',
    '{"background": "#FFFFFF", "accent": "#4338CA", "text": "#1E1B4B", "muted": "#6B7280", "edge": "perforated", "motif": "topo"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"BOARDING PASS","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Tour name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Departs","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Passenger","x":6.5,"y":56,"width":36,"size":"medium"},
      {"id":"route","type":"custom_text","label":"LOS → ABV · GATE 4","x":46,"y":62,"width":22,"size":"small"},
      {"id":"ticket-type","type":"ticket_type","label":"Class","x":6.5,"y":76,"width":26,"size":"small"},
      {"id":"boarding","type":"custom_text","label":"BOARDING 07:20 · SEAT 14A","x":36,"y":82,"width":32,"size":"small"},
      {"id":"note","type":"custom_text","label":"Please be at the departure point 30 minutes early.","x":6.5,"y":90,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Travel information","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Please be at the departure point 30 minutes before the listed time. One cabin bag per passenger. Carry photo ID for the whole trip.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Tour desk · travel@yourtours.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    130
  ),
  (
    'carnival-kids',
    'Carnival Kids',
    'Kids & Family',
    'Playful confetti design for family days, birthday parties, and school events.',
    '{"background": "#FFFBEB", "accent": "#DB2777", "text": "#422006", "muted": "#92722C", "edge": "perforated", "motif": "confetti"}'::jsonb,
    '[
      {"id":"kicker","type":"custom_text","label":"FAMILY TICKET","x":6.5,"y":9,"width":48,"size":"small"},
      {"id":"event-name","type":"event_name","label":"Event name","x":6.5,"y":17,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":6.5,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Booked for","x":6.5,"y":56,"width":58,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Admits","x":6.5,"y":74,"width":42,"size":"small"},
      {"id":"note","type":"custom_text","label":"One adult must accompany each child under 12.","x":6.5,"y":88,"width":58,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":76,"y":21,"width":17}
    ]'::jsonb,
    '[
      {"id":"back-heading","type":"custom_text","label":"Good to know","x":7,"y":11,"width":60,"size":"medium"},
      {"id":"terms","type":"terms","label":"Face painting, games, and the bouncy castle run all afternoon. Please collect a wristband for every child at the welcome desk.","x":7,"y":30,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"Helpers · fun@yourevent.com","x":7,"y":78,"width":60,"size":"small"},
      {"id":"qr-back","type":"qr","label":"Secure QR","x":76,"y":24,"width":16}
    ]'::jsonb,
    140
  ),
  (
    'minimal-mono',
    'Minimal Mono',
    'Minimal',
    'Quiet black-and-white typography that lets a strong event name carry the design.',
    '{"background": "#FFFFFF", "accent": "#18181B", "text": "#09090B", "muted": "#71717A", "edge": "solid", "motif": "none"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":16,"width":60,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":42,"width":60,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee","x":7,"y":62,"width":60,"size":"medium"},
      {"id":"ticket-type","type":"ticket_type","label":"Ticket","x":7,"y":82,"width":42,"size":"small"},
      {"id":"qr","type":"qr","label":"Secure QR","x":74,"y":26,"width":18}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Present this ticket at the door. Admission is subject to the event terms and refund policy.","x":7,"y":22,"width":60,"size":"small"},
      {"id":"support","type":"custom_text","label":"hello@yourevent.com","x":7,"y":60,"width":60,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":7,"y":76,"width":45,"size":"small"}
    ]'::jsonb,
    150
  ),
  (
    'studio-blank',
    'Studio Blank',
    'Blank',
    'A neutral, production-ready canvas for a completely custom design.',
    '{"background": "#FFFFFF", "accent": "#65758B", "text": "#18181B", "muted": "#71717A", "edge": "solid", "motif": "none"}'::jsonb,
    '[
      {"id":"event-name","type":"event_name","label":"Event name","x":7,"y":14,"width":58,"size":"large"},
      {"id":"event-details","type":"event_details","label":"Date & venue","x":7,"y":40,"width":58,"size":"small"},
      {"id":"attendee","type":"attendee_name","label":"Attendee name","x":7,"y":62,"width":58,"size":"medium"},
      {"id":"qr","type":"qr","label":"Secure QR","x":74,"y":27,"width":19}
    ]'::jsonb,
    '[
      {"id":"terms","type":"terms","label":"Terms & refund policy","x":8,"y":20,"width":72,"size":"small"},
      {"id":"ticket-number","type":"ticket_number","label":"Ticket number","x":8,"y":78,"width":72,"size":"small"}
    ]'::jsonb,
    900
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
  updated_at = NOW()
WHERE event_ticket_design_templates.created_by IS NULL;

COMMENT ON TABLE event_ticket_design_templates IS
  'Database-owned front/back ticket starter designs consumed by Ticket Studio.';
