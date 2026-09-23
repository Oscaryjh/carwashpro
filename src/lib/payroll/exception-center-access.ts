import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export type PayrollExceptionCenterAccess = {
  canEditAttendance: boolean;
  canEditCompensation: boolean;
  canEditStatutory: boolean;
  canEditTax: boolean;
  canEditLeave: boolean;
  canViewAttendance: boolean;
  canViewPayroll: boolean;
  canViewStatutory: boolean;
  canViewTax: boolean;
  canViewLeave: boolean;
  granted: boolean;
};

export function resolvePayrollExceptionCenterCapabilities(
  access: ResolvedBusinessAccess,
  businessId: string,
): PayrollExceptionCenterAccess {
  const validBusiness = access.granted &&
    access.source !== "PLATFORM_ADMIN" &&
    access.effectiveBusinessRole !== "PLATFORM_ADMIN" &&
    access.businessId === businessId;
  const canViewTeam = validBusiness && hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const canViewAttendance = canViewTeam && hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canViewPayroll = canViewTeam && (
    hasBusinessCapability(access, "VIEW_PAYROLL_RUN") ||
    hasBusinessCapability(access, "VIEW_COMPENSATION")
  );
  const canViewStatutory = canViewTeam && hasBusinessCapability(access, "VIEW_STATUTORY_PROFILE");
  const canViewTax = canViewTeam && hasBusinessCapability(access, "VIEW_TAX_PROFILE");
  const canViewLeave = canViewTeam && hasBusinessCapability(access, "VIEW_LEAVE");
  return {
    canEditAttendance: canViewAttendance && hasBusinessCapability(access, "MODIFY_ATTENDANCE_EMPLOYEES"),
    canEditCompensation: canViewPayroll && hasBusinessCapability(access, "EDIT_COMPENSATION"),
    canEditStatutory: canViewStatutory && hasBusinessCapability(access, "EDIT_STATUTORY_PROFILE"),
    canEditTax: canViewTax && hasBusinessCapability(access, "EDIT_TAX_PROFILE"),
    canEditLeave: canViewLeave && hasBusinessCapability(access, "APPROVE_LEAVE"),
    canViewAttendance,
    canViewPayroll,
    canViewStatutory,
    canViewTax,
    canViewLeave,
    granted: Boolean(canViewAttendance || canViewPayroll || canViewStatutory || canViewTax || canViewLeave),
  };
}

export function canViewPayrollExceptionCenter(access: ResolvedBusinessAccess, businessId: string) {
  return resolvePayrollExceptionCenterCapabilities(access, businessId).granted;
}
