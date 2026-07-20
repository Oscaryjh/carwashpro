import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type VehiclesPageProps = {
  searchParams: Promise<{
    plate?: string;
  }>;
};

export default async function VehiclesPage({ searchParams }: VehiclesPageProps) {
  const { businessId } = await requireCrmUser();
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
      ownershipHistories: {
        include: {
          previousCustomer: true,
          newCustomer: true,
        },
        orderBy: { transferredAt: "desc" },
        take: 3,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Vehicles</h1>
            <p>Search and view vehicles for this business.</p>
          </div>
          <div className="inline-actions">
            <BackButton fallbackHref="/crm" />
            <Link className="button-link" href="/crm/vehicles/new">
              New Vehicle
            </Link>
          </div>
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
                  <th>Current owner</th>
                  <th>Branch</th>
                  <th>Color</th>
                  <th>Ownership history</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <Link href={`/crm/vehicles/${vehicle.id}`}>
                        {vehicle.plateNumber}
                      </Link>
                    </td>
                    <td>
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                        "No details"}
                    </td>
                    <td>
                      <Link href={`/crm/customers/${vehicle.customer.id}`}>
                        {vehicle.customer.name}
                      </Link>
                      <div className="muted">{vehicle.customer.phone}</div>
                    </td>
                    <td>{vehicle.branch?.name ?? "All branches"}</td>
                    <td>{vehicle.color || "No color"}</td>
                    <td>
                      {vehicle.ownershipHistories.length ? (
                        <div className="stacked-list">
                          {vehicle.ownershipHistories.map((history) => (
                            <span key={history.id}>
                              {history.previousCustomer?.name ?? "Unknown"} to{" "}
                              {history.newCustomer.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "No transfers"
                      )}
                    </td>
                    <td>
                      <Link href={`/crm/vehicles/${vehicle.id}`}>
                        View vehicle
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
    </>
  );
}
