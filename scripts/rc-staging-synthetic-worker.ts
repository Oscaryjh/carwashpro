import { prepareStagingFixtureConnection } from "./lib/rc-staging-fixture-preflight";

async function main() {
  // Even direct invocation must fetch authenticated platform metadata and prove
  // the pinned transport identity before any Prisma client is imported.
  const input = await prepareStagingFixtureConnection();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, input.environment);
  const { createStagingFixtureDatabase } = await import("./lib/rc-staging-fixture-database");
  const prisma = createStagingFixtureDatabase();
  try {
    const actual = await prisma.$queryRaw<Array<{ database: string; username: string }>>`SELECT current_database() AS database,current_user AS username`;
    if (actual.length !== 1 || actual[0].database !== input.databaseName || actual[0].username !== input.databaseUser) throw new Error("RC_STAGING_FIXTURE_CONNECTED_IDENTITY_MISMATCH");
    const { provisionStagingSynthetic, verifyStagingSynthetic } = await import("./lib/rc-staging-fixture-service");
    const result = input.verifyOnly ? await verifyStagingSynthetic(prisma) : await provisionStagingSynthetic(prisma, { password: input.password });
    console.log(`RC_STAGING_FIXTURE_RESULT ${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect();
    const { prisma: domainPrisma } = await import("../src/lib/prisma");
    await domainPrisma.$disconnect();
  }
}
main().catch(error => { console.log(`RC_STAGING_FIXTURE_RESULT ${JSON.stringify({ status: "BLOCKED", code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "RC_STAGING_FIXTURE_SERVICE_FAILED" })}`); process.exitCode = 2; });
