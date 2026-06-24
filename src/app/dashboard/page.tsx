import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";

export default async function DashboardPage() {
  const context = await getBusinessContext();

  if (context.isPlatformAdmin) {
    const [businessCount, activeBusinessCount, userCount] = await Promise.all([
      prisma.business.count(),
      prisma.business.count({ where: { status: "active" } }),
      prisma.user.count(),
    ]);

    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="page-header">
            <div>
              <h1>Platform dashboard</h1>
              <p>System-wide SaaS setup status.</p>
            </div>
          </div>
          <div className="grid">
            <Metric label="Businesses" value={businessCount} />
            <Metric label="Active businesses" value={activeBusinessCount} />
            <Metric label="Users" value={userCount} />
          </div>
        </section>
      </AppShell>
    );
  }

  const businessId = context.businessId;

  if (!businessId) {
    throw new Error("Business context is required.");
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{business.name}</h1>
            <p>Tenant workspace for CRM and POS modules.</p>
          </div>
        </div>
        <div className="grid">
          <Metric label="Business ID" value={business.id} compact />
          <Metric label="Status" value={business.status} />
          <Metric
            label="Role"
            value={context.user.role.toLowerCase().replace("_", " ")}
          />
        </div>
        <div className="panel">
          <h2>Business workspace</h2>
          <p className="muted">
            Customers, vehicles, services, work orders, POS payments, invoices,
            and WhatsApp message logs are available under this business ID scope.
          </p>
        </div>
      </section>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={compact ? { fontSize: 15, overflowWrap: "anywhere" } : undefined}>
        {value}
      </strong>
    </div>
  );
}
