"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type ReportDrawerShellProps = {
  ariaLabelledBy: string;
  children: ReactNode;
  closeHref: string;
};

export function ReportDrawerShell({
  ariaLabelledBy,
  children,
  closeHref,
}: ReportDrawerShellProps) {
  const router = useRouter();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(closeHref);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeHref, router]);

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) router.push(closeHref);
  };

  return (
    <div
      className="report-drawer-backdrop"
      onMouseDown={closeFromBackdrop}
      role="presentation"
    >
      <button
        aria-label="Close report details"
        className="report-drawer-dismiss"
        onClick={() => router.push(closeHref)}
        type="button"
      />
      <aside
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        className="report-day-drawer"
        role="dialog"
      >
        {children}
      </aside>
    </div>
  );
}
