import { formatHrCalendarMonth } from "@/lib/hr-calendar-month";

export const peopleFilters = [
  ["all", "All employees"],
  ["ready", "Ready"],
  ["attention", "Needs attention"],
  ["inactive", "Inactive"],
] as const;
export type PeopleFilter = (typeof peopleFilters)[number][0];
export type TestAccountFilter = "hide" | "show";
export type PeopleContext = {
  filter?: string; branch?: string; position?: string; q?: string; month?: string;
  page?: string; testAccounts?: string; fromHrHome?: string; homeMonth?: string;
};
export function peopleFilter(value?: string): PeopleFilter {
  if (value === "needs-setup") return "attention";
  return peopleFilters.find(([key]) => key === value)?.[0] ?? "all";
}
export function testAccountFilter(value?: string): TestAccountFilter { return value === "show" ? "show" : "hide"; }
export function peopleMonth(value: string | undefined, fallback: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "") ? value! : fallback;
}
export function peoplePage(value?: string) { return /^\d+$/.test(value ?? "") ? Math.max(1, Number(value)) : 1; }
export function peopleListPath(input: PeopleContext = {}) {
  const query = new URLSearchParams({ section: "people" });
  const filter = peopleFilter(input.filter);
  if (filter !== "all") query.set("filter", filter);
  if (input.branch && /^[a-f0-9-]{36}$/i.test(input.branch)) query.set("branch", input.branch);
  if (input.position?.trim()) query.set("position", input.position.trim().slice(0, 80));
  if (input.q?.trim()) query.set("q", input.q.trim().slice(0, 120));
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month ?? "")) query.set("month", input.month!);
  if (peoplePage(input.page) > 1) query.set("page", String(peoplePage(input.page)));
  if (testAccountFilter(input.testAccounts) === "show") query.set("testAccounts", "show");
  if (input.fromHrHome === "1" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.homeMonth ?? "")) {
    query.set("fromHrHome", "1"); query.set("homeMonth", input.homeMonth!);
  }
  return `/team?${query}`;
}
export function employeeDirectoryDetailPath(input: {
  canManageAttendanceEmployees: boolean;
  canViewTeamDirectory: boolean;
  employeeId: string;
}) {
  if (input.canViewTeamDirectory) {
    return `/team/people/${input.employeeId}`;
  }
  if (input.canManageAttendanceEmployees) {
    return `/team/employees/${input.employeeId}`;
  }
  return null;
}
/** Accept only allowlisted HR list contexts; never accept an arbitrary redirect destination. */
export function safePeopleReturn(value?: string) {
  if (!value || !value.startsWith("/team") || /[\\\r\n]/.test(value)) return null;
  const url = new URL(value, "https://internal.invalid");
  if (url.pathname === "/team" && url.searchParams.get("section") === "people") return peopleListPath(Object.fromEntries(url.searchParams));
  if (url.pathname !== "/team/payroll/exceptions") return null;
  const output = new URLSearchParams();
  const month = url.searchParams.get("month"), branch = url.searchParams.get("branch");
  const impact = url.searchParams.get("impact"), area = url.searchParams.get("area");
  const search = url.searchParams.get("search")?.trim(), page = url.searchParams.get("page");
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) output.set("month", month);
  if (branch && /^[a-f0-9-]{36}$/i.test(branch)) output.set("branch", branch);
  if (impact && ["blocking", "review", "setup", "ready"].includes(impact)) output.set("impact", impact);
  if (area && ["employment", "attendance", "overtime", "timesheet", "pay-setup", "tax", "statutory"].includes(area)) output.set("area", area);
  if (search) output.set("search", search.slice(0, 120));
  if (url.searchParams.get("showReady") === "1") output.set("showReady", "1");
  if (page && /^\d+$/.test(page) && Number(page) > 0) output.set("page", String(Number(page)));
  return `/team/payroll/exceptions${output.size ? `?${output}` : ""}`;
}
export function employeeContextHref(href: string, context: Record<string, string | undefined>) {
  if (!href.startsWith("/team/people/") || /[\\\r\n]/.test(href)) return href;
  const url = new URL(href, "https://internal.invalid"), back = safePeopleReturn(context.peopleReturn);
  if (back) url.searchParams.set("peopleReturn", back);
  for (const key of ["payrollRunId", "payrollReturnPath", "fromHrHome", "homeMonth"] as const) if (context[key]) url.searchParams.set(key, context[key]!);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function safeEmployeeProfileReturn(value?: string, personId?: string) {
  if (!value || /[\\\r\n]/.test(value) || !/^\/team\/people\/[a-f0-9-]{36}\?/i.test(value)) return null;
  const url = new URL(value,"https://internal.invalid");
  if (personId && url.pathname !== `/team/people/${personId}`) return null;
  return employeeContextHref(`${url.pathname}?section=overview`,Object.fromEntries(url.searchParams));
}

export type SetupIssue = { code?: string; severity: string; message: string };
export function employeeSubmissionIssues(issues: readonly SetupIssue[]) {
  return issues.filter(issue => issue.code === "STATUTORY_PROFILE_INCOMPLETE" || /statutory.*profile.*incomplete|submission|filing/i.test(issue.message));
}
export function employeeIssueCopy(issue: SetupIssue, month: string) {
  const label = formatHrCalendarMonth(month);
  const scheme = issue.message.match(/\b(EPF|SOCSO|EIS|PCB|LINDUNG24)\b/i)?.[0]?.toUpperCase();
  if (/STATUTORY_PARTICIPATION|participation.*(missing|gap|cover|overlap)/i.test(issue.message)) return `${scheme ?? "Statutory"} setup needs review for ${label}.`;
  if (/BANK|bank/i.test(`${issue.code} ${issue.message}`)) return /UNVERIFIED|not verified/i.test(`${issue.code} ${issue.message}`) ? "Bank details need verification before payment. This does not block payroll calculation." : "Bank account missing. Required before payment, not payroll calculation.";
  if (issue.code === "STATUTORY_PROFILE_INCOMPLETE" || /statutory.*profile.*incomplete/i.test(issue.message)) return "Submission details need review before statutory filing; payroll calculation is separate.";
  if (/RULE_NOT_AVAILABLE|rule.*(not available|missing)/i.test(`${issue.code} ${issue.message}`)) return `${scheme ?? "Payroll"} rules need platform administrator review for ${label}.`;
  return issue.message.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, "requires review").replace(/:\s*requires review\.?/g, ".");
}

