import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {PrismaClient} from "@prisma/client";
import {createEmployeeSessionRecord,type EmployeeAuthContext} from "../src/lib/attendance/employee-auth/session";
const root="/Users/innovdia/.codex/local-uat/tetamu-performance-20260905";
const config=JSON.parse(readFileSync(`${root}/config.json`,"utf8"));
// Explicit isolated configuration; never load the repository .env.
for(const [key,value] of Object.entries(config.env))process.env[key]=String(value);
const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/tetamu_performance_disposable_phase3_20260905_a");
const previous=JSON.parse(readFileSync("/tmp/tetamu-phase3-browser-fixture.json","utf8")) as {businessId:string;sessions:{context:EmployeeAuthContext}[]};
const db=new PrismaClient();
async function main(){
 const business=await db.business.findUniqueOrThrow({where:{id:previous.businessId},select:{name:true,slug:true}});
 assert.equal(business.name,"Staff Performance Isolated");assert.ok(business.slug.startsWith("phase3-"));
 const context=previous.sessions[1].context;assert.equal(context.businessId,previous.businessId);
 const next=await db.$transaction(tx=>createEmployeeSessionRecord({...context,now:new Date()},tx));
 writeFileSync(`${root}/uiux-pagination-session.json`,JSON.stringify(next),{mode:0o600});
 console.log("Issued one session for an existing isolated pagination fixture. No sales, targets or seed data were written.");
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});
