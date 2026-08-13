-- Commission rates are intentionally capped at 100% (10,000 basis points).
ALTER TABLE "commission_rule_revisions"
  DROP CONSTRAINT "commission_rule_revision_value";

ALTER TABLE "commission_rule_revisions"
  ADD CONSTRAINT "commission_rule_revision_value" CHECK (
    ("rule_type" = 'PERCENTAGE' AND "rate_basis_points" BETWEEN 0 AND 10000 AND "fixed_amount_cents" IS NULL AND jsonb_array_length("tiers") = 0)
    OR ("rule_type" = 'FIXED_AMOUNT' AND "fixed_amount_cents" >= 0 AND "rate_basis_points" IS NULL AND jsonb_array_length("tiers") = 0)
    OR ("rule_type" = 'TIERED_PERCENTAGE' AND "rate_basis_points" IS NULL AND "fixed_amount_cents" IS NULL AND "tier_mode" = 'WHOLE_PERIOD_RATE' AND jsonb_array_length("tiers") > 0)
  );
