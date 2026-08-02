import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  syncWhatsAppHistory,
  WHATSAPP_HISTORY_SYNC_BATCH_SIZE,
} from "../../src/lib/whatsapp/history-sync";

test("history contacts are committed in bounded transactions", async () => {
  let contactWrites = 0;
  const transactionBatchSizes: number[] = [];
  const transaction = {
    whatsAppContact: {
      upsert: async () => {
        contactWrites += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await syncWhatsAppHistory(
    {
      businessId: "00000000-0000-4000-8000-000000000001",
      instanceId: "history-test",
      contacts: Array.from(
        { length: WHATSAPP_HISTORY_SYNC_BATCH_SIZE * 2 + 5 },
        (_, index) => ({
          id: `60110000${String(index).padStart(4, "0")}@s.whatsapp.net`,
          name: `Contact ${index}`,
        }),
      ),
    },
    {
      runTransaction: async (operation) => {
        const writesBefore = contactWrites;
        const value = await operation(transaction);
        transactionBatchSizes.push(contactWrites - writesBefore);
        return value;
      },
    },
  );

  assert.deepEqual(transactionBatchSizes, [10, 10, 5]);
  assert.equal(result.contacts, 25);
  assert.equal(result.skippedContacts, 0);
});

test("history messages do not share one unbounded interactive transaction", async () => {
  let messageWrites = 0;
  const transactionBatchSizes: number[] = [];
  const transaction = {
    customer: {
      findFirst: async () => null,
    },
    whatsAppContact: {
      upsert: async () => undefined,
    },
    whatsAppConversation: {
      upsert: async () => ({ id: "00000000-0000-4000-8000-000000000099" }),
      updateMany: async () => ({ count: 1 }),
    },
    whatsAppChatMessage: {
      upsert: async () => {
        messageWrites += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await syncWhatsAppHistory(
    {
      businessId: "00000000-0000-4000-8000-000000000001",
      instanceId: "history-test",
      syncType: "3",
      messages: Array.from(
        { length: WHATSAPP_HISTORY_SYNC_BATCH_SIZE * 2 + 1 },
        (_, index) => ({
          key: {
            id: `message-${index}`,
            remoteJid: `60120000${String(index).padStart(4, "0")}@s.whatsapp.net`,
            fromMe: false,
          },
          message: { conversation: `Message ${index}` },
          messageTimestamp: 1_785_600_000 + index,
        }),
      ),
    },
    {
      runTransaction: async (operation) => {
        const writesBefore = messageWrites;
        const value = await operation(transaction);
        transactionBatchSizes.push(messageWrites - writesBefore);
        return value;
      },
    },
  );

  assert.deepEqual(transactionBatchSizes, [10, 10, 1]);
  assert.equal(result.messages, 21);
  assert.equal(result.skippedMessages, 0);
  assert.equal(result.syncType, "3");
});
