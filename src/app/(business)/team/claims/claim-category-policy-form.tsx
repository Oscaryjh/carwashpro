"use client";

import { useState } from "react";
import { createClaimPolicyRevisionAction } from "./actions";
import styles from "./claims.module.css";

type CategoryPolicy = {
  id: string;
  name: string;
  nature: "GENERAL" | "MILEAGE";
  latest: {
    nameSnapshot: string;
    effectiveFrom: string;
    receiptRequired: boolean;
    descriptionRequired: boolean;
    maxLineAmount: string | null;
    mileageRatePerKm: string | null;
    statutoryTreatmentStatus: "VERIFIED_NON_WAGE" | "REVIEW_REQUIRED";
  } | null;
} | null;

export function ClaimCategoryPolicyForm({ category, today }: { category: CategoryPolicy; today: string }) {
  const [nature, setNature] = useState<"GENERAL" | "MILEAGE">(category?.nature ?? "GENERAL");
  const latest = category?.latest;

  return (
    <form action={createClaimPolicyRevisionAction} className={styles.policyForm}>
      {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
      <div className={styles.formHeading}>
        <div>
          <p className={styles.eyebrow}>{category ? "EDIT CATEGORY" : "NEW CATEGORY"}</p>
          <h3>{category ? category.name : "Add claim category"}</h3>
          <span>{category ? "Set the limits and requirements for new claims in this category." : "Create a category employees can choose when submitting an expense."}</span>
        </div>
      </div>

      <div className={styles.policyFields}>
        <label>Category name<input name="name" required minLength={2} maxLength={120} defaultValue={latest?.nameSnapshot ?? category?.name ?? ""} placeholder="For example, Meals" /></label>
        <label>Claim type<select name="nature" value={nature} onChange={(event) => setNature(event.target.value as "GENERAL" | "MILEAGE")} disabled={Boolean(category)}><option value="GENERAL">General expense</option><option value="MILEAGE">Mileage claim</option></select>{category ? <input type="hidden" name="nature" value={nature} /> : null}</label>
        <label>Applies from<input name="effectiveFrom" type="date" required defaultValue={today} /><small>Claims submitted before this date keep their existing rules.</small></label>
        <label>Per-claim limit (RM)<input name="maxLineAmount" type="number" min="0.01" step="0.01" defaultValue={latest?.maxLineAmount ?? ""} placeholder="Leave blank for no limit" /><small>The highest amount an employee can claim at one time.</small></label>
        {nature === "MILEAGE" ? <label>Mileage rate (RM / km)<input name="mileageRatePerKm" type="number" min="0.0001" step="0.0001" required defaultValue={latest?.mileageRatePerKm ?? ""} placeholder="For example, 0.85" /></label> : null}
        {!category ? <label className={styles.fullField}>Employee guidance<input name="description" maxLength={500} placeholder="Optional instructions shown with this category" /></label> : null}
      </div>

      <fieldset className={styles.treatmentField}>
        <legend>Payroll treatment</legend>
        <p>This setting controls only this claim reimbursement. It never stops the employee&apos;s salary payroll.</p>
        <div className={styles.treatmentOptions}>
          <label className={styles.treatmentOption}>
            <input name="statutoryTreatmentStatus" type="radio" value="VERIFIED_NON_WAGE" defaultChecked={latest?.statutoryTreatmentStatus === "VERIFIED_NON_WAGE"} required />
            <span><b>Standard business reimbursement</b><small>Reimburse the approved expense without increasing gross salary.</small></span>
            <em>Recommended</em>
          </label>
          <label className={styles.treatmentOption}>
            <input name="statutoryTreatmentStatus" type="radio" value="REVIEW_REQUIRED" defaultChecked={!latest || latest.statutoryTreatmentStatus === "REVIEW_REQUIRED"} required />
            <span><b>Review before adding to payroll</b><small>Hold only this reimbursement until HR confirms its payroll treatment.</small></span>
          </label>
        </div>
      </fieldset>

      <div className={styles.policySwitches}>
        <label className={styles.switchRow}><span><b>Require a receipt</b><small>Employees must attach proof of payment.</small></span><input name="receiptRequired" type="checkbox" defaultChecked={latest?.receiptRequired ?? false} /></label>
        <label className={styles.switchRow}><span><b>Require a description</b><small>Employees must explain what the expense was for.</small></span><input name="descriptionRequired" type="checkbox" defaultChecked={latest?.descriptionRequired ?? true} /></label>
      </div>

      <div className={styles.policyFooter}>
        <p>Changes apply to claims submitted from the selected date. Existing claims stay unchanged.</p>
        <button>{category ? "Save category changes" : "Add category"}</button>
      </div>
    </form>
  );
}
