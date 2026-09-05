import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { chromium } = require("/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost","127.0.0.1"].includes(url.hostname) && /^\/tetamu_performance_disposable_phase3_/.test(url.pathname));
const fixture = JSON.parse(readFileSync("/tmp/tetamu-phase3-browser-fixture.json","utf8"));
const output = "/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui";
mkdirSync(output,{recursive:true});
const base = "http://127.0.0.1:3104";
const browser = await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const db = new PrismaClient();
const evidence = { screenshots:[], errors:[], steps:[], metrics:[], outbound:[] };
let phase = "normal";
async function context(index, viewport={width:1440,height:1000}) {
  const ctx = await browser.newContext({viewport});
  await ctx.addCookies([{name:"tetamu_employee_session",value:fixture.sessions[index].token,url:base,httpOnly:true,sameSite:"Lax"}]);
  await ctx.route("**/*",route=>{const u=new URL(route.request().url());if(!["127.0.0.1","localhost"].includes(u.hostname)){evidence.outbound.push(u.origin);return route.abort();}return route.continue();});
  const page=await ctx.newPage();
  page.on("pageerror",e=>evidence.errors.push({phase,type:"pageerror",message:e.message}));
  page.on("console",m=>{if(m.type()==="error")evidence.errors.push({phase,type:"console",message:m.text()});});
  return{ctx,page};
}
async function shot(page,name){await page.screenshot({path:`${output}/${name}.png`,fullPage:true});evidence.screenshots.push(name);}
async function ready(page){await page.getByRole("heading",{name:"Performance",exact:true}).waitFor();}
async function api(page,params){return page.evaluate(async params=>{const r=await fetch(`/api/employee-performance?${params}`,{cache:"no-store"});return{status:r.status,cache:r.headers.get("cache-control"),data:await r.json()};},params);}
try {
  const holidayDate=new Date();holidayDate.setUTCDate(holidayDate.getUTCDate()+1);holidayDate.setUTCHours(0,0,0,0);
  if(!await db.holidayOccurrence.findFirst({where:{businessId:fixture.businessId,name:"Isolated upcoming day"}})){
    const owner=await db.user.findFirstOrThrow({where:{businessId:fixture.businessId,role:"BUSINESS_OWNER"}});
    await db.holidayOccurrence.create({data:{businessId:fixture.businessId,branchId:fixture.branchId,workDate:holidayDate,name:"Isolated upcoming day",holidayType:"COMPANY_HOLIDAY",source:"CUSTOM",scope:"BRANCH",createdById:owner.id}});
  }
  const staff=await context(1);await staff.page.goto(`${base}/staff`);
  await staff.page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();
  const card=staff.page.locator('[data-testid="staff-performance"]:visible');
  const pos=await staff.page.evaluate(()=>{const c=document.querySelector('[data-testid="staff-performance"]'),q=document.querySelector('#staff-home-quick-access-heading'),u=document.querySelector('#staff-home-next-heading')??document.querySelector('#staff-home-up-next-heading');return{card:c.getBoundingClientRect().top,quick:q.getBoundingClientRect().top,up:u?.getBoundingClientRect().top??null,height:c.getBoundingClientRect().height};});
  assert.ok(pos.card<pos.quick);assert.notEqual(pos.up,null);assert.ok(pos.card>pos.up);evidence.metrics.push({name:"desktop-card-position",...pos});
  await shot(staff.page,"staff-desktop-home");
  const response=await api(staff.page,"view=mine&year=2026&month=8");assert.equal(response.status,200);assert.match(response.cache,/private.*no-store/);assert.equal(response.data.personal.annual.total,30122500);assert.equal(response.data.team.annual.total,60269500);assert.equal(response.data.canViewTeam,false);assert.equal(response.data.detail.events.length,20);
  assert.ok(!JSON.stringify(response.data).includes(fixture.members[0].id));
  await card.getByRole("link").click();await ready(staff.page);await staff.page.getByLabel("Performance month").selectOption("8");await ready(staff.page);
  await staff.page.getByText("All 12 months",{exact:true}).click();await shot(staff.page,"staff-desktop-detail");
  await staff.page.getByRole("button",{name:"Next",exact:true}).click();await ready(staff.page);await staff.page.getByText("2 / 2",{exact:true}).waitFor();
  assert.equal((await api(staff.page,"view=mine&year=2026&month=8&page=2")).data.personal.annual.total,30122500);
  await staff.page.setViewportSize({width:390,height:844});await shot(staff.page,"staff-mobile-detail-page2");
  assert.equal(await staff.page.evaluate(()=>document.documentElement.scrollWidth),390);
  await staff.page.getByRole("button",{name:"Team performance",exact:true}).click();await ready(staff.page);assert.equal(await staff.page.getByText("Members · this branch",{exact:true}).count(),0);await shot(staff.page,"staff-mobile-team-summary");
  await staff.page.goto(`${base}/staff`);await staff.page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();await shot(staff.page,"staff-mobile-home");
  assert.equal(await staff.page.locator('[data-testid="staff-performance"]:visible').count(),1);
  evidence.metrics.push({name:"staff-mobile-card-height",height:await staff.page.locator('[data-testid="staff-performance"]:visible').evaluate(e=>e.getBoundingClientRect().height)});
  const manager=await context(0);await manager.page.goto(`${base}/staff`);await manager.page.getByRole("heading",{name:"Team Performance",exact:true}).waitFor();await manager.page.getByRole("link",{name:"Approvals",exact:true}).waitFor();await shot(manager.page,"manager-desktop-home");
  await manager.page.locator('[data-testid="staff-performance"]:visible').getByRole("link").click();await ready(manager.page);
  await manager.page.getByRole("heading",{name:"Members · this branch",exact:true}).waitFor();
  const team=await api(manager.page,"view=team&year=2026&month=8");assert.equal(team.data.detail.members.length,54);assert.equal(team.data.team.level,1);
  await shot(manager.page,"manager-desktop-team");
  await manager.page.setViewportSize({width:390,height:844});await manager.page.getByLabel("Search name or employee number").fill("STAFF-001");await manager.page.getByRole("button",{name:"Search members",exact:true}).click();await ready(manager.page);
  await manager.page.getByText(fixture.members[1].name,{exact:true}).click();await manager.page.getByRole("button",{name:"View months & details",exact:true}).waitFor();await shot(manager.page,"manager-mobile-member-search-expanded");
  await manager.page.getByRole("button",{name:"View months & details",exact:true}).click();await ready(manager.page);await manager.page.getByLabel("Performance month").selectOption("8");await ready(manager.page);
  assert.equal(await manager.page.evaluate(()=>document.documentElement.scrollWidth),390);await shot(manager.page,"manager-mobile-member-detail");
  await manager.page.getByRole("button",{name:"My performance",exact:true}).click();await ready(manager.page);await shot(manager.page,"manager-mobile-my-performance");
  await manager.page.goto(`${base}/staff`);await manager.page.getByRole("heading",{name:"Team Performance",exact:true}).waitFor();await shot(manager.page,"manager-mobile-home");
  evidence.metrics.push({name:"manager-mobile-card-height",height:await manager.page.locator('[data-testid="staff-performance"]:visible').evaluate(e=>e.getBoundingClientRect().height)});
  evidence.steps.push("Real Staff-only and explicitly authorized manager: desktop/390px home positions, 54 members, search, expand, 12 months, month filter, pagination, My/Team tabs, Approvals retained.");
  phase="expected-access-denial";
  for(const param of [`view=member&member=${fixture.members[0].id}`,`view=mine&businessId=${fixture.businessId}`,`view=mine&branchId=${fixture.branchId}`,`view=mine&membershipId=${fixture.members[0].id}`,`view=mine&actorUserId=${fixture.managerUserId}`])assert.ok([400,403].includes((await api(staff.page,param)).status));
  await db.user.update({where:{id:fixture.managerUserId},data:{permissions:["APPROVE_LEAVE"]}});
  assert.equal((await api(manager.page,`view=member&member=${fixture.members[1].id}`)).status,403);
  assert.equal((await api(manager.page,"view=auto")).data.canViewTeam,false);
  await db.user.update({where:{id:fixture.managerUserId},data:{permissions:["PERFORMANCE_VIEW_TEAM","APPROVE_LEAVE"]}});
  evidence.steps.push("Direct API spoofed identities rejected; real database permission revocation immediately rejects member API.");
  phase="expected-isolated-network-failure";
  await staff.page.route("**/api/employee-performance?**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"TEST_UNAVAILABLE",message:"Isolated network failure test"}})}));
  await staff.page.reload();await staff.page.getByRole("button",{name:"Retry performance",exact:true}).waitFor();
  await staff.page.getByText("Quick actions",{exact:true}).waitFor();await staff.page.getByRole("button",{name:/Clock In/i}).waitFor();await shot(staff.page,"home-performance-failure-other-actions-available");
  await staff.page.unroute("**/api/employee-performance?**");await staff.page.getByRole("button",{name:"Retry performance",exact:true}).click();await staff.page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();
  await manager.page.route("**/api/employee-performance?**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"TEST_UNAVAILABLE",message:"Isolated manager performance failure"}})}));
  await manager.page.reload();await manager.page.getByRole("button",{name:"Retry performance",exact:true}).waitFor();await manager.page.getByRole("link",{name:"Approvals",exact:true}).waitFor();await manager.page.getByRole("button",{name:/Clock In/i}).waitFor();await shot(manager.page,"manager-performance-failure-approvals-retained");
  await manager.page.unroute("**/api/employee-performance?**");
  await staff.ctx.setOffline(true);await staff.page.getByText(/Offline · Cannot update performance/).waitFor();await shot(staff.page,"staff-offline-private-data-cleared");await staff.ctx.setOffline(false);await staff.page.getByRole("button",{name:"Retry performance",exact:true}).click();await staff.page.getByRole("heading",{name:"My Performance",exact:true}).waitFor();
  phase="normal";
  const keys=await staff.page.evaluate(async()=>{const names=await caches.keys();return(await Promise.all(names.map(async n=>(await(await caches.open(n)).keys()).map(r=>r.url)))).flat();});assert.ok(keys.every(k=>!k.includes("employee-performance")&&!k.includes("/staff/performance")));
  await staff.page.evaluate(()=>window.dispatchEvent(new Event("tetamu:staff-context-changing")));
  await staff.page.getByText("Account or workplace changed. Please reopen performance.",{exact:true}).waitFor();assert.equal(await staff.page.getByRole("heading",{name:"My Performance",exact:true}).count(),0);
  evidence.steps.push("Injected network failure leaves real Clock In/Quick actions usable; retry succeeds. Offline clears private values, context-change clears values, SW caches exclude private performance.");
  assert.equal(evidence.errors.filter(e=>e.type==="pageerror").length,0);
  assert.equal(evidence.errors.filter(e=>e.phase==="normal").length,0);
  evidence.result="PASS";
} catch(error){evidence.result="FAIL";evidence.failure=error.stack;throw error;}
finally{writeFileSync(`${output}/evidence.json`,JSON.stringify(evidence,null,2));await db.$disconnect();await browser.close();}
