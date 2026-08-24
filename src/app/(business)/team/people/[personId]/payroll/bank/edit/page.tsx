import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createEmployeeBankVersionAction } from "@/app/(business)/team/people/[personId]/payroll/actions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  salaryBankGroups,
  salaryBankOptions,
} from "@/lib/payroll/payment/bank-directory";
import { isPayrollBankAccountMfaEnabled } from "@/lib/payroll/payment/bank-account-security";
import { prisma } from "@/lib/prisma";
import { loadEmployeeBankSection } from "@/lib/team/employee-profile-bank-read";
import styles from "@/components/employee-profile-shell.module.css";
import { PayrollHighRiskMfaFields } from "@/components/payroll-high-risk-mfa-fields";

export default async function EmployeeBankEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ message?: string; type?: string }>;
}) {
  await requireBusinessUser("VIEW_TEAM_DIRECTORY");
  const context = await requireWholeBusinessPayroll("EDIT_BANK_ACCOUNT");
  const route = await params;
  const query = await searchParams;
  const membershipId = z.string().uuid().safeParse(route.personId);
  if (!membershipId.success) notFound();

  const [employee, bankResult] = await Promise.all([
    prisma.employeeBusinessMembership.findFirst({
      where: { businessId: context.businessId, id: membershipId.data },
      select: { employeeCode: true, fullName: true, id: true },
    }),
    loadEmployeeBankSection({
      access: context.access,
      allowedBranchIds: context.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membershipId.data,
    }),
  ]);
  if (!employee || bankResult.status === "NOT_FOUND") notFound();
  if (bankResult.status !== "READY" || !bankResult.data.canEdit) notFound();

  const current = bankResult.data.bank;
  const replacing = current?.status === "ACTIVE";
  const effectiveDate = minimumEffectiveDate(current?.effectiveFrom ?? null);
  const selectedBankCode = salaryBankOptions.some(
    (bank) => bank.code === current?.bankCode,
  )
    ? current!.bankCode
    : salaryBankOptions[0].code;
  const errorMessage =
    query.type === "error" ? query.message?.slice(0, 180) : null;
  const bankAccountMfaEnabled = isPayrollBankAccountMfaEnabled();

  return (
    <main className={`${styles.page} ${styles.bankEditPage}`}>
      <section className={styles.bankEditShell}>
        <header className={styles.bankEditHeader}>
          <Link
            aria-label="Back to payroll and bank"
            className={styles.bankEditBack}
            href={`/team/people/${employee.id}?section=payroll`}
          >
            <span aria-hidden="true">←</span>
            Payroll &amp; bank
          </Link>
          <div className={styles.bankEditTitleRow}>
            <div>
              <p className={styles.eyebrow}>Salary payment</p>
              <h1>{replacing ? "Change bank account" : "Add bank account"}</h1>
              <p>
                {employee.fullName}
                {employee.employeeCode ? ` · ${employee.employeeCode}` : ""}
              </p>
            </div>
          </div>
        </header>

        {errorMessage ? (
          <div
            className={styles.payrollUpdateNotice}
            data-status="error"
            role="alert"
          >
            <div>
              <strong>Bank account not saved</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        ) : null}

        {current ? (
          <aside className={styles.bankCurrentSummary}>
            <div>
              <span>Current account</span>
              <strong>{current.bankName}</strong>
            </div>
            <div>
              <span>Account</span>
              <strong>{current.accountNumber}</strong>
            </div>
            <span className={styles.bankStatus}>
              {formatStatus(current.status)}
            </span>
          </aside>
        ) : null}

        <section className={styles.bankEditCard}>
          <div className={styles.bankEditCardHeading}>
            <div>
              <h2>{replacing ? "New payment account" : "Payment account"}</h2>
              <p>Choose where this employee should receive salary payments.</p>
            </div>
            {!current ? <span>New</span> : null}
          </div>

          <form
            action={createEmployeeBankVersionAction}
            className={styles.bankAccountForm}
          >
            <input name="commandId" type="hidden" value={randomUUID()} />
            <input
              name="expectedRevision"
              type="hidden"
              value={current?.revision ?? 0}
            />
            <input name="effectiveFrom" type="hidden" value={effectiveDate} />
            <input name="membershipId" type="hidden" value={employee.id} />
            <input
              name="reasonType"
              type="hidden"
              value={current ? "ACCOUNT_CHANGE" : "INITIAL_SETUP"}
            />
            <input
              name="reason"
              type="hidden"
              value={
                current
                  ? "Salary bank account replaced"
                  : "Salary bank account added"
              }
            />

            <div className={styles.bankFormGrid}>
              <label className={styles.bankAccountNumberField}>
                <span>Receiving bank or e-wallet</span>
                <select
                  defaultValue={selectedBankCode}
                  name="bankCode"
                  required
                >
                  {salaryBankGroups.map((group) => (
                    <optgroup key={group.code} label={group.label}>
                      {salaryBankOptions
                        .filter((bank) => bank.group === group.code)
                        .map((bank) => (
                          <option key={bank.code} value={bank.code}>
                            {bank.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span>Holder name</span>
                <input
                  autoComplete="name"
                  defaultValue={current?.accountHolderName ?? employee.fullName}
                  maxLength={160}
                  name="accountHolderName"
                  required
                />
              </label>
              <label>
                <span>Account number or wallet ID</span>
                <input
                  aria-describedby="bank-account-number-help"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={48}
                  minLength={5}
                  name="accountNumber"
                  placeholder="Enter the account number or wallet ID once"
                  required
                />
              </label>
            </div>

            <div
              className={styles.bankSecurityNote}
              id="bank-account-number-help"
            >
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Protected bank details</strong>
                <p>The account number is encrypted when saved.</p>
              </div>
            </div>

            {bankAccountMfaEnabled ? (
              <div className={styles.bankMfaSection}>
                <PayrollHighRiskMfaFields actionLabel="Confirm bank account" />
              </div>
            ) : null}

            <div className={styles.bankEditActions}>
              <p>
                Saving creates a new bank version. Existing payroll runs and
                payment batches stay unchanged.
              </p>
              <button type="submit">
                {replacing ? "Save new account" : "Save bank account"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

function minimumEffectiveDate(currentEffectiveFrom: string | null) {
  const today = new Date();
  const minimum = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (currentEffectiveFrom) {
    const afterCurrent = new Date(currentEffectiveFrom);
    afterCurrent.setUTCDate(afterCurrent.getUTCDate() + 1);
    if (afterCurrent > minimum) minimum.setTime(afterCurrent.getTime());
  }
  return minimum.toISOString().slice(0, 10);
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
