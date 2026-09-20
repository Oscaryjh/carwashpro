import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { confirmManualPcb, manualPcbInputDigest } from "../../src/lib/payroll/manual-pcb-service";
import { generatePayrollRun } from "../../src/lib/payroll/service";
import { beginMfaEnrollment, completeMfaEnrollment } from "../../src/lib/auth/mfa-service";
import { generateTotpCode } from "../../src/lib/auth/mfa-totp";
import { verifySensitiveActionMfa } from "../../src/lib/auth/sensitive-action-service";
import { getSensitiveActionPolicy, type SensitiveActionKey } from "../../src/lib/auth/sensitive-actions";
const authorizers = new Map<string, ReturnType<typeof enrollFixtureMfa>>();

export function assertLocalPcbFixture() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const ownedName = url.pathname === "/rc_pcb_verification_vc1_disposable_synthetic" || /^\/tetamu_uat_preview_fixture_\d+_\d+$/.test(url.pathname);
  if (process.env.RC_DISPOSABLE_TEST !== "1" || !["127.0.0.1", "localhost"].includes(url.hostname) || !ownedName) throw new Error("LOCAL_DISPOSABLE_REQUIRED");
}

export async function enableFixturePayrollModules(businessId: string) {
  assertLocalPcbFixture();
  for (const moduleKey of ["HR", "PAYROLL"] as const) {
    const existing = await prisma.businessModuleEntitlement.findUnique({ where: { businessId_moduleKey: { businessId, moduleKey } } });
    if (!existing) await prisma.businessModuleEntitlement.create({ data: { businessId, moduleKey, status: "ENABLED", source: "MANUAL", enabledFrom: new Date("2020-01-01") } });
    else if (existing.status !== "ENABLED") throw new Error("FIXTURE_MODULE_NOT_ENABLED");
  }
}

// Callers must supply an explicit certified test amount AND reference. No defaults.
export async function confirmFixturePcb(input: { businessId: string; entryId: string; actorId: string; amount: string; externalReference: string; password?: string }) {
  assertLocalPcbFixture();
  const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { businessId: input.businessId, id: input.entryId } });
  const key = `${input.businessId}:${input.actorId}`;
  if (!authorizers.has(key)) authorizers.set(key, enrollFixtureMfa(input.businessId, input.actorId, input.password));
  const authorize = await authorizers.get(key)!;
  return confirmManualPcb({ ...input, expectedRevision: entry.calculationRevision, expectedInputDigest: await manualPcbInputDigest(prisma, input.businessId, input.entryId), confirmed: true, stepUp: await authorize("PCB_MANUAL_CONFIRM", input.entryId) });
}

export async function createCanonicalPcbFixture() {
  assertLocalPcbFixture();
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: "Canonical manual PCB", slug: `manual-pcb-${suffix}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Payroll branch" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Synthetic Payroll Owner", email: `owner-${suffix}@test.invalid`, role: "BUSINESS_OWNER" } });
  await enableFixturePayrollModules(business.id);
  const phone = `+601${suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await prisma.employeeAccount.create({ data: { name: "Synthetic employee", phoneNumber: phone, phoneNormalized: phone } });
  const member = await prisma.employeeBusinessMembership.create({ data: { businessId: business.id, employeeAccountId: account.id, employeeCode: "MANUAL", fullName: "Synthetic employee", joinedAt: new Date("2026-01-01"), phoneNumber: phone, phoneNumberNormalized: phone, statutoryNationality: "MALAYSIAN" } });
  await prisma.employeeBranchAssignment.create({ data: { businessId: business.id, membershipId: member.id, branchId: branch.id, isPrimary: true } });
  await prisma.employeeCompensationVersion.create({ data: { businessId: business.id, membershipId: member.id, effectiveFromMonth: new Date("2026-07-01"), payBasis: "MONTHLY", baseRate: 3000, source: "MANUAL", reasonType: "OTHER", createdById: owner.id } });
  await prisma.employeeLindung24ParticipationVersion.create({ data: { businessId: business.id, membershipId: member.id, act4Covered: false, effectiveFromMonth: new Date("2026-06-01"), employerContext: "SINGLE_EMPLOYER", selectedEmployer: "CURRENT_BUSINESS", reason: "Explicit non-Act4 synthetic test evidence", recordedById: owner.id, revision: 1, sourceDigest: "f".repeat(64), sourceReference: "CANONICAL_TEST_NON_ACT4", sourceType: "OFFICIAL_TRANSITION", status: "DEFAULT_PARTICIPATING" } });
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: business.id, periodStart: new Date("2026-07-01") } });
  const revision = await prisma.attendanceTimesheetRevision.create({ data: { businessId: business.id, timesheetId: timesheet.id, lockedById: owner.id, periodStart: new Date("2026-07-01"), revision: 1, sourceDigest: "d".repeat(64), reason: "Canonical synthetic locked monthly attendance" } });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: timesheet.id }, data: { currentRevisionId: revision.id, status: "LOCKED" } });
  const actor = { userId: owner.id, name: owner.name, email: owner.email! };
  const run = await generatePayrollRun({ businessId: business.id, actor, month: "2026-07" });
  const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { payrollRunId: run.id, membershipId: member.id } });
  return { business, branch, owner, member, run, entry, actor };
}

export async function enrollFixtureMfa(businessId: string, userId: string, existingPassword?: string) {
  assertLocalPcbFixture();
  process.env.MFA_ACTIVE_KEY_VERSION ??= "local-rc-test";
  process.env.MFA_ENCRYPTION_KEYS ??= JSON.stringify({ "local-rc-test": randomBytes(32).toString("base64") });
  const password = existingPassword ?? randomBytes(32).toString("base64url");
  if (existingPassword === undefined) await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 12) } });
  const now = new Date();
  const session = await prisma.authSession.create({ data: { id: randomUUID(), contextVersion: 1, userId, activeBusinessId: businessId, absoluteExpiresAt: new Date(now.getTime() + 3600000), idleExpiresAt: new Date(now.getTime() + 1800000) } });
  const request = { ipAddress: "127.0.0.1", userAgent: "Manual PCB local integration" };
  const pending = await beginMfaEnrollment({ userId, sessionId: session.id, password, request });
  const enrolled = await completeMfaEnrollment({ userId, sessionId: session.id, credentialId: pending.credential.id, code: generateTotpCode({ secret: pending.manualSecret, timestamp: Date.now() }), request });
  let nextCode = 0;
  return async (actionKey: SensitiveActionKey, resourceId: string) => {
    const code = enrolled.recoveryCodes[nextCode++];
    if (!code) throw new Error("TEST_RECOVERY_CODES_EXHAUSTED");
    const result = await verifySensitiveActionMfa({ actionKey, resourceId, resourceType: getSensitiveActionPolicy(actionKey).resourceType, businessId, userId, sessionId: session.id, password, factor: { factorType: "RECOVERY_CODE", code }, request });
    return { rawToken: result.rawToken, sessionId: session.id };
  };
}
