import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";

type CrmPageProps = {
  searchParams: Promise<{
    q?: string;
    plate?: string;
  }>;
};

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { q, plate } = await searchParams;
  const rawSearch = (q ?? plate ?? "").trim();
  const normalizedPlate = rawSearch ? normalizePlateNumber(rawSearch) : "";
  const isLikelyPlateSearch = /[A-Z]/i.test(rawSearch) && /\d/.test(rawSearch);
  const newCustomerHref = isLikelyPlateSearch
    ? `/crm/customers/new?plate=${encodeURIComponent(normalizedPlate)}`
    : "/crm/customers/new";

  const customerProfiles = await prisma.customer.findMany({
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
      branch: true,
      vehicles: {
        include: {
          branch: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: rawSearch ? 20 : 8,
  });

  const matchingVehicles = rawSearch
    ? await prisma.vehicle.findMany({
        where: {
          businessId,
          plateNumber: {
            contains: normalizedPlate,
            mode: "insensitive",
          },
        },
        include: {
          customer: true,
          branch: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
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
            <p>Search by plate, phone, or customer name from one place.</p>
          </div>
          <div className="inline-actions">
            <Link className="button-link" href="/crm/customers/new">
              New Customer
            </Link>
          </div>
        </div>

        <div className="grid">
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
          ) : (
            <div className="customer-record-list">
              {customerProfiles.map((customer) => (
                <CustomerRecord key={customer.id} customer={customer} />
              ))}
            </div>
          )}

          {matchingVehicles?.length ? (
            <div className="subsection">
              <h3>Plate matches</h3>
              <div className="vehicle-chip-list">
                {matchingVehicles.map((vehicle) => (
                  <Link
                    className="vehicle-chip"
                    key={vehicle.id}
                    href={`/crm/customers/${vehicle.customerId}`}
                  >
                    <strong>{vehicle.plateNumber}</strong>
                    <span>
                      {vehicle.customer.name} ·{" "}
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                        "No vehicle details"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Management lists</h2>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/crm/customers">
              Customer records
            </Link>
          </div>
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
            {customer.email ? ` · ${customer.email}` : ""}
          </p>
          <small>{customer.branch?.name ?? "All branches"}</small>
        </div>
        <div className="inline-actions">
          <Link className="button-link" href={`/crm/customers/${customer.id}`}>
            Open Profile
          </Link>
          <Link
            className="secondary-link-button"
            href={`/crm/customers/${customer.id}/edit`}
          >
            Edit
          </Link>
        </div>
      </div>

      {customer.vehicles.length ? (
        <div className="vehicle-chip-list">
          {customer.vehicles.map((vehicle) => (
            <Link
              className="vehicle-chip"
              key={vehicle.id}
              href={`/crm/customers/${customer.id}`}
            >
              <strong>{vehicle.plateNumber}</strong>
              <span>
                {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") ||
                  "No vehicle details"}
                {vehicle.color ? ` · ${vehicle.color}` : ""}
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
