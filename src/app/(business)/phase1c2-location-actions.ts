"use server";

import { requireBusinessUser } from "@/lib/auth/business-user";
import { redirect } from "next/navigation";
import type { CurrentOutletContext } from "@/lib/outlet-context";
import { guardPhase1c2Create } from "@/lib/phase1c2-outlet-context";
import { startShiftAction } from "./closing/actions";

export async function startOutletShiftAction(rendered: CurrentOutletContext, formData: FormData) {
  const { businessId, user } = await requireBusinessUser("RUN_CLOSING");
  let guarded: FormData;
  try {
    guarded = await guardPhase1c2Create({ businessId, actorUserId: user.userId, capability: "RUN_CLOSING", operation: "write", rendered, formData });
  } catch {
    redirect(`/closing?type=error&message=${encodeURIComponent("Outlet access or setup changed. Reload before continuing.")}`);
  }
  return startShiftAction(guarded);
}
