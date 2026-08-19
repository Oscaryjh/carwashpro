"use client";

import { useState } from "react";
import { saveEmployeeRosterScheduleAction } from "../actions";
import styles from "../roster.module.css";

type EmployeeOption = { id: string; fullName: string; employeeCode: string };
type ShiftOption = { id: string; name: string; startMinute: number; endMinute: number; crossMidnight: boolean };

export function EmployeeScheduleForm({
  branchId,
  employees,
  effectiveFrom,
  initialSchedule,
  returnTo,
  selectedEmployeeId,
  shifts,
}: {
  branchId: string;
  employees: EmployeeOption[];
  effectiveFrom: string;
  initialSchedule?: { defaultShiftTemplateId: string | null; fixedRestWeekdays: number[]; requiredRestDays: number; restPolicy: "FIXED" | "VARIABLE" };
  returnTo: string;
  selectedEmployeeId?: string;
  shifts: ShiftOption[];
}) {
  const [membershipId, setMembershipId] = useState(selectedEmployeeId ?? "");
  const [restPolicy, setRestPolicy] = useState<"FIXED" | "VARIABLE">(initialSchedule?.restPolicy ?? "FIXED");
  return (
    <form action={saveEmployeeRosterScheduleAction} className={styles.scheduleSettingsGrid}>
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="branchId" type="hidden" value={branchId} />
      <section className={styles.scheduleFormSection}>
        <header className={styles.scheduleFormSectionHeading}>
          <span>1</span>
          <div><strong>Choose employee and start date</strong><small>The new schedule takes effect from this date.</small></div>
        </header>
        <div className={styles.scheduleFormFields}>
          <label><span>Employee</span><select name="membershipId" onChange={(event) => setMembershipId(event.target.value)} required value={membershipId}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} · {employee.employeeCode}</option>)}</select></label>
          <label><span>Effective from</span><input defaultValue={effectiveFrom} name="effectiveFrom" required type="date" /></label>
        </div>
      </section>

      <section className={styles.scheduleFormSection}>
        <header className={styles.scheduleFormSectionHeading}>
          <span>2</span>
          <div><strong>Set the normal shift</strong><small>This is used unless the weekly roster has an exception.</small></div>
        </header>
        <label className={styles.scheduleFormFullField}><span>Default shift</span><select defaultValue={initialSchedule?.defaultShiftTemplateId ?? ""} name="defaultShiftTemplateId"><option value="">No default shift · arrange weekly</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {minuteText(shift.startMinute)}–{minuteText(shift.endMinute)}{shift.crossMidnight ? " next day" : ""}</option>)}</select></label>
      </section>

      <section className={styles.scheduleFormSection}>
        <header className={styles.scheduleFormSectionHeading}>
          <span>3</span>
          <div><strong>Choose the Rest Day rule</strong><small>Use fixed days for a regular week, or choose the dates in each weekly roster.</small></div>
        </header>
        <fieldset className={styles.restPolicyPicker}><legend className="sr-only">Rest Day policy</legend><label className={restPolicy === "FIXED" ? styles.restPolicyActive : undefined}><input checked={restPolicy === "FIXED"} name="restPolicy" onChange={() => setRestPolicy("FIXED")} type="radio" value="FIXED" /><span><strong>Same days every week</strong><small>Select the normal Rest Days below.</small></span></label><label className={restPolicy === "VARIABLE" ? styles.restPolicyActive : undefined}><input checked={restPolicy === "VARIABLE"} name="restPolicy" onChange={() => setRestPolicy("VARIABLE")} type="radio" value="VARIABLE" /><span><strong>Different days each week</strong><small>The manager chooses them in the weekly roster.</small></span></label></fieldset>
        {restPolicy === "FIXED" ? <fieldset className={styles.weekdayPicker}><legend>Normal Rest Days</legend>{weekdayNames.map((name, index) => <label key={name}><input defaultChecked={initialSchedule?.fixedRestWeekdays.includes(index + 1)} name="fixedRestWeekdays" type="checkbox" value={index + 1} /><span>{name}</span></label>)}</fieldset> : <label className={styles.variableRestField}><span>Rest Days required each week</span><input defaultValue={initialSchedule?.requiredRestDays ?? 1} max="7" min="0" name="requiredRestDays" required type="number" /><small>The weekly roster cannot be published until this requirement is met.</small></label>}
      </section>

      <footer className={styles.scheduleFormActions}>
        <p>Saving creates a new effective version. Past schedules and published roster history stay unchanged.</p>
        <button type="submit">Save default schedule</button>
      </footer>
    </form>
  );
}

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function minuteText(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }
