import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, type BusinessModuleKey } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";
const password = process.env.LOCAL_APPROVAL_QA_PASSWORD;
const host = new URL(databaseUrl).hostname.toLowerCase();
if (!password || password.length < 12) throw new Error("LOCAL_APPROVAL_QA_PASSWORD must contain at least 12 characters.");
if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error("Unified Approval browser fixtures are restricted to the Local database.");
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient();
const runToken = randomUUID().slice(0, 8);

async function main() {
  const passwordHash = await bcrypt.hash(password!, 12);
  const full = await createBusiness("FULL_WORKFORCE", ["HR", "CLAIMS", "COMMISSION", "PAYROLL", "STATUTORY"], passwordHash);
  const hr = await createBusiness("HR_ONLY", ["HR"], passwordHash);
  const pos = await createBusiness("POS_ONLY", ["POS", "SALON"], passwordHash);
  const fixture = await seedFullWorkforce(full);
  process.stdout.write(JSON.stringify({
    runToken,
    passwordSource: "LOCAL_APPROVAL_QA_PASSWORD",
    full: { ...full, ...fixture },
    hr,
    pos,
  }, null, 2));
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

async function createBusiness(kind: string, modules: BusinessModuleKey[], passwordHash: string) {
  const slug = `qa-unified-approvals-${kind.toLowerCase().replaceAll("_", "-")}-${runToken}`;
  const business = await prisma.business.create({ data: {
    name: `QA UNIFIED APPROVALS ${kind} ${runToken}`,
    slug,
    industryType: kind === "POS_ONLY" ? "SALON_BEAUTY" : "GENERAL_SERVICE",
    timezone: "Asia/Kuala_Lumpur",
  } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "QA Main Branch" } });
  const email = `unified-approvals-${kind.toLowerCase().replaceAll("_", "-")}-${runToken}@test.local`;
  const owner = await prisma.user.create({ data: {
    businessId: business.id,
    branchId: branch.id,
    name: `${kind} Approval QA Owner`,
    email,
      passwordHash,
    role: "BUSINESS_OWNER",
    status: "active",
    loginEnabled: true,
  } });
  for (const moduleKey of modules) {
    const entitlement = await prisma.businessModuleEntitlement.create({ data: {
      businessId: business.id,
      moduleKey,
      status: "ENABLED",
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "SYSTEM",
      createdById: owner.id,
      updatedById: owner.id,
    } });
    await prisma.businessModuleEntitlementEvent.create({ data: {
      entitlementId: entitlement.id,
      businessId: business.id,
      moduleKey,
      revision: 1,
      newStatus: "ENABLED",
      newEnabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "SYSTEM",
      reason: "LOCAL / TESTING ONLY Unified Approval Center browser fixture.",
      actorUserId: owner.id,
    } });
  }
  return { businessId: business.id, branchId: branch.id, ownerId: owner.id, email, slug };
}

