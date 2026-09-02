import { NextResponse } from "next/server";
import { getSession, type AppSession } from "@/lib/auth/session";
import { authorizedCustomerPackageBranchWhere } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  customerPhoneSearchVariants,
  customerSchema,
} from "@/lib/validation/crm";
import { sendNewCustomerWelcomeIfConnected } from "@/lib/whatsapp/customer-welcome";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSession();

  if (!user || user.status !== "active" || !user.businessId) {
    return NextResponse.json({ ok: false, error: "Session expired." }, { status: 401 });
  }

  if (!["BUSINESS_OWNER", "STAFF"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Customer access is not allowed." }, { status: 403 });
  }

  const body = (await request.json()) as { name?: string; phone?: string };
  const parsed = customerSchema.safeParse({
    name: body.name,
    phone: body.phone,
    email: "",
    notes: "Created from customer picker.",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Customer details are invalid." },
      { status: 400 },
    );
  }

  const existingCustomer = await prisma.customer.findFirst({
    where: {
      businessId: user.businessId,
      phone: { in: customerPhoneSearchVariants(parsed.data.phone) },
    },
    select: customerPickerSelect(user),
  });

  if (existingCustomer) {
    return NextResponse.json({
      ok: true,
      customer: toCustomerPickerOption(existingCustomer),
      existing: true,
    });
  }

  const customer = await prisma.customer.create({
    data: {
      businessId: user.businessId,
      branchId: user.branchId ?? null,
      name: parsed.data.name,
      phone: parsed.data.phone,
      notes: parsed.data.notes || null,
    },
    select: customerPickerSelect(user),
  });

  await sendNewCustomerWelcomeIfConnected({
    businessId: user.businessId,
    branchId: user.branchId ?? null,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    sentByUserId: user.userId,
  });

  return NextResponse.json({
    ok: true,
    customer: toCustomerPickerOption(customer),
    existing: false,
  });
}

function customerPickerSelect(
  user: Pick<AppSession, "branchId" | "role">,
) {
  return {
    id: true,
    name: true,
    phone: true,
    vehicles: {
      orderBy: { updatedAt: "desc" as const },
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
          where: {
            status: "ACTIVE" as const,
            ...authorizedCustomerPackageBranchWhere(user),
          },
        },
        vehicles: true,
      },
    },
  } as const;
}

function toCustomerPickerOption(customer: {
  id: string;
  name: string;
  phone: string;
  vehicles: Array<{
    brand: string | null;
    model: string | null;
    plateNumber: string;
  }>;
  membership: { pointsBalance: number; status: string } | null;
  _count: { customerPackages: number; vehicles: number };
}) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    activePackageCount: customer._count.customerPackages,
    loyaltyPoints: customer.membership?.pointsBalance ?? 0,
    loyaltyStatus: customer.membership?.status ?? null,
    vehicleCount: customer._count.vehicles,
    vehicles: customer.vehicles,
  };
}
