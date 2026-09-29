"use client";

import { useState } from "react";

export function BusinessDayStartField({ initialTime }: { initialTime: string }) {
  const [time, setTime] = useState(initialTime);
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  const [hours, minutes] = time.split(":");
  const displayTime = valid ? `${Number(hours) % 12 || 12}:${minutes} ${Number(hours) < 12 ? "AM" : "PM"}` : "";

  return <label>
    <span>New business day starts at</span>
    <input name="businessDayCutoffTime" type="time" defaultValue={initialTime} required
      onChange={(event) => setTime(event.target.value)} aria-describedby="business-day-start-help" />
    <small className="field-helper" id="business-day-start-help" aria-live="polite">
      {valid ? `Transactions before ${displayTime} are counted toward the previous business day.` : "Choose when the new reporting day starts."}
    </small>
  </label>;
}
