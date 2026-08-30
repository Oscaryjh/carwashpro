import type {
  AttendanceExceptionType,
  AttendanceGeofenceStatus,
} from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";

const EARTH_RADIUS_METERS = 6_371_008.8;
const GEOFENCE_BOUNDARY_EPSILON_METERS = 0.000_001;

export type GeoPoint = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type AttendanceGpsEvidence = Readonly<{
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
}>;

export type AttendanceGeofenceSettings = GeoPoint &
  Readonly<{
    geofenceRadiusMeters: number;
    minimumAccuracyMeters: number;
    requireGeofence: boolean;
  }>;

export type GeofenceEvaluation = Readonly<{
  geofenceStatus: AttendanceGeofenceStatus;
  insideGeofence: boolean;
  distanceFromBranchMeters: number | null;
  exceptionType: AttendanceExceptionType | null;
}>;

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function assertValidGeoPoint(
  point: GeoPoint,
  label = "GPS",
): void {
  if (
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      `${label} latitude must be between -90 and 90.`,
    );
  }
  if (
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      `${label} longitude must be between -180 and 180.`,
    );
  }
}

export function haversineDistanceMeters(
  first: GeoPoint,
  second: GeoPoint,
): number {
  assertValidGeoPoint(first);
  assertValidGeoPoint(second);

  const latitudeDelta = degreesToRadians(
    second.latitude - first.latitude,
  );
  const longitudeDelta = degreesToRadians(
    second.longitude - first.longitude,
  );
  const firstLatitude = degreesToRadians(first.latitude);
  const secondLatitude = degreesToRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const angularDistance =
    2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_METERS * angularDistance;
}

export function evaluateAttendanceGeofence(
  settings: AttendanceGeofenceSettings,
  evidence: AttendanceGpsEvidence,
): GeofenceEvaluation {
  assertValidGeoPoint(settings, "Branch");
  if (
    !Number.isFinite(settings.geofenceRadiusMeters) ||
    settings.geofenceRadiusMeters <= 0 ||
    !Number.isFinite(settings.minimumAccuracyMeters) ||
    settings.minimumAccuracyMeters <= 0
  ) {
    throw new AttendanceApiError(
      "INTERNAL_ERROR",
      "Branch attendance geofence settings are invalid.",
    );
  }

  const hasCoordinates =
    evidence.latitude !== null &&
    evidence.latitude !== undefined &&
    evidence.longitude !== null &&
    evidence.longitude !== undefined;
  const hasAccuracy =
    evidence.accuracyMeters !== null &&
    evidence.accuracyMeters !== undefined;

  if (!hasCoordinates || !hasAccuracy) {
    return {
      geofenceStatus: settings.requireGeofence
        ? "GPS_UNAVAILABLE"
        : "GEOFENCE_DISABLED",
      insideGeofence: false,
      distanceFromBranchMeters: null,
      exceptionType: settings.requireGeofence ? "GPS_UNAVAILABLE" : null,
    };
  }

  const employeePoint = {
    latitude: evidence.latitude,
    longitude: evidence.longitude,
  };
  assertValidGeoPoint(employeePoint);
  if (
    !Number.isFinite(evidence.accuracyMeters) ||
    evidence.accuracyMeters <= 0
  ) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "GPS accuracy must be a finite positive number.",
    );
  }

  const distanceFromBranchMeters = haversineDistanceMeters(
    settings,
    employeePoint,
  );

  if (!settings.requireGeofence) {
    return {
      geofenceStatus: "GEOFENCE_DISABLED",
      insideGeofence: false,
      distanceFromBranchMeters,
      exceptionType: null,
    };
  }

  if (evidence.accuracyMeters > settings.minimumAccuracyMeters) {
    return {
      geofenceStatus: "GPS_INACCURATE",
      insideGeofence: false,
      distanceFromBranchMeters,
      exceptionType: "GPS_INACCURATE",
    };
  }

  if (
    distanceFromBranchMeters <=
    settings.geofenceRadiusMeters + GEOFENCE_BOUNDARY_EPSILON_METERS
  ) {
    return {
      geofenceStatus: "INSIDE",
      insideGeofence: true,
      distanceFromBranchMeters,
      exceptionType: null,
    };
  }

  return {
    geofenceStatus: "OUTSIDE",
    insideGeofence: false,
    distanceFromBranchMeters,
    exceptionType: "OUTSIDE_GEOFENCE",
  };
}
