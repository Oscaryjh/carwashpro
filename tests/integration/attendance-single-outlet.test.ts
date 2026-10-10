import assert from "node:assert/strict";
import test from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { attendanceActionsFixture } from "../helpers/attendance-single-outlet-fixture";
import { renderToStaticMarkup } from "react-dom/server";
import { performAttendancePunch } from "../../src/lib/attendance/punch-service";
import { hashEmployeeIdentifier } from "../../src/lib/attendance/employee-auth/crypto";

test("real Attendance actions and list/export keep explicit scope, fresh topology, permissions and unchanged writer contracts", async () => {
  const db = new PrismaClient();
  const fixture = await attendanceActionsFixture(db);
  const idle = { status: "idle" as const, message: "" };
  const result = async (call: Promise<unknown>) => {
    try { return await call; } catch (e) {
      if (typeof (e as { url?: unknown }).url === "string") return { redirect: (e as { url: string }).url };
      throw e;
    }
  };
  const snapshot = async () => JSON.stringify(await Promise.all([
    db.branchAttendanceSetting.findMany({ orderBy: { id: "asc" } }), db.employeeAttendance.findMany({ orderBy: { id: "asc" } }),
    db.attendanceExpectedDay.findMany({ orderBy: { id: "asc" } }), db.rosterPeriod.findMany({ orderBy: { id: "asc" } }),
    db.rosterAssignment.findMany({ orderBy: { id: "asc" } }), db.employeeBranchAssignment.findMany({ orderBy: { id: "asc" } }),
  ]));
  const form = (branchId: string, simplified = true) => {
    const data = new FormData(); data.set("branchId", branchId);
    if (simplified) { data.set("attendanceOutletMode", "single_outlet"); data.set("attendanceOutletBranchId", branchId); }
    for (const [key, value] of Object.entries({ requireGeofence: "on", allowOutsideGeofenceRequest: "on", breakPolicy: "MANUAL_PUNCH", targetBreakMinutes: "60", normalWorkMinutesPerDay: "480", shiftSpanMinutes: "540", timezone: "Asia/Kuching", isEnabled: "on" })) data.set(key, value);
    return data;
  };
  const deny = async (call: () => Promise<unknown>) => {
    const before = await snapshot(); const response = await result(call());
    assert.doesNotMatch(JSON.stringify(response), /type=success/);
    assert.equal(await snapshot(), before, JSON.stringify(response));
    return response;
  };
  try {
    const business = await db.business.create({ data: { name: "PHASE1D2 synthetic actions", slug: randomUUID(), industryType: "SALON_BEAUTY" } });
    const branch = await db.branch.create({ data: { businessId: business.id, name: "A" } });
    const foreign = await db.business.create({ data: { name: "PHASE1D2 foreign", slug: randomUUID(), industryType: "SALON_BEAUTY" } });
    const foreignBranch = await db.branch.create({ data: { businessId: foreign.id, name: "X" } });
    const owner = await db.user.create({ data: { businessId: business.id, name: "Synthetic Owner", email: `${randomUUID()}@example.test`, role: "BUSINESS_OWNER" } });
    const staff = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Scoped Staff", email: `${randomUUID()}@example.test`, role: "STAFF", permissions: ["TEAM", "ATTENDANCE_EMPLOYEE_MANAGE", "ATTENDANCE_SETTINGS_MANAGE", "ROSTER_EDIT"] } });
    await db.businessModuleEntitlement.createMany({ data: ["POS", "SALON", "HR"].map(moduleKey => ({ businessId: business.id, moduleKey: moduleKey as "HR", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) })) });
    await db.branchAttendanceSetting.create({ data: { businessId: business.id, branchId: branch.id, latitude: 1.5535, longitude: 110.3593, timezone: "Asia/Kuching" } });
    await fixture.login(owner.id);
    assert.match(JSON.stringify(await result(fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)))), /type=success/);
    const saved = await db.branchAttendanceSetting.findUniqueOrThrow({ where: { branchId: branch.id } });
    assert.equal(saved.latitude.toString(), "1.5535"); assert.equal(saved.longitude.toString(), "110.3593");
    assert.equal(saved.breakPolicy, "MANUAL_PUNCH"); assert.equal(saved.timezone, "Asia/Kuching");
    await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(foreignBranch.id)));
    const multi = await db.branch.create({ data: { businessId: business.id, name: "B" } });
    await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)));
    // Marker-free legacy explicit form retains its existing service contract.
    const legacy = form(branch.id, false); legacy.set("latitude", "1.5535"); legacy.set("longitude", "110.3593"); legacy.set("geofenceRadiusMeters", "100"); legacy.set("minimumAccuracyMeters", "80");
    assert.match(JSON.stringify(await result(fixture.actions.saveBranchAttendanceSettingAction(idle, legacy))), /type=success/);
    const phone = `+${randomInt(60120000000, 60129999999)}`;
    const account = await db.employeeAccount.create({ data: { name: "Synthetic E", phoneNumber: phone, phoneNormalized: phone } });
    const member = await db.employeeBusinessMembership.create({ data: { businessId: business.id, employeeAccountId: account.id, employeeCode: "UAT", joinedAt: new Date("2024-01-01"), fullName: "Synthetic E", phoneNumber: account.phoneNumber, phoneNumberNormalized: account.phoneNormalized } });
    await db.employeeBranchAssignment.create({ data: { businessId: business.id, membershipId: member.id, branchId: branch.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2024-01-01") } });
    for (const item of [branch, multi]) await db.employeeAttendance.create({ data: { businessId: business.id, employeeAccountId: account.id, membershipId: member.id, branchId: item.id, workDate: new Date("2026-10-01"), clockInAt: new Date("2026-10-01T01:00:00Z"), clockOutAt: new Date("2026-10-01T09:00:00Z"), totalWorkedMinutes: 480, status: "COMPLETED" } });
    for (const item of [branch, multi]) {
      const exportResponse = await fixture.actions.AttendanceExport(new Request(`http://localhost/team/attendance/export?branchId=${item.id}`));
      assert.equal(exportResponse.status, 200);
      const csv = await exportResponse.text();
      assert.ok(csv.includes(`,"${item.name}",`), csv);
      assert.equal(csv.trim().split("\n").length, 2, "explicit export returns one branch record, not A+B");
      const page = renderToStaticMarkup(await fixture.actions.AttendanceList({ searchParams: Promise.resolve({ branchId: item.id, datePreset: "all" }) }));
      assert.equal((page.match(/data-label="Branch"/g) ?? []).length, 1, "list and export each contain exactly the explicit branch record");
      assert.ok(page.includes(`data-label="Branch">${item.name}</td>`), "list renders the selected branch attribution");
    }
    const before = await snapshot();
    for (const value of ["", foreignBranch.id, randomUUID(), `${branch.id}&branchId=${multi.id}`]) {
      const response = await fixture.actions.AttendanceExport(new Request(`http://localhost/team/attendance/export?branchId=${value}`));
      assert.equal(response.status, 404);
    }
    assert.equal(await snapshot(), before);
    await fixture.login(staff.id);
    assert.equal((await fixture.actions.AttendanceExport(new Request(`http://localhost/team/attendance/export?branchId=${multi.id}`))).status, 404);
    for (const branchId of [multi.id, foreignBranch.id]) {
      await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(branchId, false)));
      const p2 = new FormData(); p2.set("branchId", branchId); p2.set("membershipId", member.id); p2.set("workDate", "2026-10-01");
      await deny(() => fixture.actions.recordExpectedAttendanceAction(p2));
      await deny(() => fixture.actions.saveRosterAssignmentAction(p2));
    }
    await db.branch.update({ where: { id: multi.id }, data: { status: "INACTIVE" } });
    await fixture.login(staff.id);
    assert.match(JSON.stringify(await result(fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)))), /type=success/);
    const p2 = form(branch.id); p2.set("membershipId", member.id); p2.set("workDate", "2026-10-02"); p2.set("kind", "WORKDAY"); p2.set("expectedStartLocal", "09:00"); p2.set("expectedEndLocal", "17:00"); p2.set("graceMinutes", "5");
    assert.match(JSON.stringify(await result(fixture.actions.recordExpectedAttendanceAction(p2))), /type=success/);
    const expected = await db.attendanceExpectedDay.findFirstOrThrow({ where: { membershipId: member.id, workDate: new Date("2026-10-02") } });
    assert.equal(expected.branchId, branch.id); assert.equal(expected.timezoneSnapshot, "Asia/Kuching"); assert.equal(expected.graceMinutes, 5);
    const roster = form(branch.id); roster.set("membershipId", member.id); roster.set("workDate", "2026-10-05"); roster.set("weekStart", "2026-10-05"); roster.set("kind", "REST_DAY"); roster.set("expectedDraftRevision", "0");
    assert.match(JSON.stringify(await result(fixture.actions.saveRosterAssignmentAction(roster))), /type=success/);
    assert.equal((await db.rosterAssignment.findFirstOrThrow({ where: { membershipId: member.id } })).branchId, branch.id);
    await db.branch.update({ where: { id: multi.id }, data: { status: "ACTIVE" } });
    await deny(() => fixture.actions.recordExpectedAttendanceAction(p2));
    await deny(() => fixture.actions.saveRosterAssignmentAction(roster));
    await db.branch.update({ where: { id: multi.id }, data: { status: "INACTIVE" } });
    await db.user.update({ where: { id: staff.id }, data: { permissions: [] } });
    await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)));
    await deny(() => fixture.actions.recordExpectedAttendanceAction(p2));
    await deny(() => fixture.actions.saveRosterAssignmentAction(roster));
    await db.user.update({ where: { id: staff.id }, data: { branchId: null, permissions: ["TEAM", "ATTENDANCE_SETTINGS_MANAGE"] } });
    await fixture.login(staff.id);
    assert.match(JSON.stringify(await result(fixture.actions.AttendanceExport(new Request("http://localhost/team/attendance/export")))), /business-access-denied/, "branchless Staff is rejected by existing effective access before any reader");
    await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)));
    await fixture.login(owner.id);
    await db.branch.update({ where: { id: branch.id }, data: { status: "INACTIVE" } });
    await deny(() => fixture.actions.saveBranchAttendanceSettingAction(idle, form(branch.id)));
  } finally { await fixture.close(); await db.$disconnect(); }
});

