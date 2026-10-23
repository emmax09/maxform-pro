/**
 * Provider-independent MaxForm Email Service.
 *
 * Feature modules call this facade only. Sender resolution, suppression,
 * idempotency, queueing, provider selection, adapter dispatch, logging, and
 * retry policy stay behind the service boundary.
 */
import {
  deliverWorkspaceEmail,
  sendWorkspaceEmail,
  sendWorkspaceEmailNow,
  type WorkspaceEmailDeliveryOptions,
  type WorkspaceEmailInput,
} from "./workspace-email";

export { WorkspaceEmailError } from "./workspace-email";
export type { WorkspaceEmailInput } from "./workspace-email";

export const emailService = Object.freeze({
  stageBulk: (input: WorkspaceEmailInput) =>
    sendWorkspaceEmail({ ...input, autoDeliver: false }),
  schedule: (input: WorkspaceEmailInput) =>
    sendWorkspaceEmail({ ...input, autoDeliver: true }),
  sendNow: (input: WorkspaceEmailInput) => sendWorkspaceEmailNow(input),
  deliver: (logId: string, options?: WorkspaceEmailDeliveryOptions) =>
    deliverWorkspaceEmail(logId, options),
});

export const stageBulkEmail = (input: WorkspaceEmailInput) =>
  emailService.stageBulk(input);
export const scheduleEmail = (input: WorkspaceEmailInput) =>
  emailService.schedule(input);
export const sendEmailNow = (input: WorkspaceEmailInput) => emailService.sendNow(input);
export const deliverEmail = (
  logId: string,
  options?: WorkspaceEmailDeliveryOptions,
) => emailService.deliver(logId, options);
