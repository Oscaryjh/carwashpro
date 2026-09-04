import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adjustmentTypeLabel,
  commissionStatusPresentation,
  employeeSafeAdjustmentReason,
  formatCommissionMoney,
  formatCommissionPeriod,
  formatSignedCommissionMoney,
  sourceTypeLabel,
} from "../../src/lib/staff-pwa/commission-v2";

const read = (path: string) => readFile(path, "utf8");

test("Commission route renders the scoped V2 view from the canonical employee reader", async () => {
  const [page, view] = await Promise.all([
    read("src/app/staff/commission/page.tsx"),
    read("src/components/staff-pwa/staff-commission-v2.tsx"),
  ]);
  assert.match(page, /requireEmployeeModulePage\("COMMISSION"\)/);
  assert.match(page, /getEmployeeCommissionStatements/);
  assert.match(page, /businessId: auth\.businessId/);
  assert.match(page, /membershipId: auth\.membershipId/);
  assert.match(page, /<StaffCommissionV2/);
  for (const primitive of ["StaffV2PageHeader", "StaffV2PeriodNavigator", "StaffV2CompactSummary", "StaffV2RowGroup", "StaffV2StatusBadge", "StaffV2DetailSection", "StaffV2EmptyState"]) {
    assert.match(view, new RegExp(primitive));
  }
  assert.doesNotMatch(view, /StaffV2HeroStatus|staff-page-card|CommissionMegaCard|CommissionDashboard|CommissionStatementCardV2/);
});

