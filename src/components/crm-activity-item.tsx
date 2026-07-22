"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AppointmentInvoiceModal,
  type InvoiceModalSummary,
} from "@/components/appointment-invoice-modal";

type CrmActivityItemProps = {
  amount?: string;
  description: string;
  href?: string;
  invoice?: InvoiceModalSummary;
  label: string;
  title: string;
  when: string;
};

export function CrmActivityItem({
  amount,
  description,
  href,
  invoice,
  label,
  title,
  when,
}: CrmActivityItemProps) {
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const content = (
    <>
      <span className="crm-activity-type">{label}</span>
      <span className="crm-activity-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="crm-activity-meta">
        {amount ? <strong>{amount}</strong> : null}
        <time>{when}</time>
      </span>
    </>
  );

  return (
    <>
      {invoice ? (
        <button
          className="crm-activity-row"
          onClick={() => setIsInvoiceOpen(true)}
          type="button"
        >
          {content}
        </button>
      ) : href ? (
        <Link className="crm-activity-row" href={href}>
          {content}
        </Link>
      ) : (
        <div className="crm-activity-row">{content}</div>
      )}

      {isInvoiceOpen && invoice ? (
        <AppointmentInvoiceModal
          invoice={invoice}
          onClose={() => setIsInvoiceOpen(false)}
        />
      ) : null}
    </>
  );
}
