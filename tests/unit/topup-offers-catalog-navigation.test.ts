import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { NavItem } from "../../src/components/app-shell-frame";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const businessId = "11111111-1111-4111-8111-111111111111";
let directory: string;
let ui: {
  AppShell: (props: ReturnType<typeof context> & { children: null }) => Promise<ReactElement<{ navItems: NavItem[] }>>;
  OffersPage: () => Promise<ReactElement>;
};
const state = { pathname: "/crm/wallet/offers", modules: ["POS", "WALLET"], role: "BUSINESS_OWNER", queries: [] as Array<{ businessId: string }>, context: context() };
const globals = globalThis as typeof globalThis & { __catalogFixture?: typeof state };
before(async () => {
  globals.__catalogFixture = state;
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/topup-catalog-"));
  const outfile = join(directory, "ui.cjs");
  // Real shell/frame, route, entitlement dependency resolution and offer component.
  // Only authenticated I/O and unrelated shell integrations are replaced.
  const stubs: Record<string, string> = {
    "@/lib/wallet/hub-availability": `export const canViewWalletHub=async()=>true;`,
    "next/link": `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    "next/navigation": `export const usePathname=()=>globalThis.__catalogFixture.pathname;export const useSearchParams=()=>new URLSearchParams();export function notFound(){throw Error('NOT_FOUND')}export function redirect(){throw Error('REDIRECT')}`,
    "@/lib/prisma": `export const prisma={business:{findUnique:async()=>({name:'Local',industryType:'AUTO_DETAILING'})},businessModuleEntitlement:{findMany:async()=>globalThis.__catalogFixture.modules.map(moduleKey=>({moduleKey,status:'ENABLED',enabledFrom:new Date(0),enabledUntil:null}))}};`,
    "@/lib/auth/mfa-feature": `export const isMfaFeatureEnabled=()=>false;`,
    "@/lib/auth/business-context-token": `export const createBusinessContextToken=()=>{throw Error('unexpected token')};`,
    "@/lib/approvals/service": `export const actionCenterDomains=[];export const resolveUnifiedApprovalContext=async()=>null;export const isUnifiedApprovalCenterAvailable=()=>false;export const getUnifiedApprovalCounts=()=>{throw Error('unexpected approvals')};`,
    "@/lib/business-groups/business-context": `export const getAvailableBusinessContexts=()=>{throw Error('unexpected contexts')};`,
    "@/lib/business-groups/all-stores-access": `export const getAvailableGroupReportingContexts=()=>{throw Error('unexpected groups')};`,
    "@/components/business-context-switcher": `export const BusinessContextSwitcher=()=>null;`,
    "@/components/pwa-install-button": `export const PwaInstallButton=()=>null;`,
    "@/components/sign-out-form": `export const SignOutForm=()=>null;`,
    "@/lib/tenant": `export const requireBusinessContext=async()=>globalThis.__catalogFixture.context;`,
    "@/lib/wallet/ui-adapter": `export const listWalletOffers=async(input)=>{globalThis.__catalogFixture.queries.push(input);return []};`,
    "@/app/(business)/crm/wallet/actions": `export function saveWalletOfferAction(){throw Error('unexpected write')}export function walletOffersAction(){throw Error('unexpected refresh')}`,
  };
  await build({ stdin: {contents: `export {AppShell} from './src/components/app-shell';export {default as OffersPage} from './src/app/(business)/crm/wallet/offers/page';`, resolveDir: process.cwd(), loader: "tsx"}, outfile, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: {".css":"empty"}, plugins: [{name:"catalog-io",setup(b){
    b.onResolve({filter:/.*/},args=>stubs[args.path] ? {path:args.path,namespace:"catalog-io"}:undefined);
    b.onLoad({filter:/.*/,namespace:"catalog-io"},args=>({contents:stubs[args.path],resolveDir:process.cwd()}));
  }}] });
  ui = require(outfile);
});
after(async()=>{delete globals.__catalogFixture;if(directory)await rm(directory,{recursive:true,force:true});});

function context(role="BUSINESS_OWNER") {
  const user={role,userId:"actor",businessId,staffPermissions:[],activeBusinessId:businessId};
  return {user,businessId,access:{granted:true,effectiveBusinessRole:role,source:"DIRECT_BUSINESS"}};
}
async function shell(role="BUSINESS_OWNER",modules=["POS","WALLET"],pathname="/crm/wallet/offers") {
  state.modules=modules;state.pathname=pathname;state.context=context(role);
  return ui.AppShell({...state.context,children:null});
}

test("Catalog removes Offers without reordering the remaining entries or adding a sidebar item",async()=>{
  const frame=await shell();
  const catalog=frame.props.navItems.find(n=>n.label==="Catalog");
  assert.ok(catalog?.children);
  assert.deepEqual(catalog.children.filter(n=>n.href==="/crm/wallet/offers"),[]);
  assert.ok(!frame.props.navItems.some(n=>n.href==="/crm/wallet/offers"));
  assert.deepEqual(catalog.children.filter(n=>n.href!=="/crm/wallet/offers").map(n=>n.href),["/packages","/discounts"]);
});

test("Wallet OFF, missing POS dependency, Staff and Platform Admin never gain the entry",async()=>{
  for(const [role,modules] of [["BUSINESS_OWNER",["POS"]],["BUSINESS_OWNER",["WALLET"]],["STAFF",["POS","WALLET"]],["PLATFORM_ADMIN",["POS","WALLET"]]] as const){
    const frame=await shell(role,[...modules]);
    assert.ok(!frame.props.navItems.some(n=>n.children?.some(c=>c.href==="/crm/wallet/offers")));
  }
});

test("existing offers deep link activates Wallet only, while other CRM URLs still activate CRM",async()=>{
  for(const path of ["/crm/wallet/offers","/crm/wallet/offers/","/crm","/crm/customer","/crm/wallet/offers-other"]){
    const html=renderToStaticMarkup(await shell("BUSINESS_OWNER",["POS","WALLET"],path));
    const dom=new JSDOM(html);try{
      const d=dom.window.document;const offers=path==="/crm/wallet/offers"||path==="/crm/wallet/offers/";
      assert.equal(d.querySelector('a[href="/crm"]')?.classList.contains("active"),!offers);
      assert.equal(d.querySelector('button[title="Catalog"]')?.classList.contains("active"),false);
      assert.equal(d.querySelector('a[href="/wallet"]')?.classList.contains("active"),offers);
      assert.equal(d.querySelector('a[href="/crm/wallet/offers"]'),null);
    }finally{dom.window.close();}
  }
});

test("old direct offers route preserves Owner and Wallet guards and tenant-scoped loading",async()=>{
  state.context=context();state.modules=["POS","WALLET"];state.queries=[];
  const html=renderToStaticMarkup(await ui.OffersPage());
  assert.doesNotMatch(html,/Customers|href="\/crm"|←/);
  assert.match(html,/<h1>Manage Top-up<\/h1>/);
  assert.match(html,/href="\/wallet\?view=top-ups"[^>]*>Back to Wallet<\/a>/);
  assert.match(html,/Create wallet top-up amounts and bonus credit offers\./);
  assert.match(html,/>Create offer<\/button>/);
  assert.equal(state.queries.length,1);assert.equal(state.queries[0].businessId,businessId);
  state.context=context("STAFF");await assert.rejects(ui.OffersPage(),/NOT_FOUND/);
  state.context=context();state.modules=["POS"];state.queries=[];
  const unavailable=renderToStaticMarkup(await ui.OffersPage());
  assert.match(unavailable,/not enabled/);assert.equal(state.queries.length,0);
  assert.doesNotMatch(unavailable,/Customers|href="\/crm"|←/);
});
