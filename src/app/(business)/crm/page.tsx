import Link from "next/link";
import { Prisma } from "@prisma/client";
import { CrmActivityItem } from "@/components/crm-activity-item";
import { CrmEditCustomerModal } from "@/components/crm-edit-customer-modal";
import { CrmEditNotesModal } from "@/components/crm-edit-notes-modal";
import { CrmNewCustomerModal } from "@/components/crm-new-customer-modal";
import type { InvoiceModalSummary } from "@/components/appointment-invoice-modal";
import { getActiveBranches } from "@/lib/branches";
import {
  formatDateValue,
  toBusinessDateValue,
  toBusinessTimeValue,
} from "@/lib/business-time";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";
import {
  createCustomerAction,
  updateCustomerNotesAction,
  updateCustomerProfileAction,
} from "./actions";

type CrmPageProps = {
  searchParams: Promise<{
    activityLimit?: string;
    customer?: string;
    page?: string;
    q?: string;
    sort?: string;
    tab?: string;
  }>;
};

type CustomerTab = "overview" | "appointments" | "invoices" | "packages" | "notes";
type CustomerSort = "recent" | "birthday" | "name";

type CrmCustomer = Prisma.CustomerGetPayload<{
  include: {
    membership: true;
    appointments: {
      include: {
        service: true;
        assignedStaff: true;
        invoice: { include: { items: true } };
      };
    };
    invoices: {
      include: {
        items: true;
        payments: { include: { refunds: true } };
      };
    };
    customerPackages: {
      include: {
        package: true;
        serviceBalances: { include: { service: true } };
      };
    };
    whatsappMessages: {
      include: {
        invoice: {
          include: {
            items: true;
            payments: { include: { refunds: true } };
          };
        };
      };
    };
    whatsappChatMessages: true;
  };
}>;

type CrmPayment = Prisma.PaymentGetPayload<{
  include: {
    invoice: {
      include: {
        items: true;
        payments: { include: { refunds: true } };
      };
    };
    customerPackage: { include: { package: true } };
    customerPackageServiceBalance: { include: { service: true } };
    refunds: true;
  };
}>;

type CrmInvoice = CrmCustomer["invoices"][number];

type TimelineItem = {
  amount?: string;
  at: Date;
  description: string;
  href?: string;
  invoice?: InvoiceModalSummary;
  key: string;
  label: string;
  title: string;
  when: string;
};

