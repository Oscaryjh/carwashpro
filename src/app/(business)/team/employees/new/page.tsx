import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceEmployeeForm } from "../employee-form";
import styles from "../employee.module.css";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export default async function NewAttendanceEmployeePage() {
  const context = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  const scope = await resolveAttendanceScope(context.access);
  const [business, branches] = await Promise.all([
    prisma.business.findUnique({
      where: { id: scope.businessId },
      select: { id: true, name: true },
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

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Team / Employees / New</p>
          <h1>Create employee</h1>
          <p>
            Create an employment profile, assign work branches, and prepare
            attendance access.
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/team/employees">
          Back to employees
        </Link>
      </header>

      {!branches.length ? (
        <p className={`${styles.message} ${styles.messageWarning}`} role="alert">
          No active branches are available in your authorized scope. An employee
          requires at least one active branch assignment.
        </p>
      ) : null}

      <AttendanceEmployeeForm
        branches={branches}
        businessName={business.name}
      />
    </main>
  );
}
