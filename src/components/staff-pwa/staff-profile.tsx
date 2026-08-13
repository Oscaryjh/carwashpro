"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearEmployeeAuthFlow,
  isEmployeeSessionError,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import type { EmployeeProfile } from "@/lib/staff-pwa/types";
import { StaffLoading } from "./staff-auth";

export function StaffProfile({ deviceVerified = false }: { deviceVerified?: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await staffApiFetch<{ ok: true }>("/api/employee-auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // The local employee flow is cleared even if the already-expired session
      // cannot be revoked again.
    } finally {
      clearEmployeeAuthFlow();
      router.replace("/staff/login?reason=logged-out");
    }
  }

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
          This device is verified and your Employee Session is active.
        </div>
      ) : null}
      <section className="staff-profile-hero">
        <span>{initials(profile.employee.fullName)}</span>
        <div>
          <p className="staff-kicker">EMPLOYEE PROFILE</p>
          <h1>{profile.employee.fullName}</h1>
          <p>{profile.employee.employeeCode} · {humanize(profile.employee.employmentType)}</p>
        </div>
      </section>

      <section className="staff-page-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">WORKPLACE</p>
            <h2>{profile.workplace.businessName}</h2>
          </div>
          <span className="staff-status-chip">ACTIVE</span>
        </div>
        <p>{profile.workplace.primaryBranchName}</p>
        {profile.employee.position ? <small>{profile.employee.position}</small> : null}
      </section>

      <section className="staff-page-card">
        <div className="staff-card-heading">
          <div>
            <p className="staff-kicker">CURRENT DEVICE</p>
            <h2>{profile.device.displayName || "Verified device"}</h2>
          </div>
          <span className={`staff-status-chip ${profile.device.status.toLowerCase()}`}>
            {profile.device.status}
          </span>
        </div>
        <div className="staff-device-details">
          <Detail label="Platform" value={profile.device.platform || "Unknown"} />
          <Detail label="Browser" value={profile.device.browser || "Unknown"} />
          <Detail label="First verified" value={formatDateTime(profile.device.firstVerifiedAt)} />
          <Detail label="Last active" value={formatDateTime(profile.device.lastActiveAt)} />
          <Detail label="Can view" value={profile.capabilities.canView ? "Yes" : "No"} />
          <Detail label="Can punch" value={profile.capabilities.canPunch ? "Yes" : "No"} />
        </div>
        <p className="staff-form-hint">
          Additional clock-in devices must be verified through the secure OTP flow.
        </p>
      </section>

      {deviceVerified ? (
        <button className="staff-primary-button" onClick={() => router.replace("/staff")} type="button">
          Continue to Home
        </button>
      ) : null}
      <button className="staff-danger-button" disabled={busy} onClick={logout} type="button">
        {busy ? "Signing out…" : "Sign out of Staff App"}
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

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
