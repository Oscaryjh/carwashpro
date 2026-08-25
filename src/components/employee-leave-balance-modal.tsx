import { randomUUID } from "node:crypto";
import { updateLeaveBalanceAction } from "@/app/(business)/team/leave/actions";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import type { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import styles from "./employee-leave-balance-modal.module.css";

type LeaveData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeLeaveSection>>
>;

export function EmployeeLeaveBalanceModal({
  data,
  employeeCode,
  employeeName,
  notice,
}: {
  data: LeaveData;
  employeeCode: string | null;
  employeeName: string;
  notice?: { message: string; tone: "error" | "success" } | null;
}) {
  const closePath = `/team/people/${data.id}?section=time&view=leave`;
  const trackedPolicies = data.policies.filter((policy) => policy.balanceTracked);

  return (
    <CatalogFormModal
      ariaLabel={`Adjust ${employeeName} leave balance`}
      closePath={closePath}
      eyebrow="LEAVE BALANCE"
      modalClassName={styles.modal}
      showMark={false}
      title="Adjust leave balance"
    >
      <div className={styles.content}>
        <header className={styles.employeeSummary}>
          <span aria-hidden="true" className={styles.avatar}>
            {initials(employeeName)}
          </span>
          <div>
            <strong>{employeeName}</strong>
            <small>
              {employeeCode ?? "No employee code"} · Leave year {data.year}
            </small>
          </div>
          <span className={styles.auditBadge}>Audited</span>
        </header>

        {notice ? (
          <div
            className={styles.notice}
            data-tone={notice.tone}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.message}
          </div>
        ) : null}

        {trackedPolicies.length ? (
          <>
            <section aria-label={`${employeeName} leave balances`} className={styles.balanceGrid}>
              {trackedPolicies.map((policy) => (
                <article className={styles.balanceCard} key={policy.id}>
                  <div>
                    <strong>{policy.name}</strong>
                    <small>{formatEnum(policy.payTreatment)}</small>
                  </div>
                  <div className={styles.remaining}>
                    <strong>{formatDays(policy.remainingDays ?? 0)}</strong>
                    <small>Available</small>
                  </div>
                  <p>
                    Entitlement {formatDays(policy.entitlementDays)} · Used {formatDays(policy.usedDays)}
                  </p>
                </article>
              ))}
            </section>

            <form action={updateLeaveBalanceAction} className={styles.adjustmentForm}>
              <input type="hidden" name="membershipId" value={data.id} />
              <input type="hidden" name="sourceKey" value={randomUUID()} />
              <input type="hidden" name="year" value={data.year} />
              <input type="hidden" name="returnTarget" value="employee-profile" />

              <div className={styles.formIntro}>
                <div>
                  <strong>Correct balance</strong>
                  <p>Use this only for a one-off correction. Regular allowance comes from the company policy.</p>
                </div>
              </div>

              <div className={styles.formGrid}>
                <label>
                  Leave type
                  <select name="policyId" required>
                    {trackedPolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Days
                  <input
                    max="366"
                    min="0.5"
                    name="days"
                    placeholder="For example, 1 or 0.5"
                    required
                    step="0.5"
                    type="number"
                  />
                </label>
              </div>

              <label className={styles.reasonField}>
                Reason for correction
                <input
                  maxLength={500}
                  minLength={3}
                  name="reason"
                  placeholder="For example, opening balance correction"
                  required
                />
              </label>

              <div className={styles.actions}>
                <button name="direction" type="submit" value="ADD">
                  Add days
                </button>
                <button className={styles.deductButton} name="direction" type="submit" value="DEDUCT">
                  Deduct days
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className={styles.emptyState}>
            <strong>No balance-tracked leave type</strong>
            <p>Create or enable a tracked leave policy before changing this employee&apos;s balance.</p>
          </div>
        )}

        <footer className={styles.footer}>
          <p>Every correction is stored separately and never replaces policy entitlement history.</p>
        </footer>
      </div>
    </CatalogFormModal>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDays(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded} ${Math.abs(rounded) === 1 ? "day" : "days"}`;
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
