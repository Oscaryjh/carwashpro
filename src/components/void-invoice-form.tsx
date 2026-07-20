"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  voidInvoiceAction,
  type VoidInvoiceState,
} from "@/app/invoices/actions";

type VoidInvoiceFormProps = {
  invoiceId: string;
  invoiceNumber: string;
};

const initialState: VoidInvoiceState = {
  status: "idle",
  message: "",
};

export function VoidInvoiceForm({
  invoiceId,
  invoiceNumber,
}: VoidInvoiceFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    voidInvoiceAction,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form
      action={formAction}
      className="danger-zone-form"
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Void invoice ${invoiceNumber}? Related active payments will be marked void and this order will reopen for cashier correction.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label>
        <span>Void reason</span>
        <textarea
          name="voidReason"
          rows={3}
          placeholder="Example: Wrong payment amount entered at checkout"
          required
        />
      </label>
      <button className="danger-button" type="submit" disabled={pending}>
        {pending ? "Voiding..." : "Void invoice"}
      </button>
      {state.status !== "idle" ? (
        <p className={`form-message ${state.status}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
