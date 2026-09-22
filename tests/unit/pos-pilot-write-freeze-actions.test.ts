import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const guardedActions = [
  ["src/app/(business)/cashier/actions.ts", "completeCashierSaleAction", "POS_CHECKOUT"],
  ["src/app/(business)/pos/actions.ts", "recordPaymentAction", "POS_PAYMENT"],
  ["src/app/(business)/pos/actions.ts", "usePackagePaymentAction", "POS_PACKAGE_REDEMPTION"],
  ["src/app/(business)/pos/actions.ts", "recordPackagePurchasePaymentAction", "PACKAGE_PURCHASE"],
  ["src/app/(business)/invoices/actions.ts", "refundPaymentAction", "POS_REFUND"],
  ["src/app/(business)/invoices/actions.ts", "voidInvoiceAction", "INVOICE_VOID"],
  ["src/app/(business)/closing/actions.ts", "startShiftAction", "POS_DAILY_CLOSING_START"],
  ["src/app/(business)/closing/actions.ts", "endShiftAction", "POS_DAILY_CLOSING_END"],
  ["src/app/(business)/closing/actions.ts", "closeDailySnapshotAction", "POS_DAILY_CLOSING_FINALIZE"],
  ["src/app/(business)/closing/actions.ts", "resolveStaleShiftAction", "STALE_SHIFT_RESOLUTION"],
  ["src/app/(business)/closing/actions.ts", "manualClosingWhatsAppSendAction", "WHATSAPP_SEND"],
  ["src/app/(business)/appointments/actions.ts", "createAppointmentInlineAction", "APPOINTMENT_CREATE"],
  ["src/app/(business)/appointments/actions.ts", "createAppointmentAction", "APPOINTMENT_CREATE"],
  ["src/app/(business)/appointments/actions.ts", "updateAppointmentStatusAction", "APPOINTMENT_UPDATE"],
  ["src/app/(business)/appointments/actions.ts", "rescheduleAppointmentAction", "APPOINTMENT_UPDATE"],
  ["src/app/(business)/appointments/actions.ts", "updateAppointmentDetailsAction", "APPOINTMENT_UPDATE"],
  ["src/app/(business)/appointments/actions.ts", "addAppointmentServicesAction", "APPOINTMENT_UPDATE"],
  ["src/app/(business)/appointments/actions.ts", "convertAppointmentToJobAction", "APPOINTMENT_CONVERT_TO_JOB"],
  ["src/app/(business)/appointments/actions.ts", "recordSalonAppointmentPaymentAction", "POS_PAYMENT"],
  ["src/app/(business)/work-orders/actions.ts", "createVehicleForWorkOrderAction", "VEHICLE_CREATE"],
  ["src/app/(business)/work-orders/actions.ts", "createWorkOrderAction", "WORK_ORDER_CREATE"],
  ["src/app/(business)/work-orders/actions.ts", "purchasePackageFromCashierAction", "PACKAGE_PURCHASE"],
  ["src/app/(business)/work-orders/actions.ts", "updateWorkOrderStatusAction", "WORK_ORDER_UPDATE"],
  ["src/app/(business)/work-orders/actions.ts", "updateWorkOrderContactAction", "WORK_ORDER_UPDATE"],
] as const;

test("every operator-smoke surface performs source-level preflight before auth, transaction or queue work", async () => {
  for (const [file, action, operation] of guardedActions) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    const start = source.indexOf(`function ${action}`);
    assert.notEqual(start, -1, `${file}:${action}`);
    const nextExport = source.indexOf("\nexport async function ", start + 1);
    const body = source.slice(start, nextExport < 0 ? undefined : nextExport);
    const guard = body.indexOf(`preflightPosPilotWrite(\"${operation}\")`);
    assert.notEqual(guard, -1, `${file}:${action}: missing ${operation} guard`);
    for (const sideEffectBoundary of [
      "requireBusinessUser(",
      "prisma.$transaction(",
      "runFinancialOperation(",
      "runClosingSerializableTransaction(",
      "enqueue",
      "sendInvoice",
    ]) {
      const boundary = body.indexOf(sideEffectBoundary);
      if (boundary >= 0) {
        assert.ok(guard < boundary, `${file}:${action}: guard after ${sideEffectBoundary}`);
      }
    }
  }
});

test("server preflight helper reads no request cookie in full mode before producing the stable denial", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/lib/release/pos-pilot-write-freeze-server.ts"),
    "utf8",
  );
  const mode = source.indexOf("resolvePosPilotWriteFreezeMode");
  const full = source.indexOf('mode === "full"');
  const cookie = source.indexOf("cookies()");
  assert.ok(mode >= 0 && full > mode && cookie > full);
  assert.match(source, /throw new PosPilotWriteFrozenError\(operation\)/);
});

test("operator-smoke notification producers suppress new queue work before database or provider access", async () => {
  for (const [file, functionName] of [
    ["src/lib/whatsapp/invoice-notifications.ts", "sendInvoiceIfConnected"],
    ["src/lib/whatsapp/customer-welcome.ts", "sendNewCustomerWelcomeIfConnected"],
    ["src/lib/whatsapp/work-order-notifications.ts", "sendServiceConfirmationQueued"],
    ["src/lib/whatsapp/work-order-notifications.ts", "sendReadyForPickupIfConnected"],
    ["src/lib/whatsapp/appointment-reminders.ts", "scheduleAppointmentReminder"],
    ["src/lib/closing-whatsapp/queue.ts", "enqueueClosingReportForSnapshot"],
    ["src/lib/closing-whatsapp/queue.ts", "enqueueUnclosedClosingReminders"],
    ["src/lib/closing-whatsapp/queue.ts", "enqueueManualClosingWhatsAppSend"],
  ] as const) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    const start = source.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, `${file}:${functionName}`);
    const nextExport = source.indexOf("\nexport async function ", start + 1);
    const body = source.slice(start, nextExport < 0 ? undefined : nextExport);
    const suppression = body.indexOf("shouldSuppressPosPilotNotificationQueue()");
    assert.notEqual(suppression, -1, `${file}:${functionName}`);
    for (const boundary of ["prisma.", "client.", "enqueueWhatsApp", "renderManaged", "isBusinessModuleEnabled"] ) {
      const index = body.indexOf(boundary);
      if (index >= 0) assert.ok(suppression < index, `${file}:${functionName}:${boundary}`);
    }
  }
});
