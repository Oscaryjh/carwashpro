import assert from "node:assert/strict";
import test from "node:test";
import {renderClosingPanel,renderClosingFixture} from "../helpers/closing-ui-fixture";

type MutableHistoryPayload = {
 branch?: unknown;
 report: { paymentMethods?: unknown[] };
 closedBy?: unknown;
 timezone?: unknown;
 generatedAt?: unknown;
};

test("shift mode OFF hides operational shift controls without reviving daily closing",async()=>{
 const {html}=await renderClosingFixture({cashierShiftsEnabled:false});
 assert.match(html,/Cashier shifts are disabled/);
 assert.doesNotMatch(html,/Start shift|End shift|Your shift|Confirm daily closing|name="openingFloat"/);
 const history=await renderClosingFixture({cashierShiftsEnabled:false,snapshot:"valid",searchParams:{date:"2026-10-02"}});
 assert.match(history.html,/Cashier shifts are disabled/);
 assert.match(history.html,/\/closing\/history/);
 assert.doesNotMatch(history.html,/<form|Original closer|name="openingFloat"/);
 assert.ok(!history.queries.includes("snapshot"));
});

test("incomplete or invalid frozen history is unavailable, never a crash or live fallback",async()=>{
 for(const mutatePayload of [
  (p:MutableHistoryPayload)=>{delete p.branch;}, (p:MutableHistoryPayload)=>{p.report={};}, (p:MutableHistoryPayload)=>{delete p.closedBy;},
  (p:MutableHistoryPayload)=>{p.timezone="broken-zone";}, (p:MutableHistoryPayload)=>{p.generatedAt="invalid";},
  (p:MutableHistoryPayload)=>{p.report.paymentMethods=[{}];},
 ]) {
  const {html,queries}=await renderClosingFixture({snapshot:"valid",searchParams:{date:"2026-10-02"},mutatePayload});
  assert.match(html,/Frozen report cannot be displayed/);
  assert.ok(!queries.includes("full-report"));
 }
});

test("existing history date link reads only frozen payload and rejects a foreign branch",async()=>{
 const {html,queries}=await renderClosingFixture({canConfirm:false,snapshot:"valid",searchParams:{date:"2026-10-02",branchId:"branch"}});
 assert.match(html,/Original closer/);assert.match(html,/Original note/);assert.match(html,/RM123.00/);
 assert.ok(!queries.includes("full-report"));assert.ok(!queries.includes("readiness"));assert.ok(queries.includes("snapshot"));
 await assert.rejects(renderClosingFixture({snapshot:"valid",searchParams:{date:"2026-10-02",branchId:"foreign"}}),/Branch is invalid/);
 const bad=await renderClosingFixture({snapshot:"invalid",searchParams:{date:"2026-10-02"}});
 assert.match(bad.html,/Frozen report cannot be displayed/);assert.ok(!bad.queries.includes("full-report"));
 const current=await renderClosingFixture({snapshot:"valid"});assert.ok(!current.queries.includes("snapshot"));assert.doesNotMatch(current.html,/Original closer/);
});

test("current Closing only presents shift work and never reads daily readiness or report",async()=>{
 for(const canConfirm of [true,false]) {
  const {html,queries}=await renderClosingFixture({canConfirm,ownOpen:true});
  for(const copy of ["Your shift","Cash in drawer","Expected cash in drawer","Cash difference","End shift","Historical closing records"]) assert.ok(html.includes(copy),copy);
  assert.doesNotMatch(html,/Confirm daily closing|Daily closing ready|Waiting for daily closing|confirmed separately|name="actualCash"|name="operationId"/);
  assert.ok(!queries.includes("full-report"));assert.ok(!queries.includes("readiness"));
 }
});
test("no snapshot never renders a create/confirm form",async()=>{
 const html=await renderClosingPanel({branchId:"branch",branchName:"Main",businessDate:"2026-10-02",expectedCashCents:0,openShiftCount:0,readiness:{status:"READY"},snapshot:null,lateActivity:null});
 assert.doesNotMatch(html,/Confirm|actualCash|operationId|DAILY CLOSE/);
});
test("historical frozen panel retains values and sends without any retry or resend form",async()=>{
 const html=await renderClosingPanel({expectedCashCents:100000,readiness:{status:"CLOSED"},snapshot:{expectedCashCents:100000,actualCashCents:100000,cashDifferenceCents:0,closedAtLabel:"Historical time",closedByName:"Original closer",closingNote:"Original note",whatsappSends:[{id:"send",status:"FAILED",sendType:"CLOSING_REPORT",trigger:"AUTO_CLOSING",recipientLabel:"Owner",recipientRole:"OWNER",phone:"synthetic",requestedAtLabel:"Old time",completedAtLabel:null,requestedByName:null,errorMessage:"Old failure",reason:null}]},lateActivity:null});
 for(const value of ["Original closer","Historical time","Original note","Old failure","1000.00"])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<form|<button|name="actualCash"|name="operationId"/);
});
