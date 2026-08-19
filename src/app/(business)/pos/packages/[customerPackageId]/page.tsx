import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { PackagePurchasePaymentForm } from "@/components/package-purchase-payment-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { calculatePackageTax } from "@/lib/tax/calculator";
import { recordPackagePurchasePaymentAction } from "../../actions";

type PackageCheckoutPageProps = {
  params: Promise<{
    customerPackageId: string;
  }>;
};

export default async function PackageCheckoutPage({
  params,
}: PackageCheckoutPageProps) {
  const { user, businessId } = await requireBusinessUser(
    "PROCESS_CASHIER_PAYMENT",
  );
  const { customerPackageId } = await params;
  const customerPackage = await prisma.customerPackage.findFirst({
    where: {
      id: customerPackageId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      branch: true,
      customer: true,
      package: {
        include: {
          service: true,
        },
      },
      payments: {
        orderBy: { paidAt: "desc" },
      },
    },
  });

  if (!customerPackage) {
    notFound();
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      sstEnabled: true,
      sstLabel: true,
      sstRate: true,
    },
  });
  const packageTax = calculatePackageTax({
    price: Number(customerPackage.purchasePrice),
    taxable: customerPackage.package.service?.taxable ?? true,
    taxRate: customerPackage.package.service?.taxRate
      ? Number(customerPackage.package.service.taxRate)
      : null,
    sstEnabled: business.sstEnabled,
    sstLabel: business.sstLabel,
    sstRate: Number(business.sstRate),
  });
  const balance = packageTax.total;
  const openShift = await prisma.cashierShift.findFirst({
    where: {
      businessId,
      cashierId: user.userId,
      status: "OPEN",
    },
    select: { branchId: true, id: true },
  });
  const shiftMatchesPackage =
    Boolean(openShift) && openShift?.branchId === customerPackage.branchId;
  const canPay = customerPackage.status === "PENDING_PAYMENT" && shiftMatchesPackage;

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Package Checkout</h1>
            <p>{customerPackage.customer.name}</p>
          </div>
          <BackButton fallbackHref="/pos" />
        </div>

        <div className="grid">
          <Info
            label="Customer"
            value={`${customerPackage.customer.name} - ${customerPackage.customer.phone}`}
          />
          <Info label="Package" value={customerPackage.package.name} />
          <Info label="Branch" value={customerPackage.branch?.name ?? "All branches"} />
          <Info label="Total washes" value={`${customerPackage.totalUses}`} />
          <Info label="Price" value={`RM${packageTax.subtotal.toFixed(2)}`} />
          {packageTax.tax > 0 ? (
            <Info label={packageTax.taxLabel} value={`RM${packageTax.tax.toFixed(2)}`} />
          ) : null}
          <Info label="Total" value={`RM${balance.toFixed(2)}`} />
          <Info label="Status" value={formatStatus(customerPackage.status)} />
        </div>

        <div className="panel">
          <h2>Payment</h2>
          {canPay ? (
            <PackagePurchasePaymentForm
              action={recordPackagePurchasePaymentAction}
              customerPackageId={customerPackage.id}
              balance={balance}
            />
          ) : !openShift ? (
            <div className="warning-panel">
              <h2>Shift required</h2>
              <p className="muted">
                Start a cashier shift before collecting this package payment.
              </p>
              <Link className="button-link" href="/closing">
                Start shift
              </Link>
            </div>
          ) : !shiftMatchesPackage ? (
            <div className="warning-panel">
              <h2>Wrong shift branch</h2>
              <p className="muted">
                This package belongs to another branch. Use a cashier shift from the
                same branch before collecting payment.
              </p>
              <Link className="button-link" href="/closing">
                Go to Shift Closing
              </Link>
            </div>
          ) : (
            <p className="empty-state">This package purchase is already paid.</p>
          )}
        </div>

        {customerPackage.payments.length ? (
          <div className="panel">
            <h2>Payment history</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {customerPackage.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.paidAt.toLocaleString("en-MY")}</td>
                    <td>RM{Number(payment.amount).toFixed(2)}</td>
                    <td>{formatStatus(payment.method)}</td>
                    <td>{payment.reference || "No reference"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
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
