"use client";

import Link from "next/link";
import type { CashierSaleState } from "@/app/(business)/cashier/actions";
import {
  CashierUnifiedSaleForm,
  type CashierBranchOption,
  type CashierInitialSale,
  type CashierPaymentMethodOption,
  type CashierStaffOption,
} from "@/components/cashier-unified-sale-form";
import type { CashierCatalogResult } from "@/lib/cashier/catalog";
import type { CatalogDiscountOption } from "@/lib/catalog-discounts";
import type { TaxDisplaySettings } from "@/lib/tax/calculator";

type CashierSalesPanelProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  appointmentError?: string | null;
  branchId: string;
  branches: CashierBranchOption[];
  catalogDiscounts: CatalogDiscountOption[];
  hasCatalogItems: boolean;
  hasOpenShift: boolean;
  initialCatalog: CashierCatalogResult;
  initialCatalogType: "package" | "product" | "service";
  initialSale?: CashierInitialSale | null;
  paymentMethods: CashierPaymentMethodOption[];
  staffOptions: CashierStaffOption[];
  taxSettings: TaxDisplaySettings;
  loyaltySettings: {
    enabled: boolean;
    redemptionEnabled: boolean;
    pointsPerRinggit: number;
    minimumPoints: number;
  };
};

export function CashierSalesPanel({
  action,
  appointmentError = null,
  branchId,
  branches,
  catalogDiscounts,
  hasCatalogItems,
  hasOpenShift,
  initialCatalog,
  initialCatalogType,
  initialSale = null,
  paymentMethods,
  staffOptions,
  taxSettings,
  loyaltySettings,
}: CashierSalesPanelProps) {
  if (!hasCatalogItems && !initialSale?.lines.length) {
    return (
      <div className="cashier-empty-state">
        <span aria-hidden="true" className="cashier-empty-icon">+</span>
        <div>
          <h3>No sale items yet</h3>
          <p>Create an active service, product, or package before starting a sale.</p>
          <div className="cashier-empty-actions">
            <Link className="button-link" href="/packages/new">Create package</Link>
            <Link className="button-link secondary" href="/products?type=create">Create product</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CashierUnifiedSaleForm
      action={action}
      appointmentError={appointmentError}
      branchId={branchId}
      branches={branches}
      catalogDiscounts={catalogDiscounts}
      hasOpenShift={hasOpenShift}
      initialCatalog={initialCatalog}
      initialCatalogType={initialCatalogType}
      initialSale={initialSale}
      paymentMethods={paymentMethods}
      staffOptions={staffOptions}
      taxSettings={taxSettings}
      loyaltySettings={loyaltySettings}
    />
  );
}
