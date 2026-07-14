import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { DeletePackageForm } from "@/components/delete-package-form";
import { PackageForm } from "@/components/package-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { updatePackageAction } from "../actions";

type PackageDetailsPageProps = {
  params: Promise<{
    packageId: string;
  }>;
};

export default async function PackageDetailsPage({
  params,
}: PackageDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PACKAGES");

  const { packageId } = await params;

  const [packagePlan, services, branches, categories] = await Promise.all([
    prisma.package.findFirst({
      where: {
        id: packageId,
        businessId,
      },
      include: {
        branch: true,
        packageCategory: true,
        service: true,
        _count: {
          select: {
            customerPackages: true,
          },
        },
      },
    }),
    prisma.service.findMany({
      where: { businessId, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    getActiveBranches(businessId),
    prisma.packageCategory.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!packagePlan) {
    notFound();
  }

  const formId = `package-form-${packagePlan.id}`;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{packagePlan.name}</h1>
            <p>RM{Number(packagePlan.price).toFixed(2)}</p>
          </div>
          <BackButton fallbackHref="/packages" />
        </div>

        <div className="grid">
          <Info
            label="Category"
            value={packagePlan.packageCategory?.name ?? "-"}
          />
          <Info label="Status" value={packagePlan.status} />
          <Info label="Total washes" value={packagePlan.totalUses} />
          <Info
            label="Linked service"
            value={packagePlan.service?.name ?? "Any wash service"}
          />
          <Info label="Sold" value={packagePlan._count.customerPackages} />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Edit package</h2>
          </div>
          <PackageForm
            action={updatePackageAction}
            packagePlan={packagePlan}
            categories={categories}
            services={services}
            branches={branches}
            formId={formId}
          />
          <div className="form-actions service-action-row">
            <button type="submit" form={formId}>
              Save
            </button>
            <DeletePackageForm
              packageId={packagePlan.id}
              packageName={packagePlan.name}
            />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
