"use client";

import { useState } from "react";
import { STATUTORY_REVIEW_CHECKLIST } from "@/lib/payroll/statutory-human-review";
import styles from "../../statutory-admin.module.css";

const groups = [
  {
    title: "Official evidence",
    description: "Confirm the source, document and effective date.",
    itemIds: [
      "official-publisher",
      "official-document",
      "retained-artifact",
      "artifact-sha256",
      "effective-date",
      "evidence-digest",
    ],
  },
  {
    title: "Calculation review",
    description: "Confirm the data, formulas and calculation boundaries.",
    itemIds: [
      "dataset",
      "independent-review",
      "calculator",
      "boundary-logic",
      "rounding",
      "fixture-provenance",
    ],
  },
  {
    title: "Payroll coverage",
    description: "Confirm who the rule applies to and its known limits.",
    itemIds: [
      "eligibility",
      "component-classifications",
      "unknown-inventory",
      "known-limitations",
      "effective-period-limit",
    ],
  },
] as const;

const labels: Record<(typeof STATUTORY_REVIEW_CHECKLIST)[number]["id"], string> = {
  "official-publisher": "Official publisher confirmed",
  "official-document": "Official document confirmed",
  "retained-artifact": "Saved evidence copy confirmed",
  "artifact-sha256": "File integrity confirmed",
  "effective-date": "Effective date confirmed",
  "dataset": "Calculation data reviewed",
  "independent-review": "Independent review checked",
  "calculator": "Calculator results reviewed",
  "boundary-logic": "Calculation limits reviewed",
  "rounding": "Rounding method reviewed",
  "fixture-provenance": "Test data source reviewed",
  "eligibility": "Employee eligibility reviewed",
  "component-classifications": "Payroll components reviewed",
  "unknown-inventory": "Unresolved items reviewed",
  "known-limitations": "Known limitations accepted",
  "effective-period-limit": "Effective period reviewed",
  "evidence-digest": "Evidence version confirmed",
};

type ItemId = (typeof STATUTORY_REVIEW_CHECKLIST)[number]["id"];

export function ApprovalChecklist() {
  const [confirmed, setConfirmed] = useState<Partial<Record<ItemId, boolean>>>({});
  const allSelected = STATUTORY_REVIEW_CHECKLIST.every((item) => confirmed[item.id]);

  function setAll(nextValue: boolean) {
    setConfirmed(Object.fromEntries(
      STATUTORY_REVIEW_CHECKLIST.map((item) => [item.id, nextValue]),
    ));
  }

  return (
    <>
      <div className={styles.approvalChecklistToolbar}>
        <div>
          <strong>Final confirmation</strong>
          <p>Review and confirm all three groups. These confirmations are stored with the approval record.</p>
        </div>
        <button className={styles.selectAllButton} type="button" onClick={() => setAll(!allSelected)}>
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className={styles.approvalChecklistGrid}>
        {groups.map((group, groupIndex) => (
          <section className={styles.approvalChecklistGroup} key={group.title}>
            <div className={styles.approvalChecklistHeader}>
              <span>{groupIndex + 1}</span>
              <div>
                <strong>{group.title}</strong>
                <p>{group.description}</p>
              </div>
            </div>
            <div className={styles.approvalChecklistItems}>
              {group.itemIds.map((itemId) => (
                <label key={itemId}>
                  <input
                    type="checkbox"
                    name={`reviewChecklist.${itemId}`}
                    value="confirmed"
                    required
                    checked={Boolean(confirmed[itemId])}
                    onChange={(event) => setConfirmed((current) => ({
                      ...current,
                      [itemId]: event.target.checked,
                    }))}
                  />
                  <span>{labels[itemId]}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
