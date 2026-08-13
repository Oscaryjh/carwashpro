import type { Prisma } from "@prisma/client";
import type { AuditRequestContext, WriteAuditLogInput } from "@/lib/audit";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import type { PayrollHighRiskStepUp } from "@/lib/payroll/high-risk-mfa";

export type PayrollPaymentActor = NonNullable<WriteAuditLogInput["actor"]>;

export type PayrollPaymentContext = {
  access: ResolvedBusinessAccess;
  actor: PayrollPaymentActor;
  allowedBranchIds: readonly string[];
  businessId: string;
  request?: AuditRequestContext;
  stepUp?: PayrollHighRiskStepUp;
};

export type PayrollPaymentCommandResult = Prisma.JsonObject & {
  commandReplay: boolean;
  status: "SUCCESS";
};

export type PayrollPaymentErrorCode =
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "DUPLICATE_COMMAND"
  | "IMMUTABLE_HISTORY"
  | "BLOCKED"
  | "INTERNAL_ERROR";

export class PayrollPaymentError extends Error {
  constructor(
    readonly code: PayrollPaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayrollPaymentError";
  }
}
