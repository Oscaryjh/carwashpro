import { PrismaClient } from "@prisma/client";

export const RC_STAGING_FIXTURE_TRANSACTION_TIMEOUT_MS = 30_000;

export function createStagingFixtureDatabase(databaseUrl?: string) {
  return new PrismaClient({
    ...(databaseUrl
      ? { datasources: { db: { url: databaseUrl } } }
      : {}),
    log: [],
    transactionOptions: {
      maxWait: RC_STAGING_FIXTURE_TRANSACTION_TIMEOUT_MS,
      timeout: RC_STAGING_FIXTURE_TRANSACTION_TIMEOUT_MS,
    },
  });
}
