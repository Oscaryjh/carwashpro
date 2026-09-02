import { createHash } from "node:crypto";

import { Prisma, PrismaClient, type BusinessModuleKey } from "@prisma/client";
import { deriveAndPersistEntryAggregates } from "@/lib/payroll/component-service";
import { payrollDocumentEntry } from "@/lib/payroll/documents";
import { buildPayslipPdf } from "@/lib/payroll/export";

import {
  assertCanonicalTestingContext,
  assertCanonicalTestingDatabase,
  CANONICAL_UAT_BUSINESS_SLUG,
  CANONICAL_UAT_ISOLATION_BUSINESS_SLUG,
  CanonicalTestingGuardError,
  fixtureMarker,
  parseCanonicalPrepareMode,
  safeJson,
  stableFixtureId,
  type CanonicalPrepareMode,
} from "./lib/canonical-testing-guard";

type PlanStatus =
  | "WOULD CREATE"
  | "WOULD UPDATE"
  | "ALREADY EXISTS"
  | "NO CHANGE"
  | "BLOCKED";

type PlanItem = { key: string; status: PlanStatus; detail: string };

const PRIMARY_BUSINESS_ID = stableFixtureId("business.primary");
const ISOLATION_BUSINESS_ID = stableFixtureId("business.isolation");
const MAIN_BRANCH_ID = stableFixtureId("branch.main");
const SECOND_BRANCH_ID = stableFixtureId("branch.second");
const ISOLATION_BRANCH_ID = stableFixtureId("branch.isolation");
const OWNER_ID = stableFixtureId("user.owner");
const MANAGER_MEMBERSHIP_ID = stableFixtureId("membership.manager");
const STAFF_MEMBERSHIP_ID = stableFixtureId("membership.staff");
const MANAGER_USER_ID = stableFixtureId("user.manager");
const STAFF_USER_ID = stableFixtureId("user.staff");

const MANAGER_PHONE = "+60128793848";
const STAFF_PHONE = "+601112212259";
const MANAGER_PERMISSIONS = [
  "DASHBOARD",
  "APPOINTMENTS",
  "TEAM",
  "ATTENDANCE_EMPLOYEE_READ",
  "ATTENDANCE_EMPLOYEE_MANAGE",
  "ATTENDANCE_SETTINGS_READ",
  "ROSTER_VIEW",
  "ROSTER_CREATE",
  "ROSTER_EDIT",
  "ROSTER_PUBLISH",
  "VIEW_LEAVE",
  "APPROVE_LEAVE",
  "VIEW_CLAIM",
  "REVIEW_CLAIM",
] as const;
const ENABLED_MODULES: BusinessModuleKey[] = [
  "POS",
  "SALON",
  "INVENTORY",
  "HR",
  "PAYROLL",
  "CLAIMS",
  "COMMISSION",
  "EXPENSE",
  "LOYALTY",
];

function utcDate(dayOffset: number, hour = 0, minute = 0) {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + dayOffset,
      hour,
      minute,
      0,
      0,
    ),
  );
}

function startOfIsoWeek(date: Date) {
  const day = date.getUTCDay() || 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1),
  );
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function inspectPlan(prisma: PrismaClient): Promise<PlanItem[]> {
  const [primaryBySlug, isolationBySlug, ownerByEmail, managerAccount, staffAccount] =
    await Promise.all([
      prisma.business.findUnique({ where: { slug: CANONICAL_UAT_BUSINESS_SLUG } }),
      prisma.business.findUnique({ where: { slug: CANONICAL_UAT_ISOLATION_BUSINESS_SLUG } }),
      prisma.user.findUnique({ where: { email: "canonical.uat.owner@tetamu.local" } }),
      prisma.employeeAccount.findUnique({ where: { phoneNormalized: MANAGER_PHONE } }),
      prisma.employeeAccount.findUnique({ where: { phoneNormalized: STAFF_PHONE } }),
    ]);

  const plan: PlanItem[] = [];
  const stable = (
    key: string,
    row: { id: string } | null,
    expectedId: string,
    label: string,
  ) => {
    if (!row) {
      plan.push({ key, status: "WOULD CREATE", detail: label });
    } else if (row.id !== expectedId) {
      plan.push({
        key,
        status: "BLOCKED",
        detail: `${label} unique key belongs to a non-canonical record`,
      });
    } else {
      plan.push({ key, status: "ALREADY EXISTS", detail: label });
    }
  };
  stable("business.primary", primaryBySlug, PRIMARY_BUSINESS_ID, "TETAMU CANONICAL UAT");
  stable(
    "business.isolation",
    isolationBySlug,
    ISOLATION_BUSINESS_ID,
    "TETAMU UAT ISOLATION BUSINESS",
  );
  stable("user.owner", ownerByEmail, OWNER_ID, "canonical owner login");
  plan.push({
    key: "account.manager",
    status: managerAccount ? "NO CHANGE" : "WOULD CREATE",
    detail: managerAccount
      ? "reuse the existing Testing employee account without changing authentication data"
      : "create canonical Testing manager employee account",
  });
  plan.push({
    key: "account.staff",
    status: staffAccount ? "NO CHANGE" : "WOULD CREATE",
    detail: staffAccount
      ? "reuse the existing Testing employee account without changing authentication data"
      : "create canonical Testing staff employee account",
  });
  plan.push({
    key: "dataset",
    status: primaryBySlug ? "WOULD UPDATE" : "WOULD CREATE",
    detail:
      "fixture-owned branches, modules, POS/CRM, appointments, HR, roster, attendance, leave, claims, commission, payroll, expense and inventory records",
  });
  plan.push({
    key: "external-side-effects",
    status: "NO CHANGE",
    detail: "no SMS, WhatsApp, email, payment-provider, refund-provider or webhook call",
  });
  return plan;
}

function assertPlanSafe(plan: readonly PlanItem[]) {
  const blocked = plan.filter((item) => item.status === "BLOCKED");
  if (blocked.length) {
    throw new CanonicalTestingGuardError(
      `Fixture preparation blocked: ${blocked.map((item) => item.key).join(", ")}.`,
    );
  }
}

