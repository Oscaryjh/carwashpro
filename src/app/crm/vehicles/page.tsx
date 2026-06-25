import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type VehiclesPageProps = {
  searchParams: Promise<{
    plate?: string;
  }>;
};

export default async function VehiclesPage({ searchParams }: VehiclesPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { plate } = await searchParams;
  const normalizedPlate = plate ? normalizePlateNumber(plate) : "";

  const vehicles = await prisma.vehicle.findMany({
    where: {
      businessId,
      ...(normalizedPlate
        ? {
            plateNumber: {
              contains: normalizedPlate,
              mode: "insensitive",
            },
          }
        : {}),
    },
    include: {
      branch: true,
      customer: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Vehicles</h1>
            <p>Search and view vehicles for this business.</p>
          </div>
          <Link className="button-link" href="/crm/vehicles/new">
            New Vehicle
          </Link>
        </div>

        <div className="panel">
          <form className="search-form" action="/crm/vehicles">
            <input
              name="plate"
              placeholder="Search plate number"
              defaultValue={normalizedPlate}
            />
            <button type="submit">Search</button>
          </form>
        </div>

        <div className="panel">
          {vehicles.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Vehicle</th>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th>Color</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>{vehicle.plateNumber}</td>
                    <td>
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                        "No details"}
                    </td>
                    <td>{vehicle.customer.name}</td>
                    <td>{vehicle.branch?.name ?? "All branches"}</td>
                    <td>{vehicle.color || "No color"}</td>
                    <td>
                      <Link href={`/crm/customers/${vehicle.customer.id}`}>
                        View customer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No vehicles found.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
