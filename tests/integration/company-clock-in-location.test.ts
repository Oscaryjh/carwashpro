import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { upsertBranchAttendanceSetting } from "../../src/lib/attendance/branch-setting-service";
import { loadEmployeeAttendancePrincipal } from "../../src/lib/attendance/employee-principal";

test("location relocation persists in the canonical table, preserves policy/address, audits and feeds Staff principal", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /disposable/);
  const db = new PrismaClient();
  const token = randomUUID();
  const business = await db.business.create({ data: { name: `LOCATION_UAT_${token}`, slug: `location-${token}`, address: "Synthetic address" } });
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Synthetic outlet" } });
  const actor = await db.user.create({ data: { businessId: business.id, role: "BUSINESS_OWNER", name: "Synthetic owner", email: `location-${token}@test.invalid` } });
  const context = { businessId: business.id, allowedBranchIds: [branch.id], actor: { userId: actor.id, name: actor.name, email: actor.email! } };
  let accountId: string | undefined;
  try {
    const input = { branchId: branch.id, latitude: 5.123456, longitude: 116.123456, geofenceRadiusMeters: 150, minimumAccuracyMeters: 60, timezone: "Asia/Kuching" };
    const created = await upsertBranchAttendanceSetting({ ...context, mode: "location", input: { ...input, isEnabled: true } }, db);
    assert.equal(created.isEnabled, false);
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: business.id } })).address, "Synthetic address");
    await db.business.update({ where: { id: business.id }, data: { address: "Changed text only" } });
    assert.equal((await db.branchAttendanceSetting.findUniqueOrThrow({ where: { branchId: branch.id } })).latitude.toString(), "5.123456");
    await db.branchAttendanceSetting.update({ where: { branchId: branch.id }, data: { requirePhoto: true } });
    const policy = { branchId: branch.id, isEnabled: true, requireGeofence: true, allowOutsideGeofenceRequest: false, breakPolicy: "PAID_BREAK", targetBreakMinutes: 30, normalWorkMinutesPerDay: 420, shiftSpanMinutes: 450 };
    await Promise.all([
      upsertBranchAttendanceSetting({ ...context, mode: "location", input: { ...input, latitude: 5.234567 } }, db),
      upsertBranchAttendanceSetting({ ...context, mode: "policy", input: { ...policy, latitude: 0, longitude: 0 } }, db),
    ]);
    const saved = await db.branchAttendanceSetting.findUniqueOrThrow({ where: { branchId: branch.id } });
    assert.equal(saved.latitude.toString(), "5.234567");
    assert.equal(saved.isEnabled, true);
    assert.equal(saved.breakPolicy, "PAID_BREAK");
    assert.equal(saved.requirePhoto, true);
    assert.equal(saved.geofenceRadiusMeters, 150);
    assert.equal(saved.minimumAccuracyMeters, 60);
    assert.equal(saved.timezone, "Asia/Kuching");
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: business.id } })).address, "Changed text only");
    assert.equal(await db.auditLog.count({ where: { businessId: business.id, entityType: "BranchAttendanceSetting" } }), 3);
    await assert.rejects(upsertBranchAttendanceSetting({ ...context, allowedBranchIds: [], mode: "location", input }, db), /scope/i);
    await assert.rejects(upsertBranchAttendanceSetting({ ...context, businessId: randomUUID(), mode: "location", input }, db), /not found/i);

    await db.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "HR", status: "ENABLED", source: "SYSTEM", enabledFrom: new Date("2020-01-01") } });
    const phone = `+601${Date.now().toString().slice(-8)}`;
    const account = await db.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: "Synthetic location staff", status: "ACTIVE" } });
    accountId = account.id;
    const member = await db.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: token, fullName: "Synthetic staff", phoneNumber: phone, phoneNumberNormalized: phone, attendanceEnabled: false } });
    await db.employeeBranchAssignment.create({ data: { membershipId: member.id, businessId: business.id, branchId: branch.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2020-01-01"), status: "ACTIVE" } });
    await db.employeeBusinessMembership.update({ where: { id: member.id }, data: { attendanceEnabled: true } });
    const device = await db.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash: token, status: "ACTIVE", canView: true, canPunch: true, firstVerifiedAt: new Date(), lastActiveAt: new Date() } });
    const session = await db.employeeSession.create({ data: { employeeAccountId: account.id, membershipId: member.id, businessId: business.id, primaryBranchId: branch.id, employeeDeviceId: device.id, refreshTokenHash: token, expiresAt: new Date(Date.now() + 3600000) } });
    const auth = { sessionId: session.id, employeeAccountId: account.id, membershipId: member.id, businessId: business.id, primaryBranchId: branch.id, deviceId: device.id };
    const principal = await db.$transaction(tx => loadEmployeeAttendancePrincipal({ transaction: tx, auth, now: new Date(), branchId: branch.id, requirePunch: true, requireBranchSetting: true }));
    assert.equal(principal.setting?.latitude.toString(), "5.234567");
    assert.equal(principal.setting?.geofenceRadiusMeters, 150);
    await upsertBranchAttendanceSetting({ ...context, mode: "policy", input: { ...policy, isEnabled: false } }, db);
    await assert.rejects(db.$transaction(tx => loadEmployeeAttendancePrincipal({ transaction: tx, auth, now: new Date(), branchId: branch.id, requirePunch: true, requireBranchSetting: true })), /not enabled/i);
  } finally {
    await db.employeeSession.deleteMany({ where: { businessId: business.id } });
    await db.employeeBusinessMembership.updateMany({ where: { businessId: business.id }, data: { attendanceEnabled: false } });
    await db.employeeBranchAssignment.deleteMany({ where: { businessId: business.id } });
    await db.employeeBusinessMembership.deleteMany({ where: { businessId: business.id } });
    if (accountId) { await db.employeeDevice.deleteMany({ where: { employeeAccountId: accountId } }); await db.employeeAccount.delete({ where: { id: accountId } }); }
    await db.auditLog.deleteMany({ where: { businessId: business.id } });
    await db.branchAttendanceSetting.deleteMany({ where: { businessId: business.id } });
    await db.user.delete({ where: { id: actor.id } });
    await db.branch.delete({ where: { id: branch.id } });
    // Entitlement history is immutable. The disposable runner drops this test database.
    await db.$disconnect();
  }
});
