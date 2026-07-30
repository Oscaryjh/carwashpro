import Link from "next/link";
import { AppointmentStatus, Prisma } from "@prisma/client";
import {
  AppointmentCalendar,
  type AppointmentCalendarItem,
} from "@/components/appointment-calendar";
import {
  buildAppointmentStaffWhere,
  NO_APPOINTMENT_BRANCH_ID,
} from "@/lib/appointments/staff-branch-scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import {
  addDaysToDateValue,
  addMonthsToDateValue,
  formatDateValue,
  getBusinessTodayDateValue,
  isValidDateValue,
  parseBusinessDateTime,
  startOfBusinessMonth,
  startOfBusinessWeek,
  toBusinessDateValue,
  toBusinessTimeValue,
} from "@/lib/business-time";
import { getInvoicePaymentSummary } from "@/lib/invoices/payment-summary";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  SALON_APPOINTMENT_CALENDAR_STATUSES,
  formatAppointmentStatus,
} from "@/lib/validation/appointments";
import {
  convertAppointmentToJobAction,
  createAppointmentInlineAction,
  rescheduleAppointmentAction,
  updateAppointmentDetailsAction,
  updateAppointmentStatusAction,
} from "./actions";

type AppointmentsPageProps = {
  searchParams: Promise<{
    appointment?: string;
    date?: string;
    message?: string;
    page?: string;
    q?: string;
    status?: string;
    type?: string;
  }>;
};

const PAGE_SIZE = 20;
const statusFilters = [
  { value: "active", label: "Active" },
  { value: "today", label: "Today" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "history", label: "History" },
] as const;

