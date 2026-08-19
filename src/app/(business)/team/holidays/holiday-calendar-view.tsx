"use client";

import { Children, type ReactNode, useState } from "react";
import Link from "next/link";
import styles from "./holidays.module.css";

const monthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function HolidayCalendarView({ children, year }: { children: ReactNode; year: number }) {
  const months = Children.toArray(children);
  const today = new Date();
  const [view, setView] = useState<"year" | "month">("year");
  const [monthIndex, setMonthIndex] = useState(year === today.getFullYear() ? today.getMonth() : 0);

  return (
    <>
      <div className={styles.calendarViewToolbar}>
        <div aria-label="Calendar view" className={styles.calendarViewSwitch} role="group">
          <button aria-pressed={view === "year"} onClick={() => setView("year")} type="button">
            12 months
          </button>
          <button aria-pressed={view === "month"} onClick={() => setView("month")} type="button">
            One month
          </button>
        </div>

        {view === "month" ? (
          <div aria-label="Choose month" className={styles.monthNavigator}>
            <button
              aria-label="Previous month"
              disabled={monthIndex === 0}
              onClick={() => setMonthIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              ←
            </button>
            <strong>{monthLabels[monthIndex]} {year}</strong>
            <button
              aria-label="Next month"
              disabled={monthIndex === 11}
              onClick={() => setMonthIndex((current) => Math.min(11, current + 1))}
              type="button"
            >
              →
            </button>
          </div>
        ) : (
          <nav aria-label="Holiday year" className={styles.monthNavigator}>
            <Link aria-label={`View ${year - 1}`} href={`/team/holidays?year=${year - 1}`}>←</Link>
            <strong>{year}</strong>
            <Link aria-label={`View ${year + 1}`} href={`/team/holidays?year=${year + 1}`}>→</Link>
          </nav>
        )}
      </div>

      <div className={`${styles.calendarGrid} ${view === "month" ? styles.calendarGridMonth : ""}`}>
        {months.map((month, index) => (
          <div
            className={styles.calendarMonthSlot}
            hidden={view === "month" && index !== monthIndex}
            key={monthLabels[index]}
          >
            {month}
          </div>
        ))}
      </div>
    </>
  );
}
