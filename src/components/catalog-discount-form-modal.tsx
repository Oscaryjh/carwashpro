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
  const [showInvalidMaximum, setShowInvalidMaximum] = useState(false);
  const advancedFields = <>
    <label className="catalog-discount-minimum">
      <span>{editing ? "Minimum spend optional" : "Minimum spend"}</span>
      <div className={editing ? undefined : "catalog-discount-percent-field"}>
        <input defaultValue={discount?.minimumSpend ?? 0} min="0" name="minimumSpend" step="0.01" type="number" />
        {!editing ? <span aria-hidden="true">RM</span> : null}
      </div>
      {!editing ? <small>Optional. Apply this discount only when the sale reaches this amount.</small> : null}
    </label>
    {!editing || discountType === "PERCENTAGE" ? (
      <label className="catalog-discount-maximum" hidden={!editing && discountType !== "PERCENTAGE" && !showInvalidMaximum}>
        <span>{editing ? "Maximum discount optional" : "Maximum discount"}</span>
        <div className={editing ? undefined : "catalog-discount-percent-field"}>
          <input defaultValue={discount?.maximumDiscount ?? ""} min="0" name="maximumDiscount" placeholder="No limit" step="0.01" type="number"
            onInvalid={editing ? undefined : () => setShowInvalidMaximum(discountType === "FIXED_AMOUNT")}
            onBlur={editing ? undefined : (event) => { if (event.currentTarget.validity.valid) setShowInvalidMaximum(false); }} />
          {!editing ? <span aria-hidden="true">RM</span> : null}
        </div>
        {!editing ? <small>Optional. Cap the maximum amount this discount can deduct.</small> : null}
      </label>
    ) : null}
    <label className="catalog-discount-starts">
      <span>{editing ? "Starts optional" : "Starts"}</span>
      <input defaultValue={toDateTimeLocal(discount?.startsAt)} name="startsAt" type="datetime-local" />
      {!editing ? <small>Optional.</small> : null}
    </label>
    <label className="catalog-discount-ends">
      <span>{editing ? "Ends optional" : "Ends"}</span>
      <input defaultValue={toDateTimeLocal(discount?.endsAt)} name="endsAt" type="datetime-local" />
      {!editing ? <small>Optional.</small> : null}
    </label>
  </>;
  const loyaltyField = <label className="setting-toggle-row">
    <span className="catalog-discount-option-copy"><strong>{editing ? "Allow loyalty points" : "Allow points redemption"}</strong><small>{editing ? "Points can be redeemed on the same sale." : "Customers can use loyalty points on the same sale."}</small></span>
    <input defaultChecked={discount?.allowLoyaltyStacking ?? false} name="allowLoyaltyStacking" type="checkbox" />
    <span aria-hidden="true" className="catalog-discount-switch" />
  </label>;

  return (
    <CatalogFormModal
      ariaLabel={editing ? "Edit discount" : "New discount"}
      closePath="/discounts"
      eyebrow="CATALOG DISCOUNT"
      modalClassName="catalog-discount-modal"
      title={editing ? "Edit discount" : "New discount"}
      wide
    >
      <form action={action} className={`catalog-discount-form${editing ? "" : " catalog-discount-create"}`}>
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
                  onChange={() => { setDiscountType("PERCENTAGE"); setShowInvalidMaximum(false); }}
                  type="radio"
                  value="PERCENTAGE"
                />
                <span>Percentage</span>
              </label>
              <label>
                <input
                  checked={discountType === "FIXED_AMOUNT"}
                  name="discountType"
                  onChange={() => { setDiscountType("FIXED_AMOUNT"); setShowInvalidMaximum(false); }}
                  type="radio"
                  value="FIXED_AMOUNT"
                />
                <span>Fixed amount</span>
              </label>
            </div>
          </fieldset>
          <label className="catalog-discount-rate">
            <span>{editing ? (discountType === "PERCENTAGE" ? "Percentage" : "Amount") : "Discount value"}</span>
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
          {editing || branches.length > 1 ? <label className="catalog-discount-branch">
            <span>Branch</span>
            <select defaultValue={discount?.branchId ?? ""} name="branchId">
              <option value="">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label> : <input type="hidden" name="branchId" value="" />}
          {editing ? advancedFields : null}
        </div>
        {!editing ? <details className="catalog-discount-advanced" onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
          <summary>Advanced settings</summary>
          <div className="catalog-discount-grid catalog-discount-advanced-grid">{advancedFields}</div>
          <div className="catalog-discount-options">{loyaltyField}</div>
        </details> : null}
        <div className="catalog-discount-options">
          {editing ? loyaltyField : null}
          <label className="setting-toggle-row">
            <span className="catalog-discount-option-copy"><strong>{editing ? "Active discount" : "Active"}</strong><small>{editing ? "Available at checkout during its valid dates." : "Available at checkout during the valid period."}</small></span>
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
