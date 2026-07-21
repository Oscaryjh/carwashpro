"use client";

import { deleteCatalogDiscountAction } from "@/app/(business)/discounts/actions";

export function DeleteCatalogDiscountForm({
  discountId,
  discountName,
}: {
  discountId: string;
  discountName: string;
}) {
  return (
    <form
      action={deleteCatalogDiscountAction}
      className="catalog-delete-form"
      onSubmit={(event) => {
        if (!window.confirm(`Delete \"${discountName}\"?`)) event.preventDefault();
      }}
    >
      <input name="discountId" type="hidden" value={discountId} />
      <button className="danger-button" type="submit">Delete</button>
    </form>
  );
}
