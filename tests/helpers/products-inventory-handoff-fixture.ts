import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactElement } from "react";

export const handoffFixture = {
  inventoryEnabled: true, posEnabled: true, permissions: ["PRODUCTS", "INVENTORY_VIEW", "INVENTORY_MANAGE"],
  role: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", effectiveRole: "BUSINESS_OWNER", branchId: "a",
  branches: [{ id: "a", name: "Main Store" }],
  products: [{ id: "p", businessId: "biz", name: "Shampoo", sku: "P001", description: "", price: 10, costPrice: null, taxRate: null, taxable: false, status: "ACTIVE", trackInventory: true, categoryId: "cat", productCategory: { name: "Hair care" }, _count: { invoiceItems: 0 }, stocks: [{ id: "s", branchId: "a", quantity: 0, reorderLevel: 2, revision: 0, branch: { name: "Main Store" } }] }],
};
export type HandoffFixture = typeof handoffFixture;
type Page = (props: { searchParams: Promise<Record<string,string>> }) => Promise<ReactElement>;
export async function compileHandoffPages(fixture: HandoffFixture) {
  const runtime = globalThis as typeof globalThis & { __handoffFixture?: HandoffFixture };
  runtime.__handoffFixture = fixture;
  const stubs: Record<string,string> = {
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children)",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=(url)=>{throw Error(url)}",
    "@/lib/auth/business-user": `const context=()=>{const f=globalThis.__handoffFixture;return{businessId:'biz',user:{role:f.role,permissions:f.permissions,branchId:f.branchId},access:{granted:true,businessId:'biz',source:f.source,identityRole:f.role,actorRole:f.role,effectiveBusinessRole:f.effectiveRole,permissions:f.permissions,branchId:f.branchId},moduleContext:{enabledModules:new Set([...(f.posEnabled?['POS']:[]),...(f.inventoryEnabled?['INVENTORY']:[])])}}};export const requireBusinessUser=async()=>context();export const requireBusinessUserForModule=async()=>context();`,
    "@/lib/branches": "export const getActiveBranches=async()=>globalThis.__handoffFixture.branches;export const getOperationalBranches=getActiveBranches;",
    "@/lib/inventory/authorization": "export const resolveInventoryReadScope=async()=>({kind:'branches'});export const getInventoryReadBranches=async()=>globalThis.__handoffFixture.branches;",
    "@/lib/prisma": `const matching=q=>globalThis.__handoffFixture.products.filter(p=>(!q.where.trackInventory||p.trackInventory)&&(!q.where.status||p.status===q.where.status)&&(!q.where.OR||p.name.toLowerCase().includes(q.where.OR[0].name.contains.toLowerCase())));export const prisma={product:{findMany:async(q)=>matching(q).map(p=>({...p,stocks:q.include?.stocks?.where?p.stocks.filter(s=>q.include.stocks.where.branchId.in.includes(s.branchId)):p.stocks})),count:async(q)=>matching(q).length,findFirst:async()=>globalThis.__handoffFixture.products[0]},productCategory:{findMany:async()=>[{id:'cat',name:'Hair care',status:'ACTIVE',_count:{products:1}}]},business:{findUnique:async()=>({sstRate:6})}};`,
  };
  const result=await build({stdin:{contents:'export{default as Products}from"./src/app/(business)/products/page";export{default as Detail}from"./src/app/(business)/products/[productId]/page";export{default as Inventory}from"./src/app/(business)/inventory/page";export{default as AddStock}from"./src/app/(business)/inventory/stock-in/page";',resolveDir:process.cwd()},write:false,bundle:true,platform:"node",format:"cjs",packages:"external",jsx:"automatic",plugins:[{name:"handoff-io",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);
    b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/[\\/](?:products|inventory)[\\/](?:categories[\\/])?actions\.ts$/},()=>({contents:"export const createProductAction=async()=>{};export const updateProductAction=async()=>{};export const deactivateProductAction=async()=>{};export const deleteProductAction=async()=>{};export const createProductCategoryAction=async()=>{};export const updateProductCategoryAction=async()=>{};export const deleteProductCategoryAction=async()=>{};export const stockInAction=async()=>{};",loader:"ts"}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}]});
  const compiled={exports:{} as {Products:Page;Inventory:Page;AddStock:Page;Detail:(props:{params:Promise<{productId:string}>})=>Promise<ReactElement>}};
  new Function("require","module",result.outputFiles[0].text)(createRequire(import.meta.url),compiled);
  return compiled.exports;
}
