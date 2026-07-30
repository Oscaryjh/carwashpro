export type StaffApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type EmployeeProfile = {
  employee: {
    fullName: string;
    employeeCode: string;
    position: string | null;
    employmentType: string;
  };
  workplace: {
    businessName: string;
    primaryBranchName: string;
  };
  capabilities: {
    canView: boolean;
    canPunch: boolean;
  };
  device: {
    displayName: string | null;
    platform: string | null;
    browser: string | null;
    firstVerifiedAt: string;
    lastActiveAt: string;
    status: "ACTIVE" | "REVOKED" | "REPLACED";
  };
};

export type EmployeeMembershipChoice = {
  membershipId: string;
  businessName: string;
  employeeCode: string;
  primaryBranchName: string;
};

export type EmployeeAuthFlow = {
  challengeId: string;
  deviceIdentifier: string;
  expiresAt: number;
  phoneNumber: string;
  phoneMasked: string;
  resendAt: number;
  selectionToken?: string;
  memberships?: EmployeeMembershipChoice[];
};

export type AttendanceAction =
  | "CLOCK_IN"
  | "BREAK_START"
  | "BREAK_END"
  | "CLOCK_OUT";

export type AttendanceToday = {
  employee: {
    employeeCode: string;
    fullName: string;
  };
  business: {
    id: string;
    name: string;
  };
  branch: {
    id: string;
    name: string;
  };
  attendanceEnabled: boolean;
  sessionCount: number;
  completedSessionCount: number;
  currentSession: {
    id: string;
    workDate: string;
    status: "OPEN" | "ON_BREAK" | "COMPLETED" | "INCOMPLETE" | "CANCELLED";
    clockInAt: string;
    clockOutAt: string | null;
    requiresApproval: boolean;
    approvalStatus:
      | "NOT_REQUIRED"
      | "PENDING"
      | "APPROVED"
      | "REJECTED";
  } | null;
  status: "OPEN" | "ON_BREAK" | "COMPLETED" | null;
  clockInAt: string | null;
  breakStartedAt: string | null;
  totalCompletedBreakMinutes: number;
  currentWorkedMinutes: number;
  geofenceRequirements: {
    requireGeofence: boolean;
    geofenceRadiusMeters: number;
    maximumAcceptedGpsErrorMeters: number;
    allowOutsideGeofenceRequest: boolean;
    requirePhoto: boolean;
    timezone: string;
  };
  allowedActions: AttendanceAction[];
  pendingExceptions: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
  }>;
  serverTime: string;
  branchLocalTime: string;
};

export type AttendancePunchResult = {
  attendanceSessionId: string;
  attendancePunchId: string;
  punchType: AttendanceAction;
  resultingStatus: "OPEN" | "ON_BREAK" | "COMPLETED";
  serverTimestamp: string;
  workDate: string;
  geofenceStatus:
    | "INSIDE"
    | "OUTSIDE"
    | "GPS_INACCURATE"
    | "GPS_UNAVAILABLE"
    | "GEOFENCE_DISABLED";
  insideGeofence: boolean;
  distanceFromBranchMeters: number | null;
  requiresApproval: boolean;
  exceptionId: string | null;
  totalBreakMinutes: number | null;
  totalWorkedMinutes: number | null;
  replayed: boolean;
};

export type AttendanceHistoryItem = {
  id: string;
  workDate: string;
  branch: {
    id: string;
    name: string;
  };
  clockInAt: string;
  clockOutAt: string | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  status: string;
  geofenceStatus: string | null;
  geofenceEvidence: Array<{
    punchId: string;
    type: AttendanceAction;
    serverTimestamp: string;
    geofenceStatus: string;
    insideGeofence: boolean;
  }>;
  approvalStatus: string;
  requiresApproval: boolean;
  adjusted: boolean;
};

export type AttendanceHistory = {
  items: AttendanceHistoryItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  range: {
    from: string;
    to: string;
    maximumDays: number;
  };
  serverTime: string;
};
