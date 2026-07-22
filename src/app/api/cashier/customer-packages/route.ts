import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();

  if (!session || session.status !== "active" || !session.businessId) {
    return NextResponse.json({ error: "Session expired. Please login again." }, { status: 401 });
  }

  if (
    !["BUSINESS_OWNER", "STAFF"].includes(session.role) ||
    (session.role === "STAFF" && !hasStaffPermission(session, "POS"))
  ) {
    return NextResponse.json({ error: "Cashier access is not allowed." }, { status: 403 });
  }

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId")?.trim() ?? "";
  const customerId = url.searchParams.get("customerId")?.trim() ?? "";
  const serviceIds = [...new Set(url.searchParams.getAll("serviceId").filter(Boolean))];
  const branches = await getOperationalBranches(session.businessId, session);

  if (!branchId || !branches.some((branch) => branch.id === branchId)) {
    return NextResponse.json({ error: "Select an available branch." }, { status: 400 });
  }

  if (!customerId || !serviceIds.length) {
    return NextResponse.json({ packages: [] });
  }

  const customer = await prisma.customer.findFirst({
    where: { businessId: session.businessId, id: customerId },
    select: { id: true },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer could not be found." }, { status: 404 });
  }

  const balances = await prisma.customerPackageServiceBalance.findMany({
    where: {
      businessId: session.businessId,
      remainingUses: { gt: 0 },
      serviceId: { in: serviceIds },
      customerPackage: {
        customerId,
        status: "ACTIVE",
        OR: [{ branchId: null }, { branchId }],
        package: { status: "ACTIVE" },
      },
    },
    include: {
      customerPackage: {
        select: {
          id: true,
          purchasedAt: true,
          package: { select: { name: true } },
        },
      },
      service: { select: { id: true, name: true } },
    },
    orderBy: [
      { customerPackage: { purchasedAt: "asc" } },
      { createdAt: "asc" },
    ],
  });

  return NextResponse.json({
    packages: balances.map((balance) => ({
      id: balance.id,
      customerPackageId: balance.customerPackage.id,
      name: balance.customerPackage.package.name,
      remainingUses: balance.remainingUses,
      serviceId: balance.service.id,
      serviceName: balance.service.name,
      totalUses: balance.totalUses,
    })),
  });
}
