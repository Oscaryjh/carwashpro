import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { PrismaClient } from "@prisma/client";

const migrationName =
  "20260730210000_team_people_unification";
const rootDatabaseUrl = process.env.DATABASE_URL ?? "";
const schemaName =
  `team_people_${randomUUID().replaceAll("-", "")}`;
const projectRoot = fileURLToPath(
  new URL("../..", import.meta.url),
);
const prismaCli = path.join(
  projectRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const migrationPath = path.join(
  projectRoot,
  "prisma",
  "migrations",
  migrationName,
  "migration.sql",
);

const fixture = {
  businessAId: randomUUID(),
  businessBId: randomUUID(),
  explicitAccountId: randomUUID(),
  explicitMembershipId: randomUUID(),
  phoneAccountId: randomUUID(),
  phoneMembershipId: randomUUID(),
  duplicateAccountId: randomUUID(),
  duplicateMembershipId: randomUUID(),
  crossAccountId: randomUUID(),
  crossMembershipId: randomUUID(),
  explicitUserId: randomUUID(),
  phoneUserId: randomUUID(),
  missingPhoneUserId: randomUUID(),
  noMatchUserId: randomUUID(),
  duplicateUserOneId: randomUUID(),
  duplicateUserTwoId: randomUUID(),
  crossBusinessPhoneUserId: randomUUID(),
  linkedMembershipCompetitorUserId: randomUUID(),
  ownerUserId: randomUUID(),
};

let isolatedDatabaseUrl = "";
let temporaryRoot = "";
let temporarySchemaPath = "";
let database: PrismaClient;
let administrationDatabase: PrismaClient;

before(async () => {
  const rootUrl = new URL(rootDatabaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      rootUrl.hostname.toLowerCase(),
    ),
    "Team People migration tests require local PostgreSQL.",
  );

  const isolatedUrl = new URL(rootDatabaseUrl);
  isolatedUrl.searchParams.set("schema", schemaName);
  isolatedDatabaseUrl = isolatedUrl.toString();

  temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "tetamu-team-people-"),
  );
  const temporaryPrismaDirectory = path.join(
    temporaryRoot,
    "prisma",
  );
  cpSync(
    path.join(projectRoot, "prisma"),
    temporaryPrismaDirectory,
    {
      recursive: true,
      filter: (source) => !source.includes(migrationName),
    },
  );
  temporarySchemaPath = path.join(
    temporaryPrismaDirectory,
    "schema.prisma",
  );

  runPrisma(
    ["migrate", "deploy", "--schema", temporarySchemaPath],
    isolatedDatabaseUrl,
    "prepare the pre-Phase-1C.5 schema",
  );

  database = new PrismaClient({
    datasources: { db: { url: isolatedDatabaseUrl } },
  });
  administrationDatabase = new PrismaClient({
    datasources: { db: { url: rootDatabaseUrl } },
  });

  await seedLegacyPeople(database);

  runPrisma(
    [
      "db",
      "execute",
      "--file",
      migrationPath,
      "--schema",
      temporarySchemaPath,
    ],
    isolatedDatabaseUrl,
    "apply the Team People migration",
  );
});

