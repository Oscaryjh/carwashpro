import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { packageHubHarness, fixture, branchId, businessId } from "../helpers/package-hub-ui-harness";
import { appShellNavigationHarness } from "../helpers/app-shell-navigation-harness";
import type { AppShell } from "../../src/components/app-shell";
import { createRequire } from "node:module";

function navigationProps(role: "BUSINESS_OWNER" | "STAFF" | "GROUP_MANAGER_READ_ONLY" | "PLATFORM_ADMIN", permissions = ["PACKAGES"]): Parameters<typeof AppShell>[0] {
  const identityRole = role === "GROUP_MANAGER_READ_ONLY" ? "STAFF" : role;
  return {
    user: { userId: "u1", role: identityRole, businessId, permissions, homeBusinessId: businessId,
      activeBusinessId: businessId, contextVersion: 1, name: "Navigation test", email: "navigation@example.test", status: "active" }, children: null,
    access: { granted: true, userId: "u1", homeBusinessId: businessId, businessId, branchId: null,
      identityRole, actorRole: identityRole, effectiveBusinessRole: role, permissions, industryType: "SALON_BEAUTY",
      source: "DIRECT_BUSINESS", groupId: null, groupUserId: null, capability: null },
  };
}

test("Packages follows an existing Wallet entry, otherwise Cashier; authorized Catalog roles keep management", async () => {
  const h = await appShellNavigationHarness();
  try {
    for (const modules of [["POS", "SALON", "WALLET"], ["POS", "SALON"]]) {
      h.state.modules = modules;
      for (const role of ["BUSINESS_OWNER", "STAFF", "GROUP_MANAGER_READ_ONLY"] as const) {
      const frame = await h.api.AppShell(navigationProps(role));
      const nav = frame.props.navItems, hub = nav.findIndex(n => n.href === "/package-hub");
      const catalog = nav.find(n => n.label === "Catalog")?.children ?? [];
      if (role === "BUSINESS_OWNER") {
        const wallet = nav.findIndex(n => n.href === "/wallet");
        assert.ok(hub > 0);
        assert.equal(hub, nav.findIndex(n => n.href === (wallet >= 0 ? "/wallet" : "/cashier")) + 1);
        assert.equal(nav[hub + 1].href, "/services");
        assert.equal(nav[hub + 2].href, "/appointments");
        assert.equal(nav[hub].label, "Packages");
        assert.ok(!catalog.some(n => n.href === "/packages"));
      }
      else { assert.equal(hub, -1); assert.ok(catalog.some(n => n.href === "/packages")); }
      }
    }
    assert.ok(!h.inputs.some(path => /src\/(components\/wallet|app\/\(business\)\/wallet|lib\/wallet\/hub-)/.test(path.replaceAll("\\", "/"))));
  } finally { h.close(); }
});

test("Packages navigation preserves Owner, POS, Business and existing Staff permission boundaries", async () => {
  const h = await appShellNavigationHarness();
  try {
    for (const mode of ["pos-off", "business-mismatch", "no-access", "staff-no-permission", "platform"] as const) {
      h.state.modules = mode === "pos-off" ? ["SALON", "WALLET"] : ["POS", "SALON", "WALLET"];
      const props = navigationProps(mode === "platform" ? "PLATFORM_ADMIN" : mode === "staff-no-permission" ? "STAFF" : "BUSINESS_OWNER", []);
      if (mode === "business-mismatch" && props.access?.granted) props.access.businessId = "another-business";
      if (mode === "no-access") props.access = undefined;
      const nav = (await h.api.AppShell(props)).props.navItems;
      assert.ok(!nav.some(item => item.href === "/package-hub"), mode);
      if (mode === "staff-no-permission") assert.ok(!nav.some(item => item.children?.some(child => child.href === "/packages")));
    }
  } finally { h.close(); }
});

