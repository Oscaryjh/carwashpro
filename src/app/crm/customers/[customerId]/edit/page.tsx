import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CustomerForm } from "@/components/customer-form";
import { VehicleForm } from "@/components/vehicle-form";
import { requireCrmUser } from "@/lib/auth/crm";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { updateCustomerAction, updateVehicleAction } from "../../../actions";

type EditCustomerPageProps = {
  params: Promise<{
    customerId: string;
  }>;
};

export default async function EditCustomerPage({
  params,
}: EditCustomerPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { customerId } = await params;

  const [customer, branches] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        id: customerId,
        businessId,
      },
      include: {
        vehicles: {
          include: {
            branch: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    getActiveBranches(businessId),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Edit Customer Profile</h1>
            <p>Update customer contact details and linked vehicles in one place.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href={`/crm/customers/${customer.id}`}>
              Back to customer
            </Link>
            <Link className="secondary-link-button" href="/crm">
              Back to CRM
            </Link>
          </div>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Customer details</h2>
          </div>
          <CustomerForm
            action={updateCustomerAction}
            branches={branches}
            customer={customer}
            mode="edit"
          />
        </div>

        <div className="panel">
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
            <div className="service-list">
              {customer.vehicles.map((vehicle) => (
                <div className="inline-editor" key={vehicle.id}>
                  <h3>{vehicle.plateNumber}</h3>
                  <VehicleForm
                    action={updateVehicleAction}
                    branches={branches}
                    customers={[customer]}
                    vehicle={vehicle}
                    mode="edit"
                    lockCustomer
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No vehicles yet. Add the first vehicle for this customer.
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
