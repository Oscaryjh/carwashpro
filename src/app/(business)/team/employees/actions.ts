"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import {
  createAttendanceEmployee,
  updateAttendanceEmployee,
} from "@/lib/attendance/employee-service";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export type AttendanceEmployeeActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialAttendanceEmployeeActionState: AttendanceEmployeeActionState = {
  status: "idle",
  message: "",
};

export async function createAttendanceEmployeeAction(
  _previousState: AttendanceEmployeeActionState,
  formData: FormData,
): Promise<AttendanceEmployeeActionState> {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_EMPLOYEES",
    );
    const scope = await resolveAttendanceScope(access);
    const request = await getAuditRequestContext();
    const input = buildEmployeeInput(formData, businessId);
    const membership = await createAttendanceEmployee({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request,
      wholeBusinessScope: hasWholeBusinessEmployeeScope(access),
      input,
    });

    revalidateEmployeePaths(membership.id);
    redirect(
      `/team/employees/${membership.id}?type=success&message=${encodeURIComponent(
        "Employee created successfully.",
      )}`,
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return toActionError(error, "Unable to create employee.");
  }
}

export async function updateAttendanceEmployeeAction(
  _previousState: AttendanceEmployeeActionState,
  formData: FormData,
): Promise<AttendanceEmployeeActionState> {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_EMPLOYEES",
    );
    const scope = await resolveAttendanceScope(access);
    const now = new Date();
    const employeeId = String(formData.get("employeeId") ?? "").trim();
    const existing = await prisma.employeeBusinessMembership.findFirst({
      where: {
        id: employeeId,
        businessId,
        ...(hasWholeBusinessEmployeeScope(access)
          ? {}
          : {
              branchAssignments: {
                some: {
                  businessId,
                  branchId: { in: [...scope.allowedBranchIds] },
                  status: "ACTIVE",
                  effectiveFrom: { lte: now },
                  OR: [
                    { effectiveUntil: null },
                    {
                      effectiveUntil: {
                        gte: now,
                      },
                    },
                  ],
                },
              },
            }),
      },
      select: {
        id: true,
        status: true,
        payBasis: true,
        baseSalary: true,
      },
    });

    if (!existing) {
      throw new Error("Employee is outside your authorized scope.");
    }
    const input = {
      ...buildEmployeeInput(formData, businessId, true),
      payBasis: existing.payBasis,
      baseSalary:
        existing.baseSalary === null ? null : Number(existing.baseSalary),
    };

    if (
      existing.status === "TERMINATED" &&
      input.status === "ACTIVE" &&
      formData.get("reactivationConfirmed") !== "yes"
    ) {
      throw new Error(
        "Confirm reactivation before restoring a terminated employee.",
      );
    }

    const request = await getAuditRequestContext();
    const membership = await updateAttendanceEmployee({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      expectedUpdatedAt: String(
        formData.get("expectedUpdatedAt") ?? "",
      ),
      actor: user,
      request,
      wholeBusinessScope: hasWholeBusinessEmployeeScope(access),
      input: {
        ...input,
        employeeId,
      },
    });

    revalidateEmployeePaths(membership.id);
    redirect(
      `/team/employees/${membership.id}?type=success&message=${encodeURIComponent(
        "Employee updated successfully.",
      )}`,
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return toActionError(error, "Unable to update employee.");
  }
}

function buildEmployeeInput(
  formData: FormData,
  businessId: string,
  editing = false,
) {
  const status = String(formData.get("status") ?? "ACTIVE");
  const primaryBranchId = String(
    formData.get("primaryBranchId") ?? "",
  ).trim();
  const selectedBranchIds = uniqueStrings(formData.getAll("branchIds"));
  const canClockInBranchIds = new Set(
    uniqueStrings(formData.getAll("canClockInBranchIds")),
  );

  if (status !== "TERMINATED") {
    if (!primaryBranchId || !selectedBranchIds.includes(primaryBranchId)) {
      throw new Error(
        "Primary branch must be included in the employee branch assignments.",
      );
    }
  }

  const terminatedAt =
    status === "TERMINATED"
      ? String(formData.get("terminatedAt") ?? "").trim()
      : null;
  const attendanceEnabled =
    status === "ACTIVE" && formData.get("attendanceEnabled") === "on";
  const assignments =
    status === "TERMINATED"
      ? []
      : selectedBranchIds.map((branchId) => ({
          branchId,
          isPrimary: branchId === primaryBranchId,
          canClockIn:
            status === "ACTIVE" && canClockInBranchIds.has(branchId),
          effectiveFrom:
            String(
              formData.get(`assignmentEffectiveFrom__${branchId}`) ?? "",
            ).trim() || undefined,
          effectiveUntil:
            String(
              formData.get(`assignmentEffectiveUntil__${branchId}`) ?? "",
            ).trim() || null,
          status: "ACTIVE" as const,
        }));

  return {
    ...(editing
      ? { employeeId: String(formData.get("employeeId") ?? "").trim() }
      : {}),
    businessId,
    employeeCode: String(formData.get("employeeCode") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    phoneNumber: String(formData.get("phoneNumber") ?? ""),
    payBasis: "MONTHLY" as const,
    baseSalary: null,
    normalWorkMinutesPerDay: optionalNumber(
      formData.get("normalWorkMinutesPerDay"),
    ),
    targetBreakMinutes: optionalNumber(formData.get("targetBreakMinutes")),

    employmentType: String(formData.get("employmentType") ?? "FULL_TIME"),
    status,
    attendanceEnabled,
    joinedAt: String(formData.get("joinedAt") ?? ""),
    terminatedAt,
    position: null,
    assignments,
  };
}

function optionalNumber(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized === "" ? null : Number(normalized);
}

function uniqueStrings(values: FormDataEntryValue[]) {
  return Array.from(
    new Set(
      values
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function hasWholeBusinessEmployeeScope(
  access: Awaited<ReturnType<typeof requireBusinessUser>>["access"],
) {
  return (
    access.granted &&
    (access.effectiveBusinessRole === "BUSINESS_OWNER" ||
      access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
      access.permissions.includes("ALL_BRANCHES"))
  );
}

function revalidateEmployeePaths(employeeId: string) {
  revalidatePath("/team");
  revalidatePath("/team/employees");
  revalidatePath(`/team/employees/${employeeId}`);
}

function toActionError(
  error: unknown,
  fallback: string,
): AttendanceEmployeeActionState {
  if (error instanceof z.ZodError) {
    const flattened = error.flatten();
    return {
      status: "error",
      message: error.issues[0]?.message ?? fallback,
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return {
      status: "error",
      message:
        "Employee code or phone number is already used in this business.",
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      status: "error",
      message: "Employee details could not be saved safely.",
    };
  }

  return {
    status: "error",
    message: error instanceof Error ? error.message : fallback,
  };
}
