import assert from "node:assert/strict";
import test from "node:test";
import {
  branchAttendanceSettingInputSchema,
  validateBranchAttendanceSettingInput,
} from "../../src/lib/attendance/branch-setting";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

function validSetting() {
  return {
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    latitude: "1.5535",
    longitude: "110.3593",
    geofenceRadiusMeters: "100",
    minimumAccuracyMeters: "80",
    requireGeofence: true,
    allowOutsideGeofenceRequest: true,
    requirePhoto: false,
    timezone: "Asia/Kuching",
    isEnabled: true,
  };
}

test("branch attendance setting accepts bounded coordinates and IANA timezone", () => {
  const setting = validateBranchAttendanceSettingInput(validSetting());

  assert.equal(setting.latitude, 1.5535);
  assert.equal(setting.longitude, 110.3593);
  assert.equal(setting.geofenceRadiusMeters, 100);
  assert.equal(setting.minimumAccuracyMeters, 80);
  assert.equal(setting.timezone, "Asia/Kuching");
});

test("branch attendance setting applies safe defaults", () => {
  const input = validSetting();
  const setting = branchAttendanceSettingInputSchema.parse({
    businessId: input.businessId,
    branchId: input.branchId,
    latitude: input.latitude,
    longitude: input.longitude,
  });

  assert.equal(setting.geofenceRadiusMeters, 100);
  assert.equal(setting.minimumAccuracyMeters, 80);
  assert.equal(setting.requireGeofence, true);
  assert.equal(setting.allowOutsideGeofenceRequest, true);
  assert.equal(setting.requirePhoto, false);
  assert.equal(setting.timezone, "Asia/Kuching");
  assert.equal(setting.isEnabled, false);
});

test("branch attendance setting rejects out-of-range geo values", () => {
  for (const invalid of [
    { latitude: -90.01 },
    { latitude: 90.01 },
    { longitude: -180.01 },
    { longitude: 180.01 },
    { geofenceRadiusMeters: 19 },
    { geofenceRadiusMeters: 1001 },
    { minimumAccuracyMeters: 9 },
    { minimumAccuracyMeters: 501 },
  ]) {
    assert.equal(
      branchAttendanceSettingInputSchema.safeParse({
        ...validSetting(),
        ...invalid,
      }).success,
      false,
      JSON.stringify(invalid),
    );
  }
});

test("branch attendance setting rejects invalid timezone and identifiers", () => {
  assert.equal(
    branchAttendanceSettingInputSchema.safeParse({
      ...validSetting(),
      timezone: "Not/A_Timezone",
    }).success,
    false,
  );
  assert.equal(
    branchAttendanceSettingInputSchema.safeParse({
      ...validSetting(),
      branchId: "other-business-branch",
    }).success,
    false,
  );
});