const CUSTOMERS_PER_PAGE = 30;
const ACTIVITY_STEP = 10;
const MAX_ACTIVITY_LIMIT = 50;

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const context = await requireBusinessIndustryContext("VIEW_CRM");
  const { businessId } = context;
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const sort = getCustomerSort(params.sort);
  const tab = getCustomerTab(params.tab);
  const currentPage = Math.max(1, Number(params.page) || 1);
  const activityLimit = Math.min(
    MAX_ACTIVITY_LIMIT,
    Math.max(ACTIVITY_STEP, Number(params.activityLimit) || ACTIVITY_STEP),
  );
  const skip = (currentPage - 1) * CUSTOMERS_PER_PAGE;
  const normalizedPlate = query ? normalizePlateNumber(query) : "";
  const customerWhere: Prisma.CustomerWhereInput = {
    businessId,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            ...(!isSalonBusiness
              ? [
                  {
                    vehicles: {
                      some: {
                        plateNumber: {
                          contains: normalizedPlate,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  } satisfies Prisma.CustomerWhereInput,
                ]
              : []),
          ],
        }
      : {}),
  };

  const [customerCount, customers, branches] = await Promise.all([
    prisma.customer.count({ where: customerWhere }),
    prisma.customer.findMany({
      where: customerWhere,
      select: {
        id: true,
        name: true,
        phone: true,
        dateOfBirth: true,
        updatedAt: true,
        membership: { select: { pointsBalance: true } },
        _count: {
          select: {
            customerPackages: {
              where: { status: "ACTIVE", remainingUses: { gt: 0 } },
            },
          },
        },
        appointments: {
          where: { status: "COMPLETED" },
          orderBy: { scheduledAt: "desc" },
          take: 1,
          select: { scheduledAt: true },
        },
      },
      orderBy: customerOrderBy(sort),
      skip,
      take: CUSTOMERS_PER_PAGE,
    }),
    getActiveBranches(businessId),
  ]);
  const selectedCustomerId = params.customer || customers[0]?.id;
  const customer = selectedCustomerId
    ? await prisma.customer.findFirst({
        where: { id: selectedCustomerId, businessId },
        include: {
          membership: true,
          appointments: {
            include: {
              service: true,
              assignedStaff: true,
              invoice: { include: { items: true } },
            },
            orderBy: { scheduledAt: "desc" },
            take: 20,
          },
          invoices: {
            include: {
              items: { orderBy: { createdAt: "asc" } },
              payments: {
                include: { refunds: true },
                orderBy: { paidAt: "desc" },
              },
            },
            orderBy: { issuedAt: "desc" },
            take: 20,
          },
          customerPackages: {
            include: {
              package: true,
              serviceBalances: {
                include: { service: true },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { purchasedAt: "desc" },
            take: 20,
          },
          whatsappMessages: {
            include: {
              invoice: {
                include: {
                  items: { orderBy: { createdAt: "asc" } },
                  payments: {
                    include: { refunds: true },
                    orderBy: { paidAt: "desc" },
                  },
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: activityLimit + 1,
          },
          whatsappChatMessages: {
            orderBy: { createdAt: "desc" },
            take: activityLimit + 1,
          },
        },
      })
    : null;

  const payments = customer
    ? await prisma.payment.findMany({
        where: {
          businessId,
          invoice: { customerId: customer.id },
        },
        include: {
          invoice: {
            include: {
              items: { orderBy: { createdAt: "asc" } },
              payments: {
                include: { refunds: true },
                orderBy: { paidAt: "desc" },
              },
            },
          },
          customerPackage: { include: { package: true } },
          customerPackageServiceBalance: { include: { service: true } },
          refunds: true,
        },
        orderBy: { paidAt: "desc" },
        take: activityLimit + 1,
      })
    : [];

  const timeline = customer
    ? buildTimeline({ customer, payments, activityLimit })
    : { items: [], hasMore: false };
  const [totalSpentResult, availablePackageCount, lastVisit] = customer
    ? await Promise.all([
        prisma.invoice.aggregate({
          where: {
            businessId,
            customerId: customer.id,
            status: { not: "VOID" },
          },
          _sum: { paidAmount: true },
        }),
        prisma.customerPackage.count({
          where: {
            businessId,
            customerId: customer.id,
            status: "ACTIVE",
            remainingUses: { gt: 0 },
          },
        }),
        prisma.appointment.findFirst({
          where: {
            businessId,
            customerId: customer.id,
            status: "COMPLETED",
          },
          orderBy: { scheduledAt: "desc" },
          select: { scheduledAt: true },
        }),
      ])
    : [{ _sum: { paidAmount: null } }, 0, null];
  const totalPages = Math.max(1, Math.ceil(customerCount / CUSTOMERS_PER_PAGE));

  return (
    <section className="content crm-page crm-workspace-page">
      <div className="page-header crm-workspace-header">
        <div>
          <h1>CRM</h1>
          <p>{customerCount} customers</p>
        </div>
        <CrmNewCustomerModal
          action={createCustomerAction}
          branches={branches}
          isSalonBusiness={isSalonBusiness}
        />
      </div>

      <div className="crm-workspace">
        <aside className="crm-customer-rail">
          <div className="crm-rail-heading">
            <div>
              <strong>Customers</strong>
              <span>{customerCount} total</span>
            </div>
            <span className="crm-rail-page-count">
              Page {currentPage} of {totalPages}
            </span>
          </div>

          <form action="/crm" className="crm-rail-search">
            <input
              aria-label="Search customers"
              name="q"
              defaultValue={query}
              placeholder="Search name or phone"
            />
            <input name="sort" type="hidden" value={sort} />
            <button type="submit">Search</button>
          </form>

          <nav className="crm-rail-tabs" aria-label="Customer sorting">
            <CrmSortLink current={sort} label="Recently" sort="recent" query={query} />
            <CrmSortLink current={sort} label="Birthday" sort="birthday" query={query} />
            <CrmSortLink current={sort} label="Name" sort="name" query={query} />
          </nav>

          <div className="crm-customer-list">
            {customers.map((item) => {
              const isSelected = item.id === customer?.id;
              return (
                <Link
                  className={`crm-customer-list-item${isSelected ? " is-selected" : ""}`}
                  href={makeCrmHref({
                    customer: item.id,
                    q: query,
                    sort,
                    page: currentPage,
                  })}
                  key={item.id}
                >
                  <span className="crm-customer-avatar">{initials(item.name)}</span>
                  <span className="crm-customer-list-copy">
                    <strong>{item.name}</strong>
                    <small>{item.phone}</small>
                    <span>
                      {sort === "birthday" && item.dateOfBirth
                        ? `Birthday ${formatBirthday(item.dateOfBirth)}`
                        : item.appointments[0]
                          ? `Last visit ${formatBusinessDateTime(item.appointments[0].scheduledAt)}`
                          : "No visits yet"}
                    </span>
                  </span>
                  <span className="crm-customer-list-stats">
                    <strong>{item.membership?.pointsBalance ?? 0}</strong>
                    <small>points</small>
                    <span>{item._count.customerPackages} packages</span>
                  </span>
                </Link>
              );
            })}
            {!customers.length ? <p className="empty-state">No customers found.</p> : null}
          </div>

          {totalPages > 1 ? (
            <nav className="crm-rail-pagination" aria-label="Customer pages">
              <Link
                aria-disabled={currentPage <= 1}
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeCrmHref({ q: query, sort, page: currentPage - 1 })}
              >
                Previous
              </Link>
              <span>{currentPage} / {totalPages}</span>
              <Link
                aria-disabled={currentPage >= totalPages}
                className={currentPage >= totalPages ? "disabled" : ""}
                href={makeCrmHref({ q: query, sort, page: currentPage + 1 })}
              >
                Next
              </Link>
            </nav>
          ) : null}
        </aside>

        <main className="crm-customer-detail">
          {customer ? (
            <CustomerWorkspace
              activityLimit={activityLimit}
              availablePackageCount={availablePackageCount}
              branches={branches}
              customer={customer}
              currentPage={currentPage}
              isSalonBusiness={isSalonBusiness}
              lastVisitAt={lastVisit?.scheduledAt ?? null}
              query={query}
              sort={sort}
              tab={tab}
              timeline={timeline}
              totalSpent={Number(totalSpentResult._sum.paidAmount ?? 0)}
            />
          ) : (
            <div className="crm-detail-empty">
              <strong>Select a customer</strong>
              <span>Customer details and activity will appear here.</span>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

type CustomerWorkspaceProps = {
  activityLimit: number;
  availablePackageCount: number;
  branches: Awaited<ReturnType<typeof getActiveBranches>>;
  currentPage: number;
  customer: CrmCustomer;
  isSalonBusiness: boolean;
  lastVisitAt: Date | null;
  query: string;
  sort: CustomerSort;
  tab: CustomerTab;
  timeline: ReturnType<typeof buildTimeline>;
  totalSpent: number;
};

function CustomerWorkspace({
  activityLimit,
  availablePackageCount,
  branches,
  currentPage,
  customer,
  isSalonBusiness,
  lastVisitAt,
  query,
  sort,
  tab,
  timeline,
  totalSpent,
}: CustomerWorkspaceProps) {
  return (
    <>
      <header className="crm-detail-summary">
        <div className="crm-detail-identity">
          <span className="crm-customer-avatar is-large">{initials(customer.name)}</span>
          <div>
            <h2>{customer.name}</h2>
            <p>{customer.phone}</p>
          </div>
          <CrmEditCustomerModal
            action={updateCustomerProfileAction}
            branches={branches}
            customer={{
              id: customer.id,
              branchId: customer.branchId,
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              dateOfBirth: customer.dateOfBirth,
              notes: customer.notes,
              preferences: customer.preferences,
              treatmentNotes: customer.treatmentNotes,
            }}
            isSalonBusiness={isSalonBusiness}
            returnPath={makeCrmHref({
              activityLimit,
              customer: customer.id,
              page: currentPage,
              q: query,
              sort,
              tab,
            })}
          />
        </div>
        <div className="crm-summary-metrics">
          <SummaryMetric label="Loyalty points" value={`${customer.membership?.pointsBalance ?? 0} pts`} />
          <SummaryMetric label="Available packages" value={`${availablePackageCount} packages`} />
          <SummaryMetric label="Total spent" value={formatCurrency(totalSpent)} />
          <SummaryMetric label="Last visit" value={lastVisitAt ? formatBusinessDateTime(lastVisitAt) : "No visits"} />
        </div>
      </header>

      <nav className="crm-detail-tabs" aria-label="Customer details">
        {(["overview", "appointments", "invoices", "packages", "notes"] as const).map((item) => (
          <Link
            className={tab === item ? "is-active" : ""}
            href={makeCrmHref({
              customer: customer.id,
              q: query,
              sort,
              page: currentPage,
              tab: item,
            })}
            key={item}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </Link>
        ))}
      </nav>

      <div className="crm-detail-body">
        {tab === "overview" ? (
          <section className="crm-tab-section">
            <div className="crm-section-heading">
              <div>
                <h3>Recent activity</h3>
                <p>Appointments, payments, vouchers, refunds and WhatsApp.</p>
              </div>
              <span>{Math.min(activityLimit, timeline.items.length)} shown</span>
            </div>
            <div className="crm-activity-list">
              {timeline.items.map((item) => (
                <CrmActivityItem {...item} key={item.key} />
              ))}
              {!timeline.items.length ? <p className="empty-state">No activity yet.</p> : null}
            </div>
            {timeline.hasMore && activityLimit < MAX_ACTIVITY_LIMIT ? (
              <Link
                className="crm-view-more"
                href={makeCrmHref({
                  customer: customer.id,
                  q: query,
                  sort,
                  page: currentPage,
                  activityLimit: activityLimit + ACTIVITY_STEP,
                })}
              >
                View more
              </Link>
            ) : null}
          </section>
        ) : null}

        {tab === "appointments" ? (
          <section className="crm-tab-section">
            <div className="crm-section-heading"><h3>Appointments</h3><span>Latest 20</span></div>
            <div className="crm-detail-list">
              {customer.appointments.map((appointment) => (
                <Link
                  href={`/appointments?status=active&page=1&date=${toBusinessDateValue(appointment.scheduledAt)}&appointment=${appointment.id}`}
                  key={appointment.id}
                >
                  <span><strong>{appointmentTitle(appointment)}</strong><small>{appointment.assignedStaff?.name ?? "Unassigned staff"}</small></span>
                  <span><strong>{formatStatus(appointment.status)}</strong><small>{formatBusinessDateTime(appointment.scheduledAt)}</small></span>
                </Link>
              ))}
              {!customer.appointments.length ? <p className="empty-state">No appointments yet.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "invoices" ? (
          <section className="crm-tab-section">
            <div className="crm-section-heading"><h3>Invoices</h3><span>Latest 20</span></div>
            <div className="crm-activity-list">
              {customer.invoices.map((invoice) => (
                <CrmActivityItem
                  amount={formatCurrency(invoice.total)}
                  description={`${formatStatus(invoice.status)} / ${formatBusinessDateTime(invoice.issuedAt)}`}
                  invoice={toInvoiceSummary(invoice, customer.name, customer.phone)}
                  key={invoice.id}
                  label="Invoice"
                  title={invoice.invoiceNumber}
                  when={formatBusinessDateTime(invoice.issuedAt)}
                />
              ))}
              {!customer.invoices.length ? <p className="empty-state">No invoices yet.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "packages" ? (
          <section className="crm-tab-section">
            <div className="crm-section-heading"><h3>Packages</h3><span>{customer.customerPackages.length} records</span></div>
            <div className="crm-detail-list crm-package-list">
              {customer.customerPackages.map((item) => (
                <div key={item.id}>
                  <span><strong>{item.package.name}</strong><small>Purchased {formatBusinessDateTime(item.purchasedAt)}</small></span>
                  <span><strong>{item.remainingUses} / {item.totalUses} uses</strong><small>{formatStatus(item.status)} / {formatCurrency(item.purchasePrice)}</small></span>
                  {item.serviceBalances.length ? (
                    <p>{item.serviceBalances.map((balance) => `${balance.service.name}: ${balance.remainingUses}/${balance.totalUses}`).join(" / ")}</p>
                  ) : null}
                </div>
              ))}
              {!customer.customerPackages.length ? <p className="empty-state">No packages yet.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "notes" ? (
          <section className="crm-tab-section">
            <div className="crm-section-heading">
              <h3>Customer notes</h3>
              <CrmEditNotesModal
                action={updateCustomerNotesAction}
                customerId={customer.id}
                customerName={customer.name}
                notes={customer.notes}
                preferences={customer.preferences}
                treatmentNotes={customer.treatmentNotes}
              />
            </div>
            <div className="crm-notes-list">
              <NoteRow label="General notes" value={customer.notes} />
              <NoteRow label="Preferences" value={customer.preferences} />
              <NoteRow label="Treatment notes" value={customer.treatmentNotes} />
              <NoteRow label="Date of birth" value={customer.dateOfBirth ? formatBirthday(customer.dateOfBirth) : null} />
              {!isSalonBusiness ? <NoteRow label="Industry profile" value="Vehicle records remain available in the full customer profile." /> : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function NoteRow({ label, value }: { label: string; value: string | null }) {
  return <div><strong>{label}</strong><p>{value || "Not provided"}</p></div>;
}

function CrmSortLink({ current, label, query, sort }: { current: CustomerSort; label: string; query: string; sort: CustomerSort }) {
  return <Link className={current === sort ? "is-active" : ""} href={makeCrmHref({ q: query, sort })}>{label}</Link>;
}

function customerOrderBy(sort: CustomerSort): Prisma.CustomerOrderByWithRelationInput[] {
  if (sort === "name") return [{ name: "asc" }, { createdAt: "desc" }];
  if (sort === "birthday") return [{ dateOfBirth: { sort: "asc", nulls: "last" } }, { name: "asc" }];
  return [{ updatedAt: "desc" }, { createdAt: "desc" }];
}

function getCustomerSort(value?: string): CustomerSort {
  return value === "birthday" || value === "name" ? value : "recent";
}

function getCustomerTab(value?: string): CustomerTab {
  return value === "appointments" || value === "invoices" || value === "packages" || value === "notes" ? value : "overview";
}

function makeCrmHref(input: { activityLimit?: number; customer?: string; page?: number; q?: string; sort?: CustomerSort; tab?: CustomerTab }) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.sort && input.sort !== "recent") params.set("sort", input.sort);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.customer) params.set("customer", input.customer);
  if (input.tab && input.tab !== "overview") params.set("tab", input.tab);
  if (input.activityLimit && input.activityLimit > ACTIVITY_STEP) params.set("activityLimit", String(input.activityLimit));
  const query = params.toString();
  return query ? `/crm?${query}` : "/crm";
}

type TimelineInput = {
  activityLimit: number;
  customer: CrmCustomer;
  payments: CrmPayment[];
};

function buildTimeline({ customer, payments, activityLimit }: TimelineInput) {
  const activities: TimelineItem[] = [];

  for (const appointment of customer.appointments) {
    activities.push({
      at: appointment.scheduledAt,
      description: `${formatStatus(appointment.status)} / ${appointment.assignedStaff?.name ?? "Unassigned staff"}`,
      href: `/appointments?status=active&page=1&date=${toBusinessDateValue(appointment.scheduledAt)}&appointment=${appointment.id}`,
      key: `appointment-${appointment.id}`,
      label: "Appointment",
      title: appointmentTitle(appointment),
      when: formatBusinessDateTime(appointment.scheduledAt),
    });
  }

  for (const payment of payments) {
    const isVoucher = payment.method === "PACKAGE" || payment.packageUses > 0;
    const invoice = payment.invoice
      ? toInvoiceSummary(payment.invoice, customer.name, customer.phone)
      : undefined;
    activities.push({
      amount: isVoucher ? `${payment.packageUses} use${payment.packageUses === 1 ? "" : "s"}` : formatCurrency(payment.amount),
      at: payment.paidAt,
      description: isVoucher
        ? payment.customerPackageServiceBalance?.service.name ?? payment.customerPackage?.package.name ?? "Customer package"
        : `${formatPaymentMethod(payment.method)} / ${payment.invoice?.invoiceNumber ?? "Payment"}`,
      invoice,
      key: `payment-${payment.id}`,
      label: isVoucher ? "Voucher" : "Payment",
      title: isVoucher ? "Package voucher redeemed" : "Payment received",
      when: formatBusinessDateTime(payment.paidAt),
    });
    for (const refund of payment.refunds) {
      activities.push({
        amount: `-${formatCurrency(refund.amount)}`,
        at: refund.refundedAt,
        description: `${refund.reason} / ${formatPaymentMethod(refund.method)}`,
        invoice,
        key: `refund-${refund.id}`,
        label: "Refund",
        title: "Payment refunded",
        when: formatBusinessDateTime(refund.refundedAt),
      });
    }
  }

  for (const message of customer.whatsappMessages) {
    activities.push({
      at: message.createdAt,
      description: `${formatStatus(message.messageType)} / ${formatStatus(message.status)}`,
      href: message.appointmentId
        ? `/appointments?status=active&page=1&date=${toBusinessDateValue(message.createdAt)}&appointment=${message.appointmentId}`
        : undefined,
      invoice: message.invoice
        ? toInvoiceSummary(message.invoice, customer.name, customer.phone)
        : undefined,
      key: `whatsapp-${message.id}`,
      label: "WhatsApp",
      title: message.messageBody.slice(0, 80) || "WhatsApp message",
      when: formatBusinessDateTime(message.createdAt),
    });
  }

  for (const message of customer.whatsappChatMessages) {
    activities.push({
      at: message.createdAt,
      description: `${formatStatus(message.direction)} / ${formatStatus(message.status)}`,
      key: `chat-${message.id}`,
      label: "WhatsApp",
      title: message.body.slice(0, 80) || formatStatus(message.messageType),
      when: formatBusinessDateTime(message.createdAt),
    });
  }

  activities.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: activities.slice(0, activityLimit), hasMore: activities.length > activityLimit };
}

function toInvoiceSummary(invoice: CrmInvoice, customerName: string, customerPhone: string): InvoiceModalSummary {
  const activePayments = invoice.payments.filter((payment) => payment.status === "ACTIVE");
  const packageVoucherAmount = activePayments
    .filter((payment) => payment.method === "PACKAGE")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const cashPaidAmount = activePayments
    .filter((payment) => payment.method !== "PACKAGE")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issuedAt: invoice.issuedAt.toISOString(),
    customerName,
    customerPhone,
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
    packageVoucherAmount,
    cashPaidAmount,
  };
}

function appointmentTitle(appointment: CrmCustomer["appointments"][number]) {
  const invoiceNames = appointment.invoice?.items.map((item) => item.name).filter(Boolean) ?? [];
  return Array.from(new Set(invoiceNames)).join(", ") || appointment.service?.name || "Appointment";
}

function formatBusinessDateTime(value: Date) {
  const date = formatDateValue(toBusinessDateValue(value), { day: "2-digit", month: "short", year: "numeric" });
  const [hourText, minuteText] = toBusinessTimeValue(value).split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "pm" : "am";
  return `${date}, ${hour % 12 || 12}:${minuteText} ${suffix}`;
}

function formatBirthday(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

function formatCurrency(value: number | { toString(): string }) {
  return `RM${Number(value).toFixed(2)}`;
}

function formatStatus(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function formatPaymentMethod(value: string) {
  return value === "BANK_TRANSFER" ? "Bank" : value === "EWALLET" ? "E-Wallet" : formatStatus(value);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "C";
}
