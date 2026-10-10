import type { BusinessOutletTopology } from "@/lib/outlet-context";
import type { AttendanceScope } from "./scope";

export function attendanceOutletPresentation(topology: BusinessOutletTopology, scope: AttendanceScope) {
  const currentBranchId = topology.kind === "single_outlet" && scope.allowedBranchIds.includes(topology.internalBranchId)
    ? topology.internalBranchId : undefined;
  const allowedBranchIds = topology.kind === "legacy_multi_branch" ? scope.allowedBranchIds
    : currentBranchId ? [currentBranchId] : [];
  return { topology, currentScope: { ...scope, allowedBranchIds }, currentBranchId };
}

/** Current-operation wiring only. Never resolves or replaces a document's branch.
 * Existing capability and transactional authorization remain mandatory. */
export function assertAttendanceOutletInput(context: ReturnType<typeof attendanceOutletPresentation>, data: FormData) {
  const fail = () => { throw new Error("Attendance location changed or is not available. Reload and try again."); };
  const modes = data.getAll("attendanceOutletMode"), markers = data.getAll("attendanceOutletBranchId");
  const branches = data.getAll("branchId");
  // Document-only actions keep their original ID contract. The marker checks
  // the rendered topology, not the document's attribution or authorization.
  const branch = branches.length === 0 && modes.length ? markers[0] : branches[0];
  if (branches.length > 1 || typeof branch !== "string" || !context.currentScope.allowedBranchIds.includes(branch)) fail();
  if (!modes.length && !markers.length) return;
  if (modes.length !== 1 || modes[0] !== "single_outlet" || markers.length !== 1 ||
      context.topology.kind !== "single_outlet" || !context.currentBranchId ||
      markers[0] !== context.currentBranchId || branch !== context.currentBranchId) fail();
}
