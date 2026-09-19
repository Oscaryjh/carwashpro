import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parsePayrollMonth } from "../src/lib/payroll/period";
import {
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureCounts,
  HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION,
} from "./uat-preview-database-guard";

// One reviewed maintenance authorization, not a general Payroll administration API.
// No HTTP/UI imports this file. The CLI accepts no target, policy or fingerprint overrides.
const TARGETS = [
  {
    key: "primary-boundary", businessId: "6ff8b244-d997-43b9-8a23-e9cfda817f5d",
    runId: "a5739bf1-bcc4-51ad-b24c-0aa9b64020da", employeeCode: "BOUNDARY-B",
    oldFingerprint: "1b726728c0d76f7f18836fc3bd23e7cff4b41fc81f6c58619486943a99b12f1a",
    phone: "+60000000001",
  },
  {
    key: "tenant-boundary", businessId: "1e866adf-e9e9-593d-b45b-2ec5b01eb068",
    runId: "8698226d-a3a3-5b15-9fc1-c13f95f415a0", employeeCode: "TENANT-B",
    oldFingerprint: "ff9bcccb8e94b55bed3053492f8ca5c7896adc5143096dc5d55d02a96e581451",
    phone: "+60000000002",
  },
] as const;
const OLD_END = new Date("2026-09-30T00:00:00.000Z");
const PERIOD = parsePayrollMonth("2026-09");
const OLD_PROJECTION = "7f213eaa04d56a2ab0d57d763704933b806b11daee5e51b121fa24115f22ebe7";
const IDENTITY = {
  RAILWAY_PROJECT_ID: "ec8b25a7-4fb9-4959-8353-b4af000f4e80",
  RAILWAY_ENVIRONMENT_ID: "29581a37-4291-497a-91aa-25a9432b3227",
  RAILWAY_SERVICE_ID: "909f20b1-8901-4072-b7ca-5dd147f20c45",
  RAILWAY_DATABASE_SERVICE_ID: "ad89c158-aa04-485f-8efe-2a50f46b63ac",
} as const;
const approvedInclude = {
  business: { select: { id: true, name: true, slug: true } },
  entries: { orderBy: { id: "asc" }, include: {
    membership: { select: { id: true, businessId: true, employeeCode: true, isTestAccount: true } },
    _count: { select: { paymentInstructions: true, recurringPaySnapshots: true, variablePayApplied: true, correctionsOriginal: true, correctionsApplied: true, statutorySnapshots: true, claimReimbursementSnapshots: true, workPayCalculationLines: true } },
  } },
  components: { orderBy: { id: "asc" }, include: { _count: { select: { statutoryTreatments: true, workPayLines: true } } } },
  payslipPublications: { orderBy: { id: "asc" }, select: { id: true, businessId: true, payrollRunId: true, payrollEntryId: true, membershipId: true, documentSha256: true, publishedAt: true, publishedById: true } },
  _count: { select: { statutorySubmissions: true, statutoryArtifacts: true, paymentBatches: true, attendanceInputSnapshots: true, workPaySnapshots: true, workPayLines: true, statutorySnapshots: true, claimReimbursementSnapshots: true } },
} as const satisfies Prisma.PayrollRunInclude;
type ApprovedRun = Prisma.PayrollRunGetPayload<{ include: typeof approvedInclude }>;
type Tx = Prisma.TransactionClient;
function fail(reason: string): never { throw new Error(`HR_UAT_PERIOD_MAINTENANCE_${reason}`); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function bytesHash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }

function environmentGuard(env: NodeJS.ProcessEnv) {
  // Existing denylist-first name/fingerprint/environment/service guards remain authoritative.
  const guard = assertHrPayrollUatFixtureEnvironment(env);
  if (env.APP_ENVIRONMENT !== "uat-preview" || env.NODE_ENV !== "production" || guard.mode !== "uat-preview") fail("ENVIRONMENT_MISMATCH");
  for (const [key, value] of Object.entries(IDENTITY)) if (env[key] !== value) fail("IDENTITY_MISMATCH");
  return guard;
}

