import { build, type Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { crmUiBoundaries } from "./crm-ui-fixture";

// Keep all presentation, calculations and handlers real. Replace authenticated
// server I/O and control root hook state for synchronous component tests.
export function cashierUiBoundaries(): Plugin[] {
  return [crmUiBoundaries(), { name: "cashier-ui-state", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, args => args.importer.endsWith("cashier-unified-sale-form.tsx") ? { path: "root", namespace: "cashier-hooks" } : args.importer.endsWith("package-customer-picker.tsx") ? { path: "picker", namespace: "cashier-hooks" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "cashier-hooks" }, args => ({ contents: args.path === "root"
      ? "export const useState=(initial)=>globalThis.__cashierHooks.state(initial);export const useEffect=()=>{};export const useMemo=(fn)=>fn();export const useRef=(initial)=>({current:initial});"
      : "export const useState=(initial)=>globalThis.__cashierHooks.picker(initial);export const useEffect=()=>{};export const useRef=(initial)=>({current:initial});", resolveDir: process.cwd() }));
    builder.onLoad({ filter: /\.module\.css$/ }, async args => {
      const css = await readFile(args.path, "utf8");
      const classes = Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
      return { contents: `export default ${JSON.stringify(classes)}`, loader: "js" };
    });
  } }];
}

export async function buildCashierUi(outfile: string) {
  await build({ stdin: { contents: 'export {CashierUnifiedSaleForm} from "./src/components/cashier-unified-sale-form";export {WalletPanelContext} from "./src/components/wallet/wallet-panel-context";', resolveDir: process.cwd(), loader: "tsx" }, outfile, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: cashierUiBoundaries() });
}

export const cashierCustomer = { id: "customer", name: "Isaac Liew", phone: "0125286913", loyaltyPoints: 90, activePackageCount: 2, vehicleCount: 0, vehicles: [] };
export const cashierItem = { id: "service", name: "200mins massage", category: "Massage", description: "200 min", price: 300, taxable: false, taxRate: null, type: "service" as const };
export const cashierProps = {
  branchId: "branch", branches: [{ id: "branch", name: "Main" }], catalogDiscounts: [], hasOpenShift: true,
  initialCatalog: { categories: ["Massage", "Hair"], items: [cashierItem], page: 1, pageCount: 2, pageSize: 8, total: 9 },
  initialCatalogType: "service" as const,
  paymentMethods: [{ id: null, code: "BUILTIN_CASH", label: "Cash", canonicalMethod: "CASH" as const, paymentKind: "LOCAL_TENDER" as const, settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER" as const }],
  staffOptions: [{ id: "staff", name: "OSCAR" }], taxSettings: { enabled: false, label: "SST", rate: 0 },
  loyaltySettings: { enabled: true, redemptionEnabled: true, pointsPerRinggit: 1, minimumPoints: 1 },
  walletCheckoutEnabled: true, walletCheckoutScope: "wallet-scope",
  action: async () => { throw Error("UI fixture never submits a financial action"); },
};