test("Commission periods use exact canonical full-month and partial-range labels", () => {
  assert.equal(formatCommissionPeriod(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T00:00:00Z")), "August 2026");
  assert.equal(formatCommissionPeriod(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-15T00:00:00Z")), "01 Aug – 15 Aug 2026");
  assert.equal(formatCommissionPeriod(new Date("2026-12-20T00:00:00Z"), new Date("2027-01-05T00:00:00Z")), "20 Dec 2026 – 05 Jan 2027");
});

test("Commission period navigation selects returned periods only and announces disabled edges", async () => {
  const [page, view, primitives] = await Promise.all([
    read("src/app/staff/commission/page.tsx"),
    read("src/components/staff-pwa/staff-commission-v2.tsx"),
    read("src/components/staff-pwa/staff-v2-primitives.tsx"),
  ]);
  assert.match(page, /statements\.findIndex\(\(statement\) => statement\.period\.id === requestedPeriodId\)/);
  assert.match(page, /Math\.max\(0,/);
  assert.match(view, /statements\[selectedIndex \+ 1\]/);
  assert.match(view, /statements\[selectedIndex - 1\]/);
  assert.match(view, /periodHref\(statements/);
  assert.doesNotMatch(view, /shiftMonth|current month/i);
  assert.match(primitives, /aria-disabled="true"/);
  assert.match(primitives, /periodControlDisabled/);
});

test("Commission reader keeps DB-owned current revision, ownership and earning-period order", async () => {
  const reader = await read("src/lib/commission/read.ts");
  const employeeReader = reader.slice(reader.indexOf("export async function getEmployeeCommissionStatements"));
  assert.match(reader, /statement\."calculation_revision" = period\."current_revision"/);
  assert.match(reader, /statement\."business_id" = CAST\(\$\{input\.businessId\} AS uuid\)/);
  assert.match(reader, /statement\."membership_id" = CAST\(\$\{input\.membershipId\} AS uuid\)/);
  assert.match(employeeReader, /businessId: input\.businessId/);
  assert.match(employeeReader, /membershipId: input\.membershipId/);
  assert.match(employeeReader, /orderBy: \[\{ period: \{ earnedPeriodStart: "desc" \} \}, \{ createdAt: "desc" \}]/);
  assert.match(employeeReader, /period: \{ select: \{ id: true, earnedPeriodStart: true, earnedPeriodEnd: true/);
  assert.doesNotMatch(employeeReader, /originatingAdjustments/);
});

test("Commission total and lifecycle copy are canonical and never imply settlement", async () => {
  const [view, status] = await Promise.all([
    read("src/components/staff-pwa/staff-commission-v2.tsx"),
    read("src/lib/staff-pwa/commission-v2.ts"),
  ]);
  assert.equal(commissionStatusPresentation("CALCULATED").label, "Awaiting review");
  assert.equal(commissionStatusPresentation("APPROVED").label, "Approved");
  assert.equal(commissionStatusPresentation("APPLIED_TO_PAYROLL").label, "Added to payroll");
  assert.match(view, /formatCommissionMoney\(statement\.finalCommissionCents\)/);
  assert.doesNotMatch(view, /eligibleSalesCents\s*\*|reduce\(|commissionAmountCents\)\s*\+/);
  assert.doesNotMatch(`${view}\n${status}`, /\bPaid\b|Commission paid|Transferred|Salary credited|Included in payslip|Estimated · pending review|Approved · frozen|sent to Payroll/);
});

test("Commission money handles large totals and signed adjustments", () => {
  assert.equal(formatCommissionMoney(100), "RM 1.00");
  assert.equal(formatCommissionMoney(123_456), "RM 1,234.56");
  assert.equal(formatCommissionMoney(1_234_567), "RM 12,345.67");
  assert.equal(formatCommissionMoney(12_345_678), "RM 123,456.78");
  assert.equal(formatSignedCommissionMoney(2_000), "+RM 20.00");
  assert.equal(formatSignedCommissionMoney(-1_000), "−RM 10.00");
});

test("Commission breakdown uses employee-safe source types and typed facts only", async () => {
  const [view, reader] = await Promise.all([
    read("src/components/staff-pwa/staff-commission-v2.tsx"),
    read("src/lib/commission/read.ts"),
  ]);
  assert.equal(sourceTypeLabel("SERVICE"), "Service");
  assert.equal(sourceTypeLabel("PRODUCT"), "Product");
  assert.equal(sourceTypeLabel("PACKAGE_PURCHASE"), "Package purchase");
  assert.equal(sourceTypeLabel("PACKAGE_REDEMPTION"), "Package redemption");
  assert.match(view, /role="listitem"/);
  assert.match(view, /<details/);
  for (const fact of ["Gross amount", "Net amount", "Eligible amount"]) assert.match(view, new RegExp(fact));
  for (const fact of ["Item", "Invoice", "Quantity", "Commission rate"]) assert.match(view, new RegExp(`label="${fact}"`));
  assert.match(view, /commissionItemName\(accrual\.sourceEvent\.invoiceItem\?\.name/);
  assert.match(view, /accrual\.calculation\.rateLabel/);
  assert.doesNotMatch(view, /Hair colouring|Hair treatment|Shampoo sale|customer|source event ID|transaction internal ID/i);
  assert.doesNotMatch(view, /ruleSnapshot|calculationTrace|rateBasisPoints|fixedAmountCents|%/);
  const employeeReader = reader.slice(reader.indexOf("export async function getEmployeeCommissionStatements"));
  assert.match(employeeReader, /invoiceItem: \{ select: \{ name: true \} \}/);
  assert.match(employeeReader, /invoice: \{ select: \{ invoiceNumber: true \} \}/);
  assert.match(employeeReader, /calculation: commissionCalculationDetails\(calculationTrace\)/);
  assert.doesNotMatch(employeeReader, /ruleSnapshot|ruleRevision|customer|product:|service:|package:/);
});

test("Commission adjustments hide at zero and use neutral signed canonical values", async () => {
  const view = await read("src/components/staff-pwa/staff-commission-v2.tsx");
  assert.match(view, /statement\.adjustmentCents !== 0/);
  assert.match(view, /statement\.appliedAdjustments\.length/);
  assert.match(view, /formatSignedCommissionMoney\(adjustment\.commissionAmountCents\)/);
  assert.equal(adjustmentTypeLabel("REFUND"), "Refund adjustment");
  assert.equal(adjustmentTypeLabel("VOID"), "Void adjustment");
  assert.equal(adjustmentTypeLabel("MANUAL_CORRECTION"), "Correction");
  assert.equal(employeeSafeAdjustmentReason("REFUND", "Refund 22222222-2222-2222-2222-222222222222"), "A refunded source was adjusted in this statement.");
  assert.equal(employeeSafeAdjustmentReason("MANUAL_CORRECTION", "Long reviewed correction reason"), "Long reviewed correction reason");
  assert.doesNotMatch(view, /adjustment.*success|adjustment.*danger|positive.*green|negative.*error/i);
});

test("Commission empty, no-lines, loading and error states preserve trusted amounts", async () => {
  const [view, loading, error] = await Promise.all([
    read("src/components/staff-pwa/staff-commission-v2.tsx"),
    read("src/app/staff/commission/loading.tsx"),
    read("src/app/staff/commission/error.tsx"),
  ]);
  assert.match(view, /No commission statement yet\./);
  assert.match(view, /Your commission statements will appear here when available\./);
  assert.doesNotMatch(view, /No commission earned/);
  assert.match(view, /No commission lines for this period\./);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /StaffV2PageHeader/);
  assert.match(loading, /StaffV2PeriodNavigator/);
  assert.match(loading, /\[0, 1, 2\]\.map/);
  assert.doesNotMatch(loading, /Hero/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Commission couldn&apos;t load\./);
  assert.match(error, /No amount has been changed\./);
  assert.match(error, />Try again</);
  assert.doesNotMatch(error, /Prisma|ruleSnapshot|revision|calculation engine|source ID|Payroll internals/i);
});

test("Commission mobile CSS supports 360/390/412, wrapping, details and bottom-nav clearance", async () => {
  const [css, shared] = await Promise.all([
    read("src/components/staff-pwa/staff-commission-v2.module.css"),
    read("src/components/staff-pwa/staff-v2.module.css"),
  ]);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /white-space:\s*nowrap|width:\s*[4-9][0-9]{2}px/);
  assert.match(shared, /--staff-v2-shell-bottom-clearance:\s*calc\(84px \+ var\(--staff-v2-safe-bottom\)\)/);
});

test("Pay Hub, Payslips, claim gap and bottom navigation remain unchanged", async () => {
  const [hub, payslips, navigation, correctnessTests] = await Promise.all([
    read("src/components/staff-pwa/staff-pay-hub-v2.tsx"),
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
    read("src/lib/staff-pwa/navigation.ts"),
    read("tests/unit/staff-pay-read-only-correctness.test.ts"),
  ]);
  assert.match(hub, /href="\/staff\/commission"/);
  assert.match(hub, /meta="View statements"/);
  assert.doesNotMatch(hub, /finalCommissionCents|commission amount/i);
  assert.match(payslips, /Net pay/);
  assert.match(payslips, /Download \$\{period\} payslip PDF/);
  assert.doesNotMatch(payslips, /Deductions|\bPaid\b/);
  assert.match(correctnessTests, /Claim Payroll settlement currently has no canonical closing writer/);
  for (const label of ["Home", "Time", "Approvals", "Pay", "Profile"]) assert.match(navigation, new RegExp(`label: "${label}"`));
});
