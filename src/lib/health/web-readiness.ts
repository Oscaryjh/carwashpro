export type WebReadiness = Readonly<{
  application: "ready" | "not_ready" | "configuration_failed";
  database: "ready" | "unavailable" | "not_checked";
  ok: boolean;
  process: "alive";
}>;

export async function evaluateWebReadiness(input: {
  databaseProbe: () => Promise<unknown>;
  runtimeContractProbe: () => unknown;
}): Promise<WebReadiness> {
  try {
    input.runtimeContractProbe();
  } catch {
    return {
      application: "configuration_failed",
      database: "not_checked",
      ok: false,
      process: "alive",
    };
  }

  try {
    await input.databaseProbe();
    return {
      application: "ready",
      database: "ready",
      ok: true,
      process: "alive",
    };
  } catch {
    return {
      application: "not_ready",
      database: "unavailable",
      ok: false,
      process: "alive",
    };
  }
}
