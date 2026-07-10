import { AppShell } from "@/components/app-shell";
import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { updateBusinessAction } from "@/app/admin/businesses/actions";
import Link from "next/link";

type BusinessSettingsPageProps = {
  searchParams: Promise<{
    saved?: string;
  }>;
};

export default async function BusinessSettingsPage({
  searchParams,
}: BusinessSettingsPageProps) {
  const context = await requireBusinessContext();
  assertRole(context.user, ["BUSINESS_OWNER"]);
  await searchParams;

  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
  });

  if (!business) {
    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Company settings</h1>
            <p>Manage your company profile.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/business/settings/logs">
              Staff logs
            </Link>
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
