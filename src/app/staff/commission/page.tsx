import type { Metadata } from "next";
import { StaffCommissionV2 } from "@/components/staff-pwa/staff-commission-v2";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "Commission" };
export const dynamic = "force-dynamic";

export default async function StaffCommissionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const auth = await requireEmployeeModulePage("COMMISSION");
  const statements = await getEmployeeCommissionStatements({ businessId: auth.businessId, membershipId: auth.membershipId });
  const requestedPeriodId = typeof query.period === "string" ? query.period : null;
  const selectedIndex = Math.max(0, statements.findIndex((statement) => statement.period.id === requestedPeriodId));
  return <StaffCommissionV2 selectedIndex={selectedIndex} statements={statements} />;
}
