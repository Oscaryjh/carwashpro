import { redirect } from "next/navigation";
import { CashierSalesPanel } from "@/components/cashier-sales-panel";
import type {
  CashierCartLine,
  CashierInitialSale,
  CashierStaffOption,
} from "@/components/cashier-unified-sale-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import {
  getCashierCatalog,
  getCashierCatalogAvailability,
} from "@/lib/cashier/catalog";
import { prisma } from "@/lib/prisma";
import { completeCashierSaleAction } from "@/app/(business)/cashier/actions";

type CashierPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
    appointmentId?: string;
  }>;
};

function countIds(ids: string[]) {
  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return counts;
}

function formatSingaporeDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Singapore",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function CashierPage({ searchParams }: CashierPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser(
    "PROCESS_CASHIER_PAYMENT",
  );

  if (industryType !== "SALON_BEAUTY") {
    redirect("/work-orders");
  }

  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const requestedAppointmentId = params.appointmentId?.trim() || null;
  const [branches, openShift, business, loyaltyProgram, requestedAppointment] = await Promise.all([
    getOperationalBranches(businessId, user),
    prisma.cashierShift.findFirst({
      where: { businessId, cashierId: user.userId, status: "OPEN" },
      select: { branchId: true },
    }),
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { sstEnabled: true, sstLabel: true, sstRate: true },
    }),
    prisma.loyaltyProgram.findUnique({
      where: { businessId },
      select: {
        enabled: true,
        redemptionEnabled: true,
        redemptionPointsPerRinggit: true,
        minimumRedemptionPoints: true,
      },
    }),
    requestedAppointmentId
      ? prisma.appointment.findFirst({
          where: { id: requestedAppointmentId, businessId },
          select: {
            id: true,
            branchId: true,
            customerId: true,
            assignedStaffId: true,
            scheduledAt: true,
            status: true,
            serviceId: true,
            serviceIds: true,
            productIds: true,
            packageIds: true,
            invoice: { select: { id: true } },
            assignedStaff: { select: { id: true, name: true } },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                vehicles: {
                  orderBy: { updatedAt: "desc" },
                  select: { brand: true, model: true, plateNumber: true },
                  take: 4,
                },
                membership: { select: { pointsBalance: true, status: true } },
                _count: {
                  select: {
                    customerPackages: { where: { status: "ACTIVE" } },
                    vehicles: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);
  const appointmentError = requestedAppointmentId && !requestedAppointment
    ? "This appointment could not be found."
    : requestedAppointment?.invoice
      ? "This appointment already has an invoice."
      : requestedAppointment && requestedAppointment.status !== "COMPLETED"
        ? "Complete the appointment before checkout."
        : null;
  const operationalAppointmentBranchId = requestedAppointment?.branchId &&
    branches.some((branch) => branch.id === requestedAppointment.branchId)
    ? requestedAppointment.branchId
    : null;
  const cashierBranchId = operationalAppointmentBranchId ?? openShift?.branchId ?? user.branchId ?? (branches.length === 1 ? branches[0].id : "");
  const now = new Date();
  const serviceIds = requestedAppointment
    ? [
        ...requestedAppointment.serviceIds,
        ...(requestedAppointment.serviceId && !requestedAppointment.serviceIds.includes(requestedAppointment.serviceId)
          ? [requestedAppointment.serviceId]
          : []),
      ]
    : [];
  const serviceCounts = countIds(serviceIds);
  const productCounts = countIds(requestedAppointment?.productIds ?? []);
  const packageCounts = countIds(requestedAppointment?.packageIds ?? []);
  const catalogAvailability = cashierBranchId
    ? await getCashierCatalogAvailability({ branchId: cashierBranchId, businessId })
    : {
        hasItems: false,
        initialType: "service" as const,
        packageCount: 0,
        productCount: 0,
        serviceCount: 0,
      };
  const [initialCatalog, catalogDiscounts, appointmentServices, appointmentProducts, appointmentPackages, availableStaff] = await Promise.all([
    cashierBranchId
      ? getCashierCatalog({
          branchId: cashierBranchId,
          businessId,
          type: catalogAvailability.initialType,
        })
      : Promise.resolve({ categories: [], items: [], page: 1, pageCount: 1, pageSize: 8, total: 0 }),
    prisma.catalogDiscount.findMany({
      where: {
        businessId,
        active: true,
        OR: [{ branchId: null }, ...(cashierBranchId ? [{ branchId: cashierBranchId }] : [])],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ name: "asc" }],
    }),
    serviceCounts.size
      ? prisma.service.findMany({
          where: { id: { in: [...serviceCounts.keys()] }, businessId, status: "ACTIVE" },
          include: { serviceCategory: { select: { name: true } } },
        })
      : Promise.resolve([]),
    productCounts.size
      ? prisma.product.findMany({
          where: { id: { in: [...productCounts.keys()] }, businessId, status: "ACTIVE" },
          include: {
            productCategory: { select: { name: true } },
            stocks: cashierBranchId
              ? { where: { branchId: cashierBranchId }, select: { quantity: true }, take: 1 }
              : false,
          },
        })
      : Promise.resolve([]),
    packageCounts.size
      ? prisma.package.findMany({
          where: { id: { in: [...packageCounts.keys()] }, businessId, status: "ACTIVE" },
          include: {
            packageCategory: { select: { name: true } },
            service: { select: { taxable: true, taxRate: true } },
          },
        })
      : Promise.resolve([]),
    cashierBranchId
      ? prisma.user.findMany({
          where: {
            businessId,
            status: "active",
            appointmentBookable: true,
            OR: [
              { branchId: cashierBranchId },
              {
                employeeAccount: {
                  memberships: {
                    some: {
                      businessId,
                      status: "ACTIVE",
                      branchAssignments: {
                        some: { businessId, branchId: cashierBranchId },
                      },
                    },
                  },
                },
              },
            ],
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const staffOptions: CashierStaffOption[] = availableStaff.map((staff) => ({
    id: staff.id,
    name: staff.name,
  }));
  if (
    requestedAppointment?.assignedStaff &&
    !staffOptions.some((staff) => staff.id === requestedAppointment.assignedStaff!.id)
  ) {
    staffOptions.unshift(requestedAppointment.assignedStaff);
  }

  const initialLines: CashierCartLine[] = [
    ...appointmentServices.map((service) => ({
      category: service.serviceCategory?.name ?? service.category,
      description: service.durationMinutes ? `${service.durationMinutes} min` : "Flexible duration",
      id: service.id,
      name: service.name,
      price: Number(service.price),
      quantity: serviceCounts.get(service.id) ?? 1,
      taxable: service.taxable,
      taxRate: service.taxRate == null ? null : Number(service.taxRate),
      type: "service" as const,
    })),
    ...appointmentProducts.map((product) => ({
      category: product.productCategory?.name ?? product.category,
      description: "Appointment product",
      id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: productCounts.get(product.id) ?? 1,
      stock: product.stocks[0]?.quantity ?? 0,
      taxable: product.taxable,
      taxRate: product.taxRate == null ? null : Number(product.taxRate),
      type: "product" as const,
    })),
    ...appointmentPackages.map((packageDefinition) => ({
      category: packageDefinition.packageCategory?.name ?? null,
      description: `${packageDefinition.totalUses} total uses`,
      id: packageDefinition.id,
      name: packageDefinition.name,
      price: Number(packageDefinition.price),
      quantity: packageCounts.get(packageDefinition.id) ?? 1,
      taxable: packageDefinition.service?.taxable ?? true,
      taxRate: packageDefinition.service?.taxRate == null
        ? null
        : Number(packageDefinition.service.taxRate),
      type: "package" as const,
    })),
  ];
  const initialSale: CashierInitialSale | null = requestedAppointment && !appointmentError
    ? {
        appointmentId: requestedAppointment.id,
        assignedStaffId: requestedAppointment.assignedStaffId ?? "",
        customer: {
          activePackageCount: requestedAppointment.customer._count.customerPackages,
          id: requestedAppointment.customer.id,
          loyaltyPoints: requestedAppointment.customer.membership?.pointsBalance ?? 0,
          loyaltyStatus: requestedAppointment.customer.membership?.status ?? null,
          name: requestedAppointment.customer.name,
          phone: requestedAppointment.customer.phone,
          vehicleCount: requestedAppointment.customer._count.vehicles,
          vehicles: requestedAppointment.customer.vehicles,
        },
        lines: initialLines,
        returnTo: `/appointments?status=active&page=1&date=${formatSingaporeDate(requestedAppointment.scheduledAt)}&appointment=${requestedAppointment.id}`,
      }
    : null;

  return (
    <>
      <section className="content cashier-page">
        <div className="page-header">
          <div>
            <h1>Cashier POS</h1>
            <p className="cashier-page-subtitle">
              Browse the catalog and complete one compact checkout.
            </p>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}
        <CashierSalesPanel
          action={completeCashierSaleAction}
          appointmentError={appointmentError}
          branchId={cashierBranchId}
          branches={branches}
          catalogDiscounts={catalogDiscounts.map((discount) => ({
            id: discount.id,
            name: discount.name,
            discountType: discount.discountType,
            percentage: discount.percentage == null ? null : Number(discount.percentage),
            fixedAmount: discount.fixedAmount == null ? null : Number(discount.fixedAmount),
            scope: discount.scope,
            minimumSpend: Number(discount.minimumSpend),
            maximumDiscount: discount.maximumDiscount == null ? null : Number(discount.maximumDiscount),
            allowLoyaltyStacking: discount.allowLoyaltyStacking,
          }))}
          hasCatalogItems={catalogAvailability.hasItems}
          hasOpenShift={Boolean(openShift)}
          initialCatalog={initialCatalog}
          initialCatalogType={catalogAvailability.initialType}
          initialSale={initialSale}
          staffOptions={staffOptions}
          taxSettings={{
            enabled: business.sstEnabled,
            label: business.sstLabel,
            rate: Number(business.sstRate),
          }}
          loyaltySettings={{
            enabled: loyaltyProgram?.enabled ?? false,
            redemptionEnabled: loyaltyProgram?.redemptionEnabled ?? false,
            pointsPerRinggit: loyaltyProgram?.redemptionPointsPerRinggit ?? 100,
            minimumPoints: loyaltyProgram?.minimumRedemptionPoints ?? 100,
          }}
        />
      </section>
    </>
  );
}
