import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const categoryId = "33333333-3333-4333-8333-333333333333";
const state = { query: {} as Record<string, unknown>, navigationFixture: false };
const globals = globalThis as typeof globalThis & { __productsHub?: typeof state };
let Page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
let Detail: (props: { params: Promise<{productId: string}> }) => Promise<ReactElement>;
let NewPage: () => void;
let CategoriesPage: () => void;
before(async () => {
  globals.__productsHub = state;
  const stubs: Record<string, string> = {
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children)",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=(url)=>{throw Error(url)}",
    "@/lib/auth/business-user": "const ctx={user:{role:'BUSINESS_OWNER'},businessId:'biz',access:{source:'DIRECT_BUSINESS'},moduleContext:{enabledModules:new Set(['POS','INVENTORY'])}};export const requireBusinessUser=async()=>ctx;export const requireBusinessUserForModule=async()=>ctx",
    "@/lib/branches": "export const getActiveBranches=async()=>[{id:'a',name:'Main'},{id:'b',name:'Second'}]",
    "@/lib/prisma": `const row={id:'prod',name:'Shampoo',sku:'SKU-001',price:35,costPrice:12,taxable:true,taxRate:6,status:'ACTIVE',description:'Retail bottle',trackInventory:true,categoryId:'${categoryId}',productCategory:{name:'Hair care'},stocks:[{branchId:'a',quantity:3,reorderLevel:1,branch:{name:'Main'}},{branchId:'b',quantity:4,reorderLevel:2,branch:{name:'Second'}}],_count:{invoiceItems:1}};export const prisma={product:{findMany:async(q)=>{globalThis.__productsHub.query=q;return[row]},count:async()=>25,findFirst:async()=>row},productCategory:{findMany:async()=>[{id:'${categoryId}',name:'Hair care',status:'ACTIVE',_count:{products:1}}]},business:{findUnique:async()=>({sstRate:6})}}`,
  };
  stubs["@/lib/prisma"] += `
    const originalFindMany=prisma.product.findMany;
    const rows=[row,{...row,id:'inactive',name:'Archived conditioner',status:'INACTIVE',categoryId:'other'}];
    const matching=(where)=>rows.filter(p=>(!where.status||p.status===where.status)&&(!where.categoryId||p.categoryId===where.categoryId)&&(!where.OR||p.name.toLowerCase().includes(where.OR[0].name.contains.toLowerCase())));
    prisma.product.findMany=async(q)=>globalThis.__productsHub.navigationFixture?matching(q.where).slice(q.skip,q.skip+q.take):originalFindMany(q);
    prisma.product.count=async(q)=>globalThis.__productsHub.navigationFixture?matching(q.where).length:25;
  `;
  const result = await build({stdin:{contents:'export{default as Page}from"./src/app/(business)/products/page";export{default as Detail}from"./src/app/(business)/products/[productId]/page";export{default as NewPage}from"./src/app/(business)/products/new/page";export{default as CategoriesPage}from"./src/app/(business)/products/categories/page";',resolveDir:process.cwd()},write:false,bundle:true,platform:"node",format:"cjs",packages:"external",jsx:"automatic",plugins:[{name:"products-io",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);
    b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/[\\/]products[\\/](categories[\\/])?actions\.ts$/},()=>({contents:"export const createProductAction=async()=>{};export const updateProductAction=async()=>{};export const deactivateProductAction=async()=>{};export const deleteProductAction=async()=>{};export const createProductCategoryAction=async()=>{};export const updateProductCategoryAction=async()=>{};export const deleteProductCategoryAction=async()=>{};",loader:"ts"}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}]});
  const compiled={exports:{} as {Page:typeof Page;Detail:typeof Detail;NewPage:typeof NewPage;CategoriesPage:typeof CategoriesPage}};
  new Function("require","module",result.outputFiles[0].text)(require,compiled);
  ({Page,Detail,NewPage,CategoriesPage}=compiled.exports);
});
after(()=>{delete globals.__productsHub});

