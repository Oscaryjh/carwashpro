import type { Metadata } from "next";
import Link from "next/link";
import { StaffAppointmentCalendar } from "@/components/staff-pwa/staff-appointment-calendar";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { getStaffAppointmentCalendarWeek, getStaffAppointmentDay } from "@/lib/staff-pwa/appointments";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function StaffAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const auth = await requireEmployeeModulePage("SALON");
  const params = await searchParams;
  const day = await getStaffAppointmentDay({
    auth,
    date: params.date,
    scope: params.view === "company" ? "COMPANY" : "MINE",
  });
  const week = getStaffAppointmentCalendarWeek(day.date);
  const companyView = day.scope === "COMPANY";

  return (
    <div className="staff-appointments-stack">
      <header className="staff-page-intro staff-appointments-intro">
        <p className="staff-kicker">{companyView ? "COMPANY APPOINTMENTS" : "MY APPOINTMENTS"}</p>
        <h1>Today&apos;s bookings</h1>
        <p>{companyView
          ? "All customer appointments you are allowed to view, in time order."
          : "Your assigned customer appointments, in time order."}</p>
      </header>

      {day.canViewCompanyAppointments ? (
        <nav aria-label="Appointment view" className="staff-appointment-scope-tabs">
          <Link
            aria-current={!companyView ? "page" : undefined}
            href={`/staff/appointments?date=${day.date}`}
            scroll={false}
          >
            My appointments
          </Link>
          <Link
            aria-current={companyView ? "page" : undefined}
            href={`/staff/appointments?date=${day.date}&view=company`}
            scroll={false}
          >
            Company appointments
          </Link>
        </nav>
      ) : null}

      <StaffAppointmentCalendar
        date={day.date}
        dateLabel={day.dateLabel}
        isToday={day.isToday}
        nextDate={day.nextDate}
        previousDate={day.previousDate}
        scope={day.scope}
        week={week}
      />

      {day.staffMapping === "MISSING" ? (
        <section className="staff-appointment-state warning" role="status">
          <span aria-hidden="true">!</span>
          <div>
            <strong>Appointments are not linked yet</strong>
            <p>Your employee profile is not linked to a bookable Staff User. Ask your manager to complete the Staff mapping.</p>
          </div>
        </section>
      ) : day.appointments.length ? (
        <section aria-label={`${day.dateLabel} appointments`} className="staff-appointment-list">
          <header>
            <div><strong>{day.appointments.length} booking{day.appointments.length === 1 ? "" : "s"}</strong><span>{day.remainingCount} remaining</span></div>
            <small>Tap a booking for details</small>
          </header>
          {day.appointments.map((appointment) => (
            <details className="staff-appointment-row" key={appointment.id}>
              <summary>
                <time dateTime={appointment.scheduledAt}>{appointment.timeLabel}</time>
                <span>
                  <strong>{appointment.customerName}</strong>
                  <small>{appointment.serviceSummary}{companyView
                    ? ` · ${appointment.isOwnAppointment ? "Assigned to you" : `Assigned to ${appointment.assignedStaffName}`}`
                    : ""}</small>
                </span>
                <span className={`staff-appointment-status ${appointment.status.tone}`}>{appointment.status.label}</span>
                <i aria-hidden="true">⌄</i>
              </summary>
              <div className="staff-appointment-detail">
                <dl>
                  <div><dt>Duration</dt><dd>{appointment.durationLabel}</dd></div>
                  <div><dt>Workplace</dt><dd>{appointment.branchName}</dd></div>
                  {companyView ? <div className="wide"><dt>Assigned staff</dt><dd>{appointment.isOwnAppointment ? "You" : appointment.assignedStaffName}</dd></div> : null}
                  <div className="wide"><dt>Services</dt><dd>{appointment.services.length ? appointment.services.map((service) => service.name).join(" · ") : "Not specified"}</dd></div>
                </dl>
                {appointment.conflicts.length ? (
                  <div className="staff-appointment-conflicts" role="note">
                    <strong>Schedule check</strong>
                    {appointment.conflicts.map((conflict) => <span key={conflict.code}>{conflict.label}</span>)}
                    <small>This warning does not change Attendance or Payroll.</small>
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </section>
      ) : (
        <section className="staff-appointment-state" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{day.isToday
              ? companyView ? "No company appointments today" : "No appointments today"
              : companyView ? "No company appointments this day" : "No appointments this day"}</strong>
            <p>{day.isToday
              ? companyView ? "This company has no customer bookings today." : "You have no assigned customer bookings today."
              : "Choose another date or return to today."}</p>
          </div>
        </section>
      )}
    </div>
  );
}
