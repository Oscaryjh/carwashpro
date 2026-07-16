"use client";

import { useState } from "react";
import { recordSalonAppointmentPaymentAction } from "@/app/appointments/actions";

type SalonAppointmentPaymentFormProps = {
  appointmentId: string;
  balance: number;
};

export function SalonAppointmentPaymentForm({
  appointmentId,
  balance,
}: SalonAppointmentPaymentFormProps) {
  const [method, setMethod] = useState("CASH");

  return (
    <form
      action={recordSalonAppointmentPaymentAction}
      className="payment-form salon-payment-form"
    >
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <label>
        Amount
        <input
          defaultValue={balance.toFixed(2)}
          max={balance.toFixed(2)}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
      </label>
      <label>
        Payment method
        <select
          name="method"
          onChange={(event) => setMethod(event.target.value)}
          value={method}
        >
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="DUITNOW">DuitNow</option>
          <option value="EWALLET">E-wallet</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
        </select>
      </label>
      {method !== "CASH" ? (
        <label>
          Reference
          <input name="reference" required />
        </label>
      ) : null}
      <button className="salon-payment-submit" type="submit">
        Record payment
      </button>
    </form>
  );
}
