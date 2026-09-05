import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root='/Users/innovdia/.codex/local-uat/tetamu-performance-20260905';
const output='/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux';
const sessions=JSON.parse(readFileSync(`${root}/sessions.json`,'utf8'));
const base='http://127.0.0.1:3106';const phase=process.argv[2]??'before';
mkdirSync(`${output}/${phase}`,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const evidence={errors:[],steps:[],snapshots:{},measurements:{}};
let expectedFailure=false;
const normalized=value=>JSON.parse(JSON.stringify(value,(key,v)=>['asOf','to','previousTo'].includes(key)?undefined:v));
async function ready(page){await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();await page.getByLabel('Performance month').waitFor();}
async function save(page,name){await page.screenshot({path:`${output}/${phase}/${name}.png`,fullPage:true});}
try{
 for(const role of ['A','manager']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addCookies([{name:'tetamu_employee_session',value:sessions[role].token,url:base,secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>evidence.errors.push({type:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error')evidence.errors.push({type:'console',expected:expectedFailure,message:m.text()});});
  await page.goto(base+'/staff');await page.getByRole('heading',{name:role==='A'?'My Performance':'Team Performance',exact:true}).waitFor();
  evidence.measurements[role]={cardHeight:(await page.getByRole('region',{name:'Staff home',exact:true}).getByTestId('staff-performance').boundingBox()).height};
  await page.screenshot({path:`${output}/${phase}/${role}-home-390.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:`${output}/${phase}/${role}-home-desktop.png`,fullPage:true});
  await page.goto(base+'/staff/performance');await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();
  await page.getByLabel('Performance month').waitFor();
  await page.screenshot({path:`${output}/${phase}/${role}-detail-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/${phase}/${role}-detail-390.png`,fullPage:true});
  const snapshot=await page.evaluate(async()=>{const r=await fetch('/api/employee-performance?view=auto');if(!r.ok)throw Error(`API ${r.status}`);return r.json();});evidence.snapshots[role]=snapshot;
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=390);
  if(phase==='after'){
    const before=JSON.parse(readFileSync(`${output}/before/evidence.json`,'utf8')).snapshots[role];
    assert.deepEqual(normalized(snapshot),normalized(before),'No amount, permission, coverage or scope change');
    const annual=page.getByRole('region',{name:'Annual performance',exact:true});
    await annual.getByText('View breakdown',{exact:true}).click();await annual.getByText('Refunds',{exact:true}).waitFor();
    assert.ok(!(await annual.innerText()).includes('−RM0.00'));assert.equal(await page.getByText('Net total',{exact:true}).count(),0);
    await annual.getByText('View breakdown',{exact:true}).click();
    await page.getByRole('button',{name:'Select Aug',exact:true}).click();await ready(page);
    assert.match(await page.getByRole('region',{name:'Monthly performance',exact:true}).innerText(),/August 2026/);
    assert.match(await annual.innerText(),new RegExp((role==='A'?'49,950.00':'600,000.00').replace('.','\\.')));
    await page.getByRole('button',{name:'Select Sep',exact:true}).focus();await page.keyboard.press('Enter');await ready(page);
    await page.getByRole('region',{name:'Monthly performance',exact:true}).scrollIntoViewIfNeeded();await save(page,`${role}-monthly-390`);
    await page.getByText('View monthly figures',{exact:true}).click();assert.equal(await page.getByRole('table').locator('tbody tr').count(),12);await page.getByText('View monthly figures',{exact:true}).click();
    await page.getByRole('button',{name:'Select Dec, not started',exact:true}).click();await ready(page);assert.match(await page.getByRole('region',{name:'Monthly performance',exact:true}).innerText(),/Not started/);
    await page.getByLabel('Performance year').selectOption('2027');await ready(page);assert.match(await annual.innerText(),/This year has not started/);
    await page.getByLabel('Performance year').selectOption(String(snapshot.year));await ready(page);await page.getByLabel('Performance month').selectOption(String(snapshot.month));await ready(page);
    await page.getByRole('button',{name:'Refresh performance',exact:true}).click();await ready(page);
    if(role==='A'){
      const transactions=page.getByRole('region',{name:'Transactions',exact:true});await transactions.locator('details summary').first().click();await transactions.scrollIntoViewIfNeeded();await save(page,'A-transactions-390');
      assert.equal(await page.getByRole('button',{name:'Previous',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Next',exact:true}).count(),0);
      await page.getByRole('button',{name:'Team performance',exact:true}).click();await ready(page);assert.equal(await page.getByRole('heading',{name:'Members · this branch',exact:true}).count(),0);
      await page.getByRole('button',{name:'My performance',exact:true}).click();await ready(page);
    }else{
      await page.getByLabel('Search name or employee number').fill('UAT-A');await page.getByRole('button',{name:'Search members',exact:true}).click();await ready(page);
      await page.getByText('UAT Employee A',{exact:true}).click();await page.getByRole('button',{name:'View months & details',exact:true}).click();await ready(page);
      await page.getByRole('button',{name:'‹ Back to team members',exact:true}).click();await ready(page);await page.getByRole('heading',{name:'Members · this branch',exact:true}).waitFor();
      await page.getByRole('heading',{name:'Members · this branch',exact:true}).scrollIntoViewIfNeeded();await save(page,'manager-members-390');
    }
    expectedFailure=true;
    await page.route('**/api/employee-performance?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'UAT_UNAVAILABLE',message:'Performance is temporarily unavailable.'}})}));
    await page.getByRole('button',{name:'Refresh performance',exact:true}).click();await page.getByRole('button',{name:'Retry performance',exact:true}).waitFor();await save(page,`${role}-retry-390`);
    await page.unroute('**/api/employee-performance?**');await page.getByRole('button',{name:'Retry performance',exact:true}).click();await ready(page);expectedFailure=false;
    const explanation=page.getByText('How performance is calculated',{exact:true});await explanation.click();
    assert.ok(await explanation.evaluate(e=>{const b=e.getBoundingClientRect();return e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),'Calculation disclosure can scroll above fixed navigation');
    const navBefore=await page.getByRole('link',{name:'Approvals',exact:true}).count();
    expectedFailure=true;
    await page.route('**/api/employee-performance?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'UAT_UNAVAILABLE',message:'Performance is temporarily unavailable.'}})}));
    await page.goto(base+'/staff');await page.getByRole('button',{name:'Retry performance',exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Clock In',exact:true}).isEnabled(),'Performance failure does not block clock in');
    assert.equal(await page.getByRole('link',{name:'Approvals',exact:true}).count(),navBefore,'Approval navigation remains unchanged');
    assert.equal(navBefore,role==='manager'?1:0,'Only the authorized manager retains the existing Approvals navigation');
    await page.locator('#staff-home-quick-access-heading').scrollIntoViewIfNeeded();await page.getByRole('link',{name:'Open Schedule',exact:true}).waitFor();await save(page,`${role}-home-failure-390`);
    await page.unroute('**/api/employee-performance?**');await page.getByRole('button',{name:'Retry performance',exact:true}).click();await page.getByRole('heading',{name:role==='A'?'My Performance':'Team Performance',exact:true}).waitFor();expectedFailure=false;
    evidence.steps.push(`${role}: unchanged real DTO; chart pointer/keyboard month, figures, year, tabs, breakdown, transactions/member return, refresh and 503 retry`);
    evidence.steps.push(`${role}: footer disclosure unobstructed; home failure leaves Clock In, Quick actions and original approval navigation available`);
  }
  evidence.steps.push(`${role}: real home/detail 390 and desktop`);
  await context.close();
 }
 if(phase==='after'){
  // Existing prior-stage transactions only: no seeding or new sale for pagination.
  const session=JSON.parse(readFileSync(`${root}/uiux-pagination-session.json`,'utf8'));
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'tetamu_employee_session',value:session.token,url:base,secure:true,httpOnly:true,sameSite:'Strict'}]);
  const p=await context.newPage();p.on('pageerror',e=>evidence.errors.push({type:'pageerror',message:e.message}));
  await p.goto(base+'/staff/performance');await ready(p);await p.getByLabel('Performance month').selectOption('8');await ready(p);
  await p.getByRole('button',{name:'Next',exact:true}).click();await ready(p);await p.getByText('2 of 2',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Previous',exact:true}).scrollIntoViewIfNeeded();await save(p,'existing-fixture-pagination-390');await p.getByRole('button',{name:'Previous',exact:true}).click();await ready(p);await p.getByText('1 of 2',{exact:true}).waitFor();await context.close();
  evidence.steps.push('Real existing prior-stage 20-row pagination: next and previous, no transaction creation');
  // Supplementary UI-only responses. They never enter the database or replace real UAT evidence above.
  const context2=await browser.newContext({viewport:{width:390,height:844}});await context2.addCookies([{name:'tetamu_employee_session',value:sessions.A.token,url:base,secure:true,httpOnly:true,sameSite:'Strict'}]);
  const sp=await context2.newPage();sp.on('pageerror',e=>evidence.errors.push({type:'pageerror',message:e.message}));
  const clean={salesReceived:0,tipsReceived:0,salesRefunds:0,tipsRefunds:0,refunds:0,total:0};
  for(const variant of ['pending','zero-no-target','negative','above-target-long-order']){
    const dto=structuredClone(evidence.snapshots.A),s=dto.detail.subject;
    if(variant==='pending'){
      s.complete=false;s.attributionComplete=false;s.progress={percent:null,gap:null};s.comparison.complete=false;
      dto.detail.months[dto.month-1].complete=false;
    }else{
      const amount=variant==='negative'?{...clean,salesRefunds:12345,refunds:12345,total:-12345}:variant==='above-target-long-order'?{...clean,salesReceived:123456789,total:123456789}:{...clean};
      s.annual=amount;s.current=amount;s.previous={...clean};s.complete=true;s.attributionComplete=true;
      s.goal=variant==='zero-no-target'?null:5000000;s.progress=variant==='zero-no-target'?{percent:null,gap:null}:{percent:variant==='negative'?-.2469:2469.13578,gap:5000000-amount.total};
      s.comparison={...s.comparison,complete:true,percent:null,delta:amount.total};
      dto.detail.months=dto.detail.months.map(m=>({...m,complete:true,amount:m.month===dto.month?amount:{...clean}}));
      dto.detail.events=variant==='zero-no-target'?[]:[{...dto.detail.events[0],kind:variant==='negative'?'REFUND':'PAYMENT',amount,orderNumber:'LONG-UAT-ORDER-NUMBER-'.repeat(6)}];dto.detail.totalRows=dto.detail.events.length;
    }
    dto.personal=structuredClone(s);
    await sp.route('**/api/employee-performance?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(dto)}));
    await sp.goto(base+'/staff/performance');await ready(sp);
    const a=sp.getByRole('region',{name:'Annual performance',exact:true});
    if(variant==='pending'){assert.match(await a.innerText(),/verified subtotal/i);assert.match(await a.innerText(),/still unassigned/i);assert.equal(await a.getByRole('img').count(),0);}
    if(variant==='zero-no-target'){assert.match(await a.innerText(),/Annual target not set/);assert.equal(await a.getByRole('img').count(),0);assert.match(await sp.getByRole('region',{name:'Transactions'}).innerText(),/No contributions recorded/);}
    if(variant==='negative'){assert.match(await a.innerText(),/−RM123.45/);const bar=sp.locator(`svg rect[data-month="${dto.month}"]`);assert.ok(Number(await bar.getAttribute('height'))>0);}
    if(variant==='above-target-long-order'){assert.match(await a.innerText(),/2,469.14% achieved/);await sp.getByRole('region',{name:'Transactions'}).locator('summary').first().click();await sp.getByText('Order: '+dto.detail.events[0].orderNumber,{exact:true}).waitFor();}
    assert.ok(await sp.evaluate(()=>document.documentElement.scrollWidth)<=390);await save(sp,`ui-injection-${variant}`);await sp.unroute('**/api/employee-performance?**');
  }
  await context2.close();evidence.steps.push('Supplementary UI-only injected pending, zero/no target, negative and large over-target/long-order states; no database writes.');
  const context3=await browser.newContext({viewport:{width:390,height:844}});await context3.addCookies([{name:'tetamu_employee_session',value:sessions.manager.token,url:base,secure:true,httpOnly:true,sameSite:'Strict'}]);
  const mp=await context3.newPage();mp.on('pageerror',e=>evidence.errors.push({type:'pageerror',message:e.message}));
  const managerDto=structuredClone(evidence.snapshots.manager);managerDto.team.level=3;managerDto.team.nextGap=0;managerDto.team.annual.total=123456789;
  managerDto.detail.subject=structuredClone(managerDto.team);managerDto.detail.members[0].fullName='UAT Long Display Name For Member Layout Verification Only';managerDto.detail.members[0].summary.annual.total=123456789;
  await mp.route('**/api/employee-performance?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(managerDto)}));
  await mp.goto(base+'/staff/performance');await ready(mp);assert.match(await mp.getByRole('region',{name:'Annual performance'}).innerText(),/All levels achieved/);
  await mp.getByText(managerDto.detail.members[0].fullName,{exact:true}).click();await mp.getByRole('button',{name:'View months & details',exact:true}).waitFor();
  assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth)<=390);await save(mp,'ui-injection-manager-long-name-level3');await context3.close();
  evidence.steps.push('Supplementary UI-only manager long name/amount and all three levels achieved; no database writes.');
 }
 assert.deepEqual(evidence.errors.filter(e=>!e.expected),[]);evidence.result='PASS';
}catch(e){evidence.result='FAIL';evidence.failure=e.stack;throw e;}
finally{writeFileSync(`${output}/${phase}/evidence.json`,JSON.stringify(evidence,null,2));await browser.close();}
