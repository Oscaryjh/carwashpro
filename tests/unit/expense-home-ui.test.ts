import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { getExpenseDashboard } from '../../src/lib/expense/service';
import { Prisma } from '@prisma/client';

const require = createRequire(import.meta.url);
// jsdom has no declarations in this repository; narrow the API used by this harness.
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis; } };
type Dashboard = Awaited<ReturnType<typeof getExpenseDashboard>>;
const empty = (): Dashboard => ({ average:'0.00', highest:'0.00', recorded:'0.00', paid:'0.00', unpaid:'0.00', oneOff:'0.00', recurring:'0.00', netSales:null, count:0, topCategory:'', recent:[], bySource:[], byCategory:[], byBranch:[], paymentByMethod:[], paymentBySource:[], paymentsInPeriod:'0.00' });
const state = { dashboard:empty(), branches:[{id:'one',name:'Main'}], create:true, manage:true, input:{} as Record<string,unknown> };
const globals = globalThis as typeof globalThis & { __expenseHome?: typeof state; IS_REACT_ACT_ENVIRONMENT?: boolean };
let directory: string;
let Page: (props:{searchParams:Promise<Record<string,string>>})=>Promise<ReactElement>;
before(async()=>{
  globals.__expenseHome=state;
  directory=await mkdtemp(join(process.cwd(),'node_modules/.cache/expense-home-'));
  const stubs: Record<string,string>={
    '@/lib/expense/outlet-scope': `export const resolveExpenseOutletContext=async()=>({context:{kind:globalThis.__expenseHome.branches.length>1?'legacy_multi_branch':globalThis.__expenseHome.branches.length?'single_outlet':'no_location'}});`,
    'next/link': `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    '@/lib/auth/business-user': `export const requireBusinessUserForModule=async()=>({businessId:'business',access:{},user:{}});`,
    '@/lib/business-groups/business-access': `export const hasBusinessCapability=(_,cap)=>cap==='CREATE_EXPENSE'?globalThis.__expenseHome.create:globalThis.__expenseHome.manage;`,
    '@/lib/expense/access': `export const resolveExpenseReadScope=async()=>({branches:globalThis.__expenseHome.branches,allowedBranchIds:globalThis.__expenseHome.branches.map(b=>b.id),includeBusinessWide:true});`,
    '@/lib/expense/service': `export const ensureStarterExpenseCategories=async()=>{};export const getExpenseDashboard=async input=>{globalThis.__expenseHome.input=input;return globalThis.__expenseHome.dashboard};`,
  };
  await build({entryPoints:['src/app/(business)/expenses/page.tsx'],outfile:join(directory,'page.cjs'),bundle:true,platform:'node',packages:'external',format:'cjs',jsx:'automatic',plugins:[{name:'expense-io',setup(b){
    b.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'expense-io'}:undefined);
    b.onLoad({filter:/.*/,namespace:'expense-io'},args=>({contents:stubs[args.path],resolveDir:process.cwd()}));
    b.onLoad({filter:/\.css$/},()=>({contents:`export default new Proxy({},{get:(_,key)=>key})`,loader:'js'}));
  }}]});
  Page=require(join(directory,'page.cjs')).default;
});
after(async()=>{delete globals.__expenseHome;if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3});});
beforeEach(()=>{state.dashboard=empty();state.branches=[{id:'one',name:'Main'}];state.create=true;state.manage=true;});
async function document(query:Record<string,string>={}){return new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}))).window.document;}
test('home promotes exactly three canonical totals and recent records before breakdowns',async()=>{
  Object.assign(state.dashboard,{recorded:'120.00',paid:'45.00',unpaid:'75.00',oneOff:'120.00',count:2});
  const doc=await document();const cards=[...doc.querySelectorAll('.summaryGrid article')];
  assert.deepEqual(cards.map(c=>c.querySelector('span')?.textContent),['Total Expenses','Paid','Outstanding']);
  assert.deepEqual(cards.map(c=>c.querySelector('strong')?.textContent),['RM 120.00','RM 45.00','RM 75.00']);
  assert.equal(doc.querySelector('h1')?.textContent,'Expenses');
  assert.doesNotMatch(doc.body.textContent??'',/Business performance|Expense settlement|Coverage|Average expense|Highest expense|Materialized facts/);
  const headings=[...doc.querySelectorAll('h2')].map(h=>h.textContent);
  assert.ok(headings.indexOf('Recent expenses')<headings.indexOf('Expense breakdown'));
});
test('empty home has one useful empty state, no zero breakdowns or source/category/branch panels',async()=>{
  state.dashboard.bySource=[{sourceType:'MANUAL',amount:'0.00',count:0}];
  const doc=await document();
  assert.match(doc.body.textContent??'',/No expenses yet/);
  assert.match(doc.body.textContent??'',/Add your first expense to start tracking business spending\./);
  assert.equal(doc.querySelectorAll('.emptyState').length,1);
  assert.doesNotMatch(doc.body.textContent??'',/Where your expenses came from|Top categories|Spending by branch|Expense breakdown/);
  assert.equal(doc.querySelector('.emptyState a')?.getAttribute('href'),'/expenses/new');
});
test('source cards show positive amount OR record count with friendly labels only',async()=>{
  state.dashboard.bySource=[{sourceType:'MANUAL',amount:'0.00',count:0},{sourceType:'CLAIM',amount:'20.00',count:1},{sourceType:'SYSTEM',amount:'0.00',count:1}];
  const doc=await document();const section=doc.querySelector('[aria-labelledby="expense-source-heading"]');
  assert.ok(section);assert.match(section.textContent??'',/Staff Claims/);assert.match(section.textContent??'',/Recurring Expenses/);
  assert.doesNotMatch(section.textContent??'',/Manual Expenses|Inventory Purchases|Payroll/);
});
test('single authorised outlet hides branch section and selector; multiple outlets retain comparison',async()=>{
  state.dashboard.byBranch=[{branchId:'one',branchName:'Main',amount:'10.00',count:1}];
  let doc=await document();assert.equal(doc.querySelector('[name="branchId"]'),null);assert.doesNotMatch(doc.body.textContent??'',/Spending by branch/);
  state.branches.push({id:'two',name:'Second'});doc=await document();
  assert.ok(doc.querySelector('[name="branchId"]'));assert.match(doc.body.textContent??'',/Spending by branch/);
});
test('existing actions preserve destinations and permission checks',async()=>{
  let doc=await document();
  for(const href of ['/expenses/new','/expenses/history','/expenses/categories','/expenses/recurring','/expenses/integrations'])assert.ok(doc.querySelector(`a[href="${href}"]`));
  state.create=false;state.manage=false;doc=await document();assert.equal(doc.querySelector('a[href="/expenses/new"]'),null);assert.equal(doc.querySelector('.manageMenu'),null);assert.ok(doc.querySelector('a[href="/expenses/history"]'));
});
test('recent records retain exact amount, date and detail route with lifecycle status; categories retain rank',async()=>{
  state.dashboard.recent=[{id:'expense-a',expenseNumber:'EXP-001',expenseDate:new Date('2026-10-02T00:00:00Z'),amount:new Prisma.Decimal('37.29'),branchNameSnapshot:'Main',categoryNameSnapshot:'Supplies',payeeName:'Test Payee',sourceType:'MANUAL'}];
  state.dashboard.byCategory=[{categoryId:'cat',categoryName:'Supplies',amount:'37.29',count:1,percentage:100}];
  const doc=await document();const row=doc.querySelector('tbody tr');assert.ok(row);
  assert.match(row.textContent??'',/02 Oct 2026.*EXP-001.*Test Payee.*Supplies.*RM 37.29.*Confirmed/);
  assert.equal(row.querySelector('a')?.getAttribute('href'),'/expenses/expense-a');
  assert.match(doc.querySelector('[aria-labelledby="expense-category-heading"]')?.textContent??'',/1SuppliesRM 37.29/);
});
test('server keeps authorised query scope and date/source contract',async()=>{
  await document({range:'custom',from:'2026-10-01',to:'2026-10-05',sourceType:'CLAIM',branchId:'one'});
  assert.deepEqual(state.input,{businessId:'business',branchId:'one',dateFrom:'2026-10-01',dateTo:'2026-10-05',sourceType:'CLAIM',branches:state.branches,allowedBranchIds:['one'],includeBusinessWide:true});
  const prior=state.input;await assert.rejects(document({branchId:'outside',sourceType:'UNKNOWN'}),/outside your authorised scope/);assert.equal(state.input,prior);
  await document({sourceType:'UNKNOWN'});assert.equal(state.input.branchId,null);assert.equal(state.input.sourceType,null);
});
test('period and filter disclosure work interactively without changing GET field names',async()=>{
  state.dashboard.bySource=[{sourceType:'MANUAL',amount:'10.00',count:1},{sourceType:'CLAIM',amount:'20.00',count:1}];
  const dom=new JSDOM('<div id="root"></div>');
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});globals.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(dom.window.document.getElementById('root')!);
  try{
    const element=await Page({searchParams:Promise.resolve({range:'this-month'})});act(()=>root.render(element));
    const doc=dom.window.document;assert.ok(!doc.querySelector('input[name="from"]'),'preset must hide From');assert.ok(!doc.querySelector('input[name="to"]'),'preset must hide To');
    const period=doc.querySelector('select[name="range"]') as HTMLSelectElement;assert.ok(period);
    act(()=>{period.value='custom';period.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.ok(doc.querySelector('input[name="from"]'));assert.ok(doc.querySelector('input[name="to"]'));
    const toggle=[...doc.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Filters'));assert.ok(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');
    act(()=>toggle.click());assert.equal(toggle.getAttribute('aria-expanded'),'true');
    const form=doc.querySelector('form')!;assert.equal(form.method,'get');
    const data=new dom.window.FormData(form);assert.equal(data.get('range'),'custom');assert.equal(data.get('sourceType'),'');
    assert.ok([...form.querySelectorAll('button')].some(b=>b.type==='submit'&&b.textContent==='Apply'));
    const source=doc.querySelector('select[name="sourceType"]') as HTMLSelectElement;
    source.value='CLAIM';
    let submitted: FormData | undefined;
    form.addEventListener('submit',event=>{event.preventDefault();submitted=new dom.window.FormData(form);});
    act(()=>{period.value='last-month';period.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.equal(submitted?.get('range'),'last-month');assert.equal(submitted?.get('sourceType'),'CLAIM');
    assert.ok(!doc.querySelector('input[name="from"]'));
  }finally{act(()=>root.unmount());dom.window.close();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');delete globals.IS_REACT_ACT_ENVIRONMENT;}
});
test('source filter hides absent, single and zero-count sources',async()=>{
  for(const rows of [[],[{sourceType:'MANUAL' as const,amount:'10.00',count:1}],[{sourceType:'MANUAL' as const,amount:'10.00',count:1},{sourceType:'CLAIM' as const,amount:'0.00',count:0}],[{sourceType:'MANUAL' as const,amount:'10.00',count:1},{sourceType:'CLAIM' as const,amount:'0.00',count:1}]]){
    state.dashboard.bySource=rows;
    assert.equal((await document()).querySelector('select[name="sourceType"]'),null);
  }
});
test('multiple actual sources expose only applicable friendly options',async()=>{
  state.dashboard.bySource=[{sourceType:'MANUAL',amount:'10.00',count:1},{sourceType:'CLAIM',amount:'20.00',count:1},{sourceType:'PAYROLL',amount:'0.00',count:0}];
  const doc=await document();
  assert.deepEqual([...doc.querySelectorAll('select[name="sourceType"] option')].map(o=>[o.getAttribute('value'),o.textContent]),[['','All sources'],['MANUAL','Manual Expenses'],['CLAIM','Staff Claims']]);
});
test('active source stays selected and clearable even when it has no current records',async()=>{
  for(const rows of [[],[{sourceType:'CLAIM' as const,amount:'20.00',count:1}]]){
    state.dashboard.bySource=rows;
    const doc=await document({range:'custom',from:'2026-10-01',to:'2026-10-05',sourceType:'CLAIM',branchId:'one'});
    const select=doc.querySelector<HTMLSelectElement>('select[name="sourceType"]');assert.ok(select);
    assert.equal(select.value,'CLAIM');
    assert.deepEqual([...select.options].map(o=>o.value),['','CLAIM']);
    assert.equal(doc.querySelector('input[name="from"]')?.getAttribute('value'),'2026-10-01');
    assert.equal(doc.querySelector('input[name="branchId"]')?.getAttribute('value'),'one');
    select.value='';assert.equal(select.value,'');
  }
});
