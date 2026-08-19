"use client";

import { useRef, type ReactNode } from "react";
import styles from "../roster.module.css";

const dialogId = "create-shift-template-dialog";

export function ShiftTemplateCreateDialogTrigger() {
  function openDialog() {
    const dialog = document.getElementById(dialogId);
    if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
  }

  return (
    <button className={styles.templateDialogTrigger} type="button" onClick={openDialog}>
      <span aria-hidden="true">+</span>
      <span>New shift</span>
    </button>
  );
}

export function ShiftTemplateCreateDialog({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      aria-labelledby="create-shift-template-title"
      className={styles.templateDialog}
      id={dialogId}
      ref={dialogRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className={styles.templateDialogShell}>
        <header className={styles.templateDialogHeader}>
          <div>
            <span>NEW SHIFT</span>
            <h2 id="create-shift-template-title">Create shift template</h2>
            <p>Save working hours and break rules for reuse in the roster.</p>
          </div>
          <button aria-label="Close create shift template" type="button" onClick={closeDialog}>×</button>
        </header>
        <div className={styles.templateDialogBody}>{children}</div>
      </div>
    </dialog>
  );
}
