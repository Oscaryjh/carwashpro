import { PrismaClient } from "@prisma/client";

const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";
process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;
const prisma = new PrismaClient();

async function main() {
  assertLocalDatabase();
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "commission-browser-approver@test.local" },
  });
  const result = await prisma.sensitiveActionAuthorization.updateMany({
    where: { userId: user.id, consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "LOCAL_QA_BROWSER_FIXTURE_CLEANUP" },
  });
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    revokedOutstandingAuthorizations: result.count,
    qaMfaCredential: "ISOLATED_LOCAL_FIXTURE_RETAINED",
  }));
}

function assertLocalDatabase() {
  const hostname = new URL(process.env.DATABASE_URL!).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) throw new Error("LOCAL_TESTING_ONLY");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
