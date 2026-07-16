INSERT INTO "service_categories" (
  "id",
  "business_id",
  "name",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  businesses."id",
  categories."name",
  'ACTIVE'::"ServiceCategoryStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "businesses"
CROSS JOIN (
  VALUES
    ('Hair Services'),
    ('Hair Colouring'),
    ('Hair Treatment'),
    ('Facial'),
    ('Nails'),
    ('Massage'),
    ('Waxing'),
    ('Other')
) AS categories("name")
WHERE businesses."industry_type" = 'SALON_BEAUTY'::"BusinessIndustry"
ON CONFLICT ("business_id", "name") DO NOTHING;
