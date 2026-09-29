import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { serviceSchema } from "../../src/lib/validation/services";
import { calculateTax } from "../../src/lib/tax/calculator";

const require = createRequire(import.meta.url);
let directory: string;
let Form: (props: any) => any;
let TaxFields: (props: any) => any;
const hookKey = "__serviceTaxUIHooks";
before(async () => {
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/service-tax-ui-"));
  await build({ entryPoints: ["src/components/service-form.tsx"], outfile: join(directory, "form.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external" });
  Form = require(join(directory, "form.cjs")).ServiceForm;
  await build({ entryPoints: ["src/components/service-tax-fields.tsx"], outfile: join(directory, "events.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "state-harness", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
    b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: `export function useState(initial){const h=globalThis.${hookKey};const i=h.index++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]}` }));
  } }] });
  TaxFields = require(join(directory, "events.cjs")).ServiceTaxFields;
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

function render(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(Form, { action: async () => {}, ...props }));
}

test("new service shows the company rate as a hint without filling the override input", () => {
  for (const [rate, hint] of [[8, "8"], [0, "0"], [6.5, "6.5"]] as const) {
    const html = render({ companySstRate: rate });
    assert.match(html, /<span>Tax rate<\/span>/);
    assert.ok(html.includes(`placeholder="Use company rate: ${hint}%"`));
    assert.match(html, /Optional\. Enter a different rate only for this service\./);
    assert.match(html, /name="taxRate"[^>]*value=""/);
    assert.doesNotMatch(html, /Tax rate override optional/);
  }
});

test("missing or invalid company rate uses honest generic guidance", () => {
  for (const companySstRate of [undefined, null, NaN, Infinity, -1, 101]) {
    const html = render({ companySstRate });
    assert.match(html, /placeholder="Use company SST rate"/);
    assert.match(html, /Leave blank to use the company SST rate\./);
  }
});

test("taxable off hides the rate region but retains the enabled named input and override", () => {
  const html = render({ service: { id: "synthetic", price: 10, taxable: false, taxRate: 6 } });
  assert.match(html, /<div hidden=""[^>]*><label class="service-tax-rate-field">/);
  const input = html.match(/<input[^>]*name="taxRate"[^>]*>/)?.[0];
  assert.ok(input);
  assert.match(input, /value="6\.00"/);
  assert.doesNotMatch(input, /disabled/);
  assert.doesNotMatch(html.match(/<input[^>]*name="taxable"[^>]*>/)?.[0] ?? "", /checked/);
});

test("taxable on shows the rate region and preserves an existing zero override", () => {
  const html = render({ companySstRate: 8, service: { id: "synthetic", price: 10, taxable: true, taxRate: 0 } });
  assert.doesNotMatch(html, /<div hidden=""/);
  assert.match(html, /name="taxRate"[^>]*value="0\.00"/);
  assert.match(html, /name="taxable"[^>]*checked=""/);
});

test("unchanged service submission and calculator honor blank, custom and non-taxable values", () => {
  const base = { name: "Synthetic service", categoryId: "00000000-0000-4000-8000-000000000001", price: "100" };
  for (const [taxable, taxRate, expectedTax] of [[true, "", 8], [true, "6", 6], [true, "0", 0], [false, "6", 0]] as const) {
    const input = serviceSchema.parse({ ...base, taxable, taxRate });
    assert.equal(input.taxRate, taxRate === "" ? undefined : Number(taxRate));
    const result = calculateTax({ sstEnabled: true, sstRate: 8, lines: [{ lineTotal: 100, taxable: input.taxable, taxRate: input.taxRate }] });
    assert.equal(result.tax, expectedTax);
  }
});

test("hidden invalid rate surfaces correction guidance without changing taxable or clearing the input", () => {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as any)[hookKey] = state;
  function nodes(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  }
  const renderFields = () => { state.index = 0; return nodes(TaxFields({ defaultTaxable: true, defaultTaxRate: "101", companySstRate: 8 })); };
  try {
    let elements = renderFields();
    elements.find(n => n.props?.name === "taxable").props.onChange({ currentTarget: { checked: false } });
    elements = renderFields();
    let prevented = false;
    const rate = elements.find(n => n.props?.name === "taxRate");
    assert.equal(typeof rate.props.onInvalid, "function");
    rate.props.onInvalid({ preventDefault() { prevented = true; } });
    elements = renderFields();
    assert.equal(prevented, true);
    assert.equal(elements.find(n => n.props?.name === "taxable").props.checked, false);
    assert.equal(elements.find(n => n.props?.name === "taxRate").props.defaultValue, "101");
    assert.ok(elements.some(n => n.props?.role === "alert"));
    elements.find(n => n.props?.name === "taxable").props.onChange({ currentTarget: { checked: true } });
    elements = renderFields();
    assert.ok(!elements.some(n => n.props?.role === "alert"));
    assert.equal(elements.find(n => n.props?.name === "taxRate").props.defaultValue, "101");
  } finally { delete (globalThis as any)[hookKey]; }
});
