import Link from "next/link";
import type { PayrollRunStatus } from "@prisma/client";
import type { ReactNode } from "react";
import styles from "./runs.module.css";

export function PayrollRunsAccessDenied({ scopeRestricted = false }: { scopeRestricted?: boolean }) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader title="Payroll Runs" />
      <section className={`${styles.statePanel} ${styles.deniedPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Access denied</p>
          <h2>{scopeRestricted ? "Payroll requires authorized access to every active branch" : "You do not have permission to view Payroll Runs"}</h2>
          <p>No payroll run, employee entry or calculation total was loaded.</p>
          <Link href="/team">Back to HR &amp; Payroll</Link>
        </div>
      </section>
    </main>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>HR &amp; Payroll</p>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <nav className={styles.headerActions} aria-label="Payroll Runs navigation">{children}</nav> : null}
    </header>
  );
}

export function RunStatusBadge({ status }: { status: PayrollRunStatus }) {
  const tone = status === "DRAFT" ? styles.draft : status === "REVIEW" ? styles.review : styles.finalized;
  return <span className={`${styles.statusBadge} ${tone}`}>{runStatusLabel(status)}</span>;
}

export function runStatusLabel(status: PayrollRunStatus) {
  if (status === "DRAFT") return "Draft";
  if (status === "REVIEW") return "Awaiting review";
  return "Calculations locked";
}

export function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(date);
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(date);
}

export function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(date);
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-MY", { currency: "MYR", currencyDisplay: "narrowSymbol", style: "currency" }).format(value);
}

export function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
}
