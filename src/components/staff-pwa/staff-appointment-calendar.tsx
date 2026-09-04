"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StaffAppointmentScope } from "@/lib/staff-pwa/appointments";

type CalendarDay = Readonly<{
  date: string;
  dayLabel: string;
  weekdayLabel: string;
  selected: boolean;
}>;

export function StaffAppointmentCalendar({
  date,
  dateLabel,
  isToday,
  nextDate,
  previousDate,
  scope,
  week,
}: {
  date: string;
  dateLabel: string;
  isToday: boolean;
  nextDate: string;
  previousDate: string;
  scope: StaffAppointmentScope;
  week: readonly CalendarDay[];
}) {
  const router = useRouter();
  const hrefForDate = (targetDate: string) =>
    `/staff/appointments?date=${targetDate}${scope === "COMPANY" ? "&view=company" : ""}`;

  return (
    <section aria-label="Appointment calendar" className="staff-appointment-calendar">
      <div className="staff-appointment-date-nav">
        <Link aria-label="Previous day" href={hrefForDate(previousDate)}>‹</Link>
        <label className="staff-appointment-calendar-picker">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 3v3M17 3v3M4.5 9h15M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
          </svg>
          <span>
            <strong>{isToday ? "Today" : dateLabel}</strong>
            <small>{isToday ? dateLabel : "Tap to open calendar"}</small>
          </span>
          <input
            aria-label="Choose appointment date"
            onChange={(event) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
                router.push(hrefForDate(event.target.value), { scroll: false });
              }
            }}
            type="date"
            value={date}
          />
        </label>
        <Link aria-label="Next day" href={hrefForDate(nextDate)}>›</Link>
      </div>

      <nav aria-label="Choose a day this week" className="staff-appointment-week">
        {week.map((item) => (
          <Link
            aria-current={item.selected ? "date" : undefined}
            href={hrefForDate(item.date)}
            key={item.date}
            scroll={false}
          >
            <small>{item.weekdayLabel}</small>
            <strong>{item.dayLabel}</strong>
          </Link>
        ))}
      </nav>
    </section>
  );
}
