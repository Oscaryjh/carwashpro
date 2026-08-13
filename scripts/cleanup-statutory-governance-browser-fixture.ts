import { prisma } from "../src/lib/prisma";

async function main() {
  assertLocal();
  const ruleSetId = process.env.STATUTORY_BROWSER_FIXTURE_RULESET_ID;
  if (!ruleSetId) throw new Error("STATUTORY_BROWSER_FIXTURE_RULESET_ID_REQUIRED");
  await prisma.statutoryRuleSet.updateMany({ where: { id: ruleSetId }, data: { status: "RETIRED" } });
  await prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentReviewDecision.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentClassification.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSet.deleteMany({ where: { id: ruleSetId } });
  await prisma.user.deleteMany({ where: { email: "statutory-reviewer.qa@test.local" } });
  console.log(JSON.stringify({ environment: "LOCAL / TESTING ONLY", cleanedRuleSetId: ruleSetId }));
}

function assertLocal() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("LOCAL_DATABASE_URL_REQUIRED");
  const host = new URL(value).hostname;
  if (process.env.NODE_ENV === "production" ||
    !new Set(["localhost", "127.0.0.1", "::1"]).has(host)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
