import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { historyDatePeriods } from '../../src/app/(business)/expenses/history/date-periods';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom') as {JSDOM:new(html:string)=>{window:Window & typeof globalThis}};
const item={id:'expense-1',expenseNumber:'EXP-001',expenseDate:new Date('2026-10-02'),payeeName:'Test supplier',description:'Office supplies',categoryNameSnapshot:'Supplies',branchNameSnapshot:'Internal branch',amount:{toFixed:()=> '12.34'},paymentStatus:'UNPAID',status:'CONFIRMED',sourceType:'MANUAL',attachments:[],sourceSettlement:null};
const state={items:[] as typeof item[],total:0,allTotal:0,branches:[{id:'one',name:'Main'}],canCreate:true,calls:[] as Record<string,unknown>[]};
const globals=globalThis as typeof globalThis & {__expenseHistory?:typeof state;IS_REACT_ACT_ENVIRONMENT?:boolean};
let directory:string;
let Page:(props:{searchParams:Promise<Record<string,string>>})=>Promise<ReactElement>;
before(async()=>{
 globals.__expenseHistory=state;directory=await mkdtemp(join(process.cwd(),'node_modules/.cache/expense-history-'));
 const stubs:Record<string,string>={
  'next/link':`import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
  '@/lib/auth/business-user':`export const requireBusinessUserForModule=async(m,c)=>{if(m!=='EXPENSE'||c!=='VIEW_EXPENSE')throw Error('permission changed');return {businessId:'business',access:{},user:{}}};`,
  '@/lib/business-groups/business-access':`export const hasBusinessCapability=()=>globalThis.__expenseHistory.canCreate;`,
  '@/lib/expense/access':`export const resolveExpenseReadScope=async()=>({branches:globalThis.__expenseHistory.branches,allowedBranchIds:globalThis.__expenseHistory.branches.map(b=>b.id),includeBusinessWide:true});`,
  '@/lib/prisma':`export const prisma={expenseCategory:{findMany:async()=>[{id:'category',name:'Supplies'}]}};`,
  '@/lib/expense/service':`export const ensureStarterExpenseCategories=async()=>{};export const listBusinessExpenses=async(input)=>{const s=globalThis.__expenseHistory;s.calls.push(input);return {items:input.pageSize===1?[]:s.items,total:input.pageSize===1?s.allTotal:s.total,page:input.page||1,pageSize:input.pageSize||25}};`,
 };
 await build({entryPoints:['src/app/(business)/expenses/history/page.tsx'],outfile:join(directory,'page.cjs'),bundle:true,platform:'node',packages:'external',format:'cjs',jsx:'automatic',plugins:[{name:'io',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],resolveDir:process.cwd()}));b.onLoad({filter:/\.css$/},()=>({contents:`export default new Proxy({},{get:(_,k)=>k})`,loader:'js'}));}}]});
 Page=require(join(directory,'page.cjs')).default;
});
after(async()=>{delete globals.__expenseHistory;await rm(directory,{recursive:true,force:true,maxRetries:3});});
beforeEach(()=>{state.items=[];state.total=0;state.allTotal=0;state.branches=[{id:'one',name:'Main'}];state.canCreate=true;state.calls=[];});
async function document(query:Record<string,string>={}){return new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}))).window.document;}
test('history has compact default filters, one count, and genuine no-data state',async()=>{
 const doc=await document();assert.equal(doc.querySelector('h1')?.textContent,'Expense History');
 assert.ok(doc.querySelector('[placeholder="Search expense no., payee or description"]'));
 assert.equal(doc.querySelector('select[aria-label="Period"]')?.querySelector('option[selected]')?.textContent,'This month');
 assert.equal(doc.querySelector('#expense-history-heading')?.textContent,'Expense records · 0');
 assert.doesNotMatch(doc.body.textContent??'',/matching records|Show results|Search and filter/);
 assert.match(doc.body.textContent??'',/No expenses yet/);
 assert.ok(doc.querySelector('.emptyState a[href="/expenses/new"]'));
 assert.ok(!doc.querySelector('select[name="branchId"]'),'Business-wide must not count as a second branch');
 assert.ok(!doc.querySelector('input[type="date"]'));
 assert.ok(doc.querySelector('#history-advanced-filters[hidden]'));
 const input=state.calls[0];assert.match(String(input.dateFrom),/^\d{4}-\d{2}-01$/);assert.ok(input.dateTo);
});
test('filtered empty state checks same authorised scope and does not suggest creation',async()=>{
 state.allTotal=3;const doc=await document({q:'missing',branchId:'one',categoryId:'category',page:'2'});
 assert.match(doc.body.textContent??'',/No matching expenses/);assert.ok(!doc.querySelector('.emptyState a[href="/expenses/new"]'));
 assert.ok(doc.querySelector('.emptyState a')?.textContent?.includes('Clear filters'));
 assert.deepEqual(state.calls[1],{businessId:'business',branches:state.branches,allowedBranchIds:['one'],includeBusinessWide:true,pageSize:1});
});
test('explicit date/query parameters remain identical in read, export and pagination',async()=>{
 state.items=[item];state.total=30;
 const query={from:'2026-09-01',to:'2026-09-30',q:'supplies',categoryId:'category',paymentStatus:'UNPAID',status:'CONFIRMED',sourceType:'MANUAL',branchId:'one',page:'1'};
 const doc=await document(query);assert.equal(state.calls.length,1);assert.equal(state.calls[0].dateFrom,query.from);assert.equal(state.calls[0].dateTo,query.to);
 const exportLink=doc.querySelector('a[href^="/expenses/export?"]')!;const params=new URL(exportLink.getAttribute('href')!,'http://local').searchParams;
 for(const [key,value] of Object.entries(query))assert.equal(params.get(key),value);
 const next=[...doc.querySelectorAll('nav a')].find(a=>a.textContent==='Next')!;const nextParams=new URL(next.getAttribute('href')!,'http://local').searchParams;
 for(const [key,value] of Object.entries(query))assert.equal(nextParams.get(key),key==='page'?'2':value);
 assert.deepEqual([...doc.querySelectorAll('thead th')].map(n=>n.textContent),['Date','Expense','Category','Amount','Payment','Action']);
 const row=doc.querySelector('tbody tr')!;assert.match(row.textContent??'',/Test supplier/);assert.match(row.textContent??'',/Office supplies/);assert.match(row.textContent??'',/12.34/);assert.doesNotMatch(row.textContent??'',/Internal branch|MANUAL/);
 assert.ok(row.querySelector('a[href="/expenses/expense-1"]'));
});
test('multi scope selector remains and create permission is not widened',async()=>{
 state.branches.push({id:'two',name:'Second'});state.canCreate=false;const doc=await document();assert.ok(doc.querySelector('select[name="branchId"]'));assert.ok(!doc.querySelector('a[href="/expenses/new"]'));assert.ok(doc.querySelector('a[href="/expenses"]'));
});
test('all dates survive pagination and open-ended links remain open-ended',async()=>{
 state.items=[item];state.total=30;const doc=await document({from:'',to:''});
 assert.equal(state.calls[0].dateFrom,null);assert.equal(state.calls[0].dateTo,null);
 const next=[...doc.querySelectorAll('nav a')].find(a=>a.textContent==='Next')!;
 const params=new URL(next.getAttribute('href')!,'http://local').searchParams;
 assert.equal(params.get('from'),'');assert.equal(params.get('to'),'');
 await document({from:'2026-01-01',branchId:'unauthorised'});
 assert.equal(state.calls[1].dateTo,null);assert.equal(state.calls[1].branchId,null);
 assert.deepEqual(state.calls[1].allowedBranchIds,['one']);
});
test('month presets retain the existing UTC calendar month semantics',()=>{
 assert.deepEqual(historyDatePeriods(new Date('2024-03-15T12:00:00Z'))['last-month'],{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(historyDatePeriods(new Date('2026-01-01T00:00:00Z'))['last-month'],{from:'2025-12-01',to:'2025-12-31'});
});
test('Custom and Filters disclose controls; collapsed selections keep GET payload',async()=>{
 const dom=new JSDOM('<div id="root"></div>');const old=['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});globals.IS_REACT_ACT_ENVIRONMENT=true;
 const root=createRoot(dom.window.document.getElementById('root')!);
 try { const element=await Page({searchParams:Promise.resolve({})});act(()=>root.render(element));const doc=dom.window.document;
 const period=doc.querySelector<HTMLSelectElement>('select[aria-label="Period"]');assert.ok(period);
 act(()=>{period.value='custom';period.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(doc.querySelectorAll('input[type="date"]').length,2);
 const toggle=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Filters')!;assert.ok(toggle);act(()=>toggle.click());assert.equal(doc.querySelector<HTMLElement>('#history-advanced-filters')?.hidden,false);
 const source=doc.querySelector<HTMLSelectElement>('select[name="sourceType"]')!;source.value='CLAIM';act(()=>toggle.click());
 const payload=new dom.window.FormData(doc.querySelector('form')!);assert.equal(payload.get('sourceType'),'CLAIM');assert.ok(payload.has('from'));assert.ok(!payload.has('range'));assert.ok(!payload.has('page'));
 } finally {act(()=>root.unmount());dom.window.close();for(const[k,v]of old){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}delete globals.IS_REACT_ACT_ENVIRONMENT;}
});
