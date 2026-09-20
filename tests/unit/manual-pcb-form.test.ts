import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualPcbFields } from "../../src/components/manual-pcb-fields";
test("manual PCB form never pre-fills zero and requires evidence, explicit confirmation and MFA", () => {
  const html = renderToStaticMarkup(createElement(ManualPcbFields));
  assert.match(html, /name="amount"/);
  assert.doesNotMatch(html, /value="0(?:\.00)?"/);
  assert.match(html, /name="externalReference"/);
  assert.match(html, /name="confirmed"/);
  assert.match(html, /name="stepUpPassword"/);
  assert.match(html, /including zero/);
});
test("historical correction form explains immutable history and unpaid delta, requires reason and MFA", () => {
  const html = renderToStaticMarkup(createElement(ManualPcbFields, { historical: true }));
  assert.match(html, /name="reason"/);
  assert.match(html, /original payslip remains unchanged/i);
  assert.match(html, /not proof of payment/i);
  assert.match(html, /name="stepUpPassword"/);
  assert.doesNotMatch(html, /value="0(?:\.00)?"/);
});
