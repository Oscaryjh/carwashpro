import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactElement } from "react";

export const handoffFixture = {
  writes: [] as Array<{ action: string; fields: Array<[string, FormDataEntryValue]> }>,
  movements: [{ id: "movement", branchId: "a", createdAt: new Date("2026-10-10T00:00:00Z"), type: "STOCK_IN", quantityBefore: 0, quantityAfter: 10, quantityDelta: 10, reason: "Stock added", reference: null, sourceType: "MANUAL", sourceId: "operation", actor: { name: "Owner" }, branch: { name: "Main Store" }, product: { name: "Shampoo", sku: "P001" } }],
  inventoryEnabled: true, posEnabled: true, permissions: ["PRODUCTS", "INVENTORY_VIEW", "INVENTORY_MANAGE"],
  role: "BUSINESS_OWNER", source: "DIRECT_BUSINESS", effectiveRole: "BUSINESS_OWNER", branchId: "a",
  branches: [{ id: "a", name: "Main Store" }, { id: "b", name: "Second Store" }],
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
    "@/lib/auth/business-user": `const context=()=>{const f=globalThis.__handoffFixture;return{businessId:'biz',user:{userId:'actor',role:f.role,permissions:f.permissions,branchId:f.branchId},access:{granted:true,businessId:'biz',source:f.source,identityRole:f.role,actorRole:f.role,effectiveBusinessRole:f.effectiveRole,permissions:f.permissions,branchId:f.branchId},moduleContext:{enabledModules:new Set([...(f.posEnabled?['POS']:[]),...(f.inventoryEnabled?['INVENTORY']:[])])}}};export const requireBusinessUser=async()=>context();export const requireBusinessUserForModule=async()=>context();`,
    "@/lib/branches": "export const getActiveBranches=async()=>globalThis.__handoffFixture.branches;export const getOperationalBranches=getActiveBranches;",
    "server-only": "export {};",
    "@/lib/prisma": `const f=()=>globalThis.__handoffFixture;const biz={id:'biz',status:'active',industryType:'SALON_BEAUTY',sstRate:6};const stocks=(p,q)=>{const id=q.include?.stocks?.where?.branchId??q.select?.stocks?.where?.branchId;return id?p.stocks.filter(s=>typeof id==='string'?s.branchId===id:id.in.includes(s.branchId)):p.stocks};const matching=q=>f().products.filter(p=>(!q.where.trackInventory||p.trackInventory)&&(!q.where.status||p.status===q.where.status)&&(!q.where.OR||p.name.toLowerCase().includes(q.where.OR[0].name.contains.toLowerCase())));export const prisma={user:{findUnique:async()=>({id:'actor',businessId:'biz',role:f().role,permissions:f().permissions,branchId:f().branchId,status:'active',loginEnabled:true,business:biz,branch:f().branches.some(b=>b.id===f().branchId)?{id:f().branchId,businessId:'biz',status:'ACTIVE'}:null})},branch:{findMany:async()=>f().branches},businessModuleEntitlement:{findMany:async()=>[...(f().posEnabled?['POS']:[]),...(f().inventoryEnabled?['INVENTORY']:[])].map(moduleKey=>({moduleKey,status:'ENABLED',enabledFrom:new Date(0),enabledUntil:null}))},product:{findMany:async(q)=>matching(q).map(p=>({...p,stocks:stocks(p,q)})),count:async(q)=>matching(q).length,findFirst:async(q)=>f().products[0]?({...f().products[0],stocks:stocks(f().products[0],q)}):null},productCategory:{findMany:async()=>[{id:'cat',name:'Hair care',status:'ACTIVE',_count:{products:1}}]},business:{findUnique:async()=>biz}};`,
  };
  stubs["@/lib/prisma"] += `const movements=q=>f().movements.filter(row=>q.where.branchId.in.includes(row.branchId));prisma.inventoryMovement={findMany:async q=>movements(q),count:async q=>movements(q).length};`;
  const result=await build({stdin:{contents:'export{default as Products}from"./src/app/(business)/products/page";export{default as Detail}from"./src/app/(business)/products/[productId]/page";export{default as Inventory}from"./src/app/(business)/inventory/page";export{default as AddStock}from"./src/app/(business)/inventory/stock-in/page";export{default as Remove}from"./src/app/(business)/inventory/stock-out/page";export{default as Count}from"./src/app/(business)/inventory/adjustment/page";export{default as History}from"./src/app/(business)/inventory/movements/page";',resolveDir:process.cwd()},write:false,bundle:true,platform:"node",format:"cjs",packages:"external",jsx:"automatic",plugins:[{name:"handoff-io",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"stub"}:undefined);
    b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/[\\/](?:products|inventory)[\\/](?:categories[\\/])?actions\.ts$/},()=>({contents:"const record=(action,data)=>globalThis.__handoffFixture.writes.push({action,fields:[...data]});export const createProductAction=async d=>{record('create',d)};export const updateProductAction=async d=>{record('update',d)};export const deactivateProductAction=async()=>{};export const deleteProductAction=async()=>{};export const createProductCategoryAction=async()=>{};export const updateProductCategoryAction=async()=>{};export const deleteProductCategoryAction=async()=>{};export const stockInAction=async d=>{record('stockIn',d)};export const stockOutAction=async d=>{record('stockOut',d)};export const adjustInventoryAction=async d=>{record('adjust',d)};",loader:"ts"}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}]});
  const compiled={exports:{} as {Products:Page;Inventory:Page;AddStock:Page;Remove:Page;Count:Page;History:Page;Detail:(props:{params:Promise<{productId:string}>})=>Promise<ReactElement>}};
  new Function("require","module",result.outputFiles[0].text)(createRequire(import.meta.url),compiled);
  return compiled.exports;
}
