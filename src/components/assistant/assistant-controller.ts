/**
 * A handle on the floating assistant, for the rest of the dashboard.
 *
 * The AI Workspace tab needs to open the assistant with a prompt already
 * typed, or resume a past conversation in it. Both are the same need: one
 * component asking the shell-level assistant to do something. This is the
 * seam, so the tab never has to own a second chat panel of its own.
 *
 * The context and hook live here rather than beside the provider so that the
 * provider's file exports a component and nothing else, which is what keeps
 * fast refresh working.
 */
import { createContext, useContext, useRef } from "react";

export type AssistantCommand = {
  /** Text to place in the composer. Sent immediately unless `send` is false. */
  prompt?: string;
  /** Resume an existing conversation instead of starting a new one. */
  conversationId?: string;
  send?: boolean;
};

export type AssistantCommandHandler = (command: AssistantCommand) => void;

export type AssistantController = {
  /** Called by consumers. No-op until the assistant has mounted. */
  open: (command?: AssistantCommand) => void;
  /** Called by the assistant itself to register its handler. */
  register: (handler: AssistantCommandHandler | null) => void;
};

export const AssistantControllerContext =
  createContext<AssistantController | null>(null);

/**
 * Returns a controller even with no provider above, so a component can be
 * rendered in isolation -- in a test, or on a screen without the assistant --
 * without needing to know whether the assistant exists.
 */
export function useAssistantController(): AssistantController {
  const controller = useContext(AssistantControllerContext);
  const fallback = useRef<AssistantController>({
    open: () => {},
    register: () => {},
  });
  return controller || fallback.current;
}