async function ensureFixtureData(prisma: PrismaClient) {
  const passwordSourceEmail =
    process.env.CANONICAL_UAT_PASSWORD_SOURCE_EMAIL?.trim() ||
    "real-device-uat.hr@tetamu.local";
  const passwordSource = await prisma.user.findUnique({ where: { email: passwordSourceEmail } });
  if (!passwordSource?.passwordHash) {
    throw new CanonicalTestingGuardError(
      "Approved Testing password-hash source is unavailable; owner identity cannot be created safely.",
    );
  }

  const historicalDay = utcDate(-7);
  const multiSessionDay = utcDate(-5);
  const correctionDay = utcDate(-3);
  const upcomingDay = utcDate(2, 10);
  const weekStart = startOfIsoWeek(new Date());
  const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0));

  return prisma.$transaction(
    async (tx) => {
      await tx.business.upsert({
        where: { id: PRIMARY_BUSINESS_ID },
        create: {
          id: PRIMARY_BUSINESS_ID,
          name: "TETAMU CANONICAL UAT",
          slug: CANONICAL_UAT_BUSINESS_SLUG,
          industryType: "SALON_BEAUTY",
          timezone: "Asia/Singapore",
          email: "canonical-uat@invalid.test",
          address: fixtureMarker("business.primary"),
        },
        update: {
          name: "TETAMU CANONICAL UAT",
          industryType: "SALON_BEAUTY",
          timezone: "Asia/Singapore",
          email: "canonical-uat@invalid.test",
          address: fixtureMarker("business.primary"),
          status: "active",
        },
      });
      await tx.business.upsert({
        where: { id: ISOLATION_BUSINESS_ID },
        create: {
          id: ISOLATION_BUSINESS_ID,
          name: "TETAMU UAT ISOLATION BUSINESS",
          slug: CANONICAL_UAT_ISOLATION_BUSINESS_SLUG,
          industryType: "GENERAL_SERVICE",
          timezone: "Asia/Singapore",
          email: "canonical-isolation@invalid.test",
          address: fixtureMarker("business.isolation"),
        },
        update: {
          name: "TETAMU UAT ISOLATION BUSINESS",
          timezone: "Asia/Singapore",
          email: "canonical-isolation@invalid.test",
          address: fixtureMarker("business.isolation"),
          status: "active",
        },
      });

      for (const [id, businessId, name, markerKey] of [
        [MAIN_BRANCH_ID, PRIMARY_BUSINESS_ID, "UAT MAIN BRANCH", "branch.main"],
        [SECOND_BRANCH_ID, PRIMARY_BUSINESS_ID, "UAT SECOND BRANCH", "branch.second"],
        [
          ISOLATION_BRANCH_ID,
          ISOLATION_BUSINESS_ID,
          "UAT ISOLATION BRANCH",
          "branch.isolation",
        ],
      ] as const) {
        await tx.branch.upsert({
          where: { id },
          create: {
            id,
            businessId,
            name,
            countryCode: "MY",
            stateCode: "KUL",
            address: fixtureMarker(markerKey),
          },
          update: {
            name,
            status: "ACTIVE",
            stateCode: "KUL",
            address: fixtureMarker(markerKey),
          },
        });
      }

      for (const moduleKey of ENABLED_MODULES) {
        await tx.businessModuleEntitlement.upsert({
          where: { businessId_moduleKey: { businessId: PRIMARY_BUSINESS_ID, moduleKey } },
          create: {
            id: stableFixtureId(`module.${moduleKey.toLowerCase()}`),
            businessId: PRIMARY_BUSINESS_ID,
            moduleKey,
            status: "ENABLED",
            enabledFrom: utcDate(-365),
            source: "MANUAL",
            planCode: fixtureMarker(`module.${moduleKey.toLowerCase()}`),
          },
          update: {
            status: "ENABLED",
            enabledUntil: null,
            source: "MANUAL",
            planCode: fixtureMarker(`module.${moduleKey.toLowerCase()}`),
          },
        });
      }
      await tx.user.upsert({
        where: { id: OWNER_ID },
        create: {
          id: OWNER_ID,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          name: "Canonical UAT Owner",
          email: "canonical.uat.owner@tetamu.local",
          passwordHash: passwordSource.passwordHash,
          role: "BUSINESS_OWNER",
          permissions: [],
          loginEnabled: true,
        },
        update: {
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          name: "Canonical UAT Owner",
          role: "BUSINESS_OWNER",
          status: "active",
          loginEnabled: true,
        },
      });

      const existingManagerAccount = await tx.employeeAccount.findUnique({
        where: { phoneNormalized: MANAGER_PHONE },
      });
      const managerAccount =
        existingManagerAccount ??
        (await tx.employeeAccount.create({
          data: {
            id: stableFixtureId("account.manager"),
            phoneNumber: "0128793848",
            phoneNormalized: MANAGER_PHONE,
            name: "Canonical UAT Manager",
          },
        }));
      const existingStaffAccount = await tx.employeeAccount.findUnique({
        where: { phoneNormalized: STAFF_PHONE },
      });
      const staffAccount =
        existingStaffAccount ??
        (await tx.employeeAccount.create({
          data: {
            id: stableFixtureId("account.staff"),
            phoneNumber: "01112212259",
            phoneNormalized: STAFF_PHONE,
            name: "Canonical UAT Staff",
          },
        }));

      await tx.employeeBusinessMembership.upsert({
        where: { id: MANAGER_MEMBERSHIP_ID },
        create: {
          id: MANAGER_MEMBERSHIP_ID,
          employeeAccountId: managerAccount.id,
          businessId: PRIMARY_BUSINESS_ID,
          employeeCode: "UAT-MANAGER",
          fullName: "Canonical UAT Manager",
          phoneNumber: MANAGER_PHONE,
          phoneNumberNormalized: MANAGER_PHONE,
          attendanceEnabled: true,
          position: "Branch Manager",
          payBasis: "MONTHLY",
          baseSalary: new Prisma.Decimal("5200.00"),
          workingDaysPerMonth: 26,
          normalWorkMinutesPerDay: 480,
        },
        update: {
          status: "ACTIVE",
          attendanceEnabled: true,
          fullName: "Canonical UAT Manager",
          position: "Branch Manager",
        },
      });
      await tx.employeeBusinessMembership.upsert({
        where: { id: STAFF_MEMBERSHIP_ID },
        create: {
          id: STAFF_MEMBERSHIP_ID,
          employeeAccountId: staffAccount.id,
          businessId: PRIMARY_BUSINESS_ID,
          employeeCode: "UAT-STAFF",
          fullName: "Canonical UAT Staff",
          phoneNumber: STAFF_PHONE,
          phoneNumberNormalized: STAFF_PHONE,
          attendanceEnabled: true,
          position: "Service Staff",
          payBasis: "MONTHLY",
          baseSalary: new Prisma.Decimal("3800.00"),
          workingDaysPerMonth: 26,
          normalWorkMinutesPerDay: 480,
        },
        update: {
          status: "ACTIVE",
          attendanceEnabled: true,
          fullName: "Canonical UAT Staff",
          position: "Service Staff",
        },
      });

      await tx.user.upsert({
        where: { id: MANAGER_USER_ID },
        create: {
          id: MANAGER_USER_ID,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          employeeAccountId: managerAccount.id,
          employeeBusinessMembershipId: MANAGER_MEMBERSHIP_ID,
          name: "Canonical UAT Manager",
          role: "STAFF",
          permissions: [...MANAGER_PERMISSIONS],
          loginEnabled: false,
          teamMemberLinkStatus: "LINKED",
          teamMemberLinkedAt: new Date(),
        },
        update: {
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          employeeAccountId: managerAccount.id,
          name: "Canonical UAT Manager",
          role: "STAFF",
          permissions: [...MANAGER_PERMISSIONS],
          status: "active",
          teamMemberLinkStatus: "LINKED",
        },
      });
      await tx.user.upsert({
        where: { id: STAFF_USER_ID },
        create: {
          id: STAFF_USER_ID,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          employeeAccountId: staffAccount.id,
          employeeBusinessMembershipId: STAFF_MEMBERSHIP_ID,
          name: "Canonical UAT Staff",
          role: "STAFF",
          permissions: [],
          loginEnabled: false,
          appointmentBookable: true,
          teamMemberLinkStatus: "LINKED",
          teamMemberLinkedAt: new Date(),
        },
        update: {
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          employeeAccountId: staffAccount.id,
          name: "Canonical UAT Staff",
          role: "STAFF",
          permissions: [],
          status: "active",
          appointmentBookable: true,
          teamMemberLinkStatus: "LINKED",
        },
      });

      for (const assignment of [
        {
          id: stableFixtureId("assignment.manager.main"),
          membershipId: MANAGER_MEMBERSHIP_ID,
          branchId: MAIN_BRANCH_ID,
          isPrimary: true,
        },
        {
          id: stableFixtureId("assignment.staff.main"),
          membershipId: STAFF_MEMBERSHIP_ID,
          branchId: MAIN_BRANCH_ID,
          isPrimary: true,
        },
        {
          id: stableFixtureId("assignment.staff.second"),
          membershipId: STAFF_MEMBERSHIP_ID,
          branchId: SECOND_BRANCH_ID,
          isPrimary: false,
        },
      ]) {
        await tx.employeeBranchAssignment.upsert({
          where: { id: assignment.id },
          create: {
            ...assignment,
            businessId: PRIMARY_BUSINESS_ID,
            canClockIn: true,
            effectiveFrom: utcDate(-365),
          },
          update: { status: "ACTIVE", canClockIn: true, isPrimary: assignment.isPrimary },
        });
      }

      const customerId = stableFixtureId("customer.primary");
      await tx.customer.upsert({
        where: { id: customerId },
        create: {
          id: customerId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          name: "Canonical UAT Customer",
          phone: "+601100000001",
          email: "canonical-customer@invalid.test",
          notes: fixtureMarker("customer.primary"),
        },
        update: {
          branchId: MAIN_BRANCH_ID,
          name: "Canonical UAT Customer",
          email: "canonical-customer@invalid.test",
          notes: fixtureMarker("customer.primary"),
        },
      });
      await tx.customer.upsert({
        where: { id: stableFixtureId("customer.isolation") },
        create: {
          id: stableFixtureId("customer.isolation"),
          businessId: ISOLATION_BUSINESS_ID,
          branchId: ISOLATION_BRANCH_ID,
          name: "Isolation UAT Customer",
          phone: "+601100000099",
          email: "isolation-customer@invalid.test",
          notes: fixtureMarker("customer.isolation"),
        },
        update: { notes: fixtureMarker("customer.isolation") },
      });
      const vehicleId = stableFixtureId("vehicle.primary");
      await tx.vehicle.upsert({
        where: { id: vehicleId },
        create: {
          id: vehicleId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          customerId,
          plateNumber: "UAT-CANON-01",
          brand: "UAT",
          model: "Fixture",
          notes: fixtureMarker("vehicle.primary"),
        },
        update: { customerId, branchId: MAIN_BRANCH_ID, notes: fixtureMarker("vehicle.primary") },
      });
      const serviceId = stableFixtureId("service.primary");
      await tx.service.upsert({
        where: { id: serviceId },
        create: {
          id: serviceId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          name: "Canonical UAT Service",
          description: fixtureMarker("service.primary"),
          price: new Prisma.Decimal("100.00"),
          durationMinutes: 60,
        },
        update: {
          branchId: MAIN_BRANCH_ID,
          description: fixtureMarker("service.primary"),
          price: new Prisma.Decimal("100.00"),
          status: "ACTIVE",
        },
      });
      const productId = stableFixtureId("product.primary");
      await tx.product.upsert({
        where: { id: productId },
        create: {
          id: productId,
          businessId: PRIMARY_BUSINESS_ID,
          name: "Canonical UAT Inventory Item",
          sku: "UAT-CANON-SKU-01",
          description: fixtureMarker("product.primary"),
          price: new Prisma.Decimal("25.00"),
          costPrice: new Prisma.Decimal("10.00"),
          trackInventory: true,
        },
        update: {
          description: fixtureMarker("product.primary"),
          trackInventory: true,
          status: "ACTIVE",
        },
      });
      await tx.productStock.upsert({
        where: { id: stableFixtureId("stock.primary") },
        create: {
          id: stableFixtureId("stock.primary"),
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          productId,
          quantity: 25,
          reorderLevel: 5,
          targetStockLevel: 30,
        },
        update: { quantity: 25, reorderLevel: 5, targetStockLevel: 30 },
      });

      const supplierId = stableFixtureId("supplier.primary");
      await tx.supplier.upsert({
        where: { id: supplierId },
        create: {
          id: supplierId,
          businessId: PRIMARY_BUSINESS_ID,
          code: "UAT-SUP-01",
          name: "Canonical UAT Supplier",
          email: "canonical-supplier@invalid.test",
          notes: fixtureMarker("supplier.primary"),
        },
        update: { status: "ACTIVE", notes: fixtureMarker("supplier.primary") },
      });
      const purchaseOrderId = stableFixtureId("purchase-order.primary");
      await tx.purchaseOrder.upsert({
        where: { id: purchaseOrderId },
        create: {
          id: purchaseOrderId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          supplierId,
          poNumber: "UAT-PO-0001",
          status: "APPROVED",
          orderDate: historicalDay,
          subtotal: new Prisma.Decimal("100.00"),
          notes: fixtureMarker("purchase-order.primary"),
          createdById: OWNER_ID,
          approvedById: OWNER_ID,
          approvedAt: historicalDay,
        },
        update: { notes: fixtureMarker("purchase-order.primary") },
      });
      const purchaseOrderLineId = stableFixtureId("purchase-order-line.primary");
      await tx.purchaseOrderLine.upsert({
        where: { id: purchaseOrderLineId },
        create: {
          id: purchaseOrderLineId,
          businessId: PRIMARY_BUSINESS_ID,
          purchaseOrderId,
          productId,
          orderedQuantity: 10,
          expectedUnitCost: new Prisma.Decimal("10.00"),
          expectedTotal: new Prisma.Decimal("100.00"),
          notes: fixtureMarker("purchase-order-line.primary"),
        },
        update: { notes: fixtureMarker("purchase-order-line.primary") },
      });
      const supplierBillId = stableFixtureId("supplier-bill.primary");
      await tx.supplierBill.upsert({
        where: { id: supplierBillId },
        create: {
          id: supplierBillId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          supplierId,
          purchaseOrderId,
          billNumber: "UAT-BILL-0001",
          supplierInvoiceNumber: "UAT-SUP-INV-0001",
          supplierInvoiceNumberNormalized: "UAT-SUP-INV-0001",
          status: "DRAFT",
          matchStatus: "RECEIPT_PENDING",
          invoiceDate: historicalDay,
          dueDate: utcDate(14),
          subtotal: new Prisma.Decimal("100.00"),
          totalAmount: new Prisma.Decimal("100.00"),
          notes: fixtureMarker("supplier-bill.primary"),
          createdById: OWNER_ID,
        },
        update: { notes: fixtureMarker("supplier-bill.primary") },
      });
      await tx.supplierBillLine.upsert({
        where: { id: stableFixtureId("supplier-bill-line.primary") },
        create: {
          id: stableFixtureId("supplier-bill-line.primary"),
          businessId: PRIMARY_BUSINESS_ID,
          supplierBillId,
          purchaseOrderLineId,
          productId,
          descriptionSnapshot: "Canonical UAT Inventory Item",
          billedQuantity: 10,
          unitPrice: new Prisma.Decimal("10.00"),
          lineTotal: new Prisma.Decimal("100.00"),
          orderedQuantitySnapshot: 10,
          netReceivedSnapshot: 0,
          previouslyBilledSnapshot: 0,
        },
        update: { billedQuantity: 10, lineTotal: new Prisma.Decimal("100.00") },
      });

      for (const appointment of [
        {
          id: stableFixtureId("appointment.historical"),
          scheduledAt: new Date(historicalDay.getTime() + 10 * 60 * 60 * 1000),
          status: "COMPLETED" as const,
          completedAt: new Date(historicalDay.getTime() + 11 * 60 * 60 * 1000),
          notes: fixtureMarker("appointment.historical"),
        },
        {
          id: stableFixtureId("appointment.upcoming"),
          scheduledAt: upcomingDay,
          status: "CONFIRMED" as const,
          completedAt: null,
          notes: fixtureMarker("appointment.upcoming"),
        },
      ]) {
        await tx.appointment.upsert({
          where: { id: appointment.id },
          create: {
            ...appointment,
            businessId: PRIMARY_BUSINESS_ID,
            branchId: MAIN_BRANCH_ID,
            customerId,
            vehicleId,
            serviceId,
            serviceIds: [serviceId],
            assignedStaffId: STAFF_USER_ID,
            createdById: OWNER_ID,
            durationMinutes: 60,
          },
          update: {
            scheduledAt: appointment.scheduledAt,
            status: appointment.status,
            completedAt: appointment.completedAt,
            notes: appointment.notes,
            assignedStaffId: STAFF_USER_ID,
          },
        });
      }

      const workOrderId = stableFixtureId("work-order.completed");
      await tx.workOrder.upsert({
        where: { id: workOrderId },
        create: {
          id: workOrderId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          customerId,
          vehicleId,
          orderNumber: "UAT-WO-0001",
          status: "COMPLETED",
          subtotal: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          balance: new Prisma.Decimal("0.00"),
          paymentStatus: "REFUNDED",
          pickedUpAt: historicalDay,
          notes: fixtureMarker("work-order.completed"),
        },
        update: { notes: fixtureMarker("work-order.completed") },
      });
      await tx.workOrderItem.upsert({
        where: { id: stableFixtureId("work-order-item.completed") },
        create: {
          id: stableFixtureId("work-order-item.completed"),
          businessId: PRIMARY_BUSINESS_ID,
          workOrderId,
          serviceId,
          name: "Canonical UAT Service",
          quantity: 1,
          unitPrice: new Prisma.Decimal("100.00"),
          lineTotal: new Prisma.Decimal("100.00"),
        },
        update: { serviceId, name: "Canonical UAT Service" },
      });
      const invoiceId = stableFixtureId("invoice.completed");
      await tx.invoice.upsert({
        where: { id: invoiceId },
        create: {
          id: invoiceId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          workOrderId,
          customerId,
          invoiceNumber: "UAT-INV-0001",
          subtotal: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          balance: new Prisma.Decimal("0.00"),
          status: "REFUNDED",
          issuedAt: historicalDay,
        },
        update: { status: "REFUNDED" },
      });
      await tx.invoiceItem.upsert({
        where: { id: stableFixtureId("invoice-item.completed") },
        create: {
          id: stableFixtureId("invoice-item.completed"),
          businessId: PRIMARY_BUSINESS_ID,
          invoiceId,
          serviceId,
          commissionMembershipId: STAFF_MEMBERSHIP_ID,
          name: "Canonical UAT Service",
          quantity: 1,
          unitPrice: new Prisma.Decimal("100.00"),
          lineTotal: new Prisma.Decimal("100.00"),
        },
        update: { commissionMembershipId: STAFF_MEMBERSHIP_ID },
      });
      const paymentId = stableFixtureId("payment.completed");
      await tx.payment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          workOrderId,
          invoiceId,
          cashierId: OWNER_ID,
          amount: new Prisma.Decimal("100.00"),
          method: "CASH",
          reference: fixtureMarker("payment.completed"),
          paidAt: historicalDay,
        },
        update: { reference: fixtureMarker("payment.completed") },
      });
      await tx.paymentRefund.upsert({
        where: { id: stableFixtureId("refund.history") },
        create: {
          id: stableFixtureId("refund.history"),
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          paymentId,
          workOrderId,
          invoiceId,
          processedById: OWNER_ID,
          amount: new Prisma.Decimal("10.00"),
          method: "CASH",
          reason: fixtureMarker("refund.history"),
          reference: "UAT-REFUND-0001",
          refundedAt: historicalDay,
        },
        update: { reason: fixtureMarker("refund.history") },
      });

      const expenseCategoryId = stableFixtureId("expense-category.primary");
      await tx.expenseCategory.upsert({
        where: { id: expenseCategoryId },
        create: {
          id: expenseCategoryId,
          businessId: PRIMARY_BUSINESS_ID,
          name: "Canonical UAT Expense",
          code: "UAT-EXP",
          group: "OTHER",
          description: fixtureMarker("expense-category.primary"),
        },
        update: { active: true, description: fixtureMarker("expense-category.primary") },
      });
      await tx.businessExpense.upsert({
        where: { id: stableFixtureId("expense.primary") },
        create: {
          id: stableFixtureId("expense.primary"),
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          expenseNumber: "UAT-EXP-0001",
          categoryId: expenseCategoryId,
          categoryNameSnapshot: "Canonical UAT Expense",
          branchNameSnapshot: "UAT MAIN BRANCH",
          expenseDate: historicalDay,
          amount: new Prisma.Decimal("50.00"),
          payeeName: "Canonical UAT Supplier",
          description: fixtureMarker("expense.primary"),
          status: "CONFIRMED",
          paymentStatus: "PAID",
          paymentMethod: "CASH",
          paymentDate: historicalDay,
          paymentReference: "UAT-EXP-PAY-0001",
          createdById: OWNER_ID,
          confirmedById: OWNER_ID,
          confirmedAt: historicalDay,
          paidById: OWNER_ID,
          paidAt: historicalDay,
        },
        update: { description: fixtureMarker("expense.primary") },
      });

      const rosterPeriodId = stableFixtureId("roster-period.primary");
      await tx.rosterPeriod.upsert({
        where: { id: rosterPeriodId },
        create: {
          id: rosterPeriodId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          weekStart,
          status: "PUBLISHED",
          draftRevision: 1,
          publicationRevision: 1,
          createdById: OWNER_ID,
          updatedById: OWNER_ID,
        },
        update: { weekStart, status: "PUBLISHED", publicationRevision: 1 },
      });
      const rosterAssignmentId = stableFixtureId("roster-assignment.primary");
      await tx.rosterAssignment.upsert({
        where: { id: rosterAssignmentId },
        create: {
          id: rosterAssignmentId,
          rosterPeriodId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          membershipId: STAFF_MEMBERSHIP_ID,
          workDate: upcomingDay,
          kind: "WORK_SHIFT",
          shiftNameSnapshot: "Canonical Day Shift",
          startAt: upcomingDay,
          endAt: new Date(upcomingDay.getTime() + 8 * 60 * 60 * 1000),
          breakMinutes: 60,
          note: fixtureMarker("roster-assignment.primary"),
          createdById: OWNER_ID,
          updatedById: OWNER_ID,
        },
        update: {
          workDate: upcomingDay,
          startAt: upcomingDay,
          endAt: new Date(upcomingDay.getTime() + 8 * 60 * 60 * 1000),
          note: fixtureMarker("roster-assignment.primary"),
        },
      });
      const publicationId = stableFixtureId("roster-publication.primary");
      const existingPublication = await tx.rosterPublication.findUnique({
        where: { id: publicationId },
      });
      if (!existingPublication) {
        await tx.rosterPublication.create({
          data: {
          id: publicationId,
          rosterPeriodId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          revision: 1,
          operationKey: fixtureMarker("roster-publication.primary"),
          sourceDigest: sha256("roster-publication.primary"),
          reason: fixtureMarker("roster-publication.primary"),
          publishedById: OWNER_ID,
          },
        });
      }
      const publishedAssignmentId = stableFixtureId("roster-published-assignment.primary");
      const existingPublishedAssignment = await tx.rosterPublishedAssignment.findUnique({
        where: { id: publishedAssignmentId },
      });
      if (!existingPublishedAssignment) {
        await tx.rosterPublishedAssignment.create({
          data: {
          id: publishedAssignmentId,
          publicationId,
          sourceAssignmentId: rosterAssignmentId,
          resolvedSource: "CUSTOM_SHIFT",
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          membershipId: STAFF_MEMBERSHIP_ID,
          workDate: upcomingDay,
          kind: "WORK_SHIFT",
          shiftNameSnapshot: "Canonical Day Shift",
          startAt: upcomingDay,
          endAt: new Date(upcomingDay.getTime() + 8 * 60 * 60 * 1000),
          breakMinutes: 60,
          timezoneSnapshot: "Asia/Singapore",
          evidenceDisposition: "APPLIED",
          evidenceReference: fixtureMarker("roster-published-assignment.primary"),
          },
        });
      }

      async function completedAttendance(key: string, workDate: Date, startHour: number, minutes: number) {
        const attendanceId = stableFixtureId(key);
        const clockInAt = new Date(workDate.getTime() + startHour * 60 * 60 * 1000);
        const clockOutAt = new Date(clockInAt.getTime() + minutes * 60 * 1000);
        let attendance = await tx.employeeAttendance.findUnique({ where: { id: attendanceId } });
        if (!attendance) {
          attendance = await tx.employeeAttendance.create({
            data: {
            id: attendanceId,
            employeeAccountId: staffAccount.id,
            membershipId: STAFF_MEMBERSHIP_ID,
            businessId: PRIMARY_BUSINESS_ID,
            branchId: MAIN_BRANCH_ID,
            workDate,
            status: "COMPLETED",
            clockInAt,
            clockOutAt,
            totalWorkedMinutes: minutes,
            },
          });
        }
        const inId = stableFixtureId(`${key}.clock-in`);
        const outId = stableFixtureId(`${key}.clock-out`);
        const existingClockIn = await tx.attendancePunch.findUnique({ where: { id: inId } });
        if (!existingClockIn) {
          await tx.attendancePunch.create({
            data: {
            id: inId,
            businessId: PRIMARY_BUSINESS_ID,
            branchId: MAIN_BRANCH_ID,
            employeeId: STAFF_MEMBERSHIP_ID,
            attendanceSessionId: attendanceId,
            type: "CLOCK_IN",
            serverTimestamp: clockInAt,
            insideGeofence: false,
            geofenceStatus: "GEOFENCE_DISABLED",
            source: "SYSTEM",
            deviceId: fixtureMarker(key),
            },
          });
        }
        const existingClockOut = await tx.attendancePunch.findUnique({ where: { id: outId } });
        if (!existingClockOut) {
          await tx.attendancePunch.create({
            data: {
            id: outId,
            businessId: PRIMARY_BUSINESS_ID,
            branchId: MAIN_BRANCH_ID,
            employeeId: STAFF_MEMBERSHIP_ID,
            attendanceSessionId: attendanceId,
            type: "CLOCK_OUT",
            serverTimestamp: clockOutAt,
            insideGeofence: false,
            geofenceStatus: "GEOFENCE_DISABLED",
            source: "SYSTEM",
            deviceId: fixtureMarker(key),
            },
          });
        }
        if (attendance.clockInPunchId !== inId || attendance.clockOutPunchId !== outId) {
          await tx.employeeAttendance.update({
            where: { id: attendanceId },
            data: { clockInPunchId: inId, clockOutPunchId: outId },
          });
        }
      }
      await completedAttendance("attendance.completed", historicalDay, 9, 480);
      await completedAttendance("attendance.multi-session.1", multiSessionDay, 9, 180);
      await completedAttendance("attendance.multi-session.2", multiSessionDay, 14, 240);

      const correctionAttendanceId = stableFixtureId("attendance.correction");
      const correctionClockIn = new Date(correctionDay.getTime() + 9 * 60 * 60 * 1000);
      let correctionAttendance = await tx.employeeAttendance.findUnique({
        where: { id: correctionAttendanceId },
      });
      if (!correctionAttendance) {
        correctionAttendance = await tx.employeeAttendance.create({
          data: {
          id: correctionAttendanceId,
          employeeAccountId: staffAccount.id,
          membershipId: STAFF_MEMBERSHIP_ID,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          workDate: correctionDay,
          status: "INCOMPLETE",
          clockInAt: correctionClockIn,
          requiresApproval: true,
          approvalStatus: "PENDING",
          },
        });
      }
      const correctionPunchId = stableFixtureId("attendance.correction.clock-in");
      const existingCorrectionPunch = await tx.attendancePunch.findUnique({
        where: { id: correctionPunchId },
      });
      if (!existingCorrectionPunch) {
        await tx.attendancePunch.create({
          data: {
          id: correctionPunchId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          employeeId: STAFF_MEMBERSHIP_ID,
          attendanceSessionId: correctionAttendanceId,
          type: "CLOCK_IN",
          serverTimestamp: correctionClockIn,
          insideGeofence: false,
          geofenceStatus: "GEOFENCE_DISABLED",
          source: "SYSTEM",
          deviceId: fixtureMarker("attendance.correction"),
          },
        });
      }
      if (correctionAttendance.clockInPunchId !== correctionPunchId) {
        await tx.employeeAttendance.update({
          where: { id: correctionAttendanceId },
          data: { clockInPunchId: correctionPunchId },
        });
      }
      const attendanceExceptionId = stableFixtureId("attendance.exception.pending");
      const existingAttendanceException = await tx.attendanceException.findUnique({
        where: { id: attendanceExceptionId },
      });
      if (!existingAttendanceException) {
        await tx.attendanceException.create({
          data: {
          id: attendanceExceptionId,
          attendanceSessionId: correctionAttendanceId,
          employeeId: STAFF_MEMBERSHIP_ID,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          type: "FORGOT_CLOCK_OUT",
          reason: fixtureMarker("attendance.exception.pending"),
          status: "PENDING",
          requestedClockOutAt: new Date(correctionClockIn.getTime() + 8 * 60 * 60 * 1000),
          },
        });
      }

      for (const overtime of [
        {
          key: "staff",
          membershipId: STAFF_MEMBERSHIP_ID,
          workDate: new Date(periodStart.getTime() + 2 * 24 * 60 * 60 * 1000),
        },
        {
          key: "manager-self",
          membershipId: MANAGER_MEMBERSHIP_ID,
          workDate: new Date(periodStart.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      ] as const) {
        const expectedDayId = stableFixtureId(`attendance.expected-day.ot.${overtime.key}`);
        const expectedStartAt = new Date(overtime.workDate.getTime() + 9 * 60 * 60 * 1000);
        const expectedEndAt = new Date(overtime.workDate.getTime() + 17 * 60 * 60 * 1000);
        const actualClockOutAt = new Date(expectedEndAt.getTime() + 60 * 60 * 1000);
        const existingExpectedDay = await tx.attendanceExpectedDay.findUnique({
          where: { id: expectedDayId },
        });
        if (!existingExpectedDay) {
          await tx.attendanceExpectedDay.create({
            data: {
              id: expectedDayId,
              businessId: PRIMARY_BUSINESS_ID,
              branchId: MAIN_BRANCH_ID,
              membershipId: overtime.membershipId,
              workDate: overtime.workDate,
              kind: "WORKDAY",
              source: "MANUAL_EVIDENCE",
              expectedStartAt,
              expectedEndAt,
              graceMinutes: 0,
              timezoneSnapshot: "Asia/Singapore",
              policySnapshot: { scheduledBreakMinutes: 60 },
              evidenceReference: fixtureMarker(
                `attendance.expected-day.ot.${overtime.key}`,
              ),
              createdById: OWNER_ID,
            },
          });
        }
        const finalResultId = stableFixtureId(
          `attendance.final-result.ot.${overtime.key}`,
        );
        const existingFinalResult = await tx.attendanceP2FinalResult.findUnique({
          where: { id: finalResultId },
        });
        if (!existingFinalResult) {
          await tx.attendanceP2FinalResult.create({
            data: {
              id: finalResultId,
              businessId: PRIMARY_BUSINESS_ID,
              branchId: MAIN_BRANCH_ID,
              membershipId: overtime.membershipId,
              workDate: overtime.workDate,
              version: 1,
              outcome: "PRESENT",
              expectedDayKindSnapshot: "WORKDAY",
              expectedDayId,
              expectedStartAt,
              expectedEndAt,
              graceMinutesSnapshot: 0,
              actualClockInAt: expectedStartAt,
              actualClockOutAt,
              totalBreakMinutes: 60,
              totalWorkedMinutes: 480,
              sourceDigest: sha256(`attendance.final-result.ot.${overtime.key}.source`),
              resolutionDigest: sha256(
                `attendance.final-result.ot.${overtime.key}.resolution`,
              ),
              createdById: OWNER_ID,
            },
          });
        }
      }

      const leavePolicyId = stableFixtureId("leave-policy.primary");
      const leaveVersionId = stableFixtureId("leave-policy-version.primary");
      await tx.leavePolicy.upsert({
        where: { id: leavePolicyId },
        create: {
          id: leavePolicyId,
          businessId: PRIMARY_BUSINESS_ID,
          code: "UAT-ANNUAL",
          name: "Canonical UAT Annual Leave",
          defaultEntitlementDays: new Prisma.Decimal("14.00"),
          legalStatus: "COMPANY_POLICY_ONLY",
          statutoryCategory: "ANNUAL_LEAVE",
        },
        update: { active: true, defaultEntitlementDays: new Prisma.Decimal("14.00") },
      });
      const existingLeaveVersion = await tx.leavePolicyVersion.findUnique({
        where: { id: leaveVersionId },
      });
      if (!existingLeaveVersion) {
        await tx.leavePolicyVersion.create({
          data: {
          id: leaveVersionId,
          businessId: PRIMARY_BUSINESS_ID,
          policyId: leavePolicyId,
          revision: 1,
          status: "ACTIVE",
          effectiveFrom: periodStart,
          nameSnapshot: "Canonical UAT Annual Leave",
          payTreatment: "PAID",
          countMode: "WEEKDAYS",
          balanceTracked: true,
          defaultEntitlementDays: new Prisma.Decimal("14.00"),
          origin: "BUSINESS_CUSTOM",
          legalStatus: "COMPANY_POLICY_ONLY",
          statutoryCategory: "ANNUAL_LEAVE",
          reason: fixtureMarker("leave-policy-version.primary"),
          createdById: OWNER_ID,
          },
        });
      }
      await tx.employeeLeaveBalance.upsert({
        where: { id: stableFixtureId("leave-balance.staff") },
        create: {
          id: stableFixtureId("leave-balance.staff"),
          businessId: PRIMARY_BUSINESS_ID,
          membershipId: STAFF_MEMBERSHIP_ID,
          policyId: leavePolicyId,
          year: new Date().getUTCFullYear(),
          entitlementOverrideDays: new Prisma.Decimal("14.00"),
          note: fixtureMarker("leave-balance.staff"),
        },
        update: { entitlementOverrideDays: new Prisma.Decimal("14.00"), note: fixtureMarker("leave-balance.staff") },
      });
      for (const request of [
        {
          key: "leave-request.approved",
          membershipId: STAFF_MEMBERSHIP_ID,
          status: "APPROVED" as const,
          startsOn: utcDate(-20),
          reviewedById: MANAGER_USER_ID,
          reviewedAt: utcDate(-18),
        },
        {
          key: "leave-request.pending",
          membershipId: STAFF_MEMBERSHIP_ID,
          status: "PENDING" as const,
          startsOn: utcDate(10),
          reviewedById: null,
          reviewedAt: null,
        },
        {
          key: "leave-request.manager-self",
          membershipId: MANAGER_MEMBERSHIP_ID,
          status: "PENDING" as const,
          startsOn: utcDate(12),
          reviewedById: null,
          reviewedAt: null,
        },
      ]) {
        const id = stableFixtureId(request.key);
        const existingLeaveRequest = await tx.leaveRequest.findUnique({ where: { id } });
        if (!existingLeaveRequest) {
          await tx.leaveRequest.create({
            data: {
            id,
            businessId: PRIMARY_BUSINESS_ID,
            membershipId: request.membershipId,
            branchId: MAIN_BRANCH_ID,
            policyId: leavePolicyId,
            policyVersionId: leaveVersionId,
            policyNameSnapshot: "Canonical UAT Annual Leave",
            payTreatmentSnapshot: "PAID",
            legalStatusSnapshot: "COMPANY_POLICY_ONLY",
            statutoryCategorySnapshot: "ANNUAL_LEAVE",
            startsOn: request.startsOn,
            endsOn: request.startsOn,
            requestedDays: new Prisma.Decimal("1.00"),
            reason: fixtureMarker(request.key),
            status: request.status,
            clientRequestId: stableFixtureId(`${request.key}.client`),
            reviewedById: request.reviewedById,
            reviewedAt: request.reviewedAt,
            },
          });
        }
      }

      const claimCategoryId = stableFixtureId("claim-category.primary");
      const claimPolicyId = stableFixtureId("claim-policy.primary");
      await tx.claimCategory.upsert({
        where: { id: claimCategoryId },
        create: {
          id: claimCategoryId,
          businessId: PRIMARY_BUSINESS_ID,
          code: "UAT-GENERAL",
          name: "Canonical UAT General Claim",
          description: fixtureMarker("claim-category.primary"),
        },
        update: { active: true, description: fixtureMarker("claim-category.primary") },
      });
      const existingClaimPolicy = await tx.claimPolicyRevision.findUnique({
        where: { id: claimPolicyId },
      });
      if (!existingClaimPolicy) {
        await tx.claimPolicyRevision.create({
          data: {
          id: claimPolicyId,
          businessId: PRIMARY_BUSINESS_ID,
          categoryId: claimCategoryId,
          revision: 1,
          status: "ACTIVE",
          effectiveFrom: periodStart,
          nameSnapshot: "Canonical UAT General Claim",
          natureSnapshot: "GENERAL",
          maxLineAmount: new Prisma.Decimal("500.00"),
          reason: fixtureMarker("claim-policy.primary"),
          createdById: OWNER_ID,
          },
        });
      }
      for (const claim of [
        {
          key: "claim.approved",
          lineKey: "claim-line.approved",
          membershipId: STAFF_MEMBERSHIP_ID,
          status: "APPROVED" as const,
          reviewStatus: "APPROVED" as const,
          approvedTotal: new Prisma.Decimal("30.00"),
          reviewedById: MANAGER_USER_ID,
          reviewedAt: utcDate(-8),
        },
        {
          key: "claim.pending",
          lineKey: "claim-line.pending",
          membershipId: STAFF_MEMBERSHIP_ID,
          status: "SUBMITTED" as const,
          reviewStatus: "PENDING" as const,
          approvedTotal: new Prisma.Decimal("0.00"),
          reviewedById: null,
          reviewedAt: null,
        },
        {
          key: "claim.manager-self",
          lineKey: "claim-line.manager-self",
          membershipId: MANAGER_MEMBERSHIP_ID,
          status: "SUBMITTED" as const,
          reviewStatus: "PENDING" as const,
          approvedTotal: new Prisma.Decimal("0.00"),
          reviewedById: null,
          reviewedAt: null,
        },
      ]) {
        const claimId = stableFixtureId(claim.key);
        const existingClaim = await tx.employeeClaim.findUnique({ where: { id: claimId } });
        if (!existingClaim) {
          await tx.employeeClaim.create({
            data: {
            id: claimId,
            businessId: PRIMARY_BUSINESS_ID,
            membershipId: claim.membershipId,
            branchId: MAIN_BRANCH_ID,
            claimNumber: `UAT-${claim.key.toUpperCase().replaceAll(".", "-")}`,
            clientRequestId: stableFixtureId(`${claim.key}.client`),
            purpose: fixtureMarker(claim.key),
            status: claim.status,
            submittedTotal: new Prisma.Decimal("30.00"),
            approvedTotal: claim.approvedTotal,
            submittedAt: utcDate(-9),
            reviewedById: claim.reviewedById,
            reviewedAt: claim.reviewedAt,
            },
          });
        }
        const claimLineId = stableFixtureId(claim.lineKey);
        const existingClaimLine = await tx.claimLine.findUnique({ where: { id: claimLineId } });
        if (!existingClaimLine) {
          await tx.claimLine.create({
            data: {
            id: claimLineId,
            businessId: PRIMARY_BUSINESS_ID,
            claimId,
            lineNumber: 1,
            categoryId: claimCategoryId,
            policyRevisionId: claimPolicyId,
            categoryCodeSnapshot: "UAT-GENERAL",
            categoryNameSnapshot: "Canonical UAT General Claim",
            expenseNatureSnapshot: "GENERAL",
            expenseDate: utcDate(-10),
            merchant: "Canonical UAT Merchant",
            description: fixtureMarker(claim.lineKey),
            submittedAmount: new Prisma.Decimal("30.00"),
            approvedAmount: claim.approvedTotal,
            reviewStatus: claim.reviewStatus,
            },
          });
        }
      }

      const commissionPeriodId = stableFixtureId("commission-period.primary");
      const existingCommissionPeriod = await tx.commissionPeriod.findUnique({
        where: { id: commissionPeriodId },
      });
      if (!existingCommissionPeriod) {
        await tx.commissionPeriod.create({
          data: {
          id: commissionPeriodId,
          businessId: PRIMARY_BUSINESS_ID,
          branchId: MAIN_BRANCH_ID,
          scopeKey: "UAT-MAIN",
          earnedPeriodStart: periodStart,
          earnedPeriodEnd: periodEnd,
          status: "LOCKED",
          currentRevision: 1,
          calculatedById: OWNER_ID,
          calculatedAt: periodEnd,
          approvedById: OWNER_ID,
          approvedAt: periodEnd,
          approvalReason: fixtureMarker("commission-period.primary"),
          sourceDigest: sha256("commission-period.primary"),
          },
        });
      }
      const commissionStatementId = stableFixtureId("commission-statement.primary");
      const existingCommissionStatement = await tx.commissionStatement.findUnique({
        where: { id: commissionStatementId },
      });
      if (!existingCommissionStatement) {
        await tx.commissionStatement.create({
          data: {
          id: commissionStatementId,
          businessId: PRIMARY_BUSINESS_ID,
          periodId: commissionPeriodId,
          membershipId: STAFF_MEMBERSHIP_ID,
          calculationRevision: 1,
          status: "APPROVED",
          eligibleSalesCents: 10000,
          calculatedCommissionCents: 1000,
          finalCommissionCents: 1000,
          calculationDigest: sha256("commission-statement.primary"),
          approvedById: OWNER_ID,
          approvedAt: periodEnd,
          },
        });
      }

      await tx.payrollSetting.upsert({
        where: { businessId: PRIMARY_BUSINESS_ID },
        create: { id: stableFixtureId("payroll-setting.primary"), businessId: PRIMARY_BUSINESS_ID },
        update: {},
      });
      const compensationVersionId = stableFixtureId("compensation-version.staff");
      const existingCompensationVersion = await tx.employeeCompensationVersion.findUnique({
        where: { id: compensationVersionId },
      });
      if (!existingCompensationVersion) {
        await tx.employeeCompensationVersion.create({
          data: {
            id: compensationVersionId,
            businessId: PRIMARY_BUSINESS_ID,
            membershipId: STAFF_MEMBERSHIP_ID,
            effectiveFromMonth: periodStart,
            payBasis: "MONTHLY",
            baseRate: new Prisma.Decimal("3800.00"),
            source: "MANUAL",
            reasonType: "DATA_MIGRATION",
            reasonNote: fixtureMarker("compensation-version.staff"),
            createdById: OWNER_ID,
          },
        });
      }
      const payrollRunId = stableFixtureId("payroll-run.primary");
      let payrollRun = await tx.payrollRun.findUnique({ where: { id: payrollRunId } });
      if (!payrollRun) {
        payrollRun = await tx.payrollRun.create({
          data: {
          id: payrollRunId,
          businessId: PRIMARY_BUSINESS_ID,
          periodStart,
          periodEnd,
          status: "DRAFT",
          attendanceSource: "LEGACY_OPERATIONAL_SESSION",
          workingDaysPerMonthSnapshot: 26,
          normalWorkMinutesPerDaySnapshot: 480,
          breakMinutesPerDaySnapshot: 60,
          overtimeMultiplierSnapshot: new Prisma.Decimal("1.50"),
          publicHolidayExtraMultiplierSnapshot: new Prisma.Decimal("2.00"),
          createdById: OWNER_ID,
          },
        });
      }
      const payrollEntryId = stableFixtureId("payroll-entry.staff");
      let payrollEntry = await tx.payrollEntry.findUnique({ where: { id: payrollEntryId } });
      if (!payrollEntry) {
        if (payrollRun.status !== "DRAFT") {
          throw new CanonicalTestingGuardError(
            "Canonical payroll entry is missing from a non-draft fixture run.",
          );
        }
        payrollEntry = await tx.payrollEntry.create({
          data: {
          id: payrollEntryId,
          payrollRunId,
          businessId: PRIMARY_BUSINESS_ID,
          membershipId: STAFF_MEMBERSHIP_ID,
          compensationVersionId,
          compensationEffectiveFromMonthSnapshot: periodStart,
          compensationSourceSnapshot: "MANUAL",
          employeeCodeSnapshot: "UAT-STAFF",
          fullNameSnapshot: "Canonical UAT Staff",
          payBasisSnapshot: "MONTHLY",
          baseRateSnapshot: new Prisma.Decimal("3800.00"),
          workingDaysSnapshot: 26,
          normalWorkMinutesSnapshot: 480,
          attendanceDays: 1,
          regularMinutes: 480,
          notes: fixtureMarker("payroll-entry.staff"),
          },
        });
      }
      const payrollComponentId = stableFixtureId("payroll-component.staff.basic");
      const existingPayrollComponent = await tx.payrollEntryComponent.findUnique({
        where: { id: payrollComponentId },
      });
      if (!existingPayrollComponent) {
        if (payrollRun.status !== "DRAFT") {
          throw new CanonicalTestingGuardError(
            "Canonical payroll component is missing from a non-draft fixture run.",
          );
        }
        await tx.payrollEntryComponent.create({
          data: {
            id: payrollComponentId,
            businessId: PRIMARY_BUSINESS_ID,
            payrollRunId,
            payrollEntryId,
            membershipId: STAFF_MEMBERSHIP_ID,
            lineKey: "SYSTEM:BASIC_SALARY",
            type: "EARNING",
            code: "BASIC_SALARY",
            name: "Basic salary",
            amount: new Prisma.Decimal("3800.00"),
            sourceType: "BASIC_SALARY",
            sourceVersionId: compensationVersionId,
            effectiveFromMonth: periodStart,
            calculationBasis: "FIXTURE_BASE_RATE",
            origin: "SYSTEM",
            sortOrder: 10,
            createdById: OWNER_ID,
          },
        });
      }
      if (payrollRun.status === "DRAFT" && payrollEntry.calculationRevision === 0) {
        await deriveAndPersistEntryAggregates(tx, payrollEntry, 0);
        payrollEntry = await tx.payrollEntry.findUniqueOrThrow({ where: { id: payrollEntryId } });
      }
      if (payrollRun.status === "DRAFT") {
        payrollRun = await tx.payrollRun.update({
          where: { id: payrollRunId },
          data: { status: "REVIEW", submittedById: OWNER_ID, submittedAt: periodEnd },
        });
      }
      if (payrollRun.status === "REVIEW") {
        payrollRun = await tx.payrollRun.update({
          where: { id: payrollRunId },
          data: { status: "FINALIZED", finalizedById: OWNER_ID, finalizedAt: periodEnd },
        });
      }
      const payslipId = stableFixtureId("payslip.staff");
      const existingPayslip = await tx.payrollPayslipPublication.findUnique({
        where: { id: payslipId },
      });
      if (!existingPayslip) {
        const documentEntry = await tx.payrollEntry.findUniqueOrThrow({
          where: { id: payrollEntryId },
          include: {
            components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
            statutorySnapshots: true,
            claimReimbursementSnapshots: {
              where: { status: { in: ["READY", "SETTLED"] } },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        const documentBytes = buildPayslipPdf(
          {
            id: payrollRun.id,
            business: {
              name: "TETAMU CANONICAL UAT",
              companyNo: null,
              address: fixtureMarker("business.primary"),
              phone: null,
              email: "canonical-uat@invalid.test",
            },
            periodStart: payrollRun.periodStart,
            periodEnd: payrollRun.periodEnd,
            status: payrollRun.status,
            submittedAt: payrollRun.submittedAt,
            finalizedAt: payrollRun.finalizedAt,
          },
          payrollDocumentEntry(documentEntry),
        );
        await tx.payrollPayslipPublication.create({
          data: {
          id: payslipId,
          businessId: PRIMARY_BUSINESS_ID,
          payrollRunId,
          payrollEntryId,
          membershipId: STAFF_MEMBERSHIP_ID,
          documentBytes,
          documentSha256: sha256(documentBytes),
          publishedAt: periodEnd,
          publishedById: OWNER_ID,
          },
        });
      }

      return {
        businessId: PRIMARY_BUSINESS_ID,
        isolationBusinessId: ISOLATION_BUSINESS_ID,
        managerMembershipId: MANAGER_MEMBERSHIP_ID,
        staffMembershipId: STAFF_MEMBERSHIP_ID,
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export async function runCanonicalPrepare(
  prisma: PrismaClient,
  mode: CanonicalPrepareMode,
) {
  const environment = assertCanonicalTestingContext(process.env);
  const database = await assertCanonicalTestingDatabase(prisma);
  const plan = await inspectPlan(prisma);
  assertPlanSafe(plan);

  if (mode === "DRY_RUN") {
    return {
      mode,
      applied: false,
      environment,
      database,
      plan,
      externalSideEffects: "BLOCKED_BY_DESIGN",
    };
  }

  // Apply re-runs both guards immediately before the first mutation.
  assertCanonicalTestingContext(process.env);
  await assertCanonicalTestingDatabase(prisma);
  const result = await ensureFixtureData(prisma);
  return {
    mode,
    applied: true,
    environment,
    database,
    plan,
    result,
    externalSideEffects: "BLOCKED_BY_DESIGN",
  };
}

async function main() {
  const mode = parseCanonicalPrepareMode(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const result = await runCanonicalPrepare(prisma, mode);
    console.log(safeJson(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("prepare-testing-canonical-uat.ts")) {
  void main();
}