after(async () => {
  await database?.$disconnect();
  if (administrationDatabase) {
    await administrationDatabase.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
    await administrationDatabase.$disconnect();
  }
  if (temporaryRoot) {
    rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("legacy Staff backfill links only unambiguous same-Business identities", async () => {
  const rows = await database.$queryRawUnsafe<
    Array<{
      id: string;
      employeeAccountId: string | null;
      membershipId: string | null;
      linkStatus:
        | "LINKED"
        | "UNLINKED"
        | "REVIEW_REQUIRED";
      linkReason: string | null;
      linkedAt: Date | null;
    }>
  >(
    `SELECT
        "id"::text,
        "employee_account_id"::text AS "employeeAccountId",
        "employee_business_membership_id"::text AS "membershipId",
        "team_member_link_status"::text AS "linkStatus",
        "team_member_link_reason" AS "linkReason",
        "team_member_linked_at" AS "linkedAt"
       FROM "users"
      ORDER BY "id"`,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.deepEqual(
    linkSummary(byId.get(fixture.explicitUserId)),
    {
      employeeAccountId: fixture.explicitAccountId,
      membershipId: fixture.explicitMembershipId,
      linkStatus: "LINKED",
      linkReason: "EXPLICIT_ACCOUNT_BUSINESS",
      linked: true,
    },
  );
  assert.deepEqual(
    linkSummary(byId.get(fixture.phoneUserId)),
    {
      employeeAccountId: fixture.phoneAccountId,
      membershipId: fixture.phoneMembershipId,
      linkStatus: "LINKED",
      linkReason: "EXACT_BUSINESS_PHONE",
      linked: true,
    },
  );

  for (const id of [
    fixture.duplicateUserOneId,
    fixture.duplicateUserTwoId,
  ]) {
    assert.deepEqual(linkSummary(byId.get(id)), {
      employeeAccountId: fixture.duplicateAccountId,
      membershipId: null,
      linkStatus: "REVIEW_REQUIRED",
      linkReason: "DUPLICATE_EXPLICIT_ACCOUNT_CLAIM",
      linked: false,
    });
  }

  assert.deepEqual(
    linkSummary(
      byId.get(fixture.crossBusinessPhoneUserId),
    ),
    {
      employeeAccountId: null,
      membershipId: null,
      linkStatus: "REVIEW_REQUIRED",
      linkReason: "CROSS_BUSINESS_PHONE_MATCH",
      linked: false,
    },
  );
  assert.deepEqual(
    linkSummary(
      byId.get(
        fixture.linkedMembershipCompetitorUserId,
      ),
    ),
    {
      employeeAccountId: null,
      membershipId: null,
      linkStatus: "REVIEW_REQUIRED",
      linkReason: "MEMBERSHIP_ALREADY_LINKED",
      linked: false,
    },
  );
  assert.deepEqual(
    linkSummary(byId.get(fixture.missingPhoneUserId)),
    {
      employeeAccountId: null,
      membershipId: null,
      linkStatus: "UNLINKED",
      linkReason: "MISSING_PHONE",
      linked: false,
    },
  );
  assert.deepEqual(
    linkSummary(byId.get(fixture.noMatchUserId)),
    {
      employeeAccountId: null,
      membershipId: null,
      linkStatus: "UNLINKED",
      linkReason: "NO_MATCH",
      linked: false,
    },
  );

  // Non-Staff identities are deliberately outside the automatic migration.
  assert.deepEqual(
    linkSummary(byId.get(fixture.ownerUserId)),
    {
      employeeAccountId: fixture.explicitAccountId,
      membershipId: null,
      linkStatus: "UNLINKED",
      linkReason: null,
      linked: false,
    },
  );
});

test("deferred guards enforce one-to-one tenant/account scope in both directions", async () => {
  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "users"
            SET "business_id" = $1::uuid
          WHERE "id" = $2::uuid`,
        fixture.businessBId,
        fixture.explicitUserId,
      );
    }),
    /scope mismatch/i,
  );

  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "users"
            SET "employee_account_id" = $1::uuid,
                "employee_business_membership_id" = $2::uuid,
                "team_member_link_status" = 'LINKED',
                "team_member_link_reason" = 'MANUAL',
                "team_member_linked_at" =
                    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $3::uuid`,
        fixture.crossAccountId,
        fixture.crossMembershipId,
        fixture.crossBusinessPhoneUserId,
      );
    }),
    /scope mismatch/i,
  );

  const extraUserId = randomUUID();
  await database.$executeRawUnsafe(
    `INSERT INTO "users" (
        "id",
        "business_id",
        "name",
        "employee_account_id",
        "role",
        "status",
        "created_at",
        "updated_at"
     )
     VALUES (
        $1::uuid,
        $2::uuid,
        'Second linked User',
        $3::uuid,
        'STAFF',
        'active',
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    extraUserId,
    fixture.businessAId,
    fixture.phoneAccountId,
  );
  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "users"
            SET "employee_business_membership_id" = $1::uuid,
                "team_member_link_status" = 'LINKED',
                "team_member_link_reason" = 'MANUAL',
                "team_member_linked_at" =
                    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $2::uuid`,
        fixture.phoneMembershipId,
        extraUserId,
      );
    }),
    /users_employee_business_membership_id_key|23505/i,
  );

  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "users"
            SET "team_member_link_status" = 'UNLINKED'
          WHERE "id" = $1::uuid`,
        fixture.phoneUserId,
      );
    }),
    /users_team_member_link_state_check|check constraint/i,
  );

  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `DELETE FROM "employee_business_memberships"
          WHERE "id" = $1::uuid`,
        fixture.phoneMembershipId,
      );
    }),
    /users_employee_business_membership_id_fkey|foreign key/i,
  );

  const replacementAccountId = randomUUID();
  const replacementPhone = "+60155555555";
  await insertEmployeeAccount(
    database,
    replacementAccountId,
    replacementPhone,
    "Replacement identity",
  );

  // The guards are deferred: either update order is legal when the final
  // User and Membership account/tenant scope agrees at commit.
  await database.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `UPDATE "users"
          SET "employee_account_id" = $1::uuid
        WHERE "id" = $2::uuid`,
      replacementAccountId,
      fixture.explicitUserId,
    );
    await transaction.$executeRawUnsafe(
      `UPDATE "employee_business_memberships"
          SET "employee_account_id" = $1::uuid,
              "phone_number" = $2,
              "phone_number_normalized" = $2
        WHERE "id" = $3::uuid`,
      replacementAccountId,
      replacementPhone,
      fixture.explicitMembershipId,
    );
  });

  const finalScope = await database.$queryRawUnsafe<
    Array<{
      userAccountId: string;
      membershipAccountId: string;
    }>
  >(
    `SELECT
        staff."employee_account_id"::text AS "userAccountId",
        membership."employee_account_id"::text AS
            "membershipAccountId"
       FROM "users" staff
       JOIN "employee_business_memberships" membership
         ON membership."id" =
            staff."employee_business_membership_id"
      WHERE staff."id" = $1::uuid`,
    fixture.explicitUserId,
  );
  assert.deepEqual(finalScope, [
    {
      userAccountId: replacementAccountId,
      membershipAccountId: replacementAccountId,
    },
  ]);

  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "employee_business_memberships"
            SET "employee_account_id" = $1::uuid
          WHERE "id" = $2::uuid`,
        fixture.explicitAccountId,
        fixture.explicitMembershipId,
      );
    }),
    /scope mismatch/i,
  );
});

