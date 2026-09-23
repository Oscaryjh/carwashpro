CREATE TABLE performance_target_versions (
 id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
 revision INTEGER NOT NULL CHECK (revision > 0), request_key UUID NOT NULL,
 fingerprint TEXT NOT NULL, actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_name TEXT NOT NULL, reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
 snapshot JSONB NOT NULL, previous_snapshot JSONB NOT NULL, preview JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(business_id,branch_id,year,revision), UNIQUE(business_id,request_key)
);
CREATE INDEX performance_target_versions_scope_created_idx ON performance_target_versions(business_id,branch_id,year,created_at);
CREATE FUNCTION guard_performance_target_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Performance target history is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM branches WHERE id=NEW.branch_id AND business_id=NEW.business_id)
 OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_user_id AND business_id=NEW.business_id)
 THEN RAISE EXCEPTION 'Performance target tenant scope mismatch'; END IF;
 IF jsonb_typeof(NEW.snapshot->'levels') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing target levels'; END IF;
 IF jsonb_typeof(NEW.snapshot->'people') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing target members'; END IF;
 IF jsonb_array_length(NEW.snapshot->'levels') <> 3
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'levels') v WHERE v::text !~ '^[0-9]+$')
 OR (NEW.snapshot->'levels'->>0)::bigint <= 0
 OR (NEW.snapshot->'levels'->>1)::bigint <= (NEW.snapshot->'levels'->>0)::bigint
 OR (NEW.snapshot->'levels'->>2)::bigint <= (NEW.snapshot->'levels'->>1)::bigint
 THEN RAISE EXCEPTION 'Invalid cumulative target levels'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'people') p
   WHERE (p->>'amount') IS NULL OR (p->>'amount') !~ '^[0-9]+$'
   OR NOT EXISTS (SELECT 1 FROM employee_business_memberships m WHERE m.id=(p->>'membershipId')::uuid AND m.business_id=NEW.business_id))
 OR (SELECT count(*) FROM jsonb_array_elements(NEW.snapshot->'people')) <>
    (SELECT count(DISTINCT p->>'membershipId') FROM jsonb_array_elements(NEW.snapshot->'people') p)
 THEN RAISE EXCEPTION 'Invalid target member scope or amount'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER performance_target_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON performance_target_versions FOR EACH ROW EXECUTE FUNCTION guard_performance_target_version();
