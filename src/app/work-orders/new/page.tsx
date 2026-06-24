import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { WorkOrderForm } from "@/components/work-order-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";
import { createWorkOrderAction } from "../actions";

type NewWorkOrderPageProps = {
  searchParams: Promise<{
    plate?: string;
  }>;
};

export default async function NewWorkOrderPage({
  searchParams,
}: NewWorkOrderPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { plate } = await searchParams;
  const normalizedPlate = plate ? normalizePlateNumber(plate) : "";

  const vehicle = normalizedPlate
    ? await prisma.vehicle.findFirst({
        where: {
          businessId,
          plateNumber: normalizedPlate,
        },
        include: {
          customer: true,
        },
      })
    : null;

  const services = await prisma.service.findMany({
    where: {
      businessId,
      status: "ACTIVE",
    },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Work Order</h1>
            <p>Search a plate, choose services, then create a waiting order.</p>
          </div>
          <Link href="/work-orders">Back to work orders</Link>
        </div>

        <div className="panel">
          <h2>Find vehicle</h2>
          <form className="search-form" action="/work-orders/new">
            <input
              name="plate"
              placeholder="Enter plate number"
              defaultValue={normalizedPlate}
            />
            <button type="submit">Search</button>
          </form>
        </div>

        {normalizedPlate ? (
          vehicle ? (
            services.length ? (
              <WorkOrderForm
                action={createWorkOrderAction}
                vehicle={vehicle}
                services={services}
              />
            ) : (
              <div className="panel">
                <p className="empty-state">Create an active service first.</p>
                <Link className="button-link" href="/services/new">
                  New Service
                </Link>
              </div>
            )
          ) : (
            <div className="panel">
              <p className="empty-state">No vehicle found for {normalizedPlate}.</p>
              <div className="inline-actions">
                <Link href="/crm/customers/new">Create customer</Link>
                <Link href="/crm/vehicles/new">Create vehicle</Link>
              </div>
            </div>
          )
        ) : null}
      </section>
    </AppShell>
  );
}
