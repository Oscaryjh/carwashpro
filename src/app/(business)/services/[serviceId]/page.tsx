import { notFound } from "next/navigation";
import Link from "next/link";
import styles from "@/components/services/services-hub.module.css";
import { DeleteServiceForm } from "@/components/delete-service-form";
import { ServiceForm } from "@/components/service-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { resolveCatalogOutletContext, guardCatalogOutletSubmission } from "@/lib/catalog-outlet-context";
import { outletPresentation } from "@/lib/outlet-ui-context";
import { updateServiceAction } from "../actions";

type ServiceDetailsPageProps = {
  params: Promise<{
    serviceId: string;
  }>;
};

export default async function ServiceDetailsPage({
  params,
}: ServiceDetailsPageProps) {
  const { user, businessId, industryType } =
    await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "SERVICES");
  const isSalonBusiness = industryType === "SALON_BEAUTY";

  const { serviceId } = await params;
  const outletContext = await resolveCatalogOutletContext({ businessId, actorUserId: user.userId, resource: "SERVICES", operation: "read" });
  if (outletContext.kind === "denied") notFound();
  const outlet = outletPresentation(outletContext);
  const snapshot = { ...outlet, businessId };
  async function updateWithCurrentOutlet(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUserForModule("POS");
    assertStaffPermission(fresh.user, "SERVICES");
    if (formData.get("serviceId") !== serviceId) throw new Error("Service access denied.");
    await guardCatalogOutletSubmission({ businessId: fresh.businessId, actorUserId: fresh.user.userId, resource: "SERVICES", snapshot, formData });
    await updateServiceAction(formData);
  }

  const [service, branches, categories, staffOptions] = await Promise.all([
    prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId,
      },
      include: {
        branch: true,
        serviceCategory: true,
        staffAssignments: {
          where: { businessId },
          select: { userId: true },
        },
        _count: {
          select: {
            items: true,
            packages: true,
          },
        },
      },
    }),
    getActiveBranches(businessId),
    prisma.serviceCategory.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    isSalonBusiness
      ? prisma.user.findMany({
          where: {
            businessId,
            status: "active",
            appointmentBookable: true,
            role: { in: ["BUSINESS_OWNER", "STAFF"] },
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            role: true,
            branch: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  if (!service) {
    notFound();
  }

  const formId = `service-form-${service.id}`;
  const companyTax = await prisma.business.findUnique({
    where: { id: businessId }, select: { sstRate: true },
  });

  return (
    <>
      <section className={`content ${styles.hub}`}>
        <div className={`page-header ${styles.header}`}>
          <div>
            <h1>{service.name}</h1>
            <p>RM{Number(service.price).toFixed(2)}</p>
          </div>
          <Link className="secondary-link-button" href="/services">Back to Services</Link>
        </div>

        <div className={styles.detailFacts}>
          <Info
            label="Category"
            value={service.serviceCategory?.name ?? service.category ?? "-"}
          />
          <Info label="Status" value={service.status} />
          {outlet.kind === "legacy_multi_branch" ? <Info label="Branch" value={service.branch?.name ?? "All branches"} /> : null}
          <Info
            label={isSalonBusiness ? "Service usage" : "Work order usage"}
            value={service._count.items}
          />
          <Info label="Package usage" value={service._count.packages} />
          {isSalonBusiness ? (
            <Info
              label="Duration"
              value={
                service.durationMinutes
                  ? `${service.durationMinutes} minutes`
                  : "Not set"
              }
            />
          ) : null}
          {isSalonBusiness ? (
            <Info
              label="Available staff"
              value={service.staffAssignments.length}
            />
          ) : null}
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Edit service</h2>
          </div>
          <ServiceForm
            action={updateWithCurrentOutlet}
            outlet={outlet}
            companySstRate={companyTax?.sstRate == null ? null : Number(companyTax.sstRate)}
            service={service}
            branches={branches}
            categories={categories}
            isSalonBusiness={isSalonBusiness}
            staffOptions={staffOptions.map((staff) => ({
              id: staff.id,
              name: staff.name,
              role: staff.role,
              branchName: staff.branch?.name ?? null,
            }))}
            selectedStaffIds={service.staffAssignments.map(
              (assignment) => assignment.userId,
            )}
            formId={formId}
          />
          <div className="form-actions service-action-row">
            <button type="submit" form={formId}>
              Save
            </button>
            <DeleteServiceForm serviceId={service.id} serviceName={service.name} />
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
