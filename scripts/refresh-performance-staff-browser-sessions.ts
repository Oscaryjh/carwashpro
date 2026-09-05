import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createEmployeeSessionRecord, type EmployeeAuthContext } from "../src/lib/attendance/employee-auth/session";
import { assertStaffTestDatabase } from "../tests/helpers/performance-staff-fixture";
async function main() {
  assertStaffTestDatabase();
  const file="/tmp/tetamu-phase3-browser-fixture.json";
  const fixture=JSON.parse(readFileSync(file,"utf8")) as {businessId:string;sessions:{token:string;context:EmployeeAuthContext}[]};
  const db=new PrismaClient();
  try{for(let i=0;i<fixture.sessions.length;i++){
    const previous=fixture.sessions[i].context;
    if(previous.businessId!==fixture.businessId)throw new Error("Unexpected fixture business");
    const next=await db.$transaction(tx=>createEmployeeSessionRecord({...previous,now:new Date()},tx));
    fixture.sessions[i]={token:next.token,context:next.context};
  }writeFileSync(file,JSON.stringify(fixture),{mode:0o600});console.log("Issued new isolated browser sessions; historical sessions not rewritten.");}
  finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
