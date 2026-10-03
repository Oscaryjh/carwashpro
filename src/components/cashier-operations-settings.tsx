"use client";

import { startTransition, useActionState, useState } from "react";
import { saveCashierOperationsAction, type CashierOperationsState } from "@/app/(business)/business/settings/cashier-operations-actions";

const initialState:CashierOperationsState={status:"idle",message:""};

export function CashierOperationsSettings({enabled}:{enabled:boolean}) {
  const [state,action,pending]=useActionState(saveCashierOperationsAction,initialState);
  const [selection,setSelection]=useState(String(enabled));
  // Dispatch the existing action without React's automatic native form reset:
  // a returned error must leave the user's controlled selection intact.
  return <form onSubmit={event=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    startTransition(()=>action(data));
  }} className="form-grid">
    <label>Cashier shifts
      <select name="cashierShiftsEnabled" value={selection} onChange={event=>setSelection(event.currentTarget.value)} required disabled={pending}>
        <option value="true">ON</option><option value="false">OFF</option>
      </select>
    </label>
    <p><strong>ON:</strong> Track cashier shifts, opening cash and cash differences.</p>
    <p><strong>OFF:</strong> Use Cashier without starting or ending a shift.</p>
    {state.message ? <p role={state.status==="error" ? "alert" : "status"} className={state.status==="error" ? "error" : "success"}>{state.message}</p> : null}
    <div className="form-actions"><button type="submit" className="primary-button" disabled={pending}>{pending ? "Saving..." : "Save changes"}</button></div>
  </form>;
}
