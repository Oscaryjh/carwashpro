"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { addEmployeeRecurringRestDayAction, removeRosterAssignmentAction, saveRosterAssignmentAction } from "./actions";
import styles from "./roster.module.css";

type Template = { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; paidLabel: string; colorToken: string };

export function RosterQuickAssign({ branchId, currentSource, customReturnTo, dateLabel, employeeName, existingAssignmentId, existingKind, existingTemplateId, membershipId, returnTo, templates, triggerClassName, triggerContent, weekStart, workDate, expectedDraftRevision }: {
  branchId: string;
  currentSource?: string;
  customReturnTo?: string;
  dateLabel: string;
  employeeName: string;
  existingAssignmentId?: string | null;
  existingKind?: "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
  existingTemplateId?: string | null;
  membershipId: string;
  returnTo: string;
  templates: Template[];
  triggerClassName?: string;
  triggerContent?: ReactNode;
  weekStart: string;
  workDate: string;
  expectedDraftRevision: number;
}) {
  const initial = existingKind === "REST_DAY" ? "REST_DAY" : existingKind === "NOT_SCHEDULED" ? "OFF" : existingTemplateId ? `TEMPLATE:${existingTemplateId}` : "";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState(initial);
  const selectedTemplate = choice.startsWith("TEMPLATE:") ? choice.slice(9) : "";
  const selectedKind = selectedTemplate ? "WORK_SHIFT" : choice === "REST_DAY" ? "REST_DAY" : "NOT_SCHEDULED";
  const currentTemplate = existingTemplateId ? templates.find((template) => template.id === existingTemplateId) : undefined;
  const isChanged = Boolean(existingAssignmentId || currentSource?.startsWith("WEEKLY_") || currentSource === "CUSTOM_SHIFT");
  const restWeekday = new Date(`${workDate}T00:00:00.000Z`).toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" });

  function openDialog() {
    setChoice(initial);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return <>
    <button className={triggerClassName ?? (existingKind ? styles.editCellButton : styles.quickAssign)} onClick={openDialog} type="button">{triggerContent ?? (existingKind ? "Change" : "Choose shift")}</button>
    <dialog aria-label={`Assign schedule for ${employeeName} on ${dateLabel}`} className={styles.quickAssignDialog} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }} ref={dialogRef}>
      <aside className={styles.quickDrawer}>
        <header><div><span className={styles.sectionKicker}>SELECT SCHEDULE</span><h2>{employeeName}</h2><p>{dateLabel}</p></div><button aria-label="Close shift picker" className={styles.drawerClose} onClick={closeDialog} type="button">×</button></header>
        {existingKind ? <section className={styles.currentSchedule}><span className={styles.sectionKicker}>CURRENT</span><strong>{currentTemplate?.name ?? (existingKind === "REST_DAY" ? "Rest Day" : existingKind === "NOT_SCHEDULED" ? "Not Scheduled" : "Custom time")}</strong>{currentTemplate ? <small>{currentTemplate.startTime}–{currentTemplate.endTime} · {currentTemplate.breakMinutes ? `${currentTemplate.breakMinutes} min break · ` : ""}{currentTemplate.paidLabel} scheduled</small> : null}<small>{isChanged ? "This date only" : currentSource === "FIXED_REST" ? "Repeats every week" : "Normal schedule"}</small></section> : null}
        <section><h3>Choose for this date</h3><div className={styles.quickShiftList}><button aria-pressed={choice === "REST_DAY"} className={choice === "REST_DAY" ? styles.quickChoiceActive : undefined} onClick={() => setChoice("REST_DAY")} type="button"><span className={`${styles.colorDot} ${styles.colorVIOLET}`} /><span><strong>Rest Day</strong><small>This date only · does not repeat</small></span></button>{templates.map((template) => <button aria-pressed={choice === `TEMPLATE:${template.id}`} className={choice === `TEMPLATE:${template.id}` ? styles.quickChoiceActive : undefined} key={template.id} onClick={() => setChoice(`TEMPLATE:${template.id}`)} type="button"><span className={`${styles.colorDot} ${styles[`color${template.colorToken}`]}`} /><span><strong>{template.name}</strong><small>{template.startTime}–{template.endTime} · {template.paidLabel} scheduled</small></span></button>)}<button aria-pressed={choice === "OFF"} className={choice === "OFF" ? styles.quickChoiceActive : undefined} onClick={() => setChoice("OFF")} type="button"><span className={`${styles.colorDot} ${styles.colorSLATE}`} /><span><strong>Not Scheduled</strong><small>Explicitly no work planned</small></span></button></div></section>
        {choice === "REST_DAY" ? <form action={addEmployeeRecurringRestDayAction} className={styles.repeatRestForm}><input name="branchId" type="hidden" value={branchId} /><input name="membershipId" type="hidden" value={membershipId} /><input name="workDate" type="hidden" value={workDate} /><input name="returnTo" type="hidden" value={returnTo} /><div><strong>Need the same Rest Day every week?</strong><span>One click updates the normal schedule; past roster history stays unchanged.</span></div><button aria-checked={currentSource === "FIXED_REST"} aria-label={`Repeat ${restWeekday} as this employee's weekly Rest Day`} className={styles.repeatRestSwitch} disabled={currentSource === "FIXED_REST"} role="switch" type="submit"><span /></button></form> : null}
        <Link className={styles.advancedEditLink} href={`${customReturnTo ?? returnTo}&assignMember=${encodeURIComponent(membershipId)}&assignDate=${workDate}#roster-editor`} onClick={closeDialog}>Custom time <span>Set start, end and break</span></Link>
        <form action={saveRosterAssignmentAction} className={styles.drawerFooter}>
          <input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={weekStart} /><input name="expectedDraftRevision" type="hidden" value={expectedDraftRevision} /><input name="returnTo" type="hidden" value={returnTo} /><input name="membershipId" type="hidden" value={membershipId} /><input name="workDate" type="hidden" value={workDate} /><input name="kind" type="hidden" value={selectedKind} /><input name="shiftTemplateId" type="hidden" value={selectedTemplate} /><input name="startTime" type="hidden" value="09:00" /><input name="endTime" type="hidden" value="18:00" /><input name="breakMinutes" type="hidden" value="0" />
          <button className="secondary-light-button" onClick={closeDialog} type="button">Cancel</button><button disabled={!choice || (!existingAssignmentId && choice === initial)} type="submit">Save</button>
        </form>
        {existingAssignmentId ? <form action={removeRosterAssignmentAction} className={styles.resetDefaultForm}><input name="assignmentId" type="hidden" value={existingAssignmentId} /><input name="expectedDraftRevision" type="hidden" value={expectedDraftRevision} /><input name="returnTo" type="hidden" value={returnTo} /><button className="secondary-light-button" type="submit">Reset to normal schedule</button><small>Remove this weekly change and use the employee&apos;s normal schedule again.</small></form> : <p className={styles.inheritanceNote}>This changes only {dateLabel}. The employee&apos;s normal schedule stays the same.</p>}
      </aside>
    </dialog>
  </>;
}