function runPrisma(
  args: string[],
  databaseUrl: string,
  operation: string,
) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to ${operation}.\n${result.stdout}\n${result.stderr}`,
    );
  }
}

async function seedLegacyPeople(
  target: PrismaClient,
) {
  const nowSql =
    "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
  await target.$executeRawUnsafe(
    `INSERT INTO "businesses" (
        "id", "name", "slug", "created_at", "updated_at"
     )
     VALUES
        ($1::uuid, 'People A', $2, ${nowSql}, ${nowSql}),
        ($3::uuid, 'People B', $4, ${nowSql}, ${nowSql})`,
    fixture.businessAId,
    `people-a-${fixture.businessAId}`,
    fixture.businessBId,
    `people-b-${fixture.businessBId}`,
  );

  await Promise.all([
    insertEmployeeAccount(
      target,
      fixture.explicitAccountId,
      "+60111111111",
      "Explicit employee",
    ),
    insertEmployeeAccount(
      target,
      fixture.phoneAccountId,
      "+60122222222",
      "Phone employee",
    ),
    insertEmployeeAccount(
      target,
      fixture.duplicateAccountId,
      "+60133333333",
      "Duplicate employee",
    ),
    insertEmployeeAccount(
      target,
      fixture.crossAccountId,
      "+60144444444",
      "Other business employee",
    ),
  ]);

  await Promise.all([
    insertMembership(target, {
      id: fixture.explicitMembershipId,
      accountId: fixture.explicitAccountId,
      businessId: fixture.businessAId,
      code: "EXP-001",
      phone: "+60111111111",
    }),
    insertMembership(target, {
      id: fixture.phoneMembershipId,
      accountId: fixture.phoneAccountId,
      businessId: fixture.businessAId,
      code: "PHN-001",
      phone: "+60122222222",
    }),
    insertMembership(target, {
      id: fixture.duplicateMembershipId,
      accountId: fixture.duplicateAccountId,
      businessId: fixture.businessAId,
      code: "DUP-001",
      phone: "+60133333333",
    }),
    insertMembership(target, {
      id: fixture.crossMembershipId,
      accountId: fixture.crossAccountId,
      businessId: fixture.businessBId,
      code: "CROSS-001",
      phone: "+60144444444",
    }),
  ]);

  await target.$executeRawUnsafe(
    `INSERT INTO "users" (
        "id",
        "business_id",
        "name",
        "whatsapp_phone",
        "employee_account_id",
        "role",
        "status",
        "created_at",
        "updated_at"
     )
     VALUES
        ($1::uuid, $2::uuid, 'Explicit Staff', NULL,
            $3::uuid, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($4::uuid, $2::uuid, 'Phone Staff', '012-222 2222',
            NULL, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($5::uuid, $2::uuid, 'Missing Phone Staff', NULL,
            NULL, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($6::uuid, $2::uuid, 'No Match Staff', '+60199999999',
            NULL, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($7::uuid, $2::uuid, 'Duplicate One', NULL,
            $8::uuid, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($9::uuid, $2::uuid, 'Duplicate Two', NULL,
            $8::uuid, 'STAFF', 'active', ${nowSql}, ${nowSql}),
        ($10::uuid, $2::uuid, 'Cross Business Phone',
            '+60144444444', NULL, 'STAFF', 'active',
            ${nowSql}, ${nowSql}),
        ($11::uuid, $2::uuid, 'Already Linked Competitor',
            '+60111111111', NULL, 'STAFF', 'active',
            ${nowSql}, ${nowSql}),
        ($12::uuid, $2::uuid, 'Business Owner', NULL,
            $3::uuid, 'BUSINESS_OWNER', 'active',
            ${nowSql}, ${nowSql})`,
    fixture.explicitUserId,
    fixture.businessAId,
    fixture.explicitAccountId,
    fixture.phoneUserId,
    fixture.missingPhoneUserId,
    fixture.noMatchUserId,
    fixture.duplicateUserOneId,
    fixture.duplicateAccountId,
    fixture.duplicateUserTwoId,
    fixture.crossBusinessPhoneUserId,
    fixture.linkedMembershipCompetitorUserId,
    fixture.ownerUserId,
  );
}

async function insertEmployeeAccount(
  target: PrismaClient,
  id: string,
  phone: string,
  name: string,
) {
  await target.$executeRawUnsafe(
    `INSERT INTO "employee_accounts" (
        "id",
        "phone_number",
        "phone_normalized",
        "name",
        "status",
        "created_at",
        "updated_at"
     )
     VALUES (
        $1::uuid,
        $2,
        $2,
        $3,
        'ACTIVE',
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    id,
    phone,
    name,
  );
}

async function insertMembership(
  target: PrismaClient,
  input: {
    id: string;
    accountId: string;
    businessId: string;
    code: string;
    phone: string;
  },
) {
  await target.$executeRawUnsafe(
    `INSERT INTO "employee_business_memberships" (
        "id",
        "employee_account_id",
        "business_id",
        "employee_code",
        "full_name",
        "phone_number",
        "phone_number_normalized",
        "employment_type",
        "status",
        "attendance_enabled",
        "joined_at",
        "created_at",
        "updated_at"
     )
     VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $4,
        $5,
        $5,
        'FULL_TIME',
        'ACTIVE',
        false,
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.accountId,
    input.businessId,
    input.code,
    input.phone,
  );
}

function linkSummary(
  row:
    | {
        employeeAccountId: string | null;
        membershipId: string | null;
        linkStatus:
          | "LINKED"
          | "UNLINKED"
          | "REVIEW_REQUIRED";
        linkReason: string | null;
        linkedAt: Date | null;
      }
    | undefined,
) {
  assert.ok(row);
  return {
    employeeAccountId: row.employeeAccountId,
    membershipId: row.membershipId,
    linkStatus: row.linkStatus,
    linkReason: row.linkReason,
    linked: row.linkedAt instanceof Date,
  };
}
