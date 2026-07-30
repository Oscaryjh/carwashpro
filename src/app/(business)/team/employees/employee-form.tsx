"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  createAttendanceEmployeeAction,
  updateAttendanceEmployeeAction,
  type AttendanceEmployeeActionState,
} from "./actions";
import styles from "./employee.module.css";

export type AttendanceEmployeeFormBranch = {
  id: string;
  name: string;
};

export type AttendanceEmployeeFormAssignment = {
  branchId: string;
  canClockIn: boolean;
  effectiveFrom: string;
  effectiveUntil: string;
  isPrimary: boolean;
  status: "ACTIVE" | "INACTIVE";
};

export type AttendanceEmployeeFormValues = {
  attendanceEnabled: boolean;
  assignments: AttendanceEmployeeFormAssignment[];
  employeeCode: string;
  employeeId: string;
  employmentType:
    | "FULL_TIME"
    | "PART_TIME"
    | "CONTRACT"
    | "DAILY"
    | "HOURLY";
  fullName: string;
  joinedAt: string;
  phoneNumber: string;
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  terminatedAt: string;
  updatedAt: string;
};

type AttendanceEmployeeFormProps = {
  branches: AttendanceEmployeeFormBranch[];
  businessName: string;
  employee?: AttendanceEmployeeFormValues;
};

const initialActionState: AttendanceEmployeeActionState = {
  status: "idle",
  message: "",
};

