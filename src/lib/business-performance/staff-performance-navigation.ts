import { isStaffUserId, type StaffPerformanceSubject } from "./salon-attribution";

export type StaffPerformanceQuery = { range?: string; from?: string; to?: string; branchId?: string };
export function parseStaffPerformanceSubject(token: string): StaffPerformanceSubject | null {
  if (token === "unassigned") return { type: "unassigned" };
  return isStaffUserId(token) ? { type: "staff", userId: token } : null;
}
function search(query: StaffPerformanceQuery, page?: number) {
  const params = new URLSearchParams();
  for (const key of ["range", "from", "to", "branchId"] as const) {
    if (key === "branchId" && query[key] === "") continue;
    if (query[key] !== undefined) params.set(key, query[key]);
  }
  if (page !== undefined) params.set("page", String(page));
  return params.size ? `?${params}` : "";
}
export function staffPerformanceHref(token: string, query: StaffPerformanceQuery, page?: number) {
  return `/dashboard/staff/${encodeURIComponent(token)}${search(query, page)}`;
}
export function dashboardPerformanceHref(query: StaffPerformanceQuery) {
  return `/dashboard${search(query)}`;
}
