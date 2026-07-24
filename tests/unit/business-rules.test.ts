import assert from "node:assert/strict";
import test from "node:test";
import {
  canMoveWorkOrderStatus,
  formatOrderNumber,
} from "../../src/lib/validation/work-orders";
import {
  defaultStaffPermissions,
  getDefaultStaffPermissionsForIndustry,
  getStaffHomePath,
  getStaffPermissionsForIndustry,
  hasStaffPermission,
  normalizeStaffPermissions,
  normalizeStaffPermissionsForIndustry,
  routePermission,
} from "../../src/lib/auth/staff-permissions";
import {
  cashierPackagePurchaseSchema,
  packageSchema,
  packageServiceBenefitsSchema,
} from "../../src/lib/validation/packages";
import { getPackageBenefitDefinitions } from "../../src/lib/packages/service-balances";
import { cashierSaleSchema } from "../../src/lib/validation/cashier";
import { salonAppointmentPaymentSchema } from "../../src/lib/validation/pos";
import { serviceSchema } from "../../src/lib/validation/services";
import {
  buildInvoicePdf,
  buildInvoiceReceiptPdf,
} from "../../src/lib/invoices/invoice-pdf";
import { packageAllowsVehicle } from "../../src/lib/vehicle-size";
import {
  canMoveAppointmentStatus,
  createAppointmentSchema,
  addAppointmentServicesSchema,
  formatAppointmentStatus,
  getDefaultAppointmentVisitType,
  normalizeSalonAppointmentStatus,
} from "../../src/lib/validation/appointments";

test("payment does not participate in the job status transition rules", () => {
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "READY_FOR_PICKUP"), true);
  assert.equal(canMoveWorkOrderStatus("READY_FOR_PICKUP", "COMPLETED"), true);
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "COMPLETED"), false);
  assert.equal(canMoveWorkOrderStatus("COMPLETED", "CANCELLED"), false);
});

test("cashier sale allows products and packages while services require an appointment", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  const packageId = "22222222-2222-4222-8222-222222222222";
  const customerId = "33333333-3333-4333-8333-333333333333";
  const serviceId = "44444444-4444-4444-8444-444444444444";
  const staffId = "55555555-5555-4555-8555-555555555555";
  const appointmentId = "66666666-6666-4666-8666-666666666666";

  assert.equal(
    cashierSaleSchema.safeParse({
      branchId: "",
      customerId: "",
      method: "CASH",
      packageIds: [],
      packageQuantities: [],
      productIds: [productId],
      productQuantities: [2],
    }).success,
    true,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      branchId: "",
      customerId: "",
      method: "CASH",
      packageIds: [packageId],
      packageQuantities: [1],
      productIds: [],
      productQuantities: [],
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      branchId: "",
      customerId,
      method: "DUITNOW",
      reference: "TX-001",
      packageIds: [packageId],
      packageQuantities: [1],
      productIds: [productId],
      productQuantities: [1],
    }).success,
    true,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      assignedStaffId: staffId,
      branchId: "",
      customerId: "",
      method: "CASH",
      packageIds: [],
      packageQuantities: [],
      productIds: [],
      productQuantities: [],
      serviceIds: [serviceId],
      serviceQuantities: [1],
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      assignedStaffId: "",
      branchId: "",
      customerId,
      method: "CASH",
      packageIds: [],
      packageQuantities: [],
      productIds: [],
      productQuantities: [],
      serviceIds: [serviceId],
      serviceQuantities: [1],
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      assignedStaffId: staffId,
      branchId: "",
      customerId,
      method: "CASH",
      packageIds: [],
      packageQuantities: [],
      productIds: [],
      productQuantities: [],
      serviceIds: [serviceId],
      serviceQuantities: [1],
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      appointmentId,
      assignedStaffId: staffId,
      branchId: "",
      customerId,
      method: "CASH",
      packageIds: [],
      packageQuantities: [],
      productIds: [],
      productQuantities: [],
      serviceIds: [serviceId],
      serviceQuantities: [1],
    }).success,
    true,
  );
});

