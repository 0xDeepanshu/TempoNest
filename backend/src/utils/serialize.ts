/**
 * Serializes async tasks that mutate the same logical entity inside one
 * process. Database row locks and unique indexes remain the source of truth
 * across processes; this guard prevents overlapping SQLite transactions (the
 * test database has a single writer connection) and removes avoidable
 * contention on PostgreSQL.
 */
const tails = new Map<string, Promise<void>>();

export async function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);

  try {
    await previous;
    return await task();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
