import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
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
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{customer.name}</h1>
            <p>{customer.phone}</p>
          </div>
          <Link href="/crm/customers">Back to customers</Link>
        </div>

        <div className="grid">
          <Info label="Email" value={customer.email || "No email"} />
          <Info label="Notes" value={customer.notes || "No notes"} />
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
                  <th>Color</th>
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
                    <td>{vehicle.color || "No color"}</td>
                    <td>{vehicle.notes || "No notes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No vehicles yet.</p>
          )}
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
