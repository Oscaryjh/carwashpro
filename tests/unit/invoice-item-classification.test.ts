import assert from "node:assert/strict";
import test from "node:test";

test("explicit identity resolver exists and preserves every persisted kind without guessing legacy references", async () => {
  const contract = await import("../../src/lib/invoice-item/classification");
  for (const kind of ["SERVICE", "PRODUCT", "PACKAGE_PURCHASE", "OTHER"] as const) {
    assert.equal(contract.resolveInvoiceItemKind({ kind }), kind);
  }
  for (const references of [
    { serviceId: "service" }, { productId: "product" },
    { serviceId: "service", customerPackageId: "package" },
    { serviceId: null, productId: null, customerPackageId: null },
  ]) {
    const legacy = { kind: null, ...references };
    assert.equal(contract.resolveInvoiceItemKind(legacy), "UNKNOWN_LEGACY");
  }
  const mixed = [
    { kind: "SERVICE" as const, customerPackageId: null },
    { kind: "PRODUCT" as const, customerPackageId: null },
    { kind: "PACKAGE_PURCHASE" as const, customerPackageId: "second-not-primary" },
    { kind: "SERVICE" as const, customerPackageId: "covered" },
  ];
  assert.deepEqual(mixed.map(contract.resolveInvoiceItemKind), ["SERVICE", "PRODUCT", "PACKAGE_PURCHASE", "SERVICE"]);
});