export type PeopleIssueCategory = "PROFILE" | "ATTENDANCE" | "PAYROLL";
export type PeopleIssue = { category: PeopleIssueCategory; code: string; message: string };
export type PeopleReadiness = "READY" | "ATTENTION" | "INACTIVE" | "ONBOARDING" | "UNKNOWN";
export type PeopleEmployee = {
  id:string; avatarUrl:string|null; fullName:string; employeeCode:string; phone:string; email:string|null;
  position:string|null; status:string; joinedAt:Date; terminatedAt:Date|null; isTestAccount:boolean;
  branches:{id:string;name:string;isPrimary?:boolean}[]; issues:PeopleIssue[]; readiness:PeopleReadiness;
  attendanceChecked:boolean; payrollChecked:boolean;
};
export function rowMatchesNonStatusFilters(row: PeopleEmployee, input: PeopleContext) {
  const q = input.q?.trim().toLocaleLowerCase("en") ?? "";
  return (testAccountFilter(input.testAccounts) === "show" || !row.isTestAccount) &&
    (!input.branch || row.branches.some(branch => branch.id === input.branch)) &&
    (!input.position || row.position === input.position) &&
    (!q || [row.fullName,row.employeeCode,row.phone,row.email??"",row.position??"",...row.branches.map(branch=>branch.name)].some(value=>value.toLocaleLowerCase("en").includes(q)));
}
export function rowMatchesPeopleFilter(row: PeopleEmployee, filter: PeopleFilter) {
  return filter === "all" || (filter === "ready" && row.readiness === "READY") ||
    (filter === "attention" && ["ATTENTION","UNKNOWN","ONBOARDING"].includes(row.readiness)) ||
    (filter === "inactive" && row.readiness === "INACTIVE");
}
export function filterPeople(rows: readonly PeopleEmployee[], input: PeopleContext) {
  const filter = peopleFilter(input.filter);
  return rows.filter(row => rowMatchesNonStatusFilters(row,input) && rowMatchesPeopleFilter(row,filter));
}
export function peopleEmptyCopy(total:number,input:PeopleContext) {
  if (!total) return "No employee records are available in your authorized scope.";
  if (peopleFilter(input.filter)==="ready") return "No employees are ready in the checked scope for this period.";
  if (peopleFilter(input.filter)==="attention") return "No employees need attention in the checked scope for this period.";
  return "No employees match these filters. Try another status, branch, position or search.";
}
export function employeeCount(count:number){return `${count} employee${count===1?"":"s"}`;}
