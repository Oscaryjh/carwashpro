import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {crmUiBoundaries} from "../helpers/crm-ui-fixture";
import {readFile} from "node:fs/promises";

test("actual calendar renders one duration card, real staff columns and singular counts",async()=>{
 const dir=await mkdtemp(join(process.cwd(),"node_modules/.cache/calendar-ui-"));
 try{
  await build({entryPoints:["src/components/appointment-calendar.tsx"],outfile:join(dir,"calendar.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",plugins:[crmUiBoundaries()]});
  const {AppointmentCalendar}=createRequire(import.meta.url)(join(dir,"calendar.cjs"));
  const {JSDOM}=createRequire(import.meta.url)("jsdom");
  const html=renderToStaticMarkup(createElement(AppointmentCalendar,{selectedDateValue:"2026-10-04",selectedDateLabel:"4 Oct",datePickerHrefPrefix:"/appointments?date=",nextHref:"/next",previousHref:"/previous",isSalonBusiness:true,days:[{date:"2026-10-04",label:"4",shortLabel:"Sun",count:1},{date:"2026-10-05",label:"5",shortLabel:"Mon",count:0},{date:"2026-10-06",label:"6",shortLabel:"Tue",count:2}],staffMembers:[{id:"staff",name:"Long staff name for accessible title",role:"STAFF"}],appointments:[{id:"a",customerName:"Oscar",staffId:"staff",scheduledAt:"2026-10-04T10:30:00+08:00",durationMinutes:30,status:"SCHEDULED"}]}));
  const d=new JSDOM(html).window.document as Document;
  assert.equal(d.querySelectorAll('.appointment-calendar-staff-card').length,1);
  assert.equal(d.querySelectorAll('.appointment-calendar-card').length,1);
  assert.equal(d.querySelectorAll('.appointment-calendar-slot-blocked').length,0);
  assert.match(d.querySelector('.appointment-calendar-card')!.getAttribute('style')!,/2 \*/);
  assert.match(d.querySelector('.appointment-calendar-card')!.textContent!,/10:30 AM.*11:00 AM/);
  assert.deepEqual(Array.from(d.querySelectorAll('.appointment-calendar-day-head small')).map(el=>el.textContent),["1 appt","0 appts","2 appts"]);
  assert.equal(d.querySelector('.appointment-calendar-staff-card strong')!.getAttribute('title'),"Long staff name for accessible title");
  assert.ok(d.querySelector('[aria-label="Business hour"]'));
  for(const count of [0,2,5,9]){
   const members=Array.from({length:count},(_,index)=>({id:`staff-${index}`,name:`Staff ${index}`,role:"STAFF"}));
   const layout=new JSDOM(renderToStaticMarkup(createElement(AppointmentCalendar,{selectedDateValue:"2099-10-04",selectedDateLabel:"4 Oct",datePickerHrefPrefix:"/appointments?date=",nextHref:"/next",previousHref:"/previous",staffMembers:members}))).window.document as Document;
   assert.equal(layout.querySelectorAll('.appointment-calendar-staff-card').length,count);
   assert.equal(layout.querySelectorAll('[data-slot^="2099-10-04T10:00::"]').length,count);
   assert.equal((layout.querySelector('.appointment-calendar-timeline') as HTMLElement).style.getPropertyValue('--appointment-staff-count'),String(Math.max(1,count)));
   assert.equal(layout.querySelectorAll('.is-empty').length,0);
  }
  const css=await readFile('src/components/appointment-calendar-polish.css','utf8');
  const empty=new JSDOM(`<style>${css}</style>${renderToStaticMarkup(createElement(AppointmentCalendar,{selectedDateValue:'2099-10-04',staffMembers:[]}))}`);
  assert.equal(empty.window.getComputedStyle(empty.window.document.querySelector('.appointment-calendar-time')).gridColumn,'1');
  const vehicle=new JSDOM(renderToStaticMarkup(createElement(AppointmentCalendar,{selectedDateValue:'2099-10-04',staffMembers:[{id:'staff',name:'Louis'}],appointments:[{id:'car',customerName:'Oscar',plateNumber:'ABC123',staffId:'staff',scheduledAt:'2099-10-04T10:30:00+08:00',durationMinutes:15,status:'SCHEDULED'}]})));
  const shortCard=vehicle.window.document.querySelector('.appointment-calendar-card')!;
  assert.equal(shortCard.children.length,3,'short vehicle card uses three text rows');
  assert.match(shortCard.firstElementChild!.textContent!,/Oscar.*ABC123/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const today of [false,true])test(`calendar interactions preserve ${today?"earlier toggle":"click, drag and occupied-slot guards"}`,async()=>{
 const {JSDOM}=createRequire(import.meta.url)("jsdom");
 const props={selectedDateValue:"2099-10-04",selectedDateLabel:"4 Oct",datePickerHrefPrefix:"/appointments?date=",nextHref:"/next",previousHref:"/previous",isSalonBusiness:true,days:[],staffMembers:[{id:"staff",name:"Louis",role:"STAFF"}],appointments:[{id:"a",customerId:"customer",customerName:"Oscar",customerPhone:"012",staffId:"staff",staffName:"Louis",scheduledAt:"2099-10-04T10:30:00+08:00",durationMinutes:30,status:"SCHEDULED",serviceNames:[],serviceIds:[],serviceDetails:[],productIds:[],productDetails:[],packageIds:[],packageDetails:[],invoiceSummary:null}]};
 const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AppointmentCalendar} from './src/components/appointment-calendar';
 const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(today?"2099-10-04T12:00:00+08:00":"2099-10-03T12:00:00+08:00")}]))}static now(){return new OriginalDate(${JSON.stringify(today?"2099-10-04T12:00:00+08:00":"2099-10-03T12:00:00+08:00")}).getTime()}};
 window.writes=[];HTMLElement.prototype.scrollIntoView=function(){};function App(){React.useEffect(()=>{window.ready=true},[]);return <AppointmentCalendar {...${JSON.stringify(props)}} rescheduleAction={async data=>window.writes.push(Object.fromEntries(data))}/>;}createRoot(document.getElementById('root')).render(<App/>);`,loader:"tsx",resolveDir:process.cwd()},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"ui-boundaries",setup(b){
  const stubs:Record<string,string>={"next/navigation":"export const useRouter=()=>({refresh(){}})","next/link":"import React from 'react';export default function Link(p){return <a {...p}/>}","@/components/appointment-customer-picker":"export const AppointmentCustomerPicker=()=>null", "@/components/appointment-vehicle-picker":"export const AppointmentVehiclePicker=()=>null"};
  b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"tsx",resolveDir:process.cwd()}));
 }}]});
 const css=await readFile("src/components/appointment-calendar-polish.css","utf8");
 const dom=new JSDOM(`<style>${css}</style><div id="root"></div><script>${built.outputFiles[0].text}</script>`,{runScripts:"dangerously",url:"http://disposable-ui.test"});
 const d=dom.window.document as Document;
 const wait=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,"calendar did not settle");await new Promise(r=>setTimeout(r,10));}};
 try{
  await wait(()=>!!dom.window.ready&&!!d.querySelector('.appointment-calendar-body-grid'));
  if(!today){
   const open=d.querySelector<HTMLButtonElement>('[aria-label="New appointment"]')!;
   open.click();await wait(()=>!!d.querySelector('.appointment-time-modal'));
   const modal=d.querySelector<HTMLElement>('.appointment-time-modal')!;
   assert.ok(modal.classList.contains('appointment-time-tablet'));
   const modalRule=Array.from(d.styleSheets[0].cssRules).find(rule=>(rule as CSSStyleRule).selectorText==='.appointment-time-modal.appointment-time-tablet') as CSSStyleRule;
   assert.equal(modalRule.style.getPropertyValue('zoom'),'1');
   assert.equal(modalRule.style.getPropertyValue('max-width'),'720px');
   const mobileRules=Array.from(d.styleSheets[0].cssRules).filter(rule=>rule instanceof dom.window.CSSMediaRule && (rule as CSSMediaRule).conditionText==='(max-width: 767px)').flatMap(rule=>Array.from((rule as CSSMediaRule).cssRules)) as CSSStyleRule[];
   assert.equal(mobileRules.find(rule=>rule.selectorText==='.appointment-time-tablet .appointment-time-grid')!.style.getPropertyValue('grid-template-columns'),'repeat(2, minmax(0, 1fr))');
   assert.equal(mobileRules.find(rule=>rule.selectorText==='.appointment-time-tablet .appointment-time-days .appointment-time-week-nav')!.style.getPropertyValue('grid-row'),'1');
   assert.equal(dom.window.getComputedStyle(modal.querySelector('.appointment-time-grid')).gridTemplateColumns,'repeat(4, minmax(0, 1fr))');
   const dates=()=>Array.from(modal.querySelectorAll<HTMLButtonElement>('.appointment-time-days button:not(.appointment-time-week-nav)'));
   assert.equal(dates().length,7);
   assert.equal(dates().filter(button=>button.getAttribute('aria-pressed')==='true').length,1);
   const initial=dates().map(button=>button.textContent).join('|');
   (modal.querySelector('[aria-label="Previous week"]') as HTMLButtonElement).click();
   await wait(()=>dates().map(button=>button.textContent).join('|')!==initial);
   const past=modal.querySelector<HTMLButtonElement>('.appointment-time-grid button')!;
   assert.equal(past.disabled,true);past.click();assert.ok(d.querySelector('.appointment-time-modal'));
   (modal.querySelector('[aria-label="Next week"]') as HTMLButtonElement).click();
   await wait(()=>dates().map(button=>button.textContent).join('|')===initial);
   const chosen=dates().find(button=>button.querySelector('strong')!.textContent==='4')!;
   chosen.querySelector('span')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
   await wait(()=>chosen.getAttribute('aria-pressed')==='true');
   const slot=Array.from(modal.querySelectorAll<HTMLButtonElement>('.appointment-time-grid button')).find(button=>button.textContent==='10:15 AM')!;
   assert.equal(slot.disabled,false);assert.equal(dom.window.getComputedStyle(slot).minHeight,'56px');
   slot.click();await wait(()=>!!d.querySelector('.appointment-create-modal'));
   assert.equal(d.querySelector<HTMLInputElement>('[name="scheduledDate"]')!.value,'2099-10-04');
   assert.equal(d.querySelector<HTMLInputElement>('[name="scheduledTime"]')!.value,'10:15');
   (d.querySelector('.appointment-create-modal .appointment-time-close') as HTMLButtonElement).click();
   await wait(()=>!d.querySelector('.appointment-create-modal'));
  }
  if(today){
   assert.equal(d.querySelectorAll('.appointment-calendar-card').length,0);
   (d.querySelector('.appointment-calendar-earlier-toggle') as HTMLButtonElement).click();await wait(()=>!!d.querySelector('.appointment-calendar-card'));
   assert.equal(d.querySelector('.appointment-calendar-earlier-toggle')!.textContent,"Hide earlier times");
   (d.querySelector('.appointment-calendar-earlier-toggle') as HTMLButtonElement).click();await wait(()=>!d.querySelector('.appointment-calendar-card'));return;
  }
  const continuation=d.querySelector<HTMLElement>('[data-slot="2099-10-04T10:45::staff"]')!;
  assert.equal(continuation.dataset.occupied,"true");assert.equal(continuation.querySelector('button'),null);
  const card=d.querySelector<HTMLButtonElement>('.appointment-calendar-card')!;
  assert.equal(card.draggable,true);assert.equal(dom.window.getComputedStyle(card).position,"absolute");
  assert.equal(dom.window.getComputedStyle(d.querySelector('.appointment-calendar-staff-grid')).gridTemplateColumns,dom.window.getComputedStyle(d.querySelector('.appointment-calendar-body-grid')).gridTemplateColumns);
  const drag=new dom.window.Event('dragstart',{bubbles:true,cancelable:true});const transfer={effectAllowed:"",setData(type:string,id:string){assert.equal(type,"text/plain");assert.equal(id,"a");}};Object.defineProperty(drag,'dataTransfer',{value:transfer});card.dispatchEvent(drag);await wait(()=>card.classList.contains('is-dragging'));
  const over=new dom.window.Event('dragover',{bubbles:true,cancelable:true});continuation.dispatchEvent(over);assert.equal(over.defaultPrevented,false);
  continuation.dispatchEvent(new dom.window.Event('drop',{bubbles:true,cancelable:true}));assert.equal(dom.window.writes.length,0);
  d.querySelector('[data-slot="2099-10-04T11:15::staff"]')!.dispatchEvent(new dom.window.Event('drop',{bubbles:true,cancelable:true}));await wait(()=>dom.window.writes.length===1);
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.writes[0])),{appointmentId:"a",scheduledDate:"2099-10-04",scheduledTime:"11:15",assignedStaffId:"staff"});
  card.click();await wait(()=>!!d.querySelector('.appointment-detail-modal-backdrop'));
  assert.match(d.querySelector('.appointment-detail-modal-backdrop')!.textContent!,/Oscar/);
  (d.querySelector('[aria-label="Business hour"]') as HTMLButtonElement).click();await wait(()=>!!d.querySelector('[aria-labelledby="business-hour-title"]'));
  assert.equal(dom.window.writes.length,1,"opening settings must not mutate appointments");
  const hours=d.querySelector('[aria-labelledby="business-hour-title"]')!;
  assert.equal(hours.querySelector('h2')!.textContent,'Business Hours');
  assert.match(hours.textContent!,/Same hours every day/);
  assert.match(hours.textContent!,/Apply the same opening hours to every day of the week\./);
  assert.doesNotMatch(hours.textContent!,/Add Break/);
  const inputs=hours.querySelectorAll<HTMLInputElement>('input[type="time"]');
  assert.deepEqual(Array.from(inputs).map(input=>input.value),['10:00','22:00']);
  const toggle=hours.querySelector<HTMLButtonElement>('.business-hour-toggle')!;
  assert.equal(toggle.getAttribute('aria-pressed'),'true');toggle.click();
  await wait(()=>toggle.getAttribute('aria-pressed')==='false');
  assert.equal(hours.querySelectorAll('input[type="time"]').length,2,'no weekly controls introduced');
  assert.equal(hours.querySelector('.business-hour-on')!.tagName,'SPAN');
  const setValue=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
  setValue.call(inputs[0],'09:30');inputs[0].dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,20));
  (hours.querySelector('.business-hour-save') as HTMLButtonElement).click();
  await wait(()=>!d.querySelector('.business-hour-modal'));
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('washflow:appointment-business-hours')!),{endTime:'22:00',startTime:'09:30'});
  (d.querySelector('[aria-label="Business hour"]') as HTMLButtonElement).click();
  await wait(()=>!!d.querySelector('.business-hour-modal'));
  assert.equal(d.querySelector<HTMLInputElement>('.business-hour-modal input')!.value,'09:30');
  (d.querySelector('.business-hour-close') as HTMLButtonElement).click();
  await wait(()=>!d.querySelector('.business-hour-modal'));
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('washflow:appointment-business-hours')!),{endTime:'22:00',startTime:'09:30'});
 }finally{dom.window.close();}
});

test("calendar presentation spans actual minutes, clips visible range, and assigns overlap lanes without changing appointments",async()=>{
 const m=await import("../../src/components/appointment-calendar-layout").catch(()=>null);
 assert.ok(m?.buildCalendarPresentation,"calendar needs duration-based presentation");
 const make=(id:string,time:string,durationMinutes:number)=>({id,staffId:"staff",scheduledAt:`2026-10-04T${time}:00+08:00`,durationMinutes});
 const appointments=[make("a","10:30",30),make("b","10:37",20),make("c","11:00",15)];
 const before=JSON.stringify(appointments);
 const result=m.buildCalendarPresentation(appointments,"2026-10-04",["10:30","10:45","11:00"]);
 const first=result.cards.get("2026-10-04T10:30::staff")!;
 assert.equal(first[0].spanSlots,2);assert.equal(first[0].offsetSlots,0);
 assert.equal(first[1].offsetSlots,7/15);assert.equal(first[1].spanSlots,20/15);
 assert.equal(first[0].laneCount,2);assert.equal(first[1].laneCount,2);assert.notEqual(first[0].lane,first[1].lane);
 assert.equal(result.cards.get("2026-10-04T11:00::staff")![0].laneCount,1);
 assert.ok(result.occupied.has("2026-10-04T10:45::staff"));
 assert.equal(JSON.stringify(appointments),before);
 const clipped=m.buildCalendarPresentation([appointments[0]],"2026-10-04",["10:45","11:00"]);
 assert.equal(clipped.cards.get("2026-10-04T10:45::staff")![0].spanSlots,1);
 assert.equal(clipped.cards.get("2026-10-04T10:45::staff")![0].appointment.id,"a");
});
