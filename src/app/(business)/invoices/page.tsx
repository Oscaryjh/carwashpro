import Link from "next/link";
import { Prisma } from "@prisma/client";
import { InvoiceViewButton } from "@/components/invoice-view-button";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { getInvoicePaymentSummary } from "@/lib/invoices/payment-summary";
import { prisma } from "@/lib/prisma";
import { getRefundableCents } from "@/lib/refunds/rules";

type InvoicesPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

const PAGE_SIZE = 10;

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const context = await requireBusinessIndustryContext();
  const { businessId, user } = context;
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const currentPage = Math.max(Number(params.page) || 1, 1);
  const where: Prisma.InvoiceWhereInput = {
    businessId,
    ...(query
      ? {
          OR: [
            { invoiceNumber: { contains: query, mode: "insensitive" } },
            { workOrder: { orderNumber: { contains: query, mode: "insensitive" } } },
            { workOrder: { customer: { name: { contains: query, mode: "insensitive" } } } },
            { workOrder: { customer: { phone: { contains: query } } } },
            { workOrder: { vehicle: { plateNumber: { contains: query, mode: "insensitive" } } } },
            { appointment: { customer: { name: { contains: query, mode: "insensitive" } } } },
            { appointment: { customer: { phone: { contains: query } } } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { customer: { phone: { contains: query } } },
            { customerPackage: { package: { name: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  } as const;

  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
          },
        },
        appointment: {
          include: {
            customer: true,
          },
        },
        customer: true,
        customerPackage: { include: { package: true } },
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            productId: true,
          },
          orderBy: { createdAt: "asc" },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            refunds: {
              select: { amount: true },
            },
          },
          orderBy: { paidAt: "desc" },
        },
      },
      orderBy: { issuedAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
  ]);
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Invoices</h1>
            <p>
              {totalCount
                ? `Showing ${firstItem}-${lastItem} of ${totalCount} invoice${totalCount === 1 ? "" : "s"}${query ? ` for "${query}"` : ""}.`
                : query
                  ? `No invoices found for "${query}".`
                  : isSalonBusiness
                    ? "Invoices generated from appointments and cashier payments."
                    : "Invoices generated from cashier payments."}
            </p>
          </div>
        </div>

        <div className="panel">
          <form className="search-form invoice-search-form" action="/invoices">
            <input
              name="q"
              defaultValue={query}
              placeholder={
                isSalonBusiness
                  ? "Search invoice, appointment, customer, or phone"
                  : "Search invoice, job, plate, customer, or phone"
              }
            />
            <button type="submit">Search</button>
            {query ? (
              <Link className="secondary-link-button" href="/invoices">
                Clear
              </Link>
            ) : null}
          </form>
          {invoices.length ? (
            <table className="table invoices-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>{isSalonBusiness ? "Reference" : context.industry.subjectLabel}</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Issued</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice, index) => {
                  const paymentSummary = getInvoicePaymentSummary(invoice.payments);
                  const refundablePayments = invoice.payments
                    .filter((payment) => payment.status === "ACTIVE")
                    .map((payment) => ({
                      id: payment.id,
                      method: payment.method,
                      refundableAmount:
                        getRefundableCents(
                          Math.round(Number(payment.amount) * 100),
                          payment.refunds.map((refund) =>
                            Math.round(Number(refund.amount) * 100),
                          ),
                        ) / 100,
                    }))
                    .filter((payment) => payment.refundableAmount > 0);
                  const hasRefunds = invoice.payments.some(
                    (payment) => payment.refunds.length > 0,
                  );
                  const hasProductItems = invoice.items.some((item) => item.productId);
                  const hasPurchasedPackages = Boolean(invoice.customerPackage);
                  const supportsVoid = Boolean(
                    invoice.workOrder ||
                    (invoice.appointment && !hasProductItems && !hasPurchasedPackages),
                  );
                  const canManagePayments = user.role === "BUSINESS_OWNER";
                  const canVoid = Boolean(
                    canManagePayments &&
                    invoice.status !== "VOID" &&
                    invoice.status !== "REFUNDED" &&
                    !hasRefunds &&
                    supportsVoid,
                  );
                  const voidUnavailableReason = !canManagePayments
                    ? null
                    : invoice.status === "VOID"
                      ? "This invoice has already been voided."
                      : invoice.status === "REFUNDED"
                        ? "Refunded invoices cannot be voided."
                      : hasRefunds
                        ? "This invoice has refund records and cannot be voided."
                        : !supportsVoid
                          ? "Void is unavailable for product sales and package purchases. Use Refund instead."
                          : null;

                  return (
                  <tr key={invoice.id}>
                    <td className="table-number">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td>
                      <strong>{formatInvoiceNumber(invoice.invoiceNumber)}</strong>
                      <div className="muted">
                        {isSalonBusiness
                          ? invoice.appointment
                            ? `${context.industry.orderLabel} record`
                            : invoice.workOrder
                              ? "Service order"
                              : invoice.items.length
                                ? invoice.items
                                    .map((item) => `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ""}`)
                                    .join(", ")
                                : invoice.customerPackage?.package.name ?? "Package purchase"
                          : invoice.workOrder?.orderNumber ??
                            (invoice.appointment
                              ? `${context.industry.orderLabel} record`
                              : null) ??
                            (invoice.items.length
                              ? invoice.items
                                  .map((item) => `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ""}`)
                                  .join(", ")
                              : invoice.customerPackage?.package.name) ??
                            "Package purchase"}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {invoice.workOrder?.customer.name ??
                          invoice.appointment?.customer.name ??
                          invoice.customer?.name ??
                          "-"}
                      </strong>
                      <div className="muted">
                        {invoice.workOrder?.customer.phone ??
                          invoice.appointment?.customer.phone ??
                          invoice.customer?.phone ??
                          "-"}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {isSalonBusiness
                          ? invoice.appointment
                            ? context.industry.orderLabel
                            : invoice.workOrder
                              ? "Service order"
                              : "-"
                          : invoice.workOrder?.vehicle.plateNumber ??
                            (invoice.appointment ? context.industry.orderLabel : "-")}
                      </strong>
                    </td>
                    <td>
                      <span className={`status ${invoice.status.toLowerCase()}`}>
                        {formatStatus(invoice.status)}
                      </span>
                    </td>
                    <td>RM{Number(invoice.total).toFixed(2)}</td>
                    <td>RM{Number(invoice.balance).toFixed(2)}</td>
                    <td>{formatDateTime(invoice.issuedAt)}</td>
                    <td>
                      <InvoiceViewButton
                        invoice={{
                          id: invoice.id,
                          invoiceNumber: invoice.invoiceNumber,
                          status: invoice.status,
                          issuedAt: invoice.issuedAt.toISOString(),
                          customerName:
                            invoice.workOrder?.customer.name ??
                            invoice.appointment?.customer.name ??
                            invoice.customer?.name ??
                            "Walk-in customer",
                          customerPhone:
                            invoice.workOrder?.customer.phone ??
                            invoice.appointment?.customer.phone ??
                            invoice.customer?.phone ??
                            "Not provided",
                          items: invoice.items.map((item) => ({
                            id: item.id,
                            name: item.name,
                            quantity: item.quantity,
                            unitPrice: Number(item.unitPrice),
                            lineTotal: Number(item.lineTotal),
                          })),
                          subtotal: Number(invoice.subtotal),
                          discountAmount: Number(invoice.discountAmount),
                          tipAmount: Number(invoice.tipAmount),
                          taxAmount: Number(invoice.taxAmount),
                          taxRate: Number(invoice.taxRate),
                          taxLabel: invoice.taxLabel,
                          total: Number(invoice.total),
                          paidAmount: Number(invoice.paidAmount),
                          balance: Number(invoice.balance),
                          packageVoucherAmount: paymentSummary.packageVoucherAmount,
                          cashPaidAmount: paymentSummary.cashPaidAmount,
                          canManagePayments,
                          canVoid,
                          voidUnavailableReason,
                          refundablePayments,
                        }}
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No invoices yet.</p>
          )}

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeInvoicesHref({
                  q: query,
                  page: Math.max(currentPage - 1, 1),
                })}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                className={currentPage >= totalPages ? "disabled" : ""}
                href={makeInvoicesHref({
                  q: query,
                  page: Math.min(currentPage + 1, totalPages),
                })}
              >
                Next
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeInvoicesHref(input: { page: number; q: string }) {
  const params = new URLSearchParams();

  if (input.q) {
    params.set("q", input.q);
  }

  if (input.page > 1) {
    params.set("page", String(input.page));
  }

  const query = params.toString();
  return query ? `/invoices?${query}` : "/invoices";
}
