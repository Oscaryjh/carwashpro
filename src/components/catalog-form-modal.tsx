"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

type CatalogFormModalProps = {
  ariaLabel: string;
  children: ReactNode;
  closePath: string;
  eyebrow: string;
  title: string;
  wide?: boolean;
};

export function CatalogFormModal({
  ariaLabel,
  children,
  closePath,
  eyebrow,
  title,
  wide = false,
}: CatalogFormModalProps) {
  const router = useRouter();
  const closeModal = useCallback(() => router.replace(closePath), [closePath, router]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

  return (
    <div
      className="product-create-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
      role="presentation"
    >
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className={`product-create-modal${wide ? " catalog-form-modal-wide" : ""}`}
        role="dialog"
      >
        <header className="product-create-modal-header">
          <button
            aria-label={`Close ${ariaLabel}`}
            className="product-create-modal-close"
            onClick={closeModal}
            type="button"
          >
            X
          </button>
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <span aria-hidden="true" className="product-create-modal-mark">+</span>
        </header>
        <div className="product-create-modal-body catalog-form-modal-body">{children}</div>
      </section>
    </div>
  );
}