export function AttendanceEmployeeForm({
  branches,
  businessName,
  employee,
}: AttendanceEmployeeFormProps) {
  const action = employee
    ? updateAttendanceEmployeeAction
    : createAttendanceEmployeeAction;
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const assignmentByBranchId = useMemo(
    () =>
      new Map(
        (employee?.assignments ?? [])
          .filter((assignment) => assignment.status === "ACTIVE")
          .map((assignment) => [
          assignment.branchId,
          assignment,
        ]),
      ),
    [employee],
  );
  const availableBranchIds = useMemo(
    () => new Set(branches.map((branch) => branch.id)),
    [branches],
  );
  const initialAssignments = (employee?.assignments ?? []).filter(
    (assignment) =>
      assignment.status === "ACTIVE" &&
      availableBranchIds.has(assignment.branchId),
  );
  const initialPrimaryBranchId =
    initialAssignments.find((assignment) => assignment.isPrimary)?.branchId ??
    "";
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    initialAssignments.map((assignment) => assignment.branchId),
  );
  const [canClockInBranchIds, setCanClockInBranchIds] = useState<string[]>(
    initialAssignments
      .filter((assignment) => assignment.canClockIn)
      .map((assignment) => assignment.branchId),
  );
  const [primaryBranchId, setPrimaryBranchId] = useState(
    initialPrimaryBranchId,
  );
  const [status, setStatus] = useState<
    AttendanceEmployeeFormValues["status"]
  >(employee?.status ?? "ACTIVE");
  const [attendanceEnabled, setAttendanceEnabled] = useState(
    employee?.attendanceEnabled ?? false,
  );
  const [terminatedAt, setTerminatedAt] = useState(
    employee?.terminatedAt ?? "",
  );
  const [reactivationConfirmed, setReactivationConfirmed] = useState("no");
  const [clientError, setClientError] = useState("");
  const reactivationConfirmedRef = useRef<HTMLInputElement>(null);
  const submitGuardRef = useRef(false);
  const today = formatDateInput(new Date());

  useEffect(() => {
    if (!pending) {
      submitGuardRef.current = false;
    }
  }, [pending, state]);

  function updateSelectedBranch(branchId: string, checked: boolean) {
    setClientError("");
    setSelectedBranchIds((current) => {
      if (checked) {
        return current.includes(branchId) ? current : [...current, branchId];
      }
      return current.filter((id) => id !== branchId);
    });

    if (!checked) {
      setCanClockInBranchIds((current) =>
        current.filter((id) => id !== branchId),
      );
      if (primaryBranchId === branchId) {
        const nextPrimary =
          selectedBranchIds.find((id) => id !== branchId) ?? "";
        setPrimaryBranchId(nextPrimary);
      }
    } else if (!primaryBranchId) {
      setPrimaryBranchId(branchId);
    }
  }

  function updateCanClockInBranch(branchId: string, checked: boolean) {
    setClientError("");
    setCanClockInBranchIds((current) => {
      if (checked) {
        return current.includes(branchId) ? current : [...current, branchId];
      }
      return current.filter((id) => id !== branchId);
    });

    if (!checked && attendanceEnabled && primaryBranchId === branchId) {
      setAttendanceEnabled(false);
    }
  }

  function updatePrimaryBranch(nextPrimaryBranchId: string) {
    setClientError("");
    setPrimaryBranchId(nextPrimaryBranchId);

    if (
      attendanceEnabled &&
      nextPrimaryBranchId &&
      !canClockInBranchIds.includes(nextPrimaryBranchId)
    ) {
      setCanClockInBranchIds((current) => [
        ...current,
        nextPrimaryBranchId,
      ]);
    }
  }

  function updateStatus(nextStatus: AttendanceEmployeeFormValues["status"]) {
    setClientError("");
    setStatus(nextStatus);
    setReactivationConfirmed("no");

    if (reactivationConfirmedRef.current) {
      reactivationConfirmedRef.current.value = "no";
    }

    if (nextStatus === "TERMINATED") {
      setAttendanceEnabled(false);
      setCanClockInBranchIds([]);
      setSelectedBranchIds([]);
      setPrimaryBranchId("");
      setTerminatedAt((current) => current || today);
      return;
    }

    setTerminatedAt("");

    if (nextStatus === "SUSPENDED") {
      setAttendanceEnabled(false);
      setCanClockInBranchIds([]);
    }
  }

  function updateAttendanceEnabled(checked: boolean) {
    setClientError("");
    setAttendanceEnabled(checked);

    if (
      checked &&
      primaryBranchId &&
      !canClockInBranchIds.includes(primaryBranchId)
    ) {
      setCanClockInBranchIds((current) => [...current, primaryBranchId]);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending || submitGuardRef.current) {
      event.preventDefault();
      return;
    }

    setClientError("");
    setReactivationConfirmed("no");
    if (reactivationConfirmedRef.current) {
      reactivationConfirmedRef.current.value = "no";
    }

    if (status !== "TERMINATED" && selectedBranchIds.length === 0) {
      event.preventDefault();
      setClientError("Select at least one active branch assignment.");
      return;
    }

    if (
      status !== "TERMINATED" &&
      (!primaryBranchId || !selectedBranchIds.includes(primaryBranchId))
    ) {
      event.preventDefault();
      setClientError("Choose one selected branch as the primary branch.");
      return;
    }

    if (
      attendanceEnabled &&
      !canClockInBranchIds.includes(primaryBranchId)
    ) {
      event.preventDefault();
      setClientError(
        "Attendance requires the primary branch to allow clock in.",
      );
      return;
    }

    if (employee) {
      const previousStatus = employee.status;

      if (
        previousStatus !== "SUSPENDED" &&
        status === "SUSPENDED" &&
        !window.confirm(
          "Suspend this employee? Attendance and clock-in access will be disabled.",
        )
      ) {
        event.preventDefault();
        return;
      }

      if (
        previousStatus !== "TERMINATED" &&
        status === "TERMINATED" &&
        !window.confirm(
          "Terminate this employee? Their employment and attendance history will be permanently retained and will not be deleted.",
        )
      ) {
        event.preventDefault();
        return;
      }

      if (
        previousStatus !== "ACTIVE" &&
        status === "ACTIVE" &&
        !window.confirm(
          "Reactivate this employee with the selected branch access?",
        )
      ) {
        event.preventDefault();
        return;
      }

      if (previousStatus === "TERMINATED" && status === "ACTIVE") {
        setReactivationConfirmed("yes");
        if (reactivationConfirmedRef.current) {
          reactivationConfirmedRef.current.value = "yes";
        }
      }

      if (
        employee.attendanceEnabled &&
        !attendanceEnabled &&
        previousStatus === status &&
        !window.confirm(
          "Disable attendance for this employee? They will no longer be able to clock in.",
        )
      ) {
        event.preventDefault();
        return;
      }

      if (
        status !== "TERMINATED" &&
        initialPrimaryBranchId &&
        primaryBranchId !== initialPrimaryBranchId &&
        !window.confirm(
          "Change this employee's primary branch to the selected branch?",
        )
      ) {
        event.preventDefault();
        return;
      }
    }

    submitGuardRef.current = true;
  }

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className={styles.form}
      onSubmit={handleSubmit}
    >
      {employee ? (
        <>
          <input name="employeeId" type="hidden" value={employee.employeeId} />
          <input
            name="previousStatus"
            type="hidden"
            value={employee.status}
          />
          <input
            name="expectedUpdatedAt"
            type="hidden"
            value={employee.updatedAt}
          />
        </>
      ) : null}
      <input
        ref={reactivationConfirmedRef}
        name="reactivationConfirmed"
        readOnly
        type="hidden"
        value={reactivationConfirmed}
      />

      <section className={styles.formSection}>
        <div className={styles.formHeading}>
          <span>01</span>
          <div>
            <h2>Employee profile</h2>
            <p>Employment identity for this business. This does not create a POS login.</p>
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <label>
            Business
            <input aria-label="Business" readOnly value={businessName} />
          </label>

          <label>
            Employee code
            <input
              autoComplete="off"
              defaultValue={employee?.employeeCode ?? ""}
              maxLength={50}
              name="employeeCode"
              placeholder="EMP-001"
              required
            />
            <FieldErrors errors={state.fieldErrors?.employeeCode} />
          </label>

          <label>
            Full name
            <input
              autoComplete="name"
              defaultValue={employee?.fullName ?? ""}
              maxLength={120}
              name="fullName"
              required
            />
            <FieldErrors errors={state.fieldErrors?.fullName} />
          </label>

          <label>
            Phone number
            <input
              autoComplete="tel"
              defaultValue={employee?.phoneNumber ?? ""}
              inputMode="tel"
              name="phoneNumber"
              placeholder="+60 12-345 6789"
              required
              type="tel"
            />
            <small>Use a unique mobile number. International format is recommended.</small>
            <FieldErrors errors={state.fieldErrors?.phoneNumber} />
          </label>

          <label>
            Employment type
            <select
              defaultValue={employee?.employmentType ?? "FULL_TIME"}
              name="employmentType"
            >
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option>
              <option value="DAILY">Daily</option>
              <option value="HOURLY">Hourly</option>
            </select>
            <FieldErrors errors={state.fieldErrors?.employmentType} />
          </label>

          <label>
            Employment status
            <select
              name="status"
              onChange={(event) =>
                updateStatus(
                  event.target.value as AttendanceEmployeeFormValues["status"],
                )
              }
              value={status}
            >
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
            <FieldErrors errors={state.fieldErrors?.status} />
          </label>

          <label>
            Joined date
            <input
              defaultValue={employee?.joinedAt ?? today}
              name="joinedAt"
              required
              type="date"
            />
            <FieldErrors errors={state.fieldErrors?.joinedAt} />
          </label>

          <label>
            Termination date
            <input
              disabled={status !== "TERMINATED"}
              name="terminatedAt"
              onChange={(event) => setTerminatedAt(event.target.value)}
              required={status === "TERMINATED"}
              type="date"
              value={terminatedAt}
            />
            <FieldErrors errors={state.fieldErrors?.terminatedAt} />
          </label>
        </div>

        {status === "TERMINATED" ? (
          <p className={styles.preservationNote}>
            Termination closes active assignments. Employee and attendance history
            remains permanently retained.
          </p>
        ) : null}
      </section>

      <section className={styles.formSection}>
        <div className={styles.formHeading}>
          <span>02</span>
          <div>
            <h2>Branch assignments</h2>
            <p>Select work locations, clock-in access, and one primary branch.</p>
          </div>
        </div>

        {branches.length ? (
          <>
            <label className={styles.primaryField}>
              Primary branch
              <select
                disabled={
                  status === "TERMINATED" || selectedBranchIds.length === 0
                }
                name="primaryBranchId"
                onChange={(event) => updatePrimaryBranch(event.target.value)}
                required={status !== "TERMINATED"}
                value={primaryBranchId}
              >
                <option value="">Select primary branch</option>
                {branches
                  .filter((branch) => selectedBranchIds.includes(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
              <FieldErrors errors={state.fieldErrors?.primaryBranchId} />
            </label>

            <div
              aria-label="Branch assignments"
              className={styles.branchList}
              role="group"
            >
              {branches.map((branch) => {
                const assignment = assignmentByBranchId.get(branch.id);
                const selected = selectedBranchIds.includes(branch.id);
                const canClockIn = canClockInBranchIds.includes(branch.id);

                return (
                  <article
                    className={selected ? styles.branchSelected : undefined}
                    key={branch.id}
                  >
                    <div className={styles.branchTitle}>
                      <label>
                        <input
                          checked={selected}
                          disabled={status === "TERMINATED" || pending}
                          name="branchIds"
                          onChange={(event) =>
                            updateSelectedBranch(
                              branch.id,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                          value={branch.id}
                        />
                        <span>
                          <strong>{branch.name}</strong>
                          <small>
                            {primaryBranchId === branch.id
                              ? "Primary branch"
                              : selected
                                ? "Assigned"
                                : "Not assigned"}
                          </small>
                        </span>
                      </label>

                      <label className={styles.clockToggle}>
                        <input
                          checked={canClockIn}
                          disabled={
                            !selected || status !== "ACTIVE" || pending
                          }
                          name="canClockInBranchIds"
                          onChange={(event) =>
                            updateCanClockInBranch(
                              branch.id,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                          value={branch.id}
                        />
                        Allow clock in
                      </label>
                    </div>

                    <div className={styles.assignmentDates}>
                      <label>
                        Effective from
                        <input
                          defaultValue={
                            assignment?.effectiveFrom ||
                            employee?.joinedAt ||
                            today
                          }
                          disabled={!selected || status === "TERMINATED"}
                          name={`assignmentEffectiveFrom__${branch.id}`}
                          required={selected && status !== "TERMINATED"}
                          type="date"
                        />
                      </label>
                      <label>
                        Effective until
                        <input
                          defaultValue={assignment?.effectiveUntil ?? ""}
                          disabled={!selected || status === "TERMINATED"}
                          name={`assignmentEffectiveUntil__${branch.id}`}
                          type="date"
                        />
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <p className={styles.empty}>
            No active branches are available in your authorized scope.
          </p>
        )}

        <FieldErrors errors={state.fieldErrors?.branchIds} />
        <FieldErrors errors={state.fieldErrors?.canClockInBranchIds} />
        <FieldErrors errors={state.fieldErrors?.assignments} />
      </section>

      <section className={styles.formSection}>
        <div className={styles.formHeading}>
          <span>03</span>
          <div>
            <h2>Attendance readiness</h2>
            <p>Enable clock-in only after the employee and primary branch are ready.</p>
          </div>
        </div>

        <label className={styles.attendanceToggle}>
          <span>
            <strong>Attendance enabled</strong>
            <small>
              Allows this employee to use attendance at permitted branches.
            </small>
          </span>
          <input
            checked={attendanceEnabled}
            disabled={status !== "ACTIVE" || pending}
            name="attendanceEnabled"
            onChange={(event) =>
              updateAttendanceEnabled(event.target.checked)
            }
            type="checkbox"
          />
        </label>
        <FieldErrors errors={state.fieldErrors?.attendanceEnabled} />
      </section>

      {clientError ? (
        <p className={`${styles.message} ${styles.messageError}`} role="alert">
          {clientError}
        </p>
      ) : null}

      {state.status !== "idle" && state.message ? (
        <p
          className={`${styles.message} ${
            state.status === "error"
              ? styles.messageError
              : styles.messageSuccess
          }`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <div className={styles.formActions}>
        <button
          className={styles.primaryButton}
          disabled={pending || branches.length === 0}
          type="submit"
        >
          {pending
            ? employee
              ? "Saving employee..."
              : "Creating employee..."
            : employee
              ? "Save employee"
              : "Create employee"}
        </button>
      </div>
    </form>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) {
    return null;
  }

  return (
    <span className={styles.fieldError} role="alert">
      {errors[0]}
    </span>
  );
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
