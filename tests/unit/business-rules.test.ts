import assert from "node:assert/strict";
import test from "node:test";
import {
  canMoveWorkOrderStatus,
  formatOrderNumber,
} from "../../src/lib/validation/work-orders";
import {
  defaultStaffPermissions,
  getStaffHomePath,
  hasStaffPermission,
  normalizeStaffPermissions,
  routePermission,
} from "../../src/lib/auth/staff-permissions";
import { cashierPackagePurchaseSchema } from "../../src/lib/validation/packages";
import { salonAppointmentPaymentSchema } from "../../src/lib/validation/pos";
import { serviceSchema } from "../../src/lib/validation/services";
import { buildInvoicePdf } from "../../src/lib/invoices/invoice-pdf";
import {
  canMoveAppointmentStatus,
  createAppointmentSchema,
} from "../../src/lib/validation/appointments";

test("payment does not participate in the job status transition rules", () => {
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "READY_FOR_PICKUP"), true);
  assert.equal(canMoveWorkOrderStatus("READY_FOR_PICKUP", "COMPLETED"), true);
  assert.equal(canMoveWorkOrderStatus("IN_PROGRESS", "COMPLETED"), false);
  assert.equal(canMoveWorkOrderStatus("COMPLETED", "CANCELLED"), false);
});

test("salon appointment payments support partial payment and protect non-cash references", () => {
  const appointmentId = "11111111-1111-4111-8111-111111111111";

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
      amount: 25.5,
      method: "DUITNOW",
    }).success,
    false,
  );
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

test("sensitive WhatsApp routes use the session management permission", () => {
  assert.equal(routePermission("/whatsapp/inbox"), "WHATSAPP");
  assert.equal(routePermission("/whatsapp/settings"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/whatsapp/diagnostics"), "WHATSAPP_SESSION");
  assert.equal(routePermission("/branches"), "OWNER_ONLY");
});

test("staff without dashboard access are redirected to their first allowed module", () => {
  assert.equal(getStaffHomePath(["JOBS", "CRM"]), "/work-orders");
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
    packageId: "00000000-0000-4000-8000-000000000003",
  };

  assert.equal(cashierPackagePurchaseSchema.safeParse(baseInput).success, true);
  assert.equal(
    cashierPackagePurchaseSchema.safeParse({
      ...baseInput,
      customerId: undefined,
      vehicleId: "00000000-0000-4000-8000-000000000004",
    }).success,
    false,
  );
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

test("appointment input supports either a Salon customer or an AUTO vehicle", () => {
  const baseInput = {
    assignedStaffId: "",
    branchId: "",
    contactName: "",
    contactPhone: "",
    contactType: "REGISTERED_OWNER" as const,
    serviceId: "",
    serviceIds: [],
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

test("salon appointments follow the service lifecycle in order", () => {
  assert.equal(canMoveAppointmentStatus("SCHEDULED", "CONFIRMED"), true);
  assert.equal(canMoveAppointmentStatus("CONFIRMED", "ARRIVED"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "IN_SERVICE"), true);
  assert.equal(canMoveAppointmentStatus("IN_SERVICE", "COMPLETED"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "COMPLETED"), false);
  assert.equal(canMoveAppointmentStatus("COMPLETED", "CANCELLED"), false);
});

test("no show and cancellation stop once salon service starts", () => {
  assert.equal(canMoveAppointmentStatus("SCHEDULED", "NO_SHOW"), true);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "NO_SHOW"), false);
  assert.equal(canMoveAppointmentStatus("ARRIVED", "CANCELLED"), true);
  assert.equal(canMoveAppointmentStatus("IN_SERVICE", "CANCELLED"), false);
});
