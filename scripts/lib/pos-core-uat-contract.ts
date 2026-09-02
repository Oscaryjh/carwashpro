export const POS_CORE_UAT_FIXTURE_CONFIRMATION = "LOCAL_ONLY_CONFIRMED";
export const POS_CORE_FRESH_RUN_BRANCH_NAME = "Final UAT Branch";

export const POS_CORE_UAT = {
  salon: {
    slug: "tetamu-uat-salon",
    name: "TETAMU UAT SALON",
    ownerEmail: "uat.salon.owner@tetamu.test",
  },
  auto: {
    slug: "tetamu-uat-auto",
    name: "TETAMU UAT AUTO",
    ownerEmail: "uat.auto.owner@tetamu.test",
  },
} as const;

export type PosCoreUatGuardInput = {
  databaseUrl?: string;
  nodeEnv?: string;
  appEnv?: string;
  fixtureConfirmation?: string;
};

export function assertPosCoreUatFixtureEnvironment(input: PosCoreUatGuardInput) {
  if (input.nodeEnv === "production" || input.appEnv?.toLowerCase() === "production") {
    throw new Error("POS Core UAT fixtures refuse Production runtime.");
  }

  if (input.fixtureConfirmation !== POS_CORE_UAT_FIXTURE_CONFIRMATION) {
    throw new Error(
      `Set POS_CORE_UAT_FIXTURE=${POS_CORE_UAT_FIXTURE_CONFIRMATION} to confirm this local-only fixture operation.`,
    );
  }

  if (!input.databaseUrl) {
    throw new Error("DATABASE_URL is required for POS Core UAT fixtures.");
  }

  const url = new URL(input.databaseUrl);
  const host = url.hostname.toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(host)) {
    throw new Error(`POS Core UAT fixtures refuse non-local database host: ${host}`);
  }

  return { environment: "LOCAL_UAT" as const, databaseHost: host };
}

export function requireUatFixturePassword(password: string | undefined) {
  if (!password || password.length < 12) {
    throw new Error("LOCAL_POS_CORE_UAT_PASSWORD must contain at least 12 characters.");
  }
  return password;
}

export function assertPosCoreFreshRunSafe(input: {
  cashierOpenShiftCount: number;
  dailyClosingCount: number;
  targetBranchOpenShiftCount: number;
}) {
  if (input.dailyClosingCount > 0) {
    throw new Error("Fresh POS Core UAT run refused: target Business Day is already closed.");
  }
  if (input.cashierOpenShiftCount > 0) {
    throw new Error("Fresh POS Core UAT run refused: target Cashier already has an OPEN Shift.");
  }
  if (input.targetBranchOpenShiftCount > 0) {
    throw new Error("Fresh POS Core UAT run refused: target Branch already has an OPEN Shift.");
  }
}
