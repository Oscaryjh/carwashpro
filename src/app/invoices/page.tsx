import Link from "next/link";
import { Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";

type InvoicesPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

const PAGE_SIZE = 10;

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const currentPage = Math.max(Number(params.page) || 1, 1);
  const where: Prisma.InvoiceWhereInput = {
    businessId,
    ...(query
      ? {
          OR: [
            { invoiceNumber: { contains: query, mode: "insensitive" } },
            { workOrder: { orderNumber: { contains: query, mode: "insensitive" } } },
            { workOrder: { customer: { name: { contains: query, mode: "insensitive" } } } },
            { workOrder: { customer: { phone: { contains: query } } } },
            { workOrder: { vehicle: { plateNumber: { contains: query, mode: "insensitive" } } } },
            { appointment: { customer: { name: { contains: query, mode: "insensitive" } } } },
            { appointment: { customer: { phone: { contains: query } } } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { customer: { phone: { contains: query } } },
            { customerPackage: { package: { name: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  } as const;

  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
          },
        },
        appointment: {
          include: {
            customer: true,
          },
        },
        customer: true,
        customerPackage: { include: { package: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
  ]);
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Invoices</h1>
            <p>
              {totalCount
                ? `Showing ${firstItem}-${lastItem} of ${totalCount} invoice${totalCount === 1 ? "" : "s"}${query ? ` for "${query}"` : ""}.`
                : query
                  ? `No invoices found for "${query}".`
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
                    <td className="table-number">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td>
                      <strong>{formatInvoiceNumber(invoice.invoiceNumber)}</strong>
                      <div className="muted">
                        {invoice.workOrder?.orderNumber ??
                          (invoice.appointment ? "Salon appointment" : null) ??
                          invoice.customerPackage?.package.name ??
                          "Package purchase"}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {invoice.workOrder?.customer.name ??
                          invoice.appointment?.customer.name ??
                          invoice.customer?.name ??
                          "-"}
                      </strong>
                      <div className="muted">
                        {invoice.workOrder?.customer.phone ??
                          invoice.appointment?.customer.phone ??
                          invoice.customer?.phone ??
                          "-"}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {invoice.workOrder?.vehicle.plateNumber ??
                          (invoice.appointment ? "Salon" : "-")}
                      </strong>
                    </td>
                    <td>
                      <span className={`status ${invoice.status.toLowerCase()}`}>
                        {formatStatus(invoice.status)}
                      </span>
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

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeInvoicesHref({
                  q: query,
                  page: Math.max(currentPage - 1, 1),
                })}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                className={currentPage >= totalPages ? "disabled" : ""}
                href={makeInvoicesHref({
                  q: query,
                  page: Math.min(currentPage + 1, totalPages),
                })}
              >
                Next
              </Link>
            </div>
          ) : null}
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

function makeInvoicesHref(input: { page: number; q: string }) {
  const params = new URLSearchParams();

  if (input.q) {
    params.set("q", input.q);
  }

  if (input.page > 1) {
    params.set("page", String(input.page));
  }

  const query = params.toString();
  return query ? `/invoices?${query}` : "/invoices";
}
