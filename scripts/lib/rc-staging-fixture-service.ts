import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertStagingFixtureState } from "./rc-staging-fixture-contract";
import { seedStagingHrCore } from "./rc-staging-hr-core-data";
import { seedStagingPos } from "./rc-staging-pos-data";
import { seedStagingRoles } from "./rc-staging-role-data";
import { createStagingAuthorizer, readStagingCredentialHandoff } from "./rc-staging-fixture-mfa";
import { HR_PAYROLL_EIGHT_ROLE_PERSONAS } from "../hr-payroll-eight-role-uat-contract";
import { generatePayrollRun, submitPayrollRunForReview, finalizePayrollRun } from "../../src/lib/payroll/service";
import { publishPayrollPayslips } from "../../src/lib/payroll/payslip-publication";

const VERSION = "rc-staging-synthetic-v1";
const MARKER_ID = "f52bbfe5-736a-4b4c-83d6-770cd2376910";
const MARKER_ACTION = "RC_STAGING_SYNTHETIC_INSTALLED";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const requireState = (ok: unknown) => { if (!ok) throw new Error("RC_STAGING_FIXTURE_STATE_REJECTED"); };
const definitionFiles = ["rc-staging-fixture-contract.ts", "rc-staging-fixture-service.ts", "rc-staging-fixture-mfa.ts", "rc-staging-fixture-transport.ts", "rc-staging-fixture-preflight.ts", "rc-staging-hr-core-data.ts", "rc-staging-pos-data.ts", "rc-staging-role-data.ts", "../hr-payroll-eight-role-uat-contract.ts", "../provision-rc-staging-synthetic.ts", "../rc-staging-synthetic-worker.ts"];
type Database = PrismaClient | Prisma.TransactionClient;

