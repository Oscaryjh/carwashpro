import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  POS_CORE_FRESH_RUN_BRANCH_NAME,
  POS_CORE_UAT,
  assertPosCoreFreshRunSafe,
  assertPosCoreUatFixtureEnvironment,
  requireUatFixturePassword,
} from "./lib/pos-core-uat-contract";
import { getCurrentBusinessDateValue } from "../src/lib/business-day";

const mode = process.argv[2] ?? "seed";
if (!new Set(["seed", "reset", "status", "fresh-run"]).has(mode)) {
  throw new Error("Usage: prepare-pos-core-uat-fixtures.ts [seed|reset|status|fresh-run]");
}

const databaseUrl = process.env.DATABASE_URL;
const environment = assertPosCoreUatFixtureEnvironment({
  databaseUrl,
  nodeEnv: process.env.NODE_ENV,
  appEnv: process.env.APP_ENV ?? process.env.NEXT_PUBLIC_APP_ENV,
  fixtureConfirmation: process.env.POS_CORE_UAT_FIXTURE,
});
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient();
const enabledFrom = new Date("2026-01-01T00:00:00.000Z");
const fixtureNow = new Date("2026-08-28T04:00:00.000Z");

const salonPersonas = [
  { key: "owner", name: "UAT Salon Owner", email: POS_CORE_UAT.salon.ownerEmail, role: "BUSINESS_OWNER" as const, branch: "Branch A", permissions: [] },
  { key: "manager", name: "UAT Salon Manager", email: "uat.salon.manager@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["ALL_BRANCHES", "DASHBOARD", "CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING", "CONFIRM_DAILY_CLOSING", "REPORTS", "SERVICES", "PACKAGES", "PRODUCTS", "DISCOUNTS"] },
  { key: "cashier", name: "UAT Salon Cashier", email: "uat.salon.cashier@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["DASHBOARD", "CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"] },
  { key: "branchA", name: "UAT Branch A Staff", email: "uat.salon.branch-a@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING", "REPORTS"] },
  { key: "noReports", name: "UAT No Reports Staff", email: "uat.salon.no-reports@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"] },
] as const;

const autoPersonas = [
  { key: "owner", name: "UAT Auto Owner", email: POS_CORE_UAT.auto.ownerEmail, role: "BUSINESS_OWNER" as const, branch: "Branch A", permissions: [] },
  { key: "manager", name: "UAT Auto Manager", email: "uat.auto.manager@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["ALL_BRANCHES", "DASHBOARD", "CRM", "JOBS", "POS", "INVOICES", "CLOSING", "CONFIRM_DAILY_CLOSING", "REPORTS", "SERVICES", "PRODUCTS", "DISCOUNTS"] },
  { key: "cashier", name: "UAT Auto Cashier", email: "uat.auto.cashier@tetamu.test", role: "STAFF" as const, branch: "Branch A", permissions: ["DASHBOARD", "CRM", "JOBS", "POS", "INVOICES", "CLOSING"] },
] as const;

async function ensureBusiness(input: { name: string; slug: string; industryType: "SALON_BEAUTY" | "AUTO_DETAILING" }) {
  return prisma.business.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      industryType: input.industryType,
      timezone: "Asia/Kuching",
      businessDayCutoffTime: "02:00",
      status: "active",
      sstEnabled: false,
    },
    create: {
      name: input.name,
      slug: input.slug,
      industryType: input.industryType,
      timezone: "Asia/Kuching",
      businessDayCutoffTime: "02:00",
      status: "active",
      sstEnabled: false,
    },
  });
}

async function ensureBranch(businessId: string, name: string) {
  return prisma.branch.upsert({
    where: { businessId_name: { businessId, name } },
    update: { status: "ACTIVE", stateCode: "SARAWAK" },
    create: { businessId, name, stateCode: "SARAWAK", status: "ACTIVE" },
  });
}

