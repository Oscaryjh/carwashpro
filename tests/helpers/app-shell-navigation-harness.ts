import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactElement } from "react";
import type { AppShell } from "../../src/components/app-shell";
import type { NavItem } from "../../src/components/app-shell-frame";

const require = createRequire(import.meta.url);

// Exercise the real AppShell, frame, staff permissions and group capabilities.
// Only authenticated I/O and unrelated shell integrations are substituted.
export async function appShellNavigationHarness(sourceRoot = process.cwd()) {
  const state = { modules: ["POS", "SALON", "WALLET"], pathname: "/package-hub", query: "" };
  const globals = globalThis as typeof globalThis & { __appShellNavigation?: typeof state };
  globals.__appShellNavigation = state;
  const stubs: Record<string, string> = {
    "next/link": "import{createElement}from'react';export default({children,...props})=>createElement('a',props,children);",
    "next/navigation": "export const usePathname=()=>globalThis.__appShellNavigation.pathname;export const useSearchParams=()=>new URLSearchParams(globalThis.__appShellNavigation.query);export function redirect(){throw Error('REDIRECT')};",
    "@/lib/prisma": "export const prisma={business:{findUnique:async()=>({name:'Local',industryType:'SALON_BEAUTY',cashierShiftsEnabled:true})}};",
    "@/lib/modules/entitlements": "export const loadBusinessModuleContext=async()=>({enabledModules:new Set(globalThis.__appShellNavigation.modules)});",
    // Optional in workspaces that already contain Wallet navigation; no Wallet UI/readers are bundled.
    "@/lib/wallet/hub-availability": "export const canViewWalletHub=async()=>true;",
    "@/lib/auth/mfa-feature": "export const isMfaFeatureEnabled=()=>false;",
    "@/lib/auth/business-context-token": "export const createBusinessContextToken=()=>{throw Error('unexpected token')};",
    "@/lib/approvals/service": "export const actionCenterDomains=[];export const resolveUnifiedApprovalContext=async()=>null;export const isUnifiedApprovalCenterAvailable=()=>false;export const getUnifiedApprovalCounts=()=>{throw Error('unexpected approvals')};",
    "@/lib/business-groups/business-context": "export const getAvailableBusinessContexts=()=>{throw Error('unexpected context')};",
    "@/lib/business-groups/all-stores-access": "export const getAvailableGroupReportingContexts=()=>{throw Error('unexpected groups')};",
    "@/components/business-context-switcher": "export const BusinessContextSwitcher=()=>null;",
    "@/components/pwa-install-button": "export const PwaInstallButton=()=>null;",
    "@/components/sign-out-form": "export const SignOutForm=()=>null;",
  };
  const bundle = await build({
    absWorkingDir: sourceRoot, entryPoints: ["src/components/app-shell.tsx"], write: false,
    bundle: true, metafile: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{ name: "app-shell-navigation-io", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "navigation-io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "navigation-io" }, args => ({ contents: stubs[args.path], resolveDir: sourceRoot }));
    } }],
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  type API = { AppShell: (props: Parameters<typeof AppShell>[0]) => Promise<ReactElement<{ navItems: NavItem[] }>> };
  return { api: compiled.exports as API, state, inputs: Object.keys(bundle.metafile.inputs), close: () => { delete globals.__appShellNavigation; } };
}
