export const WORKER_HEARTBEAT_STALE = "stale" as const;

export function createWorkerReadinessTracker(input: { staleAfterMs: number }) {
  let configuration: "pending" | "ready" | "fatal" = "pending";
  let database: "unknown" | "reachable" | "unreachable" = "unknown";
  let queue: "unknown" | "available" | "unavailable" = "unknown";
  let lastLoopHeartbeatAt: number | null = null;

  return {
    configurationReady() { configuration = "ready"; },
    databaseReady() { database = "reachable"; },
    databaseUnavailable() { database = "unreachable"; },
    queueReady() { queue = "available"; },
    queueUnavailable() { queue = "unavailable"; },
    loopHeartbeat(now = Date.now()) { lastLoopHeartbeatAt = now; },
    fatalConfigurationFailure() { configuration = "fatal"; },
    snapshot(now = Date.now()) {
      const loop = lastLoopHeartbeatAt !== null &&
        now - lastLoopHeartbeatAt <= input.staleAfterMs
        ? "operating" as const
        : WORKER_HEARTBEAT_STALE;
      return {
        configuration,
        database,
        loop,
        ok:
          configuration === "ready" &&
          database === "reachable" &&
          queue === "available" &&
          loop === "operating",
        process: "alive" as const,
        queue,
      };
    },
  };
}

