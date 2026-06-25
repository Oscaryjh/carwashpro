import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export default async function WorkOrdersPage() {
  const { user, businessId } = await requireBusinessUser();
  const workOrders = await prisma.workOrder.findMany({
    where: { businessId },
    include: {
      branch: true,
      customer: true,
      vehicle: true,
      _count: {
        select: { items: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Work Orders</h1>
            <p>Active and historical wash jobs.</p>
          </div>
          <Link className="button-link" href="/work-orders/new">
            New Work Order
          </Link>
        </div>

        <div className="panel">
          {workOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workOrders.map((workOrder) => (
                  <tr key={workOrder.id}>
                    <td>
                      <strong>{workOrder.orderNumber}</strong>
                      <div className="muted">{workOrder._count.items} items</div>
                    </td>
                    <td>{workOrder.customer.name}</td>
                    <td>{workOrder.vehicle.plateNumber}</td>
                    <td>{workOrder.branch?.name ?? "All branches"}</td>
                    <td>
                      <span className="status">{formatStatus(workOrder.status)}</span>
                    </td>
                    <td>{Number(workOrder.total).toFixed(2)}</td>
                    <td>
                      <Link href={`/work-orders/${workOrder.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No work orders yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
