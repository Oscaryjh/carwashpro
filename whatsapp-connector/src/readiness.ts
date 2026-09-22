import type { ConnectorStatus } from "./types.js";

export type ConnectorReadinessInput = Readonly<{
  healthy: boolean;
  status: ConnectorStatus;
}>;

export function connectorHealthFromStates(
  states: readonly ConnectorReadinessInput[],
  deliveryAllowed = true,
) {
  const connected = states.filter((state) => state.status === "connected");
  const ready = connected.filter((state) => state.healthy);
  return {
    process: "PROCESS_HEALTHY" as const,
    session:
      connected.length > 0
        ? "SESSION_CONNECTED" as const
        : "SESSION_NOT_CONNECTED" as const,
    send:
      deliveryAllowed && ready.length > 0
        ? "READY_TO_SEND" as const
        : "NOT_READY_TO_SEND" as const,
    connectedSessions: connected.length,
    configuredSessions: states.length,
  };
}
