# Integration OAuth Setup

MaxForm keeps provider client secrets and OAuth tokens on the server. The
dashboard receives provider availability, account labels, and selectable
resources only.

## Required server variables

Set these in the server runtime, never in variables prefixed with `VITE_`:

```dotenv
DATABASE_URL=
INTEGRATION_ENCRYPTION_KEY=
PUBLIC_APP_URL=https://app.example.com

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AIRTABLE_CLIENT_ID=
AIRTABLE_CLIENT_SECRET=
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
MAILCHIMP_CLIENT_ID=
MAILCHIMP_CLIENT_SECRET=
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
```

`INTEGRATION_ENCRYPTION_KEY` must be at least 24 random characters. Rotating it
requires reconnecting accounts encrypted with the previous key.

## Callback URLs

Register one exact callback URL per provider. Replace the domain with
`PUBLIC_APP_URL`:

```text
/api/integrations/oauth?action=callback&provider=slack
/api/integrations/oauth?action=callback&provider=google_sheets
/api/integrations/oauth?action=callback&provider=airtable
/api/integrations/oauth?action=callback&provider=hubspot
/api/integrations/oauth?action=callback&provider=mailchimp
/api/integrations/oauth?action=callback&provider=notion
```

For local development the full Slack example is:

```text
http://localhost:8080/api/integrations/oauth?action=callback&provider=slack
```

## Provider permissions

- Slack: incoming webhooks and message posting.
- Google: identity, spreadsheets, and read-only Drive metadata for the
  spreadsheet picker.
- Airtable: record read/write and base schema read.
- HubSpot: contact read/write.
- Mailchimp: account metadata, audiences, subscribers, and tags.
- Notion: user identity and pages/data sources shared with the integration.

The provider catalog marks an integration unavailable until both client
credentials, the database URL, and the encryption key are present. It never
returns the missing variable name to the dashboard.

## Security behavior

- OAuth starts from an authenticated server request; the browser cannot choose
  a user ID.
- Consent opens in a child window while the dashboard stays mounted.
- Callback pages send only connected, cancelled, or error status to the
  same-origin opener.
- OAuth tokens are AES-256-GCM encrypted before database storage.
- Connection queries exclude encrypted credentials.
- Provider actions load their saved configuration and submission data on the
  server rather than accepting either from the public form browser.
