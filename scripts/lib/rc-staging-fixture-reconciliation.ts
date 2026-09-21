import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveManualPcb } from "../../src/lib/payroll/manual-pcb-service";
import { POS_CORE_UAT } from "./pos-core-uat-contract";
import { HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG } from "../uat-preview-database-guard";
import { readStagingCredentialHandoff } from "./rc-staging-fixture-mfa";

type Database = PrismaClient | Prisma.TransactionClient;

const CHECKPOINT = "CORE_PCB_CONFIRMED_DRAFT" as const;
const EXPECTED_CHECKPOINT_DATA_DIGEST = "a3843d0e4dfe171f7a6f07615c8d218b1b8bae8e42320457853f42dc54bc4264";
const EXPECTED_CHECKPOINT_CREDENTIAL_DIGEST = "33b4436fc35b628bf66ee339c28f875689085673a15014de6162718f908eeef9";
const EXPECTED_TABLE_COUNTS: Record<string, number> = {
  appointments: 4,
  attendance_correction_requests: 1,
  attendance_exceptions: 1,
  attendance_monthly_timesheets: 1,
  attendance_p2_exceptions: 1,
  attendance_p2_final_results: 6,
  attendance_timesheet_p2_day_snapshots: 6,
  attendance_timesheet_p2_segment_snapshots: 4,
  attendance_timesheet_revisions: 1,
  audit_logs: 6,
  auth_security_events: 23,
  auth_sessions: 1,
  branch_attendance_settings: 1,
  branches: 5,
  business_module_entitlement_events: 6,
  business_module_entitlements: 10,
  business_payment_methods: 6,
  businesses: 3,
  catalog_discounts: 3,
  claim_categories: 1,
  claim_events: 1,
  claim_lines: 1,
  claim_policy_revisions: 1,
  claim_reimbursements: 1,
  commission_periods: 1,
  commission_statements: 1,
  customers: 4,
  employee_accounts: 6,
  employee_branch_assignments: 6,
  employee_business_memberships: 6,
  employee_claims: 1,
  employee_compensation_versions: 6,
  employee_devices: 6,
  employee_leave_balances: 1,
  employee_leave_entitlements: 1,
  employee_lindung24_participation_versions: 6,
  employee_sessions: 6,
  employee_statutory_profile_versions: 6,
  invoice_items: 1,
  invoices: 1,
  leave_balance_ledger_entries: 2,
  leave_consumption_allocations: 1,
  leave_entitlement_buckets: 1,
  leave_policies: 2,
  leave_policy_versions: 2,
  leave_request_days: 2,
  leave_requests: 2,
  package_categories: 1,
  package_service_benefits: 1,
  packages: 1,
  payments: 2,
  payroll_attendance_input_snapshots: 6,
  payroll_claim_reimbursement_snapshots: 1,
  payroll_component_statutory_treatment_snapshots: 45,
  payroll_entries: 6,
  payroll_entry_components: 9,
  payroll_entry_statutory_snapshots: 30,
  payroll_manual_pcb_confirmations: 6,
  payroll_runs: 1,
  payroll_settings: 1,
  payroll_variable_pay: 1,
  product_categories: 2,
  product_stocks: 5,
  products: 3,
  roster_assignments: 6,
  roster_periods: 1,
  roster_publications: 1,
  roster_published_assignments: 6,
  roster_shift_templates: 1,
  sensitive_action_authorizations: 6,
  service_categories: 2,
  service_staff_assignments: 6,
  services: 4,
  user_mfa_credentials: 1,
  user_mfa_recovery_codes: 10,
  users: 12,
  vehicles: 1,
  work_order_items: 1,
  work_orders: 1,
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonicalUnordered = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalUnordered).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalUnordered(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const canonicalExact = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalExact).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalExact(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

function rejectUnless(value: unknown): asserts value {
  if (!value) throw new Error("RC_STAGING_FIXTURE_RECONCILIATION_REJECTED");
}

async function checkpointSnapshot(database: Database) {
  const tables = await database.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const counts: Record<string, number> = {};
  const rowDigests: string[] = [];
  for (const { table_name: table } of tables) {
    if (table === "_prisma_migrations") continue;
    rejectUnless(/^[A-Za-z_][A-Za-z0-9_]*$/.test(table));
    const rows = await database.$queryRawUnsafe<Array<{ value: unknown }>>(
      `SELECT to_jsonb(t) AS value FROM public."${table}" t`,
    );
    if (!rows.length) continue;
    counts[table] = rows.length;
    const tableDigest = hash(rows
        .map(({ value }) => value)
        .map((value) => hash(canonicalExact(value)))
        .sort()
        .join(","));
    rowDigests.push(`${table}:${tableDigest}`);
  }
  return {
    counts,
    dataDigest: hash(rowDigests.join("\n")),
  };
}

async function verifyCheckpointSemantics(database: Database) {
  const businesses = await database.business.findMany({
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, name: true, industryType: true, timezone: true },
  });
  rejectUnless(canonicalUnordered(businesses.map(({ slug, name, industryType, timezone }) => ({ slug, name, industryType, timezone }))) === canonicalUnordered([
    { slug: POS_CORE_UAT.auto.slug, name: POS_CORE_UAT.auto.name, industryType: "AUTO_DETAILING", timezone: "Asia/Kuching" },
    { slug: POS_CORE_UAT.salon.slug, name: POS_CORE_UAT.salon.name, industryType: "SALON_BEAUTY", timezone: "Asia/Kuching" },
    { slug: HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG, name: "Tetamu HR Acceptance Test", industryType: "GENERAL_SERVICE", timezone: "Asia/Kuching" },
  ]));
  const bySlug = new Map(businesses.map((business) => [business.slug, business]));
  const core = bySlug.get(HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG)!;
  const branches = await database.branch.findMany({ select: { id: true, businessId: true, name: true, status: true } });
  const branchNames = (slug: string) => branches
    .filter((branch) => branch.businessId === bySlug.get(slug)!.id)
    .map(({ name, status }) => ({ name, status }));
  rejectUnless(canonicalUnordered(branchNames(POS_CORE_UAT.salon.slug)) === canonicalUnordered([{ name: "Branch A", status: "ACTIVE" }, { name: "Branch B", status: "ACTIVE" }]));
  rejectUnless(canonicalUnordered(branchNames(POS_CORE_UAT.auto.slug)) === canonicalUnordered([{ name: "Branch A", status: "ACTIVE" }, { name: "Branch B", status: "ACTIVE" }]));
  rejectUnless(canonicalUnordered(branchNames(core.slug)) === canonicalUnordered([{ name: "Acceptance Main Branch", status: "ACTIVE" }]));

  const entitlements = await database.businessModuleEntitlement.findMany({ select: { businessId: true, moduleKey: true, status: true } });
  const modules = (slug: string) => entitlements.filter((item) => item.businessId === bySlug.get(slug)!.id).map((item) => `${item.moduleKey}:${item.status}`).sort();
  rejectUnless(canonicalUnordered(modules(POS_CORE_UAT.salon.slug)) === canonicalUnordered(["INVENTORY:ENABLED", "POS:ENABLED", "SALON:ENABLED"]));
  rejectUnless(canonicalUnordered(modules(POS_CORE_UAT.auto.slug)) === canonicalUnordered(["AUTO:ENABLED", "INVENTORY:ENABLED", "POS:ENABLED"]));
  rejectUnless(canonicalUnordered(modules(core.slug)) === canonicalUnordered(["CLAIMS:ENABLED", "COMMISSION:ENABLED", "HR:ENABLED", "PAYROLL:ENABLED"]));

  const expectedCodes = ["CORE-A", "CORE-B", "CORE-C", "CORE-D", "CORE-E", "CORE-F"];
  const members = await database.employeeBusinessMembership.findMany({
    select: { id: true, businessId: true, employeeCode: true, fullName: true, isTestAccount: true, status: true },
  });
  rejectUnless(members.length === 6 && members.every((member) => member.businessId === core.id && member.isTestAccount && member.status === "ACTIVE"));
  rejectUnless(canonicalUnordered(members.map((member) => member.employeeCode).sort()) === canonicalUnordered(expectedCodes));
  const assignments = await database.employeeBranchAssignment.findMany({ select: { membershipId: true, branchId: true, isPrimary: true, status: true } });
  const coreBranch = branches.find((branch) => branch.businessId === core.id)!;
  rejectUnless(assignments.length === 6 && assignments.every((assignment) => assignment.branchId === coreBranch.id));
  rejectUnless(assignments.every((assignment) => assignment.isPrimary && assignment.status === "ACTIVE" && members.some((member) => member.id === assignment.membershipId)));

  const run = await database.payrollRun.findFirst({
    where: { businessId: core.id },
    include: { entries: { orderBy: { employeeCodeSnapshot: "asc" } } },
  });
  rejectUnless(run && run.status === "DRAFT" && !run.submittedAt && !run.finalizedAt && run.periodStart.toISOString().slice(0, 10) === "2026-08-01" && run.entries.length === 6);
  rejectUnless(canonicalUnordered(run.entries.map((entry) => entry.employeeCodeSnapshot)) === canonicalUnordered(expectedCodes));
  const owner = await database.user.findUnique({ where: { email: "hr-core-acceptance.owner+stagingv1@tetamu.local" } });
  rejectUnless(owner && owner.businessId === core.id && owner.role === "BUSINESS_OWNER" && owner.status === "active" && owner.loginEnabled);
  rejectUnless(!(await database.user.findUnique({ where: { email: "uat.payroll-admin@tetamu.local" } })));
  const confirmations = await database.payrollManualPcbConfirmation.findMany({ orderBy: { externalReference: "asc" } });
  rejectUnless(confirmations.length === 6 && confirmations.every((source) => source.businessId === core.id && source.payrollRunId === run.id && source.amount.isZero() && source.sourceVersion === 1 && source.confirmedById === owner.id && source.externalReference === `RC_STAGING_CORE_EXPLICIT_ZERO_${run.entries.find((entry) => entry.id === source.payrollEntryId)?.employeeCodeSnapshot}_2026_08`));
  for (const entry of run.entries) rejectUnless(await resolveManualPcb(database, core.id, entry.id));
  const authorizations = await database.sensitiveActionAuthorization.findMany();
  rejectUnless(authorizations.length === 6 && authorizations.every((authorization) => authorization.actionKey === "PCB_MANUAL_CONFIRM" && authorization.businessId === core.id && authorization.userId === owner.id && authorization.consumedAt));

  const invoice = await database.invoice.findUnique({ where: { businessId_invoiceNumber: { businessId: bySlug.get(POS_CORE_UAT.salon.slug)!.id, invoiceNumber: "UAT-TRACE-0001" } }, include: { payments: true } });
  rejectUnless(invoice && invoice.status === "PAID" && invoice.total.equals(100) && invoice.paidAmount.equals(100) && invoice.balance.isZero() && invoice.payments.length === 2 && invoice.payments.some((payment) => payment.method === "CARD" && payment.amount.equals(40)) && invoice.payments.some((payment) => payment.method === "DUITNOW" && payment.amount.equals(60)));
  const workOrder = await database.workOrder.findUnique({ where: { businessId_orderNumber: { businessId: bySlug.get(POS_CORE_UAT.auto.slug)!.id, orderNumber: "UAT-WO-0001" } } });
  rejectUnless(workOrder && workOrder.status === "READY_FOR_PICKUP" && workOrder.paymentStatus === "UNPAID" && workOrder.total.equals(180) && workOrder.paidAmount.isZero());
  const appointments = await database.appointment.findMany({ select: { notes: true, status: true } });
  rejectUnless(canonicalUnordered(appointments) === canonicalUnordered([
    { notes: "UAT_APPOINTMENT_SCHEDULED", status: "SCHEDULED" },
    { notes: "UAT_APPOINTMENT_COMPLETED", status: "COMPLETED" },
    { notes: "UAT_APPOINTMENT_CANCELLED", status: "CANCELLED" },
    { notes: "UAT_APPOINTMENT_NO_SHOW", status: "NO_SHOW" },
  ]));
  const now = new Date();
  rejectUnless(await database.authSession.count({ where: { revokedAt: null, absoluteExpiresAt: { gt: now }, idleExpiresAt: { gt: now } } }) === 0);
  rejectUnless(await database.employeeSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }) === 0);
  const usableOtp = await database.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM employee_otp_challenges
    WHERE invalidated_at IS NULL AND verified_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP AND attempts < max_attempts
  `;
  rejectUnless(usableOtp[0].count === 0);
  rejectUnless(await database.payrollPayslipPublication.count() === 0);
  rejectUnless(await database.payrollPaymentInstruction.count() === 0);
  rejectUnless(await database.payrollStatutoryExportArtifact.count() === 0);
  rejectUnless(await database.auditLog.count({ where: { action: "RC_STAGING_SYNTHETIC_INSTALLED" } }) === 0);
}

export async function captureStagingFixtureCheckpoint(database: Database) {
  await verifyCheckpointSemantics(database);
  const snapshot = await checkpointSnapshot(database);
  rejectUnless(canonicalExact(snapshot.counts) === canonicalExact(EXPECTED_TABLE_COUNTS));
  return {
    checkpoint: CHECKPOINT,
    manifestDigest: hash(canonicalExact({ checkpoint: CHECKPOINT, counts: EXPECTED_TABLE_COUNTS })),
    dataDigest: snapshot.dataDigest,
  };
}

export async function reconcileStagingFixtureCheckpoint(
  database: Database,
  testEvidence?: { dataDigest: string; credentialDigest: string },
) {
  try {
    const evidence = await captureStagingFixtureCheckpoint(database);
    if (testEvidence) {
      const identity = await database.$queryRaw<Array<{ database: string; address: string | null }>>`
        SELECT current_database() AS database, inet_server_addr()::text AS address
      `;
      rejectUnless(process.env.RC_DISPOSABLE_TEST === "1" && identity.length === 1 &&
        identity[0].database === "rc_pcb_verification_vc1_disposable_synthetic" &&
        /^(?:127\.0\.0\.1|::1)(?:\/\d+)?$/.test(identity[0].address ?? ""));
    }
    const expectedDataDigest = testEvidence?.dataDigest ?? EXPECTED_CHECKPOINT_DATA_DIGEST;
    const expectedCredentialDigest = testEvidence?.credentialDigest ?? EXPECTED_CHECKPOINT_CREDENTIAL_DIGEST;
    rejectUnless(/^[a-f0-9]{64}$/.test(expectedDataDigest) && evidence.dataDigest === expectedDataDigest);
    rejectUnless(hash(canonicalExact(readStagingCredentialHandoff().data)) === expectedCredentialDigest);
    return evidence;
  } catch {
    throw new Error("RC_STAGING_FIXTURE_RECONCILIATION_REJECTED");
  }
}
