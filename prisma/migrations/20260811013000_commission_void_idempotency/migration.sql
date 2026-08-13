-- One frozen accrual can be fully reversed by a void at most once.
CREATE UNIQUE INDEX "commission_adjustments_accrual_void_key"
  ON "commission_adjustments" ("accrual_id")
  WHERE "type" = 'VOID';
