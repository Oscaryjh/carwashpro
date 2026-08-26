import type { ReactNode } from "react";
import { TimeWorkspaceNav } from "@/components/time-workspace-nav";

export default function TimeLayout({ children }: { children: ReactNode }) {
  return <><TimeWorkspaceNav />{children}</>;
}
