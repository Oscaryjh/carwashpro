import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";

export default async function SalonDashboardPage() {
  const context = await getBusinessContext();

  if (context.isPlatformAdmin) {
    redirect("/admin/businesses");
  }

  if (context.industryType !== "SALON_BEAUTY") {
    redirect("/dashboard");
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const branchFilter =
    context.user.role === "BUSINESS_OWNER"
      ? {}
      : { branchId: context.user.branchId ?? "00000000-0000-0000-0000-000000000000" };
  const [todayAppointments, waiting, inService, completedToday] = await Promise.all([
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        scheduledAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        status: { in: ["SCHEDULED", "CONFIRMED", "ARRIVED"] },
        scheduledAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        status: "IN_SERVICE",
      },
    }),
    prisma.appointment.count({
      where: {
        businessId: context.businessId,
        ...branchFilter,
        status: "COMPLETED",
        completedAt: { gte: todayStart, lt: todayEnd },
      },
    }),
  ]);

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Salon &amp; Beauty</h1>
          </div>
        </div>

        <div className="dashboard-kpis">
          <Metric label="Today&apos;s appointments" value={String(todayAppointments)} />
          <Metric label="Waiting" value={String(waiting)} />
          <Metric label="In service" value={String(inService)} />
          <Metric label="Completed today" value={String(completedToday)} />
        </div>

        <div className="dashboard-grid">
          <section className="panel">
            <h2>Today&apos;s schedule</h2>
            <p className="empty-state">No appointments yet.</p>
          </section>
          <section className="panel">
            <h2>Staff availability</h2>
            <p className="empty-state">No staff schedule yet.</p>
          </section>
        </div>
      </section>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
