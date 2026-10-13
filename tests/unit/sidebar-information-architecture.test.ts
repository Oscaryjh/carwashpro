import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { appShellNavigationHarness } from "../helpers/app-shell-navigation-harness";
import type { NavItem } from "../../src/components/app-shell-frame";
import { act } from "react";
import { createRoot } from "react-dom/client";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

let h: Awaited<ReturnType<typeof appShellNavigationHarness>>;
const modules = ["POS", "SALON", "LOYALTY", "WALLET", "WHATSAPP", "INVENTORY", "HR", "EXPENSE", "AI"];
before(async () => { h = await appShellNavigationHarness(); });
after(() => h.close());
async function shell(role: "BUSINESS_OWNER" | "STAFF" = "BUSINESS_OWNER", permissions: string[] = [], enabled = modules, path = "/products") {
  Object.assign(h.state, { modules: enabled, pathname: path, query: "" });
  return h.api.AppShell({
    user: { role, userId: "owner", businessId: "business", permissions, homeBusinessId: "business", activeBusinessId: "business", contextVersion: 1, name: "Synthetic", email: "synthetic@example.test", status: "active" },
    access: { granted: true, userId: "owner", homeBusinessId: "business", businessId: "business", branchId: null, identityRole: role, actorRole: role, effectiveBusinessRole: role, permissions, industryType: "SALON_BEAUTY", source: "DIRECT_BUSINESS", groupId: null, groupUserId: null, capability: null }, children: null,
  });
}
const leaves = (items: NavItem[]): NavItem[] => items.flatMap(item => item.children?.length ? leaves(item.children) : [item]);

test("filtered business navigation groups existing routes in the approved order", async () => {
  const { navItems } = (await shell()).props;
  assert.deepEqual(navItems.map(n => n.label), ["Dashboard", "Cashier", "Appointments", "Customers", "Catalog", "People & HR", "Expenses", "Shift Closing", "Reports", "Ask Tetamu", "Company settings", "Security"]);
  assert.deepEqual(navItems.find(n => n.label === "Customers")?.children?.map(n => [n.label, n.href]), [["Customer list", "/crm"], ["Membership", "/loyalty"], ["Wallet", "/wallet"], ["WhatsApp", "/whatsapp/inbox"]]);
  assert.deepEqual(navItems.find(n => n.label === "Catalog")?.children?.map(n => n.href), ["/services", "/products", "/package-hub", "/inventory", "/discounts"]);
  assert.equal(leaves(navItems).find(n => n.href === "/whatsapp/inbox")?.badgeCount, 3);
  assert.equal(leaves(navItems).filter(n => n.href === "/package-hub").length, 1);
});

test("module disabled cases hide children without replacing their gates or empty parents", async () => {
  for (const [disabled, route] of [["WALLET", "/wallet"], ["INVENTORY", "/inventory"], ["LOYALTY", "/loyalty"], ["WHATSAPP", "/whatsapp/inbox"]]) {
    const nav = (await shell("BUSINESS_OWNER", [], modules.filter(m => m !== disabled))).props.navItems;
    assert.ok(!leaves(nav).some(n => n.href === route));
    assert.ok(nav.every(n => !n.children || n.children.length > 0));
  }
  const minimal = (await shell("STAFF", [], [], "/team")).props.navItems;
  assert.ok(!minimal.some(n => n.label === "Catalog" || n.label === "Customers"));
  const hrOff = (await shell("BUSINESS_OWNER", [], modules.filter(m => m !== "HR"))).props.navItems;
  assert.ok(hrOff.some(n => n.label === "People"));
  assert.ok(!hrOff.some(n => n.label === "People & HR"));
});

test("Staff keeps explicit navigation permissions and Packages fallback under Catalog", async () => {
  const nav = (await shell("STAFF", ["PRODUCTS", "PACKAGES"], ["POS", "SALON"])).props.navItems;
  assert.deepEqual(leaves(nav).map(n => n.href), ["/products", "/packages"]);
  assert.deepEqual(nav.map(n => n.label), ["Catalog"]);
});

