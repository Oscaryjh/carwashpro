import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement, type Context, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildCashierUi, cashierCustomer, cashierItem, cashierProps } from "../helpers/cashier-ui-fixture";
import { createWalletCheckoutIntent } from "../../src/lib/wallet/checkout-intent";

const require = createRequire(import.meta.url);
let directory: string;
let ui: { CashierUnifiedSaleForm: (props: unknown) => ReactElement; WalletPanelContext: Context<unknown> };
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
async function fixture(overrides: Record<number, unknown> = {}, wallet: "on" | "off" | "error" = "on", props: Record<string, unknown> = {}) {
  if (!ui) { directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/cashier-ui-")); const file = join(directory, "ui.cjs"); await buildCashierUi(file); ui = require(file); }
  // Root hooks: customer=8, cart=9, staff=10, catalog type=6, category=7,
  // search=21, page=23, payment modal=19. No effects/network execute here.
  const state: Record<number, unknown> = { 8: cashierCustomer, 9: [{ ...cashierItem, quantity: 1 }], 10: "staff", ...overrides };
  let index = 0, pickerIndex = 0;
  Object.assign(globalThis, { __cashierHooks: {
    state(initial: unknown) { const current = index++; const value = current in state ? state[current] : typeof initial === "function" ? (initial as () => unknown)() : initial; return [value, (next: unknown) => { state[current] = typeof next === "function" ? (next as (old: unknown) => unknown)(value) : next; }]; },
    picker(initial: unknown) { return [pickerIndex++ === 3 ? state[8] : initial, () => {}]; },
  }, __crmFixture: { actions: new Proxy({}, { get: () => () => { throw Error("Unexpected authenticated I/O"); } }) } });
  const tree = ui.CashierUnifiedSaleForm({ ...cashierProps, walletCheckoutEnabled: wallet !== "off", ...props });
  const shared = { customerId: (state[8] as typeof cashierCustomer | null)?.id, enabled: wallet !== "off", panel: wallet === "error" ? null : { totalBalance: "1100.00", canTopUp: true, ownerDetails: null, intentScope: "scope" }, pending: false, error: wallet === "error" ? "Wallet balance is unavailable. Try again." : "", refresh() {} };
  const html = renderToStaticMarkup(createElement(ui.WalletPanelContext.Provider, { value: shared }, tree));
  return { tree, html, state };
}
function find(tree: ReactElement, type: string, predicate: (props: Record<string, unknown>) => boolean) { const result = nodes(tree).find(node => node.type === type && predicate(node.props)); assert.ok(result); return result.props; }

const entitlementA = "7c2109ff-f47c-58c3-b50c-ae2412249f43";
const entitlementB = "5df473cc-39d5-499d-93a3-5b730748290a";
const balanceA = "c924dd4a-384c-5376-8748-63440aa3a532";
const balanceB = "4d719354-1c84-441d-9c33-b4285bf6ec9b";
function packageOptions(sameDate = false) {
  return [
    { id: balanceA, customerPackageId: entitlementA, purchasedAt: "2026-10-01T00:00:00.000Z" },
    { id: balanceB, customerPackageId: entitlementB, purchasedAt: sameDate ? "2026-10-01T10:00:00.000Z" : "2026-10-07T01:19:32.383Z" },
  ].map(option => ({ ...option, name: "UAT Service Package", serviceId: cashierItem.id, serviceName: cashierItem.name, remainingUses: 2, totalUses: 2 }));
}
function packageButtons(tree: ReactElement) {
  return nodes(tree).filter(node => node.type === "button" && renderToStaticMarkup(node).includes("UAT Service Package"));
}
test("same-name package options expose purchase dates while selecting/submitting the exact balance A or B", async () => {
  for (const [index, balance, date] of [[0, balanceA, "Purchased 1 Oct 2026"], [1, balanceB, "Purchased 7 Oct 2026"]] as const) {
    const view = await fixture({19:true,42:packageOptions()}, "off");
    const buttons = packageButtons(view.tree);
    assert.equal(buttons.length, 2);
    assert.match(renderToStaticMarkup(buttons[index]), new RegExp(date));
    assert.doesNotMatch(renderToStaticMarkup(buttons[index]), /#[A-F0-9]+/);
    (buttons[index].props.onClick as () => void)();
    assert.deepEqual(view.state[43], [balance]);
    const selected = await fixture({19:true,42:packageOptions(),43:view.state[43]}, "off");
    assert.equal(find(selected.tree,"input",p=>p.name==="customerPackageId").value, balance);
  }
});
test("purchase date follows the existing business timezone across UTC midnight", async () => {
  const options = packageOptions().map(option => ({ ...option, purchasedAt: "2026-10-06T17:00:00.000Z" }));
  const view = await fixture({19:true,42:options}, "off");
  for (const button of packageButtons(view.tree)) {
    assert.match(renderToStaticMarkup(button), /Purchased 7 Oct 2026/);
    assert.doesNotMatch(renderToStaticMarkup(button), /Purchased 6 Oct 2026/);
  }
});

test("same date and counts add stable real-entitlement references, not raw UUIDs or balance references", async () => {
  const view = await fixture({19:true,42:packageOptions(true)}, "off");
  const labels = packageButtons(view.tree).map(button => renderToStaticMarkup(button));
  assert.match(labels[0], /Purchased 1 Oct 2026.*#9F43/);
  assert.match(labels[1], /Purchased 1 Oct 2026.*#290A/);
  for (const label of labels) for (const id of [entitlementA, entitlementB, balanceA, balanceB]) assert.ok(!label.includes(id));
});
test("missing or invalid purchase dates retain stable reference fallback without changing option order", async () => {
  const options = packageOptions().map((option,index)=>({...option,purchasedAt:index ? "invalid" : null}));
  const view = await fixture({19:true,42:options}, "off");
  const labels = packageButtons(view.tree).map(button => renderToStaticMarkup(button));
  assert.match(labels[0], /#9F43/); assert.match(labels[1], /#290A/);
  assert.ok(labels.every(label=>!label.includes("Invalid Date")));
});

for (const [quantity,covered,payable,points] of [[1,1,0,0],[2,1,90,1000],[3,1,190,1000],[3,2,90,1000]]) {
  test(`voucher-aware UI preview qty${quantity}/covered${covered} matches server contract`, async()=>{
    const options=[0,1].map(i=>({id:`balance-${i}`,customerPackageId:`package-${i}`,serviceId:cashierItem.id,name:`Voucher ${i}`,serviceName:cashierItem.name,remainingUses:5,totalUses:5}));
    const {tree,html,state}=await fixture({8:{...cashierCustomer,loyaltyPoints:50000},9:[{...cashierItem,price:100,quantity}],33:"1000",42:options,43:options.slice(0,covered).map(x=>x.id)},"off",{loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:1}});
    assert.ok(find(tree,"button",p=>p.children===`Pay RM${payable.toFixed(2)}`));
    assert.equal(find(tree,"input",p=>p.name==="loyaltyPoints").value,points);
    assert.equal(nodes(tree).filter(n=>n.type==="input"&&n.props.name==="customerPackageId").length,covered);
    assert.match(html,new RegExp(`RM${(quantity*100-(points?10:0)).toFixed(2)}`));
    if(quantity===3&&covered===2){
      (find(tree,"button",p=>p["aria-label"]===`Reduce ${cashierItem.name}`).onClick as ()=>void)();
      assert.equal((state[43] as string[]).length,2);
    }
  });
}

test("voucher UI uses server ordering for manual allocation and prunes selection when quantity falls",async()=>{
  const options=[0,1].map(i=>({id:`balance-${i}`,customerPackageId:`package-${i}`,serviceId:cashierItem.id,name:`Voucher ${i}`,serviceName:cashierItem.name,remainingUses:5,totalUses:5}));
  const {tree,state}=await fixture({8:{...cashierCustomer,loyaltyPoints:50000},9:[{...cashierItem,price:100,quantity:2}],33:"1000",30:"20",42:options,43:options.map(x=>x.id)},"off",{loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:1}});
  assert.equal(find(tree,"input",p=>p.name==="loyaltyPoints").value,0);
  (find(tree,"button",p=>p["aria-label"]===`Reduce ${cashierItem.name}`).onClick as ()=>void)();
  assert.deepEqual(state[43],["balance-0"]);
  const mixed=await fixture({8:{...cashierCustomer,loyaltyPoints:50000},9:[
    {...cashierItem,price:100,quantity:1,taxable:true},
    {...cashierItem,id:"product-a",type:"product",price:33.33,quantity:1,taxable:true},
    {...cashierItem,id:"product-b",type:"product",price:33.34,quantity:1,taxable:true},
  ],33:"1000",30:"16.67",42:options,43:["balance-0"]},"off",{
    loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:1},taxSettings:{enabled:true,label:"SST",rate:6},
  });
  assert.ok(find(mixed.tree,"button",p=>p.children==="Pay RM53.01"));
});

test("shifts OFF opens payment without a Start shift modal and submits the confirmation mode", async () => {
  const { tree, html, state } = await fixture({}, "on", { hasOpenShift: false, cashierShiftsEnabled: false, shiftId: null });
  assert.doesNotMatch(html, /Start a cashier shift|>Start shift</);
  const pay = find(tree, "button", p => p.children === "Pay RM300.00");
  (pay.onClick as () => void)();
  assert.equal(state[19], true);
  assert.equal(find(tree, "input", p => p.name === "modeAtConfirmation").value, "OFF");
  assert.equal(find(tree, "input", p => p.name === "shiftId").value, "");
});

test("pending wallet mode change requires explicit reconfirmation, retaining key and full request",async()=>{
 const form=new FormData();for(const [key,value] of [["operationId","checkout:original-key"],["branchId","branch"],["modeAtConfirmation","ON"],["shiftId","old"],["walletAmount","20"],["productId","first"],["productId","second"]])form.append(key,value);
 const intent=createWalletCheckoutIntent(form,"business:actor:branch",[{label:"Original total",value:"40"}]);
 let sent:FormData|undefined;
 const stored=new Map<string,string>();
 Object.assign(globalThis,{sessionStorage:{setItem:(key:string,value:string)=>stored.set(key,value)}});
 const {tree,html}=await fixture({1:intent,39:"CASHIER_SHIFT_MODE_CHANGED: review",47:{modeAtConfirmation:"OFF",branchId:"branch",shiftId:null}},"on",{cashierShiftsEnabled:false,walletCheckoutScope:"business:actor",action:async(data:FormData)=>{sent=data;return {status:"error",message:"Retained test request"};}});
 assert.match(html,/Cashier shifts: OFF/);
 const button=find(tree,"button",props=>props.children==="Confirm settings and retry original checkout");
 await (button.onClick as ()=>Promise<void>)();
 assert.equal(sent?.get("operationId"),"checkout:original-key");assert.deepEqual(sent?.getAll("productId"),["first","second"]);
 assert.equal(sent?.get("modeAtConfirmation"),"OFF");assert.equal(sent?.get("shiftId"),"");
 assert.equal(form.get("shiftId"),"old");
});

test("cashier customer summary has readable identity, inline wallet and a compact Top up action", async () => {
  const { html } = await fixture();
  assert.match(html, /Isaac Liew/); assert.match(html, /0125286913/);
  assert.match(html, /90 pts/); assert.match(html, /2 packages/);
  assert.match(html, /Wallet RM 1,100\.00/); assert.match(html, />Top up<\/button>/);
  assert.doesNotMatch(html, /<h3>Member wallet|Top up wallet/);
});

test("ordinary checkout mode rejection exposes explicit settings review without creating a new checkout",async()=>{
 const {tree,html}=await fixture({39:"CASHIER_SHIFT_MODE_CHANGED: review",47:{modeAtConfirmation:"OFF",branchId:"branch",shiftId:null}},"off");
 assert.match(html,/Cashier shifts: OFF/);
 assert.ok(find(tree,"button",p=>p.children==="Use reviewed cashier settings"));
 assert.ok(find(tree,"button",p=>p.children==="Review current cashier settings"));
});
test("Wallet OFF hides wallet and Top up without hiding customer facts", async () => {
  const { html } = await fixture({}, "off");
  assert.match(html, /90 pts/); assert.match(html, /2 packages/);
  assert.doesNotMatch(html, /Member wallet|Wallet RM|Top up/);
});
test("wallet read errors never substitute a zero balance", async () => {
  const { html } = await fixture({}, "error");
  assert.match(html, /Wallet balance is unavailable/); assert.doesNotMatch(html, /Wallet RM 0\.00|Top up<\/button>/);
});
test("staff field keeps required and assignment, hiding helper after selection", async () => {
  const selected = await fixture();
  const staff = find(selected.tree, "select", props => props.value === "staff");
  assert.equal(staff.required, true);
  assert.doesNotMatch(selected.html, /Required for service reporting/);
  (staff.onChange as (event: unknown) => void)({ target: { value: "" } }); assert.equal(selected.state[10], "");
  const missing = await fixture({ 10: "" });
  assert.match(missing.html, /Required for service reporting/);
  assert.equal(find(missing.tree, "button", props => props.children === "Select service staff to continue").disabled, true);
});
test("Pay CTA retains disabled conditions, total and existing payment opening handler", async () => {
  const ready = await fixture();
  const pay = find(ready.tree, "button", props => props.children === "Pay RM300.00");
  assert.equal(pay.disabled, false); assert.match(ready.html, /Subtotal<\/span><strong>RM300\.00/); assert.match(ready.html, /Total<\/span><strong>RM300\.00/);
  (pay.onClick as () => void)(); assert.equal(ready.state[19], true);
  const missing = await fixture({ 8: null });
  assert.equal(find(missing.tree, "button", props => props.children === "Select customer to continue").disabled, true);
  assert.equal(find((await fixture({ 9: [] })).tree, "button", props => props.children === "Pay RM0.00").disabled, true);
});
test("cart quantity handlers retain totals and stock limits", async () => {
  const cart = await fixture();
  (find(cart.tree, "button", props => props["aria-label"] === "Add 200mins massage").onClick as () => void)();
  assert.equal((cart.state[9] as { quantity: number }[])[0].quantity, 2);
  const two = await fixture({ 9: [{ ...cashierItem, quantity: 2 }] }); assert.match(two.html, /RM600\.00/);
  (find(two.tree, "button", props => props["aria-label"] === "Reduce 200mins massage").onClick as () => void)(); assert.equal((two.state[9] as { quantity: number }[])[0].quantity, 1);
  const stock = await fixture({ 9: [{ ...cashierItem, type: "product", stock: 1, quantity: 1 }] });
  assert.equal(find(stock.tree, "button", props => props["aria-label"] === "Add 200mins massage").disabled, true);
});
test("catalog tab, category, search, pagination and customer selection keep their existing state transitions", async () => {
  const view = await fixture();
  (find(view.tree, "button", props => props.children === "Products").onClick as () => void)(); assert.equal(view.state[6], "product");
  (find(view.tree, "button", props => props.children === "Hair").onClick as () => void)(); assert.equal(view.state[7], "Hair");
  const search = find(view.tree, "input", props => props["aria-label"] === "Search catalog");
  (search.onChange as (event: unknown) => void)({ target: { value: "Haircut" } }); assert.equal(view.state[21], "Haircut");
  (find(view.tree, "button", props => props["aria-label"] === "Next catalog page").onClick as () => void)(); assert.equal(view.state[23], 2);
  const picker = nodes(view.tree).find(node => typeof node.type === "function" && "onSelectionChange" in node.props)!;
  (picker.props.onSelectionChange as (customer: unknown) => void)({ ...cashierCustomer, id: "second", name: "Second customer" });
  assert.equal((view.state[8] as typeof cashierCustomer).name, "Second customer");
  assert.doesNotMatch((await fixture({ 8: { ...cashierCustomer, id: "second", name: "Second customer" } }, "off")).html, /Isaac Liew/);
});
