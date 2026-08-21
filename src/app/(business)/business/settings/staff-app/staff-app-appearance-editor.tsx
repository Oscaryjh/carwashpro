"use client";

import { useActionState, useEffect, useState } from "react";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import {
  STAFF_APP_DOMAINS,
  STAFF_APP_DOMAIN_LABELS,
  STAFF_APP_ICON_OPTIONS,
  type StaffAppAppearance,
  type StaffAppDomain,
  type StaffAppIconName,
} from "@/lib/staff-pwa/appearance-config";
import {
  initialStaffAppAppearanceActionState,
  updateStaffAppAppearanceAction,
} from "./actions";
import styles from "./staff-app-appearance.module.css";

export function StaffAppAppearanceEditor({
  appearance,
  businessName,
}: {
  appearance: StaffAppAppearance;
  businessName: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateStaffAppAppearanceAction,
    initialStaffAppAppearanceActionState,
  );
  const [icons, setIcons] = useState({ ...appearance.quickAccessIcons });
  const [savedLogoUrl, setSavedLogoUrl] = useState(appearance.logoUrl);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!state.appearance) return;
    setIcons({ ...state.appearance.quickAccessIcons });
    setSavedLogoUrl(state.appearance.logoUrl);
    setLogoPreviewUrl(null);
  }, [state.appearance]);

  useEffect(() => () => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
  }, [logoPreviewUrl]);

  function updateIcon(domain: StaffAppDomain, value: StaffAppIconName) {
    setIcons((current) => ({ ...current, [domain]: value }));
  }

  function previewLogo(file: File | undefined) {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  const logoUrl = logoPreviewUrl ?? savedLogoUrl;

  return (
    <form action={formAction} className={styles.workspace}>
      <div className={styles.controls}>
        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div><h2>Staff App logo</h2><p>Only the Staff App header changes. Your company and invoice logo stay untouched.</p></div>
          </div>
          <label className={styles.logoPicker}>
            <span className={styles.logoSample}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="Staff App logo preview" src={logoUrl} />
              ) : <b>T</b>}
            </span>
            <span><strong>Choose logo</strong><small>PNG, JPG or WebP · maximum 2MB</small></span>
            <input
              accept="image/png,image/jpeg,image/webp"
              name="logo"
              onChange={(event) => previewLogo(event.target.files?.[0])}
              type="file"
            />
          </label>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <span>02</span>
            <div><h2>Quick Access icons</h2><p>Choose one clear symbol for each Staff App function.</p></div>
          </div>
          <div className={styles.iconRows}>
            {STAFF_APP_DOMAINS.map((domain) => (
              <label className={styles.iconRow} key={domain}>
                <span className={styles.iconSample} aria-hidden="true"><StaffAppIcon name={icons[domain]} /></span>
                <span><strong>{STAFF_APP_DOMAIN_LABELS[domain]}</strong><small>Home shortcut</small></span>
                <select
                  name={`icon_${domain}`}
                  onChange={(event) => updateIcon(domain, event.target.value as StaffAppIconName)}
                  value={icons[domain]}
                >
                  {STAFF_APP_ICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        {state.message ? (
          <p className={state.status === "error" ? styles.error : styles.success} role={state.status === "error" ? "alert" : "status"}>
            {state.message}
          </p>
        ) : null}

        <div className={styles.actions}>
          <button className={styles.saveButton} disabled={pending} name="intent" type="submit" value="save">
            {pending ? "Saving…" : "Save appearance"}
          </button>
          <button className={styles.resetButton} disabled={pending} name="intent" type="submit" value="reset">
            Restore defaults
          </button>
        </div>
      </div>

      <aside className={styles.previewColumn} aria-label="iPhone Staff App preview">
        <div className={styles.previewHeading}><span>LIVE PREVIEW</span><strong>iPhone</strong></div>
        <div className={styles.phone}>
          <div className={styles.phoneStatus}><b>9:41</b><span>● ● ▰</span></div>
          <div className={styles.phoneHeader}>
            <span className={styles.phoneLogo}>{logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={logoUrl} />
            ) : "T"}</span>
            <strong>Tetamu<small>Staff App</small></strong>
          </div>
          <div className={styles.phoneWelcome}><small>TODAY</small><strong>Hello</strong><span>{businessName}</span></div>
          <div className={styles.phoneSectionTitle}><small>MY WORKSPACE</small><strong>Quick access</strong></div>
          <div className={styles.phoneGrid}>
            {STAFF_APP_DOMAINS.map((domain) => (
              <div key={domain}><span><StaffAppIcon name={icons[domain]} /></span><small>{STAFF_APP_DOMAIN_LABELS[domain]}</small></div>
            ))}
          </div>
          <div className={styles.phoneNav}><span>⌂<small>Home</small></span><span>◷<small>Attendance</small></span><span>○<small>More</small></span></div>
        </div>
      </aside>
    </form>
  );
}
