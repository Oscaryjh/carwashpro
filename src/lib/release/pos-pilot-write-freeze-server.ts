import "server-only";

import { cookies } from "next/headers";
import {
  POS_PILOT_SMOKE_COOKIE,
  PosPilotWriteFrozenError,
  assertPosPilotSmokeOperationScope,
  authorizePosPilotSmokeOperation,
  resolvePosPilotWriteFreezeMode,
} from "@/lib/release/pos-pilot-contract";

export async function preflightPosPilotWrite(operation: string) {
  let mode;
  try {
    mode = resolvePosPilotWriteFreezeMode();
  } catch {
    throw new PosPilotWriteFrozenError(operation);
  }

  if (mode === "full") throw new PosPilotWriteFrozenError(operation);
  if (mode === "off") return null;

  const cookieStore = await cookies();
  try {
    return await authorizePosPilotSmokeOperation({
      operation,
      capabilityToken: cookieStore.get(POS_PILOT_SMOKE_COOKIE)?.value,
    });
  } catch {
    throw new PosPilotWriteFrozenError(operation);
  }
}

export function assertPosPilotWriteScope(
  capability: Awaited<ReturnType<typeof preflightPosPilotWrite>>,
  input: { actorId: string; businessId: string; branchId: string | null },
) {
  assertPosPilotSmokeOperationScope(capability, {
    actorId: input.actorId,
    businessId: input.businessId,
    branchId: input.branchId ?? "",
  });
}
