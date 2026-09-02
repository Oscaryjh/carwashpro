import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { authorizedCustomerPackageBranchWhere } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { customerPhoneSearchVariants } from "@/lib/validation/crm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getCustomerSearchContext();

  if ("response" in context) {
    return context.response;
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const packageBranchWhere = authorizedCustomerPackageBranchWhere(context.user);
  const customers = await prisma.customer.findMany({
    where: {
      businessId: context.businessId,
      ...buildCustomerSearchWhere(query),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      vehicles: {
        orderBy: { updatedAt: "desc" },
        select: {
          brand: true,
          model: true,
          plateNumber: true,
        },
        take: 4,
      },
      membership: {
        select: {
          pointsBalance: true,
          status: true,
        },
      },
      _count: {
        select: {
          customerPackages: {
            where: { status: "ACTIVE", ...packageBranchWhere },
          },
          vehicles: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: 20,
  });

  return NextResponse.json({
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      activePackageCount: customer._count.customerPackages,
      loyaltyPoints: customer.membership?.pointsBalance ?? 0,
      loyaltyStatus: customer.membership?.status ?? null,
      vehicleCount: customer._count.vehicles,
      vehicles: customer.vehicles,
    })),
  });
}

async function getCustomerSearchContext() {
  const user = await getSession();

  if (!user || user.status !== "active") {
    return {
      response: NextResponse.json(
        { ok: false, error: "Session expired. Please login again." },
        { status: 401 },
      ),
    };
  }

  if (!user.businessId || !["BUSINESS_OWNER", "STAFF"].includes(user.role)) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Customer access is not allowed." },
        { status: 403 },
      ),
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: user.businessId },
    select: { id: true },
  });

  if (!business) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Business not found. Please login again." },
        { status: 401 },
      ),
    };
  }

  return { businessId: business.id, user };
}

function buildCustomerSearchWhere(query: string): Prisma.CustomerWhereInput {
  if (!query) {
    return {};
  }

  const compactQuery = query.replace(/\s+/g, "");
  const hasLetter = /[a-z]/i.test(compactQuery);
  const hasNumber = /\d/.test(compactQuery);
  const isLettersOnly = /^[a-z\s]+$/i.test(query);
  const isNumbersOnly = /^\d+$/.test(compactQuery);

  if (hasLetter && hasNumber) {
    return {
      vehicles: {
        some: {
          plateNumber: { contains: compactQuery, mode: "insensitive" },
        },
      },
    };
  }

  if (isLettersOnly) {
    return { name: { contains: query, mode: "insensitive" } };
  }

  if (isNumbersOnly) {
    return {
      OR: customerPhoneSearchVariants(compactQuery).map((phone) => ({
        phone: { contains: phone, mode: "insensitive" },
      })),
    };
  }

  return {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { phone: { contains: compactQuery, mode: "insensitive" } },
      {
        vehicles: {
          some: {
            plateNumber: { contains: compactQuery, mode: "insensitive" },
          },
        },
      },
    ],
  };
}
