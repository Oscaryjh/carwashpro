import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { DeleteServiceForm } from "@/components/delete-service-form";
import { ServiceForm } from "@/components/service-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { updateServiceAction } from "../actions";

type ServiceDetailsPageProps = {
  params: Promise<{
    serviceId: string;
  }>;
};

export default async function ServiceDetailsPage({
  params,
}: ServiceDetailsPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");
  const isSalonBusiness = industryType === "SALON_BEAUTY";

  const { serviceId } = await params;

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

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{service.name}</h1>
            <p>RM{Number(service.price).toFixed(2)}</p>
          </div>
          <BackButton fallbackHref="/services" />
        </div>

        <div className="grid">
          <Info
            label="Category"
            value={service.serviceCategory?.name ?? service.category ?? "-"}
          />
          <Info label="Status" value={service.status} />
          <Info label="Branch" value={service.branch?.name ?? "All branches"} />
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
            action={updateServiceAction}
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
