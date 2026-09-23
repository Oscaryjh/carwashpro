"use client";

import { useActionState, useLayoutEffect, useRef, type ReactNode } from "react";

type State = { message: string; values: [string, string][]; attempt: number };

/** Keep the cart, entered amounts and idempotency key after a rejected/uncertain payment. */
export function SafePaymentForm({ action, className, children }: {
  action: (data: FormData) => Promise<void>; className?: string; children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const [state, submit] = useActionState(async (previous: State, data: FormData): Promise<State> => {
    try {
      await action(data);
      return { message: "", values: [], attempt: previous.attempt + 1 };
    } catch (error) {
      // Preserve Next navigation control flow when a server action successfully redirects.
      if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
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
    {state.message && <div ref={errorMessage} tabIndex={-1} role="alert" className="error" style={{ gridColumn: "1 / -1", scrollMarginBottom: 90, scrollMarginTop: 90 }}>{state.message} Your entries are retained. If the connection was interrupted, verify payment status before retrying; the original request ID is retained.</div>}
  </form>;
}