test("cashier sale requires a customer before redeeming an existing package", () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const serviceId = "22222222-2222-4222-8222-222222222222";
  const customerPackageBalanceId = "33333333-3333-4333-8333-333333333333";
  const staffId = "44444444-4444-4444-8444-444444444444";
  const baseSale = {
    appointmentId: "55555555-5555-4555-8555-555555555555",
    assignedStaffId: staffId,
    branchId: "",
    method: "CASH" as const,
    packageIds: [],
    packageQuantities: [],
    productIds: [],
    productQuantities: [],
    serviceIds: [serviceId],
    serviceQuantities: [1],
    customerPackageIds: [customerPackageBalanceId],
  };

  assert.equal(
    cashierSaleSchema.safeParse({ ...baseSale, customerId: "" }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({ ...baseSale, customerId }).success,
    true,
  );
});

test("appointments within 30 minutes default to walk-in", () => {
  const now = new Date("2026-07-22T15:00:00.000Z");

  assert.equal(
    getDefaultAppointmentVisitType(new Date("2026-07-22T15:30:00.000Z"), now),
    "WALK_IN",
  );
  assert.equal(
    getDefaultAppointmentVisitType(new Date("2026-07-22T14:40:00.000Z"), now),
    "WALK_IN",
  );
  assert.equal(
    getDefaultAppointmentVisitType(new Date("2026-07-22T15:31:00.000Z"), now),
    "BOOKING",
  );
});

test("multi-service package benefits require unique services and preserve each allowance", () => {
  const washServiceId = "11111111-1111-4111-8111-111111111111";
  const haircutServiceId = "22222222-2222-4222-8222-222222222222";
  const parsed = packageServiceBenefitsSchema.parse([
    { serviceId: washServiceId, totalUses: 10 },
    { serviceId: haircutServiceId, totalUses: 2 },
  ]);

  assert.deepEqual(parsed, [
    { serviceId: washServiceId, totalUses: 10 },
    { serviceId: haircutServiceId, totalUses: 2 },
  ]);
  assert.equal(
    packageServiceBenefitsSchema.safeParse([
      { serviceId: washServiceId, totalUses: 10 },
      { serviceId: washServiceId, totalUses: 2 },
    ]).success,
    false,
  );
});

test("multi-service package accepts no legacy linked service", () => {
  assert.equal(
    packageSchema.safeParse({
      name: "Hair Wash 10 + Haircut 2",
      categoryId: "33333333-3333-4333-8333-333333333333",
      description: "",
      serviceId: "",
      price: "300",
      totalUses: 12,
      status: "ACTIVE",
    }).success,
    true,
  );
});

test("legacy single-service packages still produce one service balance", () => {
  const serviceId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(
    getPackageBenefitDefinitions({ serviceId, totalUses: 10 }),
    [{ serviceId, totalUses: 10 }],
  );
});

test("cashier discounts require a reference and loyalty redemption requires a customer", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  const catalogDiscountId = "33333333-3333-4333-8333-333333333333";
  const baseSale = {
    branchId: "",
    customerId: "",
    method: "CASH" as const,
    packageIds: [],
    packageQuantities: [],
    productIds: [productId],
    productQuantities: [1],
  };

  assert.equal(
    cashierSaleSchema.safeParse({
      ...baseSale,
      discountType: "PERCENT",
      discountValue: 10,
      discountReference: "PROMO-10",
    }).success,
    true,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      ...baseSale,
      discountType: "AMOUNT",
      discountValue: 5,
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      ...baseSale,
      catalogDiscountId,
    }).success,
    false,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      ...baseSale,
      catalogDiscountId,
      discountReference: "CATALOG-JULY",
    }).success,
    true,
  );
  assert.equal(
    cashierSaleSchema.safeParse({
      ...baseSale,
      loyaltyPoints: 100,
    }).success,
    false,
  );
});

