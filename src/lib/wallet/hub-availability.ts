import { ZodError } from "zod";
import { resolveWalletHubScope, type WalletHubContext } from "@/lib/wallet/hub-scope";

export function isWalletHubAccessError(error: unknown) {
  return error instanceof ZodError || (error instanceof Error && "code" in error && ["WALLET_ACCESS_DENIED", "WALLET_UNAVAILABLE"].includes(String(error.code)));
}
/** Both navigation and route use the Phase 1 fresh Owner/module contract. */
export async function canViewWalletHub(context: WalletHubContext) {
  try { await resolveWalletHubScope(context); return true; }
  catch (error) { if (isWalletHubAccessError(error)) return false; throw error; }
}
