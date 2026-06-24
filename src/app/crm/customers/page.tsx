import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";

export default async function CustomersPage() {
  const { user, businessId } = await requireCrmUser();
  const customers = await prisma.customer.findMany({
    where: { businessId },
    include: {
      _count: {
        select: { vehicles: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Customers</h1>
            <p>Customer records for this business only.</p>
          </div>
          <Link className="button-link" href="/crm/customers/new">
            New Customer
          </Link>
        </div>

        <div className="panel">
          {customers.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Vehicles</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>{customer.phone}</td>
                    <td>{customer.email || "No email"}</td>
                    <td>{customer._count.vehicles}</td>
                    <td>
                      <Link href={`/crm/customers/${customer.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No customers yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