test("salon appointment payments support partial payment and protect non-cash references", () => {
  const appointmentId = "11111111-1111-4111-8111-111111111111";
  const catalogDiscountId = "33333333-3333-4333-8333-333333333333";

  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: "25.50",
      method: "CASH",
    }).success,
    true,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: "25.50",
      method: "CASH",
      reference: null,
    }).success,
    true,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 25.5,
      method: "DUITNOW",
    }).success,
    false,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 0,
      method: "CASH",
      discountAmount: 5,
      depositAmount: 10,
      depositMethod: "CARD",
      depositReference: "CARD-001",
      tipAmount: 2,
    }).success,
    true,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 0,
      method: "CASH",
      customerPackageIds: ["22222222-2222-4222-8222-222222222222"],
    }).success,
    true,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 0,
      method: "CASH",
    }).success,
    false,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 25,
      method: "CASH",
      catalogDiscountId,
    }).success,
    false,
  );
  assert.equal(
    salonAppointmentPaymentSchema.safeParse({
      appointmentId,
      amount: 25,
      method: "CASH",
      catalogDiscountId,
      discountReference: "CATALOG-JULY",
    }).success,
    true,
  );
});

test("salon appointment statuses use the short workflow while preserving legacy records", () => {
  assert.equal(normalizeSalonAppointmentStatus("SCHEDULED"), "SCHEDULED");
  assert.equal(normalizeSalonAppointmentStatus("CONFIRMED"), "SCHEDULED");
  assert.equal(normalizeSalonAppointmentStatus("ARRIVED"), "SCHEDULED");
  assert.equal(normalizeSalonAppointmentStatus("IN_SERVICE"), "SCHEDULED");
  assert.equal(normalizeSalonAppointmentStatus("COMPLETED"), "COMPLETED");
  assert.equal(formatAppointmentStatus("IN_SERVICE"), "scheduled");
});

test("salon invoices render without a vehicle or work order", () => {
  const pdf = buildInvoicePdf({
    company: { name: "Tetamu Salon" },
    customer: { name: "CUSTOMER", phone: "60123456789" },
    invoiceNumber: "INV-SALON-TEST",
    issuedAt: new Date("2026-07-16T10:00:00+08:00"),
    items: [
      { name: "Hair Wash", quantity: 1, unitPrice: 35, lineTotal: 35 },
    ],
    paidAmount: 20,
    balance: 15,
    status: "partial",
    subtotal: 35,
    total: 35,
    reference: {
      label: "Appointment",
      value: "16 Jul 2026, 10:00 am",
      detail: "Staff: AMY",
    },
  });

  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.length > 500);
});

