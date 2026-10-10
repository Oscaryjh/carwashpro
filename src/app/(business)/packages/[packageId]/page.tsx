import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { DeletePackageForm } from "@/components/delete-package-form";
import { PackageForm } from "@/components/package-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { resolveCatalogOutletContext, guardCatalogOutletSubmission } from "@/lib/catalog-outlet-context";
import { outletPresentation } from "@/lib/outlet-ui-context";
import { formatCents, parseMoneyToCents } from "@/lib/commercial/money";
import { updatePackageAction } from "../actions";

type PackageDetailsPageProps = {
  params: Promise<{
    packageId: string;
  }>;
};

export default async function PackageDetailsPage({
  params,
}: PackageDetailsPageProps) {
  const { user, businessId, industryType } =
    await requireBusinessUserForModule("POS");
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  assertStaffPermission(user, "PACKAGES");

  const { packageId } = await params;
  const outletContext = await resolveCatalogOutletContext({ businessId, actorUserId: user.userId, resource: "PACKAGES", operation: "read" });
  if (outletContext.kind === "denied") notFound();
  const outlet = outletPresentation(outletContext);
  const snapshot = { ...outlet, businessId };
  async function updateWithCurrentOutlet(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUserForModule("POS");
    assertStaffPermission(fresh.user, "PACKAGES");
    if (formData.get("packageId") !== packageId) throw new Error("Package access denied.");
    await guardCatalogOutletSubmission({ businessId: fresh.businessId, actorUserId: fresh.user.userId, resource: "PACKAGES", snapshot, formData });
    await updatePackageAction(formData);
  }

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
        serviceBenefits: {
          include: { service: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            customerPackages: true,
          },
        },
      },
    }),
    prisma.service.findMany({
      where: { businessId, status: "ACTIVE" },
      include: {
        serviceCategory: {
          select: { name: true },
        },
      },
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
    <>
      <section className="content package-edit-page">
        <div className="page-header">
          <div>
            <h1>{packagePlan.name}</h1>
          </div>
          <BackButton fallbackHref="/packages" />
        </div>

        <div className="grid package-edit-summary">
          <Info
            label="Category"
            value={packagePlan.packageCategory?.name ?? "-"}
          />
          <Info label="Status" value={packagePlan.status} />
          <Info label="Package price" value={formatCents(parseMoneyToCents(packagePlan.price.toString()) ?? 0)} />
          <Info label="Total Uses" value={packagePlan.totalUses} />
          <Info label="Sold" value={packagePlan._count.customerPackages} />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Edit package</h2>
          </div>
          <PackageForm
            action={updateWithCurrentOutlet}
            outlet={outlet}
            packagePlan={packagePlan}
            categories={categories}
            services={services}
            branches={branches}
            formId={formId}
            isSalonBusiness={isSalonBusiness}
            serviceBenefits={packagePlan.serviceBenefits.map((benefit) => ({
              serviceId: benefit.serviceId,
              totalUses: benefit.totalUses,
            }))}
          />
          <div className="form-actions package-edit-actions">
            <DeletePackageForm
              packageId={packagePlan.id}
              packageName={packagePlan.name}
              label="Delete package"
            />
            <button type="submit" form={formId}>
              Save changes
            </button>
          </div>
        </div>
      </section>
    </>
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