async function seedFullWorkforce(full: Awaited<ReturnType<typeof createBusiness>>) {
  const membership = await createMembership(full.businessId, full.branchId, "Unified Approval QA Employee");
  const calculator = await prisma.user.create({ data: {
    businessId: full.businessId,
    branchId: full.branchId,
    name: "Unified Commission Calculator",
    role: "STAFF",
    loginEnabled: false,
  } });

  const attendance = await prisma.attendanceP2Exception.create({ data: {
    businessId: full.businessId,
    branchId: full.branchId,
    membershipId: membership.id,
    workDate: new Date("2027-01-05T00:00:00.000Z"),
    type: "NO_ATTENDANCE_RECORDED",
    stableKey: `unified-approval-browser:${runToken}:attendance`,
    reasonCode: "NO_EXPECTED_ATTENDANCE_EVIDENCE",
    sourceDigest: "1".repeat(64),
  } });

  const leavePolicy = await prisma.leavePolicy.create({ data: {
    businessId: full.businessId,
    code: "ANNUAL",
    name: "Annual Leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: false,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
  } });
  const leavePolicyVersion = await prisma.leavePolicyVersion.create({ data: {
    businessId: full.businessId,
    policyId: leavePolicy.id,
    revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    nameSnapshot: "Annual Leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: false,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
    sourceReference: "LOCAL_UNIFIED_APPROVAL_QA",
    reason: "LOCAL / TESTING ONLY browser policy.",
    createdById: full.ownerId,
  } });
  const leave = await prisma.leaveRequest.create({ data: {
    businessId: full.businessId,
    branchId: full.branchId,
    membershipId: membership.id,
    policyId: leavePolicy.id,
    policyVersionId: leavePolicyVersion.id,
    policyNameSnapshot: "Annual Leave",
    payTreatmentSnapshot: "PAID",
    balanceTrackedSnapshot: false,
    legalStatusSnapshot: "COMPANY_POLICY_ONLY",
    startsOn: new Date("2027-01-12T00:00:00.000Z"),
    endsOn: new Date("2027-01-12T00:00:00.000Z"),
    requestedDays: 1,
    reason: "Private Local QA leave reason",
    clientRequestId: randomUUID(),
  } });

  const category = await prisma.claimCategory.create({ data: {
    businessId: full.businessId,
    code: "GENERAL",
    name: "General expense",
    nature: "GENERAL",
  } });
  const claimPolicy = await prisma.claimPolicyRevision.create({ data: {
    businessId: full.businessId,
    categoryId: category.id,
    revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    nameSnapshot: "General expense",
    natureSnapshot: "GENERAL",
    receiptRequired: false,
    descriptionRequired: true,
    statutoryTreatmentStatus: "REVIEW_REQUIRED",
    reason: "LOCAL / TESTING ONLY browser policy.",
    createdById: full.ownerId,
  } });
  const claim = await prisma.employeeClaim.create({ data: {
    businessId: full.businessId,
    branchId: full.branchId,
    membershipId: membership.id,
    claimNumber: `QA-${runToken}`,
    clientRequestId: randomUUID(),
    purpose: "Private Local QA claim purpose",
    status: "SUBMITTED",
    submittedTotal: 42.50,
    revision: 1,
    submittedAt: new Date(),
  } });
  await prisma.claimLine.create({ data: {
    businessId: full.businessId,
    claimId: claim.id,
    lineNumber: 1,
    categoryId: category.id,
    policyRevisionId: claimPolicy.id,
    categoryCodeSnapshot: "GENERAL",
    categoryNameSnapshot: "General expense",
    expenseNatureSnapshot: "GENERAL",
    expenseDate: new Date("2027-01-03T00:00:00.000Z"),
    description: "Local browser QA expense",
    submittedAmount: 42.50,
  } });

  const commission = await prisma.commissionPeriod.create({ data: {
    businessId: full.businessId,
    branchId: full.branchId,
    scopeKey: `unified-browser-${runToken}`,
    earnedPeriodStart: new Date("2027-01-01T00:00:00.000Z"),
    earnedPeriodEnd: new Date("2027-01-31T00:00:00.000Z"),
    status: "CALCULATED",
    currentRevision: 1,
    calculatedById: calculator.id,
    calculatedAt: new Date(),
    sourceDigest: "2".repeat(64),
  } });
  await prisma.commissionStatement.create({ data: {
    businessId: full.businessId,
    periodId: commission.id,
    membershipId: membership.id,
    calculationRevision: 1,
    status: "CALCULATED",
    eligibleSalesCents: 10_000,
    calculatedCommissionCents: 1_000,
    finalCommissionCents: 1_000,
    calculationDigest: "3".repeat(64),
  } });

  const payroll = await prisma.payrollRun.create({ data: {
    businessId: full.businessId,
    periodStart: new Date("2027-02-01T00:00:00.000Z"),
    periodEnd: new Date("2027-03-01T00:00:00.000Z"),
    status: "DRAFT",
    attendanceSource: "LEGACY_OPERATIONAL_SESSION",
    workingDaysPerMonthSnapshot: 26,
    normalWorkMinutesPerDaySnapshot: 480,
    breakMinutesPerDaySnapshot: 60,
    overtimeMultiplierSnapshot: 1.5,
    publicHolidayExtraMultiplierSnapshot: 2,
  } });
  await prisma.$transaction(async (transaction) => {
    const entry = await transaction.payrollEntry.create({ data: {
      payrollRunId: payroll.id,
      businessId: full.businessId,
      membershipId: membership.id,
      employeeCodeSnapshot: membership.employeeCode,
      fullNameSnapshot: membership.fullName,
      payBasisSnapshot: "MONTHLY",
      baseRateSnapshot: 3_000,
      workingDaysSnapshot: 26,
      normalWorkMinutesSnapshot: 480,
      basicPay: 3_000,
      grossPay: 3_000,
      netPay: 3_000,
    } });
    await transaction.payrollEntryComponent.create({ data: {
      businessId: full.businessId,
      payrollRunId: payroll.id,
      payrollEntryId: entry.id,
      membershipId: membership.id,
      lineKey: "SYSTEM:UNIFIED_APPROVAL_BROWSER",
      type: "EARNING",
      code: "BASIC_PAY",
      name: "Basic pay",
      amount: 3_000,
      currency: "MYR",
      sourceType: "PAYROLL_CALCULATION",
      calculationBasis: "LOCAL_UNIFIED_APPROVAL_BROWSER",
      origin: "SYSTEM",
      sortOrder: 10,
      createdById: full.ownerId,
    } });
  });
  await prisma.payrollRun.update({
    where: { id: payroll.id },
    data: { status: "REVIEW", submittedById: calculator.id, submittedAt: new Date() },
  });
  return {
    membershipId: membership.id,
    attendanceId: attendance.id,
    leaveId: leave.id,
    claimId: claim.id,
    commissionPeriodId: commission.id,
    payrollRunId: payroll.id,
  };
}

async function createMembership(businessId: string, branchId: string, fullName: string) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await prisma.employeeAccount.create({ data: { name: fullName, phoneNumber: phone, phoneNormalized: phone } });
  const membership = await prisma.employeeBusinessMembership.create({ data: {
    businessId,
    employeeAccountId: account.id,
    employeeCode: `UAC-${runToken}`,
    fullName,
    phoneNumber: phone,
    phoneNumberNormalized: phone,
    attendanceEnabled: false,
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  } });
  await prisma.employeeBranchAssignment.create({ data: {
    businessId,
    branchId,
    membershipId: membership.id,
    isPrimary: true,
    canClockIn: true,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  } });
  return prisma.employeeBusinessMembership.update({
    where: { id: membership.id },
    data: { attendanceEnabled: true },
  });
}
