import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

type InvoiceDetailsPageProps = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export default async function InvoiceDetailsPage({
  params,
}: InvoiceDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { invoiceId } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId,
    },
    include: {
      business: true,
      workOrder: {
        include: {
          customer: true,
          vehicle: true,
          items: {
            orderBy: { createdAt: "asc" },
          },
          payments: {
            orderBy: { paidAt: "desc" },
            include: {
              customerPackage: {
                include: {
                  package: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{invoice.invoiceNumber}</h1>
            <p>{invoice.business.name}</p>
          </div>
          <Link href="/invoices">Back to invoices</Link>
        </div>

        <div className="grid">
          <Info label="Business" value={invoice.business.name} />
          <Info label="Customer" value={invoice.workOrder.customer.name} />
          <Info label="Phone" value={invoice.workOrder.customer.phone} />
          <Info label="Plate" value={invoice.workOrder.vehicle.plateNumber} />
          <Info label="Status" value={formatStatus(invoice.status)} />
          <Info label="Issued" value={invoice.issuedAt.toLocaleDateString()} />
        </div>

        <div className="panel">
          <h2>Service items</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.workOrder.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{Number(item.unitPrice).toFixed(2)}</td>
                  <td>{Number(item.lineTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid">
          <Info label="Subtotal" value={Number(invoice.subtotal).toFixed(2)} />
          <Info label="Total" value={Number(invoice.total).toFixed(2)} />
          <Info label="Paid Amount" value={Number(invoice.paidAmount).toFixed(2)} />
          <Info label="Balance" value={Number(invoice.balance).toFixed(2)} />
        </div>

        <div className="panel">
          <h2>Payment history</h2>
          {invoice.workOrder.payments.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Paid at</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Package uses</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {invoice.workOrder.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.paidAt.toLocaleString()}</td>
                    <td>{Number(payment.amount).toFixed(2)}</td>
                    <td>{formatStatus(payment.method)}</td>
                    <td>
                      {payment.packageUses
                        ? `${payment.packageUses} wash from ${
                            payment.customerPackage?.package.name ?? "package"
                          }`
                        : "-"}
                    </td>
                    <td>{payment.reference || "No reference"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No payments recorded.</p>
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

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