test("Manage Packages highlights the Packages Hub across management deep links", async () => {
  const h = await appShellNavigationHarness();
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  try {
    for (const pathname of ["/package-hub", "/packages", "/packages/edit"]) {
      h.state.pathname = pathname;
      const frame = await h.api.AppShell(navigationProps("BUSINESS_OWNER"));
      const dom = new JSDOM(renderToStaticMarkup(frame));
      try {
        const link = dom.window.document.querySelector('a[href="/package-hub"]');
        assert.ok(link?.classList.contains("active"), pathname);
      } finally { dom.window.close(); }
    }
  } finally { h.close(); }
});
for (const view of ["overview", "activity", "sales", "customers"]) test(`${view} consumes canonical DTO, shows honest values and no internal fields`, async () => {
  const h = await packageHubHarness();
  try {
    const page = await h.api.Page({ searchParams: Promise.resolve({ view, branchId }) });
    const html = renderToStaticMarkup(h.api.PackageHub(page.props));
    assert.ok(h.state.calls.some(c => c.reader === view));
    assert.ok(h.state.calls.every(c => c.ctx.branchId === branchId));
    assert.doesNotMatch(html, /FinancialOperation|entryKey|sequence|migration|legacy source/);
    assert.match(html, /Settings/); assert.match(html, /Manage Packages/);
    assert.doesNotMatch(html, /type="date"/);
    if (view === "overview") { assert.match(html, /Current state/); assert.match(html, /Period activity/); for (const n of [7, 2, 13, 29, 3]) assert.ok(html.includes(`>${n}<`)); }
    else { assert.match(html, /Limited history/); assert.match(html, /20 per page/); assert.doesNotMatch(html, /1–20 of|Page 1/); }
    if (view === "customers") { assert.match(html, /5/); assert.ok(!("fromDate" in h.state.calls[0].input)); }
    if (view === "sales") assert.match(html, /RM119.00/);
    assert.equal(fixture.activity.rows[0].remainingAfter, 5);
  } finally { h.close(); }
});

for (const view of ["activity", "sales"]) test(`${view}: no rows hides the complete pagination footer, real rows keep cursor controls`, async () => {
  const h = await packageHubHarness();
  try {
    h.state.empty = true;
    const empty = await h.api.Page({ searchParams: Promise.resolve({ view }) });
    assert.doesNotMatch(renderToStaticMarkup(h.api.PackageHub(empty.props)), /Package pagination|20 per page|Previous|Next/);
    h.state.empty = false;
    const populated = await h.api.Page({ searchParams: Promise.resolve({ view }) });
    const html = renderToStaticMarkup(h.api.PackageHub(populated.props));
    assert.match(html, /Package pagination/); assert.match(html, /20 per page/);
    if (view === "activity") assert.match(html, /cursor=next-real-cursor/);
  } finally { h.close(); }
});

test("Overview empty activity is compact, has no all-activity link and no single-branch scope noise", async () => {
  const h = await packageHubHarness(); h.state.empty = true;
  try {
    const p = await h.api.Page({ searchParams: Promise.resolve({ view: "overview" }) });
    const html = renderToStaticMarkup(h.api.PackageHub(p.props));
    assert.doesNotMatch(html, /View all activity|All branches|class="context"/);
    assert.match(html, /Used-up packages/); assert.match(html, /Uses restored/);
    h.state.empty = false;
    const data = await h.api.Page({ searchParams: Promise.resolve({ view: "overview" }) });
    assert.match(renderToStaticMarkup(h.api.PackageHub(data.props)), /View all activity/);
  } finally { h.close(); }
});

test("branch presentation is hidden for one outlet and retained for multi or explicit scope without period duplication", async () => {
  const h = await packageHubHarness();
  try {
    const p = await h.api.Page({ searchParams: Promise.resolve({ view: "customers" }) });
    const single = renderToStaticMarkup(h.api.PackageHub(p.props));
    assert.doesNotMatch(single, />Branch<|All branches|Current balances ·/);
    for (const props of [{ ...p.props, branches: [...p.props.branches, { id: "branch2", name: "Second outlet" }] }, { ...p.props, query: { ...p.props.query, branchId } }]) {
      const html = renderToStaticMarkup(h.api.PackageHub(props));
      assert.match(html, />Branch</); assert.match(html, /class="context"/); assert.doesNotMatch(html, /This Month ·|Current balances ·/);
    }
  } finally { h.close(); }
});

test("Customer Packages separates customer and package with Uses left and subtle legacy indication", async () => {
  const h = await packageHubHarness();
  try {
    const p = await h.api.Page({ searchParams: Promise.resolve({ view: "customers" }) });
    p.props.customers!.rows.push({ ...p.props.customers!.rows[0], customerPackageId: "modern", customerName: "Modern customer", historyMayBeIncomplete: false });
    try {
      const html = renderToStaticMarkup(h.api.PackageHub(p.props));
      assert.match(html, /<th>Customer<\/th>/); assert.match(html, /<th class="packageColumn">Package<\/th>/);
      assert.match(html, />Uses Left</); assert.match(html, /<strong>5<\/strong> \/ 10/);
      assert.match(html, /Limited history/); assert.doesNotMatch(html, /Earlier package activity is unavailable/);
      const modernRow = html.match(/<tr[^>]*>(?:(?!<\/tr>).)*Modern customer(?:(?!<\/tr>).)*<\/tr>/)?.[0];
      assert.ok(modernRow); assert.doesNotMatch(modernRow, /Limited history/);
    } finally { p.props.customers!.rows.pop(); }
  } finally { h.close(); }
});

