import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceForm } from "../../src/components/service-form";
import { PackageBuilder } from "../../src/components/package-builder";

const branches = [{ id: "current", name: "Store A" }, { id: "second", name: "Store B" }];
const action = async () => {};
for (const component of [ServiceForm, PackageBuilder]) {
  const render = (outlet: {kind:string;internalBranchId?:string}, edit = false) => renderToStaticMarkup(createElement(component as unknown as (props: Record<string, unknown>) => ReturnType<typeof ServiceForm>, {
    action, services: [], branches, outlet,
    ...(edit ? component === ServiceForm ? { service: { id: "historical", branchId: null, price: 10 } } : { packagePlan: { id: "historical", branchId: null, price: "10" } } : {}),
  }));
  test(`${component.name}: single create hides branch choice but carries current branch`, () => {
    const html = render({kind:"single_outlet",internalBranchId:"current"});
    assert.doesNotMatch(html, /<select[^>]*name="branchId"|Select branch|Store A|Store B/);
    assert.match(html, /name="branchId" value="current"/);
  });
  test(`${component.name}: single edit omits branch field to preserve server-read assignment`, () => {
    assert.doesNotMatch(render({kind:"single_outlet",internalBranchId:"current"},true), /name="branchId"/);
  });
  test(`${component.name}: legacy multi retains branch selector`, () => {
    assert.match(render({kind:"legacy_multi_branch"}), /<select[^>]*name="branchId"/);
  });
  test(`${component.name}: zero location create does not render a form`, () => {
    const html = render({kind:"no_location"});
    assert.match(html,/This business does not have an operating location set up yet/);
    assert.doesNotMatch(html,/<form/);
  });
}
