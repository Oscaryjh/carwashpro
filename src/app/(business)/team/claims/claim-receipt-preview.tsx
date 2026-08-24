"use client";

import { useRef, useState } from "react";
import styles from "./claim-receipt-preview.module.css";

type ReceiptAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
};

type ClaimReceiptPreviewProps = {
  attachments: ReceiptAttachment[];
  category: string;
  amount: string;
  expenseDate: string;
  merchant?: string | null;
};

export function ClaimReceiptPreview({ attachments, category, amount, expenseDate, merchant }: ClaimReceiptPreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const activeReceipt = attachments[activeIndex] ?? attachments[0];

  if (!activeReceipt) return <span className={styles.noReceipt}>No receipt</span>;

  const receiptUrl = `/api/claims/attachments/${activeReceipt.id}?audience=business`;
  const receiptLabel = attachments.length === 1 ? "View receipt" : `View receipts · ${attachments.length}`;

  function openPreview() {
    setActiveIndex(0);
    setPreviewFailed(false);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <button className={styles.receiptButton} type="button" onClick={openPreview}>
        <ReceiptIcon />
        <span>{receiptLabel}</span>
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={`receipt-title-${activeReceipt.id}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <section className={styles.card}>
          <header className={styles.header}>
            <div className={styles.titleBlock}>
              <span className={styles.eyebrow}>CLAIM RECEIPT</span>
              <h2 id={`receipt-title-${activeReceipt.id}`}>Receipt preview</h2>
              <p>Check the receipt without leaving this claim.</p>
            </div>
            <button className={styles.closeButton} type="button" aria-label="Close receipt preview" onClick={() => dialogRef.current?.close()}>
              <CloseIcon />
            </button>
          </header>

          <div className={styles.summary}>
            <div><span>Category</span><strong>{category}</strong></div>
            <div><span>Expense date</span><strong>{expenseDate}</strong></div>
            {merchant ? <div><span>Merchant</span><strong>{merchant}</strong></div> : null}
            <div><span>Claimed amount</span><strong className={styles.amount}>{amount}</strong></div>
          </div>

          {attachments.length > 1 ? (
            <nav className={styles.receiptTabs} aria-label="Attached receipts">
              {attachments.map((attachment, index) => (
                <button
                  type="button"
                  key={attachment.id}
                  className={index === activeIndex ? styles.activeReceipt : styles.receiptTab}
                  onClick={() => {
                    setActiveIndex(index);
                    setPreviewFailed(false);
                  }}
                >
                  Receipt {index + 1}
                </button>
              ))}
            </nav>
          ) : null}

          <div className={styles.preview}>
            {previewFailed ? (
              <div className={styles.unsupportedPreview}>
                <ReceiptIcon />
                <strong>Receipt preview is unavailable</strong>
                <span>You can still open the original attachment below.</span>
              </div>
            ) : activeReceipt.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated receipt routes cannot use the image optimizer.
              <img key={activeReceipt.id} src={receiptUrl} alt={`Receipt for ${category}`} onError={() => setPreviewFailed(true)} />
            ) : activeReceipt.mimeType === "application/pdf" ? (
              <iframe key={activeReceipt.id} src={receiptUrl} title={`Receipt: ${activeReceipt.fileName}`} />
            ) : (
              <div className={styles.unsupportedPreview}>
                <ReceiptIcon />
                <strong>Preview is not available for this file type</strong>
                <span>Open the original attachment to view it.</span>
              </div>
            )}
          </div>

          <footer className={styles.footer}>
            <div>
              <strong>{activeReceipt.fileName}</strong>
              <span>{formatMimeType(activeReceipt.mimeType)}</span>
            </div>
            <a href={receiptUrl} target="_blank" rel="noreferrer">Open original</a>
          </footer>
        </section>
      </dialog>
    </>
  );
}

function formatMimeType(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF document";
  if (mimeType.startsWith("image/")) return `${mimeType.slice(6).toUpperCase()} image`;
  return "Receipt attachment";
}

function ReceiptIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M7 3.75h10a1.25 1.25 0 0 1 1.25 1.25v15l-2.1-1.25L14.1 20l-2.1-1.25L9.9 20l-2.05-1.25L5.75 20V5A1.25 1.25 0 0 1 7 3.75Z"/><path d="M9 8h6M9 12h6M9 16h3.5"/></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17"/></svg>;
}
