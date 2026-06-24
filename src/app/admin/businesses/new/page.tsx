import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { createBusinessAction } from "../actions";

export default async function NewBusinessPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Create Business</h1>
            <p>Add a car wash tenant and its first business owner.</p>
          </div>
          <Link href="/admin/businesses">Back to businesses</Link>
        </div>

        <div className="panel">
          <BusinessForm
            action={createBusinessAction}
            mode="create"
            showOwnerFields
          />
        </div>
      </section>
    </AppShell>
  );
}