async function ensureUser(input: {
  businessId: string;
  branchId: string;
  name: string;
  email: string;
  role: "BUSINESS_OWNER" | "STAFF";
  permissions: readonly string[];
  passwordHash: string;
  appointmentBookable?: boolean;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      businessId: input.businessId,
      branchId: input.branchId,
      name: input.name,
      role: input.role,
      permissions: [...input.permissions],
      passwordHash: input.passwordHash,
      loginEnabled: true,
      appointmentBookable: input.appointmentBookable ?? false,
      status: "active",
    },
    create: {
      businessId: input.businessId,
      branchId: input.branchId,
      name: input.name,
      email: input.email,
      role: input.role,
      permissions: [...input.permissions],
      passwordHash: input.passwordHash,
      loginEnabled: true,
      appointmentBookable: input.appointmentBookable ?? false,
      status: "active",
    },
  });
}

async function ensureEntitlements(businessId: string, ownerId: string, modules: readonly ("POS" | "INVENTORY" | "SALON" | "AUTO")[]) {
  for (const moduleKey of modules) {
    const existing = await prisma.businessModuleEntitlement.findUnique({
      where: { businessId_moduleKey: { businessId, moduleKey } },
    });
    const entitlement = existing ?? await prisma.businessModuleEntitlement.create({
      data: {
        businessId,
        moduleKey,
        status: "ENABLED",
        enabledFrom,
        source: "SYSTEM",
        planCode: "LOCAL_UAT",
        createdById: ownerId,
        updatedById: ownerId,
      },
    });
    if (!existing) {
      await prisma.businessModuleEntitlementEvent.create({
        data: {
          entitlementId: entitlement.id,
          businessId,
          moduleKey,
          revision: 1,
          newStatus: "ENABLED",
          newEnabledFrom: enabledFrom,
          source: "SYSTEM",
          planCode: "LOCAL_UAT",
          reason: "Permanent Local POS Core browser UAT fixture.",
          actorUserId: ownerId,
        },
      });
    }
  }
}

async function ensurePaymentMethods(businessId: string) {
  const definitions = [
    ["CASH", "Cash", "cash", "CASH", 10],
    ["CARD", "Card", "card", "CARD", 20],
    ["DUITNOW", "DuitNow", "duitnow", "DUITNOW", 30],
  ] as const;
  for (const [code, label, normalizedLabel, canonicalMethod, sortOrder] of definitions) {
    await prisma.businessPaymentMethod.upsert({
      where: { businessId_code: { businessId, code } },
      update: { label, normalizedLabel, canonicalMethod, active: true, builtIn: true, sortOrder },
      create: { businessId, code, label, normalizedLabel, canonicalMethod, active: true, builtIn: true, sortOrder },
    });
  }
}

async function ensureCustomer(businessId: string, branchId: string, name: string, phone: string) {
  return prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone } },
    update: { branchId, name },
    create: { businessId, branchId, name, phone, notes: "PERMANENT POS CORE UAT FIXTURE" },
  });
}

async function ensureFixtureAppointment(input: {
  businessId: string;
  branchId: string;
  customerId: string;
  serviceId: string;
  assignedStaffId: string;
  createdById: string;
  marker: string;
  scheduledAt: Date;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
}) {
  const existing = await prisma.appointment.findFirst({ where: { businessId: input.businessId, notes: input.marker } });
  const data = {
    branchId: input.branchId,
    customerId: input.customerId,
    serviceId: input.serviceId,
    serviceIds: [input.serviceId],
    assignedStaffId: input.assignedStaffId,
    createdById: input.createdById,
    scheduledAt: input.scheduledAt,
    durationMinutes: 45,
    status: input.status,
    notes: input.marker,
    completedAt: input.status === "COMPLETED" ? input.scheduledAt : null,
    cancelledAt: input.status === "CANCELLED" ? input.scheduledAt : null,
    noShowAt: input.status === "NO_SHOW" ? input.scheduledAt : null,
  } satisfies Prisma.AppointmentUncheckedUpdateInput;
  return existing
    ? prisma.appointment.update({ where: { id: existing.id }, data })
    : prisma.appointment.create({ data: { businessId: input.businessId, ...data } });
}

