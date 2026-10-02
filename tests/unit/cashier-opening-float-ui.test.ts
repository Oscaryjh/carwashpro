import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement, type ReactElement } from "react";
import { closingMoneySchema } from "../../src/lib/closing/money-validation";

// Execute the actual JSX input in isolation, without mounting the cashier or
// invoking a financial server action. Removing its focus handler must fail.
export function openingFloatInput(): ReactElement<Record<string, unknown>> {
  const source = readFileSync("src/components/cashier-unified-sale-form.tsx", "utf8");
  const file = ts.createSourceFile("cashier.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let input: ts.JsxSelfClosingElement | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "input" &&
      node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) &&
        attribute.name.getText(file) === "name" && attribute.initializer &&
        ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "openingFloat")) input = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(input, "Opening cash float input must exist");
  const code = ts.transpileModule(`return (${input.getText(file)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    fileName: "input.tsx",
  }).outputText;
  return new Function("React", code)({ createElement });
}

test("opening float retains its default and native amount/submit constraints", () => {
  const { props } = openingFloatInput();
  assert.equal(props.defaultValue, "0.00");
  assert.equal(props.type, "number");
  assert.equal(props.name, "openingFloat");
  assert.equal(props.inputMode, "decimal");
  assert.equal(props.min, "0");
  assert.equal(props.step, "0.01");
  assert.equal(props.required, true);
  assert.equal(props.onBlur, undefined);
  assert.equal(props.onKeyDown, undefined);
  assert.equal(props.onChange, undefined);
});

for (const value of ["0.00", "50.00"]) {
  test(`focus selects the entire ${value} without clearing or rewriting it`, () => {
    const { props } = openingFloatInput();
    assert.equal(typeof props.onFocus, "function", "focus must select the current amount");
    let selectedValue: string | undefined;
    const input = { value, select() { selectedValue = this.value; } };
    (props.onFocus as (event: unknown) => void)({ currentTarget: input });
    assert.equal(selectedValue, value);
    assert.equal(input.value, value);
  });
}

test("opening float uses the unchanged closing validation for submitted amounts", () => {
  for (const [value, expected] of [["0.00", 0], ["50.00", 50], ["100", 100], ["100.01", 100.01]] as const) {
    assert.equal(closingMoneySchema.parse(value), expected);
  }
  for (const value of ["", "-1", "1.234", "invalid", "Infinity"]) {
    assert.equal(closingMoneySchema.safeParse(value).success, false);
  }
});
