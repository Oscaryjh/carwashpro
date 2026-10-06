import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const date = new Date("2026-10-06T04:00:00Z");
const customer = { name: "Demo Customer", phone: "" };
const payment = (method: string, amount: number, refunded = 0) => ({ id: method, method, amount, status: "ACTIVE", paidAt: date, businessPaymentMethod: null, paymentMethodLabel: null, refunds: refunded ? [{ id: "refund", amount: refunded, refundedAt: date, reason: "Test refund", processedBy: { name: "Owner" } }] : [] });
function fixture() {
  return {
    id: "invoice", businessId: "biz", invoiceNumber: "INV-1028", issuedAt: date, status: "PARTIAL",
    business: { name: "Demo Salon", companyNo: null, sstRegistrationNo: null, phone: null, address: null },
    customer, appointmentId: "appointment", appointment: { id: "appointment", scheduledAt: date, customer, assignedStaff: { name: "Demo Staff" } as { name: string } | null },
    workOrder: null, customerPackage: null, creditNotes: [],
    items: [{ id: "item", name: "Balayage Highlights", unitPrice: 250, quantity: 2, lineTotal: 500, inventoryTracked: false, productId: null, inventoryRefundLines: [], customerPackage: null }],
    subtotal: 500, discountAmount: 0, loyaltyDiscountAmount: 0, loyaltyPointsRedeemed: 0, taxAmount: 0, taxRate: 0, taxLabel: null, tipAmount: 0, depositAmount: 0,
    total: 500, paidAmount: 200, balance: 300, payments: [payment("CASH", 200)],
  };
}
const state = { invoice: fixture() as Record<string, unknown> | null, denied: false, calls: [] as string[], query: {} as Record<string, unknown>, outbound: 0 };
const globals = globalThis as typeof globalThis & { __invoiceDetailUI?: typeof state };
let page: (props: { params: Promise<{ invoiceId: string }> }) => Promise<ReactElement>;
before(async () => {
  globals.__invoiceDetailUI = state;
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma={invoice:{findFirst:async(query)=>{const s=globalThis.__invoiceDetailUI;s.query=query;return s.invoice}}};",
    "@/lib/industry-context": "export async function requireBusinessIndustryContext(cap){const s=globalThis.__invoiceDetailUI;s.calls.push(cap);if(s.denied)throw Error('DENIED');return {businessId:'biz',user:{branchId:'branch'},access:{effectiveBusinessRole:'STAFF'},industry:{industryType:'SALON_BEAUTY',orderLabel:'Appointment'}}}",
    "@/lib/branches": "export const authorizedOperationalBranchWhere=()=>({branchId:'branch'});",
    "next/navigation": "export const useRouter=()=>({back(){}});export function notFound(){throw Error('NOT_FOUND')}",
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children);",
    "@/app/(business)/whatsapp/actions": "export async function openWhatsAppDeepLinkAction(){globalThis.__invoiceDetailUI.outbound++;throw Error('OUTBOUND_FORBIDDEN')}",
    "@/components/invoice-refund-payment-form": "export const InvoiceRefundPaymentForm=()=>null;",
    "@/components/void-invoice-form": "export const VoidInvoiceForm=()=>null;",
    "@/components/wallet/wallet-refund-form": "export const WalletRefundForm=()=>null;",
  };
  const result = await build({ stdin: { contents: 'export {default} from "./src/app/(business)/invoices/[invoiceId]/page";', resolveDir: process.cwd() }, bundle: true, platform: "node", packages: "external", format: "cjs", write: false, jsx: "automatic", plugins: [{ name: "invoice-ui-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  const bundled = { exports: {} }; new Function("require", "module", "exports", result.outputFiles[0].text)(require, bundled, bundled.exports);
  page = (bundled.exports as { default: typeof page }).default;
});
beforeEach(() => { Object.assign(state, { invoice: fixture(), denied: false, calls: [], query: {}, outbound: 0 }); });
after(() => { delete globals.__invoiceDetailUI; });
const render = async () => renderToStaticMarkup(await page({ params: Promise.resolve({ invoiceId: "invoice" }) }));

test("invoice header identifies the invoice and keeps its existing status beside the heading", async () => {
  const html = await render();
  assert.match(html, /<h1[^>]*>Invoice #INV-1028<\/h1>/);
  assert.match(html, /<h1[^>]*>Invoice #INV-1028<\/h1>[\s\S]*?payment-state partial[\s\S]*?Partial[\s\S]*?Back to Invoices/);
  assert.equal((html.match(/payment-state partial/g) ?? []).length, 1);
});
test("back, WhatsApp and print actions retain their routes and only use the approved wording", async () => {
  const html = await render();
  assert.match(html, />Back to Invoices<\/button>/);
  assert.match(html, />Send via WhatsApp<\/button>/);
  assert.doesNotMatch(html, /Send Invoice WhatsApp/);
  assert.match(html, /href="\/invoices\/invoice\/pdf\?format=receipt" target="_blank">Print/);
  assert.match(html, /href="\/invoices\/invoice\/pdf">Download PDF/);
  assert.equal(state.outbound, 0);
});
test("service unit price is explicit while quantity, subtotal, Paid and Balance Due remain unchanged", async () => {
  const html = await render();
  assert.match(html, /Balayage Highlights<\/strong><small>RM250\.00 each<\/small>/);
  assert.match(html, /<span>2<\/span><strong>RM500\.00<\/strong>/);
  for (const [label, value] of [["Subtotal", "500.00"], ["Total", "500.00"], ["Paid", "200.00"], ["Balance Due", "300.00"]]) assert.ok(html.includes(`<span>${label}</span><strong>RM${value}</strong>`));
  assert.doesNotMatch(html, />Settled<|>Outstanding</);
});
test("linked appointment shows actual date/time/staff and its unchanged destination, without technical copy", async () => {
  const html = await render();
  assert.match(html, /<h2>Linked Appointment<\/h2>/);
  assert.ok(html.includes(date.toLocaleDateString("en-MY")));
  assert.ok(html.includes(date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })));
  assert.match(html, /href="\/appointments\/appointment">View appointment →<\/a>/);
  assert.doesNotMatch(html, /Payment does not change the service status/);
});
test("missing phone/staff displays an em dash without changing the customer source", async () => {
  const inv = fixture(); inv.appointment.assignedStaff = null;
  state.invoice = inv;
  const html = await render();
  assert.match(html, /<span>Phone<\/span><strong>—<\/strong>/);
  assert.match(html, /<span>Staff<\/span><strong>—<\/strong>/);
  assert.match(html, /<span>Customer<\/span><strong>Demo Customer<\/strong>/);
});
test("refund settlement values use the same totals for Cash, Wallet and fully refunded payments", async () => {
  for (const [method, amount, refund, remaining, status] of [["CASH", 200, 50, "150.00", "Partially refunded"], ["MEMBER_WALLET", 200, 50, "150.00", "Partially refunded"], ["CASH", 200, 200, "0.00", "Fully refunded"]] as const) {
    state.invoice = { ...fixture(), payments: [payment(method, amount, refund)] };
    const html = await render();
    assert.ok(html.includes("<span>Paid</span><strong>RM200.00</strong>"));
    assert.ok(html.includes(`<span>Refunded</span><strong>RM${refund.toFixed(2)}</strong>`));
    assert.ok(html.includes(`<span>Net collected</span><strong>RM${remaining}</strong>`));
    assert.ok(html.includes(status));
    assert.ok(html.includes("<span>Balance Due</span><strong>RM300.00</strong>"));
  }
});
test("direct sale and package purchase keep their existing payment and notification contract", async () => {
  for (const customerPackage of [null, { package: { name: "Demo Package" } }]) {
    state.invoice = { ...fixture(), appointment: null, appointmentId: null, customerPackage, status: "PAID", paidAmount: 500, balance: 0 };
    const html = await render();
    assert.match(html, /<h1[^>]*>Invoice #INV-1028<\/h1>/);
    assert.ok(html.includes("<span>Paid</span><strong>RM500.00</strong>"));
    assert.ok(html.includes("<span>Balance Due</span><strong>RM0.00</strong>"));
    assert.match(html, /WhatsApp invoice notification was queued after purchase/);
    assert.doesNotMatch(html, />Send via WhatsApp<|Linked Appointment/);
  }
});
test("existing invoice permission and business/operational branch restrictions remain authoritative", async () => {
  await render();
  assert.deepEqual(state.calls, ["VIEW_INVOICES"]);
  assert.deepEqual(state.query.where, { id: "invoice", businessId: "biz", branchId: "branch" });
  state.invoice = null; await assert.rejects(render, /NOT_FOUND/);
  state.denied = true; await assert.rejects(render, /DENIED/);
});

test("work-order package plus Cash keeps paid, balance and external collection amounts", async () => {
  const inv = fixture();
  state.invoice = { ...inv, appointment: null, appointmentId: null, status: "PAID", paidAmount: 500, balance: 0, workOrder: {
    id: "work", status: "COMPLETED", customer, vehicle: { plateNumber: "TEST", brand: null, model: null, color: null },
    items: inv.items, payments: [payment("PACKAGE", 300), payment("CASH", 200)],
  } };
  const html = await render();
  assert.match(html, /Invoice #INV-1028/);
  assert.match(html, /RM250\.00 each/);
  for (const [label, amount] of [["Paid", "500.00"], ["Balance Due", "0.00"], ["Package voucher", "-RM300.00"], ["Money collected", "200.00"]]) {
    assert.ok(html.includes(`<span>${label}</span><strong>${amount.startsWith("-") ? amount : `RM${amount}`}</strong>`));
  }
  assert.match(html, />Send via WhatsApp<\/button>/);
});

test("VOID remains the original status and does not expose a refund mutation form", async () => {
  state.invoice = { ...fixture(), status: "VOID", paidAmount: 0, balance: 500, payments: [] };
  const html = await render();
  assert.match(html, /payment-state void">Void/);
  assert.ok(html.includes("<span>Paid</span><strong>RM0.00</strong>"));
  assert.ok(html.includes("<span>Balance Due</span><strong>RM500.00</strong>"));
  assert.doesNotMatch(html, /Refund payment/);
});
