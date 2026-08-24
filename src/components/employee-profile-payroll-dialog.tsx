"use client";

import type { ReactNode } from "react";
import { CompanySettingsDialog } from "@/components/company-settings-dialog";
import styles from "./employee-profile-shell.module.css";

export function EmployeeProfilePayrollDialog({
  children,
  description,
  dialogId,
  eyebrow = "Payroll setup",
  initiallyOpen = false,
  label,
  size = "default",
  title,
  triggerClassName,
  variant = "disclosure",
}: {
  children: ReactNode;
  description: string;
  dialogId: string;
  eyebrow?: string;
  initiallyOpen?: boolean;
  label: string;
  size?: "compact" | "default";
  title: string;
  triggerClassName?: string;
  variant?: "button" | "disclosure";
}) {
  function openDialog() {
    const dialog = document.getElementById(dialogId);
    if (dialog instanceof HTMLDialogElement && !dialog.open) {
      dialog.showModal();
    }
  }

  return (
    <>
      <button
        aria-controls={dialogId}
        aria-haspopup="dialog"
        className={`${styles.payrollDialogTrigger} ${variant === "button" ? styles.payrollDialogButton : ""} ${size === "compact" ? styles.payrollDialogCompact : ""} ${triggerClassName ?? ""}`}
        onClick={openDialog}
        type="button"
      >
        <span>{label}</span>
        {variant === "disclosure" ? <span aria-hidden="true">+</span> : null}
      </button>
      <CompanySettingsDialog
        description={description}
        eyebrow={eyebrow}
        id={dialogId}
        initiallyOpen={initiallyOpen}
        title={title}
      >
        {children}
      </CompanySettingsDialog>
    </>
  );
}
