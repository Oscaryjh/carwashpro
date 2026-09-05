import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { assertStaffTestDatabase, staffPerformanceFixture, staffCash, staffRefund, staffTargets } from "../tests/helpers/performance-staff-fixture";

async function main() {
  assertStaffTestDatabase();
  process.env.TETAMU_PERFORMANCE_PHASE1 = "true"; process.env.TETAMU_PERFORMANCE_PHASE2 = "true";
  const output = process.env.STAFF_PERFORMANCE_FIXTURE_FILE;
  if (!output?.startsWith("/tmp/tetamu-phase3-")) throw new Error("Use a private /tmp/tetamu-phase3-* fixture file");
  const db = new PrismaClient();
  try {
    const f = await staffPerformanceFixture(db, 54);
    for (const moduleKey of ["HR", "SALON"] as const) await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2026-01-01Z"), source: "SYSTEM", createdById: f.owner.id, updatedById: f.owner.id } });
    await db.branchAttendanceSetting.create({ data: { businessId: f.business.id, branchId: f.branch.id, latitude: 1.55, longitude: 110.35, isEnabled: true, requireGeofence: false, timezone: "Pacific/Honolulu" } });
    await db.employeeBusinessMembership.updateMany({ where: { businessId: f.business.id }, data: { attendanceEnabled: true } });
    await db.employeeBranchAssignment.updateMany({ where: { businessId: f.business.id }, data: { canClockIn: true } });
    await db.employeeDevice.updateMany({ where: { id: { in: f.sessions.map(s => s.context.deviceId) } }, data: { canPunch: true } });
    await db.user.update({ where: { id: f.manager.id }, data: { permissions: ["PERFORMANCE_VIEW_TEAM", "APPROVE_LEAVE"] } });
    await staffCash(db, f, { amount: "600000" });
    for (let i = 0; i < 24; i++) {
      const p = await staffCash(db, f, { at: `2026-08-${String(i + 1).padStart(2,"0")}T04:00Z` });
      if (!i) await staffRefund(db, f, p.id, 59);
    }
    await staffCash(db, f, { at: "2026-09-02T04:00Z" });
    await staffTargets(db, f);
    // Valid independent sessions, no OTP delivery and no mock authentication bypass in the app.
    writeFileSync(output, JSON.stringify({ businessId: f.business.id, branchId: f.branch.id, managerUserId: f.manager.id,
      members: f.members.slice(0,3).map(m => ({ id: m.id, name: m.fullName })),
      sessions: f.sessions.slice(0,3).map(s => ({ token: s.token, context: s.context })) }), { mode: 0o600, flag: "wx" });
    console.log("Seeded isolated Staff browser fixture: 54 members, 26 receipts, 1 refund. Private session file written.");
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
