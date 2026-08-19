"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./company-settings-dialog.module.css";

type CompanySettingsDialogTriggerProps = {
  dialogId: string;
  index: string;
  label: string;
  description: string;
};

type CompanySettingsDialogProps = {
  children: ReactNode;
  description: string;
  eyebrow: string;
  id: string;
  initiallyOpen?: boolean;
  size?: "default" | "large";
  title: string;
};

export function CompanySettingsDialogTrigger({
  dialogId,
  index,
  label,
  description,
}: CompanySettingsDialogTriggerProps) {
  function openDialog() {
    const dialog = document.getElementById(dialogId);
    if (dialog instanceof HTMLDialogElement && !dialog.open) {
      dialog.showModal();
    }
  }

  return (
    <button className={styles.trigger} type="button" onClick={openDialog}>
      <span className={styles.triggerIcon} aria-hidden="true">{index}</span>
      <span className={styles.triggerCopy}>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={styles.triggerArrow} aria-hidden="true">›</span>
    </button>
  );
}

export function CompanySettingsDialog({
  children,
  description,
  eyebrow,
  id,
  initiallyOpen = false,
  size = "default",
  title,
}: CompanySettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (initiallyOpen && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [initiallyOpen]);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className={`${styles.dialog} ${size === "large" ? styles.dialogLarge : ""}`}
      id={id}
      ref={dialogRef}
    >
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
          <button className={styles.close} type="button" onClick={closeDialog} aria-label={`Close ${title}`}>
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}

export function CompanySettingsDialogFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}
