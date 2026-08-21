-- Development uses the mock OTP provider and permits the same employee to
-- authenticate in several browsers/devices at once. Keep replacement scoped
-- to the current device for mock challenges. Real provider challenges retain
-- the original phone-wide invalidation rule used in production.
CREATE OR REPLACE FUNCTION "invalidate_previous_employee_otp_challenges"()
RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            NEW."phone_number_normalized",
            0
        )
    );

    UPDATE "employee_otp_challenges"
       SET "invalidated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     WHERE "phone_number_normalized" = NEW."phone_number_normalized"
       AND "invalidated_at" IS NULL
       AND (
           NEW."provider" <> 'mock'
           OR "device_fingerprint_hash" IS NOT DISTINCT FROM NEW."device_fingerprint_hash"
       );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
