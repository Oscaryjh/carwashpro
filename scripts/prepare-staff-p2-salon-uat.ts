import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBranchLocalDateKey } from "../src/lib/attendance/work-date";
import { businessWallClockToUtc } from "../src/lib/business-day";
import { addDaysToDateValue, dateValueToUtcDate } from "../src/lib/business-time";
import { getStaffAppointmentDay } from "../src/lib/staff-pwa/appointments";
import { prisma } from "../src/lib/prisma";

const MEMBERSHIP_ID = "25605797-ddab-4943-af8a-796a751a0682";
const MARKER = "LOCAL STAFF P2 SALON UAT";

if (process.env.NODE_ENV === "production") {
  throw new Error("Staff P2 SALON fixtures are forbidden in production.");
}
if (!/(localhost|127\.0\.0\.1)/i.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Staff P2 SALON fixtures require a Local database URL.");
}

async function main() {
  const membership = await prisma.employeeBusinessMembership.findUniqueOrThrow({
    where: { id: MEMBERSHIP_ID },
    include: {
      staffUser: true,
      branchAssignments: {
        where: { status: "ACTIVE" },
        orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }],
      },
      business: { select: { name: true, timezone: true } },
    },
  });
  const branchId = membership.branchAssignments[0]?.branchId;
  if (!branchId) throw new Error("The local employee fixture has no active branch.");

  const salonEntitlement = await prisma.businessModuleEntitlement.findUnique({
    where: { businessId_moduleKey: { businessId: membership.businessId, moduleKey: "SALON" } },
  });
  if (!salonEntitlement) {
    await prisma.businessModuleEntitlement.create({ data: {
      businessId: membership.businessId,
      moduleKey: "SALON",
      status: "ENABLED",
      enabledFrom: new Date(Date.now() - 60_000),
      source: "SYSTEM",
      planCode: "LOCAL_STAFF_P2_UAT",
    } });
  } else if (salonEntitlement.status !== "ENABLED" || salonEntitlement.enabledUntil) {
    await prisma.businessModuleEntitlement.update({
      where: { id: salonEntitlement.id },
      data: {
      status: "ENABLED",
      enabledFrom: new Date(Date.now() - 60_000),
      enabledUntil: null,
      source: "SYSTEM",
      planCode: "LOCAL_STAFF_P2_UAT",
      revision: { increment: 1 },
    } });
  }

  const staffUser = membership.staffUser
    ? await prisma.user.update({
        where: { id: membership.staffUser.id },
        data: { appointmentBookable: true, branchId, permissions: ["APPOINTMENTS"] },
      })
    : await prisma.user.create({
        data: {
          businessId: membership.businessId,
          branchId,
          employeeAccountId: membership.employeeAccountId,
          employeeBusinessMembershipId: membership.id,
          teamMemberLinkStatus: "LINKED",
          teamMemberLinkedAt: new Date(),
          name: membership.fullName,
          role: "STAFF",
          status: "active",
          loginEnabled: false,
          appointmentBookable: true,
          permissions: ["APPOINTMENTS"],
        },
      });

  const category = await prisma.serviceCategory.upsert({
    where: { businessId_name: { businessId: membership.businessId, name: "Local P2 Salon Services" } },
    create: { businessId: membership.businessId, name: "Local P2 Salon Services" },
    update: { status: "ACTIVE" },
  });
  const serviceNames = [
    "Signature Keratin Smoothing, Scalp Renewal and Precision Finish",
    "Restorative Botanical Hair and Head Spa Consultation",
  ];
  const services = await Promise.all(serviceNames.map((name, index) => prisma.service.upsert({
    where: { businessId_name: { businessId: membership.businessId, name } },
    create: {
      businessId: membership.businessId,
      branchId,
      categoryId: category.id,
      name,
      category: "SALON",
      description: `${MARKER} service ${index + 1}`,
      price: index ? "188.00" : "388.00",
      durationMinutes: index ? 45 : 90,
    },
    update: { branchId, categoryId: category.id, status: "ACTIVE" },
  })));
  await prisma.serviceStaffAssignment.createMany({
    data: services.map((service) => ({ businessId: membership.businessId, serviceId: service.id, userId: staffUser.id })),
    skipDuplicates: true,
  });

  const customers = await Promise.all([
    { name: "Alexandria-Margaret Extremely Long Customer Display Name", phone: "+601100000901" },
    { name: "Nur Aisyah", phone: "+601100000902" },
    { name: "Daniel Tan", phone: "+601100000903" },
  ].map((customer) => prisma.customer.upsert({
    where: { businessId_phone: { businessId: membership.businessId, phone: customer.phone } },
    create: { businessId: membership.businessId, branchId, ...customer, notes: `${MARKER} private note — must never appear in Staff App` },
    update: { branchId, name: customer.name, notes: `${MARKER} private note — must never appear in Staff App` },
  })));

  await prisma.appointment.deleteMany({ where: { businessId: membership.businessId, notes: { startsWith: MARKER } } });
  const now = new Date();
  const today = getBranchLocalDateKey(now, membership.business.timezone);
  const existingExpectedDay = await prisma.attendanceExpectedDay.findFirst({
    where: { businessId: membership.businessId, membershipId: membership.id, workDate: dateValueToUtcDate(today), status: "CURRENT" },
  });
  if (!existingExpectedDay) {
    await prisma.attendanceExpectedDay.create({
      data: {
        businessId: membership.businessId,
        branchId,
        membershipId: membership.id,
        workDate: dateValueToUtcDate(today),
        kind: "WORKDAY",
        source: "MANUAL_EVIDENCE",
        expectedStartAt: businessWallClockToUtc(today, "08:00", membership.business.timezone),
        expectedEndAt: businessWallClockToUtc(today, "09:00", membership.business.timezone),
        timezoneSnapshot: membership.business.timezone,
        evidenceReference: MARKER,
        createdById: staffUser.id,
      },
    });
  }
  const starts = [40, 100, 170].map((minutes) => new Date(now.getTime() + minutes * 60_000));
  const created = await Promise.all(starts.map((scheduledAt, index) => prisma.appointment.create({
    data: {
      businessId: membership.businessId,
      branchId,
      customerId: customers[index]!.id,
      serviceId: services[index === 1 ? 1 : 0]!.id,
      serviceIds: index === 0 ? services.map((service) => service.id) : [services[index === 1 ? 1 : 0]!.id],
      assignedStaffId: staffUser.id,
      scheduledAt,
      durationMinutes: index === 0 ? 135 : index === 1 ? 45 : 90,
      status: index === 1 ? "CONFIRMED" : "SCHEDULED",
      notes: `${MARKER} appointment ${index + 1}`,
    },
  })));

  const day = await getStaffAppointmentDay({
    auth: {
      sessionId: "local-staff-p2-uat",
      employeeAccountId: membership.employeeAccountId,
      membershipId: membership.id,
      businessId: membership.businessId,
      primaryBranchId: branchId,
      attendanceBranchId: branchId,
      deviceId: "local-staff-p2-uat",
    },
    date: today,
    now,
  });
  if (day.staffMapping !== "LINKED" || day.appointments.length !== 3) {
    throw new Error(`Expected three exact-membership appointments, received ${day.appointments.length}.`);
  }
  if (!day.appointments.some((appointment) => appointment.conflicts.some((conflict) => conflict.code === "OUTSIDE_SHIFT"))) {
    throw new Error("Expected at least one outside-shift conflict warning.");
  }
  if (JSON.stringify(day).includes("private note") || JSON.stringify(day).includes("+6011000009")) {
    throw new Error("Staff appointment projection exposed private customer data.");
  }

  const artifact = {
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: membership.businessId,
    branchId,
    membershipId: membership.id,
    staffUserId: staffUser.id,
    today,
    emptyDay: addDaysToDateValue(today, 1),
    appointmentIds: created.map((appointment) => appointment.id),
    exactMembershipMapping: day.staffMapping,
    visibleAppointmentCount: day.appointments.length,
    privacyProjectionVerified: true,
  };
  await writeFile(join(process.cwd(), ".tmp", "staff-p2-salon-uat.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
