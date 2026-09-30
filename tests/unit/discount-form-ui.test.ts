import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let directory: string;
let Form: any;
let Interactive: any;
const hookKey = "__discountUIHooks";
const base = { action: async () => {}, branches: [{ id: "a", name: "Outlet" }] };
const saved = { id: "d", name: "Existing", discountType: "PERCENTAGE", percentage: 12, fixedAmount: null, scope: "PRODUCTS", branchId: "a", minimumSpend: 25, maximumDiscount: 15, startsAt: new Date(2026, 8, 29, 10), endsAt: new Date(2026, 9, 2, 20), allowLoyaltyStacking: true, active: false };
before(async () => {
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/discount-ui-"));
  for (const interactive of [false, true]) {
    const file = join(directory, `${interactive ? "events" : "render"}.cjs`);
    await build({ entryPoints: ["src/components/catalog-discount-form-modal.tsx"], outfile: file, bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "framework-boundary", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "router" }));
      b.onLoad({ filter: /.*/, namespace: "router" }, () => ({ contents: "export function useRouter(){return {replace(){}}}" }));
      if (interactive) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
        b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: `export function useState(initial){const h=globalThis.${hookKey};const i=h.index++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]} export function useRef(initial){return {current:initial}} export function useCallback(v){return v} export function useEffect(){}` }));
      }
    } }] });
    if (interactive) Interactive = require(file).CatalogDiscountFormModal;
    else Form = require(file).CatalogDiscountFormModal;
  }
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const render = (props = {}) => renderToStaticMarkup(createElement(Form, { ...base, ...props }));
function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }

test("new hides advanced inputs in a closed disclosure without removing or disabling submit fields", () => {
  const html = render();
  const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.ok(details, "advanced disclosure must exist");
  assert.doesNotMatch(details.split(">")[0], /\bopen/);
  for (const name of ["minimumSpend", "maximumDiscount", "startsAt", "endsAt", "allowLoyaltyStacking"]) {
    const input = details.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
    assert.ok(input, name);
    assert.doesNotMatch(input, /disabled/);
  }
  assert.match(html, /Discount value/);
  assert.ok(html.indexOf('name="active"') > html.indexOf("</details>"));
  assert.match(html, /name="minimumSpend"[^>]*value="0"/);
});

test("one-outlet new keeps business-wide blank branch while multi-branch and edit retain selectors", () => {
  assert.doesNotMatch(render(), /<select[^>]*name="branchId"/);
  assert.match(render(), /<input[^>]*name="branchId"[^>]*value=""/);
  assert.match(render({ branches: [...base.branches, { id: "b", name: "Legacy B" }] }), /<select[^>]*name="branchId"/);
  assert.match(render({ discount: saved }), /<select[^>]*name="branchId"/);
});

test("edit retains all original values, labels, dates and expanded editing capability", () => {
  const html = render({ discount: saved });
  assert.doesNotMatch(html, /<details/);
  for (const [name, value] of [["name", "Existing"], ["percentage", "12"], ["minimumSpend", "25"], ["maximumDiscount", "15"], ["startsAt", "2026-09-29T10:00"], ["endsAt", "2026-10-02T20:00"]]) assert.match(html, new RegExp(`name="${name}"[^>]*value="${value}"`));
  assert.match(html, /value="PRODUCTS" selected/);
  assert.match(html, /value="a" selected/);
  assert.match(html, /name="allowLoyaltyStacking"[^>]*checked/);
  assert.doesNotMatch(html.match(/<input[^>]*name="active"[^>]*>/)?.[0] ?? "", /checked/);
  assert.match(html, /Active discount/);
});

test("new type switches units and only visually hides the mounted maximum input", () => {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as any)[hookKey] = state;
  const tree = () => { state.index = 0; return nodes(Interactive(base)); };
  try {
    let elements = tree();
    assert.ok(elements.some(n => n.props?.name === "percentage" && n.props.required));
    elements.find(n => n.props?.name === "discountType" && n.props.value === "FIXED_AMOUNT").props.onChange();
    elements = tree();
    assert.ok(elements.some(n => n.props?.name === "fixedAmount" && n.props.required));
    assert.ok(elements.some(n => n.type === "span" && n.props.children === "RM"));
    const maximum = elements.find(n => n.props?.name === "maximumDiscount");
    assert.ok(maximum, "maximum must remain mounted for new");
    assert.notEqual(maximum.props.disabled, true);
    assert.ok(elements.some(n => n.props?.hidden && nodes(n).includes(maximum)));
    elements.find(n => n.props?.name === "discountType" && n.props.value === "PERCENTAGE").props.onChange();
    elements = tree();
    assert.ok(elements.some(n => n.props?.name === "percentage"));
    assert.ok(elements.some(n => n.type === "span" && n.props.children === "%"));
    assert.ok(!elements.some(n => n.props?.hidden && nodes(n).some(c => c.props?.name === "maximumDiscount")));
  } finally { delete (globalThis as any)[hookKey]; }
});

test("invalid hidden maximum has a correction path without clearing the value or changing type", () => {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as any)[hookKey] = state;
  const tree = () => { state.index = 0; return nodes(Interactive(base)); };
  try {
    let elements = tree();
    elements.find(n => n.props?.name === "discountType" && n.props.value === "FIXED_AMOUNT").props.onChange();
    elements = tree();
    const max = elements.find(n => n.props?.name === "maximumDiscount");
    assert.equal(typeof max.props.onInvalid, "function");
    max.props.onInvalid();
    elements = tree();
    assert.ok(!elements.some(n => n.props?.hidden && nodes(n).some(c => c.props?.name === "maximumDiscount")));
    assert.ok(elements.some(n => n.props?.name === "fixedAmount"));
    elements.find(n => n.props?.name === "maximumDiscount").props.onBlur({ currentTarget: { validity: { valid: true } } });
    elements = tree();
    assert.ok(elements.some(n => n.props?.hidden && nodes(n).some(c => c.props?.name === "maximumDiscount")), "corrected maximum should be hidden again in Fixed");
    elements.find(n => n.props?.name === "discountType" && n.props.value === "PERCENTAGE").props.onChange();
    elements = tree();
    elements.find(n => n.props?.name === "maximumDiscount").props.onInvalid();
    elements.find(n => n.props?.name === "discountType" && n.props.value === "FIXED_AMOUNT").props.onChange();
    elements = tree();
    assert.ok(elements.some(n => n.props?.hidden && nodes(n).some(c => c.props?.name === "maximumDiscount")), "a previous Percentage error must not permanently expose Fixed maximum");
  } finally { delete (globalThis as any)[hookKey]; }
});
