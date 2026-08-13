import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createEmployeeBankVersionAction } from "@/app/(business)/team/people/[personId]/payroll/actions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { salaryBankOptions } from "@/lib/payroll/payment/bank-directory";
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
  const errorMessage = query.type === "error" ? query.message?.slice(0, 180) : null;

  return (
    <main className={styles.page}>
      <Link
        className={styles.backLink}
        href={`/team/people/${employee.id}?section=payroll`}
      >
        Back to payroll profile
      </Link>

      <section className={styles.sectionContent}>
        <header className={styles.sectionIntro}>
          <div>
            <p className={styles.eyebrow}>Bank details</p>
            <h2>{replacing ? "Replace salary bank account" : "Add salary bank account"}</h2>
            <p>
              {employee.fullName}
              {employee.employeeCode ? ` · ${employee.employeeCode}` : ""}
            </p>
          </div>
          <span className={styles.scopeBadge}>Encrypted profile</span>
        </header>

        {errorMessage ? (
          <div className={styles.payrollUpdateNotice} data-status="error" role="alert">
            <div>
              <strong>Bank account not saved</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        ) : null}

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Current profile</p>
              <h3>{current ? current.bankName : "No bank account configured"}</h3>
              <p>
                {current
                  ? `Account •••• ${current.last4} · Revision ${current.revision}`
                  : "The account number field below starts blank and is never prefilled."}
              </p>
            </div>
            <span>{current ? formatStatus(current.status) : "New"}</span>
          </div>

          <form action={createEmployeeBankVersionAction} className={styles.payrollEditForm}>
            <input name="commandId" type="hidden" value={randomUUID()} />
            <input
              name="expectedRevision"
              type="hidden"
              value={current?.revision ?? 0}
            />
            <input name="membershipId" type="hidden" value={employee.id} />
            <input
              name="reasonType"
              type="hidden"
              value={current ? "ACCOUNT_CHANGE" : "INITIAL_SETUP"}
            />

            <div className={styles.payrollFormGrid}>
              <label>
                <span>Bank</span>
                <select defaultValue={selectedBankCode} name="bankCode" required>
                  {salaryBankOptions.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
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
                <span>Account number</span>
                <input
                  aria-describedby="bank-account-number-help"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={48}
                  minLength={5}
                  name="accountNumber"
                  placeholder="Enter the new account number once"
                  required
                />
              </label>
              <label>
                <span>Effective date</span>
                <input
                  defaultValue={effectiveDate}
                  min={effectiveDate}
                  name="effectiveFrom"
                  required
                  type="date"
                />
              </label>
              <label className={styles.reasonField}>
                <span>Reason</span>
                <textarea
                  maxLength={500}
                  minLength={5}
                  name="reason"
                  placeholder="Explain why this salary bank profile is being added or replaced"
                  required
                  rows={4}
                />
              </label>
            </div>

            <p className={styles.formHint} id="bank-account-number-help">
              The full account number is encrypted on save and is never returned to this form.
            </p>
            <div className={styles.draftImpactWarning}>
              <strong>Existing payment batches are not updated automatically</strong>
              <span>
                Saving creates a new immutable bank version. It does not rewrite an existing
                instruction, Payroll Run, payslip, or prior bank version.
              </span>
            </div>
            <PayrollHighRiskMfaFields actionLabel="Save this employee bank-account change" />
            <button type="submit">
              {replacing ? "Save replacement bank account" : "Save salary bank account"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function minimumEffectiveDate(currentEffectiveFrom: string | null) {
  const today = new Date();
  const minimum = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ));
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
