import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWhatsAppConversationTime,
  formatWhatsAppMessageTime,
} from "../../src/lib/whatsapp/display-time";

test("WhatsApp message time is displayed in Malaysia time", () => {
  assert.equal(
    formatWhatsAppMessageTime(new Date("2026-08-10T05:14:00.000Z")),
    "1:14 pm",
  );
});

test("WhatsApp conversation day labels use the Malaysia calendar day", () => {
  const malaysiaAfterMidnight = new Date("2026-08-10T16:30:00.000Z");

  assert.equal(
    formatWhatsAppConversationTime(
      new Date("2026-08-10T16:10:00.000Z"),
      malaysiaAfterMidnight,
    ),
    "12:10 am",
  );
  assert.equal(
    formatWhatsAppConversationTime(
      new Date("2026-08-10T15:50:00.000Z"),
      malaysiaAfterMidnight,
    ),
    "Yesterday",
  );
  assert.equal(
    formatWhatsAppConversationTime(
      new Date("2026-08-08T15:50:00.000Z"),
      malaysiaAfterMidnight,
    ),
    "8 Aug",
  );
});
