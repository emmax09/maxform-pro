import type { ContactListRecord } from "@/lib/contacts";

export const MAX_CUSTOM_AUDIENCE_RECIPIENTS = 10_000;

/**
 * Counts used by campaign recipient controls. A suppression or unsubscribe is
 * excluded from a new send, while older cached list records safely fall back
 * to their raw member count until refreshed.
 */
export const campaignListRecipientCount = (list: ContactListRecord) =>
  list.deliverableMemberCount ?? list.memberCount;