async function seedSalon(passwordHash: string) {
  const business = await ensureBusiness({ ...POS_CORE_UAT.salon, industryType: "SALON_BEAUTY" });
  const branchA = await ensureBranch(business.id, "Branch A");
  const branchB = await ensureBranch(business.id, "Branch B");
  const branches = new Map([[branchA.name, branchA], [branchB.name, branchB]]);
  const users = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
  for (const persona of salonPersonas) {
    users.set(persona.key, await ensureUser({
      businessId: business.id,
      branchId: branches.get(persona.branch)!.id,
      name: persona.name,
      email: persona.email,
      role: persona.role,
      permissions: persona.permissions,
      passwordHash,
    }));
  }
  const owner = users.get("owner")!;
  await ensureEntitlements(business.id, owner.id, ["POS", "INVENTORY", "SALON"]);
  await ensurePaymentMethods(business.id);

  const stylistA = await ensureUser({ businessId: business.id, branchId: branchA.id, name: "UAT Stylist A", email: "uat.salon.stylist-a@tetamu.test", role: "STAFF", permissions: ["APPOINTMENTS"], passwordHash, appointmentBookable: true });
  const stylistB = await ensureUser({ businessId: business.id, branchId: branchB.id, name: "UAT Stylist B", email: "uat.salon.stylist-b@tetamu.test", role: "STAFF", permissions: ["APPOINTMENTS"], passwordHash, appointmentBookable: true });
  const serviceCategory = await prisma.serviceCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "Salon Services" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "Salon Services" } });
  const serviceDefinitions = [["Haircut", "50.00", 45], ["Hair Colour", "150.00", 90], ["Treatment", "100.00", 60]] as const;
  const services = new Map<string, { id: string }>();
  for (const [name, price, durationMinutes] of serviceDefinitions) {
    const service = await prisma.service.upsert({
      where: { businessId_name: { businessId: business.id, name } },
      update: { categoryId: serviceCategory.id, category: serviceCategory.name, price, durationMinutes, status: "ACTIVE" },
      create: { businessId: business.id, categoryId: serviceCategory.id, category: serviceCategory.name, name, price, durationMinutes, status: "ACTIVE" },
    });
    services.set(name, service);
    for (const stylist of [stylistA, stylistB]) {
      await prisma.serviceStaffAssignment.upsert({ where: { serviceId_userId: { serviceId: service.id, userId: stylist.id } }, update: { businessId: business.id }, create: { businessId: business.id, serviceId: service.id, userId: stylist.id } });
    }
  }
  const productCategory = await prisma.productCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "Retail" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "Retail" } });
  for (const [name, sku, price] of [["Shampoo", "UAT-SHAMPOO", "30.00"], ["Serum", "UAT-SERUM", "60.00"]] as const) {
    const product = await prisma.product.upsert({ where: { businessId_name: { businessId: business.id, name } }, update: { categoryId: productCategory.id, category: productCategory.name, sku, price, status: "ACTIVE", trackInventory: false }, create: { businessId: business.id, categoryId: productCategory.id, category: productCategory.name, name, sku, price, status: "ACTIVE", trackInventory: false } });
    for (const branch of [branchA, branchB]) {
      await prisma.productStock.upsert({ where: { branchId_productId: { branchId: branch.id, productId: product.id } }, update: { quantity: 50, reorderLevel: 5 }, create: { businessId: business.id, branchId: branch.id, productId: product.id, quantity: 50, reorderLevel: 5 } });
    }
  }
  const packageCategory = await prisma.packageCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "Hair Care" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "Hair Care" } });
  const haircut = services.get("Haircut")!;
  const packageRow = await prisma.package.upsert({ where: { businessId_name: { businessId: business.id, name: "Haircut 3-Visit Pass" } }, update: { categoryId: packageCategory.id, serviceId: haircut.id, price: "120.00", totalUses: 3, status: "ACTIVE" }, create: { businessId: business.id, categoryId: packageCategory.id, serviceId: haircut.id, name: "Haircut 3-Visit Pass", description: "Permanent browser UAT package", price: "120.00", totalUses: 3, status: "ACTIVE" } });
  await prisma.packageServiceBenefit.upsert({ where: { packageId_serviceId: { packageId: packageRow.id, serviceId: haircut.id } }, update: { totalUses: 3 }, create: { businessId: business.id, packageId: packageRow.id, serviceId: haircut.id, totalUses: 3 } });

  const customerA = await ensureCustomer(business.id, branchA.id, "UAT Customer A", "+601100000101");
  const customerB = await ensureCustomer(business.id, branchB.id, "UAT Customer B", "+601100000102");
  await ensureCustomer(business.id, branchA.id, "UAT Walk-in", "+601100000199");
  await ensureFixtureAppointment({ businessId: business.id, branchId: branchA.id, customerId: customerA.id, serviceId: haircut.id, assignedStaffId: stylistA.id, createdById: owner.id, marker: "UAT_APPOINTMENT_SCHEDULED", scheduledAt: new Date("2026-08-29T03:00:00.000Z"), status: "SCHEDULED" });
  await ensureFixtureAppointment({ businessId: business.id, branchId: branchA.id, customerId: customerA.id, serviceId: haircut.id, assignedStaffId: stylistA.id, createdById: owner.id, marker: "UAT_APPOINTMENT_COMPLETED", scheduledAt: new Date("2026-08-27T03:00:00.000Z"), status: "COMPLETED" });
  await ensureFixtureAppointment({ businessId: business.id, branchId: branchB.id, customerId: customerB.id, serviceId: haircut.id, assignedStaffId: stylistB.id, createdById: owner.id, marker: "UAT_APPOINTMENT_CANCELLED", scheduledAt: new Date("2026-08-27T05:00:00.000Z"), status: "CANCELLED" });
  await ensureFixtureAppointment({ businessId: business.id, branchId: branchA.id, customerId: customerA.id, serviceId: haircut.id, assignedStaffId: stylistA.id, createdById: owner.id, marker: "UAT_APPOINTMENT_NO_SHOW", scheduledAt: new Date("2026-08-26T06:00:00.000Z"), status: "NO_SHOW" });

  const discounts = [
    { name: "UAT Valid 10%", discountType: "PERCENTAGE" as const, percentage: "10.00", fixedAmount: null, minimumSpend: "0.00", startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: new Date("2027-01-01T00:00:00.000Z"), active: true },
    { name: "UAT Expired RM5", discountType: "FIXED_AMOUNT" as const, percentage: null, fixedAmount: "5.00", minimumSpend: "0.00", startsAt: new Date("2025-01-01T00:00:00.000Z"), endsAt: new Date("2025-12-31T23:59:59.000Z"), active: true },
    { name: "UAT RM20 Min Spend", discountType: "FIXED_AMOUNT" as const, percentage: null, fixedAmount: "20.00", minimumSpend: "100.00", startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: new Date("2027-01-01T00:00:00.000Z"), active: true },
  ];
  for (const discount of discounts) {
    await prisma.catalogDiscount.upsert({ where: { businessId_name: { businessId: business.id, name: discount.name } }, update: discount, create: { businessId: business.id, scope: "ALL", ...discount } });
  }
  return { business, branchA, branchB, users, customerA, haircut };
}

