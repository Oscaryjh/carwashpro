import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import {
  deriveOtpSupportStatus,
  formatSupportPhone,
  maskProviderReference,
  otpSupportStatusDescription,
  otpSupportStatusLabel,
  type OtpSupportStatus,
} from "@/lib/attendance/employee-auth/otp-support";
import { prisma } from "@/lib/prisma";
import styles from "./otp-support.module.css";

type OtpSupportPageProps = {
  searchParams: Promise<{
    q?: string;
    range?: string;
    status?: string;
  }>;
};

const STATUS_OPTIONS: OtpSupportStatus[] = [
  "SENT",
  "VERIFIED",
  "DELIVERY_FAILED",
  "EXPIRED",
  "INVALIDATED",
  "PENDING",
];

const RANGE_OPTIONS = {
  "24h": { hours: 24, label: "Last 24 hours" },
  "7d": { hours: 24 * 7, label: "Last 7 days" },
  "30d": { hours: 24 * 30, label: "Last 30 days" },
} as const;

export default async function OtpSupportPage({ searchParams }: OtpSupportPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const rangeKey = isRangeKey(params.range) ? params.range : "7d";
  const selectedStatus = isOtpSupportStatus(params.status) ? params.status : "";
  const now = new Date();
  const from = new Date(now.getTime() - RANGE_OPTIONS[rangeKey].hours * 60 * 60 * 1000);

  const where: Prisma.EmployeeOtpChallengeWhereInput = {
    createdAt: { gte: from },
    ...(query
      ? {
          OR: [
            { phoneNumberNormalized: { contains: query } },
            {
              employeeAccount: {
                is: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" as const } },
                    { phoneNormalized: { contains: query } },
                    {
                      memberships: {
                        some: {
                          OR: [
                            { fullName: { contains: query, mode: "insensitive" as const } },
                            { employeeCode: { contains: query, mode: "insensitive" as const } },
                            { business: { name: { contains: query, mode: "insensitive" as const } } },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const challenges = await prisma.employeeOtpChallenge.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      phoneNumberNormalized: true,
      purpose: true,
      provider: true,
      deliveryChannel: true,
      providerReference: true,
      deliveryAcceptedAt: true,
      expiresAt: true,
      attempts: true,
      maxAttempts: true,
      verifiedAt: true,
      invalidatedAt: true,
      createdAt: true,
      employeeAccount: {
        select: {
          id: true,
          name: true,
          status: true,
          memberships: {
            orderBy: { joinedAt: "desc" },
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              status: true,
              business: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const failureAudits = challenges.length
    ? await prisma.auditLog.findMany({
        where: {
          action: "STAFF_OTP_SEND_FAILED",
          entityType: "EmployeeOtpChallenge",
          entityId: { in: challenges.map((challenge) => challenge.id) },
        },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, metadata: true },
      })
    : [];
  const failureByChallenge = new Map<string, OtpFailureDetail>();
  for (const audit of failureAudits) {
    if (!audit.entityId || failureByChallenge.has(audit.entityId)) continue;
    const detail = readOtpFailureDetail(audit.metadata);
    if (detail) failureByChallenge.set(audit.entityId, detail);
  }

  const rows = challenges
    .map((challenge) => ({
      ...challenge,
      supportStatus: deriveOtpSupportStatus(challenge, now),
      failureDetail: failureByChallenge.get(challenge.id) ?? null,
    }))
    .filter((challenge) => !selectedStatus || challenge.supportStatus === selectedStatus);

  const statusCounts = Object.fromEntries(
    STATUS_OPTIONS.map((status) => [
      status,
      challenges.filter((challenge) => deriveOtpSupportStatus(challenge, now) === status).length,
    ]),
  ) as Record<OtpSupportStatus, number>;
  const needsAttention = statusCounts.DELIVERY_FAILED + statusCounts.EXPIRED;
  const hasFilters = Boolean(query || selectedStatus || rangeKey !== "7d");

  return (
    <AppShell user={user}>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Platform administration</p>
            <h1>OTP support</h1>
            <p>
              Check which phone number was used and whether the SMS provider accepted or verified the
              request. Use this page to diagnose delivery without exposing login codes.
            </p>
          </div>
          <div className={styles.heroBadge}>
            <strong>{needsAttention}</strong>
            <span>need attention</span>
          </div>
        </header>

        <section className={styles.securityNotice} aria-label="OTP security boundary">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Login codes remain private</strong>
            <p>
              Login codes are never shown here. Tetamu stores only a secure hash, so
              support staff cannot use an employee&apos;s login code.
            </p>
          </div>
        </section>

        <section className={styles.metrics} aria-label="OTP delivery summary">
          <Metric label="Requests" value={challenges.length} note={RANGE_OPTIONS[rangeKey].label} />
          <Metric label="Sent to provider" value={statusCounts.SENT} note="Accepted for delivery" />
          <Metric label="Verified" value={statusCounts.VERIFIED} note="Login code completed" />
          <Metric label="Failed or expired" value={needsAttention} note="Support may be needed" />
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Recent verification requests</h2>
              <p>Phone numbers are shown only to authorized platform administrators.</p>
            </div>
            <span>{rows.length} shown</span>
          </div>

          <form action="/admin/otp-support" className={styles.filters}>
            <label>
              <span>Employee or phone</span>
              <input defaultValue={query} name="q" placeholder="Name, employee code or +60 number" />
            </label>
            <label>
              <span>Status</span>
              <select defaultValue={selectedStatus} name="status">
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {otpSupportStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Period</span>
              <select defaultValue={rangeKey} name="range">
                {Object.entries(RANGE_OPTIONS).map(([value, option]) => (
                  <option key={value} value={value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Apply filters</button>
            {hasFilters ? <Link href="/admin/otp-support">Clear</Link> : null}
          </form>

          {rows.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Phone used</th>
                    <th>Status</th>
                    <th>Request</th>
                    <th>Provider</th>
                    <th>Time</th>
                    <th>Support action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const primaryMembership = row.employeeAccount?.memberships[0];
                    const businesses = unique(
                      row.employeeAccount?.memberships.map((item) => item.business.name) ?? [],
                    );
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.employeeAccount?.name ?? "No employee matched"}</strong>
                          <small>
                            {primaryMembership
                              ? `${primaryMembership.employeeCode} · ${businesses.join(", ")}`
                              : "Check whether the number was entered correctly"}
                          </small>
                        </td>
                        <td>
                          <span className={styles.phone}>{formatSupportPhone(row.phoneNumberNormalized)}</span>
                          <small>Sensitive support data</small>
                        </td>
                        <td>
                          <span className={`${styles.status} ${styles[`status${row.supportStatus}`]}`}>
                            {otpSupportStatusLabel(row.supportStatus)}
                          </span>
                          <small>{otpSupportStatusDescription(row.supportStatus)}</small>
                        </td>
                        <td>
                          <span>{purposeLabel(row.purpose)}</span>
                          <small>
                            {row.attempts} of {row.maxAttempts} checks used
                          </small>
                        </td>
                        <td>
                          <span>{providerLabel(row.provider, row.deliveryChannel)}</span>
                          <small>Ref {maskProviderReference(row.providerReference)}</small>
                          {row.failureDetail ? (
                            <small className={styles.providerFailure}>
                              {row.failureDetail.reason}
                              {row.failureDetail.providerCode
                                ? ` (${row.failureDetail.providerCode})`
                                : ""}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span>{formatDateTime(row.createdAt)}</span>
                          <small>
                            {row.verifiedAt
                              ? `Verified ${formatDateTime(row.verifiedAt)}`
                              : `Expires ${formatDateTime(row.expiresAt)}`}
                          </small>
                        </td>
                        <td>
                          {primaryMembership ? (
                            <Link href={`/team/people/${primaryMembership.id}`}>
                              Check employee profile
                            </Link>
                          ) : (
                            <span className={styles.noAction}>Ask employee to re-enter the number</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>No OTP requests match these filters</strong>
              <p>Try a longer period or clear the current search.</p>
            </div>
          )}
        </section>

        <section className={styles.helpPanel}>
          <div>
            <strong>Customer did not receive the SMS?</strong>
            <p>
              First confirm the phone shown above. If the provider accepted the request, ask the
              employee to wait briefly, check carrier filtering and use Resend on the same
              device. Do not resend from Admin because Staff login is device-bound.
            </p>
          </div>
          <Link href="/staff/login" target="_blank">Open Staff login</Link>
        </section>
      </main>
    </AppShell>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function isOtpSupportStatus(value: string | undefined): value is OtpSupportStatus {
  return STATUS_OPTIONS.includes(value as OtpSupportStatus);
}

function isRangeKey(value: string | undefined): value is keyof typeof RANGE_OPTIONS {
  return Boolean(value && value in RANGE_OPTIONS);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function purposeLabel(value: string) {
  return value === "REGISTER_DEVICE" ? "Register this device" : "Staff login";
}

function providerLabel(provider: string, channel: string) {
  if (provider === "twilio_verify") return `Twilio Verify · ${channel.toUpperCase()}`;
  if (provider === "mock") return "Local test provider";
  return `${provider} · ${channel}`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

type OtpFailureDetail = Readonly<{
  providerCode: string | null;
  reason: string;
}>;

function readOtpFailureDetail(metadata: Prisma.JsonValue | null): OtpFailureDetail | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, Prisma.JsonValue>;
  const providerCode =
    typeof record.providerCode === "string" || typeof record.providerCode === "number"
      ? String(record.providerCode)
      : null;
  const reason = typeof record.providerReason === "string" ? record.providerReason : "";
  return reason ? { providerCode, reason } : null;
}
