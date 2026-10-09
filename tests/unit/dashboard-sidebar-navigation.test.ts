import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { NavItem } from "../../src/components/app-shell-frame";

const require = createRequire(import.meta.url);
const state = { pathname: "/team", query: "", modules: ["POS", "SALON", "WALLET", "LOYALTY", "EXPENSE"] };
const globals = globalThis as typeof globalThis & { __dashboardNav?: typeof state };
type User = { role: string; businessId: string; permissions: string[] };
let shell: (input: { user: User; children: null; access?: object }) => Promise<ReactElement<{ navItems: NavItem[] }>>;

before(async () => {
  globals.__dashboardNav = state;
  // Keep the real shell, frame, permission and capability implementations.
  // Stub authenticated I/O and unrelated shell integrations only.
  const stubs: Record<string, string> = {
    "@/lib/wallet/hub-availability": `export const canViewWalletHub=async()=>false;`,
    "next/link": `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    "next/navigation": `export const usePathname=()=>globalThis.__dashboardNav.pathname;export const useSearchParams=()=>new URLSearchParams(globalThis.__dashboardNav.query);export function redirect(){throw Error('REDIRECT')}`,
    "@/lib/prisma": `export const prisma={business:{findUnique:async()=>({name:'Local',industryType:'SALON_BEAUTY',cashierShiftsEnabled:true})}};`,
    "@/lib/modules/entitlements": `export const loadBusinessModuleContext=async()=>({enabledModules:new Set(globalThis.__dashboardNav.modules)});`,
    "@/lib/auth/mfa-feature": `export const isMfaFeatureEnabled=()=>false;`,
    "@/lib/auth/business-context-token": `export const createBusinessContextToken=()=>{throw Error('unexpected token')};`,
    "@/lib/approvals/service": `export const actionCenterDomains=[];export const resolveUnifiedApprovalContext=async()=>null;export const isUnifiedApprovalCenterAvailable=()=>false;export const getUnifiedApprovalCounts=()=>{throw Error('unexpected approvals')};`,
    "@/lib/business-groups/business-context": `export const getAvailableBusinessContexts=()=>{throw Error('unexpected contexts')};`,
    "@/lib/business-groups/all-stores-access": `export const getAvailableGroupReportingContexts=()=>{throw Error('unexpected groups')};`,
    "@/components/business-context-switcher": `export const BusinessContextSwitcher=()=>null;`,
    "@/components/pwa-install-button": `export const PwaInstallButton=()=>null;`,
    "@/components/sign-out-form": `export const SignOutForm=()=>null;`,
  };
  const result = await build({
    entryPoints: ["src/components/app-shell.tsx"], write: false, bundle: true,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{ name: "dashboard-nav-io", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "nav-io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "nav-io" }, args => ({ contents: stubs[args.path], resolveDir: process.cwd() }));
    } }],
  });
  const compiled = { exports: {} as { AppShell: typeof shell } };
  new Function("require", "module", result.outputFiles[0].text)(require, compiled);
  shell = compiled.exports.AppShell;
});
after(() => { delete globals.__dashboardNav; });

function renderShell(role = "BUSINESS_OWNER", permissions: string[] = [], access?: object) {
  return shell({ user: { role, permissions, businessId: "business" }, access, children: null });
}

test("Owner sees Dashboard before Cashier without changing existing nav order", async () => {
  const frame = await renderShell();
  assert.deepEqual(frame.props.navItems.map(item => item.label), [
    "Dashboard", "Cashier", "Services", "Products", "Appointments", "CRM", "Membership", "Expenses", "Shift Closing", "People", "Reports", "Catalog", "Company settings", "Security",
  ]);
  assert.deepEqual(frame.props.navItems[0], { href: "/dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "dashboard" });
});

test("Services is a single root entry after Packages while Catalog retains its other entries", async () => {
  const frame = await renderShell("BUSINESS_OWNER", [], { granted: true, businessId: "business", source: "DIRECT_BUSINESS", effectiveBusinessRole: "BUSINESS_OWNER" });
  const entries = frame.props.navItems;
  assert.equal(entries[entries.findIndex(item => item.href === "/package-hub") + 1].href, "/services");
  assert.deepEqual(entries.find(item => item.label === "Catalog")?.children?.map(item => item.href), ["/discounts"]);
  assert.equal(entries.filter(item => item.href === "/services").length, 1);
});

test("Services retains Staff, Group Manager and POS module eligibility", async () => {
  for (const [permissions, expected] of [[[], false], [["SERVICES"], true], [["PRODUCTS"], false]] as const) {
    assert.equal((await renderShell("STAFF", [...permissions])).props.navItems.some(item => item.href === "/services"), expected);
  }
  assert.ok((await renderShell("STAFF", [], { granted: true, source: "GROUP_MEMBERSHIP", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" })).props.navItems.some(item => item.href === "/services"));
  const original = state.modules;
  try {
    state.modules = ["SALON"];
    assert.ok(!(await renderShell()).props.navItems.some(item => item.href === "/services"));
  } finally { state.modules = original; }
});

test("Products is a single root entry after Services with unchanged eligibility", async () => {
  const owner = (await renderShell()).props.navItems;
  assert.equal(owner[owner.findIndex(item => item.href === "/services") + 1].href, "/products");
  assert.equal(owner.filter(item => item.href === "/products").length, 1);
  assert.ok(!owner.flatMap(item => item.children ?? []).some(item => item.href === "/products"));
  for (const [permissions, expected] of [[[], false], [["PRODUCTS"], true], [["SERVICES"], false]] as const) {
    assert.equal((await renderShell("STAFF", [...permissions])).props.navItems.some(item => item.href === "/products"), expected);
  }
  assert.ok((await renderShell("STAFF", [], { granted: true, source: "GROUP_ACCESS", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" })).props.navItems.some(item => item.href === "/products"));
  const original = state.modules;
  try { state.modules = ["SALON"]; assert.ok(!(await renderShell()).props.navItems.some(item => item.href === "/products")); }
  finally { state.modules = original; }
});

test("Staff Dashboard visibility follows DASHBOARD permission, not REPORTS", async () => {
  for (const [permissions, expected] of [[[], false], [["REPORTS"], false], [["DASHBOARD"], true]] as const) {
    const frame = await renderShell("STAFF", [...permissions]);
    assert.equal(frame.props.navItems.some(item => item.href === "/dashboard"), expected);
  }
});

test("Platform Admin keeps its admin navigation without the Business Dashboard", async () => {
  const frame = await renderShell("PLATFORM_ADMIN", ["DASHBOARD"]);
  assert.deepEqual(frame.props.navItems.map(item => item.href), ["/admin/businesses", "/admin/business-groups", "/admin/commercial", "/admin/whatsapp-templates", "/admin/vehicle-size-defaults", "/admin/statutory/rulesets", "/admin/otp-support"]);
});

test("authorized Business Group Manager uses existing VIEW_DASHBOARD capability", async () => {
  const frame = await renderShell("STAFF", [], { granted: true, source: "GROUP_MEMBERSHIP", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" });
  assert.equal(frame.props.navItems.filter(item => item.href === "/dashboard").length, 1);
  assert.ok(!frame.props.navItems.some(item => item.href.startsWith("/groups/")));
});

test("Dashboard stays active with period queries and inactive on People", async () => {
  const { JSDOM } = require("jsdom");
  for (const [pathname, query, active] of [["/dashboard", "", true], ["/dashboard", "range=month", true], ["/dashboard", "range=week", true], ["/team", "", false]] as const) {
    state.pathname = pathname; state.query = query;
    const dom = new JSDOM(renderToStaticMarkup(await renderShell()));
    try {
      const link = dom.window.document.querySelector('a[href="/dashboard"]');
      assert.ok(link);
      assert.equal(link.textContent.trim(), "Dashboard");
      assert.equal(link.classList.contains("active"), active);
    } finally { dom.window.close(); }
  }
});
