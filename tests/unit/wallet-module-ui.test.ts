import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleKeys } from "../../src/lib/modules/registry";

test("Wallet module OFF removes customer entry without rendering controls", async () => {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-module-ui-"));
  try {
    const outfile = join(directory, "summary.cjs");
    await build({ entryPoints: ["src/components/wallet/member-wallet-summary.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: {".css":"empty"},
      plugins: [{name:"server-actions",setup(builder) {
        builder.onResolve({filter:/^@\/app\/.*\/actions$/}, args=>({path:args.path,namespace:"actions"}));
        builder.onLoad({filter:/.*/,namespace:"actions"},()=>({contents:"export const walletPanelAction=()=>{throw Error('read not expected')};export const walletHistoryAction=walletPanelAction;export const walletTopUpOptionsAction=walletPanelAction;export const walletTopUpAction=walletPanelAction;export const walletRefundOptionsAction=walletPanelAction;export const walletRefundAction=walletPanelAction;export const reverseWalletTopUpAction=walletPanelAction;export const walletVoidAction=walletPanelAction;export const refundWalletSaleAction=walletPanelAction;export const voidInvoiceAction=walletPanelAction;"}));
      }}] });
    const {MemberWalletSummary} = createRequire(import.meta.url)(outfile);
    const props = { customerId:"synthetic",customerName:"Synthetic",enabled:false };
    assert.equal(renderToStaticMarkup(createElement(MemberWalletSummary,props)), "");
    assert.match(renderToStaticMarkup(createElement(MemberWalletSummary,{...props,enabled:true})), /Member wallet|Refresh wallet/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("Modules and Access presents Wallet description in the existing table", async () => {
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-module-table-"));
  try {
    const outfile=join(directory,"table.cjs");
    await build({entryPoints:["src/components/module-access-manager.tsx"],outfile,bundle:true,platform:"node",format:"cjs",packages:"external",jsx:"automatic",loader:{".css":"empty"}});
    const {ModuleAccessManager}=createRequire(import.meta.url)(outfile);
    const html=renderToStaticMarkup(createElement(ModuleAccessManager,{businessId:"synthetic",evaluatedAt:"2026-10-01T00:00:00Z",initialRows:moduleKeys.map(key=>({key,status:key==="CORE"?"ENABLED":"DISABLED",from:"2026-01-01T00:00:00Z",until:null,revision:null,source:"MANUAL",plan:""})),action:async()=>{throw Error("render must not save")},result:{}}));
    assert.match(html,/Member Wallet/);
    assert.match(html,/Enable customer wallet top-ups, payments, refunds and wallet history\./);
  } finally {await rm(directory,{recursive:true,force:true});}
});
