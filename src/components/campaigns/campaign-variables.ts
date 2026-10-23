/**
 * The personalisation a campaign can insert.
 *
 * One catalogue, so the composer, the builder and the plain-text editor all
 * offer the same set. Only the label is ever shown — the token is what gets
 * written into the document, never what the writer has to read.
 */
export type CampaignVariable = {
  /** Stored form, e.g. `{{contact.firstName}}`. */
  token: string;
  label: string;
  /** What it resolves to, shown as the example under the label. */
  sample: string;
};

export type CampaignVariableGroup = {
  key: string;
  label: string;
  note: string;
  variables: CampaignVariable[];
};

export const campaignVariableGroups: CampaignVariableGroup[] = [
  {
    key: "contact",
    label: "Recipient",
    note: "Filled per person from the CRM. Blank fields fall back to nothing.",
    variables: [
      { token: "{{contact.firstName}}", label: "First name", sample: "Ada" },
      { token: "{{contact.lastName}}", label: "Last name", sample: "Lovelace" },
      { token: "{{contact.name}}", label: "Full name", sample: "Ada Lovelace" },
      { token: "{{contact.email}}", label: "Email address", sample: "ada@example.com" },
      { token: "{{contact.company}}", label: "Company", sample: "Analytical Engines" },
      { token: "{{contact.jobTitle}}", label: "Job title", sample: "Head of Research" },
      { token: "{{contact.city}}", label: "City", sample: "London" },
    ],
  },
  {
    key: "workspace",
    label: "Your workspace",
    note: "The same for every recipient.",
    variables: [
      { token: "{{workspace.name}}", label: "Workspace name", sample: "Acme" },
      { token: "{{workspace.address}}", label: "Mailing address", sample: "1 Example Street" },
      { token: "{{workspace.website}}", label: "Website", sample: "acme.com" },
    ],
  },
  {
    key: "campaign",
    label: "This campaign",
    note: "Taken from the campaign as it is sent.",
    variables: [
      { token: "{{campaign.subject}}", label: "Subject line", sample: "Up to 60% off" },
      { token: "{{campaign.sentDate}}", label: "Send date", sample: "3 August 2026" },
    ],
  },
  {
    key: "links",
    label: "Required links",
    note: "Marketing email must carry an unsubscribe link.",
    variables: [
      { token: "{{unsubscribe.link}}", label: "Unsubscribe link", sample: "Unsubscribe" },
      { token: "{{preferences.link}}", label: "Email preferences link", sample: "Update preferences" },
    ],
  },
];

/** Flat lookup, for turning a stored token back into its label. */
export const campaignVariableLabels: Record<string, string> = Object.fromEntries(
  campaignVariableGroups.flatMap((group) =>
    group.variables.map((variable) => [variable.token, variable.label]),
  ),
);
