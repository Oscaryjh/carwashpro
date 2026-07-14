import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BranchForm } from "@/components/branch-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { updateBranchAction } from "../actions";

type BranchDetailsPageProps = {
  params: Promise<{
    branchId: string;
  }>;
};

export default async function BranchDetailsPage({
  params,
}: BranchDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "BRANCHES");
  const { branchId } = await params;
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      businessId,
    },
    include: {
      _count: {
        select: {
          customers: true,
          workOrders: true,
          invoices: true,
        },
      },
    },
  });

  if (!branch) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{branch.name}</h1>
            <p>{formatStatus(branch.status)}</p>
          </div>
          <BackButton fallbackHref="/branches" />
        </div>

        <div className="grid">
          <Info label="Phone" value={branch.phone || "No phone"} />
          <Info label="Address" value={branch.address || "No address"} />
          <Info label="Customers" value={branch._count.customers} />
          <Info label="Jobs" value={branch._count.workOrders} />
          <Info label="Invoices" value={branch._count.invoices} />
        </div>

        <div className="panel branch-edit-panel">
          <h2>Edit branch</h2>
          <BranchForm
            action={updateBranchAction}
            branch={branch}
            submitLabel="Save branch"
          />
        </div>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
