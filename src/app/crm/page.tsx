import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type CrmPageProps = {
  searchParams: Promise<{
    plate?: string;
  }>;
};

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const { user, businessId } = await requireCrmUser();
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

  const [customerCount, vehicleCount] = await Promise.all([
    prisma.customer.count({ where: { businessId } }),
    prisma.vehicle.count({ where: { businessId } }),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>CRM</h1>
            <p>Find a vehicle, then open the linked customer profile.</p>
          </div>
        </div>

        <div className="grid">
          <Metric label="Customers" value={customerCount} />
          <Metric label="Vehicles" value={vehicleCount} />
        </div>

        <div className="panel">
          <h2>Search by plate</h2>
          <form className="search-form" action="/crm">
            <input
              name="plate"
              placeholder="Enter plate number"
              defaultValue={normalizedPlate}
            />
            <button type="submit">Search</button>
          </form>

          {normalizedPlate ? (
            vehicle ? (
              <div className="result-box">
                <strong>{vehicle.plateNumber}</strong>
                <span>
                  {vehicle.brand || "No brand"} {vehicle.model || ""}
                </span>
                <Link href={`/crm/customers/${vehicle.customer.id}`}>
                  View customer: {vehicle.customer.name}
                </Link>
              </div>
            ) : (
              <div className="result-box">
                <strong>No vehicle found for {normalizedPlate}</strong>
                <div className="inline-actions">
                  <Link href="/crm/customers/new">Create customer</Link>
                  <Link href="/crm/vehicles/new">Create vehicle</Link>
                </div>
              </div>
            )
          ) : null}
        </div>

        <div className="grid">
          <Link className="panel action-panel" href="/crm/customers">
            <strong>Customers</strong>
            <span>View or add customer profiles.</span>
          </Link>
          <Link className="panel action-panel" href="/crm/vehicles">
            <strong>Vehicles</strong>
            <span>View vehicles and search plate numbers.</span>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