async function seedAuto(passwordHash: string) {
  const business = await ensureBusiness({ ...POS_CORE_UAT.auto, industryType: "AUTO_DETAILING" });
  const branchA = await ensureBranch(business.id, "Branch A");
  const branchB = await ensureBranch(business.id, "Branch B");
  const branches = new Map([[branchA.name, branchA], [branchB.name, branchB]]);
  const users = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
  for (const persona of autoPersonas) {
    users.set(persona.key, await ensureUser({ businessId: business.id, branchId: branches.get(persona.branch)!.id, name: persona.name, email: persona.email, role: persona.role, permissions: persona.permissions, passwordHash }));
  }
  const owner = users.get("owner")!;
  await ensureEntitlements(business.id, owner.id, ["POS", "INVENTORY", "AUTO"]);
  await ensurePaymentMethods(business.id);
  const serviceCategory = await prisma.serviceCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "Auto Services" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "Auto Services" } });
  const service = await prisma.service.upsert({ where: { businessId_name: { businessId: business.id, name: "Premium Detailing" } }, update: { categoryId: serviceCategory.id, category: serviceCategory.name, price: "180.00", durationMinutes: 120, status: "ACTIVE" }, create: { businessId: business.id, categoryId: serviceCategory.id, category: serviceCategory.name, name: "Premium Detailing", price: "180.00", durationMinutes: 120, status: "ACTIVE" } });
  const productCategory = await prisma.productCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "Auto Retail" } }, update: { status: "ACTIVE" }, create: { businessId: business.id, name: "Auto Retail" } });
  const product = await prisma.product.upsert({ where: { businessId_name: { businessId: business.id, name: "Car Shampoo" } }, update: { categoryId: productCategory.id, category: productCategory.name, sku: "UAT-CAR-SHAMPOO", price: "35.00", status: "ACTIVE", trackInventory: false }, create: { businessId: business.id, categoryId: productCategory.id, category: productCategory.name, name: "Car Shampoo", sku: "UAT-CAR-SHAMPOO", price: "35.00", status: "ACTIVE", trackInventory: false } });
  await prisma.productStock.upsert({ where: { branchId_productId: { branchId: branchA.id, productId: product.id } }, update: { quantity: 50, reorderLevel: 5 }, create: { businessId: business.id, branchId: branchA.id, productId: product.id, quantity: 50, reorderLevel: 5 } });
  const customer = await ensureCustomer(business.id, branchA.id, "UAT Auto Customer", "+601100000201");
  const vehicle = await prisma.vehicle.upsert({ where: { businessId_plateNumber: { businessId: business.id, plateNumber: "UAT 2026" } }, update: { branchId: branchA.id, customerId: customer.id, brand: "Toyota", model: "Vios", color: "White", size: "MEDIUM", sizeSource: "MANUAL" }, create: { businessId: business.id, branchId: branchA.id, customerId: customer.id, plateNumber: "UAT 2026", brand: "Toyota", model: "Vios", color: "White", size: "MEDIUM", sizeSource: "MANUAL" } });
  const existingWorkOrder = await prisma.workOrder.findUnique({
    where: { businessId_orderNumber: { businessId: business.id, orderNumber: "UAT-WO-0001" } },
  });
  const workOrder = existingWorkOrder
    ? await prisma.workOrder.update({
        where: { id: existingWorkOrder.id },
        data: {
          branchId: branchA.id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          notes: "PERMANENT AUTO BROWSER UAT CHECKOUT",
        },
      })
    : await prisma.workOrder.create({
        data: {
          businessId: business.id,
          branchId: branchA.id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          orderNumber: "UAT-WO-0001",
          status: "READY_FOR_PICKUP",
          subtotal: "180.00",
          total: "180.00",
          paidAmount: "0.00",
          balance: "180.00",
          paymentStatus: "UNPAID",
          notes: "PERMANENT AUTO BROWSER UAT CHECKOUT",
        },
      });
  const existingItem = await prisma.workOrderItem.findFirst({ where: { workOrderId: workOrder.id, name: service.name } });
  if (existingItem) await prisma.workOrderItem.update({ where: { id: existingItem.id }, data: { serviceId: service.id, quantity: 1, unitPrice: "180.00", lineTotal: "180.00" } });
  else await prisma.workOrderItem.create({ data: { businessId: business.id, workOrderId: workOrder.id, serviceId: service.id, name: service.name, quantity: 1, unitPrice: "180.00", lineTotal: "180.00" } });
  return { business, branchA, branchB, users, customer, vehicle, workOrder };
}

