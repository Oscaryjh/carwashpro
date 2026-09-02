"use client";

export default function StaffAppointmentsError({ reset }: { reset: () => void }) {
  return (
    <section className="staff-appointment-state error" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <strong>Appointments could not be loaded</strong>
        <p>Check your connection and try again.</p>
        <button onClick={reset} type="button">Try again</button>
      </div>
    </section>
  );
}