test("Sales exposes purchase/current DTO facts while Activity keeps event language", async () => {
  const h = await packageHubHarness();
  try {
    const p = await h.api.Page({ searchParams: Promise.resolve({ view: "sales" }) });
    const html = renderToStaticMarkup(h.api.PackageHub(p.props));
    for (const label of ["Purchase date", "Purchase price", "Total Uses", "Uses Left", "Current status"]) assert.ok(html.includes(label), label);
    assert.match(html, /RM119.00/); assert.match(html, />10</); assert.match(html, />5</);
    const activity = await h.api.Page({ searchParams: Promise.resolve({ view: "activity" }) });
    assert.match(renderToStaticMarkup(h.api.PackageHub(activity.props)), /Activity type/);
  } finally { h.close(); }
});
test("route denies invalid scope before reading and does not hide runtime errors", async () => {
  const h = await packageHubHarness();
  try {
    for (const role of ["STAFF", "GROUP_MANAGER_READ_ONLY", "PLATFORM_ADMIN"]) { h.state.role = role; await assert.rejects(h.api.Page({ searchParams: Promise.resolve({}) }), /NOT_FOUND/); }
    h.state.role = "BUSINESS_OWNER";
    for (const id of ["bad", "33333333-3333-4333-8333-333333333333", ""]) await assert.rejects(h.api.Page({ searchParams: Promise.resolve({ branchId: id }) }), /NOT_FOUND/);
    h.state.enabled = false; await assert.rejects(h.api.Page({ searchParams: Promise.resolve({}) }), /NOT_FOUND/);
    assert.equal(h.state.calls.length, 0);
    h.state.enabled = true; h.state.error = Error("database offline"); await assert.rejects(h.api.Page({ searchParams: Promise.resolve({}) }), /database offline/);
  } finally { h.close(); }
});
test("custom dates and cursor navigation preserve branch; filter changes drop cursor; restricted links hidden", async () => {
  const h = await packageHubHarness();
  try {
    const q = h.api.parsePackageHubQuery({ view: "activity", branchId, range: "custom", from: "2026-10-01", to: "2026-10-07", q: "Alice" });
    const next = h.api.nextPackageHubQuery(q, "real"); assert.equal(h.api.previousPackageHubQuery(next)?.cursor, undefined);
    assert.ok(h.api.packageHubHref(next).includes("cursor=real")); assert.ok(h.api.packageHubHref(next).includes(branchId));
    h.state.manage = false; h.state.links = false;
    const p = await h.api.Page({ searchParams: Promise.resolve({ view: "activity", range: "custom", from: "2026-10-01", to: "2026-10-07", cursor: "old-cursor", back: '[""]' }) });
    const html = renderToStaticMarkup(h.api.PackageHub(p.props));
    assert.equal((html.match(/type="date"/g) ?? []).length, 2); assert.doesNotMatch(html, /Settings|href="\/invoices\//);
    const periodNav = html.match(/<nav[^>]*aria-label="Package period"[^>]*>(.*?)<\/nav>/)?.[1];
    assert.ok(periodNav); assert.doesNotMatch(periodNav, /cursor|back=/);
  } finally { h.close(); }
});

test("empty canonical pages show honest empty states with no fabricated rows", async () => {
  const h = await packageHubHarness(); h.state.empty = true;
  try {
    for (const view of ["activity", "sales", "customers"]) {
      const page = await h.api.Page({ searchParams: Promise.resolve({ view }) });
      const html = renderToStaticMarkup(h.api.PackageHub(page.props));
      assert.match(html, /No (package|customer packages)/); assert.doesNotMatch(html, /<tbody|Alice|href="[^"]*cursor=/);
    }
  } finally { h.close(); }
});

test("invalid Custom window offers correction without querying; Overview clears hidden filters", async () => {
  const h = await packageHubHarness();
  try {
    for (const dates of [{ from: "2026-09-01", to: "2026-10-07" }, { from: "2026-10-07", to: "2026-10-01" }]) {
      const page = await h.api.Page({ searchParams: Promise.resolve({ view: "activity", range: "custom", branchId, ...dates }) });
      const html = renderToStaticMarkup(page);
      assert.match(html, /Choose a period of up to 31 days/);
      assert.match(html, /type="date"/); assert.ok(html.includes(branchId));
    }
    assert.equal(h.state.calls.length, 0);
    const q = h.api.parsePackageHubQuery({ view: "overview", q: "Alice", packageSearch: "Haircut" });
    assert.equal(q.q, ""); assert.equal(q.packageSearch, "");
  } finally { h.close(); }
});
