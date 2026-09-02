import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("Payslips route renders the scoped Staff V2 archive from the published reader", async () => {
  const [page, view] = await Promise.all([
    read("src/app/staff/payslips/page.tsx"),
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
  ]);

  assert.match(page, /requireEmployeeModulePage\("PAYROLL"\)/);
  assert.match(page, /loadPublishedPayslipsForEmployee/);
  assert.match(page, /businessId: auth\.businessId/);
  assert.match(page, /membershipId: auth\.membershipId/);
  assert.match(page, /<StaffPayslipsV2/);
  assert.match(view, /StaffV2PageHeader/);
  assert.match(view, /StaffV2RowGroup/);
  assert.match(view, /StaffV2SectionLabel/);
  assert.match(view, /StaffV2EmptyState/);
  assert.match(view, /title="Payslips"/);
  assert.match(view, /Your published pay records\./);
  assert.match(view, /Published payslips/);
});

test("Payslips archive uses one grouped compact row and one PDF interaction per publication", async () => {
  const [view, css] = await Promise.all([
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
    read("src/components/staff-pwa/staff-payslips-v2.module.css"),
  ]);

  assert.match(view, /role="listitem"/);
  assert.match(view, /href={`\/staff\/payslips\/\$\{payslip\.id\}`}/);
  assert.match(view, /Download \$\{period\} payslip PDF, net pay \$\{netPay\}/);
  assert.match(view, /<DownloadIcon \/>/);
  assert.equal((view.match(/<a\s/g) ?? []).length, 1);
  assert.doesNotMatch(view, /<button|<Link|View payslip/);
  assert.match(css, /min-height:\s*76px/);
  assert.match(css, /\.row \+ \.row/);
  assert.doesNotMatch(css, /PayslipMegaCard|MonthCard|width:\s*[4-9][0-9]{2}px/);
});

test("Payslips row prioritizes period, canonical Net, published availability and nothing inferred", async () => {
  const [page, view] = await Promise.all([
    read("src/app/staff/payslips/page.tsx"),
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
  ]);
  const source = `${page}\n${view}`;

  assert.match(page, /netPay: payslip\.payrollEntry\.netPay/);
  assert.match(view, /<strong>{period}<\/strong>/);
  assert.match(view, /Available since {formatDate\(payslip\.publishedAt\)}/);
  assert.match(view, />Net pay</);
  assert.match(view, /formatMoney\(payslip\.netPay\)/);
  assert.doesNotMatch(source, /Deductions|Gross pay|grossPay/);
  assert.doesNotMatch(source, /\bPaid\b|Transferred|Payment processing|Banked/);
  assert.doesNotMatch(source, /Claim|reimbursement|Attendance|Commission|compensation/);
  assert.doesNotMatch(source, /details|PayrollRun|run ID|publication ID/);
});

test("Payslips ordering and publication uniqueness stay canonical without month dedupe", async () => {
  const [reader, schema, view] = await Promise.all([
    read("src/lib/payroll/payslip-publication.ts"),
    read("prisma/schema.prisma"),
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
  ]);

  assert.match(reader, /orderBy: \[\{ payrollRun: \{ periodStart: "desc" \} \}, \{ publishedAt: "desc" \}\]/);
  assert.match(reader, /where: \{ businessId: input\.businessId, membershipId: input\.membershipId \}/);
  assert.match(schema, /model PayrollPayslipPublication[\s\S]*payrollEntryId String\s+@unique/);
  assert.match(schema, /@@unique\(\[payrollEntryId, businessId, membershipId\]\)/);
  assert.doesNotMatch(view, /new Map|reduce\(|dedup|period\.slice/);
});

test("Payslips empty, loading and error states are compact and safe", async () => {
  const [view, loading, error, css] = await Promise.all([
    read("src/components/staff-pwa/staff-payslips-v2.tsx"),
    read("src/app/staff/payslips/loading.tsx"),
    read("src/app/staff/payslips/error.tsx"),
    read("src/components/staff-pwa/staff-payslips-v2.module.css"),
  ]);

  assert.match(view, /No payslips available yet\./);
  assert.match(view, /Your published payslips will appear here when they become available\./);
  assert.doesNotMatch(view, /Payroll preparing|No payroll|giant|illustration/i);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /\[0, 1, 2\]\.map/);
  assert.match(loading, /loadingRow/);
  assert.doesNotMatch(loading, /Hero/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Payslips couldn&apos;t load\./);
  assert.match(error, /No stale or unpublished payslip is shown\./);
  assert.match(error, />Try again</);
  assert.doesNotMatch(error, /Prisma|PayrollRun|publication ID|database|statutory|payment status/i);
  assert.match(css, /prefers-reduced-motion/);
});

test("Payslips mobile CSS supports 360/390/412, large money and accessible targets", async () => {
  const css = await read("src/components/staff-pwa/staff-payslips-v2.module.css");

  assert.match(css, /min-width:\s*0/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(104px, auto\) 44px/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
});

test("protected PDF contract and service-worker exclusion remain unchanged", async () => {
  const [route, serviceWorker] = await Promise.all([
    read("src/app/staff/payslips/[publicationId]/route.ts"),
    read("public/sw.js"),
  ]);

  assert.match(route, /getEmployeeSelfServiceAuthContext\(request\)/);
  assert.match(route, /isBusinessModuleEnabled\(auth\.businessId, "PAYROLL"\)/);
  assert.match(route, /businessId: auth\.businessId/);
  assert.match(route, /membershipId: auth\.membershipId/);
  assert.match(route, /publicationId: id\.data/);
  assert.match(route, /Content-Type": "application\/pdf"/);
  assert.match(route, /Content-Disposition": `attachment;/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /replace\(\/\[\^A-Za-z0-9_-\]\+\/g, "-"\)/);
  assert.doesNotMatch(serviceWorker, /staff\/payslips/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/pwa\/"\)/);
});

test("Pay Hub navigation and Staff bottom navigation remain untouched", async () => {
  const [hub, navigation] = await Promise.all([
    read("src/components/staff-pwa/staff-pay-hub-v2.tsx"),
    read("src/lib/staff-pwa/navigation.ts"),
  ]);

  assert.match(hub, /href="\/staff\/payslips"/);
  assert.match(hub, /meta="View all published payslips"/);
  assert.match(hub, />Current pay</);
  assert.match(hub, />Net pay</);
  assert.match(hub, /label: "Gross pay"/);
  assert.match(hub, /title="Download PDF"/);
  assert.match(hub, /href="\/staff\/commission"/);
  assert.doesNotMatch(hub, /Deductions|\bPaid\b/);
  assert.match(navigation, /label: "Home"/);
  assert.match(navigation, /label: "Time"/);
  assert.match(navigation, /label: "Requests"/);
  assert.match(navigation, /label: "Pay"/);
  assert.match(navigation, /label: "Profile"/);
});