async function definitionDigest() {
  return hash((await Promise.all(definitionFiles.map(async file => `${file}:${hash(await readFile(resolve(import.meta.dirname, file), "utf8"))}`))).join("\n"));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function databaseSnapshot(prisma: Database) {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
  let rows = 0;
  const fingerprints = [];
  for (const { table_name: table } of tables) {
    if (table === "_prisma_migrations") continue;
    requireState(/^[A-Za-z_][A-Za-z0-9_]*$/.test(table));
    // Identifiers come only from the connected database catalog, never user input.
    const data = await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(`SELECT to_jsonb(t) AS value FROM public."${table}" t${table === "audit_logs" ? ` WHERE id <> '${MARKER_ID}'::uuid` : ""}`);
    rows += data.length;
    fingerprints.push(`${table}:${data.map(({ value }) => hash(canonical(value))).sort().join(",")}`);
  }
  return { rows, dataDigest: hash(fingerprints.join("\n")) };
}
async function migrationCount(prisma: Database) {
  const folder = resolve(import.meta.dirname, "../../prisma/migrations");
  const names = (await readdir(folder, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
  const ledger = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
  requireState(names.length === 216 && ledger.length === 216);
  for (let i = 0; i < names.length; i++) requireState(ledger[i].migration_name === names[i] && ledger[i].checksum === hash(await readFile(resolve(folder, names[i], "migration.sql"), "utf8")) && ledger[i].finished_at && !ledger[i].rolled_back_at);
  return ledger.length;
}
export async function verifyStagingSemanticData(prisma: Database) {
  const businesses = await prisma.business.findMany({ select: { id: true, slug: true } });
  const slugs = ["tetamu-uat-salon", "tetamu-uat-auto", "tetamu-hr-uat-preview-synthetic-v1", "tetamu-hr-uat-preview-boundary-v1"];
  requireState(businesses.length === 4 && slugs.every(slug => businesses.some(b => b.slug === slug)));
  const core = businesses.find(b => b.slug === slugs[2])!;
  const members = await prisma.employeeBusinessMembership.findMany({ select: { businessId: true, employeeCode: true, isTestAccount: true } });
  requireState(members.length === 8 && members.every(m => m.isTestAccount));
  const coreScenarioCount = members.filter(m => m.businessId === core.id && /^CORE-[A-F]$/.test(m.employeeCode)).length;
  requireState(coreScenarioCount === 6);
  const branch = await prisma.branch.findFirstOrThrow({ where: { businessId: core.id, name: "Synthetic Boundary Branch" } });
  const mainBranch = await prisma.branch.findFirstOrThrow({ where: { businessId: core.id, name: "Acceptance Main Branch" } });
  let personaCount = 0;
  for (const persona of HR_PAYROLL_EIGHT_ROLE_PERSONAS) {
    if (persona.kind !== "DIRECT_USER") continue;
    const user = await prisma.user.findUnique({ where: { email: persona.email }, include: { staffRoleProfile: true } });
    requireState(user && user.businessId === core.id && user.role === "STAFF" && user.loginEnabled && user.status === "active" && canonical([...user.permissions].sort()) === canonical([...persona.permissions].sort()));
    requireState(user?.staffRoleProfile?.active && user.staffRoleProfile.businessId === core.id && canonical([...user.staffRoleProfile.permissions].sort()) === canonical([...persona.permissions].sort()));
    requireState(user?.branchId === (persona.key === "BRANCH_MANAGER" ? branch.id : mainBranch.id));
    personaCount++;
  }
  const owners = await prisma.user.findMany({ where: { businessId: core.id, role: "BUSINESS_OWNER" } });
  requireState(owners.length === 1 && owners[0].status === "active" && owners[0].loginEnabled && owners[0].branchId === mainBranch.id);
  personaCount++;
  const groups = await prisma.businessGroup.findMany({ include: { members: true, users: { include: { user: true, businessAccesses: true } } } });
  requireState(groups.length === 1 && groups[0].status === "ACTIVE" && groups[0].members.length === 2 && groups[0].users.length === 2);
  requireState(groups[0].members.every(m => m.status === "ACTIVE" && m.removedAt === null && businesses.filter(b => slugs.slice(2).includes(b.slug)).some(b => b.id === m.businessId)));
  for (const persona of HR_PAYROLL_EIGHT_ROLE_PERSONAS) {
    if (persona.kind !== "GROUP_USER") continue;
    const grant = groups[0].users.find(g => g.user.email === persona.email);
    requireState(grant && grant.status === "ACTIVE" && grant.revokedAt === null && grant.role === persona.groupRole && grant.user.loginEnabled && grant.user.status === "active" && grant.user.businessId === null && grant.user.branchId === null && grant.user.permissions.length === 0);
    requireState(grant?.user.role === (persona.groupRole === "GROUP_OWNER" ? "BUSINESS_OWNER" : "STAFF"));
    if (persona.groupRole === "GROUP_OWNER") requireState(grant?.accessScope === "ALL_GROUP_BUSINESSES" && grant.businessAccesses.length === 0);
    else requireState(grant?.accessScope === "SELECTED_BUSINESSES" && grant.businessAccesses.length === 1 && grant.businessAccesses[0].businessId === core.id);
    personaCount++;
  }
  const staff = await prisma.employeeBusinessMembership.findFirstOrThrow({ where: { businessId: core.id, status: "ACTIVE", staffUser: null, employeeCode: { startsWith: "CORE-" } }, orderBy: { employeeCode: "asc" }, include: { branchAssignments: true, employeeAccount: { include: { devices: true } } } });
  requireState(staff.isTestAccount && staff.branchAssignments.some(a => a.status === "ACTIVE" && a.isPrimary && a.branchId === mainBranch.id));
  requireState(staff.employeeAccount.devices.some(d => d.status === "ACTIVE" && d.canView && d.canPunch));
  personaCount++;
  const boundaryOwner = await prisma.user.findUniqueOrThrow({ where: { email: "uat.boundary-owner@tetamu.local" } });
  requireState(!boundaryOwner.loginEnabled && boundaryOwner.passwordHash === null);
  const now = new Date();
  const active = {
    authSession: await prisma.authSession.count({ where: { revokedAt: null, absoluteExpiresAt: { gt: now }, idleExpiresAt: { gt: now } } }),
    employeeSession: await prisma.employeeSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    usableOtp: (await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM employee_otp_challenges WHERE invalidated_at IS NULL AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempts < max_attempts`)[0].count,
  };
  requireState(Object.values(active).every(n => n === 0));
  const duplicateCount = members.length - new Set(members.map(m => `${m.businessId}:${m.employeeCode}`)).size;
  requireState(duplicateCount === 0);
  const publications = await prisma.payrollPayslipPublication.findMany();
  const confirmations = await prisma.payrollManualPcbConfirmation.findMany();
  const runs = await prisma.payrollRun.findMany({ include: { entries: { include: { attendanceInputSnapshot: true } } } });
  const codes = ["CORE-A", "CORE-B", "CORE-C", "CORE-D", "CORE-E", "CORE-F"];
  requireState(runs.length === 3 && publications.length === 14 && confirmations.length === 14);
  for (const run of runs) {
    const month = run.periodStart.toISOString().slice(0, 7);
    const expected = run.businessId === core.id ? (month === "2026-08" ? codes : month === "2026-09" ? [...codes, "BOUNDARY-B"] : []) : month === "2026-09" && run.businessId === boundaryOwner.businessId ? ["TENANT-B"] : [];
    requireState(expected.length && canonical(run.entries.map(e => e.employeeCodeSnapshot).sort()) === canonical([...expected].sort()));
    requireState(run.status === "FINALIZED" && run.submittedAt && run.finalizedAt && run.submittedById && run.finalizedById && run.submittedById !== run.finalizedById);
    for (const entry of run.entries) {
      const publication = publications.find(p => p.payrollEntryId === entry.id);
      const confirmation = confirmations.find(c => c.payrollEntryId === entry.id);
      requireState(publication && confirmation && publication.businessId === run.businessId && confirmation.businessId === run.businessId && confirmation.payrollMonth === month && confirmation.inputRevision === entry.calculationRevision && confirmation.amount.equals(entry.pcb) && confirmation.externalReference.startsWith("RC_STAGING_") && confirmation.confirmedAt);
      requireState(publication && createHash("sha256").update(publication.documentBytes).digest("hex") === publication.documentSha256);
      const authorization = await prisma.sensitiveActionAuthorization.findUniqueOrThrow({ where: { id: confirmation!.authorizationId } });
      requireState(authorization.actionKey === "PCB_MANUAL_CONFIRM" && authorization.consumedAt && authorization.userId === confirmation!.confirmedById && authorization.businessId === run.businessId && authorization.resourceId === entry.id);
    }
    const finalization = await prisma.sensitiveActionAuthorization.findMany({ where: { actionKey: "PAYROLL_FINALIZE", resourceId: run.id, userId: run.finalizedById!, consumedAt: { not: null } } });
    requireState(finalization.length === 1);
    if (run.businessId === core.id && month === "2026-08") {
      const entry = (code: string) => run.entries.find(e => e.employeeCodeSnapshot === code)!;
      requireState(entry("CORE-A").baseRateSnapshot.equals(3000) && entry("CORE-B").attendanceInputSnapshot?.approvedOvertimeMinutes === 180 && entry("CORE-B").overtimePay.greaterThan(0));
      requireState(entry("CORE-C").paidLeaveDays.equals(1) && entry("CORE-D").unpaidLeaveDays.equals(1) && entry("CORE-D").unpaidLeaveDeduction.greaterThan(0));
    }
  }
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { businessId: businesses.find(b => b.slug === slugs[0])!.id, invoiceNumber: "UAT-TRACE-0001" }, include: { payments: true } });
  requireState(invoice.total.equals(100) && invoice.paidAmount.equals(100) && invoice.balance.equals(0) && invoice.status === "PAID" && invoice.payments.length === 2 && invoice.payments.some(p => p.method === "CARD" && p.amount.equals(40)) && invoice.payments.some(p => p.method === "DUITNOW" && p.amount.equals(60)));
  const auto = await prisma.workOrder.findFirstOrThrow({ where: { businessId: businesses.find(b => b.slug === slugs[1])!.id, orderNumber: "UAT-WO-0001" } });
  requireState(auto.total.equals(180) && auto.paidAmount.equals(0) && auto.paymentStatus === "UNPAID");
  return { businessCount: businesses.length, coreScenarioCount, personaCount, duplicateCount, publicationCount: publications.length, payrollRunCount: runs.length, active };
}

async function boundaryPayroll(prisma: PrismaClient, password: string) {
  for (const [slug, actorEmail] of [["tetamu-hr-uat-preview-synthetic-v1", "uat.payroll-admin@tetamu.local"], ["tetamu-hr-uat-preview-boundary-v1", "uat.group-owner@tetamu.local"]]) {
    const business = await prisma.business.findUniqueOrThrow({ where: { slug } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } });
    const members = await prisma.employeeBusinessMembership.findMany({ where: { businessId: business.id, employeeCode: { in: ["BOUNDARY-B", "TENANT-B"] } } });
    for (const member of members) {
      await prisma.employeeCompensationVersion.create({ data: { businessId: business.id, membershipId: member.id, effectiveFromMonth: new Date("2026-09-01"), payBasis: "MONTHLY", baseRate: 2800, source: "MANUAL", reasonType: "DATA_MIGRATION", reasonNote: "RC STAGING synthetic boundary baseline", createdById: user.id } });
      await prisma.employeeLindung24ParticipationVersion.create({ data: { businessId: business.id, membershipId: member.id, revision: 1, effectiveFromMonth: new Date("2026-06-01"), status: "DEFAULT_PARTICIPATING", employerContext: "SINGLE_EMPLOYER", selectedEmployer: "CURRENT_BUSINESS", act4Covered: false, sourceType: "OFFICIAL_TRANSITION", sourceReference: "RC_STAGING_SYNTHETIC_NON_ACT4", reason: "Synthetic boundary non-Act4 evidence", sourceDigest: hash(member.employeeCode), recordedById: user.id } });
    }
    const actor = { userId: user.id, name: user.name, email: user.email! };
    const run = await generatePayrollRun({ businessId: business.id, actor, month: "2026-09" }, prisma);
    const authorizer = await createStagingAuthorizer(prisma, business.id, user.id, password);
    const entries = await prisma.payrollEntry.findMany({ where: { payrollRunId: run.id } });
    const certified = new Set(["CORE-A", "CORE-B", "CORE-C", "CORE-D", "CORE-E", "CORE-F", "BOUNDARY-B", "TENANT-B"]);
    for (const entry of entries) {
      requireState(certified.has(entry.employeeCodeSnapshot));
      await authorizer.confirm(entry.id, "0.00", `RC_STAGING_CERTIFIED_SYNTHETIC_ZERO_${entry.employeeCodeSnapshot}_2026_09`);
    }
    await submitPayrollRunForReview({ businessId: business.id, actor, runId: run.id }, prisma);
    const reviewer = slug.endsWith("boundary-v1")
      ? await prisma.user.findUniqueOrThrow({ where: { email: "uat.boundary-owner@tetamu.local" } })
      : await prisma.user.findFirstOrThrow({ where: { businessId: business.id, role: "BUSINESS_OWNER" } });
    // The synthetic tenant's own Owner participates in a real two-person MFA
    // workflow, then returns to its original disabled-login fixture state.
    await withStagingReviewer(prisma, reviewer.id, password, async () => {
      const reviewerAuthorization = await createStagingAuthorizer(prisma, business.id, reviewer.id, password);
      await finalizePayrollRun({ businessId: business.id, actor: { userId: reviewer.id, name: reviewer.name, email: reviewer.email! }, runId: run.id, stepUp: await reviewerAuthorization.authorize("PAYROLL_FINALIZE", run.id) }, prisma);
      await publishPayrollPayslips({ businessId: business.id, actor, runId: run.id }, prisma);
    });
  }
}

export async function withStagingReviewer<T>(prisma: PrismaClient, userId: string, password: string, action: () => Promise<T>) {
  const original = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!original.loginEnabled) await prisma.user.update({ where: { id: userId }, data: { loginEnabled: true, passwordHash: await bcrypt.hash(password, 12) } });
  try { return await action(); }
  finally {
    if (!original.loginEnabled) await prisma.user.update({ where: { id: userId }, data: { loginEnabled: original.loginEnabled, passwordHash: original.passwordHash } });
  }
}

// Called only after the exclusive empty-database guard. On partial install it
// leaves business data untouched, but always revokes temporary authentication.
export async function withStagingSessionCleanup<T>(prisma: PrismaClient, action: () => Promise<T>) {
  try { return await action(); }
  finally {
    const businessIds = (await prisma.business.findMany({ select: { id: true } })).map(b => b.id);
    const userIds = (await prisma.user.findMany({ select: { id: true } })).map(u => u.id);
    const employeeIds = (await prisma.employeeAccount.findMany({ select: { id: true } })).map(e => e.id);
    await prisma.authSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "RC_STAGING_FIXTURE_COMPLETE" } });
    await prisma.employeeSession.updateMany({ where: { businessId: { in: businessIds }, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "RC_STAGING_FIXTURE_COMPLETE" } });
    await prisma.employeeOtpChallenge.updateMany({ where: { employeeAccountId: { in: employeeIds }, verifiedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: prisma.employeeOtpChallenge.fields.maxAttempts } }, data: { invalidatedAt: new Date() } });
  }
}

export async function verifyStagingSynthetic(prisma: Database) {
  const migrations = await migrationCount(prisma);
  const snapshot = await databaseSnapshot(prisma);
  const marker = await prisma.auditLog.findUnique({ where: { id: MARKER_ID } });
  requireState(marker?.action === MARKER_ACTION && marker.entityType === "RC_STAGING_SYNTHETIC");
  if ((marker!.metadata as Record<string, unknown>)?.credentialsDigest !== hash(canonical(readStagingCredentialHandoff().data))) throw new Error("RC_STAGING_FIXTURE_CREDENTIALS_REJECTED");
  const digest = await definitionDigest();
  assertStagingFixtureState({ rows: snapshot.rows, marker: marker?.metadata, expectedVersion: VERSION, expectedDefinitionDigest: digest, currentDigest: snapshot.dataDigest });
  return { ...await verifyStagingSemanticData(prisma), dataDigest: snapshot.dataDigest, definitionDigest: digest, version: VERSION, migrationCount: migrations };
}

export async function provisionStagingSynthetic(prisma: PrismaClient, input: { password: string }) {
  if (input.password.length < 32) throw new Error("RC_STAGING_FIXTURE_PASSWORD_REQUIRED");
  if (readStagingCredentialHandoff().data.password !== input.password) throw new Error("RC_STAGING_FIXTURE_CREDENTIALS_REJECTED");
  return prisma.$transaction(async lock => {
    await lock.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(20260921, 216)`;
    await migrationCount(lock);
    const snapshot = await databaseSnapshot(lock);
    const marker = await lock.auditLog.findUnique({ where: { id: MARKER_ID } });
    const digest = await definitionDigest();
    const state = assertStagingFixtureState({ rows: snapshot.rows, marker: marker?.metadata ?? null, expectedVersion: VERSION, expectedDefinitionDigest: digest, currentDigest: snapshot.dataDigest });
    if (state === "VERIFY_ONLY") return { ...await verifyStagingSynthetic(lock), mode: "VERIFIED_EXISTING" as const };
    const core = await withStagingSessionCleanup(prisma, async () => {
      await seedStagingPos(prisma, input.password);
      const installed = await seedStagingHrCore(prisma, input.password);
      await seedStagingRoles(prisma, input.password, installed);
      await boundaryPayroll(prisma, input.password);
      return installed;
    });
    await verifyStagingSemanticData(prisma);
    const final = await databaseSnapshot(prisma);
    await lock.auditLog.create({ data: { id: MARKER_ID, businessId: core.businessId, action: MARKER_ACTION, entityType: "RC_STAGING_SYNTHETIC", summary: "Isolated synthetic fixture installed via domain services", metadata: { status: "COMPLETE", version: VERSION, definitionDigest: digest, dataDigest: final.dataDigest, credentialsDigest: hash(canonical(readStagingCredentialHandoff().data)) } } });
    return { ...await verifyStagingSynthetic(lock), mode: "INSTALLED" as const };
  }, { timeout: 300000, maxWait: 300000 });
}
