import type { Prisma } from "@prisma/client";
import type { AuditRequestContext, WriteAuditLogInput } from "@/lib/audit";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";

export type PayrollProfileWriteActor = NonNullable<WriteAuditLogInput["actor"]>;

export type PayrollProfileWriteCaller =
  | "TEAM_ACTION"
  | "EMPLOYEE_ACTION"
  | "PAYROLL_ACTION"
  | "STATUTORY_ACTION"
  | "API"
  | "AI_AGENT"
  | "SYSTEM";

export type PayrollProfileWriteContext = {
  access: ResolvedBusinessAccess;
  actor: PayrollProfileWriteActor;
  allowedBranchIds: readonly string[];
  businessId: string;
  caller: PayrollProfileWriteCaller;
  request?: AuditRequestContext;
};

export type PayrollProfileDraftImpact = {
  artifactCount: number;
  draftCount: number;
  finalizedCount: number;
  reviewCount: number;
};

export type CanonicalCommandResult = Prisma.JsonObject & {
  commandReplay: boolean;
  status: "SUCCESS";
};

export type CanonicalCommandErrorCode =
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "DUPLICATE_COMMAND"
  | "NO_APPLICABLE_VERSION"
  | "IMMUTABLE_HISTORY"
  | "AUDIT_FAILED"
  | "INTERNAL_ERROR";

export class PayrollProfileWriteError extends Error {
  constructor(
    readonly code: CanonicalCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayrollProfileWriteError";
  }
}
