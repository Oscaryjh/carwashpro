import { AppShell } from "@/components/app-shell";
import { notFound } from "next/navigation";
import { BusinessForm } from "@/components/business-form";
import { ModuleAccessManager } from "@/components/module-access-manager";
import { AdminBusinessWorkspace } from "@/components/admin-business-workspace";
import { assertCanAccessBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { getBusinessModuleAdminView } from "@/lib/modules/service";
import { prisma } from "@/lib/prisma";
import {
  changeBusinessModuleEntitlementAction,
  updateAdminBusinessBranchStatusAction,
  updateBusinessAction,
} from "../actions";

type BusinessDetailsPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ type?: string; message?: string }>;
};

export default async function BusinessDetailsPage({
  params,
  searchParams,
}: BusinessDetailsPageProps) {
  const { businessId } = await params;
  const query = await searchParams;
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  assertCanAccessBusiness(user, businessId);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      branches: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
      users: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!business) notFound();

  const moduleView = await getBusinessModuleAdminView(business.id);
  const now = new Date();
  const enabledModuleCount = moduleView.modules.filter(
    ({ definition, entitlement }) =>
      definition.isCore ||
      Boolean(
        entitlement &&
          entitlement.status === "ENABLED",
      ),
  ).length;

  return (
    <AppShell user={user}>
      <AdminBusinessWorkspace
        key={business.id}
        business={{ id: business.id, name: business.name, slug: business.slug, status: business.status, companyNo: business.companyNo, industry: getBusinessIndustryLabel(business.industryType) }}
        branches={business.branches.map(({ id, name, phone, address, status }) => ({ id, name, phone, address, status }))}
        users={business.users.map(({ id, name, email, role, status }) => ({ id, name, email, role, status }))}
        enabledModules={enabledModuleCount}
        result={query}
        branchStatusAction={updateAdminBusinessBranchStatusAction}
        profile={<BusinessForm action={updateBusinessAction} mode="edit" business={business} canEditStatus workspaceLayout />}
        modules={<ModuleAccessManager
          embedded
          businessId={business.id}
          evaluatedAt={now.toISOString()}
          initialRows={moduleView.modules.map(({ definition, entitlement }) => ({
            key: definition.key,
            status: definition.isCore ? "ENABLED" : entitlement?.status ?? "DISABLED",
            from: (entitlement?.enabledFrom ?? now).toISOString(),
            until: entitlement?.enabledUntil?.toISOString() ?? null,
            plan: entitlement?.planCode ?? "",
            revision: entitlement?.revision ?? null,
            source: entitlement?.source ?? null,
          }))}
          action={changeBusinessModuleEntitlementAction}
          result={query}
        />}
      />
    </AppShell>
  );
}
