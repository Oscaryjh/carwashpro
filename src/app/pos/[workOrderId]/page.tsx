import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { PosPaymentPanel } from "@/components/pos-payment-panel";
import { PosReceiptTotalsPreview } from "@/components/pos-payment-preview";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import { packageAllowsVehicle } from "@/lib/vehicle-size";
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
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      business: true,
      customer: true,
      vehicle: true,
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          service: { select: { taxable: true, taxRate: true } },
        },
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

  const projectedTax = workOrder.invoice
    ? null
    : calculateTax({
        sstEnabled: workOrder.business.sstEnabled,
        sstLabel: workOrder.business.sstLabel,
        sstRate: Number(workOrder.business.sstRate),
        lines: workOrder.items.map((item) => ({
          lineTotal: Number(item.lineTotal),
          taxable: item.service?.taxable ?? false,
          taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
        })),
      });
  const checkoutTotal = workOrder.invoice
    ? Number(workOrder.invoice.total)
    : projectedTax?.total ?? Number(workOrder.total);
  const balance = Math.max(0, checkoutTotal - Number(workOrder.paidAmount));
  const openShift = await prisma.cashierShift.findFirst({
    where: {
      businessId,
      cashierId: user.userId,
      status: "OPEN",
    },
    select: { branchId: true, id: true, startedAt: true },
  });
  const shiftMatchesWorkOrder = Boolean(openShift) && openShift?.branchId === workOrder.branchId;
  const canPay =
    shiftMatchesWorkOrder &&
    workOrder.status !== "CANCELLED" &&
    workOrder.paymentStatus !== "PAID";
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
      branch: true,
      package: true,
    },
    orderBy: { purchasedAt: "asc" },
  });
  const usableCustomerPackages = customerPackages.filter(
    (customerPackage) =>
      packageAllowsVehicle(customerPackage.eligibleVehicleSize, workOrder.vehicle.size) &&
      (!customerPackage.package.serviceId ||
        workOrder.items.some(
          (item) => item.serviceId === customerPackage.package.serviceId,
        )),
  );
  const packagePaymentOptions = usableCustomerPackages.map((customerPackage) => ({
    id: customerPackage.id,
    packageName: customerPackage.package.name,
    purchaseBranchName: customerPackage.branch?.name ?? "All branches",
    remainingUses: customerPackage.remainingUses,
    totalUses: customerPackage.totalUses,
  }));
  const displayInvoiceNumber = workOrder.invoice
    ? formatInvoiceNumber(workOrder.invoice.invoiceNumber)
    : "Pending invoice";

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Checkout</h1>
            <p>{workOrder.vehicle.plateNumber}</p>
          </div>
          <BackButton fallbackHref="/pos" />
        </div>

        <div className="pos-checkout-layout">
          <div className="pos-receipt-panel panel">
            <div className="pos-receipt-company">
              {workOrder.business.logoUrl ? (
                <Image
                  src={workOrder.business.logoUrl}
                  alt=""
                  width={58}
                  height={58}
                />
              ) : (
                <div className="pos-receipt-logo-placeholder">
                  {workOrder.business.name.slice(0, 1)}
                </div>
              )}
              <div>
                <strong>{workOrder.business.name}</strong>
                {workOrder.business.companyNo ? (
                  <span>Company No. {workOrder.business.companyNo}</span>
                ) : null}
                {workOrder.business.phone ? (
                  <span>WhatsApp No. {workOrder.business.phone}</span>
                ) : null}
                {workOrder.business.address ? (
                  <span>{workOrder.business.address}</span>
                ) : null}
              </div>
            </div>

            <div className="pos-receipt-header">
              <div>
                <span>Invoice No.</span>
                <strong className="pos-receipt-number">
                  {displayInvoiceNumber}
                </strong>
                <small>{new Date().toLocaleDateString("en-MY")}</small>
              </div>
              <div>
                <span>Vehicle</span>
                <strong>{workOrder.vehicle.plateNumber}</strong>
                <small>{vehicleDetails(workOrder.vehicle)}</small>
              </div>
              <span className={`payment-state ${workOrder.paymentStatus.toLowerCase()}`}>
                {formatStatus(workOrder.paymentStatus)}
              </span>
            </div>

            <div className="pos-customer-strip">
              <div>
                <span>Customer</span>
                <strong>{workOrder.customer.name}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{workOrder.customer.phone}</strong>
              </div>
            </div>

            <div className="pos-receipt-items">
              <div className="pos-receipt-row pos-receipt-head">
                <span>Item</span>
                <span>Qty</span>
                <span>Total</span>
              </div>
              {workOrder.items.map((item) => (
                <div className="pos-receipt-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>RM{Number(item.unitPrice).toFixed(2)}</small>
                  </div>
                  <span>{item.quantity}</span>
                  <strong>RM{Number(item.lineTotal).toFixed(2)}</strong>
                </div>
              ))}
            </div>

            <PosReceiptTotalsPreview
              total={checkoutTotal}
              paidAmount={Number(workOrder.paidAmount)}
              balance={balance}
              taxAmount={workOrder.invoice ? Number(workOrder.invoice.taxAmount) : projectedTax?.tax ?? 0}
              taxLabel={workOrder.invoice?.taxLabel ?? projectedTax?.taxLabel}
            />

            {workOrder.payments.length ? (
              <div className="pos-payment-history">
                <h3>Payment history</h3>
                {workOrder.payments.map((payment) => (
                  <div className="pos-history-row" key={payment.id}>
                    <span>{payment.paidAt.toLocaleString()}</span>
                    <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                    <small>{formatStatus(payment.method)}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <PosPaymentPanel
            recordPaymentAction={recordPaymentAction}
            usePackagePaymentAction={usePackagePaymentAction}
            workOrderId={workOrder.id}
            balance={balance}
            canPay={canPay}
            customerPackages={packagePaymentOptions}
            invoice={
              workOrder.invoice
                ? {
                    id: workOrder.invoice.id,
                    invoiceNumber: displayInvoiceNumber,
                  }
                : null
            }
          />
        </div>
        {!openShift ? (
          <div className="panel warning-panel">
            <h2>Shift required</h2>
            <p className="muted">
              Start a cashier shift before checkout so this payment is included in
              closing.
            </p>
            <Link className="button-link" href="/closing">
              Start shift
            </Link>
          </div>
        ) : !shiftMatchesWorkOrder ? (
          <div className="panel warning-panel">
            <h2>Wrong shift branch</h2>
            <p className="muted">
              This job belongs to another branch. End the current shift or start a
              shift for this job branch before checkout.
            </p>
            <Link className="button-link" href="/closing">
              Go to Shift Closing
            </Link>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function vehicleDetails(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
    "No vehicle details";
}
