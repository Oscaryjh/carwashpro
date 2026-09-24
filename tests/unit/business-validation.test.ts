import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  adminResetUserPasswordSchema,
  businessSchema,
  createBusinessSchema,
} from "../../src/lib/validation/business";

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

const validCreateBusiness = {
  name: "Salon Test",
  slug: "salon-test",
  industryType: "SALON_BEAUTY",
  companyNo: "",
  phone: "",
  ownerName: "Salon Owner",
  ownerEmail: "owner@example.test",
};

test("new business accepts a six-character owner password but rejects five", () => {
  assert.equal(
    createBusinessSchema.safeParse({ ...validCreateBusiness, ownerPassword: "123456" }).success,
    true,
  );

  const short = createBusinessSchema.safeParse({
    ...validCreateBusiness,
    ownerPassword: "12345",
  });
  assert.equal(short.success, false);
  if (!short.success) {
    assert.equal(short.error.flatten().fieldErrors.ownerPassword?.[0],
      "Owner password must be at least 6 characters.");
  }
});

test("new business form lets the browser submit a six-character owner password", async () => {
  require.extensions[".css"] = (module) => { module.exports = {}; };
  const { BusinessForm } = await import("../../src/components/business-form");
  const html = renderToStaticMarkup(createElement(BusinessForm, {
    action: () => {},
    mode: "create",
    showOwnerFields: true,
  }));
  const input = html.match(/<input[^>]*name="ownerPassword"[^>]*>/)?.[0];
  assert.ok(input, "owner password input should render");
  assert.match(input, /minLength="6"/);
});

test("admin password reset accepts six characters but rejects five", () => {
  const reset = {
    businessId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
  };
  assert.equal(
    adminResetUserPasswordSchema.safeParse({ ...reset, newPassword: "12345" }).success,
    false,
  );
  assert.equal(
    adminResetUserPasswordSchema.safeParse({ ...reset, newPassword: "123456" }).success,
    true,
  );
});

test("admin reset form lets the browser submit a six-character password", async () => {
  require.extensions[".css"] = (module) => { module.exports = {}; };
  const { AdminResetPasswordForm } = await import("../../src/components/admin-reset-password-form");
  const html = renderToStaticMarkup(createElement(AdminResetPasswordForm, {
    businessId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    userEmail: "owner@example.test",
  }));
  const input = html.match(/<input[^>]*name="newPassword"[^>]*>/)?.[0];
  assert.ok(input, "admin reset password input should render");
  assert.match(input, /minLength="6"/);
});
