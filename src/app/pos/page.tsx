import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export default async function PosPage() {
  const { user, businessId } = await requireBusinessUser();
  const workOrders = await prisma.workOrder.findMany({
    where: {
      businessId,
      status: {
        not: "CANCELLED",
      },
      OR: [
        { status: "READY_FOR_PICKUP" },
        { paymentStatus: { not: "PAID" } },
      ],
    },
    include: {
      customer: true,
      vehicle: true,
      invoice: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>POS</h1>
            <p>Collect payments for unpaid or ready-for-pickup work orders.</p>
          </div>
        </div>

        <div className="panel">
          {workOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workOrders.map((workOrder) => (
                  <tr key={workOrder.id}>
                    <td>
                      <strong>{workOrder.orderNumber}</strong>
                      <div className="muted">{formatStatus(workOrder.paymentStatus)}</div>
                    </td>
                    <td>{workOrder.customer.name}</td>
                    <td>{workOrder.vehicle.plateNumber}</td>
                    <td>{formatStatus(workOrder.status)}</td>
                    <td>{Number(workOrder.balance).toFixed(2)}</td>
                    <td>
                      <Link href={`/pos/${workOrder.id}`}>Checkout</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No payable work orders.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
