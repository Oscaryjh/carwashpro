import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
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
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

  const { serviceId } = await params;

  const [service, branches, categories] = await Promise.all([
    prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId,
      },
      include: {
        branch: true,
        serviceCategory: true,
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
  ]);

  if (!service) {
    notFound();
  }

  const formId = `service-form-${service.id}`;

  return (
    <AppShell user={user}>
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
            value={service.serviceCategory?.name ?? service.category ?? "Uncategorized"}
          />
          <Info label="Status" value={service.status} />
          <Info label="Branch" value={service.branch?.name ?? "All branches"} />
          <Info label="Work order usage" value={service._count.items} />
          <Info label="Package usage" value={service._count.packages} />
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
