import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { assertStaffAvailability } from "../../src/lib/appointments/staff-availability";
import { appointmentIntervalsOverlap } from "../../src/lib/appointments/scheduling";
import { parseBusinessDateTime } from "../../src/lib/business-time";

for (const clock of ["2026-10-07T15:30:00+08:00", "2026-10-07T23:55:00+08:00", "2026-10-08T00:05:00+08:00"]) {
  test(`new appointment derives slots from its selected business date at ${clock}`, async () => {
    const today = clock.slice(0, 10);
    const day = Number(today.slice(-2));
    const built = await build({
      stdin: {
        contents: `import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {AppointmentCalendar} from './src/components/appointment-calendar';
          const OriginalDate=Date;
          window.Date=class extends OriginalDate {
            constructor(...args){super(...(args.length?args:[${JSON.stringify(clock)}]));}
            static now(){return new OriginalDate(${JSON.stringify(clock)}).getTime();}
          };
          localStorage.setItem('washflow:appointment-business-hours',JSON.stringify({startTime:'09:00',endTime:'18:00'}));
          HTMLElement.prototype.scrollIntoView=function(){};
          function App(){return <AppointmentCalendar selectedDateValue=${JSON.stringify(today)} staffMembers={[]} appointments={[]}/>;}
          createRoot(document.getElementById('root')).render(<App/>);`,
        loader: "tsx", resolveDir: process.cwd(),
      },
      write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      loader: { ".css": "empty" },
      plugins: [{ name: "ui-boundaries", setup(b) {
        const stubs: Record<string, string> = {
          "next/navigation": "export const useRouter=()=>({refresh(){}})",
          "next/link": "import React from 'react';export default function Link(p){return <a {...p}/>}",
          "@/components/appointment-customer-picker": "export const AppointmentCustomerPicker=()=>null",
          "@/components/appointment-vehicle-picker": "export const AppointmentVehiclePicker=()=>null",
        };
        b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
        b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "tsx", resolveDir: process.cwd() }));
      } }],
    });
    const { JSDOM } = createRequire(import.meta.url)("jsdom");
    const dom = new JSDOM(`<div id="root"></div><script>${built.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://disposable-ui.test" });
    const d = dom.window.document as Document;
    const wait = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check()) {
        assert.ok(Date.now() < deadline, "selected-date UI did not settle");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    const slots = () => Array.from(d.querySelectorAll<HTMLButtonElement>(".appointment-time-grid button"));
    const available = () => slots().filter(button => !button.disabled).map(button => button.textContent);
    const selectDay = async (number: number) => {
      const button = Array.from(d.querySelectorAll<HTMLButtonElement>(".appointment-time-days button"))
        .find(button => button.querySelector("strong")?.textContent === String(number));
      assert.ok(button, `day ${number} exists`);
      button.click();
      await wait(() => d.querySelector('.appointment-time-days button[aria-pressed="true"] strong')?.textContent === String(number));
    };
    try {
      await wait(() => !!d.querySelector('[aria-label="New appointment"]'));
      d.querySelector<HTMLButtonElement>('[aria-label="New appointment"]')!.click();
      await wait(() => !!d.querySelector(".appointment-time-modal"));
      const initial = available();
      if (clock.includes("15:30")) {
        assert.ok(!slots().some(button => button.textContent === "3:00 PM"), "today hides all past times");
        assert.ok(initial.includes("4:00 PM"));
      } else if (clock.includes("23:55")) {
        assert.equal(initial.length, 0, "today is after closing in Asia/Kuching");
      } else {
        assert.ok(initial.includes("9:00 AM"), "00:05 business date still has morning slots");
      }
      await selectDay(day + 1);
      assert.ok(available().includes("9:00 AM"), "tomorrow must not reuse the outer calendar cutoff");
      assert.ok(available().includes("10:00 AM"));
      await selectDay(day);
      assert.deepEqual(available(), initial, "switching back reapplies today's cutoff");
      await selectDay(day + 2);
      assert.ok(available().includes("9:00 AM"));
      await selectDay(day);
      d.querySelector<HTMLButtonElement>('.appointment-time-modal [aria-label="Next week"]')!.click();
      await wait(() => !!Array.from(d.querySelectorAll(".appointment-time-days button[aria-pressed=true] strong")).find(el => el.textContent === String(day + 7)));
      assert.ok(available().includes("9:00 AM"), "+7 days ignores today's clock cutoff");
      d.querySelector<HTMLButtonElement>('.appointment-time-modal [aria-label="Previous week"]')!.click();
      await wait(() => !!Array.from(d.querySelectorAll(".appointment-time-days button[aria-pressed=true] strong")).find(el => el.textContent === String(day)));
      d.querySelector<HTMLButtonElement>('.appointment-time-modal [aria-label="Previous week"]')!.click();
      await wait(() => !Array.from(d.querySelectorAll(".appointment-time-days button[aria-pressed=true] strong")).some(el => el.textContent === String(day)));
      assert.equal(available().length, 0, "past dates cannot be selected for booking");
      assert.equal(d.querySelector(".appointment-create-modal"), null, "date changes do not submit or open a stale chosen time");
      d.querySelector<HTMLButtonElement>('.appointment-time-modal [aria-label="Next week"]')!.click();
      await wait(() => d.querySelector('.appointment-time-days button[aria-pressed="true"] strong')?.textContent === String(day));
      await selectDay(day + 1);
      slots().find(button => button.textContent === "9:00 AM")!.click();
      await wait(() => !!d.querySelector(".appointment-create-modal"));
      assert.equal(d.querySelector<HTMLInputElement>('[name="scheduledDate"]')!.value, `2026-10-${String(day + 1).padStart(2, "0")}`);
      assert.equal(d.querySelector<HTMLInputElement>('[name="scheduledTime"]')!.value, "09:00", "form receives the newly chosen date/time, not an initial stale time");
    } finally { dom.window.close(); }
  });
}

test("selected business date retains server schedule, closure, break, leave and duration guards", async () => {
  const queries: unknown[] = [];
  let leave = false;
  const db = {
    staffAvailability: { findMany: async () => [
      { dayOfWeek: 3, startTime: "12:00", endTime: "18:00", enabled: true },
      { dayOfWeek: 4, startTime: "09:00", endTime: "18:00", enabled: true },
      { dayOfWeek: 0, startTime: "09:00", endTime: "18:00", enabled: false },
    ] },
    staffBreak: { findMany: async (query: unknown) => { queries.push(query); return [{ startTime: "12:00", endTime: "13:00", enabled: true }]; } },
    staffTimeOff: { findFirst: async () => leave ? { id: "leave" } : null },
  } as unknown as Parameters<typeof assertStaffAvailability>[0];
  const check = (date: string, time: string, durationMinutes = 30) => assertStaffAvailability(db, {
    businessId: "business", userId: "staff", scheduledAt: parseBusinessDateTime(date, time), durationMinutes,
  });
  await assert.rejects(check("2026-10-07", "09:00"), /not available/);
  await check("2026-10-08", "09:00");
  assert.deepEqual(queries[0], { where: { businessId: "business", userId: "staff", dayOfWeek: 4, enabled: true } });
  await assert.rejects(check("2026-10-11", "09:00"), /not available/, "closed Sunday remains unavailable");
  await assert.rejects(check("2026-10-08", "17:00", 90), /not available/, "duration must fit before closing");
  await assert.rejects(check("2026-10-08", "12:15"), /break/);
  leave = true;
  await assert.rejects(check("2026-10-08", "09:00"), /leave/);
});

test("future-date intervals keep existing appointment conflict boundaries", () => {
  const existing = parseBusinessDateTime("2026-10-08", "10:00");
  const overlap = (date: string, time: string) => appointmentIntervalsOverlap({
    firstStart: existing, firstDurationMinutes: 60,
    secondStart: parseBusinessDateTime(date, time), secondDurationMinutes: 30,
  });
  assert.equal(overlap("2026-10-08", "10:00"), true);
  assert.equal(overlap("2026-10-08", "09:00"), false);
  assert.equal(overlap("2026-10-08", "11:00"), false);
  assert.equal(overlap("2026-10-09", "10:00"), false);
});
