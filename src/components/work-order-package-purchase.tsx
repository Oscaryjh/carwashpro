"use client";

import { useMemo, useState } from "react";
import {
  PackageCustomerPicker,
  type PackageCustomerOption,
} from "@/components/package-customer-picker";
import { BranchSelect } from "@/components/branch-select";
import { SaleTaxSummary } from "@/components/sale-tax-summary";
import type { BranchOption } from "@/lib/branches";
import { calculateTax, type TaxDisplaySettings } from "@/lib/tax/calculator";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";
import { FinancialSubmitButton } from "@/components/financial-submit-button";

export type WorkOrderPackageOption = {
  category?: string | null;
  description: string | null;
  id: string;
  name: string;
  price: number;
  taxable: boolean;
  taxRate: number | null;
  totalUses: number;
};

type PackagePurchaseLine = {
  packageId: string;
  quantity: number;
};

type WorkOrderPackagePurchaseProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  branchId?: string;
  hideBranch?: boolean;
  includeVehicleDetails?: boolean;
  packages: WorkOrderPackageOption[];
  returnTo?: string;
  taxSettings: TaxDisplaySettings;
};

export function WorkOrderPackagePurchase({
  action,
  branches,
  branchId,
  hideBranch = false,
  includeVehicleDetails = true,
  packages,
  returnTo,
  taxSettings,
}: WorkOrderPackagePurchaseProps) {
  const [selectedCustomer, setSelectedCustomer] =
    useState<PackageCustomerOption | null>(null);
  const [lines, setLines] = useState<PackagePurchaseLine[]>([]);
  const [pickerLineIndex, setPickerLineIndex] = useState<number | null>(null);
  const [packageQuery, setPackageQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const { operationId } = useFinancialOperationId("package-purchase");
  const totalPackages = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );
  const tax = useMemo(() => calculateTax({
    sstEnabled: taxSettings.enabled,
    sstLabel: taxSettings.label,
    sstRate: taxSettings.rate,
    lines: lines.map((line) => {
      const packageOption = packages.find((item) => item.id === line.packageId);
      return {
        lineTotal: (packageOption?.price ?? 0) * line.quantity,
        taxable: packageOption?.taxable ?? true,
        taxRate: packageOption?.taxRate ?? null,
      };
    }),
  }), [lines, packages, taxSettings]);
  const filteredPackages = useMemo(() => {
    const normalizedQuery = packageQuery.trim().toLowerCase();
    if (!normalizedQuery) return packages;
    return packages.filter((packageOption) =>
      [packageOption.name, packageOption.description]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery)),
    );
  }, [packageQuery, packages]);

  function addLine() {
    if (!selectedCustomer || lines.some((line) => !line.packageId)) return;
    const nextIndex = lines.length;
    setLines((current) => [...current, { packageId: "", quantity: 1 }]);
    setPackageQuery("");
    setPickerLineIndex(nextIndex);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function selectPackage(index: number, packageId: string) {
    setLines((current) => {
      const currentLine = current[index];
      if (!currentLine) return current;
      const existingIndex = current.findIndex(
        (line, lineIndex) => lineIndex !== index && line.packageId === packageId,
      );

      if (existingIndex < 0) {
        return current.map((line, lineIndex) =>
          lineIndex === index ? { ...line, packageId } : line,
        );
      }

      return current
        .map((line, lineIndex) =>
          lineIndex === existingIndex
            ? { ...line, quantity: Math.min(99, line.quantity + currentLine.quantity) }
            : line,
        )
        .filter((_, lineIndex) => lineIndex !== index);
    });
    setPackageQuery("");
    setPickerLineIndex(null);
  }

  function updateQuantity(index: number, requestedQuantity: number) {
    const quantity = Math.min(
      99,
      Math.max(1, Number.isFinite(requestedQuantity) ? requestedQuantity : 1),
    );
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity } : line,
      ),
    );
  }

  function closePicker() {
    if (pickerLineIndex != null && !lines[pickerLineIndex]?.packageId) {
      removeLine(pickerLineIndex);
    }
    setPackageQuery("");
    setPickerLineIndex(null);
  }

  return (
    <form action={action} className="product-sale-form package-cart-form">
      <input name="operationId" type="hidden" value={operationId} />
      <section className="product-sale-section">
        <h3>Customer account</h3>
        <p className="field-helper">
          Packages belong to the customer phone account and can be used across eligible visits.
        </p>
        <PackageCustomerPicker
          includeVehicleDetails={includeVehicleDetails}
          onSelectionChange={(customer) => {
            setSelectedCustomer(customer);
            if (!customer) setLines([]);
          }}
        />
      </section>

      <section className="product-sale-section product-sale-cart">
        <div className="product-sale-section-heading">
          <span className="product-sale-label">Packages</span>
          <button
            className="product-sale-add"
            disabled={
              !selectedCustomer ||
              lines.some((line) => !line.packageId) ||
              lines.length >= packages.length
            }
            onClick={addLine}
            type="button"
          >
            + Add package
          </button>
        </div>

        {lines.length ? (
          <div className="product-sale-lines package-cart-lines">
            {lines.map((line, index) => {
              const selectedPackage = packages.find(
                (packageOption) => packageOption.id === line.packageId,
              );
              const lineTotal = (selectedPackage?.price ?? 0) * line.quantity;

              return (
                <div className="product-sale-line package-cart-line" key={`${line.packageId}-${index}`}>
                  <button
                    className="package-cart-choice"
                    onClick={() => {
                      setPackageQuery("");
                      setPickerLineIndex(index);
                    }}
                    type="button"
                  >
                    <strong>{selectedPackage?.name ?? "Select package"}</strong>
                    <small>
                      {selectedPackage
                        ? `${selectedPackage.totalUses} uses · ${formatMoney(selectedPackage.price)}`
                        : "Choose an active package"}
                    </small>
                  </button>
                  <label className="product-sale-quantity">
                    <span>Qty</span>
                    <input
                      aria-label={`${selectedPackage?.name ?? "Package"} quantity`}
                      inputMode="numeric"
                      max="99"
                      min="1"
                      name="quantity"
                      onChange={(event) => updateQuantity(index, Number(event.target.value))}
                      required
                      type="number"
                      value={line.quantity}
                    />
                  </label>
                  <strong className="product-sale-line-total">{formatMoney(lineTotal)}</strong>
                  <button
                    aria-label={`Remove ${selectedPackage?.name ?? "package"}`}
                    className="product-sale-remove"
                    onClick={() => removeLine(index)}
                    title="Remove package"
                    type="button"
                  >
                    <span aria-hidden="true">x</span>
                  </button>
                  <input name="packageId" type="hidden" value={line.packageId} />
                </div>
              );
            })}
          </div>
        ) : (
          <button
            className="package-cart-empty"
            disabled={!selectedCustomer || !packages.length}
            onClick={addLine}
            type="button"
          >
            <strong>Select packages</strong>
            <span>
              {!selectedCustomer
                ? "Select a customer first"
                : packages.length
                  ? "Add one or more packages to this sale"
                  : "No active packages available"}
            </span>
          </button>
        )}

        {hideBranch && branchId ? (
          <input name="branchId" type="hidden" value={branchId} />
        ) : (
          <BranchSelect branches={branches} selectedBranchId={branchId} />
        )}
      </section>

      <SaleTaxSummary
        itemLabel={`${totalPackages} ${totalPackages === 1 ? "package" : "packages"}`}
        sstEnabled={taxSettings.enabled}
        tax={tax}
      />

      <section className="product-sale-section">
        <label>
          <span>Payment method</span>
          <select
            name="method"
            onChange={(event) => setPaymentMethod(event.target.value)}
            value={paymentMethod}
          >
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="EWALLET">E-wallet</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </label>
        {paymentMethod !== "CASH" ? (
          <label>
            <span>Reference</span>
            <input
              maxLength={120}
              name="reference"
              placeholder="Receipt or transaction reference"
              required
            />
          </label>
        ) : null}
      </section>

      {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
      <p className="package-cart-note">
        Payment activates every selected package immediately. No appointment or service order is created.
      </p>
      <div className="form-actions">
        <FinancialSubmitButton
          disabled={!selectedCustomer || !lines.length || lines.some((line) => !line.packageId)}
          pendingLabel="Processing package sale..."
        >
          Pay {formatMoney(tax.total)}
        </FinancialSubmitButton>
      </div>

      {pickerLineIndex != null ? (
        <div className="package-picker-backdrop" role="presentation">
          <section aria-labelledby="package-picker-title" className="package-picker" role="dialog">
            <header>
              <button aria-label="Close package picker" onClick={closePicker} type="button">
                {"\u00d7"}
              </button>
              <h3 id="package-picker-title">Select package</h3>
              <span />
            </header>
            <label className="package-picker-search">
              <span aria-hidden="true">S</span>
              <input
                autoFocus
                onChange={(event) => setPackageQuery(event.target.value)}
                placeholder="Search package"
                value={packageQuery}
              />
              {packageQuery ? (
                <button aria-label="Clear package search" onClick={() => setPackageQuery("")} type="button">
                  {"\u00d7"}
                </button>
              ) : (
                <span />
              )}
            </label>
            <div className="package-picker-list">
              {filteredPackages.map((packageOption) => (
                <button
                  className={lines.some((line) => line.packageId === packageOption.id) ? "is-selected" : ""}
                  key={packageOption.id}
                  onClick={() => selectPackage(pickerLineIndex, packageOption.id)}
                  type="button"
                >
                  <span aria-hidden="true">P</span>
                  <div>
                    <strong>{packageOption.name}</strong>
                    <small>{packageOption.totalUses} total uses</small>
                  </div>
                  <b>{formatMoney(packageOption.price)}</b>
                </button>
              ))}
              {!filteredPackages.length ? (
                <p className="empty-state">No matching package.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}
