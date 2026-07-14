import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type CrmPageProps = {
  searchParams: Promise<{
    q?: string;
    plate?: string;
    page?: string;
  }>;
};

const CUSTOMERS_PER_PAGE = 30;

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { q, plate, page } = await searchParams;
  const rawSearch = (q ?? plate ?? "").trim();
  const normalizedPlate = rawSearch ? normalizePlateNumber(rawSearch) : "";
  const isLikelyPlateSearch = /[A-Z]/i.test(rawSearch) && /\d/.test(rawSearch);
  const currentPage = Math.max(1, Number(page) || 1);
  const customerSkip = (currentPage - 1) * CUSTOMERS_PER_PAGE;
  const newCustomerHref = isLikelyPlateSearch
    ? `/crm/customers/new?plate=${encodeURIComponent(normalizedPlate)}`
    : "/crm/customers/new";

  const customerProfiles = rawSearch
    ? await prisma.customer.findMany({
        where: {
          businessId,
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
        },
        include: {
          branch: true,
          vehicles: {
            include: {
              branch: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
    : [];

  const [customerCount, vehicleCount, customers] = await Promise.all([
    prisma.customer.count({ where: { businessId } }),
    prisma.vehicle.count({ where: { businessId } }),
    prisma.customer.findMany({
      where: { businessId },
      include: {
        _count: {
          select: {
            vehicles: true,
          },
        },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      skip: customerSkip,
      take: CUSTOMERS_PER_PAGE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(customerCount / CUSTOMERS_PER_PAGE));

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>CRM</h1>
          </div>
          <Link className="button-link" href={newCustomerHref}>
            + Customer
          </Link>
        </div>

        <div className="grid crm-metrics">
          <Metric label="Customers" value={customerCount} />
          <Metric label="Vehicles" value={vehicleCount} />
        </div>

        <div className="panel crm-search-panel">
          <h2>Find customer or vehicle</h2>
          <form className="search-form" action="/crm">
            <input
              name="q"
              placeholder="Plate number, phone, or customer name"
              defaultValue={rawSearch}
            />
            <button type="submit">Search</button>
          </form>

          {rawSearch ? (
            customerProfiles.length ? (
              <div className="customer-record-list">
                {customerProfiles.map((customer) => (
                  <CustomerRecord key={customer.id} customer={customer} />
                ))}
              </div>
            ) : (
              <div className="result-box">
                <strong>No customer or vehicle found for {rawSearch}</strong>
                <div className="inline-actions">
                  <Link
                    className="button-link"
                    href={newCustomerHref}
                  >
                    Create customer
                  </Link>
                </div>
              </div>
            )
          ) : null}

        </div>

        <div className="panel crm-customer-list-panel">
          <div className="section-header">
            <div>
              <h2>Customer list</h2>
              <p>
                Showing {customers.length ? customerSkip + 1 : 0}-
                {customerSkip + customers.length} of {customerCount}
              </p>
            </div>
          </div>

          {customers.length ? (
            <>
              <table className="table customer-directory-table crm-home-customer-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Vehicles</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer, index) => (
                    <tr key={customer.id}>
                      <td className="table-number">{customerSkip + index + 1}</td>
                      <td>
                        <Link href={`/crm/customers/${customer.id}`}>
                          <strong>{customer.name}</strong>
                        </Link>
                      </td>
                      <td>{customer.phone}</td>
                      <td className="muted">{customer.email || "No email"}</td>
                      <td>{customer._count.vehicles}</td>
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

              <div className="pagination">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <Link
                  className={currentPage <= 1 ? "disabled" : ""}
                  href={makeCrmPageHref(rawSearch, currentPage - 1)}
                >
                  Previous
                </Link>
                <Link
                  className={currentPage >= totalPages ? "disabled" : ""}
                  href={makeCrmPageHref(rawSearch, currentPage + 1)}
                >
                  Next
                </Link>
              </div>
            </>
          ) : (
            <p className="empty-state">No customers yet.</p>
          )}
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

function makeCrmPageHref(rawSearch: string, page: number) {
  const params = new URLSearchParams();

  if (rawSearch) {
    params.set("q", rawSearch);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/crm?${query}` : "/crm";
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type CustomerRecordProps = {
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    branch: { name: string } | null;
    vehicles: {
      id: string;
      plateNumber: string;
      brand: string | null;
      model: string | null;
      color: string | null;
      branch: { name: string } | null;
    }[];
  };
};

function CustomerRecord({ customer }: CustomerRecordProps) {
  return (
    <article className="customer-record-card">
      <div className="customer-record-main">
        <div>
          <h3>{customer.name}</h3>
          <p>
            {customer.phone}
            {customer.email ? ` - ${customer.email}` : ""}
          </p>
          <small>{customer.branch?.name ?? "All branches"}</small>
        </div>
        <div className="inline-actions">
          <Link className="button-link" href={`/crm/customers/${customer.id}`}>
            Open Profile
          </Link>
        </div>
      </div>

      {customer.vehicles.length ? (
        <div className="vehicle-chip-list">
          {customer.vehicles.map((vehicle) => (
            <Link
              className="vehicle-chip"
              key={vehicle.id}
              href={`/crm/vehicles/${vehicle.id}`}
            >
              <strong>{vehicle.plateNumber}</strong>
              <span>
                {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                  "No vehicle details"}
                {vehicle.color ? ` - ${vehicle.color}` : ""}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="result-box">
          <span>No vehicles yet.</span>
          <Link
            className="secondary-link-button"
            href={`/crm/vehicles/new?customerId=${customer.id}`}
          >
            Add vehicle
          </Link>
        </div>
      )}
    </article>
  );
}
