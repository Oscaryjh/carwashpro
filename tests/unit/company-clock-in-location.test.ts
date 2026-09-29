import assert from "node:assert/strict";
import test from "node:test";
import { upsertBranchAttendanceSetting } from "../../src/lib/attendance/branch-setting-service";

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const existing = {
  id: "setting", businessId, branchId, latitude: 5, longitude: 116,
  geofenceRadiusMeters: 100, minimumAccuracyMeters: 80, timezone: "Asia/Kuching",
  isEnabled: true, requireGeofence: false, allowOutsideGeofenceRequest: false,
  requirePhoto: true, breakPolicy: "PAID_BREAK", targetBreakMinutes: 30,
  normalWorkMinutesPerDay: 420, shiftSpanMinutes: 450,
};
function fixture(stored: any = { ...existing }) {
  let row = stored;
  const tx: any = {
    branch: { findFirst: async () => ({ id: branchId, name: "Synthetic outlet" }) },
    branchAttendanceSetting: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => (row = row ? { ...row, ...update } : { id: "setting", ...create }),
    },
    auditLog: { create: async () => ({}) },
  };
  return { database: { $transaction: async (fn: any) => fn(tx) } as any, row: () => row };
}
function save(database: any, input: any, mode = "location") {
  return upsertBranchAttendanceSetting({ businessId, allowedBranchIds: [branchId], actor: { id: "actor", role: "BUSINESS_OWNER" }, input: { branchId, ...input }, mode } as any, database);
}
const location = { latitude: "5.123456", longitude: "116.123456", geofenceRadiusMeters: 150, minimumAccuracyMeters: 60, timezone: "Asia/Kuching" };

test("location-only save preserves all attendance policy fields even with forged policy inputs", async () => {
  const f = fixture();
  await save(f.database, { ...location, isEnabled: false, requirePhoto: false, breakPolicy: "MANUAL_PUNCH" });
  assert.deepEqual(f.row(), { ...existing, ...location, latitude: 5.123456, longitude: 116.123456 });
});
test("new location does not enable attendance even with a forged enabled input", async () => {
  const f = fixture(null);
  await save(f.database, { ...location, isEnabled: true });
  assert.equal(f.row().isEnabled, false);
  assert.equal(f.row().requireGeofence, true);
});
test("policy-only save preserves location and photo policy instead of trusting stale form values", async () => {
  const f = fixture();
  await save(f.database, { ...existing, latitude: 0, longitude: 0, isEnabled: false }, "policy");
  assert.equal(f.row().latitude, 5);
  assert.equal(f.row().longitude, 116);
  assert.equal(f.row().isEnabled, false);
  assert.equal(f.row().requirePhoto, true);
});
test("policy cannot activate an unconfigured location", async () => {
  const f = fixture(null);
  await assert.rejects(save(f.database, { ...existing }, "policy"), /location/i);
  assert.equal(f.row(), null);
});
test("location rejects blank coordinates, invalid bounds and invalid timezone without writes", async () => {
  for (const bad of [{ latitude: "" }, { longitude: " " }, { latitude: 91 }, { longitude: -181 }, { geofenceRadiusMeters: 19 }, { geofenceRadiusMeters: 1001 }, { minimumAccuracyMeters: 9 }, { minimumAccuracyMeters: 501 }, { timezone: "Invalid/Zone" }]) {
    const f = fixture();
    await assert.rejects(save(f.database, { ...location, ...bad }));
    assert.deepEqual(f.row(), existing);
  }
  const f = fixture();
  await save(f.database, { ...location, latitude: 0, longitude: 0 });
  assert.equal(f.row().latitude, 0);
  assert.equal(f.row().longitude, 0);
});
