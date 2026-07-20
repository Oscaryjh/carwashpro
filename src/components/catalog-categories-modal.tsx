"use client";

import { CatalogFormModal } from "@/components/catalog-form-modal";

type CategoryItem = {
  id: string;
  itemCount: number;
  name: string;
  status: "ACTIVE" | "INACTIVE";
};

type CatalogCategoriesModalProps = {
  categories: CategoryItem[];
  closePath: string;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  description: string;
  itemLabel: string;
  message?: string;
  messageType?: "error" | "success";
  placeholder: string;
  title: string;
  updateAction: (formData: FormData) => Promise<void>;
};

export function CatalogCategoriesModal({
  categories,
  closePath,
  createAction,
  deleteAction,
  description,
  itemLabel,
  message,
  messageType = "success",
  placeholder,
  title,
  updateAction,
}: CatalogCategoriesModalProps) {
  const returnPath = `${closePath}?modal=categories`;

  return (
    <CatalogFormModal
      ariaLabel={title}
      closePath={closePath}
      eyebrow="CATALOG SETTINGS"
      title={title}
      wide
    >
      <div className="catalog-category-modal-content">
        <p className="catalog-category-description">{description}</p>
        {message ? <div className={messageType}>{message}</div> : null}

        <form action={createAction} className="catalog-category-create-form">
          <input name="returnPath" type="hidden" value={returnPath} />
          <label>
            <span>New category</span>
            <input name="name" placeholder={placeholder} required />
          </label>
          <button type="submit">Add category</button>
        </form>

        <div className="catalog-category-list-header">
          <h3>Categories</h3>
          <span>{categories.length} total</span>
        </div>

        {categories.length ? (
          <div className="catalog-category-list">
            {categories.map((category, index) => (
              <form action={updateAction} className="catalog-category-row" key={category.id}>
                <input name="returnPath" type="hidden" value={returnPath} />
                <input name="categoryId" type="hidden" value={category.id} />
                <span className="catalog-category-number">{index + 1}</span>
                <label>
                  <span>Name</span>
                  <input defaultValue={category.name} name="name" required />
                </label>
                <label>
                  <span>Status</span>
                  <select defaultValue={category.status} name="status">
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>
                <div className="catalog-category-count">
                  <strong>{category.itemCount}</strong>
                  <span>{category.itemCount === 1 ? itemLabel : `${itemLabel}s`}</span>
                </div>
                <div className="catalog-category-actions">
                  <button className="secondary-light-button" type="submit">Save</button>
                  <button
                    className="danger-button"
                    formAction={deleteAction}
                    type="submit"
                    onClick={(event) => {
                      const confirmed = window.confirm(
                        `Delete the category "${category.name}"? This cannot be undone.`,
                      );

                      if (!confirmed) event.preventDefault();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : (
          <p className="empty-state compact-empty-state">No categories yet.</p>
        )}
      </div>
    </CatalogFormModal>
  );
}
