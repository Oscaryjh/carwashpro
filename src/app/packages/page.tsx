import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PackageForm } from "@/components/package-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  deactivatePackageAction,
  updatePackageAction,
} from "./actions";

export default async function PackagesPage() {
  const { user, businessId } = await requireBusinessUser();
  const [packages, services, branches] = await Promise.all([
    prisma.package.findMany({
      where: { businessId },
      include: {
        branch: true,
        service: true,
        _count: {
          select: { customerPackages: true },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.service.findMany({
      where: { businessId, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Packages</h1>
            <p>Prepaid wash packages and remaining-use tracking.</p>
          </div>
          <Link className="button-link" href="/packages/new">
            New Package
          </Link>
        </div>

        <div className="panel">
          {packages.length ? (
            <div className="service-list">
              {packages.map((packagePlan) => (
                <section className="inline-editor" key={packagePlan.id}>
                  <div className="section-header">
                    <div>
                      <h2>{packagePlan.name}</h2>
                      <span className={`status ${packagePlan.status.toLowerCase()}`}>
                        {packagePlan.status}
                      </span>
                    </div>
                    <div>
                      <strong>RM{Number(packagePlan.price).toFixed(2)}</strong>
                      <div className="muted">
                        {packagePlan.totalUses} washes
                        {packagePlan.service ? ` - ${packagePlan.service.name}` : ""}
                      </div>
                      <div className="muted">
                        {packagePlan.branch?.name ?? "All branches"}
                      </div>
                      <div className="muted">
                        Sold {packagePlan._count.customerPackages} time
                        {packagePlan._count.customerPackages === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <PackageForm
                    action={updatePackageAction}
                    packagePlan={packagePlan}
                    services={services}
                    branches={branches}
                    submitLabel="Save package"
                  />
                  {packagePlan.status === "ACTIVE" ? (
                    <form action={deactivatePackageAction} className="form-actions">
                      <input type="hidden" name="packageId" value={packagePlan.id} />
                      <button className="secondary-light-button" type="submit">
                        Deactivate
                      </button>
                    </form>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <p className="empty-state">No packages yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
