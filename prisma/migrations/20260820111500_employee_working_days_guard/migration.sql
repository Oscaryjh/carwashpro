ALTER TABLE "employee_business_memberships"
ADD CONSTRAINT "employee_membership_working_days_valid"
CHECK (
  "working_days_per_month" IS NULL
  OR "working_days_per_month" BETWEEN 1 AND 31
);

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_profile_direct_write()
RETURNS trigger AS $$
BEGIN
  IF current_setting('tetamu.payroll_profile_command', true) = 'on'
     OR current_setting('tetamu.payroll_profile_command_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW."pay_basis" IS DISTINCT FROM OLD."pay_basis"
    OR NEW."base_salary" IS DISTINCT FROM OLD."base_salary"
    OR NEW."working_days_per_month" IS DISTINCT FROM OLD."working_days_per_month"
    OR NEW."normal_work_minutes_per_day" IS DISTINCT FROM OLD."normal_work_minutes_per_day"
    OR NEW."target_break_minutes" IS DISTINCT FROM OLD."target_break_minutes"
    OR NEW."statutory_nationality" IS DISTINCT FROM OLD."statutory_nationality"
    OR NEW."epf_enabled" IS DISTINCT FROM OLD."epf_enabled"
    OR NEW."epf_member_before_aug_1998" IS DISTINCT FROM OLD."epf_member_before_aug_1998"
    OR NEW."socso_enabled" IS DISTINCT FROM OLD."socso_enabled"
    OR NEW."socso_category" IS DISTINCT FROM OLD."socso_category"
    OR NEW."eis_enabled" IS DISTINCT FROM OLD."eis_enabled"
    OR NEW."eis_previously_contributed" IS DISTINCT FROM OLD."eis_previously_contributed"
    OR NEW."lindung_24_opt_in" IS DISTINCT FROM OLD."lindung_24_opt_in"
    OR NEW."statutory_identity_type" IS DISTINCT FROM OLD."statutory_identity_type"
    OR NEW."statutory_identity_number" IS DISTINCT FROM OLD."statutory_identity_number"
    OR NEW."statutory_country_code" IS DISTINCT FROM OLD."statutory_country_code"
    OR NEW."epf_member_number" IS DISTINCT FROM OLD."epf_member_number"
    OR NEW."socso_member_number" IS DISTINCT FROM OLD."socso_member_number"
    OR NEW."tax_identification_number" IS DISTINCT FROM OLD."tax_identification_number"
    OR NEW."compensation_revision" IS DISTINCT FROM OLD."compensation_revision"
    OR NEW."work_target_revision" IS DISTINCT FROM OLD."work_target_revision"
    OR NEW."statutory_profile_revision" IS DISTINCT FROM OLD."statutory_profile_revision"
    OR NEW."tax_profile_revision" IS DISTINCT FROM OLD."tax_profile_revision" THEN
    RAISE EXCEPTION 'Payroll profile fields must be changed through the canonical command service.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
