import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const fixedEmails = [
  "true-mfa-reviewer@test.local",
  "true-mfa-activator@test.local",
];

async function main() {
  assertLocalDatabase();
  const rules = await prisma.statutoryRuleSet.findMany({
    where: { authority: "TEST_ONLY", version: { startsWith: "TEST_TRUE_MFA_" } },
    select: { id: true },
  });
  const ruleSetIds = rules.map((rule) => rule.id);
  if (ruleSetIds.length) {
    await prisma.statutoryRuleSet.updateMany({
      where: { id: { in: ruleSetIds }, authority: "TEST_ONLY" },
      data: { status: "RETIRED" },
    });
    await prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId: { in: ruleSetIds } } });
    await prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId: { in: ruleSetIds } } });
    await prisma.statutoryComponentReviewDecision.deleteMany({ where: { ruleSetId: { in: ruleSetIds } } });
    await prisma.statutoryComponentClassification.deleteMany({ where: { ruleSetId: { in: ruleSetIds } } });
    await prisma.statutoryRuleSet.deleteMany({ where: { id: { in: ruleSetIds }, authority: "TEST_ONLY" } });
  }
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: fixedEmails } },
        { email: { startsWith: "true-mfa-", endsWith: "@example.test" } },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length) {
    await prisma.authSecurityEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.sensitiveActionAuthorization.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userMfaCredential.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    cleanedRuleSets: ruleSetIds.length,
    cleanedUsers: userIds.length,
  }));
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main().finally(() => prisma.$disconnect());
