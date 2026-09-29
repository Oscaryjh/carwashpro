"use client";

import { Fragment, useState } from "react";
import { useFormStatus } from "react-dom";
import styles from "./service-categories-table.module.css";

type Category = { id: string; name: string; status: "ACTIVE" | "INACTIVE"; itemCount: number };
type Action = (data: FormData) => Promise<void>;
type Props = { categories: Category[]; createAction: Action; updateAction: Action; deleteAction: Action; message?: string; messageType?: "error" | "success" };

function Submit({ children, disabled = false }: { children: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={disabled || pending}>{pending ? "Saving…" : children}</button>;
}

function Identity({ category }: { category: Category }) {
  return <><input type="hidden" name="returnPath" value="/services?modal=categories" /><input type="hidden" name="categoryId" value={category.id} /></>;
}

export function ServiceCategoriesTable({ categories, createAction, updateAction, deleteAction, message, messageType = "success" }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className={styles.content}>
      <p className={styles.count}>{categories.length} {categories.length === 1 ? "category" : "categories"}</p>
      {message ? <div role="status" className={messageType}>{message}</div> : null}
      {!categories.length ? <div className={styles.empty}><strong>No categories yet.</strong><p>Create a category to organize your services.</p></div> : null}
      <form action={createAction} className={styles.create}>
        <input type="hidden" name="returnPath" value="/services?modal=categories" />
        <input name="name" aria-label="New category name" placeholder="New category name" required minLength={2} />
        <Submit>Add category</Submit>
      </form>
      {categories.length > 0 ? <table className={styles.table}>
        <thead><tr><th scope="col">Name</th><th scope="col">Services</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
        <tbody>{categories.map((category) => <Fragment key={category.id}>
          <tr>
            <td>{category.name}</td><td>{category.itemCount}</td>
            <td><span className={category.status === "ACTIVE" ? styles.active : styles.inactive}>{category.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
            <td className={styles.actionCell}>
              <details open={openId === category.id} onToggle={(event) => { if (!event.currentTarget.open && openId === category.id) setOpenId(null); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpenId(null); event.currentTarget.querySelector("summary")?.focus(); } }}>
                <summary aria-label={`Actions for ${category.name}`} onClick={(event) => { event.preventDefault(); setOpenId(openId === category.id ? null : category.id); }}>⋯</summary>
                <div className={styles.menu}>
                  <button type="button" onClick={() => { setEditingId(category.id); setOpenId(null); }}>Edit</button>
                  <form action={updateAction}>
                    <Identity category={category} /><input type="hidden" name="name" value={category.name} /><input type="hidden" name="status" value={category.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
                    <Submit>{category.status === "ACTIVE" ? "Deactivate" : "Activate"}</Submit>
                  </form>
                  <form action={deleteAction} onSubmit={(event) => { if (category.itemCount > 0 || !window.confirm(`Delete the category "${category.name}"? This cannot be undone.`)) event.preventDefault(); }}>
                    <Identity category={category} /><Submit disabled={category.itemCount > 0}>Delete</Submit>
                  </form>
                  {category.itemCount > 0 ? <small>Reassign services to delete this category, or deactivate it instead.</small> : null}
                </div>
              </details>
            </td>
          </tr>
          {editingId === category.id ? <tr><td colSpan={4} className={styles.editCell}>
            <form action={updateAction} className={styles.edit}>
              <Identity category={category} />
              <label>Name<input autoFocus name="name" defaultValue={category.name} required minLength={2} /></label>
              <label>Status<select name="status" defaultValue={category.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
              <div className={styles.editActions}><button type="button" className="secondary-light-button" onClick={() => setEditingId(null)}>Cancel</button><Submit>Save changes</Submit></div>
            </form>
          </td></tr> : null}
        </Fragment>)}</tbody>
      </table> : null}
    </div>
  );
}