test("open record attribution, revoked assignment and canClockIn remain fail closed before replay", async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55448"); assert.match(target.pathname, /^\/tetamu_phase1d2_disposable_/);
  const db = new PrismaClient();
  try {
    const biz = await db.business.create({ data: { name: "PHASE1D2 open policy", slug: randomUUID(), industryType: "SALON_BEAUTY" } });
    await db.businessModuleEntitlement.create({ data: { businessId: biz.id, moduleKey: "HR", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
    const a = await db.branch.create({ data: { businessId: biz.id, name: "Original A" } });
    const b = await db.branch.create({ data: { businessId: biz.id, name: "New current B" } });
    for (const branch of [a,b]) await db.branchAttendanceSetting.create({ data: { businessId: biz.id, branchId: branch.id, isEnabled: true, latitude: 1.5535, longitude: 110.3593 } });
    const phone = `+${randomInt(60120000000, 60129999999)}`;
    const account = await db.employeeAccount.create({ data: { name: "Synthetic punch", phoneNumber: phone, phoneNormalized: phone } });
    const member = await db.employeeBusinessMembership.create({ data: { businessId: biz.id, employeeAccountId: account.id, employeeCode: randomUUID(), fullName: account.name, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2024-01-01") } });
    const assignment = await db.employeeBranchAssignment.create({ data: { businessId: biz.id, membershipId: member.id, branchId: a.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2024-01-01") } });
    await db.employeeBusinessMembership.update({ where: { id: member.id }, data: { attendanceEnabled: true } });
    const deviceIdentifier = `phase1d2-device-${randomUUID()}`;
    const device = await db.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash: hashEmployeeIdentifier("device", deviceIdentifier), status: "ACTIVE", canView: true, canPunch: true } });
    const session = await db.employeeSession.create({ data: { businessId: biz.id, employeeAccountId: account.id, membershipId: member.id, primaryBranchId: a.id, attendanceBranchId: a.id, employeeDeviceId: device.id, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now()+86400000) } });
    const auth = { sessionId: session.id, employeeAccountId: account.id, membershipId: member.id, businessId: biz.id, primaryBranchId: a.id, attendanceBranchId: a.id, deviceId: device.id };
    const input = { branchId: a.id, latitude: 1.5535, longitude: 110.3593, accuracyMeters: 10, deviceIdentifier, idempotencyKey: `clockin-${randomUUID()}` };
    const original = await performAttendancePunch({ database: db, auth, type: "CLOCK_IN", input });
    const record = await db.employeeAttendance.findUniqueOrThrow({ where: { id: original.attendanceSessionId } });
    const deny = async (branchId=a.id) => {
      const count = await db.attendancePunch.count({ where: { attendanceSessionId: record.id } });
      await assert.rejects(performAttendancePunch({ database: db, auth, type: "CLOCK_OUT", input: { ...input, branchId, idempotencyKey: `clockout-${randomUUID()}` } }));
      assert.equal(await db.attendancePunch.count({ where: { attendanceSessionId: record.id } }), count);
      const after = await db.employeeAttendance.findUniqueOrThrow({ where: { id: record.id } });
      assert.equal(after.branchId, a.id); assert.equal(after.status, "OPEN"); assert.equal(after.clockOutAt, null);
    };
    await deny(b.id);
    await db.branch.update({ where: { id: a.id }, data: { status: "INACTIVE" } });
    await deny();
    await db.branch.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
    await db.employeeBranchAssignment.update({ where: { id: assignment.id }, data: { canClockIn: false } });
    await deny();
    await assert.rejects(performAttendancePunch({ database: db, auth, type: "CLOCK_IN", input }), "replay must recheck revoked canClockIn");
    await db.employeeBusinessMembership.update({ where: { id: member.id }, data: { attendanceEnabled: false } });
    await db.employeeBranchAssignment.update({ where: { id: assignment.id }, data: { status: "INACTIVE" } });
    await deny();
  } finally { await db.$disconnect(); }
});
