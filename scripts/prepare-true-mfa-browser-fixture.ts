import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { statutoryRuleEvidenceDigest } from "../src/lib/payroll/statutory-activation-service";

const prisma = new PrismaClient();
const reviewerEmail = "true-mfa-reviewer@test.local";
const activatorEmail = "true-mfa-activator@test.local";
const ruleVersion = "TEST_TRUE_MFA_BROWSER";

async function main() {
  assertLocalDatabase();
  const password = process.env.TRUE_MFA_QA_PASSWORD;
  if (!password || password.length < 12) throw new Error("TRUE_MFA_QA_PASSWORD_REQUIRED");
  const passwordHash = await bcrypt.hash(password, 12);
  const reviewer = await upsertQaUser({
    email: reviewerEmail,
    name: "True MFA Reviewer QA",
    passwordHash,
    permissions: ["SENSITIVE_ACTION_QA", "SIGN_OFF_STATUTORY_RULESET"],
  });
  const activator = await upsertQaUser({
    email: activatorEmail,
    name: "True MFA Activator QA",
    passwordHash,
    permissions: ["SENSITIVE_ACTION_QA", "ACTIVATE_STATUTORY_RULESET"],
  });
  await clearUserSecurityState([reviewer.id, activator.id]);

  const rule = await prisma.statutoryRuleSet.upsert({
    where: { scheme_version: { scheme: "PCB", version: ruleVersion } },
    update: {
      status: "READY_FOR_HUMAN_SIGN_OFF",
      readiness: "CALCULATION_VERIFIED",
      humanReviewStatus: "COMPLETED",
      humanReviewRevision: 1,
      humanClassificationDigest: "5".repeat(64),
      activatedAt: null,
      activatedById: null,
      activationReason: null,
    },
    create: {
      scheme: "PCB",
      version: ruleVersion,
      effectiveFrom: new Date("2199-01-01T00:00:00.000Z"),
      authority: "TEST_ONLY",
      sourceReference: "Isolated Local browser true-MFA fixture",
      sourceDocumentName: "true-mfa-browser-fixture.json",
      sourceDigest: "1".repeat(64),
      datasetDigest: "2".repeat(64),
      goldenFixtureDigest: "3".repeat(64),
      independentReviewDigest: "4".repeat(64),
      classificationVersion: "TEST_TRUE_MFA_BROWSER_V1",
      classificationDigest: "5".repeat(64),
      calculatorVersion: "TEST_TRUE_MFA_BROWSER_V1",
      calculatorTestDigest: "6".repeat(64),
      datasetRowCount: 1,
      readiness: "CALCULATION_VERIFIED",
      status: "READY_FOR_HUMAN_SIGN_OFF",
      humanReviewStatus: "COMPLETED",
      humanReviewRevision: 1,
      humanClassificationDigest: "5".repeat(64),
      ruleData: { id: ruleVersion, eligibilityLogicRevision: "QA-ONLY" },
    },
  });
  const digestRule = await prisma.statutoryRuleSet.findUniqueOrThrow({
    where: { id: rule.id },
    include: { classifications: true, reviewDecisions: true },
  });
  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    reviewerEmail,
    activatorEmail,
    reviewerUserId: reviewer.id,
    activatorUserId: activator.id,
    ruleSetId: rule.id,
    evidenceDigest: statutoryRuleEvidenceDigest(digestRule),
  }));
}

async function upsertQaUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  permissions: string[];
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      passwordHash: input.passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: input.permissions,
      status: "active",
      loginEnabled: true,
      businessId: null,
      branchId: null,
    },
    create: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: "PLATFORM_ADMIN",
      permissions: input.permissions,
    },
  });
}

async function clearUserSecurityState(userIds: string[]) {
  await prisma.authSecurityEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sensitiveActionAuthorization.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userMfaCredential.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
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
