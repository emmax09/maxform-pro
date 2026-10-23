import type { AssistantScreenContext } from "@/lib/ai-assistant";

/**
 * Openers per module. These are questions the tools can actually answer from
 * that screen, not generic prompts -- a suggestion that leads to "I can't do
 * that here" is worse than no suggestion.
 */
const suggestionsByModule: Record<string, string[]> = {
  payments: [
    "Is a payment provider connected?",
    "Why did my most recent payment fail?",
    "What have we taken this month?",
  ],
  orders: [
    "How much revenue this month?",
    "Which orders failed or were refunded?",
    "Show me this week's orders",
  ],
  crm: [
    "Summarise my most recently added contact",
    "Who are my newest leads?",
    "Draft a follow-up email to a contact",
  ],
  analytics: [
    "How has the workspace done this month?",
    "Which forms are converting best?",
    "What changed since last month?",
  ],
  forms: [
    "Help me design a form",
    "Which of my forms gets the most responses?",
    "What should I ask on a signup form?",
  ],
  campaigns: [
    "Draft a campaign for returning customers",
    "What should I put in a subject line?",
    "Who should receive my next campaign?",
  ],
  emails: [
    "Draft an email to a contact",
    "Is my sending identity set up?",
    "Summarise recent email activity",
  ],
  events: [
    "Help me plan an event",
    "How are ticket sales going?",
    "What should I put on the event page?",
  ],
  appointments: [
    "How does my week look?",
    "Help me set up a booking page",
    "What availability should I offer?",
  ],
  home: [
    "What needs my attention today?",
    "How has the workspace done this month?",
    "Summarise my recent activity",
  ],
  ai: [
    "What can you do in this workspace?",
    "Summarise how this month has gone",
    "Draft an email to a contact",
  ],
};

const fallbackSuggestions = [
  "What can you do here?",
  "What needs my attention today?",
  "How has the workspace done this month?",
];

export const suggestionsFor = (context: AssistantScreenContext) => {
  const forModule = context.module
    ? suggestionsByModule[context.module]
    : undefined;
  const base = forModule || fallbackSuggestions;
  // With a record open, the most likely question is about that record.
  if (context.recordType && context.recordId) {
    return [`Explain this ${context.recordType}`, ...base].slice(0, 3);
  }
  return base.slice(0, 3);
};