test("deep links expose the active child and parent with accessible disclosure semantics", async () => {
  for (const [path, parent, child] of [["/products", "Catalog", "/products"], ["/services", "Catalog", "/services"], ["/loyalty", "Customers", "/loyalty"], ["/wallet", "Customers", "/wallet"], ["/crm/wallet/offers", "Customers", "/wallet"], ["/packages/item", "Catalog", "/package-hub"]]) {
    const dom = new JSDOM(renderToStaticMarkup(await shell("BUSINESS_OWNER", [], modules, path)));
    try {
      const button = dom.window.document.querySelector(`button[title="${parent}"]`)!;
      assert.equal(button.getAttribute("aria-expanded"), "true");
      assert.ok(button.classList.contains("active"));
      const controls = button.getAttribute("aria-controls");
      assert.ok(controls && dom.window.document.getElementById(controls));
      assert.equal(dom.window.document.querySelector(`a[href="${child}"]`)?.getAttribute("aria-current"), "page");
    } finally { dom.window.close(); }
  }
});

test("system divider precedes settings and People route does not activate customer/catalog parents", async () => {
  const dom = new JSDOM(renderToStaticMarkup(await shell("BUSINESS_OWNER", [], modules, "/team")));
  try {
    const doc = dom.window.document;
    const settings = doc.querySelector('a[href="/business/settings"]')!;
    assert.ok(settings.previousElementSibling?.matches('[role="separator"]'));
    assert.equal(doc.querySelector('button[title="Customers"]')?.classList.contains("active"), false);
    assert.equal(doc.querySelector('button[title="Catalog"]')?.classList.contains("active"), false);
    assert.equal(doc.querySelector('a[href="/team"]')?.getAttribute("aria-current"), "page");
  } finally { dom.window.close(); }
});

test("manual group preferences survive remount, while active route overrides collapsed preference", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const prior = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof dom.window.matchMedia;
  let root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/team")));
    const toggle = () => dom.window.document.querySelector('button[title="Customers"]') as HTMLButtonElement;
    await act(async () => toggle().click());
    assert.equal(toggle().getAttribute("aria-expanded"), "true");
    await act(async () => root.unmount());
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/team")));
    assert.equal(toggle().getAttribute("aria-expanded"), "true", "manual open survives a new frame");
    await act(async () => toggle().click());
    assert.equal(toggle().getAttribute("aria-expanded"), "false");
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/wallet")));
    assert.equal(toggle().getAttribute("aria-expanded"), "true", "direct route overrides stored collapsed");
    await act(async () => toggle().click());
    assert.equal(toggle().getAttribute("aria-expanded"), "true", "active child is never hidden");
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, prior); Reflect.deleteProperty(globalThis, "localStorage"); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); dom.window.close();
  }
});

test("tablet collapses only inactive sibling groups, while desktop supports both groups", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  let tablet = true;
  let mediaChanged = () => {};
  dom.window.matchMedia = () => ({ get matches() { return tablet; }, addEventListener(_event: string, handler: () => void) { mediaChanged = handler; }, removeEventListener() {} });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const group = (name: string) => dom.window.document.querySelector(`button[title="${name}"]`) as HTMLButtonElement;
  try {
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/team")));
    await act(async () => group("Customers").click());
    await act(async () => group("Catalog").click());
    assert.equal(group("Customers").getAttribute("aria-expanded"), "false");
    assert.equal(group("Catalog").getAttribute("aria-expanded"), "true");
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/wallet")));
    await act(async () => group("Catalog").click());
    await act(async () => group("Catalog").click());
    assert.equal(group("Customers").getAttribute("aria-expanded"), "true", "active group cannot be collapsed by another group");
    tablet = false;
    await act(async () => mediaChanged());
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/team")));
    await act(async () => group("Customers").click());
    assert.equal(group("Customers").getAttribute("aria-expanded"), "true");
    assert.equal(group("Catalog").getAttribute("aria-expanded"), "true");
    tablet = true;
    await act(async () => mediaChanged());
    assert.equal(group("Customers").getAttribute("aria-expanded"), "true");
    assert.equal(group("Catalog").getAttribute("aria-expanded"), "false", "resize normalizes desktop preferences without deleting them");
    tablet = false;
    await act(async () => mediaChanged());
    assert.equal(group("Catalog").getAttribute("aria-expanded"), "true", "desktop preferences are preserved");
  } finally {
    await act(async () => root.unmount()); Object.assign(globalThis, prior);
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); dom.window.close();
  }
});