export default async function AppointmentsPage({
  searchParams,
}: AppointmentsPageProps) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("VIEW_APPOINTMENTS");
  const resolvedIndustryType = industryType ?? "AUTO_DETAILING";
  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const showPageMessage =
    message && message !== "Customer is required." && message !== "Vehicle is required.";
  const rawSearch = (params.q ?? "").trim();
  const status = getValidStatus(params.status);
  const currentPage = Math.max(1, Number(params.page) || 1);
  const selectedDateValue = isValidDateValue(params.date ?? "")
    ? params.date!
    : getBusinessTodayDateValue();
  const calendarStartValue = startOfBusinessWeek(selectedDateValue);
  const calendarEndValue = addDaysToDateValue(calendarStartValue, 7);
  const calendarStart = parseBusinessDateTime(calendarStartValue, "00:00");
  const calendarEnd = parseBusinessDateTime(calendarEndValue, "00:00");
  const calendarStatuses: AppointmentStatus[] =
    resolvedIndustryType === "SALON_BEAUTY"
      ? [...SALON_APPOINTMENT_CALENDAR_STATUSES]
      : [
          "SCHEDULED",
          "CONFIRMED",
          "ARRIVED",
          "IN_SERVICE",
          "COMPLETED",
          "CONVERTED_TO_JOB",
        ];
  const datePickerMonthStartValue = startOfBusinessMonth(selectedDateValue);
  const datePickerRangeStartValue = startOfBusinessWeek(
    addMonthsToDateValue(datePickerMonthStartValue, -6),
  );
  const datePickerRangeEndValue = addDaysToDateValue(
    startOfBusinessWeek(addMonthsToDateValue(datePickerMonthStartValue, 7)),
    42,
  );
  const datePickerRangeStart = parseBusinessDateTime(datePickerRangeStartValue, "00:00");
  const datePickerRangeEnd = parseBusinessDateTime(datePickerRangeEndValue, "00:00");
  const staffBranchId =
    access.source === "GROUP_ACCESS" || user.role === "BUSINESS_OWNER"
      ? null
      : user.branchId ?? "00000000-0000-0000-0000-000000000000";
  const where = buildAppointmentWhere({
    businessId,
    branchId: staffBranchId,
    rawSearch,
    status,
    industryType: resolvedIndustryType,
  });

  const staffWhere =
    access.source === "GROUP_ACCESS" || user.role === "BUSINESS_OWNER"
      ? { businessId, status: "active" as const, appointmentBookable: true }
      : buildAppointmentStaffWhere({
          at: new Date(),
          branchId: user.branchId ?? NO_APPOINTMENT_BRANCH_ID,
          businessId,
          includeUserId: user.userId,
        });
  const [
    appointments,
    totalCount,
    calendarAppointments,
    datePickerAppointments,
    recentServiceAppointments,
    branches,
    services,
    products,
    packages,
    staffUsers,
  ] =
    await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          branch: true,
          customer: true,
          service: true,
          vehicle: true,
          workOrder: true,
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
        skip: (currentPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.appointment.count({ where }),
      prisma.appointment.findMany({
        where: {
          businessId,
          ...(staffBranchId ? { branchId: staffBranchId } : {}),
          OR: [
            { status: { in: calendarStatuses } },
            ...(params.appointment ? [{ id: params.appointment }] : []),
          ],
          scheduledAt: {
            gte: calendarStart,
            lt: calendarEnd,
          },
        },
        include: {
          customer: true,
          invoice: {
            select: {
              balance: true,
              discountAmount: true,
              id: true,
              invoiceNumber: true,
              issuedAt: true,
              items: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  lineTotal: true,
                  name: true,
                  quantity: true,
                  unitPrice: true,
                },
              },
              payments: {
                select: {
                  amount: true,
                  method: true,
                  status: true,
                  refunds: { select: { amount: true } },
                },
              },
              paidAmount: true,
              status: true,
              subtotal: true,
              taxAmount: true,
              taxLabel: true,
              taxRate: true,
              tipAmount: true,
              total: true,
            },
          },
          service: true,
          vehicle: true,
          workOrder: {
            select: {
              paymentStatus: true,
              status: true,
            },
          },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      }),
      prisma.appointment.findMany({
        where: {
          businessId,
          ...(staffBranchId ? { branchId: staffBranchId } : {}),
          status: {
            in: resolvedIndustryType === "SALON_BEAUTY"
              ? [...SALON_APPOINTMENT_CALENDAR_STATUSES]
              : [
                  "SCHEDULED",
                  "CONFIRMED",
                  "ARRIVED",
                  "IN_SERVICE",
                  "COMPLETED",
                  "CONVERTED_TO_JOB",
                ],
          },
          scheduledAt: {
            gte: datePickerRangeStart,
            lt: datePickerRangeEnd,
          },
        },
        select: {
          scheduledAt: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          businessId,
          ...(staffBranchId ? { branchId: staffBranchId } : {}),
          status: {
            notIn: ["CANCELLED", "NO_SHOW"],
          },
        },
        orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          serviceId: true,
          serviceIds: true,
        },
      }),
      getOperationalBranches(businessId, user),
      prisma.service.findMany({
        where: {
          businessId,
          status: "ACTIVE",
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          durationMinutes: true,
          taxable: true,
          taxRate: true,
          staffAssignments: {
            select: {
              userId: true,
            },
          },
          serviceCategory: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.product.findMany({
        where: { businessId, status: "ACTIVE" },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          taxable: true,
          taxRate: true,
          productCategory: { select: { name: true } },
        },
      }),
      prisma.package.findMany({
        where: {
          businessId,
          status: "ACTIVE",
          ...(staffBranchId ? { OR: [{ branchId: null }, { branchId: staffBranchId }] } : {}),
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          price: true,
          totalUses: true,
          packageCategory: { select: { name: true } },
          service: { select: { taxable: true, taxRate: true } },
        },
      }),
      prisma.user.findMany({
        where: staffWhere,
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          role: true,
        },
      }),
    ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);
  const assignedStaffNames = await getAssignedStaffNames(
    [...appointments, ...calendarAppointments].map((appointment) => appointment.id),
    businessId,
  );
  const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
  const recentServiceIds = rankRecentServiceIds(recentServiceAppointments, 5);
  const serviceDetailById = new Map(
    services.map((service) => [
      service.id,
      {
        id: service.id,
        name: service.name,
        price: Number(service.price).toFixed(2),
        taxable: service.taxable,
        taxRate: service.taxRate == null ? null : Number(service.taxRate),
      },
    ]),
  );
  const productDetailById = new Map(
    products.map((product) => [
      product.id,
      {
        id: product.id,
        name: product.name,
        price: Number(product.price).toFixed(2),
        category: product.productCategory?.name ?? product.category ?? "Products",
        taxable: product.taxable,
        taxRate: product.taxRate == null ? null : Number(product.taxRate),
      },
    ]),
  );
  const packageDetailById = new Map(
    packages.map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        price: Number(item.price).toFixed(2),
        category: item.packageCategory?.name ?? "Packages",
        totalUses: item.totalUses,
        taxable: item.service?.taxable ?? true,
        taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
      },
    ]),
  );
  const appointmentCountByDay = countAppointmentsByDay(
    calendarAppointments.map((appointment) => appointment.scheduledAt),
  );
  const calendarDays = Array.from({ length: 7 }, (_, index) => {
    const dateValue = addDaysToDateValue(calendarStartValue, index);

    return {
      count: appointmentCountByDay.get(dateValue) ?? 0,
      date: dateValue,
      label: formatDateValue(dateValue, {
        day: "2-digit",
        month: "short",
      }),
      shortLabel: formatDateValue(dateValue, {
        weekday: "short",
      }),
    };
  });
  const datePickerCountByDay = countAppointmentsByDay(
    datePickerAppointments.map((appointment) => appointment.scheduledAt),
  );
  const datePickerCounts = [...datePickerCountByDay].map(([date, count]) => ({
    count,
    date,
  }));
  const previousWeekValue = addDaysToDateValue(calendarStartValue, -7);
  const nextWeekValue = addDaysToDateValue(calendarStartValue, 7);

  return (
    <>
      <section className="content appointments-page">
        <div className="page-header">
          <div>
            <h1>Appointments</h1>
            <p>
              {totalCount
                ? `Showing ${firstItem}-${lastItem} of ${totalCount} appointments`
                : "No appointments match this view"}
            </p>
          </div>
        </div>

        {showPageMessage ? <div className={messageType}>{message}</div> : null}

        <div className="panel appointment-calendar-panel">
          <AppointmentCalendar
            appointments={calendarAppointments.map((appointment) =>
              toCalendarItem(
                appointment,
                assignedStaffNames,
                serviceNameById,
                serviceDetailById,
                productDetailById,
                packageDetailById,
              ),
            )}
            branches={branches.map((branch) => ({
              id: branch.id,
              name: branch.name,
            }))}
            catalogDiscounts={[]}
            isSalonBusiness={resolvedIndustryType === "SALON_BEAUTY"}
            initialAppointmentId={params.appointment}
            createAppointmentAction={createAppointmentInlineAction}
            convertAppointmentAction={convertAppointmentToJobAction}
            datePickerCounts={datePickerCounts}
            datePickerHrefPrefix={makeAppointmentDateHrefPrefix({
              q: rawSearch,
              status,
            })}
            days={calendarDays}
            nextHref={makeAppointmentHref({
              date: nextWeekValue,
              q: rawSearch,
              status,
              page: 1,
            })}
            previousHref={makeAppointmentHref({
              date: previousWeekValue,
              q: rawSearch,
              status,
              page: 1,
            })}
            rescheduleAction={rescheduleAppointmentAction}
            selectedDateLabel={formatDateValue(selectedDateValue, {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
            selectedDateValue={selectedDateValue}
            recentServiceIds={recentServiceIds}
            services={services.map((service) => ({
              id: service.id,
              category: service.serviceCategory?.name ?? service.category ?? "Services",
              durationMinutes: service.durationMinutes,
              name: service.name,
              price: Number(service.price).toFixed(2),
              staffIds: service.staffAssignments.map((assignment) => assignment.userId),
              taxable: service.taxable,
              taxRate: service.taxRate == null ? null : Number(service.taxRate),
            }))}
            products={products.map((product) => ({
              id: product.id,
              category: product.productCategory?.name ?? product.category ?? "Products",
              name: product.name,
              price: Number(product.price).toFixed(2),
              taxable: product.taxable,
              taxRate: product.taxRate == null ? null : Number(product.taxRate),
            }))}
            packages={packages.map((item) => ({
              id: item.id,
              category: item.packageCategory?.name ?? "Packages",
              name: item.name,
              price: Number(item.price).toFixed(2),
              totalUses: item.totalUses,
              taxable: item.service?.taxable ?? true,
              taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
            }))}
            staffMembers={staffUsers}
            updateAppointmentAction={updateAppointmentDetailsAction}
            updateAppointmentStatusAction={updateAppointmentStatusAction}
          />
        </div>

        <div className="panel appointment-list-panel is-hidden">
          <div className="filter-tabs" aria-label="Appointment filters">
            {statusFilters.map((item) => (
              <Link
                className={item.value === status ? "active" : ""}
                href={makeAppointmentHref({
                  date: selectedDateValue,
                  q: rawSearch,
                  status: item.value,
                  page: 1,
                })}
                key={item.value}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <form className="search-form" action="/appointments">
            <input type="hidden" name="date" value={selectedDateValue} />
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              placeholder={
                resolvedIndustryType === "SALON_BEAUTY"
                  ? "Search customer, phone, or service"
                  : "Search customer, phone, plate, or service"
              }
              defaultValue={rawSearch}
            />
            <button type="submit">Search</button>
          </form>

          {appointments.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Customer</th>
                  {resolvedIndustryType !== "SALON_BEAUTY" ? <th>Vehicle</th> : null}
                  <th>Service</th>
                  <th>Staff</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment, index) => (
                  <tr key={appointment.id}>
                    <td className="table-number">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td>
                      <strong>{appointment.customer.name}</strong>
                      <div className="work-order-subtext">
                        {appointment.customer.phone}
                      </div>
                    </td>
                    {resolvedIndustryType !== "SALON_BEAUTY" ? (
                      <td>
                        <strong className="work-order-primary-text">
                          {appointment.vehicle?.plateNumber ?? "Customer appointment"}
                        </strong>
                        <div className="work-order-subtext">
                          {[appointment.vehicle?.brand, appointment.vehicle?.model, appointment.vehicle?.color]
                            .filter(Boolean)
                            .join(" ") || "No vehicle details"}
                        </div>
                      </td>
                    ) : null}
                    <td>{formatAppointmentServices(appointment, serviceNameById) ?? "Not selected"}</td>
                    <td>{assignedStaffNames.get(appointment.id) ?? "Unassigned"}</td>
                    <td>
                      <strong>
                        {formatDateValue(toBusinessDateValue(appointment.scheduledAt), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </strong>
                      <div className="work-order-subtext">
                        {formatAppointmentTime(toBusinessTimeValue(appointment.scheduledAt))}
                      </div>
                    </td>
                    <td>
                      <span className={`status ${appointment.status.toLowerCase()}`}>
                        {formatAppointmentStatus(appointment.status)}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/appointments/${appointment.id}`}>View</Link>
                        {appointment.workOrder ? (
                          <Link href={`/work-orders/${appointment.workOrder.id}`}>
                            {resolvedIndustryType === "SALON_BEAUTY" ? "Service order" : "Job"}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No appointments yet.</p>
          )}

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                aria-disabled={currentPage === 1}
                className={currentPage === 1 ? "is-disabled" : ""}
                href={makeAppointmentHref({
                  date: selectedDateValue,
                  q: rawSearch,
                  status,
                  page: Math.max(1, currentPage - 1),
                })}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                aria-disabled={currentPage === totalPages}
                className={currentPage === totalPages ? "is-disabled" : ""}
                href={makeAppointmentHref({
                  date: selectedDateValue,
                  q: rawSearch,
                  status,
                  page: Math.min(totalPages, currentPage + 1),
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

function rankRecentServiceIds(
  appointments: { serviceId: string | null; serviceIds: string[] }[],
  limit: number,
) {
  const usage = new Map<string, { count: number; recentIndex: number }>();

  appointments.forEach((appointment, recentIndex) => {
    const appointmentServiceIds = [
      ...new Set([
        ...appointment.serviceIds,
        ...(appointment.serviceId ? [appointment.serviceId] : []),
      ]),
    ];

    appointmentServiceIds.forEach((serviceId) => {
      const current = usage.get(serviceId);
      usage.set(serviceId, {
        count: (current?.count ?? 0) + 1,
        recentIndex: Math.min(current?.recentIndex ?? recentIndex, recentIndex),
      });
    });
  });

  return [...usage.entries()]
    .sort((left, right) => {
      const usageDifference = right[1].count - left[1].count;
      return usageDifference || left[1].recentIndex - right[1].recentIndex;
    })
    .slice(0, limit)
    .map(([serviceId]) => serviceId);
}

function toCalendarItem(appointment: {
  id: string;
  branchId: string | null;
  customerId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactType: string;
  customer: { name: string; phone: string };
  scheduledAt: Date;
  startedAt: Date | null;
  durationMinutes: number;
  notes: string | null;
  service: { name: string } | null;
  serviceId: string | null;
  serviceIds: string[];
  productIds: string[];
  packageIds: string[];
  assignedStaffId: string | null;
  status: string;
  vehicle: { plateNumber: string } | null;
  invoice?: {
    balance: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    id: string;
    invoiceNumber: string;
    issuedAt: Date;
    items: Array<{
      id: string;
      lineTotal: Prisma.Decimal;
      name: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
    }>;
    paidAmount: Prisma.Decimal;
    status: string;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    taxLabel: string | null;
    taxRate: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    payments: Array<{
      amount: Prisma.Decimal;
      method: string;
      status: string;
      refunds: Array<{ amount: Prisma.Decimal }>;
    }>;
  } | null;
  workOrder?: { paymentStatus: string; status: string } | null;
  workOrderId?: string | null;
}, assignedStaffNames: Map<string, string>, serviceNameById: Map<string, string>, serviceDetailById: Map<string, {
  id: string;
  name: string;
  price: string;
  taxable: boolean;
  taxRate: number | null;
}>, productDetailById: Map<string, {
  id: string;
  name: string;
  price: string;
  category: string;
  taxable: boolean;
  taxRate: number | null;
}>, packageDetailById: Map<string, {
  id: string;
  name: string;
  price: string;
  category: string;
  totalUses: number;
  taxable: boolean;
  taxRate: number | null;
}>): AppointmentCalendarItem {
  return {
    id: appointment.id,
    branchId: appointment.branchId,
    customerId: appointment.customerId,
    contactName: appointment.contactName,
    contactPhone: appointment.contactPhone,
    contactType: appointment.contactType,
    customerName: appointment.customer.name,
    customerPhone: appointment.customer.phone,
    staffId: appointment.assignedStaffId,
    staffName: assignedStaffNames.get(appointment.id) ?? null,
    plateNumber: appointment.vehicle?.plateNumber ?? null,
    scheduledAt: appointment.scheduledAt.toISOString(),
    startedAt: appointment.startedAt?.toISOString() ?? null,
    durationMinutes: appointment.durationMinutes,
    notes: appointment.notes,
    serviceName: formatAppointmentServices(appointment, serviceNameById),
    serviceNames: getAppointmentServiceNames(appointment, serviceNameById),
    serviceDetails: getAppointmentServiceDetails(appointment, serviceDetailById),
    serviceIds: appointment.serviceIds,
    productIds: appointment.productIds,
    productDetails: getCountedAppointmentDetails(appointment.productIds, productDetailById),
    packageIds: appointment.packageIds,
    packageDetails: getCountedAppointmentDetails(appointment.packageIds, packageDetailById),
    status: appointment.status,
    invoiceBalance: appointment.invoice ? Number(appointment.invoice.balance) : null,
    invoiceId: appointment.invoice?.id ?? null,
    invoiceSummary: appointment.invoice ? (() => {
      const paymentSummary = getInvoicePaymentSummary(appointment.invoice.payments);
      return {
        id: appointment.invoice.id,
        invoiceNumber: appointment.invoice.invoiceNumber,
        status: appointment.invoice.status,
        issuedAt: appointment.invoice.issuedAt.toISOString(),
        customerName: appointment.customer.name,
        customerPhone: appointment.customer.phone,
        items: appointment.invoice.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
        subtotal: Number(appointment.invoice.subtotal),
        discountAmount: Number(appointment.invoice.discountAmount),
        tipAmount: Number(appointment.invoice.tipAmount),
        taxAmount: Number(appointment.invoice.taxAmount),
        taxRate: Number(appointment.invoice.taxRate),
        taxLabel: appointment.invoice.taxLabel,
        total: Number(appointment.invoice.total),
        paidAmount: Number(appointment.invoice.paidAmount),
        balance: Number(appointment.invoice.balance),
        packageVoucherAmount: paymentSummary.packageVoucherAmount,
        cashPaidAmount: paymentSummary.cashPaidAmount,
      };
    })() : null,
    invoicePaidAmount: appointment.invoice ? Number(appointment.invoice.paidAmount) : null,
    invoiceStatus: appointment.invoice?.status ?? null,
    invoiceSubtotal: appointment.invoice ? Number(appointment.invoice.subtotal) : null,
    invoiceTotal: appointment.invoice ? Number(appointment.invoice.total) : null,
    workOrderPaymentStatus: appointment.workOrder?.paymentStatus ?? null,
    workOrderStatus: appointment.workOrder?.status ?? null,
    workOrderId: appointment.workOrderId ?? null,
  };
}

function getCountedAppointmentDetails<T extends { id: string }>(ids: string[], details: Map<string, T>) {
  const quantities = new Map<string, number>();
  ids.forEach((id) => quantities.set(id, (quantities.get(id) ?? 0) + 1));

  return [...quantities].flatMap(([id, quantity]) => {
    const detail = details.get(id);
    return detail ? [{ ...detail, quantity }] : [];
  });
}

function getAppointmentServiceDetails(
  appointment: {
    service?: { name: string } | null;
    serviceId?: string | null;
    serviceIds?: string[];
  },
  serviceDetailById: Map<string, {
    id: string;
    name: string;
    price: string;
    taxable: boolean;
    taxRate: number | null;
  }>,
) {
  const details = [
    ...(appointment.serviceIds ?? []).map((serviceId) => serviceDetailById.get(serviceId)),
    appointment.serviceId ? serviceDetailById.get(appointment.serviceId) : undefined,
    appointment.service && !appointment.serviceId
      ? {
          id: appointment.service.name,
          name: appointment.service.name,
          price: "",
          taxable: true,
          taxRate: null,
        }
      : undefined,
  ].filter((service): service is {
    id: string;
    name: string;
    price: string;
    taxable: boolean;
    taxRate: number | null;
  } => Boolean(service));

  return [...new Map(details.map((service) => [service.id, service])).values()];
}

function formatAppointmentServices(
  appointment: {
    service?: { name: string } | null;
    serviceId?: string | null;
    serviceIds?: string[];
  },
  serviceNameById: Map<string, string>,
) {
  const names = [
    ...new Set([
      ...(appointment.serviceIds ?? []).map((serviceId) => serviceNameById.get(serviceId)),
      appointment.service?.name,
    ]),
  ].filter(Boolean);

  return names.length ? names.join(", ") : null;
}

function getAppointmentServiceNames(
  appointment: {
    service?: { name: string } | null;
    serviceId?: string | null;
    serviceIds?: string[];
  },
  serviceNameById: Map<string, string>,
) {
  return [
    ...new Set([
      ...(appointment.serviceIds ?? []).map((serviceId) => serviceNameById.get(serviceId)),
      appointment.service?.name,
    ]),
  ].filter((name): name is string => Boolean(name));
}

async function getAssignedStaffNames(appointmentIds: string[], businessId: string) {
  const uniqueIds = [...new Set(appointmentIds)];

  if (!uniqueIds.length) {
    return new Map<string, string>();
  }

  const rows = await prisma.$queryRaw<Array<{ appointmentId: string; staffName: string | null }>>`
    SELECT a."id"::text AS "appointmentId", u."name" AS "staffName"
    FROM "appointments" a
    LEFT JOIN "users" u ON u."id"::text = a."assigned_staff_id"::text
    WHERE a."business_id" = ${businessId}::uuid
      AND a."id"::text IN (${Prisma.join(uniqueIds)})
  `;

  return new Map(
    rows
      .filter((row) => row.staffName)
      .map((row) => [row.appointmentId, row.staffName as string]),
  );
}

function buildAppointmentWhere({
  businessId,
  branchId,
  rawSearch,
  status,
  industryType,
}: {
  businessId: string;
  branchId: string | null;
  rawSearch: string;
  status: string;
  industryType: string;
}) {
  const filters: Prisma.AppointmentWhereInput[] = [{ businessId }];

  if (branchId) {
    filters.push({ branchId });
  }

  if (status === "active") {
    filters.push({
      status: {
        in: industryType === "SALON_BEAUTY"
          ? [...ACTIVE_APPOINTMENT_STATUSES]
          : ["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE", "CONVERTED_TO_JOB"],
      },
    });
  } else if (status === "today") {
    const today = getBusinessTodayDateValue();
    const start = parseBusinessDateTime(today, "00:00");
    const end = parseBusinessDateTime(addDaysToDateValue(today, 1), "00:00");
    filters.push({
      scheduledAt: {
        gte: start,
        lt: end,
      },
    });
  } else if (status === "history") {
    filters.push({
      status: { in: ["COMPLETED", "CONVERTED_TO_JOB", "CANCELLED", "NO_SHOW"] },
    });
  } else {
    filters.push({
      status: status === "scheduled" && industryType === "SALON_BEAUTY"
        ? { in: [...ACTIVE_APPOINTMENT_STATUSES] }
        : (status.toUpperCase() as Prisma.EnumAppointmentStatusFilter["equals"]),
    });
  }

  if (rawSearch) {
    filters.push({
      OR: [
        { customer: { name: { contains: rawSearch, mode: "insensitive" } } },
        { customer: { phone: { contains: rawSearch, mode: "insensitive" } } },
        { vehicle: { plateNumber: { contains: rawSearch, mode: "insensitive" } } },
        { service: { name: { contains: rawSearch, mode: "insensitive" } } },
      ],
    });
  }

  return { AND: filters };
}

function getValidStatus(value?: string): string {
  return statusFilters.some((item) => item.value === value) ? value! : "active";
}

function makeAppointmentHref({
  date,
  q,
  status,
  page,
}: {
  date?: string;
  q: string;
  status: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }
  params.set("status", status);
  params.set("page", String(page));

  if (q) {
    params.set("q", q);
  }

  return `/appointments?${params.toString()}`;
}

function makeAppointmentDateHrefPrefix({
  q,
  status,
}: {
  q: string;
  status: string;
}) {
  const params = new URLSearchParams();
  params.set("status", status);
  params.set("page", "1");

  if (q) {
    params.set("q", q);
  }

  return `/appointments?${params.toString()}&date=`;
}

function formatAppointmentTime(timeValue: string) {
  const [hourValue, minuteValue] = timeValue.split(":").map(Number);
  const period = hourValue >= 12 ? "pm" : "am";
  const hour = hourValue % 12 || 12;

  return `${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
}

function countAppointmentsByDay(dates: Date[]) {
  const countByDay = new Map<string, number>();

  dates.forEach((date) => {
    const key = toBusinessDateValue(date);
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
  });

  return countByDay;
}
