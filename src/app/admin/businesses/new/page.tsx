import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BusinessCreateForm } from "@/components/business-create-form";
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
            <h1>Create Company</h1>
            <p>Add a company, choose its industry, and create its first owner account.</p>
          </div>
          <BackButton fallbackHref="/admin/businesses" />
        </div>

        <div className="panel">
          <BusinessCreateForm
            action={createBusinessAction}
          />
        </div>
      </section>
    </AppShell>
  );
}