function assertKnownRelations() {
  const known = {
    PayrollRun: ["business", "createdBy", "submittedBy", "finalizedBy", "attendanceTimesheetRevision", "entries", "components", "statutorySubmissions", "statutoryArtifacts", "paymentBatches", "payslipPublications", "attendanceInputSnapshots", "workPaySnapshots", "workPayLines", "statutorySnapshots", "claimReimbursementSnapshots"],
    PayrollEntry: ["payrollRun", "business", "membership", "compensationVersion", "paymentInstructions", "recurringPaySnapshots", "components", "variablePayApplied", "correctionsOriginal", "correctionsApplied", "payslipPublication", "attendanceInputSnapshot", "workPayCalculationSnapshot", "workPayCalculationLines", "statutorySnapshots", "claimReimbursementSnapshots"],
    PayrollEntryComponent: ["business", "payrollRun", "payrollEntry", "membership", "createdBy", "statutoryTreatments", "workPayLines"],
    PayrollPayslipPublication: ["business", "payrollRun", "payrollEntry", "membership", "publishedBy"],
  };
  for (const [name, fields] of Object.entries(known)) {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === name);
    const actual = model?.fields.filter(f => f.kind === "object").map(f => f.name).sort();
    if (!isDeepStrictEqual(actual, fields.sort())) fail("UNKNOWN_RELATION");
  }
}

