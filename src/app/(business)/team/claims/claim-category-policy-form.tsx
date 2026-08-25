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
          <p className={styles.eyebrow}>{category ? "UPDATE CATEGORY" : "NEW CATEGORY"}</p>
          <h3>{category ? category.name : "Add claim category"}</h3>
          <span>{category ? "Saving creates a new policy version. Earlier claims stay unchanged." : "Create a category employees can use when submitting expenses."}</span>
        </div>
      </div>

      <div className={styles.policyFields}>
        <label>Category name<input name="name" required minLength={2} maxLength={120} defaultValue={latest?.nameSnapshot ?? category?.name ?? ""} placeholder="For example, Meals" /></label>
        <label>Expense type<select name="nature" value={nature} onChange={(event) => setNature(event.target.value as "GENERAL" | "MILEAGE")} disabled={Boolean(category)}><option value="GENERAL">General expense</option><option value="MILEAGE">Mileage</option></select>{category ? <input type="hidden" name="nature" value={nature} /> : null}</label>
        <label>Effective date<input name="effectiveFrom" type="date" required defaultValue={today} /><small>The new policy starts on this date. Previous claims are not changed.</small></label>
        <label>Maximum claim amount (RM)<input name="maxLineAmount" type="number" min="0.01" step="0.01" defaultValue={latest?.maxLineAmount ?? ""} placeholder="No limit" /><small>Maximum amount allowed for a single claim.</small></label>
        {nature === "MILEAGE" ? <label>Mileage rate (RM / km)<input name="mileageRatePerKm" type="number" min="0.0001" step="0.0001" required defaultValue={latest?.mileageRatePerKm ?? ""} placeholder="For example, 0.85" /></label> : null}
        {!category ? <label className={styles.fullField}>Employee guidance<input name="description" maxLength={500} placeholder="Optional instructions shown with this category" /></label> : null}
        <label className={styles.fullField}>Payroll treatment
          <select name="statutoryTreatmentStatus" required defaultValue={latest?.statutoryTreatmentStatus ?? "REVIEW_REQUIRED"}>
            <option value="VERIFIED_NON_WAGE">Business reimbursement</option>
            <option value="REVIEW_REQUIRED">Needs payroll review</option>
          </select>
          <small>Business reimbursement adds approved claims without increasing gross salary. “Needs payroll review” holds only that claim until it is confirmed.</small>
        </label>
      </div>

      <div className={styles.policySwitches}>
        <label className={styles.switchRow}><span><b>Receipt required</b><small>Employees must attach a receipt.</small></span><input name="receiptRequired" type="checkbox" defaultChecked={latest?.receiptRequired ?? false} /></label>
        <label className={styles.switchRow}><span><b>Description required</b><small>Employees must explain the expense.</small></span><input name="descriptionRequired" type="checkbox" defaultChecked={latest?.descriptionRequired ?? true} /></label>
      </div>

      {category ? <label className={styles.changeReason}>Reason for change<input name="reason" required minLength={5} maxLength={500} placeholder="Briefly explain this policy update" /></label> : null}
      <div className={styles.policyFooter}>
        <p>This setting applies to new claims submitted under this policy version.</p>
        <button>{category ? "Save new version" : "Add category"}</button>
      </div>
    </form>
  );
}
