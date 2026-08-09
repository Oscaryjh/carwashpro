"use client";

import { useState } from "react";

export function StaffP2CorrectionForm(props: {
  exceptionId: string;
  type: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
  workDate: string;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setPending(true);
    setMessage("");
    const localValue = String(formData.get("requestedTime") ?? "");
    const requested = localValue ? new Date(`${props.workDate}T${localValue}:00`).toISOString() : null;
    const response = await fetch("/api/employee-attendance/p2-corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exceptionId: props.exceptionId,
        requestKey: `${props.exceptionId}:${Date.now()}`,
        requestedClockInAt: props.type === "MISSING_CLOCK_IN" ? requested : null,
        requestedClockOutAt: props.type === "MISSING_CLOCK_OUT" ? requested : null,
        reason: String(formData.get("reason") ?? ""),
      }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
    setPending(false);
    if (!response.ok || !body?.ok) {
      setMessage(body?.error?.message ?? "Unable to submit correction request.");
      return;
    }
    setMessage("Correction request submitted for manager review. Your raw punch was not changed.");
  }
  return (
    <form action={submit} className="staff-resolution-form">
      <label><span>Requested {props.type === "MISSING_CLOCK_IN" ? "clock-in" : "clock-out"}</span><input name="requestedTime" required type="time" /></label>
      <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reason" required rows={2} /></label>
      <button disabled={pending} type="submit">{pending ? "Submitting…" : "Request correction"}</button>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}
