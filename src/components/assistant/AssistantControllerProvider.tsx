import { useMemo, useRef } from "react";

import {
  AssistantControllerContext,
  type AssistantCommandHandler,
  type AssistantController,
} from "./assistant-controller";

/**
 * Holds the handle the floating assistant registers itself against.
 *
 * Deliberately a ref rather than state: the controller's identity never
 * changes, so consumers do not re-render when the assistant opens or closes.
 */
export function AssistantControllerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const handlerRef = useRef<AssistantCommandHandler | null>(null);

  const controller = useMemo<AssistantController>(
    () => ({
      open: (command = {}) => handlerRef.current?.(command),
      register: (handler) => {
        handlerRef.current = handler;
      },
    }),
    [],
  );

  return (
    <AssistantControllerContext.Provider value={controller}>
      {children}
    </AssistantControllerContext.Provider>
  );
}
