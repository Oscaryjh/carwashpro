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
let Categories: (props: Record<string, unknown>) => ReactElement;
let Service: (props: Record<string, unknown>) => ReactElement;
let Table: (props: Record<string, unknown>) => ReactElement;
const hookKey = "__serviceCategoryHooks";
const base = { categories: [], closePath: "/services", title: "Service categories", itemLabel: "service", description: "Group services.", placeholder: "New category name", createAction: async () => {}, updateAction: async () => {}, deleteAction: async () => {}, variant: "service" };
before(async () => {
  directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/service-category-ui-"));
  for (const [name, file] of [["categories", "catalog-categories-modal"], ["service", "service-form"]]) {
    await build({ entryPoints: [`src/components/${file}.tsx`], outfile: join(directory, `${name}.cjs`), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "router-boundary", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export function useRouter(){return {replace(){}}}" }));
      b.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,name)=>name})", loader: "js" }));
    } }] });
  }
  Categories = require(join(directory, "categories.cjs")).CatalogCategoriesModal;
  Service = require(join(directory, "service.cjs")).ServiceForm;
  await build({ entryPoints: ["src/components/service-categories-table.tsx"], outfile: join(directory, "events.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "state-boundary", setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
    b.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents: `export const Fragment=Symbol.for('react.fragment'); export function useState(initial){const h=globalThis.${hookKey};const i=h.index++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]}` }));
    b.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default {}", loader: "js" }));
  } }] });
  Table = require(join(directory, "events.cjs")).ServiceCategoriesTable;
});

test("row Edit opens only the selected inline form; Cancel restores read-only data and status action keeps payload", () => {
  type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown; onClick?: () => void } };
  const nodes = (value: unknown): Node[] => {
    if (!value || typeof value !== "object") return [];
    const node = value as Node;
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  };
  const state = { index: 0, values: [] as unknown[] };
  Object.assign(globalThis, { [hookKey]: state });
  const tree = () => { state.index = 0; return Table({ ...base, categories: [{ id: "c", name: "Saved name", status: "ACTIVE", itemCount: 1 }] }); };
  assert.equal(nodes(tree()).filter(n => n.type === "input" && n.props.defaultValue === "Saved name").length, 0);
  nodes(tree()).find(n => n.type === "button" && n.props.children === "Edit")!.props.onClick!();
  assert.equal(nodes(tree()).filter(n => n.type === "input" && n.props.defaultValue === "Saved name").length, 1);
  assert.ok(nodes(tree()).some(n => n.type === "select" && n.props.defaultValue === "ACTIVE"));
  nodes(tree()).find(n => n.type === "button" && n.props.children === "Cancel")!.props.onClick!();
  assert.equal(nodes(tree()).filter(n => n.type === "select").length, 0);
  assert.ok(nodes(tree()).some(n => n.type === "input" && n.props.name === "status" && n.props.value === "INACTIVE"));
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Categories, { ...base, ...props }));

test("service categories render a compact read-only table, not permanently editable rows", () => {
  const html = render({ categories: [{ id: "used", name: "Hair", status: "ACTIVE", itemCount: 12 }, { id: "empty", name: "Custom", status: "INACTIVE", itemCount: 0 }] });
  assert.match(html, /<table/);
  for (const heading of ["Name", "Services", "Status", "Action"]) assert.match(html, new RegExp(`<th[^>]*>${heading}</th>`));
  assert.doesNotMatch(html, /catalog-category-number|<select/);
  assert.match(html, /Edit/);
  assert.match(html, /Deactivate/);
  assert.match(html, /Activate/);
  assert.match(html, /<button[^>]*disabled[^>]*>Delete/);
  assert.match(html, /Reassign services to delete this category, or deactivate it instead/);
});

test("zero service categories show manual setup without suggestions", () => {
  const html = render();
  assert.match(html, /No categories yet\./);
  assert.match(html, /Create a category to organize your services\./);
  assert.match(html, /Add category/);
  assert.doesNotMatch(html, /Suggested|Add all|Hair Services/);
});

test("new service without active categories retains required field and links to existing management", () => {
  const html = renderToStaticMarkup(createElement(Service, { action: async () => {}, categories: [], modalLayout: true, isSalonBusiness: true }));
  assert.match(html, /<select[^>]*name="categoryId"[^>]*required/);
  assert.match(html, /No service categories yet\./);
  assert.match(html, /Create a category before adding a service\./);
  assert.match(html, /href="\/services\?modal=categories"/);
});

test("existing active service categories remove setup helper; other category types keep original UI", () => {
  const html = renderToStaticMarkup(createElement(Service, { action: async () => {}, categories: [{ id: "c", name: "Custom", status: "ACTIVE" }] }));
  assert.doesNotMatch(html, /No service categories yet/);
  assert.match(html, /value="c"/);
  for (const itemLabel of ["product", "package"]) {
    const legacy = render({ variant: undefined, itemLabel, categories: [{ id: "c", name: "Original", status: "ACTIVE", itemCount: 2 }] });
    assert.match(legacy, /catalog-category-number/);
    assert.match(legacy, /<select/);
  }
});
