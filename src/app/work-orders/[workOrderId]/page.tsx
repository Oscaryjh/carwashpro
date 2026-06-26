import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { canMoveWorkOrderStatus } from "@/lib/validation/work-orders";
import { updateWorkOrderStatusAction } from "../actions";

type WorkOrderDetailsPageProps = {
  params: Promise<{
    workOrderId: string;
  }>;
};

export default async function WorkOrderDetailsPage({
  params,
}: WorkOrderDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { workOrderId } = await params;
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      businessId,
    },
    include: {
      customer: true,
      vehicle: true,
      items: {
        orderBy: { createdAt: "asc" },
      },
      invoice: true,
    },
  });

  if (!workOrder) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{workOrder.orderNumber}</h1>
            <p>{formatStatus(workOrder.status)}</p>
          </div>
          <Link href="/work-orders">Back to work orders</Link>
        </div>

        <div className="grid">
          <Info label="Customer" value={`${workOrder.customer.name} - ${workOrder.customer.phone}`} />
          <Info
            label="Today contact"
            value={`${formatStatus(workOrder.contactType)} - ${
              workOrder.contactName || workOrder.customer.name
            } - ${workOrder.contactPhone || workOrder.customer.phone}`}
          />
          <Info label="Vehicle" value={vehicleLabel(workOrder.vehicle)} />
          <Info label="Subtotal" value={Number(workOrder.subtotal).toFixed(2)} />
          <Info label="Total" value={Number(workOrder.total).toFixed(2)} />
          <Info label="Paid" value={Number(workOrder.paidAmount).toFixed(2)} />
          <Info label="Balance" value={Number(workOrder.balance).toFixed(2)} />
          <Info label="Payment" value={formatStatus(workOrder.paymentStatus)} />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Status</h2>
            <span className="status">{formatStatus(workOrder.status)}</span>
          </div>
          <div className="inline-actions">
            {["IN_PROGRESS", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].map(
              (status) =>
                canMoveWorkOrderStatus(workOrder.status, status) ? (
                  <form action={updateWorkOrderStatusAction} key={status}>
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <input type="hidden" name="status" value={status} />
                    <button type="submit">{formatStatus(status)}</button>
                  </form>
                ) : null,
            )}
          </div>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Payment</h2>
            <span className="status">{formatStatus(workOrder.paymentStatus)}</span>
          </div>
          <div className="inline-actions">
            {workOrder.paymentStatus !== "PAID" && workOrder.status !== "CANCELLED" ? (
              <Link className="button-link" href={`/pos/${workOrder.id}`}>
                Go to POS
              </Link>
            ) : null}
            {workOrder.invoice ? (
              <Link href={`/invoices/${workOrder.invoice.id}`}>
                View invoice {workOrder.invoice.invoiceNumber}
              </Link>
            ) : null}
          </div>
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
              {workOrder.items.map((item) => (
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

        {workOrder.notes ? (
          <div className="panel">
            <h2>Notes</h2>
            <p>{workOrder.notes}</p>
          </div>
        ) : null}
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

function vehicleLabel(vehicle: { plateNumber: string; brand: string | null; model: string | null; color: string | null }) {
  const details = [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  return details ? `${vehicle.plateNumber} - ${details}` : vehicle.plateNumber;
}
