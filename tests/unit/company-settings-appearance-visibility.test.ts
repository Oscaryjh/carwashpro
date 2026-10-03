import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const settings = "src/app/(business)/business/settings";

// Isolate the server page from authentication/database I/O and separately tested
// child forms. Assertions below exercise the real page's rendered section tree.
const boundary = `
  import { createElement } from 'react';
  export default function Link(props) { return createElement('a', props); }
  export const BusinessForm = () => null;
  export const CompanyClockInLocation = () => null;
  export const CompanyLocationSaveProvider = ({children}) => children;
  export const CompanySettingsDialog = () => null;
  export const PaymentMethodsSettings = () => null;
  export const CashierOperationsSettings = () => null;
  export const StaffAppAppearanceEditor = () => null;
  export const requireBusinessContext = async () => ({businessId: 'synthetic', user: {}, access: {}});
  export const assertRole = () => {};
  export const prisma = {
    business: {findUnique: async () => ({id: 'synthetic', name: 'Synthetic outlet', industryType: 'SALON', timezone: 'Asia/Kuching'})},
    businessVehicleSizeOverride: {findMany: async () => []}
  };
  export const loadCompanyLocationView = async () => ({});
  export const loadBusinessModuleContext = async () => ({enabledModules: new Set()});
  export const getEffectiveCommercialConfiguration = async () => ({});
  export const listSubscriptionInvoices = async () => [];
  export const getEffectiveBusinessPaymentMethods = async () => [];
  export const MODULE_REGISTRY = {};
  export const moduleKeys = [];
  export const formatCents = () => '';
  export const updateBusinessAction = () => {};
  export const saveCompanyClockInLocationAction = () => {};
  export const saveBusinessVehicleSizeOverrideAction = () => {};
  export const removeBusinessVehicleSizeOverrideAction = () => {};
  export const resolveStaffAppAppearance = () => ({});
  export const notFound = () => { throw new Error('not found'); };
`;

test("Company settings removes the appearance section without leaving a placeholder or losing later sections", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/appearance-visibility-"));
  try {
    for (const [name, entry] of [["settings", `${settings}/page.tsx`], ["appearance", `${settings}/staff-app/page.tsx`]]) {
      await build({ entryPoints: [entry], outfile: join(dir, `${name}.cjs`), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "server-boundaries", setup(b) {
        b.onResolve({ filter: /^react$/ }, ({ path }) => ({ path, external: true }));
        b.onResolve({ filter: /^(?:@\/|\.\/|next\/)/ }, ({ path, kind }) => kind === "entry-point" ? undefined : ({ path, namespace: "boundary" }));
        b.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: path.endsWith(".css") ? "export default {};" : boundary }));
      } }] });
    }
    const Page = require(join(dir, "settings.cjs")).default;
    const tree = await Page({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /Staff App appearance|Employee experience|staff-app-appearance|\/business\/settings\/staff-app/);
    const sheets = tree.props.children.props.children.filter((child: any) => child?.props?.className?.includes("company-settings-sheet"));
    assert.deepEqual(sheets.map((child: any) => child.props.id), ["modules", "subscription"], "no empty secondary sheet remains between the form and later settings");
    assert.match(html, /id="modules"/);
    assert.match(html, /id="subscription"/);
    assert.doesNotMatch(html, /href="#staff-app-appearance"/);

    const AppearancePage = require(join(dir, "appearance.cjs")).default;
    const appearanceHtml = renderToStaticMarkup(await AppearancePage());
    assert.match(appearanceHtml, /Staff App Appearance/);
    assert.match(appearanceHtml, /Back to settings/);
    for (const file of ["staff-app-appearance-editor.tsx", "actions.ts", "staff-app-appearance.module.css"]) {
      await access(join(settings, "staff-app", file));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
