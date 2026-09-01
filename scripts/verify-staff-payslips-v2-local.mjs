import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.STAFF_VISUAL_BASE_URL ?? "http://localhost:3200";
if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(baseUrl)) {
  throw new Error("Payslips V2 local verification is restricted to a loopback URL.");
}

const fixture = JSON.parse(await readFile(
  path.join(process.cwd(), ".tmp", "staff-payslips-v2-visual-fixtures.json"),
  "utf8",
));

const populated = await get("/staff/payslips", fixture.multipleMonths.sessionToken);
assert.equal(populated.status, 200);
const html = await populated.text();
assert.ok(html.indexOf("August 2026") < html.indexOf("July 2026"));
assert.ok(html.indexOf("July 2026") < html.indexOf("June 2026"));
assert.match(html, /RM(?:<!-- -->)?(?:&nbsp;|\u00a0| )?3,245\.60/);
assert.doesNotMatch(html, /Deductions|View payslip|\bPaid\b/);

const ownPdf = await get(
  `/staff/payslips/${fixture.payrollWithoutAttendance.publicationId}`,
  fixture.payrollWithoutAttendance.sessionToken,
);
assert.equal(ownPdf.status, 200);
assert.equal(ownPdf.headers.get("content-type"), "application/pdf");
assert.equal(ownPdf.headers.get("cache-control"), "private, no-store");
assert.match(ownPdf.headers.get("content-disposition") ?? "", /^attachment; filename="[A-Za-z0-9_-]+-\d{4}-\d{2}-payslip\.pdf"$/);

const foreign = await get(
  `/staff/payslips/${fixture.foreignPublication.publicationId}`,
  fixture.foreignPublication.sessionToken,
);
assert.equal(foreign.status, 404);
assert.equal(await foreign.text(), "Payslip not found.");

const switchedEmployer = await get(
  `/staff/payslips/${fixture.multiEmployerA.publicationId}`,
  fixture.multiEmployerB.sessionToken,
);
assert.equal(switchedEmployer.status, 404);

const loggedOut = await get(`/staff/payslips/${fixture.onePublication.publicationId}`);
assert.equal(loggedOut.status, 404);

const payrollDisabled = await get(
  `/staff/payslips/${fixture.onePublication.publicationId}`,
  fixture.payrollDisabled.sessionToken,
);
assert.equal(payrollDisabled.status, 403);

const managerOwn = await get("/staff/payslips", fixture.managerAsEmployee.sessionToken);
assert.equal(managerOwn.status, 200);
const managerHtml = await managerOwn.text();
assert.match(managerHtml, /123,456\.78/);
assert.doesNotMatch(managerHtml, /3,245\.60|3,180\.20|3,220\.00/);

console.log(JSON.stringify({
  environment: "LOCAL ONLY",
  ordering: "PASS",
  ownPdf: "PASS",
  attendanceIndependent: "PASS",
  foreignMembership: "PASS",
  multiEmployerIsolation: "PASS",
  loggedOut: "PASS",
  payrollDisabled: "PASS",
  managerOwnOnly: "PASS",
  productionAccessed: false,
  productionModified: false,
}, null, 2));

function get(pathname, sessionToken) {
  return fetch(`${baseUrl}${pathname}`, {
    headers: sessionToken ? { cookie: `tetamu_employee_session=${sessionToken}` } : undefined,
    redirect: "manual",
  });
}
