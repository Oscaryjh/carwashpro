"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./staff-date-picker.module.css";

type StaffDatePickerProps = {
  label: string;
  min?: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function StaffDatePicker({ label, min, name, onChange, value }: StaffDatePickerProps) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDate(value) ?? new Date()));
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const today = dateKey(new Date());

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function openCalendar() {
    setVisibleMonth(startOfMonth(parseDate(value) ?? parseDate(min) ?? new Date()));
    setOpen(true);
  }

  function chooseDate(nextValue: string) {
    if (min && nextValue < min) return;
    onChange(nextValue);
    setOpen(false);
  }

  const calendar = open ? createPortal(
    <div className={styles.layer}>
      <button className={styles.backdrop} type="button" aria-label={`Close ${label} calendar`} onClick={() => setOpen(false)} />
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className={styles.handle} aria-hidden="true" />
        <header className={styles.toolbar}>
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          <strong id={titleId}>Select {label.toLowerCase()} date</strong>
          <button type="button" disabled={Boolean(min && today < min)} onClick={() => chooseDate(today)}>Today</button>
        </header>
        <div className={styles.monthNavigation}>
          <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}>&#8249;</button>
          <strong>{monthLabel(visibleMonth)}</strong>
          <button type="button" aria-label="Next month" onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}>&#8250;</button>
        </div>
        <div className={styles.weekdays} aria-hidden="true">
          {WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className={styles.grid} role="grid" aria-label={monthLabel(visibleMonth)}>
          {days.map((day) => {
            const key = dateKey(day);
            const disabled = Boolean(min && key < min);
            const selected = key === value;
            const currentMonth = day.getMonth() === visibleMonth.getMonth();
            return (
              <button
                aria-label={fullDateLabel(day)}
                aria-selected={selected}
                className={`${styles.day} ${currentMonth ? "" : styles.outside} ${key === today ? styles.today : ""} ${selected ? styles.selected : ""}`}
                disabled={disabled}
                key={key}
                onClick={() => chooseDate(key)}
                role="gridcell"
                type="button"
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={styles.field}>
      <span>{label}</span>
      <input name={name} type="hidden" value={value} />
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label} date: ${value ? displayDate(value) : "not selected"}`}
        className={value ? styles.trigger : styles.triggerEmpty}
        onClick={openCalendar}
        type="button"
      >
        <span>{value ? displayDate(value) : "DD/MM/YYYY"}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
      </button>
      {calendar}
    </div>
  );
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function parseDate(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function monthLabel(value: Date) {
  return value.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function fullDateLabel(value: Date) {
  return value.toLocaleDateString("en-MY", { day: "numeric", month: "long", weekday: "long", year: "numeric" });
}
