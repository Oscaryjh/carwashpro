"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./package-hub.module.css";
export function PackageSettingsMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const close = (e: PointerEvent) => { if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) ref.current.open = false; }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, []);
  return <details ref={ref} className={styles.settings} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary>Settings <span aria-hidden="true">▾</span></summary><div><Link href="/packages" onClick={() => { if (ref.current) ref.current.open = false; }}>Manage Packages</Link></div></details>;
}
