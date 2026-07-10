import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { ServiceForm } from "@/components/service-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createServiceAction } from "../actions";

export default async function NewServicePage() {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

  const [branches, categories] = await Promise.all([
    getActiveBranches(businessId),
    prisma.serviceCategory.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Service</h1>
            <p>Create one service item with its own price.</p>
          </div>
          <BackButton fallbackHref="/services" />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Service details</h2>
            <Link className="secondary-link-button compact-link-button" href="/services/categories">
              Manage categories
            </Link>
          </div>
          <ServiceForm
            action={createServiceAction}
            branches={branches}
            categories={categories}
            submitLabel="Create service"
          />
        </div>
      </section>
    </AppShell>
  );
}
