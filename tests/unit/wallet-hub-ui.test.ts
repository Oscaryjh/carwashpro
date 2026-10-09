import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { walletHubHarness, branchId, customerId, fixture } from "../helpers/wallet-hub-ui-harness";
let h: Awaited<ReturnType<typeof walletHubHarness>>;
before(async () => { h = await walletHubHarness(); });
after(() => h?.close());
beforeEach(() => { Object.assign(h.state, { role: "BUSINESS_OWNER", modules: ["POS", "SALON", "WALLET"], denied: false, invoiceAllowed: true, customerAllowed: true, branches: [{ id: branchId, name: "Local branch" }], calls: [], empty: false }); });
const page = (query: Record<string, string | string[]> = {}) => h.api.Page({ searchParams: Promise.resolve(query) });
const html = async (query: Record<string, string | string[]> = {}) => renderToStaticMarkup(h.api.WalletHub((await page(query)).props));

test("Hub scoped styles retain the page explanation and readable Top-up status at Pad widths", () => {
  const css = readFileSync("src/components/wallet/wallet-hub.module.css", "utf8");
  assert.match(css, /\.hub\s+header\s+p\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.badge\s*\{[^}]*white-space:\s*nowrap/);
});

test("Overview keeps all-customer current Paid/Bonus apart from selected period metrics", async () => {
  const result = await html({ range: "month", branchId });
  for (const label of ["Total Wallet Balance", "Top-ups", "Wallet Used", "Refunds", "Paid RM80.00", "Bonus RM20.00", "Current balance across all customers", "This Month", "Activity filtered by Local branch"]) assert.ok(result.includes(label), label);
  assert.equal((result.match(/class="metric"/g) ?? []).length, 4);
  assert.doesNotMatch(result, /<label>Branch<select/); // one real branch: no selector
  assert.doesNotMatch(result, /name="from"|name="to"/);
  assert.ok(h.state.calls.every(call => call.ctx.branchId === branchId));
});
test("Transactions renders one grouped row, signed real deltas, customer balance and genuine drilldowns", async () => {
  const result = await html({ view: "transactions", range: "custom", from: "2026-10-01", to: "2026-10-31" });
  assert.match(result, /\+RM110\.00/); assert.match(result, /RM210\.00/);
  assert.match(result, new RegExp(`/crm/customers/${customerId}`));
  assert.match(result, /2 Oct 2026/); assert.match(result, /name="from"/);
  assert.match(result, /aria-haspopup="dialog"/); // Detail values and permission-gated links are tested after opening the real drawer.
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.calls[0].input.pageSize, 20);
});
test("Top-ups distinguishes paid, bonus, total added and domain status", async () => {
  const result = await html({ view: "top-ups" });
  for (const label of ["Paid", "Bonus", "Total Added", "Method", "Posted", "RM100.00", "RM10.00", "RM110.00"]) assert.ok(result.includes(label), label);
  assert.doesNotMatch(result, />Unpaid<|>Consumed<|>Expired</);
  assert.deepEqual(h.state.calls.map(c => c.reader), ["topUps"]);
});
test("authorized Wallet views share header Settings; Top-ups no longer owns the configuration action", async () => {
  const view = (await page({ view: "top-ups" })).props;
  const result = renderToStaticMarkup(h.api.WalletHub(view));
  assert.doesNotMatch(result, /Manage Top-up Offers/);
  assert.match(result, /<summary[^>]*>Settings/);
  assert.match(result, /href="\/crm\/wallet\/offers"[^>]*>Manage Top-up<\/a>/);
  assert.doesNotMatch(result, />Top-up Offers<\/a>/);
  const denied = renderToStaticMarkup(h.api.WalletHub({ ...view, canManageTopUpOffers: false }));
  assert.doesNotMatch(denied, /Settings|href="\/crm\/wallet\/offers"/);
  for (const other of ["overview", "transactions", "balances"]) {
    const otherView = await html({ view: other });
    assert.doesNotMatch(otherView, /Manage Top-up Offers/);
    assert.match(otherView, /<summary[^>]*>Settings/);
  }
});
test("Customer Balances has search and current balances without period or branch filter", async () => {
  const result = await html({ view: "balances", q: "Alice", range: "today" });
  assert.match(result, /All customers · Current balances/);
  assert.doesNotMatch(result, /name="range"|name="branchId"|name="from"|name="to"/);
  assert.match(result, /RM100\.00/); assert.equal(h.state.calls[0].input.search, "Alice");
  assert.equal("fromDate" in h.state.calls[0].input, false);
});
test("empty paginated views use compact owner-language states and never invent links", async () => {
  h.state.empty = true;
  for (const [view, text] of [["transactions", "No wallet activity in this period."], ["top-ups", "No top-ups in this period."], ["balances", "No customer wallet balances yet."]]) {
    const result = await html({ view }); assert.ok(result.includes(text)); assert.doesNotMatch(result, /href="\/invoices\//);
  }
});
test("missing Invoice permission removes Invoice link without losing historical Wallet row", async () => {
  h.state.invoiceAllowed = false;
  assert.doesNotMatch(await html({ view: "transactions" }), /href="\/invoices\//);
});
test("invalid explicit branch fails closed before a reader runs", async () => {
  for (const branch of ["", "garbage", "99999999-9999-4999-8999-999999999999"]) {
    await assert.rejects(page({ branchId: branch }), /NOT_FOUND/); assert.equal(h.state.calls.length, 0);
  }
});
test("Owner-only route uses Phase 1 guard even if session or permission looks broad", async () => {
  for (const role of ["STAFF", "GROUP_MANAGER_READ_ONLY", "PLATFORM_ADMIN"]) { h.state.role = role; await assert.rejects(page(), /NOT_FOUND/); }
  h.state.role = "BUSINESS_OWNER"; h.state.denied = true; await assert.rejects(page(), /NOT_FOUND/);
  h.state.denied = false; h.state.modules = ["POS"]; await assert.rejects(page(), /NOT_FOUND/);
  assert.equal(h.state.calls.length, 0);
});
test("two real branches show a selector; single branch never creates Business-wide pseudo-branch", async () => {
  h.state.branches.push({ id: "55555555-5555-4555-8555-555555555555", name: "Second branch" });
  assert.match(await html(), /<label>Branch<select/);
});
test("normal All branches form omits explicit branchId, while a selected single branch survives Apply", async () => {
  h.state.branches.push({ id: "55555555-5555-4555-8555-555555555555", name: "Second branch" });
  assert.doesNotMatch(await html({ view: "transactions" }), /name="branchId"/);
  h.state.branches.pop();
  assert.match(await html({ view: "transactions", branchId }), new RegExp(`name="branchId" value="${branchId}"`));
});
test("owner-facing UI contains no internal terminology or write actions", async () => {
  for (const view of ["overview", "transactions", "top-ups", "balances"]) {
    const result = await html({ view }); assert.doesNotMatch(result, /Ledger|Principal|Canonical|FinancialOperation|Materialized|Add Top-up|>Reverse<|>Refund<|>Adjust</);
  }
});
test("query parsing defaults safely, rejects duplicate filters and cleans unrecognized input", () => {
  const q = h.api.parseHubQuery({ view: "bogus", range: "bogus", q: " Alice ", ignored: "secret" });
  assert.equal(q.view, "overview"); assert.equal(q.range, "month");
  const href = h.api.hubHref(q); assert.ok(!href.includes("ignored")); assert.ok(href.includes("q=Alice"));
  assert.throws(() => h.api.parseHubQuery({ branchId: [branchId, "other"] }));
});

test("malformed reader cursor is a safe not-found response, not a runtime failure", async () => {
  h.state.readerError = new SyntaxError("Unexpected token in cursor");
  try { await assert.rejects(page({ view: "transactions", cursor: "invalid" }), /NOT_FOUND/); }
  finally { h.state.readerError = undefined; }
});

test("deep pagination never labels bounded cursor history as an absolute page number", async () => {
  const result = await html({ view: "transactions", back: JSON.stringify(Array(20).fill("cursor")) });
  assert.match(result, /20 per page/);
  assert.doesNotMatch(result, /Page 21/);
});

test("period resolution uses Business timezone and cutoff for all presets and Custom", () => {
  const business = { timezone: "Asia/Singapore", businessDayCutoffTime: "02:00" };
  const now = new Date("2026-10-07T17:00:00Z"); // Oct 8 01:00 remains Oct 7 business day.
  for (const [range, from, to] of [["today", "2026-10-07", "2026-10-07"], ["month", "2026-10-01", "2026-10-07"], ["last-month", "2026-09-01", "2026-09-30"]]) {
    const period = h.api.resolveHubPeriod(h.api.parseHubQuery({ range }), business, now);
    assert.equal(period.fromDateValue, from); assert.equal(period.toDateValue, to);
  }
  const custom = h.api.resolveHubPeriod(h.api.parseHubQuery({ range: "custom", from: "2026-10-01", to: "2026-10-02" }), business, now);
  assert.equal(custom.fromDate.toISOString(), "2026-09-30T18:00:00.000Z");
  assert.equal(custom.toDateExclusive.toISOString(), "2026-10-02T18:00:00.000Z");
  assert.throws(() => h.api.parseHubQuery({ range: "custom", from: "bad", to: "2026-10-02" }));
});

test("payment methods use owner language rather than internal Wallet enums", async () => {
  const view = (await page()).props;
  for (const [paymentMethod, label] of [["MEMBER_WALLET", "Wallet"], ["EWALLET", "E-wallet"]] as const) {
    const result = renderToStaticMarkup(h.api.WalletHub({ ...view, query: { ...view.query, view: "top-ups" }, topUps: { ...fixture.topUps, rows: [{ ...fixture.topUps.rows[0], paymentMethod }] } }));
    assert.ok(result.includes(label)); assert.ok(!result.includes(paymentMethod));
  }
});
test("cursor Next/Previous preserves filters and uses reader cursor without loading full history", async () => {
  const q = h.api.parseHubQuery({ view: "transactions", range: "last-month", q: "Alice", type: "TOP_UP", branchId });
  const next = h.api.nextHubQuery(q, "next-cursor");
  const url = new URL(h.api.hubHref(next), "http://localhost");
  assert.equal(url.searchParams.get("cursor"), "next-cursor"); assert.equal(url.searchParams.get("q"), "Alice"); assert.equal(url.searchParams.get("branchId"), branchId);
  assert.deepEqual(h.api.previousHubQuery(next), q); assert.equal(h.api.previousHubQuery(q), null);
  h.state.empty = true;
  const result = await html(Object.fromEntries(url.searchParams)); assert.match(result, />Previous</); assert.doesNotMatch(result, /<a[^>]*>Next</);
});
test("real type directions and nonzero supplements remain separate from primary KPIs", async () => {
  const view = (await page()).props;
  const result = renderToStaticMarkup(h.api.WalletHub({ ...view, overview: { ...fixture.overview, period: { ...fixture.overview.period, topUpReversals: "12.00", voidRestores: "5.00" } } }));
  assert.match(result, /Top-up Reversals/); assert.match(result, /VOID Restores/);
  for (const [type, amount, label] of [["WALLET_USED", "-50.00", "Wallet Used"], ["WALLET_REFUND", "30.00", "Wallet Refund"], ["TOP_UP_REVERSAL", "-100.00", "Top-up Reversal"], ["VOID_RESTORE", "50.00", "VOID Restore"]] as const) {
    const rendered = renderToStaticMarkup(h.api.WalletHub({ ...view, query: { ...view.query, view: "transactions" }, transactions: { rows: [{ ...fixture.transactions.rows[0], type, amount, invoiceId: null }], nextCursor: null } }));
    assert.ok(rendered.includes(label)); assert.ok(rendered.includes(`${amount.startsWith("-") ? "-" : "+"}RM${amount.replace("-", "")}`));
  }
});
