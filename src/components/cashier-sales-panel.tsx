"use client";

import Link from "next/link";
import type { CashierSaleState } from "@/app/(business)/cashier/actions";
import { CashierUnifiedSaleForm } from "@/components/cashier-unified-sale-form";
import type { CashierCatalogResult } from "@/lib/cashier/catalog";
import type { TaxDisplaySettings } from "@/lib/tax/calculator";

type CashierSalesPanelProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  branchId: string;
  initialCatalog: CashierCatalogResult;
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
  branchId,
  initialCatalog,
  taxSettings,
  loyaltySettings,
}: CashierSalesPanelProps) {
  if (!initialCatalog.total) {
    return (
      <div className="cashier-empty-state">
        <span aria-hidden="true" className="cashier-empty-icon">+</span>
        <div>
          <h3>No sale items yet</h3>
          <p>Create an active package or product before starting a direct sale.</p>
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
      branchId={branchId}
      initialCatalog={initialCatalog}
      taxSettings={taxSettings}
      loyaltySettings={loyaltySettings}
    />
  );
}
