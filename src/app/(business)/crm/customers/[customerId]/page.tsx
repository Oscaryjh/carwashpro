import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { DeleteCustomerForm } from "@/components/delete-customer-form";
import {
  authorizedCustomerPackageBranchWhere,
  authorizedOperationalBranchWhere,
} from "@/lib/branches";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type CustomerDetailsPageProps = {
  params: Promise<{
    customerId: string;
  }>;
  searchParams: Promise<{
    appointmentPage?: string;
  }>;
};

const APPOINTMENTS_PER_PAGE = 8;

export default async function CustomerDetailsPage({
  params,
  searchParams,
}: CustomerDetailsPageProps) {
  const context = await requireBusinessIndustryContext("VIEW_CRM");
  const { user, businessId } = context;
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
  const packageBranchWhere = authorizedCustomerPackageBranchWhere(user);
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const { customerId } = await params;
  const query = await searchParams;
  const requestedAppointmentPage = Math.max(
    1,
    Number.parseInt(query.appointmentPage ?? "1", 10) || 1,
  );
  const appointmentCount = await prisma.appointment.count({
    where: { businessId, customerId, ...operationalBranchWhere },
  });
  const appointmentPageCount = Math.max(
    1,
    Math.ceil(appointmentCount / APPOINTMENTS_PER_PAGE),
  );
  const appointmentPage = Math.min(
    requestedAppointmentPage,
    appointmentPageCount,
  );

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      businessId,
    },
    include: {
      vehicles: {
        include: {
          branch: true,
          ownershipHistories: {
            where: operationalBranchWhere,
            include: {
              previousCustomer: true,
              newCustomer: true,
            },
            orderBy: { transferredAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      previousVehicleOwnerships: {
        where: operationalBranchWhere,
        include: {
          vehicle: true,
          newCustomer: true,
        },
        orderBy: { transferredAt: "desc" },
      },
      customerPackages: {
          where: packageBranchWhere,
          include: {
            package: true,
            serviceBalances: {
              include: { service: true },
              orderBy: { createdAt: "asc" },
            },
        },
        orderBy: { purchasedAt: "desc" },
      },
      membership: true,
      appointments: {
        where: operationalBranchWhere,
        include: {
          service: true,
          assignedStaff: true,
          invoice: {
            include: {
              items: true,
              payments: {
                where: { status: "ACTIVE", ...operationalBranchWhere },
                orderBy: { paidAt: "desc" },
              },
            },
          },
        },
        orderBy: { scheduledAt: "desc" },
        skip: (appointmentPage - 1) * APPOINTMENTS_PER_PAGE,
        take: APPOINTMENTS_PER_PAGE,
      },
      invoices: {
        where: operationalBranchWhere,
        include: {
          items: true,
          payments: {
            where: { status: "ACTIVE", ...operationalBranchWhere },
            orderBy: { paidAt: "desc" },
          },
        },
        orderBy: { issuedAt: "desc" },
        take: 50,
      },
      workOrders: {
        where: operationalBranchWhere,
        include: {
          branch: true,
          vehicle: true,
          items: true,
          invoice: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!customer) {
    notFound();
  }

  const activePackageBalance = customer.customerPackages
    .filter((customerPackage) => customerPackage.status === "ACTIVE")
    .reduce(
      (total, customerPackage) => total + customerPackage.remainingUses,
      0,
    );
  const serviceIds = Array.from(
    new Set(
      customer.appointments.flatMap((appointment) => [
        appointment.serviceId,
        ...appointment.serviceIds,
      ]).filter((serviceId): serviceId is string => Boolean(serviceId)),
    ),
  );
  const services = serviceIds.length
    ? await prisma.service.findMany({
        where: { businessId, id: { in: serviceIds } },
        select: { id: true, name: true },
      })
    : [];
  const serviceNamesById = new Map(services.map((service) => [service.id, service.name]));
  const totalSpent = customer.invoices
    .filter((invoice) => invoice.status !== "VOID")
    .reduce((total, invoice) => total + Number(invoice.paidAmount), 0);
  const canViewLoyaltyActivity = hasStaffPermission(user, "LOYALTY");
  const canDeleteCustomer = hasStaffPermission(user, "DELETE_CUSTOMER");

  return (
    <>
      <section className="content customer-detail-content">
        <div className="page-header">
          <div>
            <h1>{customer.name}</h1>
            <p>{customer.phone}</p>
          </div>
          <div className="inline-actions">
            <Link className="button-link" href={`/crm/customers/${customer.id}/edit`}>
              Edit
            </Link>
            <BackButton fallbackHref="/crm" />
          </div>
        </div>

        <div className="customer-summary-grid">
          <InfoCard label="Email" value={customer.email || "No email"} />
          <InfoCard
            label="Date of birth"
            value={
              customer.dateOfBirth
                ? new Intl.DateTimeFormat("en-MY", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(customer.dateOfBirth)
                : "Not provided"
            }
          />
          <InfoCard
            label={isSalonBusiness ? "Appointments" : "Vehicles"}
            value={isSalonBusiness ? appointmentCount : customer.vehicles.length}
          />
          <InfoCard
            label="Package balance"
            value={`${activePackageBalance} ${isSalonBusiness ? "uses" : "washes"}`}
          />
          <InfoCard label="Total spent" value={formatCurrency(totalSpent)} />
          <div className="customer-info-card customer-loyalty-summary">
            <span>Loyalty points</span>
            <strong>
              {customer.membership ? `${customer.membership.pointsBalance} pts` : "Not enrolled"}
            </strong>
            <div className="customer-loyalty-meta">
              <small>
                {customer.membership ? formatStatus(customer.membership.status) : "No membership"}
              </small>
              {customer.membership && canViewLoyaltyActivity ? (
                <Link href={`/loyalty/activity?q=${encodeURIComponent(customer.phone)}`}>
                  View activity
                </Link>
              ) : null}
            </div>
          </div>
          <InfoCard label="Notes" value={customer.notes || "No notes"} />
          <InfoCard label="Preferences" value={customer.preferences || "No preferences"} />
          <InfoCard
            label="Treatment notes"
            value={customer.treatmentNotes || "No treatment notes"}
          />
        </div>

        {!isSalonBusiness ? (
          <div className="panel customer-section-panel">
            <div className="section-header">
              <h2>Vehicles</h2>
              <Link
                className="button-link"
                href={`/crm/vehicles/new?customerId=${customer.id}`}
              >
                Add Vehicle
              </Link>
            </div>

            {customer.vehicles.length ? (
              <div className="customer-vehicle-grid">
                {customer.vehicles.map((vehicle) => (
                  <Link
                    className="customer-vehicle-card"
                    href={`/crm/vehicles/${vehicle.id}`}
                    key={vehicle.id}
                  >
                    <div className="customer-vehicle-title">
                      <strong>{vehicle.plateNumber}</strong>
                      <span>{vehicleLabel(vehicle)}</span>
                    </div>
                    <small>{vehicle.branch?.name ?? "All branches"}</small>
                    <div className="customer-card-meta">
                      <span>{vehicle.color || "No color"}</span>
                      <span>
                        {vehicle.ownershipHistories.length
                          ? `${vehicle.ownershipHistories.length} transfer`
                          : "Current owner"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty-state">No vehicles yet.</p>
            )}
          </div>
        ) : null}

        <div className="panel customer-section-panel">
          <div className="section-header">
            <h2>Service history</h2>
          </div>
          {customer.workOrders.length ? (
            <div className="customer-history-list">
              {customer.workOrders.map((workOrder) => (
                <div className="customer-history-row" key={workOrder.id}>
                  <div>
                    <Link href={`/work-orders/${workOrder.id}`}>
                      {workOrder.orderNumber}
                    </Link>
                    <span>
                      {workOrder.items.map((item) => `${item.name} x${item.quantity}`).join(", ") ||
                        "No service items"}
                    </span>
                  </div>
                  <small>
                    {isSalonBusiness
                      ? `${formatStatus(workOrder.status)} · ${formatCurrency(workOrder.total)}`
                      : `${workOrder.vehicle.plateNumber} · ${formatStatus(workOrder.status)} · ${formatCurrency(workOrder.total)}`}
                    <br />
                    {formatDateTime(workOrder.createdAt)}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No service history yet.</p>
          )}
        </div>

        <div className="customer-two-column">
          <div className="panel customer-section-panel" id="appointment-history">
            <div className="section-header">
              <div>
                <h2>Appointment history</h2>
                <p className="customer-section-subtitle">
                  {appointmentCount
                    ? `${appointmentCount} appointment${appointmentCount === 1 ? "" : "s"}`
                    : "Customer booking records"}
                </p>
              </div>
            </div>
            {customer.appointments.length ? (
              <>
                <div className="customer-history-list customer-appointment-history-list">
                  {customer.appointments.map((appointment) => (
                    <article className="customer-appointment-history-row" key={appointment.id}>
                      <div className="customer-appointment-history-main">
                        <Link href={`/appointments/${appointment.id}`}>
                          {appointmentServiceNames(appointment, serviceNamesById)}
                        </Link>
                        <span>{appointment.assignedStaff?.name ?? "Unassigned"}</span>
                      </div>
                      <span className={`customer-appointment-status is-${appointment.status.toLowerCase()}`}>
                        {formatStatus(appointment.status)}
                      </span>
                      <time dateTime={appointment.scheduledAt.toISOString()}>
                        {formatDateTime(appointment.scheduledAt)}
                      </time>
                    </article>
                  ))}
                </div>
                <HistoryPagination
                  customerId={customer.id}
                  page={appointmentPage}
                  pageCount={appointmentPageCount}
                  total={appointmentCount}
                />
              </>
            ) : (
              <p className="empty-state">No appointment history yet.</p>
            )}
          </div>

          <div className="panel customer-section-panel">
            <div className="section-header">
              <h2>Spending history</h2>
            </div>
            {customer.invoices.length ? (
              <div className="customer-history-list">
                {customer.invoices.map((invoice) => (
                  <div className="customer-history-row" key={invoice.id}>
                    <div>
                      <Link href={`/invoices/${invoice.id}`}>{invoice.invoiceNumber}</Link>
                      <span>{formatStatus(invoice.status)} · RM{Number(invoice.total).toFixed(2)}</span>
                    </div>
                    <small>{formatDateTime(invoice.issuedAt)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No spending history yet.</p>
            )}
          </div>
        </div>

        <div className="customer-two-column">
          <div className="panel customer-section-panel">
            <div className="section-header">
              <h2>Packages</h2>
            </div>

            {customer.customerPackages.length ? (
              <div className="customer-package-card-grid">
                {customer.customerPackages.map((customerPackage) => (
                  <article className="customer-owned-package-card" key={customerPackage.id}>
                    <div>
                      <strong>{customerPackage.package.name}</strong>
                      <span>{formatStatus(customerPackage.status)}</span>
                    </div>
                    <div className="customer-package-balance">
                      <strong>
                        {customerPackage.remainingUses}/{customerPackage.totalUses}
                      </strong>
                      <span>{isSalonBusiness ? "uses left" : "washes left"}</span>
                    </div>
                      <small>
                        RM{Number(customerPackage.purchasePrice).toFixed(2)} /{" "}
                        {customerPackage.purchasedAt.toLocaleDateString("en-MY")}
                      </small>
                      {isSalonBusiness && customerPackage.serviceBalances.length ? (
                        <div className="customer-package-service-balances">
                          {customerPackage.serviceBalances.map((balance) => (
                            <span key={balance.id}>
                              {balance.service.name}
                              <strong>{balance.remainingUses}/{balance.totalUses}</strong>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No package purchases yet.</p>
            )}
          </div>

        </div>

        {!isSalonBusiness ? (
          <div className="panel customer-section-panel">
            <div className="section-header">
              <h2>Previous ownership</h2>
            </div>

            {customer.previousVehicleOwnerships.length ? (
              <div className="customer-history-list">
                {customer.previousVehicleOwnerships.map((history) => (
                  <div className="customer-history-row" key={history.id}>
                    <Link href={`/crm/vehicles/${history.vehicle.id}`}>
                      {history.vehicle.plateNumber}
                    </Link>
                    <span>
                      Transferred to {history.newCustomer.name} -{" "}
                      {history.newCustomer.phone}
                    </span>
                    <small>{history.transferredAt.toLocaleString("en-MY")}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No previous vehicle ownership records.</p>
            )}
          </div>
        ) : null}

        {canDeleteCustomer ? (
          <div className="panel danger-zone customer-section-panel">
            <div className="section-header">
              <h2>Delete customer</h2>
            </div>
            <p className="muted">
              {isSalonBusiness
                ? "Customers with appointments or packages cannot be deleted."
                : "Customers with jobs, packages, vehicle ownership history, or vehicle history cannot be deleted."}
            </p>
            <DeleteCustomerForm
              customerId={customer.id}
              customerName={customer.name}
            />
          </div>
        ) : null}
      </section>
    </>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="customer-info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryPagination({
  customerId,
  page,
  pageCount,
  total,
}: {
  customerId: string;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return null;
  }

  const first = (page - 1) * APPOINTMENTS_PER_PAGE + 1;
  const last = Math.min(page * APPOINTMENTS_PER_PAGE, total);
  const pageHref = (targetPage: number) =>
    `/crm/customers/${customerId}?appointmentPage=${targetPage}#appointment-history`;

  return (
    <nav className="customer-history-pagination" aria-label="Appointment history pages">
      <span>
        {first}-{last} of {total}
      </span>
      <div>
        {page > 1 ? (
          <Link href={pageHref(page - 1)}>Previous</Link>
        ) : (
          <span aria-disabled="true">Previous</span>
        )}
        <strong>
          {page} / {pageCount}
        </strong>
        {page < pageCount ? (
          <Link href={pageHref(page + 1)}>Next</Link>
        ) : (
          <span aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}

function vehicleLabel(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
    vehicle.color ||
    "No vehicle details";
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function appointmentServiceNames(
  appointment: {
    service: { name: string } | null;
    serviceId: string | null;
    serviceIds: string[];
  },
  serviceNamesById: Map<string, string>,
) {
  const names = [
    appointment.service?.name,
    ...(appointment.serviceIds ?? []).map((serviceId) => serviceNamesById.get(serviceId)),
    appointment.serviceId ? serviceNamesById.get(appointment.serviceId) : null,
  ].filter((name): name is string => Boolean(name));

  return Array.from(new Set(names)).join(", ") || "Consultation / service not selected";
}

function formatCurrency(value: number | { toString(): string }) {
  return `RM${Number(value).toFixed(2)}`;
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
