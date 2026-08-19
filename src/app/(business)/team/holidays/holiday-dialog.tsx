"use client";

import { type MouseEvent, type ReactNode, useRef } from "react";
import styles from "./holidays.module.css";

export function HolidayDialog({
  children,
  description,
  title,
  triggerLabel,
  variant = "primary",
}: {
  children: ReactNode;
  description: string;
  title: string;
  triggerLabel: ReactNode;
  variant?: "primary" | "secondary" | "calendar" | "calendarAdd";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }

  return (
    <>
      <button
        className={
          variant === "primary"
            ? styles.dialogPrimaryTrigger
            : variant === "calendar"
              ? styles.dialogCalendarTrigger
              : variant === "calendarAdd"
                ? styles.dialogCalendarAddTrigger
                : styles.dialogSecondaryTrigger
        }
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {triggerLabel}
      </button>
      <dialog className={styles.dialog} onClick={closeFromBackdrop} ref={dialogRef}>
        <div className={styles.dialogCard}>
          <header className={styles.dialogHeader}>
            <div>
              <span className={styles.kicker}>HOLIDAY CALENDAR</span>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
            <button aria-label="Close dialog" className={styles.dialogClose} onClick={() => dialogRef.current?.close()} type="button">×</button>
          </header>
          <div className={styles.dialogBody}>{children}</div>
        </div>
      </dialog>
    </>
  );
}
