import { redirect } from "next/navigation";
import {
  commitBusinessContextSwitch,
  getRecoveryBusinessContext,
} from "@/lib/business-groups/business-context";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  const user = await requireUser();
  const recovery = await getRecoveryBusinessContext(user);
  if (!recovery.ok) {
    redirect("/no-business-access");
  }

  const result = await commitBusinessContextSwitch({
    session: user,
    targetBusinessId: recovery.context.businessId,
    source: "RECOVERY",
  });
  if (!result.ok) {
    redirect("/no-business-access");
  }

  redirect(result.destination);
}
