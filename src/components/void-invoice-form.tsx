"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  voidInvoiceAction,
  type VoidInvoiceState,
} from "@/app/(business)/invoices/actions";
import { useFinancialOperationId } from "@/hooks/use-financial-operation-id";

type VoidInvoiceFormProps = {
  invoiceId: string;
  invoiceNumber: string;
  onSuccess?: () => void;
};

const initialState: VoidInvoiceState = {
  status: "idle",
  message: "",
};

export function VoidInvoiceForm({
  invoiceId,
  invoiceNumber,
  onSuccess,
}: VoidInvoiceFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    voidInvoiceAction,
    initialState,
  );
  const { operationId, rotateOperationId } = useFinancialOperationId("invoice-void");

  useEffect(() => {
    if (state.status === "success") {
      rotateOperationId();
      router.refresh();
      onSuccess?.();
    }
  }, [onSuccess, rotateOperationId, router, state.status]);

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
      <input type="hidden" name="operationId" value={operationId} />
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
