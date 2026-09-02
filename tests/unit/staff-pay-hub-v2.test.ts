import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("Pay Hub V2 uses the shared Staff V2 gateway structure", async () => {
  const [page, hub] = await Promise.all([
    read("src/app/staff/pay/page.tsx"),
    read("src/components/staff-pwa/staff-pay-hub-v2.tsx"),
  ]);

  assert.match(page, /<StaffPayHubV2/);
  assert.match(hub, /StaffV2PageHeader/);
  assert.match(hub, /StaffV2CompactSummary/);
  assert.match(hub, /StaffV2ListRow/);
  assert.match(hub, /StaffV2ActionRow/);
  assert.match(hub, /StaffV2StatusBadge/);
  assert.match(hub, /StaffV2EmptyState/);
  assert.doesNotMatch(hub, /StaffV2HeroStatus|staff-pay-summary|staff-hub-card/);
  assert.match(hub, /title="Pay"/);
  assert.match(hub, /Your published pay records and earnings\./);
});

test("published Pay Hub shows current period, Available, Net first, Gross second and PDF download", async () => {
  const hub = await read("src/components/staff-pwa/staff-pay-hub-v2.tsx");
  const netIndex = hub.indexOf("Net pay");
  const grossIndex = hub.indexOf("Gross pay");

  assert.match(hub, />Current pay</);
  assert.match(hub, />Available</);
  assert.ok(netIndex >= 0 && grossIndex > netIndex);
  assert.match(hub, /formatMoney\(latestPayslip\.netPay\)/);
  assert.match(hub, /formatMoney\(latestPayslip\.grossPay\)/);
  assert.match(hub, /title="Download PDF"/);
  assert.match(hub, /Download \$\{period\} payslip PDF/);
  assert.match(hub, /href={`\/staff\/payslips\/\$\{latestPayslip\.id\}`}/);
  assert.doesNotMatch(hub, /View payslip|HTML payslip|details/);
});

test("Pay Hub never infers deductions, claims, payment settlement or live payroll state", async () => {
  const [page, hub] = await Promise.all([
    read("src/app/staff/pay/page.tsx"),
    read("src/components/staff-pwa/staff-pay-hub-v2.tsx"),
  ]);
  const source = `${page}\n${hub}`;

  assert.doesNotMatch(source, /Deductions/i);
  assert.doesNotMatch(source, /grossPay\)[\s\S]{0,120}-\s*Number\([^)]*netPay/);
  assert.doesNotMatch(source, /Claim|reimbursement/i);
  assert.doesNotMatch(hub, /Salary paid|Transferred|Payment processing|compensation|Attendance/i);
  assert.doesNotMatch(hub, /\bPaid\b/);
  assert.doesNotMatch(page, /claim|compensation|payroll\/service|attendance\/punch/i);
});

test("Pay Hub module visibility keeps Commission and Payslips as separate destinations", async () => {
  const [page, hub] = await Promise.all([
    read("src/app/staff/pay/page.tsx"),
    read("src/components/staff-pwa/staff-pay-hub-v2.tsx"),
  ]);

  assert.match(page, /const payrollEnabled = enabledModules\.has\("PAYROLL"\)/);
  assert.match(page, /const commissionEnabled = enabledModules\.has\("COMMISSION"\)/);
  assert.match(page, /!payrollEnabled && !commissionEnabled/);
  assert.match(page, /const payslips = payrollEnabled/);
  assert.match(hub, /commissionEnabled \? \(/);
  assert.match(hub, /href="\/staff\/commission"/);
  assert.match(hub, /meta="View statements"/);
  assert.match(hub, /href="\/staff\/payslips"/);
  assert.match(hub, /meta="View all published payslips"/);
  assert.doesNotMatch(hub, /finalCommissionCents|commission amount/i);
});

test("Pay Hub no-publication state is compact and makes no processing inference", async () => {
  const hub = await read("src/components/staff-pwa/staff-pay-hub-v2.tsx");

  assert.match(hub, /title="Payslip not available yet\."/);
  assert.match(hub, /Your payslip will appear here when your employer makes it available\./);
  assert.doesNotMatch(hub, /Preparing|Payroll not run|Finalizing|Payment pending/);
  assert.match(hub, /commissionEnabled \? \(/);
});

test("Pay Hub loading and error states are compact, stable and employee-safe", async () => {
  const [loading, error, css] = await Promise.all([
    read("src/app/staff/pay/loading.tsx"),
    read("src/app/staff/pay/error.tsx"),
    read("src/components/staff-pwa/staff-pay-hub-v2.module.css"),
  ]);

  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /StaffV2PageHeader/);
  assert.match(loading, /loadingPanel/);
  assert.doesNotMatch(loading, /Hero/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Pay couldn&apos;t load\./);
  assert.match(error, />Try again\.</);
  assert.doesNotMatch(error, /Prisma|PayrollRun|publication ID|statutory|payment batch/i);
  assert.match(css, /prefers-reduced-motion/);
});

test("Pay Hub mobile CSS protects large amounts and horizontal layout", async () => {
  const css = await read("src/components/staff-pwa/staff-pay-hub-v2.module.css");

  assert.match(css, /min-width:\s*0/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.doesNotMatch(css, /width:\s*[4-9][0-9]{2}px/);
});

test("Pay Hub preserves the existing published reader and does not add a backend read model", async () => {
  const page = await read("src/app/staff/pay/page.tsx");

  assert.match(page, /getEmployeeSelfServiceAuthContext/);
  assert.match(page, /loadBusinessModuleContext/);
  assert.match(page, /loadPublishedPayslipsForEmployee/);
  assert.match(page, /businessId: auth\.businessId/);
  assert.match(page, /membershipId: auth\.membershipId/);
  assert.doesNotMatch(page, /prisma\.|fetch\(|\/api\//);
});
