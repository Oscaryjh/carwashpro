"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./ask-tetamu.module.css";

export function AskTetamuChatFrame({ sidebar, header, children }: { sidebar: ReactNode; header: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setAvailableHeight(Math.max(320, window.innerHeight - (frame.getBoundingClientRect().top + (frame.closest("main")?.scrollTop ?? window.scrollY)) - 16));
    measure();
    const observer = new ResizeObserver(measure);
    if (frame.parentElement) observer.observe(frame.parentElement);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <section ref={frameRef} style={availableHeight ? { height: availableHeight } : undefined} className={styles.chatWorkspace} aria-label="Ask Tetamu workspace" onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); toggleRef.current?.focus(); } }}>
    <button ref={toggleRef} type="button" className={styles.conversationsToggle} aria-expanded={open} aria-controls="ask-conversations-panel" onClick={() => setOpen(!open)}>Conversations <span aria-hidden="true">{open ? "−" : "+"}</span></button>
    <aside id="ask-conversations-panel" className={`${styles.chatSidebar} ${open ? styles.chatSidebarOpen : ""}`} aria-label="Conversations" onClick={(event) => { if ((event.target as HTMLElement).closest("a, [data-conversation-navigation]")) setOpen(false); }}>{sidebar}</aside>
    <div className={styles.chatMain}>
      {header}
      {children}
    </div>
  </section>;
}

export function AskTetamuNewChat({ href }: { href: string }) {
  const router = useRouter();
  return <button type="button" data-conversation-navigation aria-label="Start a new conversation" onClick={() => router.push(href)}>+ New chat</button>;
}
