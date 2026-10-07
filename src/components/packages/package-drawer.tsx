"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./package-hub.module.css";
export function PackageDrawer({ title, customer, children }: { title: string; customer: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} className={styles.rowAction} type="button" aria-haspopup="dialog" aria-label={`View ${title} for ${customer}`} onClick={() => setOpen(true)}>View →</button>{open ? <Detail title={title} returnFocus={trigger.current} close={() => setOpen(false)}>{children}</Detail> : null}</>;
}
function Detail({ title, returnFocus, close, children }: { title: string; returnFocus: HTMLElement | null; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const d = ref.current; d?.showModal(); return () => { d?.close(); returnFocus?.focus(); }; }, [returnFocus]);
  return createPortal(<dialog ref={ref} className={styles.drawer} aria-labelledby={id} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}><header><h2 id={id}>{title}</h2><button autoFocus type="button" aria-label="Close package details" onClick={close}>×</button></header><div className={styles.drawerBody}>{children}</div></dialog>, document.body);
}
