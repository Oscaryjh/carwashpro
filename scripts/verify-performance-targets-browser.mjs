import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'/Users/innovdia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PERFORMANCE_TEST_ORIGIN??'http://127.0.0.1:3103';
if(new URL(base).hostname!=='127.0.0.1'||new URL(base).port!=='3103')throw new Error('Dedicated local Phase 2 server required');
const password=process.env.LOCAL_PERFORMANCE_TEST_PASSWORD;if(!password)throw new Error('Explicit local fixture password required');
const output=process.env.PERFORMANCE_EVIDENCE_DIR;if(!output)throw new Error('Evidence directory required');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const consoleErrors=[],pageErrors=[],steps=[];let page;
function observe(p){p.setDefaultTimeout(12000);p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});p.on('pageerror',e=>pageErrors.push(e.message));}
async function login(context,email){const p=await context.newPage();observe(p);await p.goto(base+'/login');await p.locator('input[name=email]').fill(email);await p.locator('input[name=password]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(u=>!u.pathname.startsWith('/login'));return p;}
const route=tab=>`${base}/team/performance?year=2026&month=8&tab=${tab}`;
const shot=async(name,p=page)=>{await p.screenshot({path:`${output}/${name}.png`,fullPage:true});await p.screenshot({path:`${output}/${name}-viewport.png`});steps.push(name);};
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 page=await login(ctx,'performance-browser-salon@tetamu.test');await page.goto(route('targets'));await page.getByRole('heading',{name:/年度目标设置/}).waitFor();
 const initialRevision=Number((await page.getByRole('heading',{name:/年度目标设置/}).innerText()).match(/当前版本 (\d+)/)?.[1]??0);
 for(const [index,amount] of ['600000','800000','1000000'].entries())await page.getByLabel(`Level ${index+1} target`).fill(amount);
 assert.equal(await page.locator('input[aria-label^="Annual target"]').count(),54);
 await page.getByLabel('Target manager',{exact:true}).selectOption({label:'Alex Manager · PERF-001 · ACTIVE'});
 for(let i=2;i<=7;i++)await page.getByLabel(`Allocate PERF-${String(i).padStart(3,'0')}`,{exact:true}).check();
 await page.getByRole('button',{name:'预览平均分配',exact:true}).click();await page.getByRole('button',{name:'应用分配',exact:true}).click();
 assert.equal(await page.getByLabel('Annual target PERF-001',{exact:true}).inputValue(),'300000.00');assert.equal(await page.getByLabel('Annual target PERF-007',{exact:true}).inputValue(),'50000.00');
 await page.getByLabel('Search target employees').fill('PERF-007');assert.equal(await page.locator('input[aria-label^="Annual target"]').count(),1);await page.getByLabel('Search target employees').fill('');
 await page.getByLabel('Target change reason').fill('Initial browser annual allocation');
 await page.getByLabel('Level 2 target').fill('500000');await page.getByRole('button',{name:'预览发布',exact:true}).click();await page.getByRole('alert').filter({hasText:'严格递增'}).waitFor();assert.equal(await page.getByLabel('Annual target PERF-001',{exact:true}).inputValue(),'300000.00');steps.push('server-rejection-keeps-input');
 await page.getByLabel('Level 2 target').fill('800000');await page.getByRole('button',{name:'预览发布',exact:true}).click();await page.getByLabel('Target publish preview').waitFor();await shot('desktop-target-preview');
 await page.getByRole('button',{name:'确认发布目标',exact:true}).click();await page.getByRole('heading',{name:new RegExp(`当前版本 ${initialRevision+1}`)}).waitFor();steps.push(`initial-publish-version-${initialRevision+1}`);
 await page.goto(route('overview'));await page.getByRole('heading',{name:'业绩管理',exact:true}).waitFor();assert.match(await page.locator('main').last().innerText(),/602,915/);await shot('desktop-overview');
 await page.locator('summary').filter({hasText:'PERF-001'}).click();await shot('desktop-member-months');
 const stale=await ctx.newPage();observe(stale);await stale.goto(route('targets'));await stale.getByLabel('Target change reason').fill('Stale competing browser edit');await stale.getByRole('button',{name:'预览发布',exact:true}).click();await stale.getByLabel('Target publish preview').waitFor();
 await page.setViewportSize({width:390,height:844});await page.goto(route('targets'));await page.getByLabel('Level 1 target').fill('610000');assert.equal(await page.getByLabel('Annual target PERF-007',{exact:true}).inputValue(),'50000.00');await page.getByLabel(/我确认保留/).check();await page.getByLabel('Target change reason').fill('Mobile threshold increase only');await page.getByRole('button',{name:'预览发布',exact:true}).click();await page.getByLabel('Target publish preview').waitFor();await shot('mobile-target-preview');await page.getByRole('button',{name:'确认发布目标',exact:true}).click();await page.getByRole('heading',{name:new RegExp(`当前版本 ${initialRevision+2}`)}).waitFor();steps.push(`mobile-publish-version-${initialRevision+2}`);
 await stale.getByRole('button',{name:'确认发布目标',exact:true}).click();await stale.getByRole('alert').filter({hasText:'版本已改变'}).waitFor();assert.equal(await stale.getByLabel('Target change reason').inputValue(),'Stale competing browser edit');await shot('stale-version-rejected',stale);await stale.close();
 await page.goto(route('overview'));await page.getByRole('heading',{name:'业绩管理',exact:true}).waitFor();assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=390);await shot('mobile-overview');
 await page.goto(route('details'));await page.getByRole('heading',{name:'收款与退款事件'}).waitFor();assert.match(await page.locator('main').last().innerText(),/29 个来源/);await page.getByRole('link',{name:'下一页',exact:true}).click();await page.getByText(/第 2 \/ 2 页/).waitFor();await shot('mobile-details-page-2');
 await page.locator('select[name=component]').selectOption('TIP');await page.getByRole('button',{name:'筛选明细'}).click();await page.getByRole('heading',{name:'收款与退款事件'}).waitFor();await page.locator('details').first().locator('summary').first().click();await shot('mobile-tip-detail');assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=390);steps.push('detail-filter-pagination-expand');
 await page.locator('select[name=range]').selectOption('year');await page.locator('select[name=employee]').selectOption({label:'Tip Only Employee · PERF-003'});await page.locator('select[name=status]').selectOption('CAPTURED_VERIFIED');await page.getByRole('button',{name:'筛选明细'}).click();await page.getByText(/28 个来源/).waitFor();await shot('mobile-year-employee-status-filter');
 await page.goto(route('overview'));await page.getByLabel('Find performance member').fill('PERF-001');await page.getByRole('button',{name:'查找成员',exact:true}).click();await page.locator('summary').filter({hasText:'PERF-001'}).waitFor();assert.equal(await page.locator('summary').filter({hasText:'PERF-001'}).count(),1);assert.equal(await page.locator('summary').filter({hasText:'PERF-002'}).count(),0);steps.push('overview-member-search');
 await page.goto(route('targets'));await page.getByRole('heading',{name:'不可变发布历史'}).waitFor();await page.locator('summary').filter({hasText:/^版本 1 ·/}).click();await shot('mobile-target-history');
 await page.goto(route('targets').replace('year=2026','year=2027'));await page.getByRole('button',{name:'复制上一年度为草稿'}).click();await page.getByRole('status').filter({hasText:'尚未发布'}).waitFor();assert.equal(await page.getByLabel('Annual target PERF-007',{exact:true}).inputValue(),'50000.00');await page.getByLabel('Allocate PERF-007',{exact:true}).check();await page.getByLabel('Bulk target').fill('999.99');await page.getByRole('button',{name:'批量套用个人目标'}).click();assert.equal(await page.getByLabel('Annual target PERF-007',{exact:true}).inputValue(),'999.99');await shot('mobile-copy-and-bulk-draft');
 await page.goto(route('overview'));await page.locator('select[name=branch]').selectOption({label:'Empty performance branch'});await page.getByRole('button',{name:'查看',exact:true}).click();await page.getByText('本年度没有成员、个人目标或贡献。团队实收仍独立核查。').waitFor();await shot('mobile-empty-branch');
 const readonly=await browser.newContext({viewport:{width:390,height:844}});const rp=await login(readonly,'phase2-reader@tetamu.test');await rp.goto(route('targets'));await rp.getByRole('heading',{name:'年度目标（只读）'}).waitFor();assert.equal(await rp.getByRole('button',{name:'确认发布目标',exact:true}).count(),0);await shot('mobile-readonly-no-payroll',rp);steps.push('reader-without-payroll-module');await readonly.close();
 assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);
 console.log(JSON.stringify({status:'PASS',steps,pageErrors,consoleErrors},null,2));
}catch(e){if(page)await shot('failure');console.error(e);process.exitCode=1;}
finally{await writeFile(`${output}/browser-results.json`,JSON.stringify({steps,pageErrors,consoleErrors},null,2));await browser.close();}
