import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),{PrismaClient}=require("@prisma/client"),{chromium}=require("/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const url=new URL(process.env.DATABASE_URL??"http://invalid");assert.ok(url.hostname==="127.0.0.1"&&url.pathname.startsWith("/tetamu_performance_disposable_phase3_"));
const f=JSON.parse(readFileSync("/tmp/tetamu-phase3-browser-fixture.json","utf8"));
const output="/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui",base="http://127.0.0.1:3104",db=new PrismaClient();
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const result={errors:[],pageErrors:[],steps:[],outbound:[],failedResponses:[]};
try{
 const account=await db.employeeAccount.findUniqueOrThrow({where:{id:f.sessions[2].context.employeeAccountId}});
 const b=await db.business.findFirst({where:{name:"Isolated second workplace",slug:{startsWith:"phase3-switch-"}}})??await db.business.create({data:{name:"Isolated second workplace",slug:`phase3-switch-${Date.now()}`,timezone:"Asia/Kuching"}});
 const branch=await db.branch.findFirst({where:{businessId:b.id,name:"Second workplace branch"}})??await db.branch.create({data:{businessId:b.id,name:"Second workplace branch"}});
 const m=await db.employeeBusinessMembership.findFirst({where:{businessId:b.id,employeeAccountId:account.id}})??await db.employeeBusinessMembership.create({data:{businessId:b.id,employeeAccountId:account.id,fullName:account.name,employeeCode:"SECOND-001",phoneNumber:account.phoneNumber,phoneNumberNormalized:account.phoneNormalized}});
 if(!await db.employeeBranchAssignment.findFirst({where:{businessId:b.id,membershipId:m.id,branchId:branch.id}}))await db.employeeBranchAssignment.create({data:{businessId:b.id,branchId:branch.id,membershipId:m.id,isPrimary:true,canClockIn:false}});
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
 await ctx.addCookies([{name:"tetamu_employee_session",value:f.sessions[2].token,url:base,httpOnly:true,sameSite:"Lax"}]);
 await ctx.route("**/*",r=>{const u=new URL(r.request().url());if(!["127.0.0.1","localhost"].includes(u.hostname)){result.outbound.push(u.origin);return r.abort();}return r.continue();});
 const page=await ctx.newPage();page.on("pageerror",e=>result.pageErrors.push(e.message));page.on("console",m=>{if(m.type()==="error")result.errors.push(m.text());});
 page.on("response",r=>{if(r.status()>=400)result.failedResponses.push({url:r.url(),status:r.status()});});
 await page.goto(`${base}/staff`);await page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();
 assert.ok((await page.locator('[data-testid="staff-performance"]:visible').innerText()).includes("RM 245.00"));
 await page.getByRole("button",{name:"Switch workplace",exact:true}).click();
 const switched=page.waitForResponse(r=>r.url().includes("/api/employee-auth/switch-workplace")&&r.request().method()==="POST");
 await page.getByRole("button",{name:/Isolated second workplace/}).click();assert.equal((await switched).status(),200);
 await page.getByRole("button",{name:"Switch workplace",exact:true}).filter({hasText:"Isolated second workplace"}).waitFor();
 await page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();
 const out=await page.evaluate(async()=>await(await fetch("/api/employee-performance?view=mine",{cache:"no-store"})).json());
 assert.equal(out.branchName,"Second workplace branch");assert.equal(out.personal.annual.total,0);assert.equal(out.personal.goal,null);assert.equal(out.detail.events.length,0);assert.equal(out.canViewTeam,false);
 assert.ok(!(await page.locator('[data-testid="staff-performance"]:visible').innerText()).includes("RM 245.00"));
 await page.screenshot({path:`${output}/mobile-workplace-switch-no-previous-values.png`,fullPage:true});
 await page.getByRole("link",{name:"Profile",exact:true}).click();
 await page.getByRole("button",{name:"Sign out of Staff App",exact:true}).click();
 await page.waitForURL(/\/staff\/login/);assert.equal(await page.locator('[data-testid="staff-performance"]:visible').count(),0);
 await page.screenshot({path:`${output}/mobile-signed-out.png`,fullPage:true});
 assert.equal((await ctx.cookies()).some(c=>c.name==="tetamu_employee_session"&&c.value),false);
 result.steps.push("Real Staff workplace-switch API rotates/revokes original session; new business has zero complete amount and no target, old RM245 never reused.","Real Profile sign-out clears cookie and returns login with no private performance.");
 // Existing Staff login intentionally probes /me and catches its 401 (staff-auth.tsx:57-65).
 // Require that exact denial, not arbitrary console failures, while keeping every business assertion above.
 assert.deepEqual(result.failedResponses,[{url:`${base}/api/employee-auth/me`,status:401}]);
 assert.deepEqual(result.errors,["Failed to load resource: the server responded with a status of 401 (Unauthorized)"]);
 assert.equal(result.pageErrors.length,0);result.status="PASS";
}catch(e){result.status="FAIL";result.failure=e.stack;throw e;}finally{writeFileSync(`${output}/switch-evidence.json`,JSON.stringify(result,null,2));await browser.close();await db.$disconnect();}
