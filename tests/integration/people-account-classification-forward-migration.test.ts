import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260915090000_people_workbench_account_classification";
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
const migrationPath = path.join(
  projectRoot,
  "prisma",
  "migrations",
  migrationName,
  "migration.sql",
);

test("migration 214 adds explicit account classification to a pre-RC database", async () => {
  const rootDatabaseUrl = process.env.DATABASE_URL ?? "";
  const rootUrl = new URL(rootDatabaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(rootUrl.hostname.toLowerCase()),
    "Forward migration tests require local PostgreSQL.",
  );

  const databaseName = `tetamu_people_forward_${process.pid}_${Date.now()}`;
  assert.match(databaseName, /^tetamu_people_forward_\d+_\d+$/);
  const administrationUrl = new URL(rootUrl);
  administrationUrl.pathname = "/postgres";
  administrationUrl.searchParams.set("schema", "public");
  const isolatedUrl = new URL(rootUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  isolatedUrl.searchParams.set("schema", "public");

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "tetamu-people-forward-"));
  const temporaryPrismaDirectory = path.join(temporaryRoot, "prisma");
  cpSync(path.join(projectRoot, "prisma"), temporaryPrismaDirectory, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(path.join(projectRoot, "prisma"), source);
      const [directory, name] = relative.split(path.sep);
      // Replay exactly the historical prefix, not later RC migrations.
      return directory !== "migrations" || !name || !/^\d{14}_/.test(name) || name < migrationName;
    },
  });
  const temporarySchemaPath = path.join(temporaryPrismaDirectory, "schema.prisma");
  const administration = new PrismaClient({
    datasources: { db: { url: administrationUrl.toString() } },
  });
  let database: PrismaClient | undefined;

  try {
    await administration.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    runPrisma(["migrate", "deploy", "--schema", temporarySchemaPath], isolatedUrl.toString());
    database = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const migrationCount = await database.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    assert.equal(migrationCount[0]?.count, 213n);

    const fixture = await seedRepresentativePreRcFixture(database);
    const beforeCounts = await readProtectedCounts(database);

    const beforeColumns = await classificationColumns(database);
    assert.deepEqual(beforeColumns, []);

    runPrisma(
      ["db", "execute", "--file", migrationPath, "--schema", temporarySchemaPath],
      isolatedUrl.toString(),
    );

    assert.deepEqual(await classificationColumns(database), ["account_type", "is_test_account"]);
    assert.deepEqual(await readProtectedCounts(database), beforeCounts);

    const classifications = await database.$queryRaw<Array<{
      account_type: "HUMAN" | "SERVICE";
      business_id: string | null;
      id: string;
    }>>`
      SELECT id::text, business_id::text, account_type::text AS account_type
      FROM users
      ORDER BY id
    `;
    assert.equal(classifications.length, 5);
    assert.ok(classifications.every((row) => row.account_type === "HUMAN"));
    assert.equal(
      classifications.find((row) => row.id === fixture.platformUserId)?.business_id,
      null,
    );

    const membershipClassifications = await database.$queryRaw<Array<{
      business_id: string;
      id: string;
      is_test_account: boolean;
    }>>`
      SELECT id::text, business_id::text, is_test_account
      FROM employee_business_memberships
      ORDER BY id
    `;
    assert.equal(membershipClassifications.length, 4);
    assert.ok(membershipClassifications.every((row) => row.is_test_account === false));
    assert.equal(
      new Set(
        membershipClassifications
          .filter((row) => row.id === fixture.multiBusinessMembershipAId || row.id === fixture.multiBusinessMembershipBId)
          .map((row) => row.business_id),
      ).size,
      2,
    );

    await database.user.update({
      where: { id: fixture.serviceUserId },
      data: { accountType: "SERVICE" },
      select: { id: true },
    });
    await database.employeeBusinessMembership.update({
      where: { id: fixture.testMembershipId },
      data: { isTestAccount: true },
      select: { id: true },
    });
    assert.equal(
      (await database.user.findUniqueOrThrow({
        where: { id: fixture.serviceUserId },
        select: { accountType: true },
      })).accountType,
      "SERVICE",
    );
    assert.equal(
      (await database.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: fixture.testMembershipId },
        select: { isTestAccount: true },
      })).isTestAccount,
      true,
    );

    const defaultUser = await database.user.create({
      data: {
        businessId: fixture.businessAId,
        name: "Post-migration default human",
        email: `post-default-${randomUUID()}@local.test`,
        role: "STAFF",
      },
      select: { accountType: true },
    });
    assert.equal(defaultUser.accountType, "HUMAN");

    await assert.rejects(
      database.$executeRawUnsafe(
        'UPDATE "users" SET "account_type" = NULL WHERE "id" = $1::uuid',
        fixture.humanUserId,
      ),
      /23502|null value|not-null constraint/i,
    );
    await assert.rejects(
      database.$executeRawUnsafe(
        'UPDATE "employee_business_memberships" SET "is_test_account" = NULL WHERE "id" = $1::uuid',
        fixture.humanMembershipId,
      ),
      /23502|null value|not-null constraint/i,
    );

    const indexes = await database.$queryRaw<Array<{ indexdef: string; tablename: string }>>`
      SELECT indexdef, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'employee_business_memberships')
    `;
    const normalizedIndexes = indexes.map((row) => ({
      ...row,
      indexdef: row.indexdef.replaceAll('"', ""),
    }));
    assert.ok(normalizedIndexes.some((row) =>
      row.tablename === "users" &&
      row.indexdef.includes("(business_id, account_type, status)"),
    ));
    assert.ok(normalizedIndexes.some((row) =>
      row.tablename === "employee_business_memberships" &&
      row.indexdef.includes("(business_id, is_test_account, status)"),
    ));

    const visiblePeople = await database.employeeBusinessMembership.findMany({
      where: {
        businessId: fixture.businessAId,
        isTestAccount: false,
        branchAssignments: { some: { branchId: fixture.branchAId, status: "ACTIVE" } },
      },
      orderBy: { employeeCode: "asc" },
      select: { employeeCode: true },
    });
    assert.deepEqual(visiblePeople.map((row) => row.employeeCode), ["EMP-001", "EMP-003"]);

    const lockedEvidence = await database.$queryRaw<Array<{
      payroll_status: string;
      timesheet_status: string;
    }>>`
      SELECT payroll.status::text AS payroll_status, timesheet.status::text AS timesheet_status
      FROM payroll_runs payroll
      JOIN attendance_timesheet_revisions revision
        ON revision.id = payroll.attendance_timesheet_revision_id
      JOIN attendance_monthly_timesheets timesheet
        ON timesheet.current_revision_id = revision.id
      WHERE payroll.id = ${fixture.payrollRunId}::uuid
    `;
    assert.deepEqual(lockedEvidence, [{ payroll_status: "FINALIZED", timesheet_status: "LOCKED" }]);

    const legalDuplicates = await database.$queryRaw<Array<{ case_emails: bigint; shared_phone_boundaries: bigint }>>`
      SELECT
        (SELECT COUNT(*)::bigint FROM users WHERE lower(email) = 'case-boundary@local.test') AS case_emails,
        (SELECT COUNT(*)::bigint
           FROM users user_row
           JOIN employee_accounts account_row ON account_row.phone_normalized = user_row.whatsapp_phone
          WHERE user_row.id = ${fixture.humanUserId}::uuid) AS shared_phone_boundaries
    `;
    assert.deepEqual(legalDuplicates, [{ case_emails: 2n, shared_phone_boundaries: 1n }]);
  } finally {
    await database?.$disconnect();
    await administration.$executeRawUnsafe(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      databaseName,
    );
    await administration.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    const leftovers = await administration.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_database
      WHERE datname LIKE 'tetamu_people_forward_%'
    `;
    assert.equal(leftovers[0]?.count, 0n);
    await administration.$disconnect();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function runPrisma(arguments_: string[], databaseUrl: string) {
  const result = spawnSync(process.execPath, [prismaCli, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
}

async function classificationColumns(database: PrismaClient) {
  const columns = await database.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'users' AND column_name = 'account_type')
        OR (table_name = 'employee_business_memberships' AND column_name = 'is_test_account')
      )
    ORDER BY column_name
  `;
  return columns.map((column) => column.column_name);
}

