import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  publishRoster,
  upsertRosterAssignment,
} from "../../src/lib/roster/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("a started employee does not make another employee's same-day future shift retrospective", async () => {
  assertLocalDatabase();
  const rollback = Symbol("rollback");

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const nonce = Date.now();
      const business = await transaction.business.create({
        data: {
          name: `Same-day roster ${nonce}`,
          slug: `same-day-roster-${nonce}`,
          timezone: "Asia/Kuala_Lumpur",
        },
      });
      const branch = await transaction.branch.create({
        data: { businessId: business.id, name: "MYT Branch" },
      });
      const actor = await transaction.user.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          name: "Roster Owner",
          email: `same-day-roster-${nonce}@example.test`,
          role: "BUSINESS_OWNER",
        },
      });
      const membershipIds: string[] = [];
      for (const [index, name] of ["Started Employee", "Future Employee"].entries()) {
        const phone = `+601${String(nonce + index).slice(-8)}`;
        const account = await transaction.employeeAccount.create({
          data: { name, phoneNumber: phone, phoneNormalized: phone },
        });
        const membership = await transaction.employeeBusinessMembership.create({
          data: {
            employeeAccountId: account.id,
            businessId: business.id,
            employeeCode: `SAME-${index + 1}`,
            fullName: name,
            phoneNumber: phone,
            phoneNumberNormalized: phone,
            status: "ACTIVE",
            attendanceEnabled: true,
            joinedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        });
        await transaction.employeeBranchAssignment.create({
          data: {
            membershipId: membership.id,
            businessId: business.id,
            branchId: branch.id,
            isPrimary: true,
            status: "ACTIVE",
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        });
        membershipIds.push(membership.id);
      }

      const database = transactionDatabase(transaction);
      const context = {
        businessId: business.id,
        allowedBranchIds: [branch.id],
        actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" },
        canAmendPublished: true,
        canManageRetrospective: true,
      };
      const weekStart = new Date("2026-08-24T00:00:00.000Z");
      const workDate = new Date("2026-08-27T00:00:00.000Z");

      const started = await upsertRosterAssignment({
        context,
        database,
        input: {
          branchId: branch.id,
          weekStart,
          expectedDraftRevision: 0,
          membershipId: membershipIds[0]!,
          workDate,
          kind: "WORK_SHIFT",
          startAt: new Date("2026-08-27T01:00:00.000Z"),
          endAt: new Date("2026-08-27T10:00:00.000Z"),
          breakMinutes: 60,
        },
      });
      const future = await upsertRosterAssignment({
        context,
        database,
        input: {
          branchId: branch.id,
          weekStart,
          expectedDraftRevision: started.draftRevision,
          membershipId: membershipIds[1]!,
          workDate,
          kind: "WORK_SHIFT",
          startAt: new Date("2026-08-27T08:30:00.000Z"),
          endAt: new Date("2026-08-27T09:00:00.000Z"),
          breakMinutes: 0,
        },
      });

      const published = await publishRoster({
        context,
        database,
        now: new Date("2026-08-27T08:04:00.000Z"),
        input: {
          rosterPeriodId: future.periodId,
          expectedDraftRevision: future.draftRevision,
          operationKey: `same-day-future-${nonce}`,
          reason: "Same-day future classification regression",
        },
      });

      const startedSnapshot = published.publication.assignments.find(
        (item) => item.membershipId === membershipIds[0]!,
      );
      const futureSnapshot = published.publication.assignments.find(
        (item) => item.membershipId === membershipIds[1]!,
      );
      assert.equal(startedSnapshot?.evidenceDisposition, "RETROSPECTIVE_REVIEW_REQUIRED");
      assert.equal(futureSnapshot?.evidenceDisposition, "APPLIED");
      assert.ok(futureSnapshot?.evidenceReference);

      assert.equal(
        await transaction.attendanceExpectedDay.count({
          where: { businessId: business.id, membershipId: membershipIds[0]!, workDate },
        }),
        0,
        "An already-started shift must not manufacture Attendance evidence",
      );
      const expectedDay = await transaction.attendanceExpectedDay.findFirstOrThrow({
        where: {
          businessId: business.id,
          membershipId: membershipIds[1]!,
          workDate,
          status: "CURRENT",
        },
      });
      assert.equal(expectedDay.kind, "WORKDAY");
      assert.equal(expectedDay.source, "ROSTER");
      assert.equal(expectedDay.expectedStartAt?.toISOString(), "2026-08-27T08:30:00.000Z");
      assert.equal(expectedDay.timezoneSnapshot, "Asia/Kuala_Lumpur");

      throw rollback;
    }, { isolationLevel: "Serializable", timeout: 30_000 }),
    (error: unknown) => error === rollback,
  );
});

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return new Proxy(transaction as unknown as PrismaClient, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Roster integration tests.");
  const hostname = new URL(databaseUrl).hostname;
  if (!new Set(["localhost", "127.0.0.1"]).has(hostname)) {
    throw new Error("Roster integration tests are restricted to Local database hosts.");
  }
}
