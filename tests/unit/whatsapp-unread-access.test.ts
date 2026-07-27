import assert from "node:assert/strict";
import test from "node:test";
import {
  canReadWhatsAppUnreadCount,
  shouldPollWhatsAppUnread,
} from "../../src/lib/whatsapp/unread-access";

test("unread access follows effective business ownership and direct staff permission", () => {
  assert.equal(
    canReadWhatsAppUnreadCount(
      { role: "STAFF", permissions: [] },
      {
        granted: true,
        businessId: "business-1",
        effectiveBusinessRole: "BUSINESS_OWNER",
        source: "GROUP_ACCESS",
      },
    ),
    true,
  );

  assert.equal(
    canReadWhatsAppUnreadCount(
      { role: "STAFF", permissions: ["WHATSAPP"] },
      {
        granted: true,
        businessId: "business-1",
        effectiveBusinessRole: "STAFF",
        source: "DIRECT_BUSINESS",
      },
    ),
    true,
  );

  assert.equal(
    canReadWhatsAppUnreadCount(
      { role: "STAFF", permissions: [] },
      {
        granted: true,
        businessId: "business-1",
        effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY",
        source: "GROUP_ACCESS",
      },
    ),
    false,
  );

  assert.equal(
    canReadWhatsAppUnreadCount(
      { role: "STAFF", permissions: [] },
      {
        granted: true,
        businessId: "business-1",
        effectiveBusinessRole: "STAFF",
        source: "DIRECT_BUSINESS",
      },
    ),
    false,
  );

  assert.equal(
    canReadWhatsAppUnreadCount(
      { role: "BUSINESS_OWNER", permissions: [] },
      { granted: false },
    ),
    false,
  );
});

test("unread polling requires the inbox route rather than a WhatsApp icon", () => {
  assert.equal(
    shouldPollWhatsAppUnread([
      { href: "/admin/whatsapp-templates" },
      { href: "/admin/businesses" },
    ]),
    false,
  );

  assert.equal(
    shouldPollWhatsAppUnread([
      {
        href: "/whatsapp",
        children: [{ href: "/whatsapp/inbox" }],
      },
    ]),
    true,
  );
});
