"use client";
import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { historyDatePeriods } from "./date-periods";
import styles from "../expense.module.css";

export function HistoryFilters(props: {
  query: { from?: string; to?: string; q?: string; categoryId?: string; sourceType?: string; paymentStatus?: string; status?: string; branchId?: string };
  periods: ReturnType<typeof historyDatePeriods>;
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}) {
  const { query, periods } = props;
  const [period, setPeriod] = useState(Object.entries(periods).find(([, dates]) => dates.from === query.from && dates.to === query.to)?.[0] ?? (query.from || query.to ? "custom" : "all"));
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");
  const [expanded, setExpanded] = useState(false);
  return <form action="/expenses/history" method="get" className={styles.compactHistoryFilters} aria-label="Filter expense history">
    <div className={styles.historySearchBar}>
      <label><span className={styles.srOnly}>Search</span><input name="q" defaultValue={query.q ?? ""} placeholder="Search expense no., payee or description" /></label>
      <select aria-label="Period" value={period} onChange={event => {
        const value = event.target.value, form = event.currentTarget.form;
        flushSync(() => {
          setPeriod(value);
          if (value === "this-month" || value === "last-month") { setFrom(periods[value].from); setTo(periods[value].to); }
          if (value === "all") { setFrom(""); setTo(""); }
        });
        if (value !== "custom") form?.requestSubmit();
      }}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom</option><option value="all">All dates</option></select>
      <button type="button" aria-expanded={expanded} aria-controls="history-advanced-filters" onClick={() => setExpanded(!expanded)}>Filters</button>
    </div>
    {period === "custom" ? <div className={styles.historyDateFields}>
      <label>From<input type="date" name="from" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To<input type="date" name="to" value={to} onChange={event => setTo(event.target.value)} /></label>
      {!expanded ? <button type="submit">Apply filters</button> : null}
    </div> : <><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /></>}
    <div id="history-advanced-filters" className={styles.historyAdvanced} hidden={!expanded}>
      <label>Category<select name="categoryId" defaultValue={query.categoryId ?? ""}><option value="">All categories</option>{props.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Source<select name="sourceType" defaultValue={query.sourceType ?? ""}><option value="">All sources</option><option value="MANUAL">Manual</option><option value="CLAIM">Claims</option><option value="PAYROLL">Payroll</option><option value="INVENTORY_PURCHASE">Inventory Purchases</option></select></label>
      <label>Payment<select name="paymentStatus" defaultValue={query.paymentStatus ?? ""}><option value="">All payment states</option><option value="PAID">Paid</option><option value="PARTIALLY_PAID">Partially paid</option><option value="UNPAID">Unpaid</option></select></label>
      <label>Status<select name="status" defaultValue={query.status ?? ""}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Confirmed</option><option value="VOID">Void</option></select></label>
      {props.branches.length > 1 ? <label>Scope<select name="branchId" defaultValue={query.branchId ?? ""}><option value="">All authorised scope</option>{props.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : query.branchId ? <input type="hidden" name="branchId" value={query.branchId} /> : null}
      <div className={styles.historyFilterButtons}><Link href="/expenses/history?from=&to=">Clear filters</Link><button type="submit">Apply filters</button></div>
    </div>
    <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Search</button>
  </form>;
}
