import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),{chromium}=require("/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const f=JSON.parse(readFileSync("/tmp/tetamu-phase3-browser-fixture.json","utf8"));
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const evidence={errors:[],requests:[]},output="/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui";
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  await ctx.addCookies([{name:"tetamu_employee_session",value:f.sessions[0].token,url:"http://127.0.0.1:3105",httpOnly:true,sameSite:"Lax"}]);
  const page=await ctx.newPage();page.on("pageerror",e=>evidence.errors.push(e.message));page.on("request",r=>{if(r.url().includes("employee-performance"))evidence.requests.push(r.url());});
  await page.goto("http://127.0.0.1:3105/staff");await page.getByRole("button",{name:/Clock In/i}).waitFor();await page.getByRole("link",{name:"Approvals",exact:true}).waitFor();
  assert.equal(await page.locator('[data-testid="staff-performance"]:visible').count(),0);assert.equal(evidence.requests.length,0);
  await page.screenshot({path:`${output}/mobile-feature-off-home.png`,fullPage:true});
  const api=await ctx.request.get("http://127.0.0.1:3105/api/employee-performance");assert.equal(api.status(),404);assert.match(api.headers()["cache-control"],/private.*no-store/);
  const detail=await ctx.request.get("http://127.0.0.1:3105/staff/performance");assert.equal(detail.status(),404);
  evidence.status="PASS";assert.equal(evidence.errors.length,0);
}catch(e){evidence.status="FAIL";evidence.failure=e.stack;throw e;}finally{writeFileSync(`${output}/disabled-evidence.json`,JSON.stringify(evidence,null,2));await browser.close();}
