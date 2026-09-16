import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as presentation from "../../src/lib/team/people-presentation";
import * as calendar from "../../src/lib/hr-calendar-month";
import type { PeopleDirectory } from "../../src/components/people-directory";

const require = createRequire(import.meta.url);
type Props = Parameters<typeof PeopleDirectory>[0];
export function directoryFixture(count = 7): Props {
  return { context: {}, canAddEmployee: true, branches: [{id:"11111111-1111-1111-1111-111111111111",name:"Royal Salon"}], data: {
    rows: Array.from({length:count},(_,i)=>({
      id:`employee-${i}`,fullName:i===4?"Alexandra Nur Aisyah — Senior Customer Experience and Styling Consultant":"Employee "+String(i+1).padStart(2,"0"),
      employeeCode:i===4?"EMPLOYEE-LONG-CODE-2026-0123456789":"EMP-"+String(i+1).padStart(3,"0"),phone:"",email:null,position:i===0?"Stylist":null,
      avatarUrl:null,joinedAt:new Date("2025-01-01"),terminatedAt:i===2?new Date("2026-01-01"):null,isTestAccount:i===6,
      status:i===2?"TERMINATED":i===3?"SUSPENDED":"ACTIVE",branches:i===5?[]:[{id:"11111111-1111-1111-1111-111111111111",name:i===4?"Royal Salon — City Centre Customer Experience Branch":"Royal Salon",isPrimary:true}],
      issues:i===1?[]:i===4?[{category:"PAYROLL" as const,code:"BANK_UNVERIFIED",message:"Bank details need verification before payment. This does not block payroll calculation."},{category:"PAYROLL" as const,code:"SECONDARY",message:"Secondary issue"}]:[{category:"ATTENDANCE" as const,code:"MISSING_LOCKED_TIMESHEET",message:"A locked Attendance Timesheet is required for this payroll period."}],
      readiness:i===2||i===3?"INACTIVE" as const:i===1?"READY" as const:"ATTENTION" as const,attendanceChecked:true,payrollChecked:true,
    })),summary:{all:6,ready:1,attention:3,inactive:2},positions:["Stylist"],language:"EN",hiddenTestAccounts:1,month:"2026-09",pagination:{page:1,pageCount:1,totalPages:1,pageSize:25,total:count},permissions:{canAttendance:true,canPayroll:true,canEditProfile:true},readinessStatus:"CHECKED",checkedScope:"Profile and employment fields, attendance source and locked timesheet, payroll setup visible to your role"
  }};
}
/** Exact component JSX, static local records and inert Next Link replacement. No database or network. */
export function renderDirectory(props:Props, sourcePath="src/components/people-directory.tsx") {
  const code=transformSync(readFileSync(sourcePath,"utf8"),{loader:"tsx",format:"cjs",jsx:"automatic"}).code;
  const mod={exports:{} as {PeopleDirectory:typeof PeopleDirectory}};
  const localRequire=(name:string)=>name.endsWith(".css")?{__esModule:true,default:new Proxy({},{get:(_,k)=>String(k)})}:name==="next/link"?{__esModule:true,default:({children,...p}:React.ComponentProps<"a">)=>React.createElement("a",p,children)}:name==="next/image"?{__esModule:true,default:(props:React.ComponentProps<"img">&{unoptimized?:boolean})=>{const p={...props};delete p.unoptimized;return React.createElement("img",p);}}:name==="@/lib/team/people-presentation"?presentation:name==="@/lib/hr-calendar-month"?calendar:require(name);
  new Function("require","module","exports",code)(localRequire,mod,mod.exports);
  return renderToStaticMarkup(React.createElement(mod.exports.PeopleDirectory,props));
}
