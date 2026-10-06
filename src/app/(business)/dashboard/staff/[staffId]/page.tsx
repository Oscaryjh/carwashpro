import { notFound } from "next/navigation";
import { StaffPerformanceDetailView } from "@/components/dashboard/staff-performance-detail";
import { getBusinessContext } from "@/lib/tenant";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import { resolvePerformancePeriods } from "@/lib/business-performance/read-model";
import { readStaffPerformance } from "@/lib/business-performance/staff-performance";
import { parseStaffPerformanceSubject, type StaffPerformanceQuery } from "@/lib/business-performance/staff-performance-navigation";

export default async function StaffPerformancePage({ params, searchParams }: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<StaffPerformanceQuery & { page?: string }>;
}) {
  const context = await getBusinessContext("VIEW_DASHBOARD");
  if (context.isPlatformAdmin || !context.businessId) notFound();
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "DASHBOARD");
  const subject = parseStaffPerformanceSubject((await params).staffId);
  if (!subject) notFound();
  const query = await searchParams;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true, businessDayCutoffTime: true, industryType: true } });
  if (business.industryType !== "SALON_BEAUTY" || !await isBusinessModuleEnabled(context.businessId, "POS")) notFound();
  const period = resolvePerformancePeriods({ ...query, now: new Date(), timezone: business.timezone, businessDayCutoffTime: business.businessDayCutoffTime }).current;
  const data = await readStaffPerformance({
    businessId: context.businessId, subject,
    salonAccess: { access: context.access, requestedBranchId: query.branchId === "" ? undefined : query.branchId },
    fromDate: period.fromDate, toDateExclusive: period.toDateExclusive, page: query.page,
  });
  if (!data) notFound();
  const invoiceScope = authorizedOperationalBranchWhere(context.user);
  const invoiceViewIds = hasBusinessCapability(context.access, "VIEW_INVOICES")
    ? data.activity.filter(row => !("branchId" in invoiceScope) || row.branchId === invoiceScope.branchId).map(row => row.id)
    : [];
  return <StaffPerformanceDetailView data={data} query={query} period={`${period.fromDateValue} — ${period.toDateValue}`} timezone={business.timezone} invoiceViewIds={invoiceViewIds} />;
}
