import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCrmUi, crmFixture } from "../helpers/crm-ui-fixture";

let directory: string;
let Page: any;
before(async () => { directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/crm-layout-")); const file = join(directory, "page.cjs"); await buildCrmUi(file); Page = createRequire(import.meta.url)(file).default; });
after(async () => { delete (globalThis as any).__crmFixture; if (directory) await rm(directory, { recursive: true, force: true }); });
async function render(params = {}, enabled = true, role = "BUSINESS_OWNER") {
  const fixture = crmFixture(enabled, role);
  (globalThis as any).__crmFixture = fixture;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  return { html, fixture };
}
test("Wallet ON adds the first header metric; OFF removes wallet presentation and management entry", async () => {
  const { html } = await render();
  const metrics = html.match(/class="crm-summary-metrics[^" ]*[^"]*"[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.match(metrics, />Wallet</);
  const labels = [">Wallet<", "Loyalty points", "Available packages", "Total spent", "Last visit"];
  for (let i = 1; i < labels.length; i++) assert.ok(metrics.indexOf(labels[i - 1]) < metrics.indexOf(labels[i]));
  assert.doesNotMatch(metrics, /RM 0\.00/); // Loading must not manufacture a successful zero balance.
  const off = (await render({}, false)).html;
  assert.doesNotMatch(off, /aria-label="Member wallet"|>Wallet<|href="\/crm\/wallet\/offers"/);
});
test("the full wallet card appears only in Overview", async () => {
  assert.match((await render()).html, /aria-label="Member wallet"/);
  for (const tab of ["appointments", "invoices", "packages", "notes"]) {
    const { html } = await render({ tab });
    assert.doesNotMatch(html, /aria-label="Member wallet"/);
    assert.match(html, />Wallet</);
    assert.match(html, new RegExp(`tab=${tab}`));
  }
});
test("Wallet offers is an Owner header action beside New customer, respecting module OFF", async () => {
  const html = (await render()).html;
  assert.match(html, /class="crm-header-actions"[\s\S]*href="\/crm\/wallet\/offers"[\s\S]*Wallet offers[\s\S]*New customer/);
  assert.doesNotMatch((await render({}, true, "STAFF")).html, /href="\/crm\/wallet\/offers"/);
});
test("customer selection and all tabs preserve selected customer and existing saved data", async () => {
  const { html } = await render({ customer: "customer-b", tab: "notes", q: "Second", sort: "name" });
  assert.match(html, /<h2>Second customer<\/h2>/);
  assert.match(html, /Saved customer notes/);
  for (const tab of ["appointments", "invoices", "packages", "notes"]) assert.match(html, new RegExp(`customer=customer-b[^" ]*tab=${tab}`));
  assert.match(html, /customer=customer-a/);
  assert.match(html, /90/); assert.match(html, /2 packages/); assert.match(html, /0123456789/);
});
test("Sort by labels the three original sorting choices and leaves their query order unchanged", async () => {
  const cases = [ ["recent", [{ updatedAt: "desc" }, { createdAt: "desc" }]], ["birthday", [{ dateOfBirth: { sort: "asc", nulls: "last" } }, { name: "asc" }]], ["name", [{ name: "asc" }, { createdAt: "desc" }]] ] as const;
  for (const [sort, expected] of cases) {
    const { html, fixture } = await render({ sort });
    assert.match(html, /Sort by/);
    for (const name of ["Recently", "Birthday", "Name"]) assert.match(html, new RegExp(`>${name}</`));
    assert.deepEqual((fixture.queries[0] as any).orderBy, expected);
    assert.doesNotMatch(html, /Upcoming birthday|birthday filter/i);
  }
});
