import { z } from "zod";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";

const uuid = z.string().uuid();
type WalletAccessOptions = NonNullable<Parameters<typeof isBusinessModuleEnabled>[2]>;

/** Availability only; callers retain authenticated tenant and permission checks. */
export async function isWalletAccessAllowed({ businessId }: { businessId: string }, options: WalletAccessOptions = {}): Promise<boolean> {
  if (!uuid.safeParse(businessId).success) return false;
  return isBusinessModuleEnabled(businessId, "WALLET", options);
}

export class WalletUnavailableError extends Error {
  readonly code = "WALLET_UNAVAILABLE";
  constructor() { super("Member Wallet is not enabled for this business."); }
}

export async function assertWalletAccessAllowed(input: { businessId: string }, options: WalletAccessOptions = {}): Promise<void> {
  if (!(await isWalletAccessAllowed(input, options))) throw new WalletUnavailableError();
}
