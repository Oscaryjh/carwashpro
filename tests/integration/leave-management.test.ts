import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";

test("Leave balance database guard rejects a policy from another business", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const [businessA, businessB] = await Promise.all([
        tx.business.create({ data: { name: `Leave A ${token}`, slug: `leave-a-${token}` } }),
        tx.business.create({ data: { name: `Leave B ${token}`, slug: `leave-b-${token}` } }),
      ]);
      const account = await tx.employeeAccount.create({
        data: { phoneNumber: `+6018${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, phoneNormalized: `+6018${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, name: "Leave Tenant Test", status: "ACTIVE" },
      });
      const membership = await tx.employeeBusinessMembership.create({
        data: {
          employeeAccountId: account.id,
          businessId: businessA.id,
          employeeCode: `LV-${token}`,
          fullName: "Leave Tenant Test",
          phoneNumber: account.phoneNormalized,
          phoneNumberNormalized: account.phoneNormalized,
          status: "ACTIVE",
        },
      });
      const foreignPolicy = await tx.leavePolicy.create({
        data: { businessId: businessB.id, code: "ANNUAL", name: "Foreign annual" },
      });

      await tx.employeeLeaveBalance.create({
        data: {
          businessId: businessA.id,
          membershipId: membership.id,
          policyId: foreignPolicy.id,
          year: 2026,
          entitlementOverrideDays: 12,
        },
      });
    }),
    /Leave policy tenant mismatch/,
  );
});

test("Leave request database guard rejects a branch from another business", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const [businessA, businessB] = await Promise.all([
        tx.business.create({ data: { name: `Leave C ${token}`, slug: `leave-c-${token}` } }),
        tx.business.create({ data: { name: `Leave D ${token}`, slug: `leave-d-${token}` } }),
      ]);
      const foreignBranch = await tx.branch.create({ data: { businessId: businessB.id, name: "Foreign branch" } });
      const account = await tx.employeeAccount.create({
        data: { phoneNumber: `+6017${token.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, phoneNormalized: `+6017${token.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, name: "Leave Request Test", status: "ACTIVE" },
      });
      const membership = await tx.employeeBusinessMembership.create({
        data: { employeeAccountId: account.id, businessId: businessA.id, employeeCode: `LR-${token}`, fullName: "Leave Request Test", phoneNumber: account.phoneNormalized, phoneNumberNormalized: account.phoneNormalized, status: "ACTIVE" },
      });
      const policy = await tx.leavePolicy.create({ data: { businessId: businessA.id, code: "ANNUAL", name: "Annual" } });
      await tx.leaveRequest.create({
        data: {
          businessId: businessA.id,
          membershipId: membership.id,
          branchId: foreignBranch.id,
          policyId: policy.id,
          policyNameSnapshot: policy.name,
          payTreatmentSnapshot: "PAID",
          startsOn: new Date("2026-08-03T00:00:00Z"),
          endsOn: new Date("2026-08-03T00:00:00Z"),
          requestedDays: 1,
          reason: "Tenant guard test",
        },
      });
    }),
    /Leave branch tenant mismatch/,
  );
});

function assertLocalDatabase() {
  assert.match(process.env.DATABASE_URL ?? "", /localhost|127\.0\.0\.1/i);
}
