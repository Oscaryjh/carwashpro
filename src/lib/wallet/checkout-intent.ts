import { z } from "zod";

const intentSchema = z.object({
  version: z.literal(1), scope: z.string().min(1), operationId: z.string().min(16).max(128),
  entries: z.array(z.tuple([z.string().max(128), z.string().max(12000)])).max(1000),
  summary: z.array(z.object({ label: z.string().max(160), value: z.string().max(12000) })).max(150),
}).strict().refine(intent => intent.entries.filter(([key]) => key === "operationId").length === 1
  && intent.entries.find(([key]) => key === "operationId")?.[1] === intent.operationId);
export type WalletCheckoutIntent = z.infer<typeof intentSchema>;

export function createWalletCheckoutIntent(form: FormData, scope: string, summary: WalletCheckoutIntent["summary"]): WalletCheckoutIntent {
  const entries = [...form.entries()].map(([key, value]) => {
    if (typeof value !== "string") throw new Error("Wallet checkout cannot contain file uploads.");
    return [key, value] as [string, string];
  });
  return intentSchema.parse({ version: 1, scope, operationId: form.get("operationId"), entries, summary });
}
export function parseWalletCheckoutIntent(raw: string, scope: string): WalletCheckoutIntent | null {
  try { const value = intentSchema.parse(JSON.parse(raw)); return value.scope === scope ? value : null; } catch { return null; }
}
export function toWalletCheckoutFormData(intent: WalletCheckoutIntent): FormData {
  const valid = intentSchema.parse(intent);
  const form = new FormData();
  for (const [key, value] of valid.entries) form.append(key, value);
  return form;
}

/** Search only this authenticated business/actor. The original branch can outlive its shift. */
export function readWalletCheckoutRecovery(storage: Pick<Storage, "length" | "key" | "getItem">, identityScope: string): {
  key: string; intent: WalletCheckoutIntent | null; blocked: boolean;
} | null {
  const prefix = `wallet-checkout:${identityScope}:`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  if (!keys.length) return null;
  if (keys.length !== 1) return { key: "", intent: null, blocked: true };
  const key = keys[0];
  const intent = parseWalletCheckoutIntent(storage.getItem(key) ?? "", key.slice("wallet-checkout:".length));
  return { key, intent, blocked: !intent };
}
