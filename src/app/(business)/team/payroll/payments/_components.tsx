import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./payments.module.css";

export function PaymentPageHeader({ children, description, title }: { children?: ReactNode; description: string; title: string }) {
  return <header className={styles.pageHeader}><div><p className={styles.eyebrow}>HR &amp; Payroll · Payments</p><h1>{title}</h1><p>{description}</p></div>{children ? <nav className={styles.headerLinks}>{children}</nav> : null}</header>;
}

export function PaymentAccessDenied({ scopeRestricted = false }: { scopeRestricted?: boolean }) {
  return <main className={`content hr-module-page ${styles.page}`}><PaymentPageHeader title="Payroll Payments" description="Payment readiness and approval are separate from payroll finalization." /><section className={`${styles.statePanel} ${styles.denied}`} role="alert"><strong>Access denied</strong><h2>{scopeRestricted ? "Payment access requires every active branch" : "You do not have permission to view payment batches"}</h2><p>No payroll, employee, bank or payment data was loaded.</p><Link href="/team/payroll/workspace">Back to Payroll Workspace</Link></section></main>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return <span className={`${styles.badge} ${styles[`status${status}`] ?? ""}`}>{paymentStatusLabel(status)}</span>;
}

export function paymentStatusLabel(status: string) {
  if (status === "DRAFT") return "Draft";
  if (status === "AWAITING_APPROVAL") return "Awaiting approval";
  if (status === "APPROVED") return "Approved for instruction preparation";
  if (status === "INSTRUCTION_READY") return "Instruction prepared";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "SUPERSEDED") return "Superseded";
  return status;
}

export function instructionStatusLabel(status: string) {
  if (status === "READY") return "Ready for draft";
  if (status === "BLOCKED") return "Blocked";
  if (status === "EXCLUDED") return "Excluded";
  if (status === "INCLUDED") return "Included";
  return status;
}

export function blockerLabel(code: string | null) {
  if (code === "MISSING_BANK_ACCOUNT") return "Bank details missing";
  if (code === "BANK_ACCOUNT_UNVERIFIED") return "Bank details not verified";
  if (code === "BANK_ACCOUNT_INACTIVE") return "No active bank version for this period";
  if (code === "BANK_ACCOUNT_NOT_EFFECTIVE") return "Bank version starts after this payment period";
  if (code === "NET_PAY_NEGATIVE") return "Net pay is negative";
  if (code === "DUPLICATE_PAYMENT_ALLOCATION") return "Already allocated to an active batch";
  return code ? code.replaceAll("_", " ").toLowerCase() : "Not applicable";
}

export function formatPaymentMonth(date: Date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(date);
}

export function formatPaymentDate(date: Date | null) {
  if (!date) return "Not recorded";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(date);
}

export function formatPaymentMoney(value: string) {
  return new Intl.NumberFormat("en-MY", { currency: "MYR", currencyDisplay: "narrowSymbol", style: "currency" }).format(Number(value));
}
