import { AppShell } from "@/components/app-shell";
import { AppointmentCustomerPicker } from "@/components/appointment-customer-picker";
import { AppointmentVehiclePicker } from "@/components/appointment-vehicle-picker";
import { BackButton } from "@/components/back-button";
import { BranchSelect } from "@/components/branch-select";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createAppointmentAction } from "../actions";

type NewAppointmentPageProps = {
  searchParams: Promise<{
    date?: string;
    time?: string;
  }>;
};

export default async function NewAppointmentPage({
  searchParams,
}: NewAppointmentPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  const params = await searchParams;
  const staffWhere =
    user.role === "BUSINESS_OWNER"
      ? { businessId, status: "active" as const }
      : {
          businessId,
          status: "active" as const,
          OR: [{ branchId: user.branchId }, { id: user.userId }],
        };
  const [branches, appointmentSubjectCount, services, staffUsers] = await Promise.all([
    getOperationalBranches(businessId, user),
    isSalonBusiness
      ? prisma.customer.count({ where: { businessId } })
      : prisma.vehicle.count({ where: { businessId } }),
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: staffWhere,
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
      },
    }),
  ]);
  const today = new Date();
  const defaultDate = parseDateParam(params.date) ?? today.toISOString().slice(0, 10);
  const defaultTime = parseTimeParam(params.time) ?? `${String(today.getHours()).padStart(2, "0")}:${String(
    Math.ceil(today.getMinutes() / 15) * 15,
  ).padStart(2, "0")}`.replace(":60", ":00");
  const scheduledPreview = new Date(`${defaultDate}T${defaultTime}:00`);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Appointment</h1>
            <p>
              {isSalonBusiness
                ? "Schedule a customer visit and select services when ready."
                : "Schedule a customer visit before creating a job."}
            </p>
          </div>
          <BackButton fallbackHref="/appointments" />
        </div>

        <div className="panel appointment-create-panel">
          {appointmentSubjectCount ? (
            <form action={createAppointmentAction} className="appointment-create-form">
              <input name="scheduledDate" type="hidden" value={defaultDate} />
              <input name="scheduledTime" type="hidden" value={defaultTime} />
              <input name="notes" type="hidden" value="" />
              <div className="appointment-create-card">
                <div className="appointment-create-summary">
                  <span>{"\u25a6"}</span>
                  <div>
                    <strong>
                      {scheduledPreview.toLocaleDateString("en-MY", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    <small>
                      {scheduledPreview.toLocaleTimeString("en-MY", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                </div>

                <div className="appointment-create-primary">
                  {isSalonBusiness ? (
                    <AppointmentCustomerPicker />
                  ) : (
                    <AppointmentVehiclePicker />
                  )}
                </div>

                <div className="appointment-create-secondary">
                  <BranchSelect branches={branches} />
                  <label>
                    <span>Service optional</span>
                    <select name="serviceId" defaultValue="">
                      <option value="">Choose later</option>
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} - RM{Number(service.price).toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Staff optional</span>
                    <select name="assignedStaffId" defaultValue="">
                      <option value="">Unassigned</option>
                      {staffUsers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                          {staff.role === "BUSINESS_OWNER" ? " (Owner)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="appointment-create-actions">
                  <button type="submit">Create appointment</button>
                </div>
              </div>
            </form>
          ) : (
            <p className="empty-state">
              {isSalonBusiness
                ? "Create a customer before scheduling an appointment."
                : "Create a customer and vehicle before scheduling an appointment."}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function parseDateParam(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? null : value;
}

function parseTimeParam(value?: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(":").map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return value;
}
