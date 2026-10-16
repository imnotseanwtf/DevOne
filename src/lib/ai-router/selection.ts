interface SelectableConnection {
  id: string;
  priority: number;
  isActive: boolean;
  allowedModels: string[];
  rateLimitedUntil: Date | null;
  modelLocks: unknown;
}

/** An unavailable account is never retried until its cooldown or model lock expires. */
export function selectConnections<T extends SelectableConnection>(
  connections: T[],
  model: string,
  excludedIds: Set<string> = new Set(),
  now = new Date()
): T[] {
  return connections
    .filter((connection) => {
      if (!connection.isActive || excludedIds.has(connection.id)) return false;
      if (connection.rateLimitedUntil && connection.rateLimitedUntil > now) return false;
      if (connection.allowedModels.length && !connection.allowedModels.includes(model))
        return false;
      const locks = connection.modelLocks;
      const until =
        locks && typeof locks === 'object' ? (locks as Record<string, unknown>)[model] : null;
      return !(typeof until === 'string' && new Date(until) > now);
    })
    .toSorted((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
