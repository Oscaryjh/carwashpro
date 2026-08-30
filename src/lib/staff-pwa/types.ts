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
    avatarUrl: string | null;
    employeeCode: string;
    position: string | null;
    employmentType: string;
    employmentStatus: string;
    joinedAt: string;
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

export type EmployeeWorkplaceChoice = {
  membershipId: string;
  businessName: string;
  employeeCode: string;
  primaryBranchName: string;
  current: boolean;
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
  availableBranches: Array<{
    id: string;
    name: string;
  }>;
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
  lastBreakEndedAt: string | null;
  totalCompletedBreakMinutes: number;
  currentWorkedMinutes: number;
  geofenceRequirements: {
    requireGeofence: boolean;
    geofenceRadiusMeters: number;
    maximumAcceptedGpsErrorMeters: number;
    allowOutsideGeofenceRequest: boolean;
    timezone: string;
  };
  workPolicy: {
    breakPolicy:
      | "MANUAL_PUNCH"
      | "FLEXIBLE_CONFIRMATION"
      | "PAID_BREAK";
    expectedBreakMinutes: number;
    expectedBreakSource:
      | "SESSION_SNAPSHOT"
      | "PUBLISHED_ROSTER"
      | "EMPLOYEE_PROFILE"
      | "BRANCH_POLICY";
    normalWorkMinutesPerDay: number;
    normalWorkMinutesSource:
      | "PUBLISHED_ROSTER"
      | "EMPLOYEE_PROFILE"
      | "BRANCH_POLICY";
  };
  expectedAttendance: {
    kind: "WORKDAY" | "NOT_SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY";
    source: string;
    expectedStartAt: string | null;
    expectedEndAt: string | null;
    graceMinutes: number;
    timezone: string;
    revision: number;
  } | null;
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

export type AttendanceResolutionCase = {
  id: string;
  status: "OPEN" | "UNDER_REVIEW" | "RETURNED_FOR_CORRECTION";
  openedReason: string;
  openedAt: string;
  updatedAt: string;
  workDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  totalBreakMinutes: number;
  canCancel: boolean;
  cancelDeadlineAt: string | null;
  branch: { name: string; timezone: string };
  latestEvent: {
    type: string;
    reason: string;
    createdAt: string;
  } | null;
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
  availableBranches: Array<{
    id: string;
    name: string;
  }>;
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
