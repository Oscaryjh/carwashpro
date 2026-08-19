import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { detectAttendanceP2DayAction, recordExpectedAttendanceAction } from "./actions";

type Props = { searchParams: Promise<{ type?: string; message?: string }> };

export default async function AttendanceP2WorkspacePage({ searchParams }: Props) {
  const { access, user, businessId } = await requireBusinessUser("VIEW_ATTENDANCE_EMPLOYEES");
  const [params, scope] = await Promise.all([searchParams, resolveAttendanceScope(access)]);
  const [branches, members, blockers] = await Promise.all([
    getOperationalBranches(businessId, user).then((items) => items.filter((item) => scope.allowedBranchIds.includes(item.id))),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId, status: "ACTIVE", branchAssignments: { some: { branchId: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" } } },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendanceP2Exception.findMany({
      where: { businessId, branchId: { in: [...scope.allowedBranchIds] }, status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] } },
      orderBy: [{ workDate: "asc" }, { detectedAt: "asc" }],
      take: 200,
    }),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return (
    <section className="content hr-module-page">
      <header className="page-header hr-module-header"><div><span className="hr-module-eyebrow">HR &amp; PAYROLL</span><h1>Attendance P2 Workspace</h1><p>Record expected-work evidence, detect ambiguity and send blockers to resolution.</p></div></header>
      {params.message ? <p role="status"><strong>{params.type === "error" ? "Error: " : ""}{params.message}</strong></p> : null}
      <div className="settings-grid">
        <form action={recordExpectedAttendanceAction} className="settings-card">
          <h2>Expected Attendance evidence</h2>
          <label>Employee<select name="membershipId" required>{members.map((item) => <option key={item.id} value={item.id}>{item.fullName} ({item.employeeCode})</option>)}</select></label>
          <label>Branch<select name="branchId" required>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Work date<input defaultValue={today} name="workDate" required type="date" /></label>
          <label>Day kind<select defaultValue="WORKDAY" name="kind"><option value="WORKDAY">Workday</option><option value="NOT_SCHEDULED">Not scheduled</option><option value="REST_DAY">Rest day</option><option value="PUBLIC_HOLIDAY">Public holiday</option></select></label>
          <label>Expected start (workday)<input defaultValue="09:00" name="expectedStartLocal" type="time" /></label>
          <label>Expected end (workday)<input defaultValue="18:00" name="expectedEndLocal" type="time" /></label>
          <label>Grace minutes<input defaultValue="0" max={240} min={0} name="graceMinutes" type="number" /></label>
          <label>Evidence reference<input maxLength={160} name="evidenceReference" placeholder="Roster or manager reference" /></label>
          <button type="submit">Record evidence and detect</button>
        </form>
        <form action={detectAttendanceP2DayAction} className="settings-card">
          <h2>Check one Attendance day</h2>
          <p>No schedule plus no punch becomes “No attendance recorded”, never no-show or unpaid Leave.</p>
          <label>Employee<select name="membershipId" required>{members.map((item) => <option key={item.id} value={item.id}>{item.fullName} ({item.employeeCode})</option>)}</select></label>
          <label>Work date<input defaultValue={today} name="workDate" required type="date" /></label>
          <button type="submit">Detect exceptions</button>
        </form>
      </div>
      <section><h2>Open P2 blockers ({blockers.length})</h2>{blockers.length ? <ul>{blockers.map((item) => <li key={item.id}><Link href="/team/attendance/resolutions">{item.workDate.toISOString().slice(0, 10)} · {format(item.type)} · {format(item.status)}</Link></li>)}</ul> : <p>No materialized P2 blockers in this scope.</p>}</section>
    </section>
  );
}

function format(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
