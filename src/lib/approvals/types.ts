import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export const approvalDomains = [
  "ATTENDANCE",
  "LEAVE",
  "CLAIMS",
  "COMMISSION",
  "PAYROLL",
] as const;

export type ApprovalDomain = (typeof approvalDomains)[number];
export type ActionCenterKind = "APPROVAL" | "TASK";
export type ApprovalInboxStatus = "PENDING" | "BLOCKED";
export type ApprovalPriority = "NORMAL" | "HIGH";

export type ApprovalInboxItem = Readonly<{
  id: string;
  kind: ActionCenterKind;
  domain: ApprovalDomain;
  businessId: string;
  branchId: string | null;
  branchName: string | null;
  subjectType: string;
  subjectId: string;
  employeeId: string | null;
  membershipId: string | null;
  employeeName: string | null;
  title: string;
  summary: string;
  requestedAt: Date;
  status: ApprovalInboxStatus;
  priority: ApprovalPriority;
  requestedBy: string | null;
  requestedByName: string | null;
  amount: number | null;
  units: number | null;
  requiredCapability: BusinessCapability;
  targetUrl: string;
  revision: number | string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ApprovalInboxFilters = Readonly<{
  kind?: ActionCenterKind;
  domain?: ApprovalDomain;
  domains?: readonly ApprovalDomain[];
  branchId?: string;
  employee?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}>;

export type ApprovalCounts = Readonly<Record<ApprovalDomain, number>> & {
  readonly total: number;
};

export type ActionCenterKindCounts = Readonly<Record<ActionCenterKind, number>> & {
  readonly total: number;
};

export type UnifiedApprovalInbox = Readonly<{
  items: readonly ApprovalInboxItem[];
  counts: ApprovalCounts;
  kindCounts: ActionCenterKindCounts;
  unavailableDomains: readonly ApprovalDomain[];
  pagination: Readonly<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>;
}>;
