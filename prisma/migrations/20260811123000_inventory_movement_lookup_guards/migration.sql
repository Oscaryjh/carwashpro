-- Inventory Phase 1 lookup and source-line idempotency guards.
CREATE INDEX "inventory_movements_business_type_created_idx"
  ON "inventory_movements"("business_id", "type", "created_at");

CREATE UNIQUE INDEX "inventory_movements_sale_source_line_key"
  ON "inventory_movements"("business_id", "source_line_id")
  WHERE "type" = 'SALE' AND "source_line_id" IS NOT NULL;