test("active-route expansion and a locked group click never overwrite the user's collapsed preference", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.localStorage.setItem("tetamu-sidebar-open-groups-v1", '{"/crm":false}');
  const root = createRoot(dom.window.document.getElementById("root")!);
  const group = () => dom.window.document.querySelector('button[title="Customers"]') as HTMLButtonElement;
  try {
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/wallet")));
    assert.equal(group().getAttribute("aria-expanded"), "true");
    await act(async () => group().click());
    assert.equal(group().getAttribute("aria-expanded"), "true");
    await act(async () => root.render(await shell("BUSINESS_OWNER", [], modules, "/dashboard")));
    assert.equal(group().getAttribute("aria-expanded"), "false", "route-driven expansion must not become a user preference");
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("tetamu-sidebar-open-groups-v1")!), { "/crm": false });
  } finally {
    await act(async () => root.unmount()); Object.assign(globalThis, prior);
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); dom.window.close();
  }
});

test("disclosure and sidebar collapse controls use decorative SVG indicators, not text arrows", async () => {
  const dom = new JSDOM(renderToStaticMarkup(await shell()));
  try {
    const doc = dom.window.document;
    for (const control of [doc.querySelector('button[title="Catalog"]'), doc.querySelector('button[aria-label="Collapse sidebar"]')]) {
      assert.ok(control?.querySelector('svg[aria-hidden="true"]'));
      assert.doesNotMatch(control?.textContent ?? "", /[<>]|^V$/);
    }
    assert.ok(doc.querySelector('.nav-group-chevron svg'));
  } finally { dom.window.close(); }
});

test("collapsed tablet isolates scrolling navigation from bottom settings without losing links or active icons", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const prior = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.localStorage.setItem("washflow-sidebar-collapsed", "true");
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => root.render(await shell()));
    const doc = dom.window.document;
    const nav = doc.querySelector('nav[aria-label="Main navigation"]')!;
    assert.ok(doc.querySelector('.app-shell.sidebar-collapsed.shell'));
    const scrolling = nav.querySelector(':scope > .mainNavigation');
    const bottom = nav.querySelector(':scope > .bottomNavigation');
    assert.ok(scrolling, "collapsed tablet needs its own main scroll region");
    assert.ok(bottom, "settings must not be inside the main scroll region");
    assert.ok(scrolling.querySelector('button[title="Catalog"].active svg'));
    assert.ok(scrolling.querySelector('a[href="/dashboard"][title="Dashboard"]'));
    assert.equal(scrolling.querySelector('a[href="/business/settings"]'), null);
    assert.ok(bottom.querySelector('a[href="/business/settings"]'));
    assert.ok(bottom.querySelector('[title="Security"]'));
    assert.equal(nav.querySelectorAll('a[href="/business/settings"]').length, 1);
    assert.ok(nav.nextElementSibling?.matches('.sidebar-footer'));
    await act(async () => (doc.querySelector('button[aria-label="Expand sidebar"]') as HTMLButtonElement).click());
    assert.equal(nav.querySelector('.mainNavigation, .bottomNavigation'), null, "expanded DOM stays unchanged");
    assert.ok(nav.querySelector(':scope > a[href="/dashboard"]'));
  } finally {
    await act(async () => root.unmount()); Object.assign(globalThis, prior);
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); dom.window.close();
  }
});

test("desktop and mobile collapsed navigation retain their original direct-child layout", async () => {
  for (const width of [390, 1280, 1440]) {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
    const prior = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    dom.window.matchMedia = (query: string) => ({ matches: width >= 768 && !query.includes("max-width"), addEventListener() {}, removeEventListener() {} });
    dom.window.localStorage.setItem("washflow-sidebar-collapsed", "true");
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      await act(async () => root.render(await shell()));
      const nav = dom.window.document.querySelector('nav[aria-label="Main navigation"]')!;
      assert.equal(nav.querySelector('.mainNavigation, .bottomNavigation'), null, String(width));
      assert.ok(nav.querySelector(':scope > a[href="/dashboard"]'));
      assert.ok(nav.querySelector(':scope > a[href="/business/settings"]'));
    } finally {
      await act(async () => root.unmount()); Object.assign(globalThis, prior);
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); dom.window.close();
    }
  }
});
