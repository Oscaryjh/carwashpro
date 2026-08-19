"use client";

import Link from "next/link";
import { useRef } from "react";
import styles from "../roster.module.css";

type EmployeeScheduleSummary = {
  employeeCode: string;
  fullName: string;
  id: string;
  normalShift: string;
  restDay: string;
  effectiveFrom: string;
  ready: boolean;
};

type Props = {
  branchId: string;
  canEdit: boolean;
  employees: EmployeeScheduleSummary[];
};

export function DefaultSchedulesDialog({ branchId, canEdit, employees }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button className={styles.templateSecondaryAction} type="button" onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">▣</span>
        <span>Default schedules</span>
      </button>
      <dialog
        aria-labelledby="default-schedules-dialog-title"
        className={styles.templateDialog}
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className={styles.templateDialogShell}>
          <header className={styles.templateDialogHeader}>
            <div>
              <span>EMPLOYEE SCHEDULES</span>
              <h2 id="default-schedules-dialog-title">Default schedules</h2>
              <p>Review the normal shift and weekly Rest Day for each employee.</p>
            </div>
            <button aria-label="Close default schedules" type="button" onClick={closeDialog}>×</button>
          </header>
          <div className={`${styles.templateDialogBody} ${styles.defaultScheduleDialogBody}`}>
            <div className={styles.defaultScheduleDialogList}>
              {employees.map((employee) => (
                <article key={employee.id}>
                  <div className={styles.scheduleEmployeeIdentity}>
                    <strong>{employee.fullName}</strong>
                    <small>{employee.employeeCode}</small>
                  </div>
                  <dl>
                    <div><dt>Normal shift</dt><dd>{employee.normalShift}</dd></div>
                    <div><dt>Rest Day</dt><dd>{employee.restDay}</dd></div>
                    <div><dt>Effective from</dt><dd>{employee.effectiveFrom}</dd></div>
                  </dl>
                  <div className={styles.scheduleEmployeeActions}>
                    <span className={`${styles.badge} ${employee.ready ? styles.badgeSuccess : styles.badgeWarning}`}>{employee.ready ? "Active" : "Setup needed"}</span>
                    {canEdit ? (
                      <Link
                        className={styles.scheduleChangeLink}
                        href={`/team/roster/employee-schedules?branchId=${encodeURIComponent(branchId)}&setup=${encodeURIComponent(employee.id)}#schedule-editor`}
                      >
                        {employee.ready ? "Change" : "Set up"}
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))}
              {!employees.length ? <div className={styles.emptyState}><strong>No employees available</strong><p>Add an active employee to this branch first.</p></div> : null}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
