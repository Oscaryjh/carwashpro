CREATE UNIQUE INDEX "business_expense_payment_events_id_business_id_key"
ON "business_expense_payment_events"("id", "business_id");

CREATE UNIQUE INDEX "cashier_shifts_id_business_id_branch_id_key"
ON "cashier_shifts"("id", "business_id", "branch_id");

CREATE TABLE "cashier_shift_expense_payouts" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "shift_id" UUID NOT NULL,
  "payment_event_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cashier_shift_expense_payouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cashier_shift_expense_payouts_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "cashier_shift_expense_payouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cashier_shift_expense_payouts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cashier_shift_expense_payouts_shift_scope_fkey" FOREIGN KEY ("shift_id", "business_id", "branch_id") REFERENCES "cashier_shifts"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cashier_shift_expense_payouts_payment_scope_fkey" FOREIGN KEY ("payment_event_id", "business_id") REFERENCES "business_expense_payment_events"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cashier_shift_expense_payouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cashier_shift_expense_payouts_payment_event_id_key"
ON "cashier_shift_expense_payouts"("payment_event_id");

CREATE UNIQUE INDEX "cashier_shift_expense_payouts_payment_event_id_business_id_key"
ON "cashier_shift_expense_payouts"("payment_event_id", "business_id");

CREATE INDEX "cashier_shift_expense_payouts_business_id_branch_id_occurred_at_idx"
ON "cashier_shift_expense_payouts"("business_id", "branch_id", "occurred_at");

CREATE INDEX "cashier_shift_expense_payouts_shift_id_occurred_at_idx"
ON "cashier_shift_expense_payouts"("shift_id", "occurred_at");
