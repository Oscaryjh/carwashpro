import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { SalonAppointmentCheckoutModal } from "@/components/salon-appointment-checkout-modal";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  formatDateValue,
  toBusinessDateValue,
  toBusinessTimeValue,
} from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import {
  canMoveAppointmentStatus,
  formatAppointmentStatus,
} from "@/lib/validation/appointments";
import {
  addAppointmentServicesAction,
  convertAppointmentToJobAction,
  updateAppointmentStatusAction,
} from "../actions";

type AppointmentDetailPageProps = {
  params: Promise<{
    appointmentId: string;
  }>;
  searchParams: Promise<{
    legacy?: string;
  }>;
};

export default async function AppointmentDetailPage({
  params,
  searchParams,
}: AppointmentDetailPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();
  const { appointmentId } = await params;
  const { legacy } = await searchParams;
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      business: {
        select: { sstEnabled: true, sstLabel: true, sstRate: true },
      },
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

  if (legacy !== "1") {
    const query = new URLSearchParams({
      appointment: appointment.id,
      date: toBusinessDateValue(appointment.scheduledAt),
      page: "1",
      status: "active",
    });

    redirect(`/appointments?${query.toString()}`);
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
  const canAddSalonServices =
    industryType === "SALON_BEAUTY" &&
    ["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE"].includes(appointment.status) &&
    !appointment.invoice;
  const availableServices = canAddSalonServices
    ? await prisma.service.findMany({
        where: { businessId, status: "ACTIVE" },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, category: true, name: true, price: true },
      })
    : [];
  const selectedServiceIds = new Set(selectedServices.map((service) => service.id));
  const serviceTotal = selectedServices.reduce(
    (sum, service) => sum + Number(service.price),
    0,
  );
  const projectedSalonTax = calculateTax({
    sstEnabled: appointment.business.sstEnabled,
    sstLabel: appointment.business.sstLabel,
    sstRate: Number(appointment.business.sstRate),
    lines: selectedServices.map((service) => ({
      lineTotal: Number(service.price),
      taxable: service.taxable,
      taxRate: service.taxRate == null ? null : Number(service.taxRate),
    })),
  });
  const salonInvoice = industryType === "SALON_BEAUTY" ? appointment.invoice : null;
  const salonBalance = salonInvoice
    ? Number(salonInvoice.balance)
    : projectedSalonTax.total;
  const canTakeSalonPayment =
    industryType === "SALON_BEAUTY" &&
    appointment.status === "COMPLETED" &&
    selectedServices.length > 0 &&
    salonBalance > 0;
  const canOpenSalonCheckout =
    industryType === "SALON_BEAUTY" &&
    appointment.status === "COMPLETED" &&
    selectedServices.length > 0;
  const hasOpenShift = Boolean(
    await prisma.cashierShift.findFirst({
      where: {
        businessId,
        cashierId: user.userId,
        status: "OPEN",
      },
      select: { id: true },
    }),
  );
  const availableCustomerPackages = industryType === "SALON_BEAUTY" && !salonInvoice
    ? await prisma.customerPackage.findMany({
        where: {
          businessId,
          customerId: appointment.customerId,
          remainingUses: { gt: 0 },
          status: "ACTIVE",
          OR: [
            { branchId: null },
            ...(appointment.branchId ? [{ branchId: appointment.branchId }] : []),
          ],
          package: {
            status: "ACTIVE",
            serviceId: { in: selectedServices.map((service) => service.id) },
          },
        },
        include: { package: { include: { service: true } } },
        orderBy: [{ purchasedAt: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const catalogDiscounts = await prisma.catalogDiscount.findMany({
    where: {
      businessId,
      active: true,
      OR: [
        { branchId: null },
        ...(appointment.branchId ? [{ branchId: appointment.branchId }] : []),
      ],
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      ],
    },
    orderBy: [{ name: "asc" }],
  });
  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{appointment.customer.name}</h1>
            <p>
              {industryType !== "SALON_BEAUTY" && appointment.vehicle
                ? `${appointment.vehicle.plateNumber} / `
                : ""}
              {formatBusinessDateTime(appointment.scheduledAt)}
            </p>
          </div>
          <BackButton fallbackHref="/appointments" />
        </div>

        <div className="grid">
          <Info label="Status" value={formatAppointmentStatus(appointment.status)} />
          <Info label="Branch" value={appointment.branch?.name ?? "All branches"} />
          <Info label="Customer" value={`${appointment.customer.name} - ${appointment.customer.phone}`} />
          {industryType !== "SALON_BEAUTY" && appointment.vehicle ? (
            <Info
              label="Vehicle"
              value={`${appointment.vehicle.plateNumber} ${vehicleDetails(appointment.vehicle)}`}
            />
          ) : null}
          <Info label="Service" value={serviceNames.join(", ") || "Not selected"} />
          <Info label="Staff" value={assignedStaffName ?? "Unassigned"} />
          <Info
            label="Scheduled"
            value={formatBusinessDateTime(appointment.scheduledAt)}
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
              ...(industryType === "SALON_BEAUTY" ? (["COMPLETED"] as const) : []),
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
                {industryType === "SALON_BEAUTY" ? "Open service order" : "Open Job"}
              </Link>
            ) : canConvert ? (
              <form action={convertAppointmentToJobAction}>
                <input type="hidden" name="appointmentId" value={appointment.id} />
                <button type="submit">
                  Create Job
                </button>
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
          <>
            {canAddSalonServices ? (
              <div className="panel salon-add-service-panel">
                <div className="section-header">
                  <div>
                    <h2>Add services</h2>
                    <p className="muted">Add extra services while the customer is being served.</p>
                  </div>
                </div>
                {availableServices.filter((service) => !selectedServiceIds.has(service.id)).length ? (
                  <form action={addAppointmentServicesAction} className="salon-add-service-form">
                    <input type="hidden" name="appointmentId" value={appointment.id} />
                    <div className="salon-add-service-list">
                      {availableServices.map((service) => (
                        <label className={`salon-add-service-option${selectedServiceIds.has(service.id) ? " is-selected" : ""}`} key={service.id}>
                          <input
                            defaultChecked={false}
                            disabled={selectedServiceIds.has(service.id)}
                            name="serviceIds"
                            type="checkbox"
                            value={service.id}
                          />
                          <span>
                            <strong>{service.name}</strong>
                            <small>{service.category || "Service"}</small>
                          </span>
                          <b>RM{Number(service.price).toFixed(2)}</b>
                        </label>
                      ))}
                    </div>
                    <button type="submit">Add selected services</button>
                  </form>
                ) : (
                  <p className="empty-state">All active services are already included.</p>
                )}
              </div>
            ) : null}
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

              {canOpenSalonCheckout ? (
                <SalonAppointmentCheckoutModal
                  appointmentId={appointment.id}
                  availablePackages={availableCustomerPackages.flatMap((customerPackage) =>
                    customerPackage.package.serviceId
                      ? [{
                          id: customerPackage.id,
                          name: customerPackage.package.name,
                          remainingUses: customerPackage.remainingUses,
                          totalUses: customerPackage.totalUses,
                          serviceId: customerPackage.package.serviceId,
                          serviceName: customerPackage.package.service?.name ?? "Service",
                        }]
                      : [],
                  )}
                  balance={salonBalance}
                  catalogDiscounts={catalogDiscounts.map((discount) => ({
                    id: discount.id,
                    name: discount.name,
                    discountType: discount.discountType,
                    percentage: discount.percentage == null ? null : Number(discount.percentage),
                    fixedAmount: discount.fixedAmount == null ? null : Number(discount.fixedAmount),
                    scope: discount.scope,
                    minimumSpend: Number(discount.minimumSpend),
                    maximumDiscount:
                      discount.maximumDiscount == null
                        ? null
                        : Number(discount.maximumDiscount),
                    allowLoyaltyStacking: discount.allowLoyaltyStacking,
                    branchId: discount.branchId,
                  }))}
                  canTakePayment={canTakeSalonPayment}
                  customerName={appointment.customer.name}
                  customerPhone={appointment.customer.phone}
                  hasInvoice={Boolean(salonInvoice)}
                  hasOpenShift={hasOpenShift}
                  initialOpen={false}
                  items={selectedServices.map((service) => ({
                    id: service.id,
                    name: service.name,
                    price: Number(service.price),
                    quantity: 1,
                    type: "service" as const,
                  }))}
                  subtotal={salonInvoice ? Number(salonInvoice.subtotal) : serviceTotal}
                  totalAmount={salonInvoice ? Number(salonInvoice.total) : projectedSalonTax.total}
                  taxLines={selectedServices.map((service) => ({
                    lineTotal: Number(service.price),
                    taxable: service.taxable,
                    taxRate: service.taxRate == null ? null : Number(service.taxRate),
                  }))}
                  sstEnabled={appointment.business.sstEnabled}
                  sstLabel={appointment.business.sstLabel}
                  sstRate={Number(appointment.business.sstRate)}
                />
              ) : salonBalance <= 0 ? (
                <p className="empty-state">This appointment is fully paid.</p>
              ) : selectedServices.length === 0 ? (
                <p className="empty-state">Select at least one service before checkout.</p>
              ) : (
                <p className="empty-state">
                  Complete the service before checkout.
                </p>
              )}

              {salonInvoice?.payments.length ? (
                <div className="pos-payment-history">
                  <h3>Payment history</h3>
                  {salonInvoice.payments.map((payment) => (
                    <div className="pos-history-row" key={payment.id}>
                      <span>{formatBusinessDateTime(payment.paidAt)}</span>
                      <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                      <small>{formatPaymentStatus(payment.method)}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="panel">
          <h2>Notes</h2>
          <p className="muted">{appointment.notes || "No notes."}</p>
        </div>
      </section>
    </>
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

function formatBusinessDateTime(date: Date) {
  const dateLabel = formatDateValue(toBusinessDateValue(date), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const [hourValue, minuteValue] = toBusinessTimeValue(date).split(":").map(Number);
  const period = hourValue >= 12 ? "pm" : "am";
  const hour = hourValue % 12 || 12;

  return `${dateLabel}, ${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
}

function actionLabel(status: string) {
  if (status === "NO_SHOW") {
    return "No Show";
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
    return `Scheduled for ${formatBusinessDateTime(reminder.nextAttemptAt ?? reminder.queuedAt)}`;
  }

  if (reminder.status === "READ") {
    return `Read ${reminder.readAt ? formatBusinessDateTime(reminder.readAt) : ""}`.trim();
  }

  if (reminder.status === "DELIVERED") {
    return `Delivered ${reminder.deliveredAt ? formatBusinessDateTime(reminder.deliveredAt) : ""}`.trim();
  }

  if (reminder.status === "SENT") {
    return `Sent ${reminder.sentAt ? formatBusinessDateTime(reminder.sentAt) : ""}`.trim();
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
      taxable: true,
      taxRate: true,
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
