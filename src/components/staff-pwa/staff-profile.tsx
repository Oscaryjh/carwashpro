"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isEmployeeSessionError, StaffApiError, staffApiFetch } from "@/lib/staff-pwa/client";
import {
  formatProfileActivity,
  formatProfileDate,
  humanizeProfileValue,
  safeDeviceBrowser,
  safeDevicePlatform,
} from "@/lib/staff-pwa/profile-v2";
import type { EmployeeProfile } from "@/lib/staff-pwa/types";
import { StaffAvatarUpload } from "./staff-avatar-upload";
import { useStaffShell } from "./staff-pwa-chrome";
import {
  StaffV2ButtonActionRow,
  StaffV2PageHeader,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles,
} from "./staff-v2-primitives";
import styles from "./staff-profile-v2.module.css";

export function StaffProfile({ deviceVerified = false }: { deviceVerified?: boolean }) {
  const router = useRouter();
  const { logout, openWorkplaceSwitcher, switching, workplaces } = useStaffShell();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadProfile = useCallback(async () => {
    setError("");
    try {
      const result = await staffApiFetch<{
        ok: true;
        authenticated: true;
        profile: EmployeeProfile;
      }>("/api/employee-auth/me");
      setProfile(result.profile);
    } catch (caught) {
      if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
        router.replace(
          `/staff/login?reason=${caught.code === "DEVICE_REVOKED" ? "device-revoked" : "session-expired"}`,
        );
        return;
      }
      setError("Check your connection and try again.");
    }
  }, [router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, reloadKey]);

  if (!profile && !error) return <StaffProfileLoading />;

  if (!profile) {
    return (
      <section aria-label="Profile" className={`${staffV2Styles.scope} ${styles.page}`}>
        <StaffV2PageHeader title="Profile" />
        <div className={`${styles.surface} ${styles.errorPanel}`} role="alert">
          <h2>Profile couldn&apos;t load.</h2>
          <p>{error}</p>
          <button className={styles.retryButton} onClick={() => setReloadKey((value) => value + 1)} type="button">
            Try again
          </button>
        </div>
      </section>
    );
  }

  const joinedAt = formatProfileDate(profile.employee.joinedAt);
  const authorizedOn = formatProfileDate(profile.device.firstVerifiedAt);
  const lastActive = formatProfileActivity(profile.device.lastActiveAt);
  const platform = safeDevicePlatform(profile.device.platform);
  const browser = safeDeviceBrowser(profile.device.browser);
  const deviceMeta = [platform, browser].filter(Boolean).join(" · ");

  return (
    <section aria-label="Profile" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Profile" />

      {deviceVerified ? (
        <div className={styles.verifiedNotice} role="status">
          This phone is authorized and ready to use.
        </div>
      ) : null}

      <section aria-labelledby="staff-profile-identity-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-identity-label">Identity</StaffV2SectionLabel>
        <div className={styles.identity}>
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
          <div className={styles.identityCopy}>
            <h2>{profile.employee.fullName}</h2>
            {profile.employee.position ? <p>{profile.employee.position}</p> : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="staff-profile-workplace-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-workplace-label">Current workplace</StaffV2SectionLabel>
        <div className={`${styles.surface} ${styles.workplace}`}>
          <div className={styles.workplaceCopy}>
            <strong>{profile.workplace.businessName}</strong>
            <span>{profile.workplace.primaryBranchName}</span>
          </div>
          {workplaces.length > 1 ? (
            <button
              aria-label={`Switch workplace from ${profile.workplace.businessName}`}
              className={styles.switchButton}
              disabled={switching}
              onClick={openWorkplaceSwitcher}
              type="button"
            >
              Switch workplace <span aria-hidden="true">›</span>
            </button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="staff-profile-employment-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-employment-label">Employment</StaffV2SectionLabel>
        <dl className={`${styles.surface} ${styles.facts}`}>
          <Fact label="Employee ID" value={profile.employee.employeeCode} />
          <Fact label="Employment type" value={humanizeProfileValue(profile.employee.employmentType)} />
          {joinedAt ? <Fact label="Started" value={joinedAt} /> : null}
        </dl>
      </section>

      <section aria-labelledby="staff-profile-phone-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-phone-label">This phone</StaffV2SectionLabel>
        <div className={styles.surface}>
          <div className={styles.phoneSummary}>
            <span aria-hidden="true" className={styles.phoneIcon}><PhoneIcon /></span>
            <span className={styles.phoneCopy}>
              <strong>This phone</strong>
              <span>This phone can access Staff App.</span>
            </span>
            <StaffV2StatusBadge tone="success">Authorized</StaffV2StatusBadge>
          </div>
          {lastActive ? (
            <dl className={styles.facts}>
              <Fact label="Last active" value={lastActive} />
            </dl>
          ) : null}
          <details className={styles.details}>
            <summary>About this phone</summary>
            <dl className={styles.facts}>
              <Fact label="Status" value="Authorized" />
              {deviceMeta ? <Fact label="Platform" value={deviceMeta} /> : null}
              {authorizedOn ? <Fact label="Authorized on" value={authorizedOn} /> : null}
              {lastActive ? <Fact label="Last active" value={lastActive} /> : null}
            </dl>
          </details>
        </div>
      </section>

      <section aria-labelledby="staff-profile-security-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-security-label">Security</StaffV2SectionLabel>
        <dl className={`${styles.surface} ${styles.facts}`}>
          <Fact label="Sign-in method" value="Phone verification" />
        </dl>
      </section>

      <section aria-labelledby="staff-profile-account-label" className={styles.section}>
        <StaffV2SectionLabel id="staff-profile-account-label">Account</StaffV2SectionLabel>
        <StaffV2ButtonActionRow
          ariaLabel="Sign out of Staff App"
          disabled={switching}
          leading={<SignOutIcon />}
          meta="Sign out of Staff App on this phone"
          onClick={() => void logout()}
          title={switching ? "Signing out…" : "Sign out"}
          tone="danger"
        />
      </section>
    </section>
  );
}

export function StaffProfileLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Profile" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Profile" meta="Loading…" />
      <div className={styles.identity}>
        <span className={`${styles.skeleton} ${styles.skeletonAvatar}`} />
        <span>
          <span className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <span className={`${styles.skeleton} ${styles.skeletonMeta}`} />
        </span>
      </div>
      {["Current workplace", "Employment", "This phone", "Security", "Account"].map((label) => (
        <section aria-label={label} className={styles.section} key={label}>
          <StaffV2SectionLabel>{label}</StaffV2SectionLabel>
          <span className={`${styles.skeleton} ${styles.skeletonPanel}`} />
        </section>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={styles.factRow}><dt>{label}</dt><dd>{value}</dd></div>;
}

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function PhoneIcon() {
  return <svg viewBox="0 0 24 24"><rect height="18" rx="3" width="12" x="6" y="3" /><path d="M10 18h4" /></svg>;
}

function SignOutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}
