import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { RefundPaymentForm } from "@/components/refund-payment-form";
import { SendWhatsAppButton } from "@/components/send-whatsapp-button";
import { VoidInvoiceForm } from "@/components/void-invoice-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { getInvoicePaymentSummary } from "@/lib/invoices/payment-summary";
import { prisma } from "@/lib/prisma";
import { getRefundableCents } from "@/lib/refunds/rules";

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
              refunds: {
                orderBy: { refundedAt: "desc" },
                include: {
                  processedBy: {
                    select: { name: true },
                  },
                },
              },
              customerPackage: {
                include: {
                  package: true,
                },
              },
            },
          },
        },
      },
      appointment: {
        include: {
          assignedStaff: {
            select: { name: true },
          },
          customer: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
      },
      payments: {
        orderBy: { paidAt: "desc" },
        include: {
          refunds: {
            orderBy: { refundedAt: "desc" },
          },
        },
      },
      customer: true,
      customerPackage: { include: { package: true } },
    },
  });

  if (!invoice) {
    notFound();
  }

  if (invoice.appointment) {
    const appointment = invoice.appointment;
    return (
      <AppShell user={user}>
        <section className="content invoice-detail-layout">
          <div className="page-header">
            <div><h1>Invoice</h1></div>
            <BackButton fallbackHref="/invoices" />
          </div>
          <div className="pos-receipt-panel panel">
            <div className="invoice-receipt-actions">
              <Link
                className="secondary-link-button invoice-action-button"
                href={`/invoices/${invoice.id}/pdf`}
              >
                Download PDF
              </Link>
              <SendWhatsAppButton
                className="button-link invoice-action-button"
                invoiceId={invoice.id}
                label="Send Invoice WhatsApp"
                messageType="INVOICE_SENT"
              />
            </div>
            <div className="pos-receipt-company">
              {invoice.business.logoUrl ? (
                <Image src={invoice.business.logoUrl} alt="" width={72} height={72} />
              ) : (
                <div className="pos-receipt-logo-placeholder">
                  {invoice.business.name.slice(0, 1)}
                </div>
              )}
              <div>
                <strong>{invoice.business.name}</strong>
                {invoice.business.companyNo ? <span>Company No. {invoice.business.companyNo}</span> : null}
                {invoice.business.phone ? <span>WhatsApp No. {invoice.business.phone}</span> : null}
                {invoice.business.address ? <span>{invoice.business.address}</span> : null}
              </div>
            </div>
            <div className="pos-receipt-header">
              <div>
                <span>Invoice No.</span>
                <strong className="pos-receipt-number">
                  {formatInvoiceNumber(invoice.invoiceNumber)}
                </strong>
                <small>{invoice.issuedAt.toLocaleDateString("en-MY")}</small>
              </div>
              <div>
                <span>Appointment</span>
                <strong>{appointment.scheduledAt.toLocaleDateString("en-MY")}</strong>
                <small>{appointment.scheduledAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</small>
              </div>
              <span className={`payment-state ${invoice.status.toLowerCase()}`}>
                {formatStatus(invoice.status)}
              </span>
            </div>
            <div className="pos-customer-strip">
              <div><span>Customer</span><strong>{appointment.customer.name}</strong></div>
              <div><span>Phone</span><strong>{appointment.customer.phone}</strong></div>
              <div><span>Staff</span><strong>{appointment.assignedStaff?.name ?? "Unassigned"}</strong></div>
            </div>
            <div className="pos-receipt-items">
              <div className="pos-receipt-row pos-receipt-head">
                <span>Service</span><span>Qty</span><span>Total</span>
              </div>
              {invoice.items.map((item) => (
                <div className="pos-receipt-row" key={item.id}>
                  <div><strong>{item.name}</strong><small>RM{Number(item.unitPrice).toFixed(2)}</small></div>
                  <span>{item.quantity}</span>
                  <strong>RM{Number(item.lineTotal).toFixed(2)}</strong>
                </div>
              ))}
            </div>
            <div className="pos-receipt-totals">
              <div><span>Total</span><strong>RM{Number(invoice.total).toFixed(2)}</strong></div>
              <div><span>Paid</span><strong>RM{Number(invoice.paidAmount).toFixed(2)}</strong></div>
              <div className="is-balance"><span>Balance</span><strong>RM{Number(invoice.balance).toFixed(2)}</strong></div>
            </div>
            {invoice.payments.length ? (
              <div className="pos-payment-history">
                <h3>Payment history</h3>
                {invoice.payments.map((payment) => (
                  <div className="pos-history-row" key={payment.id}>
                    <span>{payment.paidAt.toLocaleString()}</span>
                    <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                    <small>{formatStatus(payment.method)}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="panel">
            <div className="section-header">
              <div>
                <h2>Appointment</h2>
                <p className="muted">Payment does not change the service status.</p>
              </div>
              <Link className="secondary-link-button" href={`/appointments/${appointment.id}`}>
                Open appointment
              </Link>
            </div>
          </div>
        </section>
      </AppShell>
    );
  }

  if (!invoice.workOrder) {
    const packageName = invoice.customerPackage?.package.name ?? "Package purchase";
    return (
      <AppShell user={user}>
        <section className="content invoice-detail-layout">
          <div className="page-header">
            <div><h1>Invoice</h1></div>
            <BackButton fallbackHref="/invoices" />
          </div>
          <div className="pos-receipt-panel panel">
            <div className="invoice-receipt-actions">
              <Link className="secondary-link-button invoice-action-button" href={`/invoices/${invoice.id}/pdf`}>Download PDF</Link>
              <p className="muted-text">WhatsApp invoice notification was queued after purchase.</p>
            </div>
            <div className="pos-receipt-company">
              {invoice.business.logoUrl ? <Image src={invoice.business.logoUrl} alt="" width={72} height={72} /> : <div className="pos-receipt-logo-placeholder">{invoice.business.name.slice(0, 1)}</div>}
              <div><strong>{invoice.business.name}</strong>{invoice.business.companyNo ? <span>Company No. {invoice.business.companyNo}</span> : null}{invoice.business.phone ? <span>WhatsApp No. {invoice.business.phone}</span> : null}{invoice.business.address ? <span>{invoice.business.address}</span> : null}</div>
            </div>
            <div className="pos-receipt-header">
              <div><span>Invoice No.</span><strong className="pos-receipt-number">{formatInvoiceNumber(invoice.invoiceNumber)}</strong><small>{invoice.issuedAt.toLocaleDateString("en-MY")}</small></div>
              <div><span>Package</span><strong>{packageName}</strong><small>Package purchase</small></div>
              <span className={`payment-state ${invoice.status.toLowerCase()}`}>{formatStatus(invoice.status)}</span>
            </div>
            <div className="pos-customer-strip"><div><span>Customer</span><strong>{invoice.customer?.name ?? "-"}</strong></div><div><span>Phone</span><strong>{invoice.customer?.phone ?? "-"}</strong></div></div>
            <div className="pos-receipt-items"><div className="pos-receipt-row pos-receipt-head"><span>Item</span><span>Qty</span><span>Total</span></div><div className="pos-receipt-row"><span>{packageName}</span><span>1</span><span>RM{Number(invoice.total).toFixed(2)}</span></div></div>
            <div className="pos-receipt-summary"><div><span>Total</span><strong>RM{Number(invoice.total).toFixed(2)}</strong></div><div><span>Paid</span><strong>RM{Number(invoice.paidAmount).toFixed(2)}</strong></div><div className="balance-row"><span>Balance</span><strong>RM{Number(invoice.balance).toFixed(2)}</strong></div></div>
          </div>
        </section>
      </AppShell>
    );
  }

  const packagePayments = invoice.workOrder.payments.filter(
    (payment) => payment.method === "PACKAGE" && payment.status !== "VOID",
  );
  const paymentSummary = getInvoicePaymentSummary(invoice.workOrder.payments);
  const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
  const refunds = invoice.workOrder.payments
    .flatMap((payment) =>
      payment.refunds.map((refund) => ({
        ...refund,
        originalPaymentMethod: payment.method,
      })),
    )
    .sort((left, right) => right.refundedAt.getTime() - left.refundedAt.getTime());
  const refundablePayments = invoice.workOrder.payments
    .filter((payment) => payment.status === "ACTIVE")
    .map((payment) => ({
      payment,
      refundableCents: getRefundableCents(
        Math.round(Number(payment.amount) * 100),
        payment.refunds.map((refund) => Math.round(Number(refund.amount) * 100)),
      ),
    }))
    .filter(({ refundableCents }) => refundableCents > 0);

  return (
    <AppShell user={user}>
      <section className="content invoice-detail-layout">
        <div className="page-header">
          <div>
            <h1>Invoice</h1>
          </div>
          <BackButton fallbackHref="/invoices" />
        </div>

        <div className="pos-receipt-panel panel">
          <div className="invoice-receipt-actions">
            <Link
              className="secondary-link-button invoice-action-button"
              href={`/invoices/${invoice.id}/pdf`}
            >
              Download PDF
            </Link>
            <SendWhatsAppButton
              className="button-link invoice-action-button"
              invoiceId={invoice.id}
              label="Send Invoice WhatsApp"
              messageType="INVOICE_SENT"
            />
          </div>
          <div className="pos-receipt-company">
            {invoice.business.logoUrl ? (
              <Image src={invoice.business.logoUrl} alt="" width={72} height={72} />
            ) : (
              <div className="pos-receipt-logo-placeholder">
                {invoice.business.name.slice(0, 1)}
              </div>
            )}
            <div>
              <strong>{invoice.business.name}</strong>
              {invoice.business.companyNo ? (
                <span>Company No. {invoice.business.companyNo}</span>
              ) : null}
              {invoice.business.phone ? (
                <span>WhatsApp No. {invoice.business.phone}</span>
              ) : null}
              {invoice.business.address ? <span>{invoice.business.address}</span> : null}
            </div>
          </div>

          <div className="pos-receipt-header">
            <div>
              <span>Invoice No.</span>
              <strong className="pos-receipt-number">{displayInvoiceNumber}</strong>
              <small>{invoice.issuedAt.toLocaleDateString("en-MY")}</small>
            </div>
            <div>
              <span>Vehicle</span>
              <strong>{invoice.workOrder.vehicle.plateNumber}</strong>
              <small>{vehicleDetails(invoice.workOrder.vehicle)}</small>
            </div>
            <span className={`payment-state ${invoice.status.toLowerCase()}`}>
              {formatStatus(invoice.status)}
            </span>
          </div>

          <div className="pos-customer-strip">
            <div>
              <span>Customer</span>
              <strong>{invoice.workOrder.customer.name}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{invoice.workOrder.customer.phone}</strong>
            </div>
          </div>

          <div className="pos-receipt-items">
            <div className="pos-receipt-row pos-receipt-head">
              <span>Item</span>
              <span>Qty</span>
              <span>Total</span>
            </div>
            {invoice.workOrder.items.map((item) => (
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

          <div className="pos-receipt-totals">
            <div>
              <span>Total</span>
              <strong>RM{Number(invoice.total).toFixed(2)}</strong>
            </div>
            {paymentSummary.hasPackageVoucher ? (
              <>
                <div>
                  <span>Package voucher</span>
                  <strong>RM{paymentSummary.packageVoucherAmount.toFixed(2)}</strong>
                </div>
                <div>
                  <span>Cash paid</span>
                  <strong>RM{paymentSummary.cashPaidAmount.toFixed(2)}</strong>
                </div>
              </>
            ) : (
              <div>
                <span>Paid</span>
                <strong>RM{Number(invoice.paidAmount).toFixed(2)}</strong>
              </div>
            )}
            {paymentSummary.totalRefundedAmount > 0 ? (
              <div className="is-refund-total">
                <span>Refunded</span>
                <strong>
                  RM{paymentSummary.totalRefundedAmount.toFixed(2)}
                </strong>
              </div>
            ) : null}
            <div className="is-balance">
              <span>Balance</span>
              <strong>RM{Number(invoice.balance).toFixed(2)}</strong>
            </div>
          </div>

          {packagePayments.length ? (
            <div className="pos-package-deduction-list">
              <h3>Package deducted</h3>
              {packagePayments.map((payment) => (
                <div className="pos-package-deduction-row" key={payment.id}>
                  <div>
                    <strong>
                      {payment.customerPackage?.package.name ?? "Prepaid package"}
                    </strong>
                    <span>
                      {payment.packageUses || 1} wash used
                      {payment.status === "VOID" ? " - voided" : ""}
                      {payment.refunds.length ? " - restored" : ""}
                    </span>
                  </div>
                  <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {invoice.workOrder.payments.length ? (
            <div className="pos-payment-history">
              <h3>Payment history</h3>
              {invoice.workOrder.payments.map((payment) => (
                <div className="pos-history-row" key={payment.id}>
                  <span>{payment.paidAt.toLocaleString()}</span>
                  <strong>RM{Number(payment.amount).toFixed(2)}</strong>
                  <small>
                    {payment.method === "PACKAGE"
                      ? `${payment.customerPackage?.package.name ?? "Package"} - ${payment.packageUses} wash`
                      : formatStatus(payment.method)}
                    {payment.status === "VOID" ? " - Void" : ""}
                    {payment.refunds.length
                      ? ` - Refunded RM${payment.refunds
                          .reduce(
                            (sum, refund) => sum + Number(refund.amount),
                            0,
                          )
                          .toFixed(2)}`
                      : ""}
                  </small>
                </div>
              ))}
            </div>
          ) : null}

          {refunds.length ? (
            <div className="pos-refund-history">
              <h3>Refund history</h3>
              {refunds.map((refund) => (
                <div className="pos-refund-row" key={refund.id}>
                  <div>
                    <strong>-RM{Number(refund.amount).toFixed(2)}</strong>
                    <span>
                      {formatStatus(refund.method)} - {refund.reason}
                    </span>
                  </div>
                  <div>
                    <span>{refund.refundedAt.toLocaleString()}</span>
                    <small>
                      {refund.processedBy?.name ?? "Owner"}
                      {refund.reference ? ` - ${refund.reference}` : ""}
                      {refund.packageUsesRestored
                        ? ` - ${refund.packageUsesRestored} package use restored`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {user.role === "BUSINESS_OWNER" &&
        invoice.status !== "VOID" &&
        refundablePayments.length ? (
          <div className="panel invoice-refund-panel">
            <div className="section-header">
              <div>
                <h2>Refund payment</h2>
                <p className="muted">
                  Refunds change payment totals only. Job and pickup status stay
                  unchanged.
                </p>
              </div>
              <span className="status">Owner only</span>
            </div>
            <div className="refund-payment-list">
              {refundablePayments.map(({ payment, refundableCents }) => (
                <div className="refund-payment-item" key={payment.id}>
                  <div className="refund-payment-heading">
                    <div>
                      <strong>{formatStatus(payment.method)} payment</strong>
                      <span>{payment.paidAt.toLocaleString()}</span>
                    </div>
                    <strong>RM{(refundableCents / 100).toFixed(2)} available</strong>
                  </div>
                  <RefundPaymentForm
                    invoiceId={invoice.id}
                    invoiceNumber={displayInvoiceNumber}
                    paymentId={payment.id}
                    originalMethod={payment.method}
                    refundableAmount={refundableCents / 100}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {invoice.status === "VOID" ? (
          <div className="panel invoice-correction-panel danger-zone">
            <div className="section-header">
              <h2>Void record</h2>
              <span className="status">{formatStatus(invoice.status)}</span>
            </div>
            <p className="muted">
              {invoice.voidReason || "No void reason recorded."}
            </p>
            <p className="muted">
              Voided at: {invoice.voidedAt?.toLocaleString() ?? "Unknown"}
            </p>
            <Link className="button-link" href={`/pos/${invoice.workOrder.id}`}>
              Correct in POS
            </Link>
          </div>
        ) : refunds.length ? (
          <div className="panel invoice-correction-panel danger-zone">
            <div className="section-header">
              <h2>Void invoice</h2>
              <span className="status">Unavailable</span>
            </div>
            <p className="muted">
              This invoice has refund records and cannot be voided. Refund
              history remains permanent for audit accuracy.
            </p>
          </div>
        ) : (
          <div className="panel invoice-correction-panel danger-zone">
            <div className="section-header">
              <h2>Void invoice</h2>
              <span className="status">{formatStatus(invoice.status)}</span>
            </div>
            <p className="muted">
              Use this only when payment was recorded wrongly. Related payments
              will be voided and this job will reopen for POS correction.
            </p>
            <VoidInvoiceForm
              invoiceId={invoice.id}
              invoiceNumber={displayInvoiceNumber}
            />
          </div>
        )}
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
