-- Make the ticket-delivery template available to workspaces created before
-- event ticket delivery was introduced. This only inserts missing built-ins;
-- a workspace's custom template is never overwritten.

INSERT INTO email_templates (
  user_id,
  key,
  module,
  name,
  subject,
  html_body,
  text_body,
  blocks,
  is_custom
)
SELECT
  account.id,
  'event_ticket_delivery',
  'events',
  'Ticket delivery',
  'Your ticket{{#if tickets.quantity}} ({{tickets.quantity}}){{/if}} for {{event.name}}',
  '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,sans-serif;color:#101828"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e8ecf4;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 10px;color:#0f766e;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Ticket ready</p><h1 style="margin:0 0 14px;font-size:26px;line-height:1.25">Your event ticket is ready</h1><p style="margin:0 0 22px;color:#5a6a85;font-size:15px;line-height:1.6">Hi {{contact.name}}, your confirmed ticket for {{event.name}} is ready.</p><p style="margin:8px 0;color:#5a6a85">Ticket type: <strong style="color:#101828">{{ticket.type}}</strong></p><p style="margin:8px 0;color:#5a6a85">Ticket number: <strong style="color:#101828">{{ticket.number}}</strong></p><p style="margin:8px 0 24px;color:#5a6a85">Quantity: <strong style="color:#101828">{{tickets.quantity}}</strong></p><a href="{{ticket.downloadUrl}}" style="display:inline-block;border-radius:10px;background:#0f766e;color:#ffffff;padding:14px 24px;font-size:14px;font-weight:700;text-decoration:none">Open secure ticket page</a><p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e8ecf4;color:#5a6a85;font-size:13px;line-height:1.6">Present the QR code or ticket number at the event entrance. If your details look wrong, contact the event organizer.</p><p style="margin:24px 0 0;color:#8a96aa;font-size:12px">Sent by {{workspace.name}}</p></td></tr></table></td></tr></table></body></html>',
  'Ticket ready\n\nHi {{contact.name}}, your confirmed ticket for {{event.name}} is ready.\n\nTicket type: {{ticket.type}}\nTicket number: {{ticket.number}}\nQuantity: {{tickets.quantity}}\n\nOpen your secure ticket page: {{ticket.downloadUrl}}\n\nPresent the QR code or ticket number at the event entrance.\n\nSent by {{workspace.name}}',
  '[{"type":"campaign_design","version":1,"accent":"#0F766E","pageBackground":"#F4F6FB","cardBackground":"#FFFFFF","footerText":"Sent by {{workspace.name}}","blocks":[{"type":"text","content":"Your event ticket is ready","align":"left"},{"type":"text","content":"Ticket type: {{ticket.type}} · Ticket number: {{ticket.number}} · Quantity: {{tickets.quantity}}","align":"left"},{"type":"event_ticket","content":"Your ticket","align":"left"},{"type":"button","content":"Open secure ticket page","href":"{{ticket.downloadUrl}}","align":"left"},{"type":"text","content":"Present the QR code or ticket number at the event entrance.","align":"left"}]}]'::jsonb,
  FALSE
FROM users account
WHERE NOT EXISTS (
  SELECT 1
  FROM email_templates existing
  WHERE existing.user_id = account.id
    AND existing.key = 'event_ticket_delivery'
)
ON CONFLICT (user_id, key) DO NOTHING;
