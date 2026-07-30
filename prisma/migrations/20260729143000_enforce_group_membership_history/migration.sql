-- Preserve the legacy dashboard's historical visibility for the first group
-- assignment of each business. Future moves retain their real joined_at time.
WITH "ranked_memberships" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "business_id"
      ORDER BY "joined_at" ASC, "created_at" ASC, "id" ASC
    ) AS "membership_rank"
  FROM "business_group_members"
)
UPDATE "business_group_members" AS "membership"
SET "joined_at" = LEAST("membership"."joined_at", "business"."created_at")
FROM "ranked_memberships" AS "ranked", "businesses" AS "business"
WHERE "ranked"."id" = "membership"."id"
  AND "ranked"."membership_rank" = 1
  AND "business"."id" = "membership"."business_id";

-- Normalize any legacy rows before enforcing interval consistency.
UPDATE "business_group_members"
SET "removed_at" = COALESCE("removed_at", "updated_at", "joined_at")
WHERE "status" = 'REMOVED';

UPDATE "business_group_members"
SET "removed_at" = NULL
WHERE "status" = 'ACTIVE';

ALTER TABLE "business_group_members"
  ADD CONSTRAINT "business_group_members_valid_period_check"
  CHECK (
    (
      "status" = 'ACTIVE'
      AND "removed_at" IS NULL
    )
    OR (
      "status" = 'REMOVED'
      AND "removed_at" IS NOT NULL
      AND "removed_at" >= "joined_at"
    )
  );

CREATE INDEX "business_group_members_group_business_period_idx"
  ON "business_group_members"("group_id", "business_id", "joined_at", "removed_at");