async function addSalonFinancialTrace(salon: Awaited<ReturnType<typeof seedSalon>>) {
  const invoice = await prisma.invoice.upsert({
    where: { businessId_invoiceNumber: { businessId: salon.business.id, invoiceNumber: "UAT-TRACE-0001" } },
    update: { branchId: salon.branchA.id, customerId: salon.customerA.id, subtotal: "100.00", total: "100.00", paidAmount: "100.00", balance: "0.00", status: "PAID", issuedAt: fixtureNow },
    create: { businessId: salon.business.id, branchId: salon.branchA.id, customerId: salon.customerA.id, invoiceNumber: "UAT-TRACE-0001", subtotal: "100.00", total: "100.00", paidAmount: "100.00", balance: "0.00", status: "PAID", issuedAt: fixtureNow },
  });
  const existingItem = await prisma.invoiceItem.findFirst({ where: { invoiceId: invoice.id, name: "UAT Financial Trace" } });
  if (!existingItem) await prisma.invoiceItem.create({ data: { businessId: salon.business.id, invoiceId: invoice.id, serviceId: salon.haircut.id, name: "UAT Financial Trace", quantity: 2, unitPrice: "50.00", lineTotal: "100.00" } });
  const paymentDefinitions = [["UAT-TRACE-CARD", "CARD", "40.00"], ["UAT-TRACE-DUITNOW", "DUITNOW", "60.00"]] as const;
  for (const [reference, method, amount] of paymentDefinitions) {
    const existing = await prisma.payment.findFirst({ where: { businessId: salon.business.id, invoiceId: invoice.id, reference } });
    if (existing) await prisma.payment.update({ where: { id: existing.id }, data: { amount, method, status: "ACTIVE", branchId: salon.branchA.id, cashierId: salon.users.get("owner")!.id, paidAt: fixtureNow } });
    else await prisma.payment.create({ data: { businessId: salon.business.id, branchId: salon.branchA.id, invoiceId: invoice.id, cashierId: salon.users.get("owner")!.id, amount, method, reference, paidAt: fixtureNow } });
  }
}

