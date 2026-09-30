"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readWalletCheckoutRecovery } from "@/lib/wallet/checkout-intent";
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
import type { CashierCatalogCreateAccess } from "@/lib/cashier/catalog-create-access";

type CashierSalesPanelProps = {
  walletCheckoutScope?: string;
  walletCheckoutEnabled?: boolean;
  action: (formData: FormData) => Promise<CashierSaleState>;
  appointmentError?: string | null;
  branchId: string;
  branches: CashierBranchOption[];
  catalogDiscounts: CatalogDiscountOption[];
  catalogCreateAccess: CashierCatalogCreateAccess;
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

export function CashierSalesPanel(props: CashierSalesPanelProps) {
  return props.walletCheckoutScope ? <ScopedCashierSalesPanel {...props} /> : renderCashierSalesPanel(props);
}

function ScopedCashierSalesPanel(props: CashierSalesPanelProps) {
  const [mustRecover, setMustRecover] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setMustRecover(Boolean(readWalletCheckoutRecovery(sessionStorage, props.walletCheckoutScope!)));
    } catch { setMustRecover(true); }
  }, [props.walletCheckoutScope, props.branchId]);
  // Do not show a new-sale flow until durable unknown outcomes have been checked.
  if (mustRecover === null) return <p role="status">Checking pending checkout…</p>;
  return renderCashierSalesPanel(props, mustRecover);
}

function renderCashierSalesPanel({
  walletCheckoutScope,
  walletCheckoutEnabled,
  action,
  appointmentError = null,
  branchId,
  branches,
  catalogDiscounts,
  catalogCreateAccess,
  hasCatalogItems,
  hasOpenShift,
  initialCatalog,
  initialCatalogType,
  initialSale = null,
  paymentMethods,
  staffOptions,
  taxSettings,
  loyaltySettings,
}: CashierSalesPanelProps, mustRecover = false) {
  if (!mustRecover && !hasCatalogItems && !initialSale?.lines.length) {
    const createOptions = [
      { key: "service" as const, label: "Create service", href: "/services?modal=create" },
      { key: "product" as const, label: "Create product", href: "/products?type=create" },
      { key: "package" as const, label: "Create package", href: "/packages/new" },
    ].filter(({ key }) => catalogCreateAccess[key]);
    const names = createOptions.map(({ key }) => key);
    const itemDescription = names.length === 3
      ? names.join(", ").replace(/, ([^,]+)$/, ", or $1")
      : names.join(" or ");

    return (
      <div className="cashier-empty-state">
        <span aria-hidden="true" className="cashier-empty-icon">+</span>
        <div>
          <h3>No sale items yet</h3>
          <p>{createOptions.length
            ? `Create an active ${itemDescription} before starting a sale.`
            : "No active sale items are available. Ask your business owner to set up the catalog."}</p>
          {createOptions.length > 0 ? (
            <div className="cashier-empty-actions">
              {createOptions.map(({ key, label, href }, index) => (
                <Link key={key} className={index === 0 ? "button-link" : "button-link secondary"} href={href}>{label}</Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <CashierUnifiedSaleForm
      walletCheckoutScope={walletCheckoutScope}
      walletCheckoutEnabled={walletCheckoutEnabled}
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
