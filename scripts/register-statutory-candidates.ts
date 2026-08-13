import { prisma } from "../src/lib/prisma";
import {
  LOCAL_REGISTRATION_ACTOR_ID,
  registerCanonicalStatutoryCandidates,
} from "../src/lib/payroll/statutory-governance-service";

async function main() {
  assertLocalTestingOnly();
  const registrations = await registerCanonicalStatutoryCandidates({
    actor: {
      id: LOCAL_REGISTRATION_ACTOR_ID,
      role: "PLATFORM_ADMIN",
      actorType: "SCRIPT",
    },
    reason: "Local verified evidence-pack canonical candidate registration.",
  });
  const ids = registrations.map((item) => item.ruleSetId);
  const [activeCount, signOffCount] = await Promise.all([
    prisma.statutoryRuleSet.count({ where: { id: { in: ids }, status: "ACTIVE" } }),
    prisma.statutoryRuleSetSignOff.count({ where: { ruleSetId: { in: ids } } }),
  ]);
  if (activeCount !== 0 || signOffCount !== 0) {
    throw new Error("CANONICAL_REGISTRATION_SAFETY_INVARIANT_FAILED");
  }
  const stored = await prisma.statutoryRuleSet.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      scheme: true,
      version: true,
      readiness: true,
      status: true,
      humanReviewStatus: true,
      effectiveFrom: true,
      effectiveTo: true,
      _count: { select: { classifications: true, reviewDecisions: true, signOffs: true } },
    },
    orderBy: { scheme: "asc" },
  });
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    registrations,
    humanSignOff: "NOT_EXECUTED",
    activation: "NOT_ACTIVE",
    stored,
  }, null, 2));
}

function assertLocalTestingOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("PRODUCTION_REGISTRATION_FORBIDDEN");
  }
  if (process.env.ALLOW_LOCAL_STATUTORY_REGISTRATION !== "1") {
    throw new Error("ALLOW_LOCAL_STATUTORY_REGISTRATION_REQUIRED");
  }
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("LOCAL_DATABASE_URL_REQUIRED");
  const url = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)) {
    throw new Error("NON_LOCAL_DATABASE_REGISTRATION_FORBIDDEN");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
