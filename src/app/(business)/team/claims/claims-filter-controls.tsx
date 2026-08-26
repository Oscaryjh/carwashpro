"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import styles from "./claims.module.css";

const claimStatuses = [
  ["SUBMITTED", "Pending review"],
  ["APPROVED", "Approved"],
  ["PARTIALLY_APPROVED", "Partially approved"],
  ["REJECTED", "Rejected"],
  ["WITHDRAWN", "Withdrawn"],
] as const;

type Props = {
  stage: string;
  employee?: string;
  status?: string;
  category?: string;
  from?: string;
  to?: string;
  categories: Array<{ id: string; name: string }>;
  activeFilterCount: number;
};

export function ClaimsFilterControls({ stage, employee, status, category, from, to, categories, activeFilterCount }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isPending, startTransition] = useTransition();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEmployee = String(formData.get("employee") ?? "").trim();
    const nextStatus = String(formData.get("status") ?? "").trim();
    const nextCategory = String(formData.get("category") ?? "").trim();
    const nextFrom = String(formData.get("from") ?? "").trim();
    const nextTo = String(formData.get("to") ?? "").trim();
    const query = new URLSearchParams();
    query.set("stage", stage);
    if (nextEmployee) query.set("employee", nextEmployee);
    if (nextStatus) query.set("status", nextStatus);
    if (nextCategory) query.set("filterCategory", nextCategory);
    if (nextFrom) query.set("from", nextFrom);
    if (nextTo) query.set("to", nextTo);

    setConfirmation("");
    startTransition(() => {
      router.push(`/team/claims${query.size ? `?${query.toString()}` : ""}`);
      setIsOpen(false);
      setConfirmation("Filters applied");
    });
  }

  return (
    <div className={`${styles.filterDisclosure} ${isOpen ? styles.filterDisclosureOpen : ""}`}>
      <div className={styles.filterHeader}>
        <button
          type="button"
          className={styles.filterToggle}
          aria-expanded={isOpen}
          onClick={() => {
            setIsOpen((current) => !current);
            setConfirmation("");
          }}
        >
          {activeFilterCount ? `Filters (${activeFilterCount})` : "Filter"}
        </button>
        {confirmation ? <span className={styles.filterConfirmation} role="status">{confirmation}</span> : null}
      </div>

      {isOpen ? (
        <form className={styles.filters} onSubmit={applyFilters}>
          <label>Employee<input name="employee" defaultValue={employee} placeholder="Name or employee code" /></label>
          <label>Category<select name="category" defaultValue={category ?? ""}><option value="">All categories</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{claimStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>From<input name="from" type="date" defaultValue={from} /></label>
          <label>To<input name="to" type="date" defaultValue={to} /></label>
          <button type="submit" disabled={isPending}>{isPending ? "Applying…" : "Show results"}</button>
          {activeFilterCount ? <Link href={`/team/claims?stage=${stage}`}>Clear all</Link> : null}
        </form>
      ) : null}
    </div>
  );
}
