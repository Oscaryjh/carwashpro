import type { Metadata } from "next";
import { getEmployeeCommissionStatements } from "@/lib/commission/read";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My commission" };
export const dynamic = "force-dynamic";

export default async function StaffCommissionPage() {
  const auth = await requireEmployeeModulePage("COMMISSION");
  const statements = await getEmployeeCommissionStatements({ businessId: auth.businessId, membershipId: auth.membershipId });
  const latest = statements.at(0);
  return (
    <section className="staff-page-card staff-commission-page" aria-labelledby="staff-commission-heading">
      <div className="staff-payslip-heading">
        <p>Commission</p>
        <h1 id="staff-commission-heading">My commission</h1>
        <span>Track your own calculated and approved commission statements.</span>
      </div>
      {latest ? (
        <div className="staff-commission-summary">
          <small>Latest statement</small>
          <strong>RM {(latest.finalCommissionCents / 100).toFixed(2)}</strong>
          <span>{commissionPeriod(latest.period.earnedPeriodStart, latest.period.earnedPeriodEnd)} · {humanize(latest.status)}</span>
        </div>
      ) : null}
      {statements.length ? (
        <div className="staff-payslip-list">
          {statements.map((statement) => (
            <article key={statement.id}>
              <div>
                <strong>{commissionPeriod(statement.period.earnedPeriodStart, statement.period.earnedPeriodEnd)}</strong>
                <small>{statement.accruals.length} source line(s) · {humanize(statement.status)}</small>
              </div>
              <strong>RM {(statement.finalCommissionCents / 100).toFixed(2)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <div className="staff-commission-empty">
          <span className="staff-commission-empty-icon" aria-hidden="true">↗</span>
          <p>NO STATEMENTS YET</p>
          <strong>Commission will appear here</strong>
          <span>Your calculated and approved statements will be added automatically once they are ready.</span>
        </div>
      )}
    </section>
  );
}

function commissionPeriod(from: Date, to: Date) {
  const format = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${format.format(from)} – ${format.format(to)}`;
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
