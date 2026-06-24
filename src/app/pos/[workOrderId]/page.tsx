import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PackagePaymentForm } from "@/components/package-payment-form";
import { PaymentForm } from "@/components/payment-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { recordPaymentAction, usePackagePaymentAction } from "../actions";

type PosCheckoutPageProps = {
  params: Promise<{
    workOrderId: string;
  }>;
};

export default async function PosCheckoutPage({ params }: PosCheckoutPageProps) {
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
      payments: {
        orderBy: { paidAt: "desc" },
      },
      invoice: true,
    },
  });

  if (!workOrder) {
    notFound();
  }

  const balance = Number(workOrder.balance);
  const canPay = workOrder.status !== "CANCELLED" && workOrder.paymentStatus !== "PAID";
  const customerPackages = await prisma.customerPackage.findMany({
    where: {
      businessId,
      customerId: workOrder.customerId,
      status: "ACTIVE",
      remainingUses: {
        gt: 0,
      },
    },
    include: {
      package: true,
    },
    orderBy: { purchasedAt: "asc" },
  });
  const usableCustomerPackages = customerPackages.filter(
    (customerPackage) =>
      !customerPackage.package.serviceId ||
      workOrder.items.some(
        (item) => item.serviceId === customerPackage.package.serviceId,
      ),
  );

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Checkout {workOrder.orderNumber}</h1>
            <p>{workOrder.vehicle.plateNumber}</p>
          </div>
          <Link href="/pos">Back to POS</Link>
        </div>

        <div className="grid">
          <Info label="Customer" value={`${workOrder.customer.name} - ${workOrder.customer.phone}`} />
          <Info label="Vehicle" value={vehicleLabel(workOrder.vehicle)} />
          <Info label="Total" value={Number(workOrder.total).toFixed(2)} />
          <Info label="Paid" value={Number(workOrder.paidAmount).toFixed(2)} />
          <Info label="Balance" value={balance.toFixed(2)} />
          <Info label="Payment" value={formatStatus(workOrder.paymentStatus)} />
        </div>

        <div className="panel">
          <h2>Service items</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Total</th>
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

        <div className="panel">
          <h2>Payment</h2>
          {canPay ? (
            <PaymentForm
              action={recordPaymentAction}
              workOrderId={workOrder.id}
              balance={balance}
            />
          ) : (
            <p className="empty-state">This work order cannot accept more payments.</p>
          )}
        </div>

        {canPay ? (
          <div className="panel">
            <h2>Package payment</h2>
            <PackagePaymentForm
              action={usePackagePaymentAction}
              workOrderId={workOrder.id}
              customerPackages={usableCustomerPackages}
            />
          </div>
        ) : null}

        {workOrder.invoice ? (
          <div className="panel">
            <Link href={`/invoices/${workOrder.invoice.id}`}>
              View invoice {workOrder.invoice.invoiceNumber}
            </Link>
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

function vehicleLabel(vehicle: {
  plateNumber: string;
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  const details = [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  return details ? `${vehicle.plateNumber} - ${details}` : vehicle.plateNumber;
}
