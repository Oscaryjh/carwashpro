import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { getOperationalBranches } from "@/lib/branches";
import {
  getCashierCatalog,
  type CashierCatalogType,
} from "@/lib/cashier/catalog";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();

  if (!session || session.status !== "active" || !session.businessId) {
    return NextResponse.json({ ok: false, error: "Session expired. Please login again." }, { status: 401 });
  }

  if (
    !["BUSINESS_OWNER", "STAFF"].includes(session.role) ||
    (session.role === "STAFF" && !hasStaffPermission(session, "POS"))
  ) {
    return NextResponse.json({ ok: false, error: "Cashier access is not allowed." }, { status: 403 });
  }

  const business = await prisma.business.findUnique({
    where: { id: session.businessId },
    select: { id: true, industryType: true },
  });

  if (!business || business.industryType !== "SALON_BEAUTY") {
    return NextResponse.json({ ok: false, error: "Cashier catalog is not available." }, { status: 404 });
  }

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId")?.trim() ?? "";
  const branches = await getOperationalBranches(business.id, session);

  if (!branchId || !branches.some((branch) => branch.id === branchId)) {
    return NextResponse.json({ ok: false, error: "Select an available branch." }, { status: 400 });
  }

  const type = parseCatalogType(url.searchParams.get("type"));
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const category = url.searchParams.get("category")?.trim() || undefined;
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const result = await getCashierCatalog({
    branchId,
    businessId: business.id,
    category,
    page,
    query,
    type,
  });

  return NextResponse.json(result);
}

function parseCatalogType(value: string | null): CashierCatalogType {
  return value === "package" || value === "product" || value === "service" ? value : "all";
}
