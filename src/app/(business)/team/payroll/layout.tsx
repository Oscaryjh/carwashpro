import type { ReactNode } from "react";
import { PayrollWorkspaceNav } from "@/components/payroll-workspace-nav";

export default function PayrollLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PayrollWorkspaceNav />
      {children}
    </>
  );
}
