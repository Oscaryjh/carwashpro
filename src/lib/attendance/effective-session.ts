/** Read projection only: raw punches and immutable final versions stay untouched. */
export function effectiveAttendanceSession<T extends {
  id: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  status: string;
  resolutionCase: {
    status: string;
    currentFinalResult: {
      attendanceSessionId: string;
      source: string;
      disposition: string;
      clockInAt: Date | null;
      clockOutAt: Date | null;
      totalBreakMinutes: number;
      totalWorkedMinutes: number;
    } | null;
  } | null;
}>(session: T): T {
  const result = session.resolutionCase?.currentFinalResult;
  if (session.resolutionCase?.status !== "RESOLVED" ||
      !result || result.attendanceSessionId !== session.id ||
      result.source !== "CORRECTION" || result.disposition !== "INCLUDED" ||
      !result.clockInAt || !result.clockOutAt || result.clockOutAt <= result.clockInAt) return session;
  return {
    ...session,
    clockInAt: result.clockInAt,
    clockOutAt: result.clockOutAt,
    totalBreakMinutes: result.totalBreakMinutes,
    totalWorkedMinutes: result.totalWorkedMinutes,
    status: "COMPLETED",
  };
}
