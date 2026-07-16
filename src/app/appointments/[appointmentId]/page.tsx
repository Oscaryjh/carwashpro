import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { SalonAppointmentPaymentForm } from "@/components/salon-appointment-payment-form";
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
  const { user, businessId, industryType } = await requireBusinessUser();
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
      invoice: {
        include: {
          items: {
            orderBy: { createdAt: "asc" },
          },
          payments: {
            where: { status: "ACTIVE" },
            orderBy: { paidAt: "desc" },
          },
        },
      },
    },
  });

  if (!appointment) {
    notFound();
  }

  const canConvert =
    industryType !== "SALON_BEAUTY" &&
    Boolean(appointment.vehicle) &&
    appointment.status !== "CONVERTED_TO_JOB" &&
    appointment.status !== "CANCELLED" &&
    appointment.status !== "NO_SHOW" &&
    Boolean(appointment.service || appointment.serviceIds.length);
  const assignedStaffName = await getAssignedStaffName(appointment.id, businessId);
  const selectedServices = appointment.serviceIds.length
    ? await getServices(appointment.serviceIds, businessId)
    : appointment.service
      ? [appointment.service]
      : [];
  const serviceNames = selectedServices.map((service) => service.name);
  const serviceTotal = selectedServices.reduce(
    (sum, service) => sum + Number(service.price),
    0,
  );
  const salonInvoice = industryType === "SALON_BEAUTY" ? appointment.invoice : null;
  const salonBalance = salonInvoice ? Number(salonInvoice.balance) : serviceTotal;
  const canTakeSalonPayment =
    industryType === "SALON_BEAUTY" &&
    ["ARRIVED", "IN_SERVICE", "COMPLETED"].includes(appointment.status) &&
    selectedServices.length > 0 &&
    salonBalance > 0;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{appointment.customer.name}</h1>
            <p>
              {appointment.vehicle ? `${appointment.vehicle.plateNumber} / ` : ""}
              {appointment.scheduledAt.toLocaleString()}
            </p>
          </div>
          <BackButton fallbackHref="/appointments" />
        </div>

        <div className="grid">
          <Info label="Status" value={formatAppointmentStatus(appointment.status)} />
          <Info label="Branch" value={appointment.branch?.name ?? "All branches"} />
          <Info label="Customer" value={`${appointment.customer.name} - ${appointment.customer.phone}`} />
          {appointment.vehicle ? (
            <Info
              label="Vehicle"
              value={`${appointment.vehicle.plateNumber} ${vehicleDetails(appointment.vehicle)}`}
            />
          ) : null}
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
            {([
              "CONFIRMED",
              "ARRIVED",
              ...(industryType === "SALON_BEAUTY"
                ? (["IN_SERVICE", "COMPLETED"] as const)
                : []),
              "CANCELLED",
              "NO_SHOW",
            ] as const).map(
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
            ) : industryType !== "SALON_BEAUTY" ? (
              <p className="empty-state">
                {appointment.vehicle
                  ? "Choose a service before converting this appointment to a job."
                  : "Choose a vehicle before converting this appointment to a job."}
              </p>
            ) : null}
          </div>
        </div>

        {industryType === "SALON_BEAUTY" ? (
          <div className="panel salon-checkout-panel">
            <div className="section-header">
              <div>
                <h2>Payment</h2>
                <p className="muted">
                  Payment and appointment status are tracked separately.
                </p>
              </div>
              {salonInvoice ? (
                <Link className="secondary-link-button" href={`/invoices/${salonInvoice.id}`}>
                  View invoice
                </Link>
              ) : null}
            </div>

            <div className="grid salon-payment-metrics">
              <Info
                label="Total"
                value={`RM${(salonInvoice ? Number(salonInvoice.total) : serviceTotal).toFixed(2)}`}
              />
              <Info
                label="Paid"
                value={`RM${Number(salonInvoice?.paidAmount ?? 0).toFixed(2)}`}
              />
              <Info label="Balance" value={`RM${salonBalance.toFixed(2)}`} />
              <Info
                label="Payment status"
                value={salonInvoice ? formatPaymentStatus(salonInvoice.status) : "Unpaid"}
              />
            </div>

            {canTakeSalonPayment ? (
              <SalonAppointmentPaymentForm
                appointmentId={appointment.id}
                balance={salonBalance}
              />
            ) : salonBalance <= 0 ? (
              <p className="empty-state">This appointment is fully paid.</p>
            ) : selectedServices.length === 0 ? (
              <p className="empty-state">Select at least one service before checkout.</p>
            ) : (
              <p className="empty-state">
                Mark the customer as arrived before taking payment.
              </p>
            )}

            {salonInvoice?.payments.length ? (
              <div className="pos-payment-history">
                <h3>Payment history</h3>
                {salonInvoice.payments.map((payment) => (
                  <div className="pos-history-row" key={payment.id}>
                    <span>{payment.paidAt.toLocaleString()}</span>
                    <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                    <small>{formatPaymentStatus(payment.method)}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

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

  if (status === "IN_SERVICE") {
    return "Start Service";
  }

  if (status === "COMPLETED") {
    return "Complete Service";
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

async function getServices(serviceIds: string[], businessId: string) {
  const services = await prisma.service.findMany({
    where: {
      businessId,
      id: { in: serviceIds },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      price: true,
    },
  });

  return services;
}

function formatPaymentStatus(status: string) {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
