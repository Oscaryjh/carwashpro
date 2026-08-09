type CachedRequest<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

export class ConnectorRequestReplayCache {
  private readonly entries = new Map<string, CachedRequest<unknown>>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 1_000,
  ) {}

  execute<T>(key: string, operation: () => Promise<T>, now = Date.now()): Promise<T> {
    this.prune(now);
    const existing = this.entries.get(key) as CachedRequest<T> | undefined;
    if (existing) {
      return existing.promise;
    }

    const promise = operation().catch((error) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { expiresAt: now + this.ttlMs, promise });
    this.prune(now);
    return promise;
  }

  get size() {
    return this.entries.size;
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}
