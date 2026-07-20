import type { StaffAvailability, StaffBreak, StaffTimeOff } from "@prisma/client";
import {
  addStaffTimeOffAction,
  deleteStaffTimeOffAction,
  saveStaffScheduleAction,
} from "@/app/(business)/team/actions";

const DAYS = [
  [0, "Sunday"],
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
] as const;

function displayDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function StaffAvailabilityForm({
  staffId,
  availability,
  breaks,
  timeOff,
}: {
  staffId: string;
  availability: StaffAvailability[];
  breaks: StaffBreak[];
  timeOff: StaffTimeOff[];
}) {
  const availabilityByDay = new Map(availability.map((slot) => [slot.dayOfWeek, slot]));
  const breakByDay = new Map(breaks.map((entry) => [entry.dayOfWeek, entry]));

  return (
    <div className="staff-availability-layout">
      <div className="panel staff-availability-panel">
        <div className="section-header">
          <div>
            <h2>Working hours</h2>
            <p>Appointments can only be assigned inside these hours.</p>
          </div>
        </div>
        <form className="form" action={saveStaffScheduleAction}>
          <input type="hidden" name="userId" value={staffId} />
          <div className="staff-schedule-grid">
            {DAYS.map(([dayOfWeek, label]) => {
              const slot = availabilityByDay.get(dayOfWeek);
              const breakSlot = breakByDay.get(dayOfWeek);
              return (
                <div className="staff-schedule-row" key={dayOfWeek}>
                  <label className="staff-schedule-day">
                    <input
                      defaultChecked={slot?.enabled ?? false}
                      name={`enabled-${dayOfWeek}`}
                      type="checkbox"
                    />
                    <strong>{label}</strong>
                  </label>
                  <label>
                    <span>Start</span>
                    <input
                      defaultValue={slot?.startTime ?? "09:00"}
                      name={`startTime-${dayOfWeek}`}
                      type="time"
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      defaultValue={slot?.endTime ?? "18:00"}
                      name={`endTime-${dayOfWeek}`}
                      type="time"
                    />
                  </label>
                  <label>
                    <span>Break start</span>
                    <input
                      defaultValue={breakSlot?.startTime ?? ""}
                      name={`breakStart-${dayOfWeek}`}
                      type="time"
                    />
                  </label>
                  <label>
                    <span>Break end</span>
                    <input
                      defaultValue={breakSlot?.endTime ?? ""}
                      name={`breakEnd-${dayOfWeek}`}
                      type="time"
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="form-actions">
            <button type="submit">Save working hours</button>
          </div>
        </form>
      </div>

      <div className="panel staff-availability-panel">
        <div className="section-header">
          <div>
            <h2>Leave and time off</h2>
            <p>Appointments cannot be booked during these periods.</p>
          </div>
        </div>
        <form className="form" action={addStaffTimeOffAction}>
          <input type="hidden" name="userId" value={staffId} />
          <div className="field-grid">
            <label>
              <span>Starts</span>
              <input name="startsAt" type="datetime-local" required />
            </label>
            <label>
              <span>Ends</span>
              <input name="endsAt" type="datetime-local" required />
            </label>
            <label>
              <span>Reason optional</span>
              <input name="reason" placeholder="Annual leave" />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit">Add time off</button>
          </div>
        </form>

        {timeOff.length ? (
          <div className="staff-time-off-list">
            {timeOff.map((entry) => (
              <div className="staff-time-off-row" key={entry.id}>
                <div>
                  <strong>{displayDateTime(entry.startsAt)} - {displayDateTime(entry.endsAt)}</strong>
                  <span>{entry.reason || "Time off"}</span>
                </div>
                <form action={deleteStaffTimeOffAction}>
                  <input type="hidden" name="userId" value={staffId} />
                  <input type="hidden" name="timeOffId" value={entry.id} />
                  <button className="secondary-light-button" type="submit">Remove</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No upcoming leave or time off.</p>
        )}
      </div>
    </div>
  );
}
