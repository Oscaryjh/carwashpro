import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";
import { EMPLOYEE_SESSION_COOKIE } from "../src/lib/attendance/employee-auth/config";
import { prisma } from "../src/lib/prisma";

if (process.env.NODE_ENV === "production") throw new Error("Roster browser fixtures are forbidden in production.");
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/(localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("Roster browser fixtures require a Local database URL.");
process.env.EMPLOYEE_AUTH_SECRET ??= "tetamu-local-development-employee-auth-secret-v1";

async function main() {
  const token = randomUUID().slice(0, 8);
  const email = `roster.manager.${token}@test.local`;
  const password = `RosterLocal!${token}`;
  const phone = `+601${String(Date.now()).slice(-8)}`;
  const now = new Date();
  const fixture = await prisma.$transaction(async (transaction) => {
    const business = await transaction.business.create({ data: { name: `Roster Browser QA ${token}`, slug: `roster-e2e-${token}`, timezone: "Asia/Kuala_Lumpur", industryType: "GENERAL_SERVICE" } });
    const branchA = await transaction.branch.create({ data: { businessId: business.id, name: "Roster QA Branch A" } });
    const branchB = await transaction.branch.create({ data: { businessId: business.id, name: "Roster QA Branch B" } });
    await transaction.branchAttendanceSetting.createMany({ data: [branchA, branchB].map((branch) => ({ businessId: business.id, branchId: branch.id, latitude: 3.139, longitude: 101.6869, requireGeofence: false, allowOutsideGeofenceRequest: false, timezone: "Asia/Kuala_Lumpur", isEnabled: true })) });
    await transaction.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "HR", status: "ENABLED", enabledFrom: new Date(now.getTime() - 60_000), source: "SYSTEM", planCode: "LOCAL_ROSTER_E2E" } });
    const owner = await transaction.user.create({ data: { businessId: business.id, branchId: branchA.id, name: "Roster QA Manager", email, passwordHash: await bcrypt.hash(password, 10), role: "BUSINESS_OWNER", status: "active", loginEnabled: true } });
    const account = await transaction.employeeAccount.create({ data: { name: "Roster QA Employee", phoneNumber: phone, phoneNormalized: phone } });
    const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: `RST-${token}`, fullName: "Roster QA Employee", phoneNumber: phone, phoneNumberNormalized: phone, attendanceEnabled: true, joinedAt: new Date("2026-01-01T00:00:00.000Z"), position: "Local QA Staff" } });
    await transaction.employeeBranchAssignment.createMany({ data: [
      { membershipId: membership.id, businessId: business.id, branchId: branchA.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      { membershipId: membership.id, businessId: business.id, branchId: branchB.id, isPrimary: false, canClockIn: true, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
    ] });
    const deviceIdentifierHash = createHash("sha256").update(`roster-browser-${token}`).digest("hex");
    const device = await transaction.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash, displayName: "Roster Browser QA", platform: "Testing", browser: "Codex Browser" } });
    const session = await createEmployeeSessionRecord({ employeeAccountId: account.id, membershipId: membership.id, businessId: business.id, primaryBranchId: branchA.id, attendanceBranchId: branchA.id, deviceId: device.id, now }, transaction);
    return { business, branchA, branchB, owner, membership, session };
  });
  console.log(JSON.stringify({
    environment: "LOCAL_TESTING",
    manager: { email, password },
    staff: { phone, cookieName: EMPLOYEE_SESSION_COOKIE, cookieValue: fixture.session.token },
    ids: { businessId: fixture.business.id, branchAId: fixture.branchA.id, branchBId: fixture.branchB.id, membershipId: fixture.membership.id },
    targetWeek: "2026-08-17",
  }));
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