test("Clear client navigation resets Status, Category and edited Search with the restored list, without a reload",async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/products'});
  const saved=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const doc=dom.window.document as Document;
  const root=createRoot(doc.getElementById('root')!);
  state.navigationFixture=true;
  const navigate=async(href:string)=>{
    dom.window.history.pushState(null,'',href);
    const params=Object.fromEntries(new URL(dom.window.location.href).searchParams);
    const page=await Page({searchParams:Promise.resolve(params)});
    await act(async()=>{root.render(page)});
  };
  let navigation=Promise.resolve();
  const followLink=(event:Event)=>{
    const anchor=(event.target as Element).closest('a');
    if(anchor){event.preventDefault();navigation=navigate(anchor.getAttribute('href')!)}
  };
  doc.addEventListener('click',followLink);
  try{
    const cases: Record<string,string>[]=[{status:'INACTIVE'},{categoryId},{q:'Archived'},{status:'INACTIVE',q:'Archived'}];
    for(const params of cases){
      await navigate(`/products?${new URLSearchParams(params)}`);
      assert.equal(doc.querySelectorAll('tbody tr').length,1);
      const search=doc.querySelector<HTMLInputElement>('input[name="q"]')!;
      search.value='unsaved search';
      const clear=[...doc.querySelectorAll('a')].find(a=>a.textContent==='Clear')!;
      assert.ok(clear);
      clear.click();
      await navigation;
      assert.equal(dom.window.location.pathname,'/products');
      assert.equal(dom.window.location.search,'');
      assert.equal(doc.querySelectorAll('tbody tr').length,2);
      assert.match(doc.querySelector('tbody')!.textContent!,/Shampoo/);
      assert.match(doc.querySelector('tbody')!.textContent!,/Archived conditioner/);
      assert.equal(doc.querySelector<HTMLSelectElement>('[name="status"]')!.value,'');
      assert.equal(doc.querySelector<HTMLSelectElement>('[name="categoryId"]')!.value,'');
      assert.equal(doc.querySelector<HTMLInputElement>('[name="q"]')!.value,'');
      assert.equal(dom.window.document,doc,'the same document is retained');
    }
    await navigate('/products?status=INACTIVE');
    assert.equal(doc.querySelector<HTMLSelectElement>('[name="status"]')!.value,'INACTIVE');
    assert.equal(doc.querySelectorAll('tbody tr').length,1);
  }finally{
    await act(async()=>root.unmount());
    state.navigationFixture=false;
    doc.removeEventListener('click',followLink);
    dom.window.close();
    for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}
  }
});

test("Products Settings contains only Categories, with New Product directly accessible",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve({})})));
  try {const doc=dom.window.document;
    assert.equal(doc.querySelector('details summary')?.textContent?.trim(),"Settings ▾");
    assert.equal(doc.querySelector('details a')?.getAttribute('href'),'/products?modal=categories');
    assert.equal(doc.querySelectorAll('details a').length,1);
    assert.ok(doc.querySelector('a[href="/products?modal=create"]'));
    assert.match(doc.querySelector('table')!.textContent!,/Hair care/);
    assert.equal(doc.querySelectorAll('select[name="branchId"]').length,0);
    assert.equal(doc.querySelector('tbody tr')?.children[4]?.textContent,'7');
  }finally{dom.window.close()}
});
test("Products keeps business-wide filters, exact total and ten-row numbered pages",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Page({searchParams:Promise.resolve({q:' Shampoo ',categoryId,status:'ACTIVE',page:'2'})})));
  try {assert.equal(state.query.take,10);assert.equal(state.query.skip,10);
    assert.deepEqual(state.query.where,{businessId:'biz',status:'ACTIVE',categoryId,OR:[{name:{contains:'Shampoo',mode:'insensitive'}},{sku:{contains:'Shampoo',mode:'insensitive'}},{category:{contains:'Shampoo',mode:'insensitive'}}]});
    const doc=dom.window.document;assert.match(doc.body.textContent!,/11-20 of 25/);assert.match(doc.body.textContent!,/Page 2 of 3/);
    const next=[...doc.querySelectorAll('a')].find(a=>a.textContent==='Next')!;const url=new URL(next.href,'http://localhost');
    assert.equal(url.searchParams.get('page'),'3');assert.equal(url.searchParams.get('q'),'Shampoo');assert.equal(url.searchParams.get('categoryId'),categoryId);assert.equal(url.searchParams.get('status'),'ACTIVE');
  }finally{dom.window.close()}
});
test("both modal=create and Cashier legacy type=create render the existing ProductForm",async()=>{
  const queries: Record<string,string>[] = [{modal:'create'},{type:'create'}];
  for(const query of queries){
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}));
    assert.match(html,/New product/);for(const field of ['name','price','categoryId','costPrice','taxable','taxRate','trackInventory'])assert.match(html,new RegExp(`name="${field}"`));
  }
});
test("category modal and legacy redirect routes remain compatible",async()=>{
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({modal:'categories'})}));
  assert.match(html,/Product categories/);assert.throws(()=>NewPage(),/\/products\?modal=create/);assert.throws(()=>CategoriesPage(),/\/products\?modal=categories/);
});
test("detail returns to Products and preserves tracked stock read-only editing",async()=>{
  const dom=new JSDOM(renderToStaticMarkup(await Detail({params:Promise.resolve({productId:'prod'})})));
  try {const doc=dom.window.document;assert.equal(doc.querySelector('a[href="/products"]')?.textContent,'Back to Products');
    for(const name of ['productId','name','categoryId','price','costPrice','description','taxable','taxRate','status','trackInventory'])assert.ok(doc.querySelector(`[name="${name}"]`),name);
    assert.ok(doc.querySelector('input[name="stock_a"][readonly]'));assert.ok(doc.querySelector('input[name="stock_b"][readonly]'));
    assert.equal(doc.querySelector('[aria-label="System-generated SKU"]')?.getAttribute('value'),'SKU-001');
  }finally{dom.window.close()}
});
