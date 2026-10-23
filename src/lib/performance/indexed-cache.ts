import Dexie, { type Table } from "dexie";

export type PersistentCacheEntry<T = unknown> = {
  data: T;
  key: string;
  scope: string;
  tags: string[];
  updatedAt: number;
};

type MutationQueueEntry = {
  action: string;
  createdAt: number;
  entity: string;
  id?: number;
  payload: unknown;
  userId?: string;
};

class MaxFormPerformanceDb extends Dexie {
  mutationQueue!: Table<MutationQueueEntry, number>;
  serverState!: Table<PersistentCacheEntry, string>;

  constructor() {
    super("maxform-performance-cache");
    this.version(1).stores({
      mutationQueue: "++id, entity, action, createdAt, userId",
      serverState: "&key, scope, updatedAt, *tags",
    });
  }
}

let db: MaxFormPerformanceDb | null = null;

const getDb = () => {
  if (typeof indexedDB === "undefined") return null;
  db ||= new MaxFormPerformanceDb();
  return db;
};

export const persistentCacheKey = (...parts: Array<string | number | null | undefined>) =>
  parts
    .map((part) =>
      encodeURIComponent(
        part == null || part === "" ? "__none" : String(part),
      ),
    )
    .join("::");

export async function getCachedServerState<T>(
  key: string,
): Promise<PersistentCacheEntry<T> | null> {
  try {
    const entry = await getDb()?.serverState.get(key);
    return entry ? (entry as PersistentCacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export async function setCachedServerState<T>(
  key: string,
  data: T,
  scope: string,
  tags: string[] = [],
) {
  try {
    await getDb()?.serverState.put({
      data,
      key,
      scope,
      tags,
      updatedAt: Date.now(),
    });
  } catch {
    // The live network result remains authoritative when IndexedDB is blocked.
  }
}

export async function deleteCachedServerState(key: string) {
  try {
    await getDb()?.serverState.delete(key);
  } catch {
    // Cache deletion is best effort.
  }
}

export async function clearTaggedServerState(tag: string) {
  try {
    await getDb()?.serverState.where("tags").equals(tag).delete();
  } catch {
    // Cache invalidation is best effort.
  }
}

/** Remove a complete sensitive-data cache scope, such as payments, on sign-out. */
export async function clearServerStateScope(scope: string) {
  try {
    await getDb()?.serverState.where("scope").equals(scope).delete();
  } catch {
    // Cache cleanup must never prevent a user from signing out.
  }
}

export async function queueOfflineMutation(
  entry: Omit<MutationQueueEntry, "createdAt" | "id">,
) {
  try {
    await getDb()?.mutationQueue.add({
      ...entry,
      createdAt: Date.now(),
    });
  } catch {
    // Optimistic UI can still roll back when offline queueing is unavailable.
  }
}
