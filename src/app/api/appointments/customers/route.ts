import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
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
    notes: "Created from Salon appointment.",
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
    select: { id: true, name: true, phone: true },
  });

  if (existingCustomer) {
    return NextResponse.json({ ok: true, customer: existingCustomer, existing: true });
  }

  const customer = await prisma.customer.create({
    data: {
      businessId: user.businessId,
      branchId: user.branchId ?? null,
      name: parsed.data.name,
      phone: parsed.data.phone,
      notes: parsed.data.notes || null,
    },
    select: { id: true, name: true, phone: true },
  });

  await sendNewCustomerWelcomeIfConnected({
    businessId: user.businessId,
    branchId: user.branchId ?? null,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    sentByUserId: user.userId,
  });

  return NextResponse.json({ ok: true, customer, existing: false });
}
