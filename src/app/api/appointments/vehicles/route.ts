import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  customerPhoneSearchVariants,
  customerSchema,
  customerVehicleSchema,
  normalizeCustomerPhone,
  normalizePlateNumber,
} from "@/lib/validation/crm";
import { sendNewCustomerWelcomeIfConnected } from "@/lib/whatsapp/customer-welcome";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await getAppointmentApiContext();

  if ("response" in context) {
    return context.response;
  }

  const { businessId } = context;
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  const searchWhere = buildVehicleSearchWhere(query);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      businessId,
      ...searchWhere,
    },
    include: {
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { plateNumber: "asc" }],
    take: 20,
  });

  return NextResponse.json({
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      label: `${vehicle.plateNumber} - ${vehicle.customer.name} - ${vehicle.customer.phone}`,
      brand: vehicle.brand,
      color: vehicle.color,
      plateNumber: vehicle.plateNumber,
      model: vehicle.model,
      customerName: vehicle.customer.name,
      customerPhone: vehicle.customer.phone,
    })),
  });
}

export async function POST(request: Request) {
  const context = await getAppointmentApiContext();

  if ("response" in context) {
    return context.response;
  }

  const { businessId, user } = context;
  const body = (await request.json()) as {
    name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    plateNumber?: string;
    brand?: string;
    model?: string;
    color?: string;
    vehicleNotes?: string;
  };

  const rawPhone = (body.phone ?? "").trim();
  const normalizedPhone = normalizeCustomerPhone(rawPhone);

  if (!normalizedPhone || normalizedPhone.length < 7 || !/^[0-9]+$/.test(normalizedPhone)) {
    return NextResponse.json(
      { ok: false, error: "Phone is required." },
      { status: 400 },
    );
  }

  const vehicleInput = customerVehicleSchema.parse({
    plateNumber: body.plateNumber,
    brand: body.brand,
    model: body.model,
    color: body.color,
    notes: body.vehicleNotes,
  });

  const normalizedPlateNumber = normalizePlateNumber(vehicleInput.plateNumber);
  const branchId = user.branchId ?? null;

  const [existingPhone, existingPlate] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        businessId,
        phone: { in: customerPhoneSearchVariants(normalizedPhone) },
      },
      select: { id: true, name: true, phone: true },
    }),
    prisma.vehicle.findFirst({
      where: {
        businessId,
        plateNumber: normalizedPlateNumber,
      },
      select: { id: true },
    }),
  ]);

  if (existingPlate) {
    return NextResponse.json(
      { ok: false, error: "Another vehicle already uses this plate." },
      { status: 409 },
    );
  }

  const customerInput = existingPhone
    ? {
        name: existingPhone.name,
        phone: existingPhone.phone,
        email: "",
        notes: "",
      }
    : customerSchema.parse({
        name: body.name,
        phone: normalizedPhone,
        email: body.email,
        notes: body.notes,
      });

  const { customer, vehicle, createdCustomer } = await prisma.$transaction(async (tx) => {
    const savedCustomer =
      existingPhone ??
      (await tx.customer.create({
        data: {
          businessId,
          branchId,
          name: customerInput.name,
          phone: customerInput.phone,
          email: customerInput.email || null,
          notes: customerInput.notes || null,
        },
      }));

    const savedVehicle = await tx.vehicle.create({
      data: {
        businessId,
        branchId,
        customerId: savedCustomer.id,
        plateNumber: normalizedPlateNumber,
        brand: vehicleInput.brand || null,
        model: vehicleInput.model || null,
        color: vehicleInput.color || null,
        notes: vehicleInput.notes || null,
      },
    });

    return { customer: savedCustomer, vehicle: savedVehicle, createdCustomer: !existingPhone };
  });

  if (createdCustomer) {
    await sendNewCustomerWelcomeIfConnected({
      businessId,
      branchId,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      sentByUserId: user.userId,
    });
  }

  return NextResponse.json({
    ok: true,
    mode: createdCustomer ? "customer_created" : "vehicle_added",
    vehicle: {
      id: vehicle.id,
      label: `${vehicle.plateNumber} - ${customer.name} - ${customer.phone}`,
      brand: vehicle.brand,
      color: vehicle.color,
      plateNumber: vehicle.plateNumber,
      model: vehicle.model,
      customerName: customer.name,
      customerPhone: customer.phone,
    },
  });
}

async function getAppointmentApiContext() {
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
        { ok: false, error: "Appointment access is not allowed." },
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

  return { businessId: user.businessId, user };
}

function buildVehicleSearchWhere(query: string) {
  if (!query) {
    return {};
  }

  const normalized = query.replace(/\s+/g, "");
  const hasLetter = /[a-z]/i.test(normalized);
  const hasNumber = /\d/.test(normalized);
  const isLettersOnly = /^[a-z\s]+$/i.test(query);
  const isNumbersOnly = /^\d+$/.test(normalized);

  if (hasLetter && hasNumber) {
    return { plateNumber: { contains: normalized, mode: "insensitive" as const } };
  }

  if (isLettersOnly) {
    return { customer: { name: { contains: query, mode: "insensitive" as const } } };
  }

  if (isNumbersOnly) {
    return { customer: { phone: { contains: normalized, mode: "insensitive" as const } } };
  }

  return {
    OR: [
      { plateNumber: { contains: normalized, mode: "insensitive" as const } },
      { customer: { name: { contains: query, mode: "insensitive" as const } } },
      { customer: { phone: { contains: normalized, mode: "insensitive" as const } } },
    ],
  };
}
