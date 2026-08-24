"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createLeavePolicyAction } from "./actions";
import styles from "./leave.module.css";

export function LeaveTypeCreateForm({ year, existingNames }: { year: number; existingNames: string[] }) {
  const [name, setName] = useState("");
  const [allowanceMode, setAllowanceMode] = useState<"FIXED" | "NONE">("FIXED");
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const similarName = useMemo(() => findSimilarLeaveType(name, existingNames), [existingNames, name]);

  return (
    <form action={createLeavePolicyAction} className={styles.leaveTypeForm}>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="allowanceMode" value={allowanceMode} />
      <label className={styles.full}>
        Leave type name
        <input name="name" required minLength={2} maxLength={120} placeholder="For example, Study leave" autoFocus value={name} onChange={(event) => { setName(event.target.value); setDuplicateConfirmed(false); }} />
      </label>
      {similarName ? (
        <div className={`${styles.duplicateWarning} ${styles.full}`}>
          <strong>A similar leave type already exists: {similarName}</strong>
          <p>Use the existing type unless this leave needs a genuinely different policy.</p>
          <label><input type="checkbox" required checked={duplicateConfirmed} onChange={(event) => setDuplicateConfirmed(event.target.checked)} /> Create it anyway</label>
        </div>
      ) : null}
      <label>
        Paid or unpaid
        <select name="payTreatment" defaultValue="PAID"><option value="PAID">Paid leave</option><option value="UNPAID">Unpaid leave</option></select>
      </label>
      <fieldset className={styles.allowanceChoice}>
        <legend>Employee allowance</legend>
        <label><input type="radio" name="allowanceChoice" checked={allowanceMode === "FIXED"} onChange={() => setAllowanceMode("FIXED")} /> Fixed yearly allowance</label>
        <label><input type="radio" name="allowanceChoice" checked={allowanceMode === "NONE"} onChange={() => setAllowanceMode("NONE")} /> No balance limit</label>
      </fieldset>
      {allowanceMode === "FIXED" ? (
        <label>
          Days per year
          <input name="defaultEntitlementDays" type="number" min="0" max="366" step="0.5" required placeholder="For example, 8" />
          <small>This becomes the regular yearly allowance. Employee adjustments remain separate.</small>
        </label>
      ) : <input type="hidden" name="defaultEntitlementDays" value="0" />}
      <details className={`${styles.policyAdvanced} ${styles.full}`}>
        <summary>More options</summary>
        <div className={styles.leaveTypeForm}>
          <label>Count leave by<select name="countMode" defaultValue="WEEKDAYS"><option value="WEEKDAYS">Scheduled workdays</option><option value="CALENDAR_DAYS">Calendar days</option></select></label>
          <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <div className={`${styles.leaveTypeOptions} ${styles.full}`}>
            <label><input name="requiresDocument" type="checkbox" /><span><strong>Require a document</strong><small>Employees must attach supporting evidence.</small></span></label>
            <label><input name="allowNegativeBalance" type="checkbox" /><span><strong>Allow requests above balance</strong><small>HR can still review the request before approval.</small></span></label>
          </div>
        </div>
      </details>
      <footer className={`${styles.modalActions} ${styles.full}`}>
        <Link href={`/team/leave?year=${year}&manage=types`}>Cancel</Link>
        <button type="submit">Create leave type</button>
      </footer>
    </form>
  );
}

function findSimilarLeaveType(name: string, existingNames: string[]) {
  const normalized = normalize(name);
  if (normalized.length < 3) return null;
  return existingNames.find((candidate) => {
    const existing = normalize(candidate);
    if (existing === normalized) return true;
    const annualVacation = new Set(["annual", "vacation"]);
    return annualVacation.has(existing) && annualVacation.has(normalized);
  }) ?? null;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\b(company|policy|leave)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
