import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const closingActions = readFileSync(
  "src/app/(business)/closing/actions.ts",
  "utf8",
);

test("startShiftAction and endShiftAction use the serialized closing boundary", () => {
  const startAction = actionBody("startShiftAction", "endShiftAction");
  const endAction = actionBody("endShiftAction", "closeDailySnapshotAction");

  assert.match(startAction, /runClosingSerializableTransaction/);
  assert.match(startAction, /acquireDailyClosingScopeLock/);
  assert.doesNotMatch(startAction, /dailyClosingSnapshot\.findUnique/);
  assert.match(startAction, /status: "OPEN"/);

  assert.match(endAction, /runClosingSerializableTransaction/);
  assert.match(endAction, /getCashierShiftBusinessDate/);
  assert.match(endAction, /acquireDailyClosingScopeLock/);
  assert.match(endAction, /acquireCashierOpenShiftLock/);
  assert.doesNotMatch(endAction, /createDailyClosingSnapshotInTransaction|enqueueClosingReportForSnapshot|DAILY_CLOSING_CONFIRMED/);
});

test("retired confirm retains its permission boundary and has no financial writer", () => {
  const manualClose = actionBody("closeDailySnapshotAction", "resolveStaleShiftAction");
  assert.match(manualClose, /CONFIRM_DAILY_CLOSING/);
  assert.match(manualClose, /status: "error"/);
  assert.doesNotMatch(manualClose, /runFinancialOperation|dailyClosingSnapshot|writeAuditLog|enqueue/);
});

test("every drawer financial path applies the canonical shift activity guard", () => {
  const guardedPaths = [
    "src/app/(business)/appointments/actions.ts",
    "src/app/(business)/cashier/actions.ts",
    "src/app/(business)/invoices/actions.ts",
    "src/app/(business)/pos/actions.ts",
    "src/app/(business)/products/actions.ts",
    "src/app/(business)/work-orders/actions.ts",
    "src/lib/expense/service.ts",
  ];

  for (const path of guardedPaths) {
    assert.match(
      readFileSync(path, "utf8"),
      path.endsWith("expense/service.ts") ? /assertCashierShiftAcceptsActivity/ : /resolveCashierActivityContext\(tx,/,
      `${path} must guard activity against the shift business date`,
    );
  }
  const context = readFileSync("src/lib/cashier/activity-context.ts", "utf8");
  assert.match(context,/readCashierShiftSettings\(tx,input.businessId\)/);
  assert.match(context,/assertCashierShiftAcceptsActivity\(tx,/);
  assert.match(context,/cashierId:input.actor.userId,status:"OPEN"/);
});

function actionBody(startName: string, endName: string, exportedFunction = true) {
  const start = closingActions.indexOf(`export async function ${startName}`);
  const end = closingActions.indexOf(
    exportedFunction ? `export async function ${endName}` : endName,
  );
  assert.ok(start >= 0, `${startName} must exist`);
  assert.ok(end > start, `${endName} must follow ${startName}`);
  return closingActions.slice(start, end);
}
