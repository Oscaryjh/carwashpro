import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { parsePayrollMonth } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

type LegacyPayrollPageProps = {
  searchParams: Promise<{
    month?: string;
    message?: string;
    type?: string;
  }>;
};

/**
 * Compatibility route for bookmarks created before Payroll Workspace and
 * canonical Payroll Run pages were introduced.
 */
export default async function LegacyPayrollPage({
  searchParams,
}: LegacyPayrollPageProps) {
  const { businessId } = await requireBusinessUser("VIEW_PAYROLL_RUN");
  const params = await searchParams;

  if (!params.month) {
    redirect(withNotice("/team/payroll/workspace", params));
  }

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) {
    redirect(
      "/team/payroll/workspace?type=error&message=Select%20a%20valid%20payroll%20month.",
    );
  }

  const period = parsePayrollMonth(params.month);
  const run = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId,
        periodStart: period.start,
        periodEnd: period.end,
      },
    },
    select: { id: true },
  });

  redirect(
    withNotice(
      run
        ? `/team/payroll/runs/${run.id}`
        : `/team/payroll/runs?month=${encodeURIComponent(period.value)}`,
      params,
    ),
  );
}

function withNotice(
  destination: string,
  params: { message?: string; type?: string },
) {
  const query = new URLSearchParams();
  if (params.type === "success" || params.type === "error") {
    query.set("type", params.type);
  }
  if (params.message) query.set("message", params.message);
  const suffix = query.toString();
  if (!suffix) return destination;
  return `${destination}${destination.includes("?") ? "&" : "?"}${suffix}`;
}