async function prepareFreshRun(input: {
  auto: Awaited<ReturnType<typeof seedAuto>>;
  salon: Awaited<ReturnType<typeof seedSalon>>;
}) {
  const salonBranch = await ensureBranch(input.salon.business.id, POS_CORE_FRESH_RUN_BRANCH_NAME);
  const autoBranch = await ensureBranch(input.auto.business.id, POS_CORE_FRESH_RUN_BRANCH_NAME);
  const salonCashier = input.salon.users.get("cashier")!;
  const autoCashier = input.auto.users.get("cashier")!;
  const salonStylist = await prisma.user.findUniqueOrThrow({
    where: { email: "uat.salon.stylist-a@tetamu.test" },
  });

  const targets = [
    {
      business: input.salon.business,
      branch: salonBranch,
      cashier: salonCashier,
      label: "SALON FINAL UAT RUN",
    },
    {
      business: input.auto.business,
      branch: autoBranch,
      cashier: autoCashier,
      label: "AUTO FINAL UAT RUN",
    },
  ];

  const statusRows = [];
  for (const target of targets) {
    const businessDate = getCurrentBusinessDateValue(
      new Date(),
      target.business.timezone,
      target.business.businessDayCutoffTime,
    );
    const normalizedBusinessDate = new Date(`${businessDate}T00:00:00.000Z`);
    const [dailyClosingCount, cashierOpenShiftCount, targetBranchOpenShiftCount] = await Promise.all([
      prisma.dailyClosingSnapshot.count({
        where: {
          branchId: target.branch.id,
          businessDate: normalizedBusinessDate,
          businessId: target.business.id,
        },
      }),
      prisma.cashierShift.count({
        where: {
          businessId: target.business.id,
          cashierId: target.cashier.id,
          status: "OPEN",
        },
      }),
      prisma.cashierShift.count({
        where: {
          branchId: target.branch.id,
          businessId: target.business.id,
          status: "OPEN",
        },
      }),
    ]);

    assertPosCoreFreshRunSafe({
      cashierOpenShiftCount,
      dailyClosingCount,
      targetBranchOpenShiftCount,
    });

    statusRows.push({
      business: target.business.name,
      businessDate,
      cashier: target.cashier.name,
      dailyClosing: "NOT CLOSED",
      label: target.label,
      openShift: "NONE",
      ready: "YES",
      branch: target.branch.name,
      cutoff: target.business.businessDayCutoffTime,
      timezone: target.business.timezone,
    });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: salonCashier.id }, data: { branchId: salonBranch.id } }),
    prisma.user.update({ where: { id: salonStylist.id }, data: { branchId: salonBranch.id } }),
    prisma.user.update({ where: { id: autoCashier.id }, data: { branchId: autoBranch.id } }),
  ]);

  for (const business of [input.salon.business, input.auto.business]) {
    const targetBranch = business.id === input.salon.business.id ? salonBranch : autoBranch;
    const products = await prisma.product.findMany({ where: { businessId: business.id, status: "ACTIVE" } });
    for (const product of products) {
      await prisma.productStock.upsert({
        where: { branchId_productId: { branchId: targetBranch.id, productId: product.id } },
        update: { quantity: 50, reorderLevel: 5 },
        create: {
          branchId: targetBranch.id,
          businessId: business.id,
          productId: product.id,
          quantity: 50,
          reorderLevel: 5,
        },
      });
    }
  }

  console.log(JSON.stringify({ environment, mode, productionGuard: "ACTIVE", runs: statusRows }, null, 2));
}

