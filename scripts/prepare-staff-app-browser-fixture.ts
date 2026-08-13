import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { BusinessModuleKey } from "@prisma/client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Staff App browser fixtures are forbidden in production.");
}

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/(localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
  throw new Error("Staff App browser fixtures require a Local database URL.");
}

const fixtureToken = randomUUID().slice(0, 8);
const scenarios: Array<{
  key: string;
  name: string;
  phone: string;
  modules: BusinessModuleKey[];
  attendanceEnabled: boolean;
}> = [
  {
    key: "workforce",
    name: "Staff E2E Full Workforce",
    phone: `+60117${Date.now().toString().slice(-7)}`,
    modules: ["HR", "CLAIMS", "COMMISSION", "PAYROLL"],
    attendanceEnabled: true,
  },
  {
    key: "hr-only",
    name: "Staff E2E HR Only",
    phone: `+60118${Date.now().toString().slice(-7)}`,
    modules: ["HR"],
    attendanceEnabled: true,
  },
  {
    key: "pos-only",
    name: "Staff E2E POS Only",
    phone: `+60119${Date.now().toString().slice(-7)}`,
    modules: ["POS"],
    attendanceEnabled: false,
  },
];

async function main() {
  const incompleteBusinesses = await prisma.business.findMany({
    where: {
      slug: { startsWith: "staff-e2e-" },
      moduleEntitlements: { none: {} },
    },
    select: {
      id: true,
      employeeMemberships: { select: { id: true, employeeAccountId: true } },
    },
  });
  const incompleteBusinessIds = incompleteBusinesses.map((business) => business.id);
  if (incompleteBusinessIds.length > 0) {
    const incompleteMembershipIds = incompleteBusinesses.flatMap((business) =>
      business.employeeMemberships.map((membership) => membership.id),
    );
    const incompleteAccountIds = incompleteBusinesses.flatMap((business) =>
      business.employeeMemberships.map((membership) => membership.employeeAccountId),
    );
    await prisma.employeeBusinessMembership.updateMany({
      where: { id: { in: incompleteMembershipIds } },
      data: { attendanceEnabled: false },
    });
    await prisma.employeeBranchAssignment.deleteMany({
      where: { membershipId: { in: incompleteMembershipIds } },
    });
    await prisma.employeeBusinessMembership.deleteMany({
      where: { id: { in: incompleteMembershipIds } },
    });
    await prisma.employeeAccount.deleteMany({
      where: { id: { in: incompleteAccountIds }, memberships: { none: {} } },
    });
    await prisma.branchAttendanceSetting.deleteMany({
      where: { businessId: { in: incompleteBusinessIds } },
    });
    await prisma.branch.deleteMany({
      where: { businessId: { in: incompleteBusinessIds } },
    });
    await prisma.business.deleteMany({
      where: { id: { in: incompleteBusinessIds } },
    });
  }
  await prisma.employeeAccount.deleteMany({
    where: {
      name: { startsWith: "Staff E2E" },
      memberships: { none: {} },
    },
  });

  const results = [];
  for (const scenario of scenarios) {
  const business = await prisma.business.create({
    data: {
      name: `${scenario.name} ${fixtureToken}`,
      slug: `staff-e2e-${scenario.key}-${fixtureToken}`,
      timezone: "Asia/Kuala_Lumpur",
      industryType: "GENERAL_SERVICE",
    },
  });
  const branch = await prisma.branch.create({
    data: {
      businessId: business.id,
      name: "Local QA Branch",
    },
  });
  const account = await prisma.employeeAccount.create({
    data: {
      name: scenario.name,
      phoneNumber: scenario.phone,
      phoneNormalized: scenario.phone,
      status: "ACTIVE",
    },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId: business.id,
      employeeCode: `QA-${scenario.key.toUpperCase()}-${fixtureToken}`,
      fullName: scenario.name,
      phoneNumber: scenario.phone,
      phoneNumberNormalized: scenario.phone,
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      attendanceEnabled: false,
      position: "Local QA Employee",
    },
  });
  await prisma.employeeBranchAssignment.create({
    data: {
      membershipId: membership.id,
      businessId: business.id,
      branchId: branch.id,
      isPrimary: true,
      canClockIn: scenario.attendanceEnabled,
      effectiveFrom: new Date(Date.now() - 60_000),
      status: "ACTIVE",
    },
  });
  if (scenario.attendanceEnabled) {
    await prisma.employeeBusinessMembership.update({
      where: { id: membership.id },
      data: { attendanceEnabled: true },
    });
  }
  await prisma.branchAttendanceSetting.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      latitude: 3.139,
      longitude: 101.6869,
      requireGeofence: false,
      allowOutsideGeofenceRequest: false,
      requirePhoto: false,
      timezone: "Asia/Kuala_Lumpur",
      isEnabled: scenario.attendanceEnabled,
    },
  });
  await prisma.businessModuleEntitlement.createMany({
    data: scenario.modules.map((moduleKey) => ({
      businessId: business.id,
      moduleKey,
      status: "ENABLED" as const,
      enabledFrom: new Date(Date.now() - 60_000),
      source: "SYSTEM" as const,
      planCode: "LOCAL_STAFF_E2E",
    })),
  });
    results.push({
      scenario: scenario.key,
      phone: scenario.phone,
      businessId: business.id,
      membershipId: membership.id,
      enabledModules: ["CORE", ...scenario.modules],
    });
  }

  console.log(JSON.stringify({ environment: "LOCAL_TESTING", fixtureToken, scenarios: results }));
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
