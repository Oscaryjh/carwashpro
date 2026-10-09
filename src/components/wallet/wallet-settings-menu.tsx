"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./wallet-hub.module.css";

/** Navigation only; reuse the app's native details/summary disclosure pattern. */
export function WalletSettingsMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return <details ref={ref} className={styles.settings}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}
    onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary>Settings <span aria-hidden="true">▾</span></summary>
    <div className={styles.settingsMenu}><Link href="/crm/wallet/offers" onClick={() => { if (ref.current) ref.current.open = false; }}>Manage Top-up</Link></div>
  </details>;
}
