import { NextResponse } from "next/server";
import { requireBusinessUserWithAnyCapability } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { performanceEnabled } from "@/lib/performance/input";
import { assertPerformanceActor, eligiblePerformanceWhere } from "@/lib/performance/scope";
import { latestAttribution } from "@/lib/performance/service";
import { cents } from "@/lib/performance/money";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!performanceEnabled()) return respond({ enabled: false });
  try {
    const { user, businessId } = await requireBusinessUserWithAnyCapability(["PROCESS_CASHIER_PAYMENT", "MODIFY_APPOINTMENTS", "MODIFY_WORK_ORDERS"]);
    const params = new URL(request.url).searchParams;
    let branchId = params.get("branchId") || user.branchId || "";
    let invoiceId: string | null = null;
    const workOrderId = params.get("workOrderId"), appointmentId = params.get("appointmentId"), packageId = params.get("customerPackageId");
    if (workOrderId) {
      const order = await prisma.workOrder.findFirstOrThrow({ where: { id: workOrderId, businessId }, select: { branchId: true, invoice: { select: { id: true } } } });
      branchId = order.branchId ?? ""; invoiceId = order.invoice?.id ?? null;
    } else if (appointmentId) {
      const order = await prisma.appointment.findFirstOrThrow({ where: { id: appointmentId, businessId }, select: { branchId: true, invoice: { select: { id: true } } } });
      branchId = order.branchId ?? ""; invoiceId = order.invoice?.id ?? null;
    } else if (packageId) {
      const order = await prisma.customerPackage.findFirstOrThrow({ where: { id: packageId, businessId }, select: { branchId: true } });
      branchId = order.branchId ?? "";
    }
    const actor = await assertPerformanceActor(prisma, { businessId, branchId, actorUserId: user.userId });
    const [members, attribution, invoice] = await Promise.all([
      prisma.employeeBusinessMembership.findMany({ where: eligiblePerformanceWhere(businessId, branchId, new Date()),
        select: { id: true, employeeCode: true, fullName: true }, orderBy: [{ fullName: "asc" }, { id: "asc" }] }),
      invoiceId ? latestAttribution(prisma, businessId, `SALE:${invoiceId}`) : null,
      invoiceId ? prisma.invoice.findFirst({ where: { id: invoiceId, businessId }, select: { tipAmount: true, performanceReceipts: { where: { kind: "PAYMENT" }, select: { tipCents: true } } } }) : null,
    ]);
    return respond({ enabled: true, branchId, employees: members,
      canUnassign: actor.role === "BUSINESS_OWNER" || actor.permissions.includes("PERFORMANCE_UNASSIGNED"),
      saleAttribution: attribution ? { revision: attribution.revision, shares: attribution.shares.map((share) => ({ membershipId: share.membershipId, basisPoints: share.basisPoints, fullName: share.employeeName, employeeCode: share.employeeCode })) } : null,
      remainingTipCents: invoice ? Math.max(0, cents(invoice.tipAmount) - invoice.performanceReceipts.reduce((total, event) => total + Number(event.tipCents), 0)) : 0 });
  } catch {
    return respond({ enabled: true, error: "Unable to load authorized performance employees. Check your branch or sign in again." }, 403);
  }
}
