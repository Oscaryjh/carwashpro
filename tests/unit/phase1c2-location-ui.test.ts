import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Phase1c2LocationField } from "../../src/components/phase1c2-location-field";

test("single current operation has no branch selector or client-authoritative branch field", () => {
  const html=renderToStaticMarkup(createElement(Phase1c2LocationField,{mode:"single_outlet",branches:[{id:"A",name:"Outlet"}]}));
  assert.doesNotMatch(html,/<select|name="branchId"/);
});
test("legacy business keeps a branch selector even when actor sees only one branch", () => {
  const html=renderToStaticMarkup(createElement(Phase1c2LocationField,{mode:"legacy_multi_branch",branches:[{id:"A",name:"Outlet"}]}));
  assert.match(html,/<select[^>]*name="branchId"/);assert.match(html,/value="A"/);
});
test("zero location shows guidance without inventing a fallback branch", () => {
  const html=renderToStaticMarkup(createElement(Phase1c2LocationField,{mode:"no_location",branches:[]}));
  assert.match(html,/active authorised outlet/);assert.doesNotMatch(html,/name="branchId"/);
});
