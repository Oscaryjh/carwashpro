import Link from "next/link";
import { Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";
import { updateWorkOrderStatusAction } from "./actions";

type WorkOrdersPageProps = {
  searchParams: Promise<{
    q?: string;
    scope?: string;
    date?: string;
    page?: string;
  }>;
};

const PAGE_SIZE = 25;
const activeStatuses = ["WAITING", "IN_PROGRESS", "READY_FOR_PICKUP"] as const;
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
  const { user, businessId } = await requireBusinessUser();
  const params = await searchParams;
  const rawSearch = (params.q ?? "").trim();
  const normalizedPlate = rawSearch ? normalizePlateNumber(rawSearch) : "";
  const scope = getValidValue(params.scope, scopes, "active_today");
  const date = getValidValue(params.date, dateFilters, "all");
  const currentPage = Math.max(Number(params.page) || 1, 1);

  const where = buildWorkOrderWhere({
    businessId,
    rawSearch,
    normalizedPlate,
    scope,
    date,
  });

  const [workOrders, totalCount] = await Promise.all([
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
  ]);

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Jobs</h1>
            <p>
              {totalCount
                ? `Showing ${firstItem}-${lastItem} of ${totalCount} jobs`
                : "No jobs match this view"}
            </p>
          </div>
          <Link className="button-link" href="/work-orders/new">
            + Job
          </Link>
        </div>

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

          <form className="search-form work-order-filter-form" action="/work-orders">
            <input type="hidden" name="scope" value={scope} />
            <input
              name="q"
              placeholder="Search plate, customer, or phone"
              defaultValue={rawSearch}
            />
            <select name="date" defaultValue={date}>
              {dateFilters.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="submit">Search</button>
          </form>

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
                      <StatusStepButton
                        status={workOrder.status}
                        workOrderId={workOrder.id}
                      />
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
    </AppShell>
  );
}

function StatusStepButton({
  status,
  workOrderId,
}: {
  status: string;
  workOrderId: string;
}) {
  const nextStatus = getNextStatus(status);

  if (!nextStatus) {
    return <span className="status">{formatStatus(status)}</span>;
  }

  return (
    <form action={updateWorkOrderStatusAction} className="status-step-form">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="status" value={nextStatus} />
      <button className="status-step-button" type="submit">
        {formatStatus(status)}
      </button>
    </form>
  );
}

function getNextStatus(status: string) {
  if (status === "WAITING") {
    return "IN_PROGRESS";
  }

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
  rawSearch,
  normalizedPlate,
  scope,
  date,
}: {
  businessId: string;
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
      OR: [
        { status: { in: [...activeStatuses] } },
        {
          status: { in: [...activeStatuses] },
          createdAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      ],
    });
  }

  if (scope === "active") {
    filters.push({ status: { in: [...activeStatuses] } });
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
    filters.push({ status: "COMPLETED" });
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
