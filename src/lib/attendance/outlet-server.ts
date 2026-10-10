import "server-only";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { resolveBusinessOutletTopology } from "@/lib/outlet-context";
import { prisma } from "@/lib/prisma";
import { resolveAttendanceScope } from "./scope";
import { assertAttendanceOutletInput, attendanceOutletPresentation } from "./outlet-presentation";

/** Call after fresh request capability authorization. This adapter grants none. */
export async function resolveAttendanceOutletContext(access: ResolvedBusinessAccess, database = prisma) {
  const scope = await resolveAttendanceScope(access, database);
  const topology = await resolveBusinessOutletTopology(scope.businessId, database);
  return { ...attendanceOutletPresentation(topology, scope), scope };
}

export async function assertFreshAttendanceOutletInput(access: ResolvedBusinessAccess, data: FormData, database = prisma) {
  const context = await resolveAttendanceOutletContext(access, database);
  assertAttendanceOutletInput(context, data);
  return context;
}
