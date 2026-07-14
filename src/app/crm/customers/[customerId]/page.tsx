import Link from "next/link";
import { notFound } from "next/navigation";
import { purchasePackageAction } from "@/app/packages/actions";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { CustomerPackagePurchaseForm } from "@/components/customer-package-purchase-form";
import { DeleteCustomerForm } from "@/components/delete-customer-form";
import { getActiveBranches } from "@/lib/branches";
import { requireCrmUser } from "@/lib/auth/crm";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type CustomerDetailsPageProps = {
  params: Promise<{
    customerId: string;
  }>;
};

export default async function CustomerDetailsPage({
  params,
}: CustomerDetailsPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { customerId } = await params;

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
        include: {
          vehicle: true,
          newCustomer: true,
        },
        orderBy: { transferredAt: "desc" },
      },
      customerPackages: {
        include: {
          package: true,
        },
        orderBy: { purchasedAt: "desc" },
      },
      membership: true,
    },
  });

  if (!customer) {
    notFound();
  }

  const [packages, branches] = await Promise.all([
    prisma.package.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
  ]);

  const activePackageBalance = customer.customerPackages
    .filter((customerPackage) => customerPackage.status === "ACTIVE")
    .reduce(
      (total, customerPackage) => total + customerPackage.remainingUses,
      0,
    );
  const canViewLoyaltyActivity = hasStaffPermission(user, "LOYALTY");

  return (
    <AppShell user={user}>
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
          <InfoCard label="Vehicles" value={customer.vehicles.length} />
          <InfoCard label="Package balance" value={`${activePackageBalance} washes`} />
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
        </div>

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
                      <span>washes left</span>
                    </div>
                    <small>
                      RM{Number(customerPackage.purchasePrice).toFixed(2)} /{" "}
                      {customerPackage.purchasedAt.toLocaleDateString("en-MY")}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No package purchases yet.</p>
            )}
          </div>

          <div className="panel customer-section-panel customer-sell-package-panel">
            <div className="section-header">
              <h2>Sell package</h2>
            </div>
            <CustomerPackagePurchaseForm
              action={purchasePackageAction}
              customerId={customer.id}
              packages={packages}
              branches={branches}
              selectedBranchId={customer.branchId}
            />
          </div>
        </div>

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
                  <small>{history.transferredAt.toLocaleString()}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No previous vehicle ownership records.</p>
          )}
        </div>

        <div className="panel danger-zone customer-section-panel">
          <div className="section-header">
            <h2>Delete customer</h2>
          </div>
          <p className="muted">
            Customers with jobs, packages, vehicle ownership history, or vehicle
            history cannot be deleted.
          </p>
          <DeleteCustomerForm
            customerId={customer.id}
            customerName={customer.name}
          />
        </div>
      </section>
    </AppShell>
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
