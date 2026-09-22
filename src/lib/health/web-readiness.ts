export type WebReadiness = Readonly<{
  application: "ready" | "not_ready" | "configuration_failed";
  database: "ready" | "unavailable" | "not_checked";
  ok: boolean;
  process: "alive";
  writeFreeze: "full" | "operator-smoke" | "off" | "invalid";
}>;

export async function evaluateWebReadiness(input: {
  databaseProbe: () => Promise<unknown>;
  runtimeContractProbe: () => unknown;
  writeFreezeModeProbe: () => "full" | "operator-smoke" | "off";
}): Promise<WebReadiness> {
  let writeFreeze: WebReadiness["writeFreeze"];
  try {
    writeFreeze = input.writeFreezeModeProbe();
  } catch {
    writeFreeze = "invalid";
  }

  try {
    input.runtimeContractProbe();
  } catch {
    return {
      application: "configuration_failed",
      database: "not_checked",
      ok: false,
      process: "alive",
      writeFreeze,
    };
  }

  try {
    await input.databaseProbe();
    return {
      application: "ready",
      database: "ready",
      ok: true,
      process: "alive",
      writeFreeze,
    };
  } catch {
    return {
      application: "not_ready",
      database: "unavailable",
      ok: false,
      process: "alive",
      writeFreeze,
    };
  }
}
