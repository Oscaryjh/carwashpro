"use client";

import { useMemo, useState } from "react";
import styles from "./roster.module.css";

type Option = { label: string; value: string };
type TemplateOption = Option & {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossMidnight: boolean;
};

export function RosterAssignmentFields({
  bulk = false,
  days,
  defaultDate,
  defaultEmployee,
  employees,
  templates,
}: {
  bulk?: boolean;
  days: Option[];
  defaultDate?: string;
  defaultEmployee?: string;
  employees: Option[];
  templates: TemplateOption[];
}) {
  const [kind, setKind] = useState("WORK_SHIFT");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [breakChoice, setBreakChoice] = useState("60");
  const [customBreakMinutes, setCustomBreakMinutes] = useState("");
  const [shiftTemplateId, setShiftTemplateId] = useState("");
  const breakMinutes = breakChoice === "CUSTOM" ? customBreakMinutes : breakChoice;
  const paidMinutes = useMemo(
    () => calculatePaidMinutes(startTime, endTime, breakMinutes),
    [breakMinutes, endTime, startTime],
  );

  return (
    <div className={styles.editorGrid}>
      <label className={bulk ? styles.employeePickerWide : undefined}>
        <span>{bulk ? "Employees" : "Employee"}</span>
        {bulk ? (
          <select
            multiple
            name="membershipIds"
            required
            size={Math.min(6, Math.max(2, employees.length))}
          >
            {employees.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        ) : (
          <select defaultValue={defaultEmployee} name="membershipId" required>
            {employees.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        )}
        {bulk ? <small>Use Ctrl/Cmd to select more than one employee.</small> : null}
      </label>

      <label>
        <span>Date</span>
        <select defaultValue={defaultDate} name="workDate" required>
          {days.map((day) => (
            <option key={day.value} value={day.value}>{day.label}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Assignment</span>
        <select name="kind" onChange={(event) => setKind(event.target.value)} value={kind}>
          <option value="WORK_SHIFT">Work shift</option>
          <option value="REST_DAY">Rest Day</option>
          <option value="NOT_SCHEDULED">Not Scheduled / Off</option>
        </select>
      </label>

      {kind === "WORK_SHIFT" ? (
        <>
          <label className={styles.templateField}>
            <span>Shift template</span>
            <select
              name="shiftTemplateId"
              onChange={(event) => {
                const value = event.target.value;
                setShiftTemplateId(value);
                const template = templates.find((item) => item.value === value);
                if (!template) return;
                setStartTime(template.startTime);
                setEndTime(template.endTime);
                const nextBreak = String(template.breakMinutes);
                if (["0", "15", "30", "45", "60", "90", "120"].includes(nextBreak)) {
                  setBreakChoice(nextBreak);
                  setCustomBreakMinutes("");
                } else {
                  setBreakChoice("CUSTOM");
                  setCustomBreakMinutes(nextBreak);
                }
              }}
              value={shiftTemplateId}
            >
              <option value="">Manual shift</option>
              {templates.map((template) => (
                <option key={template.value} value={template.value}>{template.label}</option>
              ))}
            </select>
            <small>{shiftTemplateId ? "Template times are protected and revalidated by the server." : "Choose a template or enter a one-off shift."}</small>
          </label>
          <label>
            <span>Start time</span>
            <input disabled={Boolean(shiftTemplateId)} name="startTime" onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} />
          </label>
          <label>
            <span>End time</span>
            <input disabled={Boolean(shiftTemplateId)} name="endTime" onChange={(event) => setEndTime(event.target.value)} type="time" value={endTime} />
            <small>An earlier end time means the shift ends the next day.</small>
          </label>
          <label>
            <span>Break</span>
            <select disabled={Boolean(shiftTemplateId)} onChange={(event) => setBreakChoice(event.target.value)} value={breakChoice}>
              <option value="0">No break</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1 hour 30 minutes</option>
              <option value="120">2 hours</option>
              <option value="CUSTOM">Other duration</option>
            </select>
            {breakChoice === "CUSTOM" ? (
              <input
                aria-label="Custom break minutes"
                disabled={Boolean(shiftTemplateId)}
                inputMode="numeric"
                max="720"
                min="0"
                onChange={(event) => setCustomBreakMinutes(event.target.value)}
                placeholder="Enter minutes"
                type="number"
                value={customBreakMinutes}
              />
            ) : null}
            <input name="breakMinutes" type="hidden" value={breakMinutes} />
          </label>
          <div className={styles.shiftPreview}>
            <span>Paid work target</span>
            <strong>{paidMinutes === null ? "Check shift times" : formatDuration(paidMinutes)}</strong>
            <small>Shift duration minus the scheduled break.</small>
          </div>
        </>
      ) : (
        <div className={styles.assignmentNotice}>
          <strong>{kind === "REST_DAY" ? "Explicit Rest Day" : "Explicit Not Scheduled / Off"}</strong>
          <span>No start, end or break is required.</span>
        </div>
      )}

      <label className={styles.noteField}>
        <span>Note (optional)</span>
        <input maxLength={500} name="note" placeholder={bulk ? "Shared operational note" : "Operational note"} />
      </label>
    </div>
  );
}

function calculatePaidMinutes(start: string, end: string, breakValue: string) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const breakMinutes = Number(breakValue);
  if (startMinutes === null || endMinutes === null || !Number.isInteger(breakMinutes) || breakMinutes < 0) return null;
  const span = endMinutes <= startMinutes ? endMinutes + 24 * 60 - startMinutes : endMinutes - startMinutes;
  return breakMinutes < span ? span - breakMinutes : null;
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hours`;
}
