import { PrismaClient } from "@prisma/client";

const QA_BUSINESS_SLUG = "qa-commission-browser-salon";
const QA_APPROVER_EMAIL = "commission-browser-approver@test.local";
const QA_MONTH = new Date("2026-09-01T00:00:00.000Z");
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";

process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;
const prisma = new PrismaClient();

async function main() {
  assertLocalDatabase();
  const business = await prisma.business.findUniqueOrThrow({ where: { slug: QA_BUSINESS_SLUG } });
  const approver = await prisma.user.findUniqueOrThrow({ where: { email: QA_APPROVER_EMAIL } });
  const membership = await prisma.employeeBusinessMembership.findFirstOrThrow({
    where: { businessId: business.id, employeeCode: "COMMISSION-BROWSER-A" },
  });
  const run = await prisma.payrollRun.findFirstOrThrow({
    where: { businessId: business.id, periodStart: QA_MONTH },
    include: { entries: { include: { components: true } } },
  });
  const entry = run.entries.find((row) => row.membershipId === membership.id);
  if (!entry) throw new Error("QA_PAYROLL_ENTRY_MISSING");
  const commission = entry.components.find(
    (component) => component.code === "COMMISSION" && component.sourceType === "VARIABLE_PAY",
  );
  if (!commission || !commission.amount.equals("8.00")) {
    throw new Error("COMMISSION_AMOUNT_REGRESSION");
  }
  if (!entry.grossPay.equals("3008.00") || !entry.netPay.equals("3008.00")) {
    throw new Error("PAYROLL_NUMERIC_REGRESSION");
  }
  if (run.status !== "DRAFT") throw new Error("REOPEN_E2E_DID_NOT_RETURN_RUN_TO_DRAFT");

  const bank = await prisma.employeeBankAccountVersion.findFirstOrThrow({
    where: { businessId: business.id, employeeMembershipId: membership.id, status: "ACTIVE" },
    orderBy: { revision: "desc" },
  });
  if (bank.accountNumberLast4 !== "7890" || bank.revision !== 1) {
    throw new Error("BANK_ACCOUNT_E2E_RESULT_INVALID");
  }

  const authorizations = await prisma.sensitiveActionAuthorization.findMany({
    where: {
      userId: approver.id,
      businessId: business.id,
      actionKey: { in: ["PAYROLL_FINALIZE", "PAYROLL_REOPEN", "BANK_ACCOUNT_EDIT"] },
    },
    orderBy: { issuedAt: "asc" },
  });
  const requiredScopes = [
    { actionKey: "PAYROLL_FINALIZE", resourceId: run.id },
    { actionKey: "PAYROLL_REOPEN", resourceId: run.id },
    { actionKey: "BANK_ACCOUNT_EDIT", resourceId: membership.id },
  ];
  const consumed = requiredScopes.map((scope) => {
    const match = authorizations.find(
      (authorization) =>
        authorization.actionKey === scope.actionKey &&
        authorization.resourceId === scope.resourceId &&
        authorization.resourceType !== null &&
        authorization.assuranceLevel === "MFA" &&
        authorization.consumedAt !== null,
    );
    if (!match) throw new Error(`CONSUMED_AUTHORIZATION_MISSING:${scope.actionKey}`);
    return match;
  });

  const payrollAudits = await prisma.auditLog.findMany({
    where: {
      businessId: business.id,
      entityId: run.id,
      action: { in: ["PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE", "PAYROLL_RUN_REOPENED"] },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const action of ["PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE", "PAYROLL_RUN_REOPENED"]) {
    const audit = payrollAudits.find((row) => row.action === action);
    if (!audit || !hasConsumedAuthorizationLink(audit.metadata, consumed)) {
      throw new Error(`PAYROLL_AUDIT_AUTHORIZATION_LINK_MISSING:${action}`);
    }
  }

  const bankEvent = await prisma.payrollPaymentEvent.findFirstOrThrow({
    where: { businessId: business.id, bankAccountVersionId: bank.id, action: "BANK_VERSION_CREATED" },
    orderBy: { createdAt: "desc" },
  });
  const bankAudit = await prisma.auditLog.findFirstOrThrow({
    where: {
      businessId: business.id,
      entityId: bank.id,
      action: "EMPLOYEE_BANK_VERSION_CREATED",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!hasConsumedAuthorizationLink(bankAudit.metadata, consumed)) {
    throw new Error("BANK_AUDIT_AUTHORIZATION_LINK_MISSING");
  }

  const securityEvents = await prisma.authSecurityEvent.findMany({
    where: { userId: approver.id },
    orderBy: { createdAt: "asc" },
  });
  const securityPayload = JSON.stringify(securityEvents);
  if (securityPayload.includes("1234567890") || securityPayload.includes(membership.fullName)) {
    throw new Error("BANK_SENSITIVE_DATA_LEAKED_TO_SECURITY_EVENTS");
  }
  const relevantEventTypes = new Set(securityEvents.map((event) => event.eventType));
  const verifiedEvents = securityEvents.filter((event) => event.outcome === "SUCCESS").length;
  if (verifiedEvents < 3) throw new Error("MFA_SECURITY_EVENT_REGRESSION");

  const canonicalSafety = [];
  for (const scheme of ["EPF", "SOCSO", "EIS", "LINDUNG24"] as const) {
    const ruleSets = await prisma.statutoryRuleSet.findMany({
      where: { scheme, authority: { not: "TEST_ONLY" } },
      select: {
        status: true,
        _count: { select: { reviewDecisions: true, signOffs: true } },
      },
    });
    canonicalSafety.push({
      scheme,
      humanDecisions: ruleSets.reduce((sum, rule) => sum + rule._count.reviewDecisions, 0),
      humanSignOffs: ruleSets.reduce((sum, rule) => sum + rule._count.signOffs, 0),
      activeRuleSets: ruleSets.filter((rule) => rule.status === "ACTIVE").length,
    });
  }

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    browserE2E: {
      finalize: "PASS",
      reopen: "PASS",
      bankAccountEdit: "PASS",
    },
    payroll: {
      finalState: run.status,
      gross: entry.grossPay.toFixed(2),
      net: entry.netPay.toFixed(2),
      commission: commission.amount.toFixed(2),
    },
    authorization: {
      scopedConsumed: consumed.map((authorization) => ({
        actionKey: authorization.actionKey,
        resourceType: authorization.resourceType,
        consumed: true,
      })),
      outstandingQaAuthorizations: authorizations.filter((authorization) => !authorization.consumedAt && !authorization.revokedAt).length,
    },
    audit: {
      payrollEvents: payrollAudits.map((audit) => audit.action),
      bankEvent: bankEvent.action,
      linkedToAuthorization: true,
    },
    security: {
      eventTypes: [...relevantEventTypes].sort(),
      fullBankAccountInSecurityEvents: false,
      accountHolderInSecurityEvents: false,
    },
    canonicalStatutorySafety: canonicalSafety,
  }, null, 2));
}

function hasConsumedAuthorizationLink(metadata: unknown, authorizations: Array<{ id: string }>) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const authorizationId = (metadata as Record<string, unknown>).sensitiveActionAuthorizationId;
  return typeof authorizationId === "string" && authorizations.some((authorization) => authorization.id === authorizationId);
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
