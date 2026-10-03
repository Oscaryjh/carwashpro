"use client";

import { useActionState, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type State = { message: string; values: [string, string][]; attempt: number };
export type PaymentFormAction = (data: FormData) => Promise<void | { code: "CASHIER_SHIFT_MODE_CHANGED"; message: string }>;

/** Keep the cart, entered amounts and idempotency key after a rejected/uncertain payment. */
export function SafePaymentForm({ action, className, children, cashierActivity }: {
  action: PaymentFormAction; className?: string; children: ReactNode;
  cashierActivity?: { modeAtConfirmation: "ON" | "OFF"; shiftId: string | null };
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const confirmation = useRef<typeof cashierActivity>(undefined);
  const needsReview = useRef(false);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [state, submit] = useActionState(async (previous: State, data: FormData): Promise<State> => {
    try {
      if (cashierActivity) {
        if (needsReview.current) throw new Error("CASHIER_SHIFT_MODE_CHANGED: Review and explicitly accept current cashier settings before retrying.");
        confirmation.current ??= { ...cashierActivity };
        data.set("modeAtConfirmation", confirmation.current.modeAtConfirmation);
        data.set("shiftId", confirmation.current.shiftId ?? "");
      }
      const result = await action(data);
      // Expected server failures must be returned, not thrown across production RSC.
      if (result?.code === "CASHIER_SHIFT_MODE_CHANGED") {
        needsReview.current = true;
        return {
          message: `${result.code}: ${result.message}`,
          values: [...data.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          attempt: previous.attempt + 1,
        };
      }
      return { message: "", values: [], attempt: previous.attempt + 1 };
    } catch (error) {
      // Preserve Next navigation control flow when a server action successfully redirects.
      if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
      if (error instanceof Error && error.message.startsWith("CASHIER_SHIFT_MODE_CHANGED")) needsReview.current = true;
      return {
        message: error instanceof Error ? error.message : "Unable to confirm payment. Check the order before retrying with this same payment request.",
        values: [...data.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        attempt: previous.attempt + 1,
      };
    }
  }, { message: "", values: [], attempt: 0 });
  useLayoutEffect(() => {
    if (!state.message || !form.current) return;
    // React resets uncontrolled fields on resolved form actions, including a returned error state.
    for (const element of form.current.elements) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
      if (!element.name || (element instanceof HTMLInputElement && ["hidden", "file"].includes(element.type))) continue;
      const values = state.values.filter(([name]) => name === element.name).map(([, value]) => value);
      if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) element.checked = values.includes(element.value);
      else if (values.length) element.value = values[0];
    }
    errorMessage.current?.focus({ preventScroll: true });
    errorMessage.current?.scrollIntoView({ block: "nearest" });
  }, [state]);
  return <form ref={form} action={submit} className={className}>
    <input name="preservePaymentForm" type="hidden" value="1" />
    {children}
    {cashierActivity && state.message.startsWith("CASHIER_SHIFT_MODE_CHANGED") ? <div role="status">
      <button type="button" onClick={() => { setReviewRequested(true); router.refresh(); }}>Review current cashier settings</button>
      {reviewRequested ? <>
        <p>Cashier shifts: {cashierActivity.modeAtConfirmation}. Payment details and the original request ID are retained.</p>
        <button type="button" onClick={() => { confirmation.current = { ...cashierActivity }; needsReview.current = false; setReviewRequested(false); }}>Use reviewed cashier settings</button>
      </> : null}
    </div> : null}
    {state.message && <div ref={errorMessage} tabIndex={-1} role="alert" className="error" style={{ gridColumn: "1 / -1", scrollMarginBottom: 90, scrollMarginTop: 90 }}>{state.message} Your entries are retained. If the connection was interrupted, verify payment status before retrying; the original request ID is retained.</div>}
  </form>;
}
