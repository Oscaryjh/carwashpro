import type { Metadata } from "next";
import { StaffAppointmentCalendar } from "@/components/staff-pwa/staff-appointment-calendar";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { getStaffAppointmentCalendarWeek, getStaffAppointmentDay } from "@/lib/staff-pwa/appointments";

export const metadata: Metadata = { title: "My Appointments" };
export const dynamic = "force-dynamic";

export default async function StaffAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const auth = await requireEmployeeModulePage("SALON");
  const params = await searchParams;
  const day = await getStaffAppointmentDay({ auth, date: params.date });
  const week = getStaffAppointmentCalendarWeek(day.date);

  return (
    <div className="staff-appointments-stack">
      <header className="staff-page-intro staff-appointments-intro">
        <p className="staff-kicker">MY APPOINTMENTS</p>
        <h1>Today&apos;s bookings</h1>
        <p>Your assigned customer appointments, in time order.</p>
      </header>

      <StaffAppointmentCalendar
        date={day.date}
        dateLabel={day.dateLabel}
        isToday={day.isToday}
        nextDate={day.nextDate}
        previousDate={day.previousDate}
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
                  <small>{appointment.serviceSummary}</small>
                </span>
                <span className={`staff-appointment-status ${appointment.status.tone}`}>{appointment.status.label}</span>
                <i aria-hidden="true">⌄</i>
              </summary>
              <div className="staff-appointment-detail">
                <dl>
                  <div><dt>Duration</dt><dd>{appointment.durationLabel}</dd></div>
                  <div><dt>Workplace</dt><dd>{appointment.branchName}</dd></div>
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
            <strong>{day.isToday ? "No appointments today" : "No appointments this day"}</strong>
            <p>{day.isToday ? "You have no assigned customer bookings today." : "Choose another date or return to today."}</p>
          </div>
        </section>
      )}
    </div>
  );
}

