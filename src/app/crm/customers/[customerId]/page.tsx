import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CustomerPackagePurchaseForm } from "@/components/customer-package-purchase-form";
import { requireCrmUser } from "@/lib/auth/crm";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { purchasePackageAction } from "@/app/packages/actions";

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

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{customer.name}</h1>
            <p>{customer.phone}</p>
          </div>
          <div className="inline-actions">
            <Link className="button-link" href={`/crm/customers/${customer.id}/edit`}>
              Edit Customer
            </Link>
            <Link className="secondary-link-button" href="/crm">
              Back to CRM
            </Link>
            <Link className="secondary-link-button" href="/crm/customers">
              Back to customers
            </Link>
          </div>
        </div>

        <div className="grid">
          <Info label="Email" value={customer.email || "No email"} />
          <Info label="Notes" value={customer.notes || "No notes"} />
          <Info
            label="Active package balance"
            value={`${customer.customerPackages
              .filter((customerPackage) => customerPackage.status === "ACTIVE")
              .reduce(
                (total, customerPackage) => total + customerPackage.remainingUses,
                0,
              )} washes`}
          />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Vehicles</h2>
            <Link
              className="button-link"
              href={`/crm/vehicles/new?customerId=${customer.id}`}
            >
              New Vehicle
            </Link>
          </div>

          {customer.vehicles.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Vehicle</th>
                  <th>Branch</th>
                  <th>Color</th>
                  <th>Ownership</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {customer.vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>{vehicle.plateNumber}</td>
                    <td>
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                        "No details"}
                    </td>
                    <td>{vehicle.branch?.name ?? "All branches"}</td>
                    <td>{vehicle.color || "No color"}</td>
                    <td>
                      {vehicle.ownershipHistories.length
                        ? `${vehicle.ownershipHistories.length} transfer(s)`
                        : "Current owner"}
                    </td>
                    <td>{vehicle.notes || "No notes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No vehicles yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Previous ownership</h2>
          </div>

          {customer.previousVehicleOwnerships.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Transferred to</th>
                  <th>Date</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {customer.previousVehicleOwnerships.map((history) => (
                  <tr key={history.id}>
                    <td>{history.vehicle.plateNumber}</td>
                    <td>
                      {history.newCustomer.name} - {history.newCustomer.phone}
                    </td>
                    <td>{history.transferredAt.toLocaleString()}</td>
                    <td>{history.notes || "No notes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No previous vehicle ownership records.</p>
          )}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Packages</h2>
            <Link className="button-link" href="/packages/new">
              New Package
            </Link>
          </div>

          {customer.customerPackages.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Price</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Purchased</th>
                </tr>
              </thead>
              <tbody>
                {customer.customerPackages.map((customerPackage) => (
                  <tr key={customerPackage.id}>
                    <td>{customerPackage.package.name}</td>
                    <td>{Number(customerPackage.purchasePrice).toFixed(2)}</td>
                    <td>
                      {customerPackage.remainingUses}/{customerPackage.totalUses} washes
                    </td>
                    <td>{formatStatus(customerPackage.status)}</td>
                    <td>{customerPackage.purchasedAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No package purchases yet.</p>
          )}

          <h2>Sell prepaid package</h2>
          <CustomerPackagePurchaseForm
            action={purchasePackageAction}
            customerId={customer.id}
            packages={packages}
            branches={branches}
            selectedBranchId={customer.branchId}
          />
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

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
