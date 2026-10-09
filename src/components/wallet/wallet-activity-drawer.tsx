"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./wallet-hub.module.css";

/** Read-only detail; opening it never changes the URL or submits a request. */
export function WalletActivityDrawer({ title, amount, date, customer, children }: { title: string; amount: string; date: string; customer: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} type="button" className={styles.rowAction} aria-label={`View ${title} for ${customer}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>›</button>
    {open ? <Drawer title={title} returnFocus={trigger.current} onClose={() => setOpen(false)}><div className={styles.drawerSummary}><strong>{amount}</strong><span>{date}</span><span>{customer}</span></div>{children}</Drawer> : null}</>;
}
function Drawer({ title, children, onClose, returnFocus }: { title: string; children: ReactNode; onClose: () => void; returnFocus: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); returnFocus?.focus(); };
  }, [returnFocus]);
  return createPortal(<dialog ref={ref} className={styles.drawer} aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const b = event.currentTarget.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose(); } }}>
    <header><h2 id={heading}>{title}</h2><button autoFocus type="button" className={styles.rowAction} aria-label="Close wallet details" onClick={onClose}>×</button></header><div className={styles.drawerBody}>{children}</div>
  </dialog>, document.body);
}
