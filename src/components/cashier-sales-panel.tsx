"use client";

import Link from "next/link";
import type { CashierSaleState } from "@/app/(business)/cashier/actions";
import {
  CashierUnifiedSaleForm,
  type CashierInitialSale,
  type CashierStaffOption,
} from "@/components/cashier-unified-sale-form";
import type { CashierCatalogResult } from "@/lib/cashier/catalog";
import type { CatalogDiscountOption } from "@/lib/catalog-discounts";
import type { TaxDisplaySettings } from "@/lib/tax/calculator";

type CashierSalesPanelProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  appointmentError?: string | null;
  branchId: string;
  catalogDiscounts: CatalogDiscountOption[];
  initialCatalog: CashierCatalogResult;
  initialSale?: CashierInitialSale | null;
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
  catalogDiscounts,
  initialCatalog,
  initialSale = null,
  staffOptions,
  taxSettings,
  loyaltySettings,
}: CashierSalesPanelProps) {
  if (!initialCatalog.total && !initialSale?.lines.length) {
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
      catalogDiscounts={catalogDiscounts}
      initialCatalog={initialCatalog}
      initialSale={initialSale}
      staffOptions={staffOptions}
      taxSettings={taxSettings}
      loyaltySettings={loyaltySettings}
    />
  );
}
