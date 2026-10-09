import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { compileHandoffPages, handoffFixture } from "../helpers/products-inventory-handoff-fixture";

const fixture=structuredClone(handoffFixture);
let pages: Awaited<ReturnType<typeof compileHandoffPages>>;
const reset=()=>Object.assign(fixture,structuredClone(handoffFixture));
before(async()=>{pages=await compileHandoffPages(fixture)});
after(()=>{delete (globalThis as Record<string,unknown>).__handoffFixture});
const inventory=async(params:Record<string,string>={})=>renderToStaticMarkup(await pages.Inventory({searchParams:Promise.resolve(params)}));
const detail=async()=>renderToStaticMarkup(await pages.Detail({params:Promise.resolve({productId:"p"})}));
const addStock=async()=>renderToStaticMarkup(await pages.AddStock({searchParams:Promise.resolve({})}));

test("Products presents tracked total across stores and keeps untracked products distinct",async()=>{
  reset();fixture.products.push({...structuredClone(fixture.products[0]),id:"off",name:"Untracked",trackInventory:false});
  const html=renderToStaticMarkup(await pages.Products({searchParams:Promise.resolve({})}));
  assert.match(html,/Total stock/);assert.match(html,/Across stores/);assert.match(html,/Stock tracking on/);assert.match(html,/Not tracked/);
});
test("detail Inventory handoff requires enabled module and existing effective view permission",async()=>{
  for(const [enabled,role,permissions,visible] of [[true,"BUSINESS_OWNER",[],true],[false,"BUSINESS_OWNER",[],false],[true,"STAFF",["PRODUCTS"],false],[true,"STAFF",["PRODUCTS","INVENTORY_VIEW"],true]] as const){
    reset();fixture.inventoryEnabled=enabled;fixture.role=role;fixture.effectiveRole=role;fixture.permissions=[...permissions];
    const html=await detail();assert.match(html,/Stock tracking is on/);assert.equal(html.includes('href="/inventory"'),visible);
  }
});
test("untracked detail explains selling without stock deduction; inactive explanation preserves history",async()=>{
  reset();fixture.products[0].trackInventory=false;
  const html=await detail();assert.match(html,/Stock tracking is off/);assert.match(html,/This product can still be sold/);assert.match(html,/Making this product inactive stops new sales\. Its stock and history are kept\./);
  fixture.products[0].status="INACTIVE";
  const inactive=await detail();assert.doesNotMatch(inactive,/This product can still be sold/);assert.match(inactive,/This product is inactive\. Its existing stock history is kept\./);
});
test("Inventory true-empty offers setup only to an authorized direct Products manager",async()=>{
  for(const [role,permissions,source,visible] of [["BUSINESS_OWNER",[],"DIRECT_BUSINESS",true],["STAFF",["INVENTORY_VIEW"],"DIRECT_BUSINESS",false],["STAFF",["PRODUCTS","INVENTORY_VIEW"],"DIRECT_BUSINESS",true],["BUSINESS_OWNER",[],"GROUP_ACCESS",false]] as const){
    reset();fixture.products=[];fixture.role=role;fixture.effectiveRole=role;fixture.permissions=[...permissions];fixture.source=source;
    const html=await inventory();assert.match(html,/No products are being tracked yet\./);assert.equal(html.includes('href="/products"'),visible);
    if(!visible)assert.match(html,/Ask the business owner/);
  }
});
test("search and status empty results provide Clear filters rather than false setup advice",async()=>{
  reset();const html=await inventory({q:"missing"});assert.match(html,/No stock matches your current search or filters\./);assert.match(html,/Clear filters/);assert.doesNotMatch(html,/No products are being tracked yet/);
  fixture.products[0].stocks[0].quantity=10;assert.match(await inventory({status:"out"}),/Clear filters/);
});
test("no authorized store and missing stock rows have context guidance rather than deleted-product advice",async()=>{
  reset();fixture.branches=[];assert.match(await inventory(),/No store stock is available in your current access/);
  reset();fixture.products[0].stocks=[];assert.match(await inventory(),/No stock quantities are set up for these stores yet/);
});
test("inactive tracked balances remain visible without an Add Stock action, while active low stock retains it",async()=>{
  reset();assert.match(await inventory(),/>Add Stock<\/a>/);
  fixture.products[0].status="INACTIVE";const html=await inventory();assert.match(html,/Shampoo/);assert.match(html,/Inactive/);assert.doesNotMatch(html,/href="\/inventory\/stock-in\?productId=/);
});
test("Add Stock explains active tracked eligibility and empty selector has permission-aware setup guidance",async()=>{
  reset();assert.match(await addStock(),/Only active products with Track stock turned on appear here\./);
  fixture.products[0].status="INACTIVE";let html=await addStock();assert.match(html,/No products available to add stock\./);assert.match(html,/>Set up products<\/a>/);assert.doesNotMatch(html,/<option value="p"/);
  fixture.role="STAFF";fixture.effectiveRole="STAFF";fixture.permissions=["INVENTORY_MANAGE"];html=await addStock();assert.doesNotMatch(html,/href="\/products"/);
});
