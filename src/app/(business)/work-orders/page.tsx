import Link from "next/link";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { WorkOrderQuickCreateModal } from "@/components/work-order-quick-create-modal";
import { type ProductSaleOption } from "@/components/product-sale-form";
import { WorkOrderFilterForm } from "@/components/work-order-filter-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";
import {
  createWorkOrderAction,
  purchasePackageFromCashierAction,
  updateWorkOrderStatusAction,
} from "./actions";
import { sellProductAction } from "@/app/(business)/products/actions";

type WorkOrdersPageProps = {
  searchParams: Promise<{
    date?: string;
    message?: string;
    page?: string;
    q?: string;
    scope?: string;
    type?: string;
  }>;
};

const PAGE_SIZE = 25;
const scopes = [
  { value: "active_today", label: "Active + Today" },
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "unpaid", label: "Unpaid" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All history" },
] as const;
const dateFilters = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
] as const;

export default async function WorkOrdersPage({
  searchParams,
}: WorkOrdersPageProps) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("VIEW_WORK_ORDERS");

  if (industryType === "SALON_BEAUTY") {
    redirect("/cashier");
  }

  const params = await searchParams;
  const rawSearch = (params.q ?? "").trim();
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const normalizedPlate = rawSearch ? normalizePlateNumber(rawSearch) : "";
  const scope = getValidValue(params.scope, scopes, "active_today");
  const date = getValidValue(params.date, dateFilters, "all");
  const currentPage = Math.max(Number(params.page) || 1, 1);
  const staffBranchId =
    access.source === "GROUP_ACCESS" || user.role === "BUSINESS_OWNER"
      ? null
      : user.branchId ?? "00000000-0000-0000-0000-000000000000";

  const where = buildWorkOrderWhere({
    businessId,
    branchId: staffBranchId,
    rawSearch,
    normalizedPlate,
    scope,
    date,
  });

  const [workOrders, totalCount, services, packages, products, branches, business] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: {
        branch: true,
        customer: true,
        vehicle: true,
        _count: {
          select: { items: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.workOrder.count({ where }),
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      include: {
        serviceCategory: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.package.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      include: { service: { select: { taxable: true, taxRate: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { businessId, status: "ACTIVE" },
      include: { stocks: true },
      orderBy: { name: "asc" },
    }),
    getOperationalBranches(businessId, user),
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { sstEnabled: true, sstLabel: true, sstRate: true },
    }),
  ]);
  const serviceOptions = services.map((service) => ({
    id: service.id,
    category: service.serviceCategory?.name ?? service.category,
    name: service.name,
    price: Number(service.price),
  }));
  const packageOptions = packages.map((packageOption) => ({
    description: packageOption.description,
    id: packageOption.id,
    name: packageOption.name,
    price: Number(packageOption.price),
    taxable: packageOption.service?.taxable ?? true,
    taxRate: packageOption.service?.taxRate == null ? null : Number(packageOption.service.taxRate),
    totalUses: packageOption.totalUses,
  }));
  const productOptions: ProductSaleOption[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: Number(product.price),
    taxable: product.taxable,
    taxRate: product.taxRate == null ? null : Number(product.taxRate),
    stock: product.stocks.map((stock) => ({
      branchId: stock.branchId,
      quantity: stock.quantity,
    })),
  }));

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Cashier</h1>
            <p>
              {totalCount
                ? `Showing ${firstItem}-${lastItem} of ${totalCount} jobs`
                : "No jobs match this view"}
            </p>
          </div>
          <WorkOrderQuickCreateModal
            action={createWorkOrderAction}
            branches={branches}
            packageAction={purchasePackageFromCashierAction}
            packages={packageOptions}
            productAction={sellProductAction}
            products={productOptions}
            services={serviceOptions}
            taxSettings={{
              enabled: business.sstEnabled,
              label: business.sstLabel,
              rate: Number(business.sstRate),
            }}
          />
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <div className="filter-tabs" aria-label="Work order filters">
            {scopes.map((item) => (
              <Link
                key={item.value}
                className={item.value === scope ? "active" : ""}
                href={makeWorkOrderHref({
                  q: rawSearch,
                  scope: item.value,
                  date,
                  page: 1,
                })}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <WorkOrderFilterForm
            date={date}
            dateFilters={dateFilters}
            rawSearch={rawSearch}
            scope={scope}
          />

          {rawSearch || date !== "all" || scope !== "active_today" ? (
            <div className="list-toolbar">
              <span>
                View: <strong>{scopeLabel(scope)}</strong>
                {date !== "all" ? (
                  <>
                    {" "}
                    / <strong>{dateLabel(date)}</strong>
                  </>
                ) : null}
                {rawSearch ? (
                  <>
                    {" "}
                    / Search: <strong>{rawSearch}</strong>
                  </>
                ) : null}
              </span>
              <Link href="/work-orders">Reset</Link>
            </div>
          ) : null}

          {workOrders.length ? (
            <table className="table work-orders-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((workOrder, index) => (
                  <tr key={workOrder.id}>
                    <td className="table-number">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td>
                      <strong className="work-order-primary-text">
                        {workOrder.customer.name}
                      </strong>
                      <div className="work-order-subtext">
                        {workOrder.customer.phone}
                      </div>
                    </td>
                    <td>
                      <Link href={`/crm/vehicles/${workOrder.vehicle.id}`}>
                        <strong className="work-order-primary-text">
                          {workOrder.vehicle.plateNumber}
                        </strong>
                      </Link>
                      <div className="work-order-subtext">
                        {vehicleLabel(workOrder.vehicle)}
                      </div>
                    </td>
                    <td className="work-order-status-cell">
                      <StatusBadge status={workOrder.status} />
                      <div
                        className={`payment-state ${workOrder.paymentStatus.toLowerCase()}`}
                      >
                        {formatStatus(workOrder.paymentStatus)}
                      </div>
                    </td>
                    <td>
                      <strong className="work-order-primary-text">
                        RM{Number(workOrder.total).toFixed(2)}
                      </strong>
                      <div className="work-order-subtext">
                        Bal RM{Number(workOrder.balance).toFixed(2)}
                      </div>
                    </td>
                    <td>{formatDateTime(workOrder.createdAt)}</td>
                    <td>
                      <div className="inline-actions">
                        <StatusActionButton
                          status={workOrder.status}
                          workOrderId={workOrder.id}
                        />
                        <Link href={`/work-orders/${workOrder.id}`}>View</Link>
                        <Link href={`/pos/${workOrder.id}`}>Checkout</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No jobs yet.</p>
          )}

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeWorkOrderHref({
                  q: rawSearch,
                  scope,
                  date,
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
                href={makeWorkOrderHref({
                  q: rawSearch,
                  scope,
                  date,
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

function StatusBadge({ status }: { status: string }) {
  return <span className="status">{formatStatus(status)}</span>;
}

function StatusActionButton({
  status,
  workOrderId,
}: {
  status: string;
  workOrderId: string;
}) {
  const nextStatus = getNextStatus(status);

  if (!nextStatus) {
    return null;
  }

  return (
    <form action={updateWorkOrderStatusAction} className="status-step-form">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="status" value={nextStatus} />
      <button className="status-step-button" type="submit">
        {statusActionLabel(nextStatus)}
      </button>
    </form>
  );
}

function statusActionLabel(nextStatus: string) {
  if (nextStatus === "READY_FOR_PICKUP") {
    return "Ready for pickup";
  }

  if (nextStatus === "COMPLETED") {
    return "Vehicle Collected";
  }

  return formatStatus(nextStatus);
}

function getNextStatus(status: string) {
  if (status === "IN_PROGRESS") {
    return "READY_FOR_PICKUP";
  }

  if (status === "READY_FOR_PICKUP") {
    return "COMPLETED";
  }

  return null;
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildWorkOrderWhere({
  businessId,
  branchId,
  rawSearch,
  normalizedPlate,
  scope,
  date,
}: {
  businessId: string;
  branchId?: string | null;
  rawSearch: string;
  normalizedPlate: string;
  scope: string;
  date: string;
}) {
  const filters: Prisma.WorkOrderWhereInput[] = [];
  const { todayStart, tomorrowStart, weekStart, monthStart, nextMonthStart } =
    getDateRanges();

  if (scope === "active_today") {
    filters.push({
      status: { not: "CANCELLED" },
      NOT: {
        status: "COMPLETED",
        paymentStatus: "PAID",
      },
    });
  }

  if (scope === "active") {
    filters.push({
      status: { not: "CANCELLED" },
      NOT: {
        status: "COMPLETED",
        paymentStatus: "PAID",
      },
    });
  }

  if (scope === "ready") {
    filters.push({ status: "READY_FOR_PICKUP" });
  }

  if (scope === "unpaid") {
    filters.push({
      status: { not: "CANCELLED" },
      paymentStatus: { not: "PAID" },
    });
  }

  if (scope === "completed") {
    filters.push({
      status: "COMPLETED",
      paymentStatus: "PAID",
    });
  }

  if (scope === "cancelled") {
    filters.push({ status: "CANCELLED" });
  }

  if (date === "today") {
    filters.push({
      createdAt: {
        gte: todayStart,
        lt: tomorrowStart,
      },
    });
  }

  if (date === "week") {
    filters.push({
      createdAt: {
        gte: weekStart,
      },
    });
  }

  if (date === "month") {
    filters.push({
      createdAt: {
        gte: monthStart,
        lt: nextMonthStart,
      },
    });
  }

  if (rawSearch) {
    filters.push({
      OR: [
        {
          orderNumber: {
            contains: rawSearch,
            mode: "insensitive",
          },
        },
        {
          customer: {
            name: {
              contains: rawSearch,
              mode: "insensitive",
            },
          },
        },
        {
          customer: {
            phone: {
              contains: rawSearch,
              mode: "insensitive",
            },
          },
        },
        {
          vehicle: {
            plateNumber: {
              contains: normalizedPlate || rawSearch,
              mode: "insensitive",
            },
          },
        },
      ],
    });
  }

  return {
    businessId,
    ...(branchId ? { branchId } : {}),
    ...(filters.length ? { AND: filters } : {}),
  } satisfies Prisma.WorkOrderWhereInput;
}

function getDateRanges() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const weekStart = new Date(todayStart);
  const day = weekStart.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + mondayOffset);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return { todayStart, tomorrowStart, weekStart, monthStart, nextMonthStart };
}

function getValidValue<T extends readonly { value: string }[]>(
  value: string | undefined,
  options: T,
  fallback: T[number]["value"],
) {
  return options.some((option) => option.value === value) ? value ?? fallback : fallback;
}

function makeWorkOrderHref({
  q,
  scope,
  date,
  page,
}: {
  q: string;
  scope: string;
  date: string;
  page: number;
}) {
  const params = new URLSearchParams();

  if (scope !== "active_today") {
    params.set("scope", scope);
  }

  if (date !== "all") {
    params.set("date", date);
  }

  if (q) {
    params.set("q", q);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/work-orders?${query}` : "/work-orders";
}

function scopeLabel(value: string) {
  return scopes.find((scope) => scope.value === value)?.label ?? "Work orders";
}

function dateLabel(value: string) {
  return dateFilters.find((dateFilter) => dateFilter.value === value)?.label ?? "All dates";
}

function vehicleLabel(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
    "No details";
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
