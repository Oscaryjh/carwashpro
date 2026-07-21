import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import {
  SALON_APPOINTMENT_ACTIVE_STATUSES,
  formatAppointmentStatus,
} from "@/lib/validation/appointments";

export default async function SalonDashboardPage() {
  const context = await requireBusinessIndustryContext();

  if (context.industry.industryType !== "SALON_BEAUTY") {
    redirect("/dashboard");
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const branchFilter =
    context.user.role === "BUSINESS_OWNER"
      ? {}
      : { branchId: context.user.branchId ?? "00000000-0000-0000-0000-000000000000" };
  const salonAppointmentWhere: Prisma.AppointmentWhereInput = {
    businessId: context.businessId,
    ...branchFilter,
    status: { notIn: ["CANCELLED", "NO_SHOW"] },
    scheduledAt: { gte: todayStart, lt: todayEnd },
  };
  const salonScheduleWhere: Prisma.AppointmentWhereInput = {
    businessId: context.businessId,
    ...branchFilter,
    status: { in: [...SALON_APPOINTMENT_ACTIVE_STATUSES] },
    scheduledAt: { gte: todayStart, lt: todayEnd },
  };
  const [todayAppointments, waiting, completedToday, schedule, staff, staffAppointments] = await Promise.all([
    prisma.appointment.count({
      where: salonAppointmentWhere,
    }),
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        status: { in: [...SALON_APPOINTMENT_ACTIVE_STATUSES] },
        scheduledAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        status: "COMPLETED",
        completedAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.appointment.findMany({
      where: {
        ...salonScheduleWhere,
      },
      include: {
        customer: { select: { name: true, phone: true } },
        service: { select: { id: true, name: true } },
        assignedStaff: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 12,
    }),
    prisma.user.findMany({
      where: {
        businessId: context.businessId,
        status: "active",
        appointmentBookable: true,
        ...(context.user.role === "BUSINESS_OWNER"
          ? {}
          : { branchId: context.user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
      },
      select: {
        id: true,
        name: true,
        role: true,
        branch: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.appointment.findMany({
      where: salonScheduleWhere,
      select: { assignedStaffId: true, status: true, scheduledAt: true },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);

  const appointmentServiceIds = [
    ...new Set(
      schedule.flatMap((appointment) =>
        appointment.serviceIds.length
          ? appointment.serviceIds
          : appointment.service?.id
            ? [appointment.service.id]
            : [],
      ),
    ),
  ];
  const appointmentServices = appointmentServiceIds.length
    ? await prisma.service.findMany({
        where: { businessId: context.businessId, id: { in: appointmentServiceIds } },
        select: { id: true, name: true },
      })
    : [];
  const appointmentServiceNames = new Map(
    appointmentServices.map((service) => [service.id, service.name]),
  );

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Beauty &amp; Wellness</h1>
          </div>
        </div>

        <div className="dashboard-kpis">
          <Metric label="Today&apos;s appointments" value={String(todayAppointments)} />
          <Metric label="Scheduled" value={String(waiting)} />
          <Metric label="Completed today" value={String(completedToday)} />
        </div>

        <div className="dashboard-grid">
          <section className="panel">
            <div className="section-header salon-dashboard-section-header">
              <h2>Today&apos;s schedule</h2>
              <Link href="/appointments">Open calendar</Link>
            </div>
            {schedule.length ? (
              <div className="salon-dashboard-list">
                {schedule.map((appointment) => (
                  <Link
                    className="salon-dashboard-row salon-dashboard-row-link"
                    href={`/appointments/${appointment.id}`}
                    key={appointment.id}
                  >
                    <div className="salon-dashboard-time">
                      <strong>{formatTime(appointment.scheduledAt)}</strong>
                      <span>{appointment.durationMinutes} min</span>
                    </div>
                    <div className="salon-dashboard-customer">
                      <strong>{appointment.customer.name}</strong>
                      <span>
                        {getAppointmentServiceLabel(appointment, appointmentServiceNames)}
                        {appointment.assignedStaff?.name
                          ? ` - ${appointment.assignedStaff.name}`
                          : " - Unassigned"}
                      </span>
                    </div>
                    <StatusBadge status={appointment.status} />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty-state">No appointments scheduled for today.</p>
            )}
          </section>
          <section className="panel">
            <h2>Staff availability</h2>
            {staff.length ? (
              <div className="salon-dashboard-list">
                {staff.map((member) => {
                  const appointments = staffAppointments.filter(
                    (appointment) => appointment.assignedStaffId === member.id,
                  );
                  const next = appointments.find(
                    (appointment) =>
                      appointment.scheduledAt.getTime() >= Date.now() &&
                      !["COMPLETED", "CANCELLED", "NO_SHOW", "CONVERTED_TO_JOB"].includes(
                        appointment.status,
                      ),
                  );
                  const availability = next
                    ? `Next ${formatTime(next.scheduledAt)}`
                    : "Available";

                  return (
                    <div className="salon-dashboard-row" key={member.id}>
                      <div className="salon-dashboard-avatar">{initials(member.name)}</div>
                      <div className="salon-dashboard-customer">
                        <strong>{member.name}</strong>
                        <span>
                          {member.branch?.name ?? "All branches"} - {appointments.length} appointment{appointments.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <span className="salon-staff-status">
                        {availability}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No active staff accounts yet.</p>
            )}
          </section>
        </div>
      </section>
    </>
  );
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status === "CONFIRMED" || status === "ARRIVED" || status === "IN_SERVICE"
    ? "SCHEDULED"
    : status;
  return (
    <span className={`salon-appointment-status status-${normalizedStatus.toLowerCase()}`}>
      {formatAppointmentStatus(normalizedStatus)}
    </span>
  );
}

function getAppointmentServiceLabel(
  appointment: { serviceId: string | null; serviceIds: string[]; service: { id: string; name: string } | null },
  serviceNames: Map<string, string>,
) {
  const ids = appointment.serviceIds.length
    ? appointment.serviceIds
    : appointment.serviceId
      ? [appointment.serviceId]
      : [];
  const names = ids.map((id) => serviceNames.get(id)).filter(Boolean) as string[];

  return names.length ? names.join(", ") : appointment.service?.name ?? "Service to be selected";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