async function lockTargets(tx: Tx) {
  const businessIds = TARGETS.map(t => t.businessId), runIds = TARGETS.map(t => t.runId);
  await tx.$queryRaw`SELECT id FROM businesses WHERE id IN (${Prisma.join(businessIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT m.id FROM employee_business_memberships m JOIN payroll_entries e ON e.membership_id = m.id WHERE e.payroll_run_id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY m.id FOR UPDATE OF m`;
  await tx.$queryRaw`SELECT a.id FROM employee_accounts a JOIN employee_business_memberships m ON m.employee_account_id = a.id JOIN payroll_entries e ON e.membership_id = m.id WHERE e.payroll_run_id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY a.id FOR UPDATE OF a`;
  await tx.$queryRaw`SELECT id FROM payroll_entries WHERE payroll_run_id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payroll_entry_components WHERE payroll_run_id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payroll_payslip_publications WHERE payroll_run_id IN (${Prisma.join(runIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}

async function readAndValidate(tx: Tx) {
  const result: ApprovedRun[] = [];
  for (const target of TARGETS) {
    const run = await tx.payrollRun.findUnique({ where: { id: target.runId }, include: approvedInclude });
    if (!run || run.businessId !== target.businessId || run.status !== "FINALIZED" || run.periodStart.getTime() !== PERIOD.start.getTime() || ![OLD_END.getTime(), PERIOD.end.getTime()].includes(run.periodEnd.getTime())) fail("SCOPE_MISMATCH");
    const collision = await tx.payrollRun.count({ where: {
      businessId: target.businessId, id: { not: target.runId }, periodStart: { lt: PERIOD.end }, periodEnd: { gt: PERIOD.start },
    } });
    if (collision) fail("COLLISION");
    if (run.entries.length !== 1 || run.components.length !== 1 || run.payslipPublications.length !== 1) fail("SCOPE_MISMATCH");
    const [entry, component, publication] = [run.entries[0], run.components[0], run.payslipPublications[0]];
    if (!entry.membership.isTestAccount || entry.membership.businessId !== target.businessId || entry.membership.employeeCode !== target.employeeCode || entry.payrollRunId !== run.id || component.payrollEntryId !== entry.id || publication.payrollEntryId !== entry.id || publication.payrollRunId !== run.id || publication.membershipId !== entry.membershipId) fail("SCOPE_MISMATCH");
    if (run.attendanceTimesheetRevisionId || Object.values(run._count).some(Boolean) || Object.values(entry._count).some(Boolean) || Object.values(component._count).some(Boolean)) fail("UNKNOWN_RELATION");
    // Extra singleton relations are not represented by Prisma's list-only _count.
    const linked = await tx.payrollEntry.findUniqueOrThrow({ where: { id: entry.id }, select: {
      attendanceInputSnapshot: { select: { id: true } }, workPayCalculationSnapshot: { select: { id: true } },
      membership: { select: { fullName: true, phoneNumberNormalized: true, employeeAccount: { select: { name: true, phoneNormalized: true, status: true } } } },
    } });
    if (linked.attendanceInputSnapshot || linked.workPayCalculationSnapshot) fail("UNKNOWN_RELATION");
    if (linked.membership.fullName !== entry.fullNameSnapshot || !entry.fullNameSnapshot.startsWith("Synthetic ") || linked.membership.phoneNumberNormalized !== target.phone || linked.membership.employeeAccount.phoneNormalized !== target.phone || linked.membership.employeeAccount.name !== entry.fullNameSnapshot || linked.membership.employeeAccount.status !== "ACTIVE") fail("SCOPE_MISMATCH");
    const document = await tx.payrollPayslipPublication.findUniqueOrThrow({ where: { id: publication.id } });
    const expectedBytes = Buffer.from(`synthetic-payslip:${target.key}`);
    if (!Buffer.from(document.documentBytes).equals(expectedBytes) || bytesHash(document.documentBytes) !== document.documentSha256) fail("DOCUMENT_MISMATCH");
    const normalizedRun = { ...run, periodEnd: OLD_END };
    if (hash(normalizedRun) !== target.oldFingerprint) fail("FINGERPRINT_MISMATCH");
    result.push(run);
  }
  const oldCount = result.filter(r => r.periodEnd.getTime() === OLD_END.getTime()).length;
  if (oldCount !== 0 && oldCount !== TARGETS.length) fail("MIXED_STATE");
  const originalProjection = result.map((run, i) => ({
    key: TARGETS[i].key, expectedBusinessId: TARGETS[i].businessId, expectedCanonicalEnd: PERIOD.end,
    syntheticTopologyVersion: HR_PAYROLL_UAT_SYNTHETIC_TOPOLOGY_VERSION,
    versionSource: "frozen fixture constant plus database synthetic markers; no per-run version column",
    run: { ...run, periodEnd: OLD_END }, collisions: [], issues: [], oldValueFingerprint: TARGETS[i].oldFingerprint,
  }));
  if (hash(originalProjection) !== OLD_PROJECTION) fail("PROJECTION_MISMATCH");
  return { runs: result, oldCount };
}

/** Privileged non-HTTP entrypoint. No alternate target/approval policy can be supplied. */
export async function maintainApprovedBoundaryPeriods(database: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  environmentGuard(env);
  assertKnownRelations();
  return database.$transaction(async tx => {
    const guard = environmentGuard(env);
    const identity = await tx.$queryRaw<Array<{ databaseName: string; username: string }>>`SELECT current_database() AS "databaseName", current_user AS username`;
    const connection = new URL(env.DATABASE_URL!);
    if (identity.length !== 1 || identity[0].databaseName !== guard.databaseName || identity[0].username !== decodeURIComponent(connection.username)) fail("CONNECTED_DATABASE_MISMATCH");
    await lockTargets(tx);
    const state = await assertPreviewDatabaseContents(tx, guard);
    if (state.state !== "synthetic-topology" || state.businessId !== TARGETS[0].businessId || state.boundaryBusinessId !== TARGETS[1].businessId) fail("SCOPE_MISMATCH");
    const safety = await capturePreviewFixtureCounts(tx, state.businessId);
    for (const name of ["activeEmployeeSessions", "activeAppSessions", "activeOtpChallenges", "paymentBatches", "statutorySubmissions", "outboundWhatsApp", "outboundNotifications"] as const) if (safety[name] !== 0) fail("ACTIVE_OR_RESTRICTED_RECORD");
    const before = await readAndValidate(tx);
    const documentsBefore = await tx.payrollPayslipPublication.findMany({ where: { payrollRunId: { in: TARGETS.map(t => t.runId) } }, orderBy: { id: "asc" } });
    if (before.oldCount === 0) return { changedRuns: 0, noOp: true, projectionDigest: hash(before.runs) };
    for (const run of before.runs) {
      await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${run.id}, TRUE)`;
      await tx.payrollRun.update({ where: { id: run.id }, data: {
        status: "DRAFT", submittedAt: null, submittedById: null,
        finalizedAt: null, finalizedById: null, updatedAt: run.updatedAt,
      } });
      await tx.payrollRun.update({ where: { id: run.id }, data: {
        periodEnd: PERIOD.end, status: "FINALIZED", submittedAt: run.submittedAt,
        submittedById: run.submittedById, finalizedAt: run.finalizedAt,
        finalizedById: run.finalizedById, updatedAt: run.updatedAt,
      } });
      await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', '', TRUE)`;
    }
    const after = await readAndValidate(tx);
    const documentsAfter = await tx.payrollPayslipPublication.findMany({ where: { payrollRunId: { in: TARGETS.map(t => t.runId) } }, orderBy: { id: "asc" } });
    if (after.oldCount !== 0 || !isDeepStrictEqual(documentsBefore, documentsAfter) || !isDeepStrictEqual(after.runs.map(r => ({ ...r, periodEnd: OLD_END })), before.runs)) fail("POSTCONDITION_MISMATCH");
    return { changedRuns: TARGETS.length, noOp: false, projectionDigest: hash(after.runs) };
  // Fresh statement snapshots after all parent/related-row locks are essential:
  // a transaction-wide snapshot taken before waiting for locks could miss a
  // just-committed FK child. Parent locks then prevent new target associations.
  }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
}
