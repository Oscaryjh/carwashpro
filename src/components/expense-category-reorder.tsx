"use client";

import type { DragEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { reorderExpenseCategoriesAction } from "@/app/(business)/expenses/actions";
import styles from "@/app/(business)/expenses/expense.module.css";

type ReorderCategory = Readonly<{
  active: boolean;
  group: string;
  id: string;
  name: string;
}>;

export function ExpenseCategoryReorder({ canReorder, categories, children, operationKey }: { canReorder: boolean; categories: ReorderCategory[]; children: ReactNode; operationKey: string }) {
  const initialOrder = useMemo(() => categories.map((category) => category.id), [categories]);
  const [orderedIds, setOrderedIds] = useState(initialOrder);
  const [reordering, setReordering] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const changed = orderedIds.some((id, index) => id !== initialOrder[index]);

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= orderedIds.length || to >= orderedIds.length) return;
    setOrderedIds((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function dropOn(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    move(orderedIds.indexOf(draggedId), orderedIds.indexOf(targetId));
    setDraggedId(null);
  }

  function cancel() {
    setOrderedIds(initialOrder);
    setDraggedId(null);
    setReordering(false);
  }

  if (!reordering) {
    return <>
      <div className={styles.categoryOrderToolbar}>
        <div><strong>Category order</strong><span>The order here is used in expense forms and category lists.</span></div>
        {canReorder ? <button className={styles.secondaryAction} type="button" onClick={() => setReordering(true)}>Reorder categories</button> : <Link className={styles.secondaryAction} href="/expenses/categories">Clear filters to reorder</Link>}
      </div>
      {children}
    </>;
  }

  return <section className={styles.reorderWorkspace} aria-labelledby="reorder-categories-heading">
    <div className={styles.reorderHeader}>
      <div><span className={styles.eyebrow}>Reorder mode</span><h3 id="reorder-categories-heading">Arrange categories</h3><p>Drag cards into position, or use the arrow buttons. Save once when you are finished.</p></div>
      <button className={styles.secondaryAction} type="button" onClick={cancel}>Cancel</button>
    </div>

    <form action={reorderExpenseCategoriesAction}>
      <input type="hidden" name="operationKey" value={operationKey} />
      <input type="hidden" name="expectedOrder" value={JSON.stringify(initialOrder)} />
      <input type="hidden" name="order" value={JSON.stringify(orderedIds)} />
      <div className={styles.reorderList}>
        {orderedIds.map((id, index) => {
          const category = categoryById.get(id);
          if (!category) return null;
          return <article
            aria-label={`${category.name}, position ${index + 1} of ${orderedIds.length}`}
            className={`${styles.reorderCard} ${draggedId === id ? styles.reorderCardDragging : ""}`}
            draggable
            key={id}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDragStart={() => setDraggedId(id)}
            onDrop={(event) => dropOn(event, id)}
          >
            <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
            <span className={styles.orderNumber}>{index + 1}</span>
            <div className={styles.reorderIdentity}><strong>{category.name}</strong><span>{sentenceCase(category.group)} · {category.active ? "Active" : "Inactive"}</span></div>
            <div className={styles.reorderButtons}>
              <button type="button" aria-label={`Move ${category.name} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
              <button type="button" aria-label={`Move ${category.name} down`} disabled={index === orderedIds.length - 1} onClick={() => move(index, index + 1)}>↓</button>
            </div>
          </article>;
        })}
      </div>
      <div className={styles.reorderFooter}>
        <span>{changed ? "Order changed — save to apply it." : "Move a category to change the order."}</span>
        <div><button className={styles.secondaryAction} type="button" onClick={cancel}>Cancel</button><button type="submit" disabled={!changed}>Save category order</button></div>
      </div>
    </form>
  </section>;
}

function sentenceCase(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
