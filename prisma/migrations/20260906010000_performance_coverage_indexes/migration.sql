-- Scoped read-only coverage reconciliation; no historical data changes.
CREATE INDEX "payments_performance_scope_time_idx" ON "payments" ("business_id", "branch_id", "paid_at");
CREATE INDEX "refunds_performance_scope_time_idx" ON "payment_refunds" ("business_id", "branch_id", "refunded_at");
CREATE INDEX "performance_receipts_scope_local_date_idx" ON "performance_receipts" ("business_id", "branch_id", "local_date");
