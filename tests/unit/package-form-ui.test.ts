import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let directory: string;
let Form: (props: Record<string, unknown>) => ReactElement;
let Benefits: (props: Record<string, unknown>) => ReactElement;
const hookKey = "__packageUIHooks";
const services = [{ id: "a", name: "Wash", categoryName: "Hair", price: "20.00" }, { id: "b", name: "Treatment", categoryName: "Hair", price: "50.00" }];
const base = { action: async () => {}, branches: [{ id: "branch", name: "Outlet" }], services, isSalonBusiness: true, submitLabel: "Create package" };
before(async () => {
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/package-ui-"));
  const options = { bundle: true, platform: "node" as const, format: "cjs" as const, packages: "external" as const };
  await build({ ...options, entryPoints: ["src/components/package-form.tsx"], outfile: join(directory, "form.cjs") });
  Form = require(join(directory, "form.cjs")).PackageForm;
  await build({ ...options, entryPoints: ["src/components/package-service-benefits-field.tsx"], outfile: join(directory, "events.cjs"), plugins: [{ name: "state-harness", setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith("package-service-benefits-field.tsx") ? ({ path: "react", namespace: "hooks" }) : ({ path: "react", external: true }));
    b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: `export function useId(){return 'benefits-test'};export function useEffect(){};export function useState(initial){const h=globalThis.${hookKey};const i=h.index++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return [h.values[i],v=>h.values[i]=typeof v==='function'?v(h.values[i]):v]}` }));
  } }] });
  Benefits = require(join(directory, "events.cjs")).PackageServiceBenefitsField;
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Form, { ...base, ...props }));
type TestNode = { type: unknown; props: {
  children?: unknown; name?: string; value?: unknown; disabled?: boolean;
  min?: string; max?: string; required?: boolean; "aria-label"?: string;
  onClick: () => void; onChange: (event: { target: { value: string } } | string) => void;
} };
function nodes(node: unknown): TestNode[] {
  if (!node || typeof node !== "object") return [];
  const element = node as TestNode;
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
function harness(initialBenefits: Array<{ serviceId: string; totalUses: number }> = []) {
  const state = { index: 0, values: [] as unknown[] };
  (globalThis as unknown as Record<string, unknown>)[hookKey] = state;
  const tree = () => { state.index = 0; return Benefits({ services, initialBenefits, createMode: true }); };
  const fields = (name: string) => nodes(tree()).filter(n => n.props?.name === name);
  const add = () => {
    const button = nodes(tree()).find(n => n.type === "button" && n.props.children === "+ Add service");
    assert.ok(button);
    return button;
  };
  const total = () => renderToStaticMarkup(tree()).match(/Total included uses: (\d+)/)?.[1];
  return { tree, fields, add, total };
}

test("new package has create-only layout and mounted description in closed advanced settings", () => {
  const html = render();
  assert.match(html, /package-create-form/);
  assert.match(html, /Price in RM/);
  const advanced = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.ok(advanced);
  assert.doesNotMatch(advanced.split(">")[0], /\bopen\b/);
  assert.match(advanced, /<summary>Advanced settings<\/summary>/);
  assert.match(advanced, /<textarea[^>]*name="description"/);
  assert.doesNotMatch(advanced, /disabled/);
  assert.match(html, /package-create-actions/);
});

test("empty service does not count or allow another empty row; selected rows sum and retain payload names", () => {
  const h = harness();
  assert.equal(h.fields("benefitServiceId").length, 1);
  assert.equal(h.total(), "0");
  assert.equal(h.add().props.disabled, true);
  h.add().props.onClick();
  assert.equal(h.fields("benefitServiceId").length, 1);
  assert.match(renderToStaticMarkup(h.tree()), /Select a service before adding another\./);
  assert.equal(nodes(h.tree()).filter(n => n.props?.["aria-label"]?.startsWith("Remove")).length, 0);
  h.fields("benefitServiceId")[0].props.onChange("a");
  h.fields("benefitTotalUses")[0].props.onChange({ target: { value: "5" } });
  assert.equal(h.total(), "5");
  assert.equal(h.add().props.disabled, false);
  h.add().props.onClick();
  assert.equal(h.fields("benefitServiceId").length, 2);
  assert.equal(h.total(), "5");
  h.fields("benefitServiceId")[1].props.onChange("b");
  h.fields("benefitTotalUses")[1].props.onChange({ target: { value: "2" } });
  assert.equal(h.total(), "7");
  assert.deepEqual(h.fields("benefitServiceId").map(n => n.props.value), ["a", "b"]);
  assert.deepEqual(h.fields("benefitTotalUses").map(n => n.props.value), ["5", "2"]);
  const removes = nodes(h.tree()).filter(n => n.props?.["aria-label"]?.startsWith("Remove"));
  assert.equal(removes.length, 2);
  removes[0].props.onClick();
  assert.equal(h.total(), "2");
  assert.equal(h.fields("benefitServiceId")[0].props.value, "b");
  assert.equal(nodes(h.tree()).filter(n => n.props?.["aria-label"]?.startsWith("Remove")).length, 0);
});

test("unknown service ID is not a valid selected service for the new summary", () => {
  const h = harness([{ serviceId: "unknown", totalUses: 8 }]);
  assert.equal(h.total(), "0");
  assert.equal(h.add().props.disabled, true);
});

test("new service rows use shared headings while preserving accessible field names and validation", () => {
  const html = render();
  assert.match(html, /Included uses/);
  assert.doesNotMatch(html, /<span>Service 1<\/span>/);
  assert.match(html, /Choose the services included in this package and how many times each can be redeemed\./);
  const h = harness();
  const uses = h.fields("benefitTotalUses")[0];
  assert.equal(uses.props.min, "1");
  assert.equal(uses.props.max, "999");
  assert.equal(uses.props.required, true);
  assert.equal(h.fields("benefitServiceId")[0].props.required, true);
});

test("edit retains description and saved values; AUTO retains its original wash fields", () => {
  const packagePlan = { id: "p", branchId: "branch", categoryId: "c", name: "Saved", price: 100, totalUses: 10, description: "Saved notes", status: "ACTIVE", serviceId: "a" };
  const html = render({ packagePlan, serviceBenefits: [{ serviceId: "a", totalUses: 5 }] });
  assert.doesNotMatch(html, /package-create-form|<details/);
  assert.match(html, /<textarea[^>]*name="description"[^>]*>Saved notes<\/textarea>/);
  assert.match(html, /name="packageId" value="p"/);
  assert.match(html, /name="price"[^>]*value="100.00"/);
  assert.match(html, /name="benefitTotalUses"[^>]*value="5"/);
  for (const plan of [undefined, packagePlan]) {
    const auto = render({ isSalonBusiness: false, packagePlan: plan });
    assert.match(auto, /Total washes/);
    assert.match(auto, /Linked service optional/);
    assert.match(auto, /name="totalUses"[^>]*value="10"/);
    assert.doesNotMatch(auto, /name="benefitServiceId"/);
  }
});
