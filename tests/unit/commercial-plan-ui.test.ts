import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { formatCents } from "../../src/lib/commercial/money";

function renderCommercial(commercial: object = {}, subscriptionInvoices: object[] = []) {
  const source = readFileSync("src/app/(business)/business/settings/page.tsx", "utf8");
  const start = source.indexOf('<div className="company-settings-sheet company-settings-secondary-section" id="subscription">');
  const end = source.indexOf('{business.industryType === "AUTO_DETAILING"', start);
  const { code } = transformSync(`function View(){return (${source.slice(start, end).trim()});}`, { loader: "tsx", jsx: "transform" });
  const element = new Function("React", "commercial", "subscriptionInvoices", "formatCents", `${code};return View();`)(React, commercial, subscriptionInvoices, formatCents);
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  return new JSDOM(renderToStaticMarkup(element));
}

test("legacy card preserves access and unavailable pricing without implying an error or free plan", () => {
  const dom = renderCommercial();
  try {
    const section = dom.window.document.querySelector('#subscription');
    assert.equal(section.querySelector('.commercial-plan-card strong')?.textContent, "Existing plan");
    assert.equal(section.querySelector('.commercial-legacy-badge')?.textContent, "Legacy");
    assert.match(section.textContent, /Product access is preserved\./);
    assert.match(section.textContent, /Pricing details are not available for this legacy subscription\./);
    assert.equal(section.querySelector('[role="alert"], .warning, .error'), null);
    assert.doesNotMatch(section.textContent, /RM0|commercial review required/);
  } finally { dom.window.close(); }
});

test("billing empty state does not fabricate invoices or payment actions", () => {
  const dom = renderCommercial();
  try {
    const section = dom.window.document.querySelector('#subscription');
    assert.match(section.textContent, /No billing records yet/);
    assert.match(section.textContent, /Subscription invoices will appear here when available\./);
    assert.equal(section.querySelector('table, button, input, form, a'), null);
  } finally { dom.window.close(); }
});

test("populated plan and invoices retain active item filtering, amounts, status and row order", () => {
  const commercial = {
    subscription: { items: [
      { status: "ACTIVE", planVersion: { plan: { displayName: "Business Plus" } } },
      { status: "CANCELLED", planVersion: { plan: { displayName: "Old plan" } } },
    ], renewalDate: new Date("2026-11-01T00:00:00Z") },
    allowances: { branches: 2, employees: 10, businessAi: 50 },
    price: { effectiveRecurringPriceCents: 12345 },
  };
  const common = { billingPeriodStart: new Date("2026-10-01T00:00:00Z"), billingPeriodEnd: new Date("2026-10-31T00:00:00Z") };
  const dom = renderCommercial(commercial, [
    { ...common, id: "one", invoiceNumber: "SUB-001", status: "ISSUED", canonicalPaymentStatus: "PARTIALLY_PAID", totalAmountCents: 12345, canonicalOutstandingCents: 2345 },
    { ...common, id: "two", invoiceNumber: "SUB-002", status: "VOID", canonicalPaymentStatus: "UNPAID", totalAmountCents: 5000, canonicalOutstandingCents: 0 },
  ]);
  try {
    const section = dom.window.document.querySelector('#subscription');
    assert.match(section.textContent, /Business Plus/);
    assert.doesNotMatch(section.textContent, /Old plan|Existing plan|No billing records yet/);
    const rows = [...section.querySelectorAll('tbody tr')].map((row: any) => [...row.querySelectorAll('td')].map((td: any) => td.textContent.replace(/\u00a0/g, " ")));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row: string[]) => [row[0], row[2], row[3], row[4]]), [
      ["SUB-001", "PARTIALLY_PAID", "RM 123.45", "RM 23.45"],
      ["SUB-002", "VOID", "RM 50.00", "RM 0.00"],
    ]);
    assert.equal(section.querySelector('button, input, form, a'), null);
  } finally { dom.window.close(); }
});
