import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendanceOutletForm, AttendanceOutletProvider } from "../../src/components/attendance-outlet-form";

test("current single form carries a topology marker without replacing submitted branch/document IDs", () => {
  const props = { branchId: "a", children:
    createElement(AttendanceOutletForm, {}, createElement("input", { name: "branchId", type: "hidden", value: "a" }), createElement("input", { name: "assignmentId", type: "hidden", value: "record-b" })) };
  const html = renderToStaticMarkup(createElement(AttendanceOutletProvider, props));
  assert.match(html, /name="attendanceOutletMode"[^>]*value="single_outlet"/);
  assert.match(html, /name="attendanceOutletBranchId"[^>]*value="a"/);
  assert.match(html, /name="assignmentId"[^>]*value="record-b"/);
  assert.equal((html.match(/name="branchId"/g) ?? []).length, 1);
});
test("legacy forms carry no simplified marker; Business-wide template editing can retain original null scope", () => {
  const legacy = renderToStaticMarkup(createElement(AttendanceOutletForm, {}, "Legacy"));
  assert.doesNotMatch(legacy, /attendanceOutletMode/);
  const props = { branchId: "a", children:
    createElement(AttendanceOutletForm, { currentOutletGuard: false }, createElement("input", { name: "branchId", type: "hidden", value: "" })) };
  const businessWide = renderToStaticMarkup(createElement(AttendanceOutletProvider, props));
  assert.doesNotMatch(businessWide, /attendanceOutletMode/);
  assert.match(businessWide, /name="branchId"[^>]*value=""/);
});