test("58mm invoice receipts use thermal paper width and support long item names", () => {
  const pdf = buildInvoiceReceiptPdf({
    company: { name: "Tetamu Beauty and Wellness" },
    customer: { name: "OSCAR YONG", phone: "01112212259" },
    invoiceNumber: "INV-58MM-TEST",
    issuedAt: new Date("2026-07-20T10:00:00+08:00"),
    items: [
      {
        name: "Balayage Highlights and Hair Treatment",
        quantity: 2,
        unitPrice: 120,
        lineTotal: 240,
      },
    ],
    paidAmount: 254.4,
    balance: 0,
    status: "paid",
    subtotal: 240,
    taxAmount: 14.4,
    taxLabel: "SST",
    taxRate: 6,
    total: 254.4,
    reference: {
      label: "Appointment",
      value: "20/07/2026",
      detail: "01:00 pm / OSCAR",
    },
  });

  const source = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(source, /\/MediaBox \[0 0 164\.41 /);
  assert.ok(pdf.length > 500);
});

test("invoice PDFs render package vouchers as deductions", () => {
  const input = {
    company: { name: "Tetamu Beauty and Wellness" },
    customer: { name: "OSCAR YONG", phone: "01112212259" },
    invoiceNumber: "INV-VOUCHER-TEST",
    issuedAt: new Date("2026-07-22T10:00:00+08:00"),
    items: [
      { name: "SST Test Haircut", quantity: 1, unitPrice: 70, lineTotal: 70 },
    ],
    paidAmount: 74.2,
    cashPaidAmount: 0,
    packageVoucherAmount: 74.2,
    balance: 0,
    status: "paid",
    subtotal: 70,
    taxAmount: 4.2,
    taxLabel: "SST",
    taxRate: 6,
    total: 74.2,
  };

  assert.match(buildInvoicePdf(input).toString("latin1"), /-RM74\.20/);
  assert.match(buildInvoiceReceiptPdf(input).toString("latin1"), /-RM74\.20/);
});

test("staff permissions are allow-list based and deduplicated", () => {
  assert.deepEqual(
    normalizeStaffPermissions(["CRM", "CRM", "POS", "UNKNOWN"]),
    ["CRM", "POS"],
  );
  assert.equal(
    hasStaffPermission({ role: "STAFF", permissions: ["CRM"] }, "CRM"),
    true,
  );
  assert.equal(
    hasStaffPermission({ role: "STAFF", permissions: ["CRM"] }, "REPORTS"),
    false,
  );
  assert.equal(
    hasStaffPermission({ role: "BUSINESS_OWNER", permissions: [] }, "REPORTS"),
    true,
  );
  assert.equal(
    hasStaffPermission(
      { role: "STAFF", permissions: ["REPORTS", "ALL_BRANCHES"] },
      "ALL_BRANCHES",
    ),
    true,
  );
  assert.equal(
    hasStaffPermission({ role: "STAFF", permissions: ["REPORTS"] }, "ALL_BRANCHES"),
    false,
  );
});

test("new staff defaults are limited to daily cashier operations", () => {
  assert.deepEqual(defaultStaffPermissions, [
    "CRM",
    "JOBS",
    "APPOINTMENTS",
    "POS",
    "INVOICES",
    "CLOSING",
    "WHATSAPP",
  ]);
  assert.equal(defaultStaffPermissions.includes("REPORTS"), false);
  assert.equal(defaultStaffPermissions.includes("WHATSAPP_SESSION"), false);
  assert.equal(defaultStaffPermissions.includes("DELETE_CUSTOMER"), false);
});

test("Beauty & Wellness staff permissions exclude Auto-only jobs", () => {
  assert.equal(
    getStaffPermissionsForIndustry("SALON_BEAUTY").some(
      (permission) => permission.key === "JOBS",
    ),
    false,
  );
  assert.deepEqual(getDefaultStaffPermissionsForIndustry("SALON_BEAUTY"), [
    "CRM",
    "APPOINTMENTS",
    "POS",
    "INVOICES",
    "CLOSING",
    "WHATSAPP",
  ]);
  assert.deepEqual(
    normalizeStaffPermissionsForIndustry(
      ["CRM", "JOBS", "APPOINTMENTS", "POS"],
      "SALON_BEAUTY",
    ),
    ["CRM", "APPOINTMENTS", "POS"],
  );
});

test("permission matrix separates cashier, manager, and owner capabilities", () => {
  const cashier = { role: "STAFF" as const, permissions: defaultStaffPermissions };
  const manager = {
    role: "STAFF" as const,
    permissions: [
      ...defaultStaffPermissions,
      "DASHBOARD" as const,
      "REPORTS" as const,
      "ALL_BRANCHES" as const,
    ],
  };
  const owner = { role: "BUSINESS_OWNER" as const, permissions: [] };

  assert.equal(hasStaffPermission(cashier, "POS"), true);
  assert.equal(hasStaffPermission(cashier, "DASHBOARD"), false);
  assert.equal(hasStaffPermission(cashier, "REPORTS"), false);
  assert.equal(hasStaffPermission(cashier, "TEAM"), false);
  assert.equal(hasStaffPermission(cashier, "DELETE_STAFF"), false);

  assert.equal(hasStaffPermission(manager, "DASHBOARD"), true);
  assert.equal(hasStaffPermission(manager, "REPORTS"), true);
  assert.equal(hasStaffPermission(manager, "ALL_BRANCHES"), true);
  assert.equal(hasStaffPermission(manager, "TEAM"), false);
  assert.equal(hasStaffPermission(manager, "DELETE_STAFF"), false);

  assert.equal(hasStaffPermission(owner, "DASHBOARD"), true);
  assert.equal(hasStaffPermission(owner, "REPORTS"), true);
  assert.equal(hasStaffPermission(owner, "TEAM"), true);
  assert.equal(hasStaffPermission(owner, "DELETE_STAFF"), true);
});

test("sensitive WhatsApp routes use the session management permission", () => {
  assert.equal(routePermission("/whatsapp/inbox"), "WHATSAPP");
  assert.equal(routePermission("/whatsapp/settings"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/whatsapp/diagnostics"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/branches"), "OWNER_ONLY");
});

test("management routes are restricted to the permissions that protect them", () => {
  assert.equal(routePermission("/dashboard"), "DASHBOARD");
  assert.equal(routePermission("/reports"), "REPORTS");
  assert.equal(routePermission("/team"), "TEAM");
  assert.equal(routePermission("/team/123"), "TEAM");
  assert.equal(routePermission("/business/settings"), "OWNER_ONLY");
  assert.equal(routePermission("/branches/123"), "OWNER_ONLY");
});

test("staff without dashboard access are redirected to their first allowed module", () => {
  assert.equal(getStaffHomePath(["JOBS", "CRM"]), "/work-orders");
  assert.equal(
    getStaffHomePath(["JOBS", "APPOINTMENTS", "POS"], "SALON_BEAUTY"),
    "/appointments",
  );
  assert.equal(getStaffHomePath(["CRM"]), "/crm");
  assert.equal(getStaffHomePath([]), "/login");
});

test("legacy work order numbers are shortened for display", () => {
  assert.equal(
    formatOrderNumber("WO-20260708-185239750-AETO"),
    "WO-260708-AETO",
  );
});

test("cashier package purchases bind to a customer account, not a vehicle", () => {
  const baseInput = {
    branchId: "00000000-0000-4000-8000-000000000001",
    customerId: "00000000-0000-4000-8000-000000000002",
    method: "CASH" as const,
    packageIds: [
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ],
    quantities: [2, 1],
  };

  assert.equal(cashierPackagePurchaseSchema.safeParse(baseInput).success, true);
  assert.equal(
    cashierPackagePurchaseSchema.safeParse({
      ...baseInput,
      customerId: undefined,
      vehicleId: "00000000-0000-4000-8000-000000000005",
    }).success,
    false,
  );
  assert.equal(
    cashierPackagePurchaseSchema.safeParse({
      ...baseInput,
      quantities: [1],
    }).success,
    false,
  );
});

test("package use is restricted by vehicle size and rejects unclassified vehicles", () => {
  assert.equal(packageAllowsVehicle("SMALL", "SMALL"), true);
  assert.equal(packageAllowsVehicle("SMALL", "MEDIUM"), false);
  assert.equal(packageAllowsVehicle("MEDIUM", "LARGE"), false);
  assert.equal(packageAllowsVehicle("ALL", "LARGE"), true);
  assert.equal(packageAllowsVehicle("ALL", "UNCLASSIFIED"), false);
});

test("package invoice PDFs render without a vehicle reference", () => {
  const pdf = buildInvoicePdf({
    company: { name: "Tetamu Salon" },
    customer: { name: "CUSTOMER", phone: "60123456789" },
    invoiceNumber: "INV-PACKAGE-TEST",
    issuedAt: new Date("2026-07-16T11:00:00+08:00"),
    items: [
      { name: "10+1 Basic Wash Package", quantity: 1, unitPrice: 150, lineTotal: 150 },
    ],
    paidAmount: 150,
    balance: 0,
    status: "paid",
    subtotal: 150,
    total: 150,
    reference: {
      label: "Package",
      value: "10+1 Basic Wash Package",
      detail: "11 uses / RM150.00",
    },
  });

  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.length > 500);
});

