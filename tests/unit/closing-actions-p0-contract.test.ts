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
  assert.match(startAction, /dailyClosingSnapshot\.findUnique/);
  assert.match(startAction, /status: "OPEN"/);

  assert.match(endAction, /runClosingSerializableTransaction/);
  assert.match(endAction, /getCashierShiftBusinessDate/);
  assert.match(endAction, /acquireDailyClosingScopeLock/);
  assert.match(endAction, /assertNoCrossBusinessDayShiftActivity/);
});

test("closeDailySnapshotAction checks open and unsafe shifts before snapshot creation", () => {
  const manualClose = actionBody(
    "closeDailySnapshotAction",
    "class DailyClosingAlreadyExistsError",
    false,
  );
  const openShiftGate = manualClose.indexOf("assertNoOpenShiftsForBusinessDate");
  const crossDayGate = manualClose.indexOf("assertNoCrossBusinessDayShiftActivity");
  const snapshotCreate = manualClose.indexOf("createDailyClosingSnapshotInTransaction");

  assert.ok(openShiftGate >= 0);
  assert.ok(crossDayGate > openShiftGate);
  assert.ok(snapshotCreate > crossDayGate);
  assert.match(manualClose, /acquireDailyClosingScopeLock/);
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
      /assertCashierShiftAcceptsActivity/,
      `${path} must guard activity against the shift business date`,
    );
  }
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
