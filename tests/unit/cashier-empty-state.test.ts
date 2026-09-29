import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let dir: string;
let Panel: (props: any) => any;
before(async () => {
  dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/cashier-empty-"));
  await build({ entryPoints: ["src/components/cashier-sales-panel.tsx"], outfile: join(dir, "panel.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "checkout-boundary", setup(b) {
    // Do not load checkout server actions; this test exercises only the panel.
    b.onResolve({ filter: /^@\/components\/cashier-unified-sale-form$/ }, () => ({ path: "checkout", namespace: "test" }));
    b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export function CashierUnifiedSaleForm(){throw new Error('Checkout must not execute in a panel unit test')}" }));
  } }] });
  Panel = require(join(dir, "panel.cjs")).CashierSalesPanel;
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

const choices = [
  { service: true, product: true, package: true, copy: "Create an active service, product, or package before starting a sale." },
  { service: true, product: false, package: false, copy: "Create an active service before starting a sale." },
  { service: false, product: true, package: false, copy: "Create an active product before starting a sale." },
  { service: false, product: false, package: true, copy: "Create an active package before starting a sale." },
  { service: true, product: true, package: false, copy: "Create an active service or product before starting a sale." },
  { service: true, product: false, package: true, copy: "Create an active service or package before starting a sale." },
  { service: false, product: true, package: true, copy: "Create an active product or package before starting a sale." },
  { service: false, product: false, package: false, copy: "No active sale items are available. Ask your business owner to set up the catalog." },
];
for (const choice of choices) {
  test(`empty catalog CTAs and copy follow allowed choices ${JSON.stringify(choice)}`, () => {
    const html = renderToStaticMarkup(createElement(Panel, { hasCatalogItems: false, catalogCreateAccess: choice }));
    const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);
    assert.deepEqual(links, [
      ...(choice.service ? [["/services?modal=create", "Create service"]] : []),
      ...(choice.product ? [["/products?type=create", "Create product"]] : []),
      ...(choice.package ? [["/packages/new", "Create package"]] : []),
    ]);
    assert.ok(html.includes(choice.copy));
    if (!links.length) assert.doesNotMatch(html, /cashier-empty-actions/);
  });
}

test("nonempty catalog and existing appointment lines retain the checkout component and props", () => {
  const action = async () => ({ status: "idle" });
  for (const props of [
    { hasCatalogItems: true, initialSale: null },
    { hasCatalogItems: false, initialSale: { lines: [{ id: "synthetic-line" }] } },
  ]) {
    const tree = Panel({ ...props, action, branchId: "synthetic-branch", hasOpenShift: true, initialCatalog: { items: [] }, catalogCreateAccess: { service: false, product: false, package: false } });
    assert.equal(tree.type.name, "CashierUnifiedSaleForm");
    assert.equal(tree.props.action, action);
    assert.equal(tree.props.branchId, "synthetic-branch");
    assert.equal(tree.props.hasOpenShift, true);
    assert.equal(tree.props.initialSale, props.initialSale);
  }
});

test("catalog creation UI follows existing POS entitlement and individual staff permissions", () => {
  const { getCashierCatalogCreateAccess } = require("../../src/lib/cashier/catalog-create-access");
  for (const industry of ["SALON_BEAUTY", "AUTO_DETAILING"]) {
    for (const choice of choices) {
      const permissions = ["POS", ...(choice.service ? ["SERVICES"] : []), ...(choice.product ? ["PRODUCTS"] : []), ...(choice.package ? ["PACKAGES"] : [])];
      assert.deepEqual(getCashierCatalogCreateAccess({ role: "STAFF", permissions }, new Set(["POS"]), industry), { service: choice.service, product: choice.product, package: choice.package });
    }
    assert.deepEqual(getCashierCatalogCreateAccess({ role: "BUSINESS_OWNER", permissions: [] }, new Set(["POS"]), industry), { service: true, product: true, package: true });
    for (const role of ["BUSINESS_OWNER", "STAFF"]) {
      assert.deepEqual(getCashierCatalogCreateAccess({ role, permissions: ["SERVICES", "PRODUCTS", "PACKAGES"] }, new Set(), industry), { service: false, product: false, package: false });
    }
    for (const role of ["PLATFORM_ADMIN", "GROUP_MANAGER"]) {
      assert.deepEqual(getCashierCatalogCreateAccess({ role, permissions: ["SERVICES", "PRODUCTS", "PACKAGES"] }, new Set(["POS"]), industry), { service: false, product: false, package: false });
    }
  }
});
