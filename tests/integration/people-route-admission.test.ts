import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { resolveAttendanceScope } from "../../src/lib/attendance/scope";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";
import { buildPeopleStaffScopeWhere } from "../../src/lib/team/people-scope";

const database = new PrismaClient();

test("People read admission enforces role, business and assigned branch in persisted queries", async () => {
  const suffix = randomUUID().slice(0, 8);
  const a = await database.business.create({ data: { name: `People A ${suffix}`, slug: `people-a-${suffix}`, industryType: "SALON_BEAUTY" } });
  const b = await database.business.create({ data: { name: `People B ${suffix}`, slug: `people-b-${suffix}`, industryType: "SALON_BEAUTY" } });
  const a1 = await database.branch.create({ data: { businessId: a.id, name: "A1" } });
  const a2 = await database.branch.create({ data: { businessId: a.id, name: "A2" } });
  const b1 = await database.branch.create({ data: { businessId: b.id, name: "B1" } });
  const actor = await database.user.create({ data: { businessId: a.id, branchId: a1.id, name: "Reader", role: "STAFF", permissions: ["TEAM_READ"] } });
  const unprivileged = await database.user.create({ data: { businessId: a.id, branchId: a1.id, name: "No access", role: "STAFF", permissions: [] } });
  const peer1 = await database.user.create({ data: { businessId: a.id, branchId: a1.id, name: "Visible", role: "STAFF", permissions: [] } });
  const peer2 = await database.user.create({ data: { businessId: a.id, branchId: a2.id, name: "Other branch", role: "STAFF", permissions: [] } });
  const outsider = await database.user.create({ data: { businessId: b.id, branchId: b1.id, name: "Other tenant", role: "STAFF", permissions: [] } });
  try {
    const denied = await resolveBusinessAccess({ userId: unprivileged.id, requestedBusinessId: a.id, capability: "VIEW_TEAM_DIRECTORY" }, database);
    assert.equal(denied.granted, false);
    const read = await resolveBusinessAccess({ userId: actor.id, requestedBusinessId: a.id, capability: "VIEW_TEAM_DIRECTORY" }, database);
    assert.equal(read.granted, true);
    const payroll = await resolveBusinessAccess({ userId: actor.id, requestedBusinessId: a.id, capability: "VIEW_PAYROLL_RUN" }, database);
    assert.equal(payroll.granted, false);
    const bank = await resolveBusinessAccess({ userId: actor.id, requestedBusinessId: a.id, capability: "VIEW_BANK_ACCOUNT" }, database);
    assert.equal(bank.granted, false);
    const otherBusiness = await resolveBusinessAccess({ userId: actor.id, requestedBusinessId: b.id, capability: "VIEW_TEAM_DIRECTORY" }, database);
    assert.equal(otherBusiness.granted, false);
    const scope = await resolveAttendanceScope(read, database);
    assert.deepEqual(scope.allowedBranchIds, [a1.id]);
    const visible = await database.user.findMany({
      where: { ...buildPeopleStaffScopeWhere({ ...scope, now: new Date(), wholeBusinessScope: false }), id: { in: [peer1.id, peer2.id, outsider.id] } },
      select: { id: true },
    });
    assert.deepEqual(visible.map((user) => user.id), [peer1.id]);
  } finally {
    await database.user.deleteMany({ where: { id: { in: [actor.id, unprivileged.id, peer1.id, peer2.id, outsider.id] } } });
    await database.branch.deleteMany({ where: { id: { in: [a1.id, a2.id, b1.id] } } });
    await database.business.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await database.$disconnect();
  }
});