test("salon service fields accept a practical duration and staff assignments", () => {
  const result = serviceSchema.safeParse({
    categoryId: "00000000-0000-4000-8000-000000000001",
    durationMinutes: "90",
    name: "Hair Colouring",
    price: "120.00",
    staffIds: ["00000000-0000-4000-8000-000000000002"],
    status: "ACTIVE",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.durationMinutes, 90);
    assert.deepEqual(result.data.staffIds, [
      "00000000-0000-4000-8000-000000000002",
    ]);
  }
});

test("service duration rejects values outside the supported salon range", () => {
  const baseInput = {
    categoryId: "00000000-0000-4000-8000-000000000001",
    name: "Haircut",
    price: "35.00",
    staffIds: [],
    status: "ACTIVE" as const,
  };

  assert.equal(
    serviceSchema.safeParse({ ...baseInput, durationMinutes: "4" }).success,
    false,
  );
  assert.equal(
    serviceSchema.safeParse({ ...baseInput, durationMinutes: "721" }).success,
    false,
  );
});

test("appointment input supports customers, vehicles, and mixed sale items", () => {
  const productId = "00000000-0000-4000-8000-000000000003";
  const packageId = "00000000-0000-4000-8000-000000000004";
  const baseInput = {
    assignedStaffId: "",
    branchId: "",
    contactName: "",
    contactPhone: "",
    contactType: "REGISTERED_OWNER" as const,
    serviceId: "",
    serviceIds: [],
    productIds: [productId, productId],
    packageIds: [packageId],
    scheduledDate: "2026-07-20",
    scheduledTime: "10:30",
    notes: "",
  };

  assert.equal(
    createAppointmentSchema.safeParse({
      ...baseInput,
      customerId: "00000000-0000-4000-8000-000000000001",
      vehicleId: "",
    }).success,
    true,
  );
  const parsed = createAppointmentSchema.parse({
    ...baseInput,
    customerId: "00000000-0000-4000-8000-000000000001",
    vehicleId: "",
  });
  assert.deepEqual(parsed.productIds, [productId, productId]);
  assert.deepEqual(parsed.packageIds, [packageId]);
  assert.equal(
    createAppointmentSchema.safeParse({
      ...baseInput,
      customerId: "",
      vehicleId: "00000000-0000-4000-8000-000000000002",
    }).success,
    true,
  );
  assert.equal(
    createAppointmentSchema.safeParse({
      ...baseInput,
      customerId: "not-a-customer-id",
      vehicleId: "",
    }).success,
    false,
  );
});

