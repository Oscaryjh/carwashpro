import { hash } from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { REVIEW_STATUTORY_CLASSIFICATION } from "../src/lib/payroll/statutory-governance-service";

const email = "statutory-reviewer.qa@test.local";

async function main() {
  assertLocal();
  const password = process.env.STATUTORY_BROWSER_QA_PASSWORD;
  if (!password || password.length < 12) throw new Error("STATUTORY_BROWSER_QA_PASSWORD_REQUIRED");
  const passwordHash = await hash(password, 12);
  const reviewer = await prisma.user.upsert({
    where: { email },
    create: {
      name: "Statutory Browser QA Reviewer",
      email,
      passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: [REVIEW_STATUTORY_CLASSIFICATION],
    },
    update: {
      name: "Statutory Browser QA Reviewer",
      passwordHash,
      loginEnabled: true,
      status: "active",
      role: "PLATFORM_ADMIN",
      permissions: [REVIEW_STATUTORY_CLASSIFICATION],
    },
  });
  const token = Date.now().toString(36).toUpperCase();
  const rule = await prisma.statutoryRuleSet.create({
    data: {
      scheme: "EPF",
      version: `TEST_BROWSER_GOVERNANCE_${token}`,
      effectiveFrom: new Date("2198-01-01T00:00:00.000Z"),
      authority: "TEST_ONLY",
      sourceReference: "isolated browser integration fixture",
      sourceDocumentName: "Browser governance QA fixture",
      sourceDigest: "a".repeat(64),
      datasetDigest: "b".repeat(64),
      goldenFixtureDigest: "c".repeat(64),
      independentReviewDigest: "d".repeat(64),
      classificationVersion: "QA_BROWSER_CLASSIFICATION_1",
      classificationDigest: "e".repeat(64),
      parserName: "qa-browser-parser",
      parserVersion: "1",
      calculatorVersion: "qa-browser-calculator",
      calculatorTestDigest: "f".repeat(64),
      datasetRowCount: 1,
      readiness: "CALCULATION_VERIFIED",
      status: "READY_FOR_HUMAN_SIGN_OFF",
      ruleData: { id: "QA_BROWSER_DATASET" },
      classifications: {
        create: {
          scheme: "EPF",
          componentCode: "QA_BROWSER_UNKNOWN_EARNING",
          treatment: "UNKNOWN",
          rationale: "Dedicated QA-only component; no canonical legal decision is represented.",
          authorityRef: "QA-BROWSER-EVIDENCE-ONLY",
        },
      },
    },
  });
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    reviewerUserId: reviewer.id,
    email,
    ruleSetId: rule.id,
    route: `/admin/statutory/rulesets/${rule.id}`,
  }, null, 2));
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
