import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BranchForm } from "@/components/branch-form";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createAdminBusinessBranchAction } from "../../../actions";

type NewAdminBranchPageProps = {
  params: Promise<{
    businessId: string;
  }>;
};

export default async function NewAdminBranchPage({ params }: NewAdminBranchPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const { businessId } = await params;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true },
  });

  if (!business) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New branch</h1>
            <p>Provision an additional location for {business.name}.</p>
          </div>
          <BackButton fallbackHref={`/admin/businesses/${business.id}`} />
        </div>

        <div className="panel">
          <BranchForm
            action={createAdminBusinessBranchAction}
            businessId={business.id}
            submitLabel="Create branch"
          />
        </div>
      </section>
    </AppShell>
  );
}
