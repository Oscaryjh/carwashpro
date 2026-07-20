import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";

export default async function BusinessLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { user } = await requireBusinessUser();

  return <AppShell user={user}>{children}</AppShell>;
}
