export const STATUTORY_REVIEW_CHECKLIST_VERSION = "statutory-human-review/2.0.0";

export const STATUTORY_REVIEW_CHECKLIST = [
  { id: "official-publisher", label: "Official publisher verified" },
  { id: "official-document", label: "Official document identity verified" },
  { id: "retained-artifact", label: "Retained artifact verified" },
  { id: "artifact-sha256", label: "SHA-256 verified" },
  { id: "effective-date", label: "Effective date verified" },
  { id: "dataset", label: "Dataset reviewed" },
  { id: "independent-review", label: "Independent review result reviewed" },
  { id: "calculator", label: "Calculator reviewed" },
  { id: "boundary-logic", label: "Boundary logic reviewed" },
  { id: "rounding", label: "Rounding reviewed" },
  { id: "fixture-provenance", label: "Fixture provenance reviewed" },
  { id: "eligibility", label: "Eligibility logic reviewed" },
  { id: "component-classifications", label: "Component classifications reviewed" },
  { id: "unknown-inventory", label: "UNKNOWN inventory reviewed" },
  { id: "known-limitations", label: "Known limitations reviewed" },
  { id: "effective-period-limit", label: "Effective-period limitation reviewed" },
  { id: "evidence-digest", label: "Evidence digest reviewed" },
] as const;

export function assertStatutoryReviewChecklist(formData: FormData) {
  const submittedVersion = requiredString(formData, "reviewChecklistVersion");
  if (submittedVersion !== STATUTORY_REVIEW_CHECKLIST_VERSION) {
    throw new Error("STATUTORY_REVIEW_CHECKLIST_STALE");
  }
  const answers = statutoryReviewChecklistAnswers(formData);
  for (const item of STATUTORY_REVIEW_CHECKLIST) {
    if (answers[item.id] !== true) {
      throw new Error(`STATUTORY_REVIEW_CHECKLIST_INCOMPLETE_${item.id.toUpperCase().replaceAll("-", "_")}`);
    }
  }
  return submittedVersion;
}

export function statutoryReviewChecklistAnswers(formData: FormData) {
  return Object.fromEntries(
    STATUTORY_REVIEW_CHECKLIST.map((item) => [
      item.id,
      formData.get(`reviewChecklist.${item.id}`) === "confirmed",
    ]),
  ) as Record<(typeof STATUTORY_REVIEW_CHECKLIST)[number]["id"], boolean>;
}

export function completeStatutoryReviewChecklistAnswers() {
  return Object.fromEntries(
    STATUTORY_REVIEW_CHECKLIST.map((item) => [item.id, true]),
  ) as Record<(typeof STATUTORY_REVIEW_CHECKLIST)[number]["id"], boolean>;
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MISSING_${key.toUpperCase()}`);
  }
  return value.trim();
}
