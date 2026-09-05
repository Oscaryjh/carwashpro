import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root='/Users/innovdia/.codex/local-uat/tetamu-performance-20260905';
const output='/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat';
const config=JSON.parse(readFileSync(`${root}/config.json`,'utf8'));
const sessions=JSON.parse(readFileSync(`${root}/sessions.json`,'utf8'));
const fixture=JSON.parse(readFileSync(`${root}/current.json`,'utf8'));
const base='http://127.0.0.1:3106',role=process.argv[2],smoke=role==='smoke';
if(!smoke&&!['owner','owner-pos','manager','A','B','C'].includes(role))throw new Error('Unknown UAT identity');
mkdirSync(output,{recursive:true});
const evidence={startedAt:new Date().toISOString(),steps:[],pageErrors:[],consoleErrors:[],screenshots:[],metrics:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:smoke,args:['--disable-background-networking','--disable-sync','--no-first-run',...(smoke?[]:['--window-size=1440,1050'])]});
async function open(identity){
  const ctx=await browser.newContext({viewport:smoke?{width:1440,height:1000}:null});
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  if(!identity.startsWith('owner'))await ctx.addCookies([{name:'tetamu_employee_session',value:sessions[identity].token,url:base,httpOnly:true,sameSite:'Strict',secure:true,expires:Math.floor(new Date(sessions[identity].expiresAt).getTime()/1000)}]);
  const page=await ctx.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>evidence.pageErrors.push({identity,message:error.message}));
  page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push({identity,message:message.text()});});
  if(identity.startsWith('owner')){
    await page.goto(base+'/login');await page.locator('input[name=email]').fill(fixture.ownerEmail);await page.locator('input[name=password]').fill(config.ownerPassword);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>!url.pathname.startsWith('/login'));
    await page.goto(`${base}/team/performance?tab=targets&year=${fixture.year}&month=${fixture.month}`);
    await page.getByRole('heading',{name:/年度目标设置/}).waitFor();
    if(identity==='owner-pos')await page.goto(`${base}/cashier?appointmentId=${fixture.manualAppointmentId}`);
  }else{
    await page.goto(base+'/staff');await page.getByRole('heading',{name:identity==='manager'?'Team Performance':'My Performance',exact:true}).waitFor();
  }
  return{ctx,page};
}
async function shot(page,name){await page.screenshot({path:`${output}/${name}.png`,fullPage:true});evidence.screenshots.push(name);}
async function api(page,query){return page.evaluate(async q=>{const response=await fetch(`/api/employee-performance?${q}`,{cache:'no-store'});return{status:response.status,data:await response.json()};},query);}
if(!smoke){
  const {page}=await open(role);
  console.log(`Interactive ${role} UAT opened on port 3106; no OTP sent.`);
  await page.bringToFront();await new Promise(resolve=>browser.once('disconnected',resolve));
}else{
  try{
    const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
    const before=await db.payment.count({where:{businessId:fixture.businessId}});
    const owner=await open('owner');
    assert.equal(await owner.page.getByLabel('Annual target UAT-MGR',{exact:true}).inputValue(),'300000.00');
    for(const code of ['A','B','C','D','E','F'])assert.equal(await owner.page.getByLabel(`Annual target UAT-${code}`,{exact:true}).inputValue(),'50000.00');
    assert.equal(await owner.page.getByLabel('Level 1 target').inputValue(),'600000.00');
    await shot(owner.page,'owner-targets-desktop');
    await owner.page.setViewportSize({width:390,height:844});await shot(owner.page,'owner-targets-390');
    assert.ok(await owner.page.evaluate(()=>document.documentElement.scrollWidth)<=390);
    evidence.steps.push('Owner password login; seven annual targets and cumulative thresholds; desktop and 390px target page. No targets edited.');
    await owner.page.setViewportSize({width:1440,height:1000});await owner.page.goto(`${base}/cashier?appointmentId=${fixture.manualAppointmentId}`);
    await owner.page.getByRole('button',{name:/^Payment ·/}).waitFor();await shot(owner.page,'owner-pos-desktop');
    // Only prepare a cart and inspect controls. Do NOT submit the manual RM118 payment.
    await owner.page.getByRole('button',{name:/^Payment ·/}).click();await owner.page.getByRole('dialog',{name:'Payment',exact:true}).waitFor();
    await owner.page.getByRole('button',{name:'Multiple employees',exact:true}).click();
    await owner.page.getByRole('button',{name:'UAT Employee A · UAT-A',exact:true}).click();
    await owner.page.getByRole('button',{name:'UAT Employee B · UAT-B',exact:true}).click();
    await owner.page.getByRole('button',{name:'Split equally',exact:true}).click();
    assert.equal(await owner.page.getByLabel('Sales percent UAT-A').inputValue(),'50');
    await owner.page.getByLabel('Tip amount · 小费（不是发放）',{exact:true}).fill('10');
    await owner.page.getByLabel('Search tip recipient',{exact:true}).fill('UAT-C');
    await owner.page.getByRole('button',{name:'UAT Employee C · UAT-C',exact:true}).last().click();
    const attribution=JSON.parse(await owner.page.locator('input[name=performanceAttribution]').inputValue());
    assert.equal(attribution.tipMembershipId,fixture.members.find(m=>m.code==='UAT-C').id);
    assert.equal(attribution.sales.length,2);
    await owner.page.getByRole('button',{name:'Exact RM118.00',exact:true}).click();
    const confirm=owner.page.getByRole('button',{name:'Confirm payment · RM118.00',exact:true});
    assert.equal(await confirm.isEnabled(),true);
    await shot(owner.page,'owner-pos-attribution-desktop');await owner.page.setViewportSize({width:390,height:844});
    await owner.page.getByLabel('Sales percent UAT-B').scrollIntoViewIfNeeded();await shot(owner.page,'owner-pos-attribution-390');
    await confirm.scrollIntoViewIfNeeded();assert.equal(await confirm.isVisible(),true);
    const box=await confirm.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844);
    assert.ok(await owner.page.evaluate(()=>document.documentElement.scrollWidth)<=390);
    await owner.page.getByRole('button',{name:'Close payment',exact:true}).click();
    evidence.steps.push('Actual POS service cart, payment dialog, A/B equal sales allocation, independent C tip, mobile scroll; no payment submitted.');
    for(const identity of ['A','B','C','manager']){
      const {page}=await open(identity);
      assert.match(await page.locator('body').innerText(),/UAT TEST ONLY/);
      const card=page.locator('[data-testid="staff-performance"]:visible');
      const positions=await page.evaluate(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().top;return{card:r('[data-testid="staff-performance"]'),up:r('#staff-home-up-next-heading')??r('#staff-home-next-heading'),quick:r('#staff-home-quick-access-heading')};});
      assert.ok(positions.card<positions.quick&&positions.card>positions.up);evidence.metrics.push({identity,...positions});
      if(identity==='manager')await page.getByRole('link',{name:'Approvals',exact:true}).waitFor();
      for(const name of ['Home','Time','Pay','Profile'])await page.getByRole('link',{name,exact:true}).waitFor();
      const data=await api(page,'view=card');assert.equal(data.status,200);assert.equal(data.data.team.annual.total,60000000);assert.equal(data.data.team.complete,true);
      assert.equal(data.data.personal.annual.total,{A:4995000,B:4995000,C:5010000,manager:30000000}[identity]);
      assert.equal(data.data.canViewTeam,identity==='manager');
      if(identity==='A'||identity==='manager'){await shot(page,`${identity==='A'?'employee':'manager'}-home-desktop`);await page.setViewportSize({width:390,height:1000});await shot(page,`${identity==='A'?'employee':'manager'}-home-390`);}
      await card.getByRole('link').click();await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();
      await page.getByLabel('Performance month').selectOption(String(fixture.month-1||12));
      await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();
      if(identity==='manager'){
        await page.getByLabel('Search name or employee number').fill('UAT-A');await page.getByRole('button',{name:'Search members',exact:true}).click();
        await page.getByText('UAT Employee A',{exact:true}).click();await page.getByRole('button',{name:'View months & details',exact:true}).click();
        await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();await shot(page,'manager-member-390');
      }else if(identity==='A'){
        await shot(page,'employee-detail-390');await page.getByRole('button',{name:'Team performance',exact:true}).click();
        await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();assert.equal(await page.getByText('Members · this branch',{exact:true}).count(),0);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<= (identity==='A'||identity==='manager'?390:1440));
    }
    evidence.steps.push('Actual staff A/B/C and explicitly authorized manager sessions; exact complete balances; home placement/nav; monthly selector; manager search/member detail; employee team-only summary.');
    const after=await db.payment.count({where:{businessId:fixture.businessId}});assert.equal(after,before);assert.equal(after,13);
    assert.equal(await db.payment.count({where:{businessId:fixture.businessId,amount:118}}),0);
    await db.$disconnect();assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.consoleErrors,[]);evidence.result='PASS';
  }catch(error){evidence.result='FAIL';evidence.failure=error.stack;for(const context of browser.contexts())for(const page of context.pages())if(!page.url().includes('/login')){await shot(page,'smoke-failure');writeFileSync(`${output}/smoke-failure-text.txt`,await page.locator('body').innerText());}console.error(error);process.exitCode=1;}
  finally{writeFileSync(`${output}/smoke.json`,JSON.stringify(evidence,null,2));await browser.close();}
}
