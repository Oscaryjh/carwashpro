import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("current-outlet creation filter cannot hide historical branch services in appointment edit", async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {AppointmentCalendar} from './src/components/appointment-calendar';
    HTMLElement.prototype.scrollIntoView=function(){};
    const services=[{id:'active-service',name:'Active Haircut',category:'Active',price:'30',durationMinutes:30,staffIds:[],taxable:false,taxRate:null},
      {id:'historical-service',name:'Historical Haircut',category:'Historical',price:'40',durationMinutes:30,staffIds:['historical-staff'],taxable:false,taxRate:null}];
    const appointment={id:'historical-appointment',branchId:'inactive-B',staffId:'historical-staff',customerId:'customer',customerName:'Synthetic Customer',customerPhone:'TEST',scheduledAt:'2099-10-10T10:00:00+08:00',status:'SCHEDULED',durationMinutes:30,serviceIds:[],serviceDetails:[],productIds:[],productDetails:[],packageIds:[],packageDetails:[],serviceNames:[],notes:null};
    createRoot(document.getElementById('root')).render(<AppointmentCalendar isSalonBusiness={true} singleOutletBranchId='active-A' creationServiceIds={['active-service']} services={services} selectedDateValue='2099-10-10' selectedDateLabel='10 Oct' staffMembers={[{id:'historical-staff',name:'Historical Staff',role:'STAFF'}]} appointments={[appointment]} initialAppointmentId='historical-appointment' updateAppointmentAction={async()=>({ok:true})}/>);
  ` }, write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "ui-only-boundaries", setup(b) {
    const stubs: Record<string, string> = {
      "next/navigation": "export const useRouter=()=>({refresh(){},replace(){}})",
      "next/link": "import React from 'react';export default function Link(p){return <a {...p}/>}",
      "@/components/appointment-customer-picker": "export const AppointmentCustomerPicker=()=>null",
      "@/components/appointment-vehicle-picker": "export const AppointmentVehiclePicker=()=>null",
    };
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM(`<div id="root"></div><script>${built.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://disposable-ui.test" });
  const d = dom.window.document as Document;
  const wait = async (check: () => boolean) => { const deadline = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < deadline, "appointment editor did not settle"); await new Promise(resolve => setTimeout(resolve, 10)); } };
  try {
    await wait(() => !!d.querySelector(".appointment-detail-service-add"));
    d.querySelector<HTMLButtonElement>(".appointment-detail-service-add")!.click();
    await wait(() => !!d.querySelector(".service-select-tabs.compact"));
    const category = Array.from(d.querySelectorAll<HTMLButtonElement>(".service-select-tabs.compact button")).find(button => button.textContent?.includes("Historical"));
    assert.ok(category, "historical service category must remain editable despite current-outlet creation filter");
    category.click();
    await wait(() => !!d.querySelector(".service-select-list.compact")?.textContent?.includes("Historical Haircut"));
  } finally { dom.window.close(); }
});
