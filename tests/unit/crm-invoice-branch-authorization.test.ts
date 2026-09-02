import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  authorizedCustomerPackageBranchWhere,
  authorizedOperationalBranchWhere,
  canAccessOperationalBranch,
  DENIED_OPERATIONAL_BRANCH_ID,
} from "../../src/lib/branches";

const branchA = "10000000-0000-4000-8000-000000000001";
const branchB = "20000000-0000-4000-8000-000000000002";
const owner = { branchId: null, role: "BUSINESS_OWNER" as const };
const branchStaff = { branchId: branchA, role: "STAFF" as const };

test("Model C keeps owner operational access business-wide and staff access branch-bound", () => {
  assert.deepEqual(authorizedOperationalBranchWhere(owner), {});
  assert.deepEqual(authorizedOperationalBranchWhere(branchStaff), {
    branchId: branchA,
  });
  assert.deepEqual(
    authorizedOperationalBranchWhere({ branchId: null, role: "STAFF" }),
    { branchId: DENIED_OPERATIONAL_BRANCH_ID },
  );
  assert.equal(canAccessOperationalBranch(branchStaff, branchA), true);
  assert.equal(canAccessOperationalBranch(branchStaff, branchB), false);
  assert.equal(canAccessOperationalBranch(branchStaff, null), false);
  assert.equal(canAccessOperationalBranch(owner, branchB), true);
});

test("ALL_BRANCHES never widens operational CRM authority", () => {
  const manager = {
    branchId: branchA,
    permissions: ["ALL_BRANCHES"],
    role: "STAFF" as const,
  };

  assert.deepEqual(authorizedOperationalBranchWhere(manager), {
    branchId: branchA,
  });
  assert.equal(canAccessOperationalBranch(manager, branchB), false);
});

test("branch packages are scoped while null-branch packages remain business-wide", () => {
  assert.deepEqual(authorizedCustomerPackageBranchWhere(owner), {});
  assert.deepEqual(authorizedCustomerPackageBranchWhere(branchStaff), {
    OR: [{ branchId: null }, { branchId: branchA }],
  });
});

test("critical CRM and Invoice surfaces apply server-side branch filters", () => {
  const customerDetail = source("src/app/(business)/crm/customers/[customerId]/page.tsx");
  const vehicleDetail = source("src/app/(business)/crm/vehicles/[vehicleId]/page.tsx");
  const invoiceList = source("src/app/(business)/invoices/page.tsx");
  const invoiceDetail = source("src/app/(business)/invoices/[invoiceId]/page.tsx");
  const invoicePdf = source("src/app/(business)/invoices/[invoiceId]/pdf/route.ts");
  const creditNotePdf = source(
    "src/app/(business)/invoices/[invoiceId]/credit-notes/[creditNoteId]/pdf/route.ts",
  );

  assert.match(customerDetail, /appointments:\s*\{\s*where: operationalBranchWhere/);
  assert.match(customerDetail, /invoices:\s*\{\s*where: operationalBranchWhere/);
  assert.match(customerDetail, /workOrders:\s*\{\s*where: operationalBranchWhere/);
  assert.match(customerDetail, /customerPackages:\s*\{\s*where: packageBranchWhere/);
  assert.match(vehicleDetail, /workOrders:\s*\{\s*where: operationalBranchWhere/);
  assert.match(invoiceList, /businessId,\s*\.\.\.operationalBranchWhere/);
  assert.match(invoiceDetail, /businessId,\s*\.\.\.operationalBranchWhere/);
  assert.match(invoicePdf, /id: invoiceId,\s*\.\.\.operationalBranchWhere/);
  assert.match(creditNotePdf, /invoice:\s*\{\s*is:\s*\{[\s\S]*\.\.\.operationalBranchWhere/);
});

test("business-wide Customer and Vehicle uniqueness contracts remain unchanged", () => {
  const schema = source("prisma/schema.prisma");
  const customerModel = model(schema, "Customer");
  const vehicleModel = model(schema, "Vehicle");

  assert.match(customerModel, /@@unique\(\[businessId, phone\]\)/);
  assert.match(vehicleModel, /@@unique\(\[businessId, plateNumber\]\)/);
});

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function model(schema: string, name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `${name} model must exist`);
  return match[0];
}