async function readProtectedCounts(database: PrismaClient) {
  const rows = await database.$queryRaw<Array<{
    businesses: bigint;
    branches: bigint;
    memberships: bigint;
    payroll_runs: bigint;
    timesheets: bigint;
    users: bigint;
  }>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM businesses) AS businesses,
      (SELECT COUNT(*)::bigint FROM branches) AS branches,
      (SELECT COUNT(*)::bigint FROM employee_business_memberships) AS memberships,
      (SELECT COUNT(*)::bigint FROM payroll_runs) AS payroll_runs,
      (SELECT COUNT(*)::bigint FROM attendance_monthly_timesheets) AS timesheets,
      (SELECT COUNT(*)::bigint FROM users) AS users
  `;
  return rows[0];
}

async function seedRepresentativePreRcFixture(database: PrismaClient) {
  const fixture = {
    businessAId: randomUUID(),
    businessBId: randomUUID(),
    branchAId: randomUUID(),
    branchASecondaryId: randomUUID(),
    branchBId: randomUUID(),
    humanAccountId: randomUUID(),
    testAccountId: randomUUID(),
    multiBusinessAccountId: randomUUID(),
    humanMembershipId: randomUUID(),
    testMembershipId: randomUUID(),
    multiBusinessMembershipAId: randomUUID(),
    multiBusinessMembershipBId: randomUUID(),
    humanUserId: randomUUID(),
    serviceUserId: randomUUID(),
    platformUserId: randomUUID(),
    caseUserOneId: randomUUID(),
    caseUserTwoId: randomUUID(),
    timesheetId: randomUUID(),
    timesheetRevisionId: randomUUID(),
    payrollRunId: randomUUID(),
  };

  await database.business.createMany({
    data: [
      { id: fixture.businessAId, name: "Forward fixture A", slug: `forward-a-${fixture.businessAId}` },
      { id: fixture.businessBId, name: "Forward fixture B", slug: `forward-b-${fixture.businessBId}` },
    ],
  });
  await database.branch.createMany({
    data: [
      { id: fixture.branchAId, businessId: fixture.businessAId, name: "A Main" },
      { id: fixture.branchASecondaryId, businessId: fixture.businessAId, name: "A Secondary" },
      { id: fixture.branchBId, businessId: fixture.businessBId, name: "B Main" },
    ],
  });
  await database.employeeAccount.createMany({
    data: [
      { id: fixture.humanAccountId, name: "Human employee", phoneNumber: "+601100000001", phoneNormalized: "+601100000001" },
      { id: fixture.testAccountId, name: "Synthetic employee", phoneNumber: "+601100000002", phoneNormalized: "+601100000002" },
      { id: fixture.multiBusinessAccountId, name: "Multi-business employee", phoneNumber: "+601100000003", phoneNormalized: "+601100000003" },
    ],
  });
  const memberships = [
    { id: fixture.humanMembershipId, accountId: fixture.humanAccountId, businessId: fixture.businessAId, employeeCode: "EMP-001", name: "Human employee", phone: "+601100000001" },
    { id: fixture.testMembershipId, accountId: fixture.testAccountId, businessId: fixture.businessAId, employeeCode: "EMP-002", name: "Synthetic employee", phone: "+601100000002" },
    { id: fixture.multiBusinessMembershipAId, accountId: fixture.multiBusinessAccountId, businessId: fixture.businessAId, employeeCode: "EMP-003", name: "Multi-business employee A", phone: "+601100000003" },
    { id: fixture.multiBusinessMembershipBId, accountId: fixture.multiBusinessAccountId, businessId: fixture.businessBId, employeeCode: "EMP-101", name: "Multi-business employee B", phone: "+601100000003" },
  ];
  for (const membership of memberships) {
    await database.$executeRawUnsafe(
      `INSERT INTO "employee_business_memberships" (
        "id", "employee_account_id", "business_id", "employee_code", "full_name",
        "phone_number", "phone_number_normalized", "joined_at", "updated_at"
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::timestamp, CURRENT_TIMESTAMP)`,
      membership.id,
      membership.accountId,
      membership.businessId,
      membership.employeeCode,
      membership.name,
      membership.phone,
      membership.phone,
      "2025-01-01T00:00:00.000Z",
    );
  }
  await database.employeeBranchAssignment.createMany({
    data: [
      { membershipId: fixture.humanMembershipId, businessId: fixture.businessAId, branchId: fixture.branchAId, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") },
      { membershipId: fixture.humanMembershipId, businessId: fixture.businessAId, branchId: fixture.branchASecondaryId, isPrimary: false, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") },
      { membershipId: fixture.testMembershipId, businessId: fixture.businessAId, branchId: fixture.branchAId, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") },
      { membershipId: fixture.multiBusinessMembershipAId, businessId: fixture.businessAId, branchId: fixture.branchAId, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") },
      { membershipId: fixture.multiBusinessMembershipBId, businessId: fixture.businessBId, branchId: fixture.branchBId, isPrimary: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z") },
    ],
  });
  const users = [
    { id: fixture.humanUserId, businessId: fixture.businessAId, branchId: fixture.branchAId, accountId: fixture.humanAccountId, membershipId: fixture.humanMembershipId, name: "Human staff", email: "human-forward@local.test", whatsappPhone: "+601100000001", role: "STAFF" },
    { id: fixture.serviceUserId, businessId: fixture.businessAId, branchId: null, accountId: null, membershipId: null, name: "Service candidate", email: "service-forward@local.test", whatsappPhone: null, role: "STAFF" },
    { id: fixture.platformUserId, businessId: null, branchId: null, accountId: null, membershipId: null, name: "Platform human", email: "platform-forward@local.test", whatsappPhone: null, role: "PLATFORM_ADMIN" },
    { id: fixture.caseUserOneId, businessId: fixture.businessAId, branchId: null, accountId: null, membershipId: null, name: "Case one", email: "Case-Boundary@local.test", whatsappPhone: null, role: "STAFF" },
    { id: fixture.caseUserTwoId, businessId: fixture.businessBId, branchId: null, accountId: null, membershipId: null, name: "Case two", email: "case-boundary@local.test", whatsappPhone: null, role: "STAFF" },
  ];
  for (const user of users) {
    await database.$executeRawUnsafe(
      `INSERT INTO "users" (
        "id", "business_id", "branch_id", "name", "email", "whatsapp_phone",
        "password_hash", "role", "employee_account_id", "employee_business_membership_id",
        "team_member_link_status", "team_member_link_reason", "team_member_linked_at", "updated_at"
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
        $8::"UserRole", $9::uuid, $10::uuid, $11::"TeamMemberLinkStatus", $12,
        CASE WHEN $10::uuid IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
        CURRENT_TIMESTAMP
      )`,
      user.id,
      user.businessId,
      user.branchId,
      user.name,
      user.email,
      user.whatsappPhone,
      "local-forward-fixture-not-a-credential",
      user.role,
      user.accountId,
      user.membershipId,
      user.membershipId ? "LINKED" : "UNLINKED",
      user.membershipId ? "EXPLICIT_ACCOUNT_BUSINESS" : null,
    );
  }

  const timesheet = await database.attendanceMonthlyTimesheet.create({
    data: {
      id: fixture.timesheetId,
      businessId: fixture.businessAId,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
  const revision = await database.attendanceTimesheetRevision.create({
    data: {
      id: fixture.timesheetRevisionId,
      timesheetId: timesheet.id,
      businessId: fixture.businessAId,
      revision: 1,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      sourceDigest: "a".repeat(64),
      reason: "Representative forward migration fixture",
      lockedById: fixture.humanUserId,
    },
    select: { id: true, lockedAt: true },
  });
  await database.attendanceMonthlyTimesheet.update({
    where: { id: fixture.timesheetId },
    data: { status: "LOCKED", currentRevisionId: fixture.timesheetRevisionId },
    select: { id: true },
  });
  await database.payrollRun.create({
    data: {
      id: fixture.payrollRunId,
      businessId: fixture.businessAId,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      status: "FINALIZED",
      attendanceSource: "LOCKED_TIMESHEET_REVISION",
      attendanceTimesheetRevisionId: fixture.timesheetRevisionId,
      attendanceTimesheetRevisionSnapshot: 1,
      attendanceTimesheetDigestSnapshot: "a".repeat(64),
      attendanceTimesheetLockedAtSnapshot: revision.lockedAt,
      workingDaysPerMonthSnapshot: 26,
      normalWorkMinutesPerDaySnapshot: 480,
      breakMinutesPerDaySnapshot: 60,
      overtimeMultiplierSnapshot: 1.5,
      restDayWorkMultiplierSnapshot: 1,
      restDayOvertimeMultiplierSnapshot: 2,
      publicHolidayExtraMultiplierSnapshot: 2,
      publicHolidayOvertimeMultiplierSnapshot: 3,
      submittedById: fixture.humanUserId,
      submittedAt: new Date("2026-09-01T00:00:00.000Z"),
      finalizedById: fixture.humanUserId,
      finalizedAt: new Date("2026-09-01T00:05:00.000Z"),
    },
    select: { id: true },
  });

  return fixture;
}
