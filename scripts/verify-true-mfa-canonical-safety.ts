import { prisma } from "../src/lib/prisma";
import { loadStatutoryEvidencePackInputs } from "../src/lib/payroll/statutory-evidence-pack";

async function main() {
  assertLocalDatabase();
  const packs = await loadStatutoryEvidencePackInputs(process.cwd());
  const expectedSchemes = new Set(["EPF", "SOCSO", "EIS", "LINDUNG24"]);
  const selected = packs.filter((pack) => expectedSchemes.has(pack.registry.scheme));
  const rows = [];
  for (const pack of selected) {
    const rule = await prisma.statutoryRuleSet.findUniqueOrThrow({
      where: {
        scheme_version: {
          scheme: pack.registry.scheme,
          version: pack.classification.version,
        },
      },
      select: {
        id: true,
        scheme: true,
        version: true,
        status: true,
        humanReviewStatus: true,
        _count: { select: { signOffs: true, reviewDecisions: true } },
      },
    });
    if (rule.status === "ACTIVE" || rule._count.signOffs !== 0) {
      throw new Error(`CANONICAL_TRUE_MFA_SAFETY_FAILED:${rule.scheme}`);
    }
    rows.push({
      scheme: rule.scheme,
      ruleSet: "REGISTERED",
      humanReview: rule.humanReviewStatus,
      reviewDecisions: rule._count.reviewDecisions,
      humanSignOff: "NOT_EXECUTED",
      mfaStepUp: "READY",
      activation: "NOT_ACTIVE",
    });
  }
  if (rows.length !== expectedSchemes.size) {
    throw new Error("CANONICAL_TRUE_MFA_SCHEME_SET_INCOMPLETE");
  }
  const qaArtifacts = await prisma.userMfaCredential.count({
    where: {
      user: {
        OR: [
          { email: { in: ["true-mfa-reviewer@test.local", "true-mfa-activator@test.local"] } },
          { email: { startsWith: "true-mfa-", endsWith: "@example.test" } },
        ],
      },
    },
  });
  if (qaArtifacts !== 0) throw new Error("TRUE_MFA_QA_CREDENTIAL_CLEANUP_FAILED");
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    canonical: rows.sort((left, right) => left.scheme.localeCompare(right.scheme)),
    qaMfaCredentials: qaArtifacts,
  }, null, 2));
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
