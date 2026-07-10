import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireCrmUser } from "@/lib/auth/crm";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";

type VehicleDetailsPageProps = {
  params: Promise<{
    vehicleId: string;
  }>;
};

export default async function VehicleDetailsPage({
  params,
}: VehicleDetailsPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { vehicleId } = await params;

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      businessId,
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
      },
      workOrders: {
        include: {
          customer: true,
          invoice: true,
          whatsappMessages: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      whatsappMessages: {
        include: {
          workOrder: true,
          invoice: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!vehicle) {
    notFound();
  }

  const invoices = vehicle.workOrders.flatMap((workOrder) =>
    workOrder.invoice ? [workOrder.invoice] : [],
  );

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{vehicle.plateNumber}</h1>
            <p>{vehicleLabel(vehicle)}</p>
          </div>
          <div className="inline-actions">
            <BackButton fallbackHref="/crm" />
          </div>
        </div>

        <div className="grid">
          <Info label="Current owner" value={vehicle.customer.name} />
          <Info label="Owner phone" value={vehicle.customer.phone} />
          <Info label="Branch" value={vehicle.branch?.name ?? "All branches"} />
          <Info label="Brand" value={vehicle.brand || "No brand"} />
          <Info label="Model" value={vehicle.model || "No model"} />
          <Info label="Color" value={vehicle.color || "No color"} />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Vehicle profile</h2>
            <Link href={`/crm/customers/${vehicle.customerId}`}>
              View current owner
            </Link>
          </div>
          <table className="table">
            <tbody>
              <DetailRow label="Plate number" value={vehicle.plateNumber} />
              <DetailRow label="Brand" value={vehicle.brand || "No brand"} />
              <DetailRow label="Model" value={vehicle.model || "No model"} />
              <DetailRow label="Color" value={vehicle.color || "No color"} />
              <DetailRow label="Branch" value={vehicle.branch?.name ?? "All branches"} />
              <DetailRow label="Notes" value={vehicle.notes || "No notes"} />
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Ownership History</h2>
          </div>

          {vehicle.ownershipHistories.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Previous owner</th>
                  <th>New owner</th>
                  <th>Transferred</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {vehicle.ownershipHistories.map((history) => (
                  <tr key={history.id}>
                    <td>
                      {history.previousCustomer ? (
                        <Link href={`/crm/customers/${history.previousCustomer.id}`}>
                          {history.previousCustomer.name}
                        </Link>
                      ) : (
                        "Unknown"
                      )}
                    </td>
                    <td>
                      <Link href={`/crm/customers/${history.newCustomer.id}`}>
                        {history.newCustomer.name}
                      </Link>
                    </td>
                    <td>{history.transferredAt.toLocaleString()}</td>
                    <td>{history.notes || "No notes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No ownership transfers yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Jobs</h2>
          </div>

          {vehicle.workOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Contact</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicle.workOrders.map((workOrder) => (
                  <tr key={workOrder.id}>
                    <td>{workOrder.orderNumber}</td>
                    <td>{formatStatus(workOrder.status)}</td>
                    <td>
                      {formatStatus(workOrder.contactType)}
                      <div className="muted">
                        {workOrder.contactName || workOrder.customer.name} -{" "}
                        {workOrder.contactPhone || workOrder.customer.phone}
                      </div>
                    </td>
                    <td>{Number(workOrder.total).toFixed(2)}</td>
                    <td>{formatStatus(workOrder.paymentStatus)}</td>
                    <td>{workOrder.createdAt.toLocaleString()}</td>
                    <td>
                      <Link href={`/work-orders/${workOrder.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No jobs for this vehicle yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Invoices</h2>
          </div>

          {invoices.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{formatInvoiceNumber(invoice.invoiceNumber)}</td>
                    <td>{formatStatus(invoice.status)}</td>
                    <td>{Number(invoice.total).toFixed(2)}</td>
                    <td>{Number(invoice.paidAmount).toFixed(2)}</td>
                    <td>{Number(invoice.balance).toFixed(2)}</td>
                    <td>
                      <Link href={`/invoices/${invoice.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No invoices for this vehicle yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>WhatsApp Messages</h2>
          </div>

          {vehicle.whatsappMessages.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Related</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicle.whatsappMessages.map((message) => (
                  <tr key={message.id}>
                    <td>{formatStatus(message.messageType)}</td>
                    <td>{message.phone}</td>
                    <td>{formatStatus(message.status)}</td>
                    <td>
                      {message.invoice
                        ? formatInvoiceNumber(message.invoice.invoiceNumber)
                        : message.workOrder?.orderNumber ?? "Vehicle"}
                    </td>
                    <td>{message.createdAt.toLocaleString()}</td>
                    <td>
                      <Link href={`/whatsapp/${message.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No WhatsApp messages for this vehicle yet.</p>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function vehicleLabel(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
    "No vehicle details";
}
