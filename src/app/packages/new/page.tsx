import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PackageForm } from "@/components/package-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createPackageAction } from "../actions";

export default async function NewPackagePage() {
  const { user, businessId } = await requireBusinessUser();
  const [services, branches] = await Promise.all([
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Package</h1>
            <p>Create a prepaid wash package, such as RM180 for 10 washes.</p>
          </div>
          <Link href="/packages">Back to packages</Link>
        </div>

        <div className="panel">
          <PackageForm
            action={createPackageAction}
            services={services}
            branches={branches}
            submitLabel="Create package"
          />
        </div>
      </section>
    </AppShell>
  );
}
