import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import {
  maskAttendancePhone,
  normalizeAttendancePhoneLastFour,
} from "@/lib/attendance/phone";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import styles from "./employee.module.css";

type EmployeesPageProps = {
  searchParams: Promise<{
    attendanceEnabled?: string;
    branchId?: string;
    canClockIn?: string;
    code?: string;
    employmentType?: string;
    page?: string;
    phone?: string;
    q?: string;
    status?: string;
  }>;
};

type EmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "DAILY"
  | "HOURLY";

type MembershipStatus = "ACTIVE" | "SUSPENDED" | "TERMINATED";

const PAGE_SIZE = 25;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export default async function EmployeesPage({
  searchParams,
}: EmployeesPageProps) {
  const context = await requireBusinessUser("VIEW_ATTENDANCE_EMPLOYEES");
  const scope = await resolveAttendanceScope(context.access);
  const params = await searchParams;
  const now = new Date();
  const businessWide = canUseBusinessWideEmployeeScope(context.access);
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const q = params.q?.trim() ?? "";
  const code = params.code?.trim() ?? "";
  const phone =
    normalizeAttendancePhoneLastFour(params.phone ?? "") ?? "";
  const branchId = params.branchId?.trim() ?? "";
  const employmentType = isEmploymentType(params.employmentType)
    ? params.employmentType
    : "";
  const status = isMembershipStatus(params.status) ? params.status : "";
  const attendanceEnabled = parseBooleanFilter(params.attendanceEnabled);
  const canClockIn = parseBooleanFilter(params.canClockIn);

  const [business, branches] = await Promise.all([
    prisma.business.findUnique({
      where: { id: scope.businessId },
      select: { id: true, name: true, timezone: true },
    }),
    prisma.branch.findMany({
      where: {
        businessId: scope.businessId,
        id: { in: [...scope.allowedBranchIds] },
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!business) {
    notFound();
  }

  const allowedBranchIds = new Set(branches.map((branch) => branch.id));
  const invalidBranchFilter = Boolean(
    branchId && !allowedBranchIds.has(branchId),
  );
  const filterBranchIds = invalidBranchFilter
    ? []
    : branchId
      ? [branchId]
      : [...scope.allowedBranchIds];
  const currentAssignmentFilter = {
    businessId: scope.businessId,
    branchId: { in: filterBranchIds },
    status: "ACTIVE" as const,
    effectiveFrom: { lte: now },
    OR: [
      { effectiveUntil: null },
      { effectiveUntil: { gte: now } },
    ],
  };
  const and: Prisma.EmployeeBusinessMembershipWhereInput[] = [];

  if (!businessWide) {
    and.push({
      branchAssignments: {
        some: {
          businessId: scope.businessId,
          branchId: { in: [...scope.allowedBranchIds] },
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: now } },
          ],
        },
      },
    });
  }

  if (invalidBranchFilter) {
    and.push({ id: EMPTY_UUID });
  } else if (branchId) {
    and.push({
      branchAssignments: {
        some: currentAssignmentFilter,
      },
    });
  }

  if (q) {
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { employeeCode: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (code) {
    and.push({
      employeeCode: { contains: code, mode: "insensitive" },
    });
  }

  if (phone) {
    and.push({
      phoneNumberNormalized: {
        endsWith: phone,
        mode: "insensitive",
      },
    });
  }

  if (canClockIn !== null) {
    const clockableAssignment = {
      ...currentAssignmentFilter,
      canClockIn: true,
    };
    and.push({
      branchAssignments: canClockIn
        ? { some: clockableAssignment }
        : { none: clockableAssignment },
    });
  }

  const where: Prisma.EmployeeBusinessMembershipWhereInput = {
    businessId: scope.businessId,
    ...(employmentType ? { employmentType } : {}),
    ...(status ? { status } : {}),
    ...(attendanceEnabled === null ? {} : { attendanceEnabled }),
    ...(and.length ? { AND: and } : {}),
  };
  const total = await prisma.employeeBusinessMembership.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const skip = (currentPage - 1) * PAGE_SIZE;
  const employees = await prisma.employeeBusinessMembership.findMany({
    where,
    orderBy: [
      { status: "asc" },
      { fullName: "asc" },
      { employeeCode: "asc" },
    ],
    skip,
    take: PAGE_SIZE,
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      phoneNumber: true,
      employmentType: true,
      status: true,
      attendanceEnabled: true,
      joinedAt: true,
      updatedAt: true,
      branchAssignments: {
        where: {
          businessId: scope.businessId,
          branchId: { in: [...scope.allowedBranchIds] },
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: now } },
          ],
        },
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
          branchId: true,
          canClockIn: true,
          isPrimary: true,
          branch: { select: { name: true } },
        },
      },
    },
  });
  const canManageEmployees =
    context.access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    context.access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
    (context.access.effectiveBusinessRole === "STAFF" &&
      context.access.permissions.includes("ATTENDANCE_EMPLOYEE_MANAGE"));
  const hasFilters = Boolean(
    q ||
      code ||
      phone ||
      branchId ||
      employmentType ||
      status ||
      attendanceEnabled !== null ||
      canClockIn !== null,
  );
  const paginationQuery = {
    q,
    code,
    phone,
    branchId,
    employmentType,
    status,
    attendanceEnabled:
      attendanceEnabled === null ? "" : String(attendanceEnabled),
    canClockIn: canClockIn === null ? "" : String(canClockIn),
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Team / Employees</p>
          <h1>Employees</h1>
          <p>
            {hasFilters
              ? `${total} employee${total === 1 ? "" : "s"} match the current filters.`
              : "Manage employment profiles and branch readiness separately from POS logins."}
          </p>
        </div>
        {canManageEmployees ? (
          <Link className={styles.primaryButton} href="/team/employees/new">
            New employee
          </Link>
        ) : null}
      </header>

      <section className={styles.filterPanel} aria-labelledby="employee-filters">
        <div className={styles.sectionTitle}>
          <div>
            <h2 id="employee-filters">Employee filters</h2>
            <p>Filters stay in the URL so this view can be revisited safely.</p>
          </div>
          {hasFilters ? (
            <Link className={styles.textLink} href="/team/employees">
              Clear all
            </Link>
          ) : null}
        </div>

        <form action="/team/employees" className={styles.filterGrid}>
          <label className={styles.filterWide}>
            Search
            <input
              defaultValue={q}
              name="q"
              placeholder="Name or employee code"
            />
          </label>
          <label>
            Employee code
            <input defaultValue={code} name="code" placeholder="EMP-001" />
          </label>
          <label>
            Phone last 4 digits
            <input
              defaultValue={phone}
              inputMode="numeric"
              maxLength={4}
              name="phone"
              pattern="[0-9]{4}"
              placeholder="6789"
              title="Enter exactly the last 4 phone digits"
              type="text"
            />
          </label>
          <label>
            Business
            <input aria-label="Business" readOnly value={business.name} />
          </label>
          <label>
            Branch
            <select defaultValue={branchId} name="branchId">
              <option value="">All authorized branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employment type
            <select defaultValue={employmentType} name="employmentType">
              <option value="">All types</option>
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option>
              <option value="DAILY">Daily</option>
              <option value="HOURLY">Hourly</option>
            </select>
          </label>
          <label>
            Status
            <select defaultValue={status} name="status">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
          </label>
          <label>
            Attendance
            <select
              defaultValue={
                attendanceEnabled === null ? "" : String(attendanceEnabled)
              }
              name="attendanceEnabled"
            >
              <option value="">Any</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            Can clock in
            <select
              defaultValue={canClockIn === null ? "" : String(canClockIn)}
              name="canClockIn"
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <div className={styles.filterActions}>
            <button className={styles.primaryButton} type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      {invalidBranchFilter ? (
        <p className={`${styles.message} ${styles.messageError}`} role="alert">
          The selected branch is outside your authorized scope. No employee data
          was returned.
        </p>
      ) : null}

      <section className={styles.tablePanel} aria-label="Employees list">
        {employees.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Employee</th>
                  <th>Code</th>
                  <th>Phone</th>
                  <th>Employment</th>
                  <th>Status</th>
                  <th>Primary branch</th>
                  <th>Assigned branches</th>
                  <th>Attendance</th>
                  <th>Clock in</th>
                  <th>Joined</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee, index) => {
                  const branchNames = employee.branchAssignments.map(
                    (assignment) =>
                      `${assignment.branch.name}${
                        assignment.isPrimary ? " · Primary" : ""
                      }`,
                  );
                  const primaryAssignment = employee.branchAssignments.find(
                    (assignment) => assignment.isPrimary,
                  );
                  const employeeName = canManageEmployees ? (
                    <Link href={`/team/employees/${employee.id}`}>
                      {employee.fullName}
                    </Link>
                  ) : (
                    employee.fullName
                  );

                  return (
                    <tr key={employee.id}>
                      <td data-label="No.">{skip + index + 1}</td>
                      <td data-label="Employee">
                        <span className={styles.employeeCell}>
                          <span aria-hidden="true" className={styles.avatar}>
                            {getInitials(employee.fullName)}
                          </span>
                          <span>
                            <strong>{employeeName}</strong>
                          </span>
                        </span>
                      </td>
                      <td data-label="Code">
                        <strong>{employee.employeeCode}</strong>
                      </td>
                      <td data-label="Phone">
                        {maskAttendancePhone(employee.phoneNumber) ?? "Invalid phone"}
                      </td>
                      <td data-label="Employment">
                        {formatEnum(employee.employmentType)}
                      </td>
                      <td data-label="Status">
                        <StatusPill status={employee.status} />
                      </td>
                      <td data-label="Primary branch">
                        {primaryAssignment?.branch.name ?? "No active primary"}
                      </td>
                      <td
                        data-label="Assigned branches"
                        title={branchNames.join(", ")}
                      >
                        {branchNames.length}
                      </td>
                      <td data-label="Attendance">
                        <BooleanPill
                          falseLabel="Disabled"
                          trueLabel="Enabled"
                          value={employee.attendanceEnabled}
                        />
                      </td>
                      <td data-label="Clock in">
                        <BooleanPill
                          falseLabel="No"
                          trueLabel="Yes"
                          value={employee.branchAssignments.some(
                            (assignment) => assignment.canClockIn,
                          )}
                        />
                      </td>
                      <td data-label="Joined">
                        {formatDate(employee.joinedAt, business.timezone)}
                      </td>
                      <td data-label="Updated">
                        {formatDate(employee.updatedAt, business.timezone)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            <h2>No employees found</h2>
            <p>
              {hasFilters
                ? "Try clearing one or more filters."
                : "Create the first employee profile for this business."}
            </p>
          </div>
        )}

        {total ? (
          <nav className={styles.pagination} aria-label="Employee pagination">
            <span>
              {skip + 1}-{Math.min(skip + PAGE_SIZE, total)} of {total}
            </span>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div>
              <Link
                aria-disabled={currentPage <= 1}
                className={currentPage <= 1 ? styles.disabledLink : undefined}
                href={buildPageHref(paginationQuery, currentPage - 1)}
              >
                Previous
              </Link>
              <Link
                aria-disabled={currentPage >= totalPages}
                className={
                  currentPage >= totalPages ? styles.disabledLink : undefined
                }
                href={buildPageHref(paginationQuery, currentPage + 1)}
              >
                Next
              </Link>
            </div>
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function canUseBusinessWideEmployeeScope(access: {
  effectiveBusinessRole: string | null;
  permissions: readonly string[];
}) {
  return (
    access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
    (access.effectiveBusinessRole === "STAFF" &&
      access.permissions.includes("ALL_BRANCHES"))
  );
}

function isEmploymentType(value: string | undefined): value is EmploymentType {
  return (
    value === "FULL_TIME" ||
    value === "PART_TIME" ||
    value === "CONTRACT" ||
    value === "DAILY" ||
    value === "HOURLY"
  );
}

function isMembershipStatus(
  value: string | undefined,
): value is MembershipStatus {
  return (
    value === "ACTIVE" ||
    value === "SUSPENDED" ||
    value === "TERMINATED"
  );
}

function parseBooleanFilter(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function buildPageHref(query: Record<string, string>, page: number) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/team/employees?${search}` : "/team/employees";
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "E"
  );
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: Date, timezone: string) {
  try {
    return value.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    });
  } catch {
    return value.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kuching",
    });
  }
}

function StatusPill({ status }: { status: MembershipStatus }) {
  return (
    <span
      className={`${styles.pill} ${
        status === "ACTIVE"
          ? styles.pillPositive
          : status === "SUSPENDED"
            ? styles.pillWarning
            : styles.pillNeutral
      }`}
    >
      {formatEnum(status)}
    </span>
  );
}

function BooleanPill({
  falseLabel,
  trueLabel,
  value,
}: {
  falseLabel: string;
  trueLabel: string;
  value: boolean;
}) {
  return (
    <span
      className={`${styles.pill} ${
        value ? styles.pillPositive : styles.pillNeutral
      }`}
    >
      {value ? trueLabel : falseLabel}
    </span>
  );
}
