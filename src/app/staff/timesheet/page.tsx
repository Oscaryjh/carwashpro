import type { Metadata } from "next";
import { StaffP2CorrectionForm } from "@/components/staff-pwa/staff-p2-correction-form";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "My timesheet" };
export const dynamic = "force-dynamic";

export default async function StaffTimesheetPage() {
  const auth = await requireEmployeeModulePage("HR");
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [rows, exceptions] = await Promise.all([
    prisma.attendanceP2FinalResult.findMany({
      where: { businessId: auth.businessId, membershipId: auth.membershipId, workDate: { gte: monthStart } },
      orderBy: [{ workDate: "desc" }, { version: "desc" }],
    }),
    prisma.attendanceP2Exception.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
      },
      orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
    }),
  ]);
  const latest = [...new Map(rows.map((row) => [row.workDate.toISOString().slice(0, 10), row])).values()];
  return (
    <section className="staff-page-card" aria-labelledby="staff-timesheet-heading">
      <div className="staff-page-title">
        <p>Attendance results</p>
        <h1 id="staff-timesheet-heading">My timesheet</h1>
        <p>Raw punches, pending corrections and resolved day outcomes stay separate.</p>
      </div>
      {exceptions.length ? (
        <div className="staff-history-list">
          {exceptions.map((issue) => (
            <article className="staff-history-card" key={issue.id}>
              <div className="staff-history-card-header"><div><strong>{format(issue.type)}</strong><small>{issue.workDate.toISOString().slice(0, 10)} · {format(issue.status)}</small></div></div>
              <p>This issue must be resolved before monthly Timesheet approval.</p>
              {(issue.type === "MISSING_CLOCK_IN" || issue.type === "MISSING_CLOCK_OUT") && issue.status !== "PENDING_MANAGER" ? (
                <StaffP2CorrectionForm exceptionId={issue.id} type={issue.type} workDate={issue.workDate.toISOString().slice(0, 10)} />
              ) : issue.status === "PENDING_MANAGER" ? <small>Waiting for manager review.</small> : null}
            </article>
          ))}
        </div>
      ) : null}
      <div className="staff-history-list">
        {latest.map((row) => (
          <article className="staff-history-card" key={row.id}>
            <div className="staff-history-card-header"><div><strong>{format(row.outcome)}</strong><small>{row.workDate.toISOString().slice(0, 10)} · Version {row.version}</small></div></div>
            <div className="staff-history-times"><span><small>Clock in</small><strong>{time(row.actualClockInAt)}</strong></span><span><small>Clock out</small><strong>{time(row.actualClockOutAt)}</strong></span></div>
          </article>
        ))}
        {!latest.length && !exceptions.length ? <p>No Attendance day results are available for this month.</p> : null}
      </div>
    </section>
  );
}

function format(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function time(value: Date | null) { return value ? value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—"; }
