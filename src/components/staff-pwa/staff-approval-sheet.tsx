"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./staff-approval-center-v2.module.css";
import v2Styles from "./staff-v2.module.css";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function StaffApprovalSheet({
  trigger,
  title,
  description,
  tone = "neutral",
  children,
}: {
  trigger: string;
  title: string;
  description?: string;
  tone?: "neutral" | "danger";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    const sheet = sheetRef.current;
    const focusable = () => Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => trigger?.focus());
    };
  }, [open]);

  return (
    <>
      <button
        className={tone === "danger" ? styles.dangerButton : styles.secondaryButton}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {trigger}
      </button>
      {open ? createPortal(
        <div
          className={`${v2Styles.portalScope} ${styles.sheetBackdrop}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            aria-describedby={description ? descriptionId : undefined}
            aria-labelledby={titleId}
            aria-modal="true"
            className={styles.sheet}
            ref={sheetRef}
            role="dialog"
          >
            <div aria-hidden="true" className={styles.sheetHandle} />
            <header className={styles.sheetHeader}>
              <div>
                <p>Decision</p>
                <h2 id={titleId}>{title}</h2>
              </div>
              <button aria-label={`Close ${title.toLowerCase()}`} onClick={() => setOpen(false)} type="button">×</button>
            </header>
            {description ? <p className={styles.sheetDescription} id={descriptionId}>{description}</p> : null}
            <div className={styles.sheetBody}>{children}</div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
