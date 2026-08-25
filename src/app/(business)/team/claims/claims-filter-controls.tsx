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
  employee?: string;
  status?: string;
  activeFilterCount: number;
};

export function ClaimsFilterControls({ employee, status, activeFilterCount }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isPending, startTransition] = useTransition();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEmployee = String(formData.get("employee") ?? "").trim();
    const nextStatus = String(formData.get("status") ?? "").trim();
    const query = new URLSearchParams();
    if (nextEmployee) query.set("employee", nextEmployee);
    if (nextStatus) query.set("status", nextStatus);

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
          <label>Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{claimStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="submit" disabled={isPending}>{isPending ? "Applying…" : "Show results"}</button>
          {activeFilterCount ? <Link href="/team/claims">Clear all</Link> : null}
        </form>
      ) : null}
    </div>
  );
}
