import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

type InvoicesPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const invoices = await prisma.invoice.findMany({
    where: {
      businessId,
      ...(query
        ? {
            OR: [
              { invoiceNumber: { contains: query, mode: "insensitive" } },
              { workOrder: { orderNumber: { contains: query, mode: "insensitive" } } },
              { workOrder: { customer: { name: { contains: query, mode: "insensitive" } } } },
              { workOrder: { customer: { phone: { contains: query } } } },
              { workOrder: { vehicle: { plateNumber: { contains: query, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      workOrder: {
        include: {
          customer: true,
          vehicle: true,
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Invoices</h1>
            <p>
              {query
                ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} found for "${query}".`
                : invoices.length
                  ? `${invoices.length} invoices generated from POS payments.`
                  : "Invoices generated from POS payments."}
            </p>
          </div>
        </div>

        <div className="panel">
          <form className="search-form invoice-search-form" action="/invoices">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search invoice, job, plate, customer, or phone"
            />
            <button type="submit">Search</button>
            {query ? (
              <Link className="secondary-link-button" href="/invoices">
                Clear
              </Link>
            ) : null}
          </form>
          {invoices.length ? (
            <table className="table invoices-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Issued</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice, index) => (
                  <tr key={invoice.id}>
                    <td className="table-number">{index + 1}</td>
                    <td>
                      <strong>{invoice.invoiceNumber}</strong>
                      <div className="muted">{invoice.workOrder.orderNumber}</div>
                    </td>
                    <td>
                      <strong>{invoice.workOrder.customer.name}</strong>
                      <div className="muted">{invoice.workOrder.customer.phone}</div>
                    </td>
                    <td>
                      <strong>{invoice.workOrder.vehicle.plateNumber}</strong>
                    </td>
                    <td>
                      <span className="status">{formatStatus(invoice.status)}</span>
                    </td>
                    <td>RM{Number(invoice.total).toFixed(2)}</td>
                    <td>RM{Number(invoice.balance).toFixed(2)}</td>
                    <td>{formatDateTime(invoice.issuedAt)}</td>
                    <td>
                      <Link href={`/invoices/${invoice.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No invoices yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
