CREATE OR REPLACE FUNCTION enforce_commission_tenant_scope() RETURNS trigger AS $$
DECLARE
  mismatch INTEGER;
BEGIN
  mismatch := 0;
  IF TG_TABLE_NAME = 'commission_rules' THEN
    SELECT count(*) INTO mismatch FROM "users" u WHERE u."id" = NEW."created_by_id" AND u."business_id" IS DISTINCT FROM NEW."business_id";
  ELSIF TG_TABLE_NAME = 'commission_rule_revisions' THEN
    SELECT count(*) INTO mismatch FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."business_id" <> NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "users" u WHERE u."id" = NEW."created_by_id" AND u."business_id" IS DISTINCT FROM NEW."business_id";
  ELSIF TG_TABLE_NAME = 'commission_source_events' THEN
    SELECT count(*) INTO mismatch FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."business_id" <> NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "invoices" i WHERE i."id" = NEW."invoice_id" AND i."business_id" <> NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "invoice_items" ii WHERE ii."id" = NEW."invoice_item_id" AND ii."business_id" <> NEW."business_id";
  ELSIF TG_TABLE_NAME = 'commission_periods' THEN
    SELECT count(*) INTO mismatch FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."business_id" <> NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "users" u WHERE u."id" IN (NEW."calculated_by_id", NEW."approved_by_id") AND u."business_id" IS DISTINCT FROM NEW."business_id";
  ELSIF TG_TABLE_NAME = 'commission_statements' THEN
    SELECT count(*) INTO mismatch FROM "users" u WHERE u."id" = NEW."approved_by_id" AND u."business_id" IS DISTINCT FROM NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "payroll_variable_pay" p WHERE p."id" = NEW."payroll_variable_pay_id" AND p."business_id" <> NEW."business_id";
  ELSIF TG_TABLE_NAME = 'commission_adjustments' THEN
    SELECT count(*) INTO mismatch FROM "users" u WHERE u."id" = NEW."created_by_id" AND u."business_id" IS DISTINCT FROM NEW."business_id";
    SELECT mismatch + count(*) INTO mismatch FROM "payment_refunds" r WHERE r."id" = NEW."payment_refund_id" AND r."business_id" <> NEW."business_id";
  END IF;
  IF mismatch > 0 THEN RAISE EXCEPTION 'COMMISSION_TENANT_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commission_rules_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_rules" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();
CREATE TRIGGER "commission_rule_revisions_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_rule_revisions" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();
CREATE TRIGGER "commission_source_events_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_source_events" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();
CREATE TRIGGER "commission_periods_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_periods" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();
CREATE TRIGGER "commission_statements_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_statements" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();
CREATE TRIGGER "commission_adjustments_tenant_guard" BEFORE INSERT OR UPDATE ON "commission_adjustments" FOR EACH ROW EXECUTE FUNCTION enforce_commission_tenant_scope();

CREATE OR REPLACE FUNCTION protect_commission_adjustment_amounts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMISSION_ADJUSTMENT_DELETE_FORBIDDEN'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."membership_id" <> OLD."membership_id" OR NEW."statement_id" IS DISTINCT FROM OLD."statement_id"
     OR NEW."accrual_id" <> OLD."accrual_id" OR NEW."payment_refund_id" IS DISTINCT FROM OLD."payment_refund_id" OR NEW."type" <> OLD."type"
     OR NEW."eligible_amount_cents" <> OLD."eligible_amount_cents" OR NEW."commission_amount_cents" <> OLD."commission_amount_cents"
     OR NEW."reason" <> OLD."reason" OR NEW."created_by_id" <> OLD."created_by_id" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'COMMISSION_ADJUSTMENT_FACTS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commission_adjustment_amount_guard" BEFORE UPDATE OR DELETE ON "commission_adjustments" FOR EACH ROW EXECUTE FUNCTION protect_commission_adjustment_amounts();
