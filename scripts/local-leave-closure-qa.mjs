import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";
import {
  installSabahStatutoryRulePackDraft,
  markStatutoryRuleSetReadyForHumanSignOff,
  submitStatutoryRuleSetForReview,
} from "../src/lib/leave/statutory-service.ts";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
if (!["localhost", "127.0.0.1"].includes(new URL(configuredUrl).hostname)) {
  throw new Error("Leave QA fixture operations are restricted to the Local database.");
}
const password = process.env.LOCAL_LEAVE_QA_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("LOCAL_LEAVE_QA_PASSWORD must contain at least 12 characters.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const managerEmail = "leave-qa-manager@test.local";
const ownerEmail = "leave-qa-owner@test.local";
const employeePhone = "+601199988877";

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const business = await prisma.business.upsert({
    where: { slug: "qa-leave-closure-local" },
    create: { name: "QA LEAVE CLOSURE LOCAL", slug: "qa-leave-closure-local", industryType: "SALON_BEAUTY", timezone: "Asia/Kuala_Lumpur" },
    update: { name: "QA LEAVE CLOSURE LOCAL", status: "active", timezone: "Asia/Kuala_Lumpur" },
  });
  const branch = await prisma.branch.upsert({
    where: { businessId_name: { businessId: business.id, name: "Leave QA Branch" } },
    create: { businessId: business.id, name: "Leave QA Branch", countryCode: "MY", stateCode: "SABAH" },
    update: { status: "ACTIVE", countryCode: "MY", stateCode: "SABAH" },
  });
  await prisma.branchAttendanceSetting.upsert({
    where: { branchId: branch.id },
    create: {
      businessId: business.id, branchId: branch.id, latitude: 3.139, longitude: 101.6869,
      requireGeofence: false, allowOutsideGeofenceRequest: true, timezone: "Asia/Kuala_Lumpur", isEnabled: true,
    },
    update: { businessId: business.id, requireGeofence: false, timezone: "Asia/Kuala_Lumpur", isEnabled: true },
  });
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: { businessId: business.id, branchId: branch.id, name: "Leave QA Owner", email: ownerEmail, role: "BUSINESS_OWNER", status: "active" },
    update: { businessId: business.id, branchId: branch.id, name: "Leave QA Owner", role: "BUSINESS_OWNER", status: "active" },
  });
  const manager = await prisma.user.upsert({
    where: { email: managerEmail },
    create: {
      businessId: business.id, branchId: branch.id, name: "Leave QA Manager", email: managerEmail,
      passwordHash, loginEnabled: true, role: "STAFF", status: "active",
      permissions: ["ALL_BRANCHES", "TEAM", "VIEW_LEAVE", "APPROVE_LEAVE", "EDIT_LEAVE_POLICY", "ADJUST_LEAVE_BALANCE"],
    },
    update: {
      businessId: business.id, branchId: branch.id, name: "Leave QA Manager",
      passwordHash, loginEnabled: true, role: "STAFF", status: "active",
      permissions: ["ALL_BRANCHES", "TEAM", "VIEW_LEAVE", "APPROVE_LEAVE", "EDIT_LEAVE_POLICY", "ADJUST_LEAVE_BALANCE"],
    },
  });
  const existingHrEntitlement = await prisma.businessModuleEntitlement.findUnique({
    where: { businessId_moduleKey: { businessId: business.id, moduleKey: "HR" } },
  });
  if (!existingHrEntitlement) {
    await prisma.businessModuleEntitlement.create({
      data: {
        businessId: business.id,
        moduleKey: "HR",
        status: "ENABLED",
        enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
        source: "MANUAL",
        planCode: "LOCAL_LEAVE_CLOSURE_QA",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  }
  const account = await prisma.employeeAccount.upsert({
    where: { phoneNormalized: employeePhone },
    create: { phoneNumber: employeePhone, phoneNormalized: employeePhone, name: "Leave QA Employee", status: "ACTIVE" },
    update: { phoneNumber: employeePhone, name: "Leave QA Employee", status: "ACTIVE" },
  });
  await prisma.employeeOtpChallenge.deleteMany({ where: { phoneNumberNormalized: employeePhone } });
  const membership = await prisma.employeeBusinessMembership.upsert({
    where: { employeeAccountId_businessId: { employeeAccountId: account.id, businessId: business.id } },
    create: {
      employeeAccountId: account.id, businessId: business.id, employeeCode: "LEAVE-QA-001",
      fullName: "Leave QA Employee", phoneNumber: employeePhone, phoneNumberNormalized: employeePhone,
      attendanceEnabled: true, joinedAt: new Date("2025-01-01T00:00:00.000Z"), status: "ACTIVE",
    },
    update: { fullName: "Leave QA Employee", phoneNumber: employeePhone, phoneNumberNormalized: employeePhone, attendanceEnabled: true, status: "ACTIVE" },
  });
  let assignment = await prisma.employeeBranchAssignment.findFirst({
    where: { businessId: business.id, branchId: branch.id, membershipId: membership.id, status: "ACTIVE" },
  });
  if (!assignment) {
    assignment = await prisma.employeeBranchAssignment.create({ data: {
      businessId: business.id, branchId: branch.id, membershipId: membership.id,
      isPrimary: true, canClockIn: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z"), status: "ACTIVE",
    } });
  }
  if (!assignment.isPrimary) {
    assignment = await prisma.employeeBranchAssignment.update({ where: { id: assignment.id }, data: { isPrimary: true } });
  }
  await prisma.employeeBusinessMembership.update({ where: { id: membership.id }, data: { attendanceEnabled: true } });

  const policy = await prisma.leavePolicy.upsert({
    where: { businessId_code: { businessId: business.id, code: "OTHER" } },
    create: {
      businessId: business.id, code: "OTHER", name: "QA Personal Leave", payTreatment: "PAID",
      countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 3,
      origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY",
    },
    update: { active: true },
  });
  let version = await prisma.leavePolicyVersion.findFirst({ where: { businessId: business.id, policyId: policy.id }, orderBy: { revision: "desc" } });
  if (!version) {
    version = await prisma.leavePolicyVersion.create({ data: {
      businessId: business.id, policyId: policy.id, revision: 1,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), nameSnapshot: "QA Personal Leave",
      payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 3,
      origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY", sourceReference: "LOCAL_QA_FIXTURE",
      reason: "Local Leave closure browser fixture.", createdById: owner.id,
    } });
  }
  const leaveYearStart = new Date("2026-01-01T00:00:00.000Z");
  let entitlement = await prisma.employeeLeaveEntitlement.findFirst({ where: {
    businessId: business.id, membershipId: membership.id, policyId: policy.id, leaveYearStart,
  } });
  if (!entitlement) {
    const sourceDigest = createHash("sha256").update(JSON.stringify({
      businessId: business.id, membershipId: membership.id, policyVersionId: version.id, year: 2026, units: 3,
    })).digest("hex");
    entitlement = await prisma.employeeLeaveEntitlement.create({ data: {
      businessId: business.id, membershipId: membership.id, policyId: policy.id, policyVersionId: version.id,
      leaveYearStart, leaveYearEnd: new Date("2026-12-31T00:00:00.000Z"), entitledUnits: 3,
      source: "COMPANY_POLICY", sourceDigest, createdById: owner.id,
    } });
  }
  await prisma.leaveBalanceLedgerEntry.upsert({
    where: { sourceKey: `leave-entitlement:${entitlement.id}` },
    create: {
      businessId: business.id, membershipId: membership.id, policyId: policy.id, policyVersionId: version.id,
      leaveYearStart, eventType: "ENTITLEMENT", units: 3, sourceKey: `leave-entitlement:${entitlement.id}`,
      entitlementId: entitlement.id, reason: "Deterministic entitlement from the frozen policy version.", actorUserId: owner.id,
    },
    update: {},
  });

  const ownerSession = {
    userId: owner.id,
    homeBusinessId: business.id,
    activeBusinessId: business.id,
    contextVersion: 1,
    businessId: business.id,
    branchId: branch.id,
    name: owner.name,
    email: owner.email,
    role: owner.role,
    permissions: owner.permissions,
    status: owner.status,
  };
  const managerSession = {
    userId: manager.id,
    homeBusinessId: business.id,
    activeBusinessId: business.id,
    contextVersion: 1,
    businessId: business.id,
    branchId: branch.id,
    name: manager.name,
    email: manager.email,
    role: manager.role,
    permissions: manager.permissions,
    status: manager.status,
  };
  let statutoryRuleSet = await installSabahStatutoryRulePackDraft({
    businessId: business.id,
    actor: ownerSession,
  });
  if (statutoryRuleSet.status === "DRAFT") {
    statutoryRuleSet = await submitStatutoryRuleSetForReview({
      businessId: business.id,
      actor: ownerSession,
      rawInput: { ruleSetId: statutoryRuleSet.id, expectedStatus: "DRAFT" },
    });
  }
  if (statutoryRuleSet.status === "READY_FOR_REVIEW") {
    statutoryRuleSet = await markStatutoryRuleSetReadyForHumanSignOff({
      businessId: business.id,
      actor: managerSession,
      rawInput: {
        ruleSetId: statutoryRuleSet.id,
        expectedStatus: "READY_FOR_REVIEW",
        confirmed: true,
        reviewNote: "Independent local engineering review completed for browser acceptance; human legal sign-off remains pending.",
      },
    });
  }

  const occupied = new Set((await prisma.leaveRequestDay.findMany({
    where: { businessId: business.id, membershipId: membership.id, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
    select: { leaveDate: true },
  })).map((row) => row.leaveDate.toISOString().slice(0, 10)));
  const dates = [];
  const cursor = new Date("2026-08-17T00:00:00.000Z");
  while (dates.length < 3) {
    const key = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !occupied.has(key)) dates.push(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const date of dates) {
    const workDate = new Date(`${date}T00:00:00.000Z`);
    const existing = await prisma.attendanceExpectedDay.findFirst({ where: {
      businessId: business.id, membershipId: membership.id, workDate, status: "CURRENT",
    } });
    if (!existing) {
      await prisma.attendanceExpectedDay.create({ data: {
        businessId: business.id, branchId: branch.id, membershipId: membership.id, workDate,
        kind: "WORKDAY", source: "MANUAL_EVIDENCE",
        expectedStartAt: new Date(`${date}T01:00:00.000Z`), expectedEndAt: new Date(`${date}T09:00:00.000Z`),
        timezoneSnapshot: "Asia/Kuala_Lumpur", evidenceReference: "LOCAL_LEAVE_BROWSER_QA", createdById: owner.id,
      } });
    }
  }
  console.log(JSON.stringify({
    managerEmail,
    employeePhone,
    business: business.name,
    policy: version.nameSnapshot,
    attendanceEnabled: true,
    statutoryRuleSetStatus: statutoryRuleSet.status,
    dates,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
