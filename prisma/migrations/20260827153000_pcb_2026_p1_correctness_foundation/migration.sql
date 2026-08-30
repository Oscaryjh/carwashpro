-- Additive PCB 2026 P1 classification provenance. Existing rows remain valid
-- and unresolved until their governed evidence is reviewed.
CREATE TYPE "PcbStatutoryComponentNature" AS ENUM (
  'NORMAL_TAXABLE',
  'ADDITIONAL_TAXABLE',
  'PCB_ONLY_BIK',
  'PCB_ONLY_VOLA',
  'TAX_EXEMPT',
  'EXCLUDED',
  'UNKNOWN'
);

CREATE TYPE "PcbStatutoryClassificationReviewStatus" AS ENUM (
  'REVIEWED',
  'NEEDS_EVIDENCE'
);

ALTER TABLE "statutory_component_classifications"
  ADD COLUMN "pcb_nature" "PcbStatutoryComponentNature",
  ADD COLUMN "effective_from" DATE,
  ADD COLUMN "effective_to" DATE,
  ADD COLUMN "evidence_status" "PcbStatutoryClassificationReviewStatus",
  ADD COLUMN "evidence_reference" VARCHAR(1000),
  ADD COLUMN "semantic_metadata" JSONB,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "statutory_component_classifications_rule_set_id_scheme_effective_idx"
  ON "statutory_component_classifications"("rule_set_id", "scheme", "effective_from", "effective_to");
