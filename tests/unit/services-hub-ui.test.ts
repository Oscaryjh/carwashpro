import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const branchId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const state = { query: {} as Record<string, unknown> };
const globals = globalThis as typeof globalThis & { __servicesHub?: typeof state };
let Page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
let Detail: (props: { params: Promise<{serviceId: string}> }) => Promise<ReactElement>;
before(async () => {
  globals.__servicesHub = state;
  const stubs: Record<string, string> = {
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children)",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=()=>{throw Error('REDIRECT')}",
    "@/lib/industry-context": "export const requireBusinessIndustryContext=async()=>({user:{role:'BUSINESS_OWNER'},businessId:'biz',access:{source:'DIRECT_BUSINESS'},industry:{industryType:'SALON_BEAUTY'}})",
    "@/lib/auth/business-user": "export const requireBusinessUserForModule=async()=>({user:{role:'BUSINESS_OWNER'},businessId:'biz',industryType:'SALON_BEAUTY'})",
    "@/lib/branches": `export const getActiveBranches=async()=>[{id:'${branchId}',name:'Main'},{id:'other',name:'Second'}]`,
    "@/lib/prisma": `const row={id:'svc',name:'Haircut',price:35,durationMinutes:30,status:'ACTIVE',branchId:null,branch:null,categoryId:'${categoryId}',serviceCategory:{name:'Hair'},staffAssignments:[],_count:{items:2,packages:1}};export const prisma={service:{findMany:async(q)=>{globalThis.__servicesHub.query=q;return[row]},count:async()=>25,findFirst:async()=>row},serviceCategory:{findMany:async()=>[{id:'${categoryId}',name:'Hair',status:'ACTIVE',_count:{services:1}}]},user:{findMany:async()=>[]},business:{findUnique:async()=>({sstRate:6})}}`,
  };
  const result = await build({ stdin: { contents: 'export{default as Page}from"./src/app/(business)/services/page";export{default as Detail}from"./src/app/(business)/services/[serviceId]/page";', resolveDir: process.cwd() }, write:false,bundle:true,platform:"node",format:"cjs",packages:"external",jsx:"automatic",plugins:[{name:"services-io",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);
    b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/[\\/]services[\\/](categories[\\/])?actions\.ts$/},()=>({contents:"export const createServiceAction=async()=>{};export const updateServiceAction=async()=>{};export const deleteServiceAction=async()=>{};export const createServiceCategoryAction=async()=>{};export const updateServiceCategoryAction=async()=>{};export const deleteServiceCategoryAction=async()=>{};",loader:"ts"}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}]});
  const compiled={exports:{} as {Page:typeof Page;Detail:typeof Detail}};
  new Function("require","module",result.outputFiles[0].text)(require,compiled);
  ({Page,Detail}=compiled.exports);
});
after(()=>{delete globals.__servicesHub});

test("Categories is grouped under Settings while New Service stays directly accessible",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve({})})));
  try {
    const doc=dom.window.document;
    assert.equal(doc.querySelector('details summary')?.textContent?.trim(),"Settings ▾");
    assert.equal(doc.querySelector('details a')?.getAttribute('href'),'/services?modal=categories');
    assert.ok(doc.querySelector('a[href="/services?modal=create"]'));
    assert.equal(doc.querySelectorAll('details a').length,1);
  } finally {dom.window.close()}
});

test("filters retain branch semantics and real 10-row page-number pagination",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve({q:"Hair",categoryId,status:"ACTIVE",branchId,page:"2"})})));
  try {
    assert.equal(state.query.take,10); assert.equal(state.query.skip,10);
    assert.deepEqual((state.query.where as {AND:unknown[]}).AND.slice(1),[{categoryId},{status:"ACTIVE"},{branchId}]);
    const doc=dom.window.document;
    assert.match(doc.body.textContent!,/11-20 of 25/); assert.match(doc.body.textContent!,/Page 2 of 3/);
    const next=[...doc.querySelectorAll('a')].find(a=>a.textContent==='Next')!;
    const url=new URL(next.href,'http://localhost');
    assert.equal(url.searchParams.get('page'),'3'); assert.equal(url.searchParams.get('branchId'),branchId);
    assert.equal(url.searchParams.get('categoryId'),categoryId);assert.equal(url.searchParams.get('q'),'Hair');
    for(const label of ['Category','Status','Branch'])assert.ok(doc.querySelector(`select[aria-label="${label}"]`));
  } finally {dom.window.close()}
  await Page({searchParams:Promise.resolve({branchId:'all-branches-only'})});
  assert.deepEqual((state.query.where as {AND:unknown[]}).AND,[{branchId:null}]);
});

test("detail has a deterministic Back to Services link and keeps edit/tax/duration fields",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Detail({params:Promise.resolve({serviceId:'svc'})})));
  try {
    const doc=dom.window.document;
    assert.equal(doc.querySelector('a[href="/services"]')?.textContent,'Back to Services');
    for(const name of ['serviceId','categoryId','price','taxRate','durationMinutes','status']) assert.ok(doc.querySelector(`[name="${name}"]`),name);
    assert.match(doc.body.textContent!,/Package usage/);
  } finally {dom.window.close()}
});
