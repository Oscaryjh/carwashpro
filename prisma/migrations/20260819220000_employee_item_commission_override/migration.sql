ALTER TABLE "commission_rule_revisions"
ADD COLUMN "item_id" UUID;

CREATE INDEX "commission_rule_member_item_effective_idx"
ON "commission_rule_revisions"("business_id", "scope", "scope_id", "item_id", "effective_from");
