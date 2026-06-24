import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export default async function InvoicesPage() {
  const { user, businessId } = await requireBusinessUser();
  const invoices = await prisma.invoice.findMany({
    where: { businessId },
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
            <p>Invoices generated from POS payments.</p>
          </div>
        </div>

        <div className="panel">
          {invoices.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.invoiceNumber}</strong>
                      <div className="muted">{invoice.workOrder.orderNumber}</div>
                    </td>
                    <td>{invoice.workOrder.customer.name}</td>
                    <td>{invoice.workOrder.vehicle.plateNumber}</td>
                    <td>
                      <span className="status">{formatStatus(invoice.status)}</span>
                    </td>
                    <td>{Number(invoice.total).toFixed(2)}</td>
                    <td>{Number(invoice.balance).toFixed(2)}</td>
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
