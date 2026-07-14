import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import {
  canMoveAppointmentStatus,
  formatAppointmentStatus,
} from "@/lib/validation/appointments";
import {
  convertAppointmentToJobAction,
  updateAppointmentStatusAction,
} from "../actions";

type AppointmentDetailPageProps = {
  params: Promise<{
    appointmentId: string;
  }>;
};

export default async function AppointmentDetailPage({
  params,
}: AppointmentDetailPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { appointmentId } = await params;
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      branch: true,
      customer: true,
      notificationQueues: {
        where: { messageType: "APPOINTMENT_REMINDER" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      service: true,
      vehicle: true,
      workOrder: true,
    },
  });

  if (!appointment) {
    notFound();
  }

  const canConvert =
    appointment.status !== "CONVERTED_TO_JOB" &&
    appointment.status !== "CANCELLED" &&
    appointment.status !== "NO_SHOW" &&
    Boolean(appointment.service || appointment.serviceIds.length);
  const assignedStaffName = await getAssignedStaffName(appointment.id, businessId);
  const serviceNames = appointment.serviceIds.length
    ? await getServiceNames(appointment.serviceIds, businessId)
    : appointment.service
      ? [appointment.service.name]
      : [];

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{appointment.customer.name}</h1>
            <p>
              {appointment.vehicle.plateNumber} /{" "}
              {appointment.scheduledAt.toLocaleString()}
            </p>
          </div>
          <BackButton fallbackHref="/appointments" />
        </div>

        <div className="grid">
          <Info label="Status" value={formatAppointmentStatus(appointment.status)} />
          <Info label="Branch" value={appointment.branch?.name ?? "All branches"} />
          <Info label="Customer" value={`${appointment.customer.name} - ${appointment.customer.phone}`} />
          <Info
            label="Vehicle"
            value={`${appointment.vehicle.plateNumber} ${vehicleDetails(appointment.vehicle)}`}
          />
          <Info label="Service" value={serviceNames.join(", ") || "Not selected"} />
          <Info label="Staff" value={assignedStaffName ?? "Unassigned"} />
          <Info
            label="Scheduled"
            value={appointment.scheduledAt.toLocaleString()}
          />
          <Info
            label="Reminder"
            value={formatReminderStatus(appointment.notificationQueues[0])}
          />
        </div>

        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Appointment actions</h2>
              <p>Move the appointment through the visit flow.</p>
            </div>
            <span className={`status ${appointment.status.toLowerCase()}`}>
              {formatAppointmentStatus(appointment.status)}
            </span>
          </div>

          <div className="inline-actions">
            {(["CONFIRMED", "ARRIVED", "CANCELLED", "NO_SHOW"] as const).map(
              (status) =>
                canMoveAppointmentStatus(appointment.status, status) ? (
                  <form action={updateAppointmentStatusAction} key={status}>
                    <input type="hidden" name="appointmentId" value={appointment.id} />
                    <input type="hidden" name="status" value={status} />
                    <button
                      className={
                        status === "CANCELLED" || status === "NO_SHOW"
                          ? "danger-button"
                          : undefined
                      }
                      type="submit"
                    >
                      {actionLabel(status)}
                    </button>
                  </form>
                ) : null,
            )}

            {appointment.workOrder ? (
              <Link className="button-link" href={`/work-orders/${appointment.workOrder.id}`}>
                Open Job
              </Link>
            ) : canConvert ? (
              <form action={convertAppointmentToJobAction}>
                <input type="hidden" name="appointmentId" value={appointment.id} />
                <button type="submit">Create Job</button>
              </form>
            ) : (
              <p className="empty-state">
                Choose a service before converting this appointment to a job.
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Notes</h2>
          <p className="muted">{appointment.notes || "No notes."}</p>
        </div>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

function actionLabel(status: string) {
  if (status === "CONFIRMED") {
    return "Confirm";
  }

  if (status === "ARRIVED") {
    return "Mark Arrived";
  }

  if (status === "NO_SHOW") {
    return "No Show";
  }

  return "Cancel";
}

function formatReminderStatus(reminder?: {
  deliveredAt: Date | null;
  errorMessage: string | null;
  nextAttemptAt: Date | null;
  queuedAt: Date;
  readAt: Date | null;
  sentAt: Date | null;
  status: string;
}) {
  if (!reminder) {
    return "Not scheduled";
  }

  if (reminder.status === "QUEUED") {
    return `Scheduled for ${(reminder.nextAttemptAt ?? reminder.queuedAt).toLocaleString()}`;
  }

  if (reminder.status === "READ") {
    return `Read ${reminder.readAt?.toLocaleString() ?? ""}`.trim();
  }

  if (reminder.status === "DELIVERED") {
    return `Delivered ${reminder.deliveredAt?.toLocaleString() ?? ""}`.trim();
  }

  if (reminder.status === "SENT") {
    return `Sent ${reminder.sentAt?.toLocaleString() ?? ""}`.trim();
  }

  if (reminder.status === "FAILED") {
    return reminder.errorMessage
      ? `Failed: ${reminder.errorMessage}`
      : "Failed";
  }

  if (reminder.status === "CANCELLED") {
    return "Cancelled";
  }

  return reminder.status.toLowerCase().replaceAll("_", " ");
}

function vehicleDetails(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  const details = [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  return details ? `- ${details}` : "";
}

async function getAssignedStaffName(appointmentId: string, businessId: string) {
  const rows = await prisma.$queryRaw<Array<{ staffName: string | null }>>`
    SELECT u."name" AS "staffName"
    FROM "appointments" a
    LEFT JOIN "users" u ON u."id" = a."assigned_staff_id"
    WHERE a."business_id" = ${businessId}::uuid
      AND a."id" = ${appointmentId}::uuid
    LIMIT 1
  `;

  return rows[0]?.staffName ?? null;
}

async function getServiceNames(serviceIds: string[], businessId: string) {
  const services = await prisma.service.findMany({
    where: {
      businessId,
      id: { in: serviceIds },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      name: true,
    },
  });

  return services.map((service) => service.name);
}
