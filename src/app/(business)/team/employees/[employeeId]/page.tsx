import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AttendanceEmployeeForm,
  type AttendanceEmployeeFormValues,
} from "../employee-form";
import styles from "../employee.module.css";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUserWithAnyCapability } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

type AttendanceEmployeeDetailsPageProps = {
  params: Promise<{
    employeeId: string;
  }>;
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

const EMPLOYEE_AUDIT_ACTIONS = [
  "EMPLOYEE_CREATED",
  "EMPLOYEE_UPDATED",
  "EMPLOYEE_STATUS_CHANGED",
  "EMPLOYEE_SUSPENDED",
  "EMPLOYEE_TERMINATED",
  "EMPLOYEE_REACTIVATED",
  "EMPLOYEE_BRANCH_ASSIGNED",
  "EMPLOYEE_BRANCH_ASSIGNMENT_UPDATED",
  "EMPLOYEE_PRIMARY_BRANCH_CHANGED",
  "EMPLOYEE_ATTENDANCE_ENABLED",
  "EMPLOYEE_ATTENDANCE_DISABLED",
] as const;

export default async function AttendanceEmployeeDetailsPage({
  params,
  searchParams,
}: AttendanceEmployeeDetailsPageProps) {
  const context = await requireBusinessUserWithAnyCapability([
    "MODIFY_TEAM",
    "MODIFY_ATTENDANCE_EMPLOYEES",
  ]);
  const scope = await resolveAttendanceScope(context.access);
  const { employeeId } = await params;
  const pageMessage = await searchParams;
  const now = new Date();
  const businessWide = canUseBusinessWideEmployeeScope(context.access);
  const scopedAssignment = {
    businessId: scope.businessId,
    branchId: { in: [...scope.allowedBranchIds] },
    status: "ACTIVE" as const,
    effectiveFrom: { lte: now },
    OR: [
      { effectiveUntil: null },
      { effectiveUntil: { gte: now } },
    ],
  };

  const [business, branches, employee] = await Promise.all([
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
    prisma.employeeBusinessMembership.findFirst({
      where: {
        id: employeeId,
        businessId: scope.businessId,
        ...(!businessWide
          ? {
              branchAssignments: {
                some: scopedAssignment,
              },
            }
          : {}),
      },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        phoneNumber: true,
        employmentType: true,
        status: true,
        attendanceEnabled: true,
        joinedAt: true,
        terminatedAt: true,
        createdAt: true,
        updatedAt: true,
        employeeAccount: {
          select: {
            status: true,
          },
        },
        branchAssignments: {
          where: {
            businessId: scope.businessId,
            ...(!businessWide
              ? { branchId: { in: [...scope.allowedBranchIds] } }
              : {}),
          },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            branchId: true,
            isPrimary: true,
            canClockIn: true,
            effectiveFrom: true,
            effectiveUntil: true,
            status: true,
            branch: {
              select: {
                name: true,
                status: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!business || !employee) {
    notFound();
  }

  const auditScopeWhere = businessWide
    ? {}
    : {
        OR: [
          { branchId: { in: [...scope.allowedBranchIds] } },
          { branchId: null },
        ],
      };
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      businessId: scope.businessId,
      entityType: "EmployeeBusinessMembership",
      entityId: employee.id,
      action: { in: [...EMPLOYEE_AUDIT_ACTIONS] },
      ...auditScopeWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      action: true,
      actorName: true,
      summary: true,
      status: true,
      createdAt: true,
      branch: {
        select: {
          name: true,
        },
      },
    },
  });
  const activeAssignments = employee.branchAssignments.filter(
    (assignment) =>
      assignment.status === "ACTIVE" &&
      assignment.effectiveFrom <= now &&
      (!assignment.effectiveUntil || assignment.effectiveUntil >= now),
  );
  const activePrimary = activeAssignments.find(
    (assignment) => assignment.isPrimary,
  );
  const clockableAssignments = activeAssignments.filter(
    (assignment) => assignment.canClockIn,
  );
  const readyToClockIn =
    employee.status === "ACTIVE" &&
    employee.attendanceEnabled &&
    Boolean(activePrimary?.canClockIn);
  const timezone = business.timezone || "Asia/Kuching";
  const formEmployee: AttendanceEmployeeFormValues = {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    phoneNumber: employee.phoneNumber,
    employmentType: employee.employmentType,
    status: employee.status,
    attendanceEnabled: employee.attendanceEnabled,
    joinedAt: formatDateInput(employee.joinedAt, timezone),
    terminatedAt: employee.terminatedAt
      ? formatDateInput(employee.terminatedAt, timezone)
      : "",
    updatedAt: employee.updatedAt.toISOString(),
    assignments: employee.branchAssignments.map((assignment) => ({
      branchId: assignment.branchId,
      isPrimary: assignment.isPrimary,
      canClockIn: assignment.canClockIn,
      effectiveFrom: formatDateInput(assignment.effectiveFrom, timezone),
      effectiveUntil: assignment.effectiveUntil
        ? formatDateInput(assignment.effectiveUntil, timezone)
        : "",
      status: assignment.status,
    })),
  };
  const message = pageMessage.message?.trim();

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Team / Employees / Details</p>
          <h1>{employee.fullName}</h1>
          <p>
            Employment profile {employee.employeeCode} · Last updated{" "}
            {formatDateTime(employee.updatedAt, timezone)}
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/team/employees">
          Back to employees
        </Link>
      </header>

      {message ? (
        <p
          className={`${styles.message} ${
            pageMessage.type === "error"
              ? styles.messageError
              : styles.messageSuccess
          }`}
          role={pageMessage.type === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      <section className={styles.summaryGrid} aria-label="Employee basics">
        <article>
          <span>Employee code</span>
          <strong>{employee.employeeCode}</strong>
          <small>{formatEnum(employee.employmentType)}</small>
        </article>
        <article>
          <span>Phone number</span>
          <strong>{employee.phoneNumber}</strong>
          <small>Visible only in employee details</small>
        </article>
        <article>
          <span>Employment status</span>
          <strong>{formatEnum(employee.status)}</strong>
          <small>
            Joined {formatDisplayDate(employee.joinedAt, timezone)}
          </small>
        </article>
        <article>
          <span>Account identity</span>
          <strong>{formatEnum(employee.employeeAccount.status)}</strong>
          <small>Employee identity, not a POS login</small>
        </article>
      </section>

      <section className={styles.readinessPanel}>
        <div className={styles.sectionTitle}>
          <div>
            <h2>Static readiness</h2>
            <p>
              Profile and assignment checks only. No attendance records are shown.
            </p>
          </div>
          <span
            className={`${styles.pill} ${
              readyToClockIn ? styles.pillPositive : styles.pillWarning
            }`}
          >
            {readyToClockIn ? "Ready to clock in" : "Needs attention"}
          </span>
        </div>
        <div className={styles.readinessGrid}>
          <ReadinessItem
            detail="Code and normalized phone are present"
            label="Employee identity"
            ready={Boolean(employee.employeeCode && employee.phoneNumber)}
          />
          <ReadinessItem
            detail={`${activeAssignments.length} active assignment${
              activeAssignments.length === 1 ? "" : "s"
            }`}
            label="Branch assignment"
            ready={activeAssignments.length > 0}
          />
          <ReadinessItem
            detail={activePrimary?.branch.name ?? "No active primary branch"}
            label="Primary branch"
            ready={Boolean(activePrimary)}
          />
          <ReadinessItem
            detail={`${clockableAssignments.length} permitted branch${
              clockableAssignments.length === 1 ? "" : "es"
            }`}
            label="Clock-in branches"
            ready={clockableAssignments.length > 0}
          />
          <ReadinessItem
            detail={
              employee.attendanceEnabled
                ? "Attendance is enabled"
                : "Attendance is disabled"
            }
            label="Attendance access"
            ready={employee.attendanceEnabled}
          />
        </div>
      </section>

      <AttendanceEmployeeForm
        branches={branches}
        businessName={business.name}
        employee={formEmployee}
      />

      <section className={styles.historyPanel}>
        <div className={styles.sectionTitle}>
          <div>
            <h2>Assignment history</h2>
            <p>
              Historical assignments are retained. Only branches inside your scope
              are shown.
            </p>
          </div>
        </div>
        {employee.branchAssignments.length ? (
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.compactTable}`}>
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Assignment</th>
                  <th>Clock in</th>
                  <th>Effective from</th>
                  <th>Effective until</th>
                </tr>
              </thead>
              <tbody>
                {employee.branchAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td data-label="Branch">
                      <strong>{assignment.branch.name}</strong>
                      <small>
                        {assignment.branch.status === "INACTIVE"
                          ? "Inactive branch"
                          : assignment.isPrimary
                            ? "Primary branch"
                            : "Additional branch"}
                      </small>
                    </td>
                    <td data-label="Assignment">
                      <span
                        className={`${styles.pill} ${
                          assignment.status === "ACTIVE"
                            ? styles.pillPositive
                            : styles.pillNeutral
                        }`}
                      >
                        {formatEnum(assignment.status)}
                      </span>
                    </td>
                    <td data-label="Clock in">
                      {assignment.canClockIn ? "Allowed" : "Not allowed"}
                    </td>
                    <td data-label="Effective from">
                      {formatDisplayDate(assignment.effectiveFrom, timezone)}
                    </td>
                    <td data-label="Effective until">
                      {assignment.effectiveUntil
                        ? formatDisplayDate(
                            assignment.effectiveUntil,
                            timezone,
                          )
                        : "Ongoing"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>No assignment history in your scope.</p>
        )}
      </section>

      <section className={styles.historyPanel}>
        <div className={styles.sectionTitle}>
          <div>
            <h2>Employee audit activity</h2>
            <p>Only exact employee-management actions are included.</p>
          </div>
        </div>
        {auditLogs.length ? (
          <ol className={styles.auditList}>
            {auditLogs.map((entry) => (
              <li key={entry.id}>
                <span className={styles.auditMarker} aria-hidden="true" />
                <div>
                  <strong>{entry.summary}</strong>
                  <small>
                    {formatEnum(entry.action)} · {entry.actorName ?? "System"} ·{" "}
                    {entry.branch?.name ?? business.name}
                  </small>
                </div>
                <time dateTime={entry.createdAt.toISOString()}>
                  {formatDateTime(entry.createdAt, timezone)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>No employee audit activity yet.</p>
        )}
      </section>
    </main>
  );
}

function ReadinessItem({
  detail,
  label,
  ready,
}: {
  detail: string;
  label: string;
  ready: boolean;
}) {
  return (
    <article>
      <span aria-hidden="true">{ready ? "✓" : "!"}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </article>
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

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateInput(value: Date, timezone: string) {
  const parts = getDateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDisplayDate(value: Date, timezone: string) {
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

function formatDateTime(value: Date, timezone: string) {
  try {
    return value.toLocaleString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  } catch {
    return value.toLocaleString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kuching",
    });
  }
}

function getDateParts(value: Date, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone,
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Kuching",
    });
  }
  const parts = new Map(
    formatter
      .formatToParts(value)
      .map((part) => [part.type, part.value] as const),
  );
  return {
    year: parts.get("year") ?? "1970",
    month: parts.get("month") ?? "01",
    day: parts.get("day") ?? "01",
  };
}
