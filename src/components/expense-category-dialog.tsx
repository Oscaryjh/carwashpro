"use client";

import { useId, useRef, type ReactNode } from "react";
import styles from "@/app/(business)/expenses/expense.module.css";

export function ExpenseCategoryDialog({ children, label, title, primary = false }: {
  children: ReactNode;
  label: string;
  title: string;
  primary?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return <>
    <button type="button" className={primary ? styles.categoryAddButton : styles.categoryEditButton} onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} aria-labelledby={titleId} className={styles.categoryDialog}>
      <header><h2 id={titleId}>{title}</h2><button type="button" aria-label={`Close ${title}`} onClick={() => dialog.current?.close()}>×</button></header>
      {children}
    </dialog>
  </>;
}

export function ExpenseCategoryDialogCancel() {
  return <button type="button" data-cancel className={styles.secondaryAction} onClick={event => event.currentTarget.closest("dialog")?.close()}>Cancel</button>;
}
