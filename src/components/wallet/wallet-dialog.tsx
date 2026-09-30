"use client";
import { useEffect, useRef, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function WalletDialog({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className="wallet-dialog wallet-ui" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <header><h2 id={heading}>{title}</h2><button type="button" className="secondary" aria-label="Close" disabled={locked} onClick={onClose}>×</button></header>
    {children}
  </dialog>, document.body);
}