async function status() {
  const businesses = await prisma.business.findMany({
    where: { slug: { in: [POS_CORE_UAT.salon.slug, POS_CORE_UAT.auto.slug] } },
    include: { branches: true, users: true, customers: true, services: true, products: true, appointments: true, workOrders: true, invoices: true },
    orderBy: { slug: "asc" },
  });
  console.log(JSON.stringify({ environment, mode, businesses: businesses.map((business) => ({ id: business.id, name: business.name, slug: business.slug, industryType: business.industryType, branches: business.branches.map((branch) => ({ id: branch.id, name: branch.name })), personas: business.users.filter((user) => user.loginEnabled).map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, permissions: user.permissions })), counts: { customers: business.customers.length, services: business.services.length, products: business.products.length, appointments: business.appointments.length, workOrders: business.workOrders.length, invoices: business.invoices.length } })) }, null, 2));
}

async function main() {
try {
  if (mode === "status") {
    await status();
  } else {
    const password = requireUatFixturePassword(process.env.LOCAL_POS_CORE_UAT_PASSWORD);
    const passwordHash = await bcrypt.hash(password, 12);
    const salon = await seedSalon(passwordHash);
    const auto = await seedAuto(passwordHash);
    await addSalonFinancialTrace(salon);
    if (mode === "fresh-run") {
      await prepareFreshRun({ auto, salon });
      return;
    }
    if (mode === "reset") {
      console.log("Reset reasserted deterministic master records. Settled work orders and browser-generated financial/audit history were retained for evidence.");
    }
    await status();
  }
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`Fixture database error ${error.code}: ${error.message}`);
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
}

void main();
