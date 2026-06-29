import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { PackagePurchasePaymentForm } from "@/components/package-purchase-payment-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { recordPackagePurchasePaymentAction } from "../../actions";

type PackageCheckoutPageProps = {
  params: Promise<{
    customerPackageId: string;
  }>;
};

export default async function PackageCheckoutPage({
  params,
}: PackageCheckoutPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { customerPackageId } = await params;
  const customerPackage = await prisma.customerPackage.findFirst({
    where: {
      id: customerPackageId,
      businessId,
    },
    include: {
      customer: true,
      package: true,
      payments: {
        orderBy: { paidAt: "desc" },
      },
    },
  });

  if (!customerPackage) {
    notFound();
  }

  const balance = Number(customerPackage.purchasePrice);
  const canPay = customerPackage.status === "PENDING_PAYMENT";

  return (
    <AppShell user={user}>
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
          <Info label="Total washes" value={`${customerPackage.totalUses}`} />
          <Info label="Price" value={`RM${balance.toFixed(2)}`} />
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
                    <td>{payment.paidAt.toLocaleString()}</td>
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
