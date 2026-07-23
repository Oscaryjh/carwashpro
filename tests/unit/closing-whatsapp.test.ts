import assert from "node:assert/strict";
import test from "node:test";

import { normalizeClosingWhatsAppPhone } from "../../src/lib/closing-whatsapp/phone";
import {
  buildClosingReportDedupeKey,
  buildUnclosedReminderDedupeKey,
  resolveClosingWhatsAppRecipients,
} from "../../src/lib/closing-whatsapp/recipients";
import {
  buildUnclosedClosingReminderText,
  resolveClosingWhatsAppLanguage,
} from "../../src/lib/closing-whatsapp/templates";

test("closing WhatsApp phone normalization accepts local and international values", () => {
  assert.equal(normalizeClosingWhatsAppPhone("011-1221 2259"), "601112212259");
  assert.equal(normalizeClosingWhatsAppPhone("+60 11 1221 2259"), "601112212259");
  assert.equal(normalizeClosingWhatsAppPhone("abc"), null);
  assert.equal(normalizeClosingWhatsAppPhone("123"), null);
});

test("closing WhatsApp template language falls back to English", () => {
  assert.equal(resolveClosingWhatsAppLanguage("ZH"), "ZH");
  assert.equal(resolveClosingWhatsAppLanguage("EN"), "EN");
  assert.equal(resolveClosingWhatsAppLanguage(null), "EN");
});

test("closing unclosed reminder renders the selected language", () => {
  const english = buildUnclosedClosingReminderText({
    branchName: "Salon QA 01",
    businessDate: "2026-07-23",
    businessName: "CLOSING QA SALON",
    deadlineTime: "22:00",
    language: "EN",
  });

  assert.match(english, /Daily closing reminder/);
  assert.match(english, /Business date:/);
  assert.match(english, /Deadline: 22:00/);

  const chinese = buildUnclosedClosingReminderText({
    branchName: "Salon QA 01",
    businessDate: "2026-07-23",
    businessName: "CLOSING QA SALON",
    deadlineTime: "22:00",
    language: "ZH",
  });

  assert.match(chinese, /每日关账提醒/);
  assert.match(chinese, /营业日：/);
  assert.match(chinese, /截止时间：22:00/);
});

test("closing WhatsApp dedupe keys are stable and scoped", () => {
  assert.equal(
    buildClosingReportDedupeKey({
      recipientId: "recipient-1",
      snapshotId: "snapshot-1",
    }),
    "closing-report:snapshot-1:recipient-1",
  );

  assert.equal(
    buildUnclosedReminderDedupeKey({
      branchId: "branch-1",
      businessDate: "2026-07-23",
      businessId: "business-1",
      recipientId: "recipient-1",
    }),
    "closing-unclosed:business-1:branch-1:2026-07-23:recipient-1",
  );
});

test("closing WhatsApp recipients inherit business defaults and deduplicate phones", async () => {
  const fakeClient = {
    closingWhatsAppBranchSetting: {
      findUnique: async () => null,
    },
    closingWhatsAppRecipient: {
      findMany: async () => [
        {
          id: "recipient-1",
          label: "Owner",
          normalizedPhone: "601112212259",
          phone: "01112212259",
        },
        {
          id: "recipient-2",
          label: "Finance duplicate",
          normalizedPhone: "601112212259",
          phone: "+601112212259",
        },
        {
          id: "recipient-3",
          label: "Finance",
          normalizedPhone: "60198885555",
          phone: "0198885555",
        },
      ],
    },
    closingWhatsAppSetting: {
      findUnique: async () => ({
        deadlineTime: "22:00",
        enabled: true,
        sendClosingReport: true,
        sendUnclosedReminder: true,
      }),
    },
  };

  const recipients = await resolveClosingWhatsAppRecipients(
    {
      branchId: "branch-1",
      businessId: "business-1",
    },
    fakeClient as never,
  );

  assert.deepEqual(
    recipients.map((recipient) => recipient.id),
    ["recipient-1", "recipient-3"],
  );
});

test("closing WhatsApp branch override uses branch recipients", async () => {
  const calls: unknown[] = [];
  const fakeClient = {
    closingWhatsAppBranchSetting: {
      findUnique: async () => ({
        deadlineTimeOverride: "21:30",
        useBusinessRecipients: false,
      }),
    },
    closingWhatsAppRecipient: {
      findMany: async (input: unknown) => {
        calls.push(input);
        return [
          {
            id: "recipient-branch",
            label: "Branch manager",
            normalizedPhone: "60118889999",
            phone: "0118889999",
          },
        ];
      },
    },
    closingWhatsAppSetting: {
      findUnique: async () => ({
        deadlineTime: "22:00",
        enabled: true,
        sendClosingReport: true,
        sendUnclosedReminder: true,
      }),
    },
  };

  const recipients = await resolveClosingWhatsAppRecipients(
    {
      branchId: "branch-1",
      businessId: "business-1",
    },
    fakeClient as never,
  );

  assert.equal(recipients.length, 1);
  assert.equal(recipients[0]?.id, "recipient-branch");
  assert.deepEqual(calls, [
    {
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        label: true,
        normalizedPhone: true,
        phone: true,
      },
      where: {
        branchId: "branch-1",
        businessId: "business-1",
        isActive: true,
        scope: "BRANCH",
        scopeKey: "branch-1",
      },
    },
  ]);
});
