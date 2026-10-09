import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { productSchema } from "../../src/lib/validation/products";
import { calculateTax } from "../../src/lib/tax/calculator";

const require = createRequire(import.meta.url);
let directory: string;
let Form: (props: any) => any;
let InteractiveForm: (props: any) => any;
const hookKey = "__productFormUIHooks";
const base = { action: async () => {}, branches: [{ id: "a", name: "Outlet" }], categories: [], inventoryEnabled: true, submitLabel: "Create product", modalLayout: true };
before(async () => {
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/product-form-ui-"));
  const options = { entryPoints: ["src/components/product-form.tsx"], bundle: true, platform: "node" as const, format: "cjs" as const, packages: "external" as const };
  await build({ ...options, outfile: join(directory, "form.cjs") });
  Form = require(join(directory, "form.cjs")).ProductForm;
  await build({ ...options, outfile: join(directory, "events.cjs"), plugins: [{ name: "state-harness", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
    b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: `export function useState(initial){const h=globalThis.${hookKey};const i=h.index++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]}` }));
  } }] });
  InteractiveForm = require(join(directory, "events.cjs")).ProductForm;
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Form, { ...base, ...props }));
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test("new product exposes ordered fields and concise create-only guidance", () => {
  const html = render();
  assert.match(html, /product-create-form/);
  assert.deepEqual([...html.matchAll(/<(?:input|select)\b[^>]*name="([^"]+)"/g)].map(m => m[1]).filter(n => !n.startsWith("$")), ["name", "price", "categoryId", "taxable", "taxRate", "trackInventory", "costPrice"]);
  assert.doesNotMatch(html, /System-generated SKU|Assigned automatically|<span>SKU<\/span>/);
  assert.match(html, /No category yet\? <a href="\/products\?modal=categories">Manage categories/);
  assert.match(html, /<span>Purchase cost \(optional\)<\/span>/);
  assert.doesNotMatch(html, /name="description"|<textarea/);
  assert.match(html, /Turn this on if you want Tetamu POS to keep track of how many units you have in each store\./);
  assert.doesNotMatch(html, /immutable branch stock ledger|name="stock_a"/);
});

test("new cost remains an enabled form field inside initially closed advanced settings", () => {
  const html = render();
  const advanced = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.ok(advanced);
  assert.doesNotMatch(advanced.split(">")[0], /\bopen\b/);
  assert.match(advanced, /<summary>Advanced settings<\/summary>/);
  assert.match(advanced, /Used as the default unit cost when creating purchase orders\./);
  const input = advanced.match(/<input[^>]*name="costPrice"[^>]*>/)?.[0] ?? "";
  assert.ok(input);
  assert.doesNotMatch(input, /disabled/);
  assert.match(input, /value=""/);
  assert.ok(html.indexOf("product-inventory-section") < html.indexOf("<details"));
});

test("edit keeps saved SKU description and cost even when modal styling is requested", () => {
  const product = { id: "p", name: "Product", description: "Existing product notes", sku: "SKU-023", status: "ACTIVE", price: 10, costPrice: 3.25, taxRate: null, taxable: false, trackInventory: false, stocks: [] };
  for (const modalLayout of [false, true]) {
    const html = render({ modalLayout, product });
    assert.match(html, /value="SKU-023"/);
    assert.match(html, /<textarea[^>]*name="description"[^>]*>Existing product notes<\/textarea>/);
    assert.match(html, /name="costPrice"[^>]*value="3.25"/);
    assert.doesNotMatch(html, /<summary>Advanced settings<\/summary>/);
  }
});

test("company rate is a hint only, including zero and fractional rates", () => {
  for (const rate of [0, 8, 6.5]) {
    const html = render({ companySstRate: rate });
    assert.ok(html.includes(`placeholder="Use company rate: ${rate}%"`));
    assert.match(html, /name="taxRate"[^>]*value=""/);
    assert.match(html, /Optional\. Enter a different rate only for this product\./);
  }
  for (const rate of [undefined, null, NaN, Infinity, -1, 101]) {
    const html = render({ companySstRate: rate });
    assert.match(html, /placeholder="Use company SST rate"/);
    assert.match(html, /Leave blank to use the company SST rate\./);
  }
});

test("toggle retains mounted enabled override and reserved layout; inventory keeps original field names", () => {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as any)[hookKey] = state;
  const props = { ...base, product: { taxable: true, taxRate: 6, price: 10, stocks: [] } };
  const tree = () => { state.index = 0; return InteractiveForm(props); };
  try {
    let elements = nodes(tree());
    elements.find(n => n.props?.name === "taxable").props.onChange({ currentTarget: { checked: false } });
    elements = nodes(tree());
    const slot = elements.find(n => n.props?.className === "product-tax-rate-slot");
    assert.ok(slot);
    assert.notEqual(slot.props.hidden, true);
    assert.ok(nodes(slot).some(n => n.props?.hidden === true));
    let rate = elements.find(n => n.props?.name === "taxRate");
    assert.equal(rate.props.defaultValue, "6.00");
    assert.notEqual(rate.props.disabled, true);
    elements.find(n => n.props?.name === "taxable").props.onChange({ currentTarget: { checked: true } });
    elements = nodes(tree());
    assert.ok(!elements.some(n => n.props?.hidden === true));
    assert.equal(elements.find(n => n.props?.name === "taxRate").props.defaultValue, "6.00");
    elements.find(n => n.props?.name === "trackInventory").props.onChange({ target: { checked: true } });
    elements = nodes(tree());
    assert.equal(elements.find(n => n.props?.name === "stock_a").props.defaultValue, 0);
    assert.equal(elements.find(n => n.props?.name === "reorder_a").props.defaultValue, 0);
    assert.equal(elements.find(n => n.props?.name === "stock_a").props.readOnly, false);
    elements.find(n => n.props?.name === "trackInventory").props.onChange({ target: { checked: false } });
    assert.ok(!nodes(tree()).some(n => n.props?.name === "stock_a"));
  } finally { delete (globalThis as any)[hookKey]; }
});

