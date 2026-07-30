import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAttendanceGeofence,
  haversineDistanceMeters,
} from "../../src/lib/attendance/geofence";

const BRANCH = {
  latitude: 1.5535,
  longitude: 110.3593,
  geofenceRadiusMeters: 100,
  minimumAccuracyMeters: 80,
  requireGeofence: true,
};

test("haversine returns zero for the same point and a server-calculated distance", () => {
  assert.equal(haversineDistanceMeters(BRANCH, BRANCH), 0);
  const distance = haversineDistanceMeters(BRANCH, {
    latitude: 1.5544,
    longitude: 110.3593,
  });
  assert.ok(distance > 99);
  assert.ok(distance < 101);
});

test("geofence accepts the exact radius boundary", () => {
  const metresPerDegreeAtEquator = 111_195.0802335329;
  const boundary = evaluateAttendanceGeofence(BRANCH, {
    latitude:
      BRANCH.latitude + BRANCH.geofenceRadiusMeters / metresPerDegreeAtEquator,
    longitude: BRANCH.longitude,
    accuracyMeters: 10,
  });

  assert.ok(boundary.distanceFromBranchMeters !== null);
  assert.ok(Math.abs(boundary.distanceFromBranchMeters - 100) < 0.1);
  assert.equal(boundary.geofenceStatus, "INSIDE");
  assert.equal(boundary.insideGeofence, true);
});

test("geofence distinguishes outside, inaccurate and unavailable evidence", () => {
  const outside = evaluateAttendanceGeofence(BRANCH, {
    latitude: 1.56,
    longitude: BRANCH.longitude,
    accuracyMeters: 10,
  });
  assert.equal(outside.geofenceStatus, "OUTSIDE");
  assert.equal(outside.exceptionType, "OUTSIDE_GEOFENCE");

  const inaccurate = evaluateAttendanceGeofence(BRANCH, {
    latitude: BRANCH.latitude,
    longitude: BRANCH.longitude,
    accuracyMeters: 80.01,
  });
  assert.equal(inaccurate.geofenceStatus, "GPS_INACCURATE");
  assert.equal(inaccurate.insideGeofence, false);

  const unavailable = evaluateAttendanceGeofence(BRANCH, {});
  assert.equal(unavailable.geofenceStatus, "GPS_UNAVAILABLE");
  assert.equal(unavailable.distanceFromBranchMeters, null);
});

test("disabled geofence never rejects missing or outside GPS", () => {
  const disabled = { ...BRANCH, requireGeofence: false };
  const missing = evaluateAttendanceGeofence(disabled, {});
  const outside = evaluateAttendanceGeofence(disabled, {
    latitude: 10,
    longitude: 110,
    accuracyMeters: 999,
  });

  assert.equal(missing.geofenceStatus, "GEOFENCE_DISABLED");
  assert.equal(missing.exceptionType, null);
  assert.equal(outside.geofenceStatus, "GEOFENCE_DISABLED");
  assert.equal(outside.exceptionType, null);
  assert.ok(outside.distanceFromBranchMeters);
});

test("geofence rejects NaN, Infinity and invalid ranges", () => {
  for (const evidence of [
    { latitude: Number.NaN, longitude: 1, accuracyMeters: 1 },
    { latitude: 1, longitude: Number.POSITIVE_INFINITY, accuracyMeters: 1 },
    { latitude: 91, longitude: 1, accuracyMeters: 1 },
    { latitude: 1, longitude: 181, accuracyMeters: 1 },
    { latitude: 1, longitude: 1, accuracyMeters: 0 },
  ]) {
    assert.throws(() => evaluateAttendanceGeofence(BRANCH, evidence));
  }
});
