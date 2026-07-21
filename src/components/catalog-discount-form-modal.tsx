"use client";

import { useState } from "react";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import type { BranchOption } from "@/lib/branches";
import {
  formatCatalogDiscountScope,
  type CatalogDiscountScope,
  type CatalogDiscountType,
} from "@/lib/catalog-discounts";

type DiscountValue = {
  id: string;
  name: string;
  discountType: CatalogDiscountType;
  percentage: number | null;
  fixedAmount: number | null;
  scope: CatalogDiscountScope;
  branchId: string | null;
  minimumSpend: number;
  maximumDiscount: number | null;
  allowLoyaltyStacking: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
};

type CatalogDiscountFormModalProps = {
  action: (formData: FormData) => Promise<void>;
  branches: BranchOption[];
  discount?: DiscountValue | null;
};

const scopes: CatalogDiscountScope[] = ["ALL", "SERVICES", "PRODUCTS", "PACKAGES"];

export function CatalogDiscountFormModal({
  action,
  branches,
  discount,
}: CatalogDiscountFormModalProps) {
  const editing = Boolean(discount);
  const [discountType, setDiscountType] = useState<CatalogDiscountType>(
    discount?.discountType ?? "PERCENTAGE",
  );

  return (
    <CatalogFormModal
      ariaLabel={editing ? "Edit discount" : "New discount"}
      closePath="/discounts"
      eyebrow="CATALOG DISCOUNT"
      modalClassName="catalog-discount-modal"
      title={editing ? "Edit discount" : "New discount"}
      wide
    >
      <form action={action} className="catalog-discount-form">
        {discount ? <input name="discountId" type="hidden" value={discount.id} /> : null}
        <div className={`catalog-discount-grid${discountType === "FIXED_AMOUNT" ? " is-fixed-amount" : ""}`}>
          <label className="catalog-discount-name">
            <span>Name</span>
            <input defaultValue={discount?.name ?? ""} maxLength={80} name="name" placeholder="e.g. Weekday 10% off" required />
          </label>
          <fieldset className="catalog-discount-type">
            <legend>Discount type</legend>
            <div className="catalog-discount-type-control">
              <label>
                <input
                  checked={discountType === "PERCENTAGE"}
                  name="discountType"
                  onChange={() => setDiscountType("PERCENTAGE")}
                  type="radio"
                  value="PERCENTAGE"
                />
                <span>Percentage</span>
              </label>
              <label>
                <input
                  checked={discountType === "FIXED_AMOUNT"}
                  name="discountType"
                  onChange={() => setDiscountType("FIXED_AMOUNT")}
                  type="radio"
                  value="FIXED_AMOUNT"
                />
                <span>Fixed amount</span>
              </label>
            </div>
          </fieldset>
          <label className="catalog-discount-rate">
            <span>{discountType === "PERCENTAGE" ? "Percentage" : "Amount"}</span>
            <div className="catalog-discount-percent-field">
              {discountType === "PERCENTAGE" ? (
                <input defaultValue={discount?.percentage ?? ""} max="100" min="0.01" name="percentage" step="0.01" type="number" required />
              ) : (
                <input defaultValue={discount?.fixedAmount ?? ""} min="0.01" name="fixedAmount" step="0.01" type="number" required />
              )}
              <span aria-hidden="true">{discountType === "PERCENTAGE" ? "%" : "RM"}</span>
            </div>
          </label>
          <label className="catalog-discount-scope">
            <span>Applies to</span>
            <select defaultValue={discount?.scope ?? "ALL"} name="scope">
              {scopes.map((scope) => <option key={scope} value={scope}>{formatCatalogDiscountScope(scope)}</option>)}
            </select>
          </label>
          <label className="catalog-discount-branch">
            <span>Branch</span>
            <select defaultValue={discount?.branchId ?? ""} name="branchId">
              <option value="">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="catalog-discount-minimum">
            <span>Minimum spend optional</span>
            <input defaultValue={discount?.minimumSpend ?? 0} min="0" name="minimumSpend" step="0.01" type="number" />
          </label>
          {discountType === "PERCENTAGE" ? (
            <label className="catalog-discount-maximum">
              <span>Maximum discount optional</span>
              <input
                defaultValue={discount?.maximumDiscount ?? ""}
                min="0"
                name="maximumDiscount"
                placeholder="No limit"
                step="0.01"
                type="number"
              />
            </label>
          ) : null}
          <label className="catalog-discount-starts">
            <span>Starts optional</span>
            <input defaultValue={toDateTimeLocal(discount?.startsAt)} name="startsAt" type="datetime-local" />
          </label>
          <label className="catalog-discount-ends">
            <span>Ends optional</span>
            <input defaultValue={toDateTimeLocal(discount?.endsAt)} name="endsAt" type="datetime-local" />
          </label>
        </div>
        <div className="catalog-discount-options">
          <label className="setting-toggle-row">
            <span className="catalog-discount-option-copy"><strong>Allow loyalty points</strong><small>Points can be redeemed on the same sale.</small></span>
            <input defaultChecked={discount?.allowLoyaltyStacking ?? false} name="allowLoyaltyStacking" type="checkbox" />
            <span aria-hidden="true" className="catalog-discount-switch" />
          </label>
          <label className="setting-toggle-row">
            <span className="catalog-discount-option-copy"><strong>Active discount</strong><small>Available at checkout during its valid dates.</small></span>
            <input defaultChecked={discount?.active ?? true} name="active" type="checkbox" />
            <span aria-hidden="true" className="catalog-discount-switch" />
          </label>
        </div>
        <div className="catalog-modal-actions">
          <button type="submit">{editing ? "Save discount" : "Create discount"}</button>
        </div>
      </form>
    </CatalogFormModal>
  );
}

function toDateTimeLocal(value?: Date | null) {
  if (!value) return "";
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
