import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PosOutletBranchField, PosLocationGuidance } from "../../src/components/pos-outlet-presentation";

test("single mode keeps branch FormData without exposing location controls", () => {
  const html = renderToStaticMarkup(createElement(PosOutletBranchField, { singleOutlet: true, branchId: "A", branches: [{ id: "A", name: "Store A" }] }));
  assert.match(html, /type="hidden"[^>]*name="branchId"|name="branchId"[^>]*type="hidden"/);
  assert.match(html, /value="A"/); assert.doesNotMatch(html, /<select|Store A|Branch/);
});
test("legacy mode keeps selection and selected branch", () => {
  const html = renderToStaticMarkup(createElement(PosOutletBranchField, { singleOutlet: false, branchId: "B", branches: [{ id: "A", name: "Store A" }, { id: "B", name: "Store B" }] }));
  assert.match(html, /<select[^>]*name="branchId"/); assert.match(html, /value="B" selected/);
});
test("zero-location guidance offers no writer and distinguishes Owner setup from Staff help", () => {
  for (const owner of [true, false]) {
    const html = renderToStaticMarkup(createElement(PosLocationGuidance, { owner }));
    assert.match(html, /does not have an operating location/); assert.match(html, owner ? /Platform Admin/ : /business owner/);
    assert.doesNotMatch(html, /<form|<button|Branch/);
  }
});
