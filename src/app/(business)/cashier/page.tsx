import { redirect } from "next/navigation";
import { CashierSalesPanel } from "@/components/cashier-sales-panel";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { getCashierCatalog } from "@/lib/cashier/catalog";
import { prisma } from "@/lib/prisma";
import { completeCashierSaleAction } from "@/app/(business)/cashier/actions";

type CashierPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function CashierPage({ searchParams }: CashierPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();

  if (industryType !== "SALON_BEAUTY") {
    redirect("/work-orders");
  }

  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const [branches, openShift, business, loyaltyProgram] = await Promise.all([
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
  ]);
  const cashierBranchId = openShift?.branchId ?? user.branchId ?? (branches.length === 1 ? branches[0].id : "");
  const now = new Date();
  const [initialCatalog, catalogDiscounts] = await Promise.all([
    cashierBranchId
      ? getCashierCatalog({ branchId: cashierBranchId, businessId, type: "service" })
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
  ]);

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
          branchId={cashierBranchId}
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
          initialCatalog={initialCatalog}
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
