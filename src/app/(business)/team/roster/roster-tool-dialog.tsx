"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import styles from "./roster.module.css";

export function RosterToolDialog({
  badge,
  children,
  defaultOpen = false,
  description,
  title,
}: {
  badge: string;
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (defaultOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [defaultOpen]);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <article className={styles.toolLauncher}>
      <span className={styles.stepBadge}>{badge}</span>
      <span className={styles.toolLauncherCopy}>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <button className={styles.toolOpenButton} onClick={() => dialogRef.current?.showModal()} type="button">
        Open
      </button>

      <dialog
        aria-labelledby={titleId}
        className={styles.toolDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        ref={dialogRef}
      >
        <header className={styles.toolDialogHeader}>
          <span className={styles.stepBadge}>{badge}</span>
          <span>
            <strong id={titleId}>{title}</strong>
            <small>{description}</small>
          </span>
          <button aria-label={`Close ${title}`} className={styles.toolDialogClose} onClick={closeDialog} type="button">×</button>
        </header>
        <div className={styles.toolDialogBody}>{children}</div>
      </dialog>
    </article>
  );
}
