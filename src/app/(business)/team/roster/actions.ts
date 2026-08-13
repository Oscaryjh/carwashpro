"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";
import {
  copyPreviousRosterWeek,
  bulkUpsertRosterAssignments,
  publishRoster,
  removeRosterAssignment,
  upsertRosterAssignment,
  type RosterServiceContext,
} from "@/lib/roster/service";

export async function bulkRosterAssignmentAction(formData: FormData) {
  const returnTo = rosterReturnTo(formData);
  try {
    const context = await rosterWriteContext("EDIT_ROSTER");
    const branchId = text(formData, "branchId");
    const branch = await prisma.branch.findFirst({ where: { id: branchId, businessId: context.businessId }, select: { attendanceSetting: { select: { timezone: true } }, business: { select: { timezone: true } } } });
    if (!branch) throw new Error("Select an authorised branch.");
    const timezone = branch.attendanceSetting?.timezone ?? branch.business.timezone;
    const kind = text(formData, "kind") as "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
    const workDateText = dateText(formData, "workDate");
    const startText = text(formData, "startTime");
    const endText = text(formData, "endTime");
    const startAt = kind === "WORK_SHIFT" ? parseBranchLocalDateTime(`${workDateText}T${startText}`, timezone) : null;
    const endAt = kind === "WORK_SHIFT" ? parseBranchLocalDateTime(`${endText <= startText ? nextDateValue(workDateText) : workDateText}T${endText}`, timezone) : null;
    const membershipIds = formData.getAll("membershipIds").map(String).filter(Boolean);
    await bulkUpsertRosterAssignments({
      context,
      input: {
        branchId,
        weekStart: utcDate(text(formData, "weekStart")),
        expectedDraftRevision: number(formData, "expectedDraftRevision"),
        assignments: membershipIds.map((membershipId) => ({ membershipId, workDate: utcDate(workDateText), kind, startAt, endAt, breakMinutes: kind === "WORK_SHIFT" ? number(formData, "breakMinutes") : 0, note: text(formData, "note") || null })),
      },
    });
    done(returnTo, `${membershipIds.length} Draft assignments saved atomically.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(returnTo, message(error), "error");
  }
}

export async function saveRosterAssignmentAction(formData: FormData) {
  const returnTo = rosterReturnTo(formData);
  try {
    const context = await rosterWriteContext("EDIT_ROSTER");
    const branchId = text(formData, "branchId");
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, businessId: context.businessId },
      select: { attendanceSetting: { select: { timezone: true } }, business: { select: { timezone: true } } },
    });
    if (!branch) throw new Error("Select an authorised branch.");
    const timezone = branch.attendanceSetting?.timezone ?? branch.business.timezone;
    const kind = text(formData, "kind") as "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
    const workDateText = dateText(formData, "workDate");
    const startText = text(formData, "startTime");
    const endText = text(formData, "endTime");
    let startAt: Date | null = null;
    let endAt: Date | null = null;
    if (kind === "WORK_SHIFT") {
      startAt = parseBranchLocalDateTime(`${workDateText}T${startText}`, timezone);
      const overnight = endText <= startText;
      const endDate = overnight ? nextDateValue(workDateText) : workDateText;
      endAt = parseBranchLocalDateTime(`${endDate}T${endText}`, timezone);
    }
    await upsertRosterAssignment({
      context,
      input: {
        branchId,
        weekStart: utcDate(text(formData, "weekStart")),
        expectedDraftRevision: number(formData, "expectedDraftRevision"),
        membershipId: text(formData, "membershipId"),
        workDate: utcDate(workDateText),
        kind,
        startAt,
        endAt,
        breakMinutes: kind === "WORK_SHIFT" ? number(formData, "breakMinutes") : 0,
        note: text(formData, "note") || null,
      },
    });
    done(returnTo, "Roster draft assignment saved. Draft has no Attendance effect.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(returnTo, message(error), "error");
  }
}

export async function removeRosterAssignmentAction(formData: FormData) {
  const returnTo = rosterReturnTo(formData);
  try {
    const context = await rosterWriteContext("EDIT_ROSTER");
    await removeRosterAssignment({
      context,
      assignmentId: text(formData, "assignmentId"),
      expectedDraftRevision: number(formData, "expectedDraftRevision"),
    });
    done(returnTo, "Assignment removed from Draft. Published history remains unchanged.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(returnTo, message(error), "error");
  }
}

export async function copyPreviousRosterWeekAction(formData: FormData) {
  const returnTo = rosterReturnTo(formData);
  try {
    const context = await rosterWriteContext("CREATE_ROSTER");
    await copyPreviousRosterWeek({
      context,
      branchId: text(formData, "branchId"),
      targetWeekStart: utcDate(text(formData, "weekStart")),
    });
    done(returnTo, "Previous published week copied into Draft. Staff and Attendance are unchanged until Publish.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(returnTo, message(error), "error");
  }
}

export async function publishRosterAction(formData: FormData) {
  const returnTo = rosterReturnTo(formData);
  try {
    const context = await rosterWriteContext("PUBLISH_ROSTER");
    const result = await publishRoster({
      context,
      input: {
        rosterPeriodId: text(formData, "rosterPeriodId"),
        expectedDraftRevision: number(formData, "expectedDraftRevision"),
        operationKey: text(formData, "operationKey") || `roster-publish-${randomUUID()}`,
        reason: text(formData, "reason") || null,
      },
    });
    done(returnTo, result.idempotent ? "This Publish command was already completed safely." : `Roster revision ${result.publication.revision} published.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(returnTo, message(error), "error");
  }
}

async function rosterWriteContext(capability: BusinessCapability): Promise<RosterServiceContext> {
  const { access, user, businessId } = await requireBusinessUser(capability);
  const [scope, request] = await Promise.all([resolveAttendanceScope(access), getAuditRequestContext()]);
  return {
    businessId,
    allowedBranchIds: scope.allowedBranchIds,
    actor: user,
    request,
    canAmendPublished: hasBusinessCapability(access, "AMEND_PUBLISHED_ROSTER"),
    canManageRetrospective: hasBusinessCapability(access, "MANAGE_RETROSPECTIVE_ROSTER"),
  };
}

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function number(formData: FormData, key: string) {
  const value = Number(text(formData, key));
  if (!Number.isInteger(value) || value < 0) throw new Error(`Enter a valid ${key}.`);
  return value;
}
function dateText(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Select a valid roster date.");
  return value;
}
function utcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Select a valid roster date.");
  return new Date(`${value}T00:00:00.000Z`);
}
function nextDateValue(value: string) {
  const result = utcDate(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString().slice(0, 10);
}
function rosterReturnTo(formData: FormData) {
  const value = text(formData, "returnTo");
  return value.startsWith("/team/roster") ? value : "/team/roster";
}
function done(returnTo: string, messageText: string, type: "success" | "error" = "success"): never {
  revalidatePath("/team/roster");
  revalidatePath("/staff/roster");
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}type=${type}&message=${encodeURIComponent(messageText)}`);
}
function message(error: unknown) { return error instanceof Error ? error.message : "Unable to update roster."; }
