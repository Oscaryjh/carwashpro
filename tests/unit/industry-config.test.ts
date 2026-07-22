import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessIndustry } from "@prisma/client";
import {
  INDUSTRY_CONFIG,
  getIndustryConfig,
} from "../../src/config/industry-config";
import { getBusinessHomeHref } from "../../src/lib/business-industry";

test("every supported industry has a complete configuration", () => {
  const industries: BusinessIndustry[] = [
    "AUTO_DETAILING",
    "SALON_BEAUTY",
    "PET_GROOMING",
    "DEVICE_REPAIR",
    "BICYCLE_REPAIR",
    "SHOE_CLEANING",
    "LAUNDRY",
    "WATCH_REPAIR",
    "GENERAL_SERVICE",
  ];

  for (const industry of industries) {
    const config = getIndustryConfig(industry);
    assert.equal(config.industryType, industry);
    assert.ok(config.label);
    assert.ok(config.subjectLabel);
    assert.ok(config.subjectIdentifierLabel);
    assert.ok(config.orderLabel);
    assert.ok(config.pickupStatusLabel);
    assert.ok(config.pickupActionLabel);
    assert.equal(INDUSTRY_CONFIG[industry], config);
  }
});

test("Auto and Salon keep their current subject behavior", () => {
  assert.equal(getIndustryConfig("AUTO_DETAILING").subjectLabel, "Vehicle");
  assert.equal(getIndustryConfig("AUTO_DETAILING").usesVehicleFields, true);
  assert.equal(getIndustryConfig("SALON_BEAUTY").subjectLabel, "Customer");
  assert.equal(getIndustryConfig("SALON_BEAUTY").usesVehicleFields, false);
});

test("business users land on their primary operating workspace", () => {
  assert.equal(getBusinessHomeHref("AUTO_DETAILING"), "/work-orders");
  assert.equal(getBusinessHomeHref("SALON_BEAUTY"), "/cashier");
  assert.equal(getBusinessHomeHref("PET_GROOMING"), "/cashier");
});
