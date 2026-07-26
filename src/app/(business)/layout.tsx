import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";

export default async function BusinessLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const identity = await requireUser();
  const context = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId
      ? "VIEW_DASHBOARD"
      : undefined,
  );

  return (
    <AppShell access={context.access} user={context.user}>
      {children}
    </AppShell>
  );
}
