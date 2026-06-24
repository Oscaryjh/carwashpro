import { AppShell } from "@/components/app-shell";
import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { updateBusinessAction } from "@/app/admin/businesses/actions";

export default async function BusinessSettingsPage() {
  const context = await requireBusinessContext();
  assertRole(context.user, ["BUSINESS_OWNER"]);

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: context.businessId },
  });

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Business settings</h1>
            <p>Manage your car wash profile.</p>
          </div>
        </div>

        <div className="panel">
          <BusinessForm
            action={updateBusinessAction}
            mode="edit"
            business={business}
          />
        </div>
      </section>
    </AppShell>
  );
}
