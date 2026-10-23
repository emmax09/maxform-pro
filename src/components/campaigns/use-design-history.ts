import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Undo/redo over the builder design.
 *
 * The host owns the design, so history lives here rather than inside the
 * builder — that way the email template editor and the campaign editor get the
 * same stack from one implementation.
 *
 * Typing produces a change per keystroke, which would make undo walk back one
 * letter at a time. Edits that land within `coalesceMs` of each other therefore
 * replace the previous entry instead of pushing a new one, so one undo steps
 * back a phrase rather than a character.
 */
const LIMIT = 100;
const COALESCE_MS = 550;

export type DesignHistory<T> = {
  value: T;
  set: (next: T) => void;
  /** Replaces the value without recording a step — used when loading a draft. */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useDesignHistory<T>(initial: T): DesignHistory<T> {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);
  const lastEditAt = useRef(0);

  const set = useCallback((next: T) => {
    setPresent((current) => {
      if (Object.is(current, next)) return current;
      const now = Date.now();
      const rapid = now - lastEditAt.current < COALESCE_MS;
      lastEditAt.current = now;
      // A rapid follow-up edit overwrites the step it is continuing, so the
      // stack holds meaningful states rather than one entry per keypress.
      if (!rapid) {
        setPast((entries) => [...entries, current].slice(-LIMIT));
      }
      setFuture([]);
      return next;
    });
  }, []);

  const reset = useCallback((next: T) => {
    lastEditAt.current = 0;
    setPast([]);
    setFuture([]);
    setPresent(next);
  }, []);

  const undo = useCallback(() => {
    lastEditAt.current = 0;
    setPast((entries) => {
      if (!entries.length) return entries;
      const previous = entries[entries.length - 1];
      setPresent((current) => {
        setFuture((ahead) => [current, ...ahead].slice(0, LIMIT));
        return previous;
      });
      return entries.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    lastEditAt.current = 0;
    setFuture((entries) => {
      if (!entries.length) return entries;
      const next = entries[0];
      setPresent((current) => {
        setPast((behind) => [...behind, current].slice(-LIMIT));
        return next;
      });
      return entries.slice(1);
    });
  }, []);

  return useMemo(
    () => ({
      value: present,
      set,
      reset,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    }),
    [future.length, past.length, present, redo, reset, set, undo],
  );
}
