import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { PackageForm } from "@/components/package-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createPackageAction } from "../actions";

export default async function NewPackagePage() {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const [services, branches, categories] = await Promise.all([
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
    prisma.packageCategory.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Package</h1>
            <p>Create a prepaid wash package, such as RM180 for 10 washes.</p>
          </div>
          <BackButton fallbackHref="/packages" />
        </div>

        <div className="panel">
          <PackageForm
            action={createPackageAction}
            categories={categories}
            services={services}
            branches={branches}
            submitLabel="Create package"
          />
        </div>
      </section>
    </AppShell>
  );
}