test("salon service additions require at least one valid new service", () => {
  const appointmentId = "00000000-0000-4000-8000-000000000001";
  const serviceId = "00000000-0000-4000-8000-000000000002";

  assert.equal(
    addAppointmentServicesSchema.safeParse({ appointmentId, serviceIds: [serviceId] }).success,
    true,
  );
  assert.equal(
    addAppointmentServicesSchema.safeParse({ appointmentId, serviceIds: [] }).success,
    false,
  );
  assert.equal(
    addAppointmentServicesSchema.safeParse({ appointmentId, serviceIds: ["not-a-uuid"] }).success,
    false,
  );
});

test("salon appointments complete service directly before checkout", () => {
  assert.equal(canMoveAppointmentStatus("SCHEDULED", "COMPLETED"), true);
  assert.equal(canMoveAppointmentStatus("CONFIRMED", "COMPLETED"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "COMPLETED"), true);
  assert.equal(canMoveAppointmentStatus("IN_SERVICE", "COMPLETED"), true);
  assert.equal(canMoveAppointmentStatus("SCHEDULED", "CONFIRMED"), false);
  assert.equal(canMoveAppointmentStatus("COMPLETED", "CANCELLED"), false);
  assert.equal(formatAppointmentStatus("CONFIRMED"), "scheduled");
  assert.equal(formatAppointmentStatus("IN_SERVICE"), "scheduled");
});

test("no show and cancellation remain available before completion", () => {
  assert.equal(canMoveAppointmentStatus("SCHEDULED", "NO_SHOW"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "NO_SHOW"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "CANCELLED"), true);
  assert.equal(canMoveAppointmentStatus("IN_SERVICE", "CANCELLED"), true);
  assert.equal(canMoveAppointmentStatus("COMPLETED", "NO_SHOW"), false);
});
