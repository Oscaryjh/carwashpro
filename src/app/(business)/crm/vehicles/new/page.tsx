import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { VehicleForm } from "@/components/vehicle-form";
import { requireCrmUser } from "@/lib/auth/crm";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createVehicleAction } from "../../actions";

type NewVehiclePageProps = {
  searchParams: Promise<{
    customerId?: string;
  }>;
};

export default async function NewVehiclePage({
  searchParams,
}: NewVehiclePageProps) {
  const { businessId } = await requireCrmUser();
  const { customerId } = await searchParams;

  const [customers, branches] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId },
      select: {
        id: true,
        name: true,
        phone: true,
        branchId: true,
      },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
  ]);

  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const selectedCustomerId = selectedCustomer?.id;

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Vehicle</h1>
            <p>Add a vehicle and link it to an existing customer.</p>
          </div>
          <BackButton fallbackHref="/crm/vehicles" />
        </div>

        <div className="panel">
          {customers.length ? (
            <VehicleForm
              action={createVehicleAction}
              customers={customers}
              branches={branches}
              selectedCustomerId={selectedCustomerId}
              selectedBranchId={selectedCustomer?.branchId}
            />
          ) : (
            <div className="empty-state">
              <p>Create a customer before adding a vehicle.</p>
              <Link className="button-link" href="/crm/customers/new">
                New Customer
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