test("edit presentation, locked tracked stock and inventory entitlement remain intact", () => {
  const html = render({ modalLayout: false, product: { id: "p", name: "Product", sku: "P001", status: "ACTIVE", price: 10, costPrice: 3, taxRate: 6, taxable: false, trackInventory: true, stocks: [{ branchId: "a", quantity: 5, reorderLevel: 2 }] } });
  assert.doesNotMatch(html, /product-create-form|product-tax-rate-slot/);
  assert.match(html, /Tax rate override optional/);
  assert.match(html, /name="taxRate"[^>]*value="6.00"/);
  assert.match(html.match(/<input[^>]*name="stock_a"[^>]*>/)?.[0] ?? "", /readOnly=""/);
  assert.match(html, /name="stock_a"[^>]*value="5"/);
  assert.match(html, /type="hidden" name="trackInventory" value="on"/);
  assert.match(html, /name="status"/);
  assert.doesNotMatch(render({ inventoryEnabled: false }), /name="trackInventory"|name="stock_a"/);
});

test("hidden invalid override provides a correction path without enabling tax or erasing the value", () => {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as any)[hookKey] = state;
  const tree = () => { state.index = 0; return nodes(InteractiveForm({ ...base, product: { taxRate: 101, taxable: false, price: 10, stocks: [] } })); };
  try {
    let elements = tree();
    let prevented = false;
    elements.find(n => n.props?.name === "taxRate").props.onInvalid({ preventDefault() { prevented = true; } });
    elements = tree();
    assert.equal(prevented, true);
    assert.ok(elements.some(n => n.props?.role === "alert"));
    assert.equal(elements.find(n => n.props?.name === "taxable").props.checked, false);
    assert.equal(elements.find(n => n.props?.name === "taxRate").props.defaultValue, "101.00");
    elements.find(n => n.props?.name === "taxable").props.onChange({ currentTarget: { checked: true } });
    assert.ok(!tree().some(n => n.props?.role === "alert"));
  } finally { delete (globalThis as any)[hookKey]; }
});

test("existing product schema and calculator preserve blank, zero, custom and non-taxable semantics", () => {
  for (const [taxable, taxRate, tax] of [[true, "", 8], [true, "6", 6], [true, "0", 0], [false, "6", 0]] as const) {
    const input = productSchema.parse({ name: "Synthetic product", categoryId: "00000000-0000-4000-8000-000000000001", price: "100", taxable, taxRate });
    assert.equal(input.taxRate, taxRate === "" ? undefined : Number(taxRate));
    assert.equal(calculateTax({ sstEnabled: true, sstRate: 8, lines: [{ lineTotal: 100, taxable: input.taxable, taxRate: input.taxRate }] }).tax, tax);
  }
});

test("new and previously untracked products keep tracking off until explicitly enabled, then submit per-store starting quantities", () => {
  const state = { index: 0, values: [] as unknown[] };
  const runtime = globalThis as typeof globalThis & { __productFormUIHooks?: typeof state };
  runtime[hookKey] = state;
  const tree = (branches = base.branches) => {
    state.index = 0;
    return InteractiveForm({ ...base, branches });
  };
  try {
    let elements = nodes(tree());
    assert.equal(elements.find(n => n.props?.name === "trackInventory").props.checked, false);
    assert.ok(!elements.some(n => n.props?.name === "stock_a"));
    elements.find(n => n.props?.name === "trackInventory").props.onChange({target:{checked:true}});
    let html = renderToStaticMarkup(tree());
    assert.match(html, /How many do you have in stock right now\?/);
    assert.match(html, /Store: Outlet/);
    assert.match(html, /Starting quantity/);
    assert.match(html, /Enter 0 if you have none\. You can add stock later from Inventory\./);
    assert.match(html, /Low stock alert at/);
    assert.doesNotMatch(html, /Opening balances|OPENING_BALANCE|branch stock ledger/);
    elements = nodes(tree([{id:"a",name:"Outlet"},{id:"b",name:"Second"}]));
    for(const name of ["stock_a","stock_b","reorder_a","reorder_b"]){
      const field=elements.find(n=>n.props?.name===name);
      assert.ok(field,name);assert.equal(field.props.defaultValue,0);assert.notEqual(field.props.disabled,true);
    }
    html=renderToStaticMarkup(tree([]));
    assert.match(html,/Stock tracking is on, but there is no active store available/);
    assert.ok(nodes(tree([])).some(n=>n.type==="button" && n.props.type==="submit" && !n.props.disabled));
  } finally {delete runtime[hookKey];}
});

test("tracked edit preserves positive read-only quantities and only offers Inventory navigation when authorized",()=>{
  const product={id:"p",name:"Shampoo",sku:"P001",status:"ACTIVE",price:10,costPrice:null,taxRate:null,taxable:false,trackInventory:true,stocks:[{branchId:"a",quantity:10,reorderLevel:2}]};
  for(const canViewInventory of [false,true]){
    const html=render({product,canViewInventory});
    assert.match(html,/Stock quantities are managed in Inventory\./);
    assert.match(html,/name="stock_a"[^>]*value="10"/);
    assert.match(html.match(/<input[^>]*name="stock_a"[^>]*>/)?.[0]??"",/readOnly/);
    assert.equal(html.includes('href="/inventory"'),canViewInventory);
  }
});
