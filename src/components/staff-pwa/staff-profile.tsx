"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  isEmployeeSessionError,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import type { EmployeeProfile } from "@/lib/staff-pwa/types";
import { StaffLoading } from "./staff-auth";
import { StaffAvatarUpload } from "./staff-avatar-upload";
import { useStaffShell } from "./staff-pwa-chrome";

export function StaffProfile({ deviceVerified = false }: { deviceVerified?: boolean }) {
  const router = useRouter();
  const { logout, switching } = useStaffShell();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void staffApiFetch<{ ok: true; authenticated: true; profile: EmployeeProfile }>(
      "/api/employee-auth/me",
    )
      .then((result) => {
        if (active) setProfile(result.profile);
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
          router.replace(
            `/staff/login?reason=${
              caught.code === "DEVICE_REVOKED" ? "device-revoked" : "session-expired"
            }`,
          );
          return;
        }
        setError(
          caught instanceof StaffApiError ? caught.message : "Unable to load profile.",
        );
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (!profile && !error) {
    return <StaffLoading label="Loading your profile…" />;
  }
  if (!profile) {
    return <div className="staff-alert error" role="alert">{error}</div>;
  }

  return (
    <div className="staff-profile-stack">
      {deviceVerified ? (
        <div className="staff-alert success" role="status">
          This phone is verified. You can continue securely.
        </div>
      ) : null}
      <section className="staff-profile-hero">
        <StaffAvatarUpload
          avatarUrl={profile.employee.avatarUrl}
          fullName={profile.employee.fullName}
          initials={initials(profile.employee.fullName)}
          onUpdated={(avatarUrl) => {
            setProfile((current) => current ? {
              ...current,
              employee: { ...current.employee, avatarUrl },
            } : current);
            router.refresh();
          }}
        />
        <div className="staff-profile-identity">
          <p className="staff-kicker">EMPLOYEE PROFILE</p>
          <h1>{profile.employee.fullName}</h1>
          <p className="staff-profile-meta">
            <span>{humanize(profile.employee.employmentType)}</span>
            <code>{profile.employee.employeeCode}</code>
          </p>
        </div>
      </section>

      <section className="staff-page-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">CURRENT WORKPLACE</p>
            <h2>{profile.workplace.businessName}</h2>
          </div>
          <span className="staff-status-chip active">ACTIVE</span>
        </div>
        <p>{profile.workplace.primaryBranchName}</p>
        {profile.employee.position ? <small>{profile.employee.position}</small> : null}
      </section>

      <section className="staff-page-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">EMPLOYMENT</p>
            <h2>My work details</h2>
          </div>
          <span className="staff-status-chip active">
            {humanize(profile.employee.employmentStatus)}
          </span>
        </div>
        <div className="staff-device-details staff-employment-details">
          <Detail label="Employee no." value={profile.employee.employeeCode} />
          <Detail label="Employment type" value={humanize(profile.employee.employmentType)} />
          <Detail label="Position" value={profile.employee.position || "Not specified"} />
          <Detail label="Start date" value={formatDate(profile.employee.joinedAt)} />
        </div>
      </section>

      <section className="staff-page-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">THIS PHONE</p>
            <h2>Signed in</h2>
          </div>
          <span className={`staff-status-chip ${profile.device.status.toLowerCase()}`}>
            {profile.device.status === "ACTIVE" ? "Signed in" : humanize(profile.device.status)}
          </span>
        </div>
        <p className="staff-form-hint">You may be asked for a one-time code when signing in on a new phone.</p>
        <details className="staff-security-details">
          <summary>About this phone</summary>
          <div className="staff-device-details">
            <Detail label="This phone" value={profile.device.displayName || profile.device.platform || "Verified phone"} />
            <Detail label="Signed in" value={formatDateTime(profile.device.firstVerifiedAt)} />
            <Detail label="Last active" value={formatDateTime(profile.device.lastActiveAt)} />
          </div>
        </details>
      </section>

      {deviceVerified ? (
        <button className="staff-primary-button" onClick={() => router.replace("/staff")} type="button">
          Continue to Home
        </button>
      ) : null}
      <button className="staff-danger-button" disabled={switching} onClick={() => void logout()} type="button">
        {switching ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(new Date(value));
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
