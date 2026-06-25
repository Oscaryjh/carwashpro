import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BranchForm } from "@/components/branch-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { createBranchAction } from "../actions";

export default async function NewBranchPage() {
  const { user } = await requireBusinessUser();

  if (user.role !== "BUSINESS_OWNER") {
    throw new Error("Only business owners can create branches.");
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Branch</h1>
            <p>Create a location for this business.</p>
          </div>
          <Link href="/branches">Back to branches</Link>
        </div>

        <div className="panel">
          <BranchForm action={createBranchAction} submitLabel="Create branch" />
        </div>
      </section>
    </AppShell>
  );
}
