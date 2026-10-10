import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { posOutletPages } from "../helpers/pos-outlet-pages";

// Invokes the actual page mapper; only framework/database boundaries are stubbed.
test("Calendar edit service selection falls back to singular serviceId without losing multi-service selections", async () => {
  const { mapCalendarAppointment } = await posOutletPages(undefined as unknown as PrismaClient);
  const map = (serviceId: string | null, serviceIds: string[]) => mapCalendarAppointment({
    id: "appointment", branchId: "historical-branch", customer: { name: "Synthetic", phone: "TEST" },
    scheduledAt: new Date("2099-11-01T02:00:00Z"), serviceId, serviceIds, productIds: [], packageIds: [], invoice: null,
  }, new Map<string, never>(), new Map<string, never>(), new Map<string, never>(), new Map<string, never>(), new Map<string, never>()).serviceIds;
  assert.deepEqual(map("A", []), ["A"], "Notes editor must receive the visible singular service");
  assert.deepEqual(map("A", ["A", "B"]), ["A", "B"]);
  assert.deepEqual(map("C", ["A", "B", "A"]), ["A", "B"]);
  assert.deepEqual(map(null, []), []);
  assert.deepEqual(map("A", [""]), ["A"]);
});
