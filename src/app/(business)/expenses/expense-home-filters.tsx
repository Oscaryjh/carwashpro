"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./expense.module.css";

export function ExpenseHomeFilters(props: {
  range: string; from: string; to: string; dateLabel: string;
  sourceType: string; branchId: string; branches: Array<{ id: string; name: string }>;
  sourceOptions: Array<{ label: string; value: string }>;
  showBranchSelector?: boolean;
}) {
  const [range, setRange] = useState(props.range);
  const [expanded, setExpanded] = useState(false);
  const custom = range === "custom";
  const filtered = Boolean(props.sourceType || props.branchId || props.range !== "this-month");
  return <form action="/expenses" method="get" className={styles.homeFilters} aria-label="Filter business spending">
    <div className={styles.homeFilterBar}>
      <label><span className={styles.srOnly}>Period</span>
        <select name="range" value={range} onChange={(event) => {
          setRange(event.target.value);
          if (event.target.value !== "custom") event.currentTarget.form?.requestSubmit();
        }}>
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="custom">Custom date range</option>
        </select>
      </label>
      <button type="button" className={styles.homeFilterToggle} aria-expanded={expanded} aria-controls="expense-extra-filters" onClick={() => setExpanded(!expanded)}>
        Filters{props.sourceType || props.branchId ? " · Active" : ""}
      </button>
      {filtered ? <Link href="/expenses">Reset filters</Link> : null}
    </div>
    {custom ? <div className={styles.homeDateFields}>
      <label>From<input type="date" name="from" defaultValue={props.from} required /></label>
      <label>To<input type="date" name="to" defaultValue={props.to} required /></label>
      {!expanded ? <button type="submit">Apply</button> : null}
    </div> : null}
    <div id="expense-extra-filters" className={styles.homeFilterExtras} hidden={!expanded}>
      {props.sourceOptions.length >= 2 || props.sourceType ? <label>Source<select name="sourceType" defaultValue={props.sourceType}>
        <option value="">All sources</option>
        {props.sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label> : null}
      {(props.showBranchSelector ?? props.branches.length > 1) ? <label>Scope<select name="branchId" defaultValue={props.branchId}>
        <option value="">All authorised scope</option>
        {props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label> : props.branchId ? <input type="hidden" name="branchId" value={props.branchId} /> : null}
      <button type="submit">Apply</button>
    </div>
    <p className={styles.homeDateLabel}>{props.dateLabel}</p>
  </form>;
}
