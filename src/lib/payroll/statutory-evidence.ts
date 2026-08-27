import type {
  EmployeeStatutoryNationality,
  StatutoryEvidenceEnvironment,
  StatutoryEvidenceNature,
  StatutoryFixturePurpose,
} from "@prisma/client";
import {
  isProductionRuntime,
  runtimeEnvironment,
  type RuntimeEnvironmentMap,
} from "@/lib/release/environment";

export const SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION =
  "SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION";
export const SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE =
  "SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE";
export const STATUTORY_EVIDENCE_CONTRACT_INVALID =
  "STATUTORY_EVIDENCE_CONTRACT_INVALID";

export type StatutoryEvidenceProvenance = {
  evidenceNature: StatutoryEvidenceNature;
  evidenceEnvironment: StatutoryEvidenceEnvironment | null;
  fixturePurpose: StatutoryFixturePurpose | null;
  officialExportEligible: boolean;
  statutoryNationalitySnapshot: EmployeeStatutoryNationality | null;
};

export function assertStatutoryEvidenceWriteAllowed(
  evidenceNature: StatutoryEvidenceNature,
  env: RuntimeEnvironmentMap = process.env,
) {
  if (evidenceNature === "SYNTHETIC_TESTING" && isProductionRuntime(env)) {
    throw new Error(SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION);
  }
}

export function assertStatutoryEvidenceReadAllowed(
  provenance: Pick<StatutoryEvidenceProvenance, "evidenceNature">,
  env: RuntimeEnvironmentMap = process.env,
) {
  if (
    provenance.evidenceNature === "SYNTHETIC_TESTING" &&
    runtimeEnvironment(env) === "production"
  ) {
    throw new Error(SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION);
  }
}

export function validateStatutoryEvidenceProvenance(
  provenance: StatutoryEvidenceProvenance,
) {
  if (provenance.evidenceNature === "REAL") {
    if (
      provenance.evidenceEnvironment !== null ||
      provenance.fixturePurpose !== null ||
      provenance.officialExportEligible !== true
    ) {
      throw new Error(STATUTORY_EVIDENCE_CONTRACT_INVALID);
    }
    return;
  }
  if (
    provenance.evidenceEnvironment === null ||
    provenance.fixturePurpose === null ||
    provenance.officialExportEligible !== false ||
    provenance.statutoryNationalitySnapshot === null
  ) {
    throw new Error(STATUTORY_EVIDENCE_CONTRACT_INVALID);
  }
}

export function officialExportEligibilityLabel(provenance: StatutoryEvidenceProvenance) {
  return provenance.officialExportEligible
    ? "Official export eligible"
    : "Testing fixture — official export disabled";
}
