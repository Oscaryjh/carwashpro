import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type CustomersPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { q } = await searchParams;
  const rawSearch = (q ?? "").trim();
  const normalizedPlate = rawSearch ? normalizePlateNumber(rawSearch) : "";

  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      ...(rawSearch
        ? {
            OR: [
              {
                name: {
                  contains: rawSearch,
                  mode: "insensitive",
                },
              },
              {
                phone: {
                  contains: rawSearch,
                  mode: "insensitive",
                },
              },
              {
                email: {
                  contains: rawSearch,
                  mode: "insensitive",
                },
              },
              {
                vehicles: {
                  some: {
                    plateNumber: {
                      contains: normalizedPlate,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      vehicles: {
        orderBy: { createdAt: "desc" },
        take: 4,
      },
    },
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Customers</h1>
            <p>{customers.length} customer record{customers.length === 1 ? "" : "s"}</p>
          </div>
          <div className="inline-actions">
            <BackButton fallbackHref="/crm" />
          </div>
        </div>

        <div className="panel">
          <form className="search-form" action="/crm/customers">
            <input
              name="q"
              placeholder="Search name, phone, email, or plate"
              defaultValue={rawSearch}
            />
            <button type="submit">Search</button>
          </form>
          {rawSearch ? (
            <div className="list-toolbar">
              <span>
                Showing {customers.length} result{customers.length === 1 ? "" : "s"} for{" "}
                <strong>{rawSearch}</strong>
              </span>
              <Link href="/crm/customers">Clear</Link>
            </div>
          ) : null}

          {customers.length ? (
            <table className="table customer-directory-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer, index) => (
                  <tr key={customer.id}>
                    <td className="table-number">{index + 1}</td>
                    <td>
                      <Link href={`/crm/customers/${customer.id}`}>
                        <strong>{customer.name}</strong>
                      </Link>
                    </td>
                    <td>{customer.phone}</td>
                    <td className="muted">{customer.email || "No email"}</td>
                    <td>{formatDate(customer.createdAt)}</td>
                    <td>
                      <div className="inline-actions">
                        <Link href={`/crm/customers/${customer.id}`}>View</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">
              {rawSearch ? "No matching customers found." : "No customers yet."}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
