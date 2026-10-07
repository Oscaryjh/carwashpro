import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { AppointmentInvoiceModal } from "../../src/components/appointment-invoice-modal";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const date = new Date("2026-10-06T04:00:00Z");
const customer = { name: "Demo Customer", phone: "" };
const payment = (method: string, amount: number, refunded = 0) => ({ id: method, method, amount, status: "ACTIVE", paidAt: date, businessPaymentMethod: null, paymentMethodLabel: null, refunds: refunded ? [{ id: "refund", amount: refunded, refundedAt: date, reason: "Test refund", processedBy: { name: "Owner" } }] : [] });
function fixture() {
  return {
    id: "invoice", businessId: "biz", invoiceNumber: "INV-1028", issuedAt: date, status: "PARTIAL",
    business: { name: "Demo Salon", timezone: "Asia/Kuching", companyNo: null, sstRegistrationNo: null, phone: null, address: null },
    customer, appointmentId: "appointment", appointment: { id: "appointment", scheduledAt: date, customer, assignedStaff: { name: "Demo Staff" } as { name: string } | null },
    workOrder: null, customerPackage: null, creditNotes: [],
    items: [{ id: "item", name: "Balayage Highlights", unitPrice: 250, quantity: 2, lineTotal: 500, inventoryTracked: false, productId: null, inventoryRefundLines: [], customerPackage: null }],
    subtotal: 500, discountAmount: 0, loyaltyDiscountAmount: 0, loyaltyPointsRedeemed: 0, taxAmount: 0, taxRate: 0, taxLabel: null, tipAmount: 0, depositAmount: 0,
    total: 500, paidAmount: 200, balance: 300, payments: [payment("CASH", 200)],
  };
}
const state = { invoice: fixture() as Record<string, unknown> | null, denied: false, calls: [] as string[], query: {} as Record<string, unknown>, outbound: 0, notificationReferences: [] as string[] };
const globals = globalThis as typeof globalThis & { __invoiceDetailUI?: typeof state };
let page: (props: { params: Promise<{ invoiceId: string }> }) => Promise<ReactElement>;
let listPage: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
let pdfRoute: (request: Request, props: { params: Promise<{ invoiceId: string }> }) => Promise<Response>;
let modal: typeof AppointmentInvoiceModal;
let notification: (input: { businessId: string; invoiceId: string; sentByUserId: string }) => Promise<void>;
before(async () => {
  globals.__invoiceDetailUI = state;
  const stubs: Record<string, string> = {
    "@/lib/prisma": "export const prisma={whatsAppMessage:{create:async()=>({id:'mock-log'})},whatsAppConversation:{upsert:async()=>({})},invoice:{findMany:async()=>[globalThis.__invoiceDetailUI.invoice],count:async()=>1,findFirst:async(query)=>{const s=globalThis.__invoiceDetailUI;s.query=query;return s.invoice}}};",
    "@/lib/modules/entitlements": "export const isBusinessModuleEnabled=async()=>true;",
    "@/lib/whatsapp/instance": "export const getDefaultWhatsAppInstanceId=()=> 'mock-instance';",
    "@/lib/whatsapp/notification-queue": "export const enqueueWhatsAppLogMessage=async()=>{};",
    "@/lib/whatsapp/templates": "export const renderManagedWhatsAppTemplate=async(_key,data)=>{globalThis.__invoiceDetailUI.notificationReferences.push(data.plateNumber);return 'mock-message';};",
    "@/lib/industry-context": "export async function requireBusinessIndustryContext(cap){const s=globalThis.__invoiceDetailUI;s.calls.push(cap);if(s.denied)throw Error('DENIED');return {businessId:'biz',user:{branchId:'branch'},access:{effectiveBusinessRole:'STAFF'},industry:{industryType:'SALON_BEAUTY',orderLabel:'Appointment'}}}",
    "@/lib/branches": "export const authorizedOperationalBranchWhere=()=>({branchId:'branch'});",
    "@/lib/auth/business-user": "export const requireBusinessUser=async()=>({businessId:'biz',user:{branchId:'branch'}});",
    "next/navigation": "export const useRouter=()=>({back(){}});export function notFound(){throw Error('NOT_FOUND')}",
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children);",
    "@/app/(business)/whatsapp/actions": "export async function openWhatsAppDeepLinkAction(){globalThis.__invoiceDetailUI.outbound++;throw Error('OUTBOUND_FORBIDDEN')}",
    "@/components/invoice-refund-payment-form": "export const InvoiceRefundPaymentForm=()=>null;",
    "@/components/void-invoice-form": "export const VoidInvoiceForm=()=>null;",
    "@/components/wallet/wallet-refund-form": "export const WalletRefundForm=()=>null;",
  };
  const result = await build({ stdin: { contents: 'export {default} from "./src/app/(business)/invoices/[invoiceId]/page"; export {default as list} from "./src/app/(business)/invoices/page"; export {GET} from "./src/app/(business)/invoices/[invoiceId]/pdf/route"; export {AppointmentInvoiceModal} from "./src/components/appointment-invoice-modal"; export {sendInvoiceIfConnected} from "./src/lib/whatsapp/invoice-notifications";', resolveDir: process.cwd() }, bundle: true, platform: "node", packages: "external", format: "cjs", write: false, jsx: "automatic", plugins: [{ name: "invoice-ui-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  const bundled = { exports: {} }; new Function("require", "module", "exports", result.outputFiles[0].text)(require, bundled, bundled.exports);
  page = (bundled.exports as { default: typeof page }).default;
  listPage = (bundled.exports as { list: typeof listPage }).list;
  pdfRoute = (bundled.exports as { GET: typeof pdfRoute }).GET;
  modal = (bundled.exports as { AppointmentInvoiceModal: typeof modal }).AppointmentInvoiceModal;
  notification = (bundled.exports as { sendInvoiceIfConnected: typeof notification }).sendInvoiceIfConnected;
});
beforeEach(() => { Object.assign(state, { invoice: fixture(), denied: false, calls: [], query: {}, outbound: 0, notificationReferences: [] }); });
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
  assert.ok(html.includes(date.toLocaleTimeString("en-MY", { timeZone: "Asia/Kuching", hour: "2-digit", minute: "2-digit" })));
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

test("invoice and appointment instants render in the business timezone, not the UTC server", async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const inv = fixture();
    inv.issuedAt = new Date("2026-10-07T16:30:00Z");
    inv.appointment.scheduledAt = new Date("2026-10-09T03:00:00Z");
    state.invoice = inv;
    const html = await render();
    assert.ok(html.includes("08/10/2026"), "invoice crosses midnight in Kuching");
    assert.ok(html.includes("09/10/2026"));
    assert.ok(html.includes("11:00 am"), "appointment is 11 AM in Kuching");
    assert.equal(inv.issuedAt.toISOString(), "2026-10-07T16:30:00.000Z");
    assert.equal(inv.appointment.scheduledAt.toISOString(), "2026-10-09T03:00:00.000Z");
    inv.business.timezone = "UTC";
    const utcHtml = await render();
    assert.ok(utcHtml.includes("07/10/2026"));
    assert.ok(utcHtml.includes("03:00 am"));
    assert.doesNotMatch(utcHtml, /11:00 am/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("invoice list agrees with detail across midnight and uses a second business timezone", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const inv = fixture(); inv.issuedAt = new Date("2026-10-07T16:30:00Z"); state.invoice = inv;
    assert.match(renderToStaticMarkup(await listPage({ searchParams: Promise.resolve({}) })), /08 Oct, 12:30 am/);
    inv.business.timezone = "UTC";
    assert.match(renderToStaticMarkup(await listPage({ searchParams: Promise.resolve({}) })), /07 Oct, 04:30 pm/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("real PDF/print route passes business timezone to receipt and appointment reference", async () => {
  const inv = fixture(); inv.issuedAt = new Date("2026-10-07T16:30:00Z");
  inv.appointment.scheduledAt = new Date("2026-10-09T03:00:00Z"); state.invoice = inv;
  for (const suffix of ["", "?format=receipt"]) {
    const response = await pdfRoute(new Request(`https://example.test/invoices/invoice/pdf${suffix}`), { params: Promise.resolve({ invoiceId: "invoice" }) });
    const text = Buffer.from(await response.arrayBuffer()).toString("latin1");
    assert.match(text, /08\/10\/2026/); assert.match(text, /09\/10\/2026/); assert.match(text, /11:00 am/);
  }
  assert.equal(state.outbound, 0);
});

test("Invoice modal uses DTO business zone even when browser zone is UTC", async () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>");
  const previous = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const previousTZ = process.env.TZ; process.env.TZ = "UTC";
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    const invoice = { ...fixture(), issuedAt: "2026-10-07T16:30:00Z", businessTimezone: "Asia/Kuching", customerName: "Customer", customerPhone: "" };
    await act(async () => root.render(createElement(modal, { invoice, onClose() {} })));
    assert.ok(dom.window.document.body.textContent.includes("08/10/2026"));
    invoice.businessTimezone = "UTC";
    await act(async () => root.render(createElement(modal, { invoice, onClose() {} })));
    assert.ok(dom.window.document.body.textContent.includes("07/10/2026"));
    assert.equal(invoice.issuedAt, "2026-10-07T16:30:00Z");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test("notification receipt appointment reference uses the same legacy empty-zone default without sending", async () => {
  const inv = fixture(); inv.business.timezone = "";
  inv.appointment = { ...inv.appointment, scheduledAt: new Date("2026-10-09T03:00:00Z"), customer: { name: "Fixture", phone: "0123456789" } };
  state.invoice = inv;
  await notification({ businessId: "biz", invoiceId: "invoice", sentByUserId: "owner" });
  assert.deepEqual(state.notificationReferences, ["09/10/2026 11:00 am"]);
});
