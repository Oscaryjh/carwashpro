import assert from "node:assert/strict";
import test from "node:test";
import { businessSchema } from "../../src/lib/validation/business";

const validBusiness = {
  name: "Salon Test",
  slug: "salon-test",
  companyNo: "",
  phone: "",
  email: "",
  address: "",
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
  sstEnabled: false,
  sstLabel: "SST",
  sstRate: 6,
  sstRegistrationNo: "",
  status: "active" as const,
};

test("allows an empty SST registration number when SST is disabled", () => {
  assert.equal(businessSchema.safeParse(validBusiness).success, true);
});

test("requires an SST registration number when SST is enabled", () => {
  const result = businessSchema.safeParse({
    ...validBusiness,
    sstEnabled: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["sstRegistrationNo"]);
    assert.equal(
      result.error.issues[0]?.message,
      "SST registration number is required when SST is enabled.",
    );
  }
});

test("accepts an SST registration number when SST is enabled", () => {
  assert.equal(
    businessSchema.safeParse({
      ...validBusiness,
      sstEnabled: true,
      sstRegistrationNo: "W10-1234-56789012",
    }).success,
    true,
  );
});

test("accepts valid canonical business time settings", () => {
  const result = businessSchema.parse({
    ...validBusiness,
    timezone: "Asia/Tokyo",
    businessDayCutoffTime: "23:59",
  });

  assert.equal(result.timezone, "Asia/Tokyo");
  assert.equal(result.businessDayCutoffTime, "23:59");
});

test("rejects an invalid IANA timezone", () => {
  const result = businessSchema.safeParse({
    ...validBusiness,
    timezone: "Mars/Olympus_Mons",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["timezone"]);
  }
});

test("rejects an invalid business day cutoff", () => {
  for (const businessDayCutoffTime of ["24:00", "2:00", "12:60"]) {
    const result = businessSchema.safeParse({
      ...validBusiness,
      businessDayCutoffTime,
    });
    assert.equal(result.success, false);
  }
});
