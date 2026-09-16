import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { directoryFixture, renderDirectory } from "../helpers/people-directory-render";

test("People renders employee-only workbench columns and separate readiness semantics",()=>{
  const html=renderDirectory(directoryFixture());
  for(const text of ["Employee","Position","Branch","Employment","Attendance","Payroll readiness","Terminated / resigned","Suspended","Action required","Setup incomplete","Test"]) assert.ok(html.includes(text),text);
  assert.equal((html.match(/scope="row"/g)||[]).length,7);
  assert.ok(!html.includes("Backoffice / service accounts"));
});
test("summary counts are server supplied and filters preserve safe context",()=>{
  const p=directoryFixture();p.context={q:"EMP-001",filter:"attention",branch:p.branches[0].id,month:"2026-09",position:"Stylist",testAccounts:"show"};
  const html=renderDirectory(p);
  for(const name of ["section","q","filter","branch","month","position","testAccounts"]) assert.ok(html.includes(`name="${name}"`));
  assert.ok(html.includes('aria-current="page">Needs attention'));
  assert.ok(html.includes("What is checked?"));
});
test("explicit test-account control hides by default and never infers names",()=>{
  const html=renderDirectory(directoryFixture());
  assert.ok(html.includes("Hide test accounts"));assert.ok(html.includes("marked as test hidden by default"));
  const source=readFileSync("src/lib/team/people-directory-read.ts","utf8");
  assert.ok(source.includes("isTestAccount"));assert.doesNotMatch(source,/fullName.*test|employeeCode.*uat/i);
});
test("empty, restricted and unavailable states are explicit",()=>{
  const empty=directoryFixture(0);empty.data.summary={all:0,ready:0,attention:0,inactive:0};empty.data.pagination.total=0;
  assert.ok(renderDirectory(empty).includes("No employee records in this scope"));
  const restricted=directoryFixture(1);restricted.data.permissions={canAttendance:false,canPayroll:false,canEditProfile:false};restricted.data.readinessStatus="NO_ACCESS";
  const restrictedHtml=renderDirectory(restricted);assert.ok(restrictedHtml.includes("Restricted"));assert.ok(restrictedHtml.includes("restricted by your role"));
  restricted.data.readinessStatus="UNKNOWN";assert.ok(renderDirectory(restricted).includes("temporarily unavailable"));
});
test("pagination is bounded and preserves URL state",()=>{
  const p=directoryFixture(25);p.data.pagination={page:2,pageCount:4,totalPages:4,pageSize:25,total:92};p.context={page:"2",month:"2026-09",filter:"attention"};
  const html=renderDirectory(p);assert.ok(html.includes("Showing 26–50 of 92"));assert.ok(html.includes("Page 2 of 4"));assert.ok(html.includes("page=3"));
});
test("desktop table becomes compact cards without client-only event handlers",()=>{
  const css=readFileSync("src/components/people-directory.module.css","utf8");
  assert.ok(css.includes("@media(max-width:980px)"));assert.ok(css.includes("@media(max-width:700px)"));assert.ok(css.includes(":focus-visible"));
  const source=readFileSync("src/components/people-directory.tsx","utf8");assert.ok(!source.includes("onClick"));assert.ok(!source.includes('"use client"'));assert.ok(source.includes("More filters"));
});
