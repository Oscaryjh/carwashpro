import { AppointmentCustomerPicker } from "@/components/appointment-customer-picker";
import { AppointmentVehiclePicker } from "@/components/appointment-vehicle-picker";
import { BackButton } from "@/components/back-button";
import { PosLocationGuidance, PosOutletBranchField } from "@/components/pos-outlet-presentation";
import { guardPosOutletSubmission, resolvePosOutletContext } from "@/lib/pos-outlet-context";
import {
  buildAppointmentStaffWhere,
  NO_APPOINTMENT_BRANCH_ID,
} from "@/lib/appointments/staff-branch-scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import {
  addDaysToDateValue,
  formatDateValue,
  getBusinessDateTimeParts,
  isValidDateValue,
} from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import { createAppointmentAction } from "../actions";

type NewAppointmentPageProps = {
  searchParams: Promise<{
    date?: string;
    time?: string;
    branchId?: string;
  }>;
};

export default async function NewAppointmentPage({
  searchParams,
}: NewAppointmentPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser(
    "VIEW_APPOINTMENTS",
  );
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  const params = await searchParams;
  const outlet = await resolvePosOutletContext({ businessId, actorUserId: user.userId, capability: "VIEW_APPOINTMENTS", operation: "read",
    ...(params.branchId !== undefined ? { explicitBranchInput: params.branchId } : {}) });
  if (outlet.kind === "denied") return <section className="content"><h1>New Appointment</h1><p role="alert">Appointment access is unavailable for your operating location.</p></section>;
  if (outlet.kind === "no_location") return <section className="content"><h1>New Appointment</h1><PosLocationGuidance owner={user.role === "BUSINESS_OWNER"} /></section>;
  async function createOutletAppointment(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUser("MODIFY_APPOINTMENTS");
    await guardPosOutletSubmission({ businessId: fresh.businessId, actorUserId: fresh.user.userId,
      capability: "MODIFY_APPOINTMENTS", operation: "write", rendered: outlet, formData });
    return createAppointmentAction(formData);
  }
  const staffWhere =
    outlet.kind === "single_outlet" ? buildAppointmentStaffWhere({ businessId, branchId: outlet.internalBranchId }) : user.role === "BUSINESS_OWNER"
      ? { businessId, status: "active" as const, appointmentBookable: true }
      : buildAppointmentStaffWhere({
          at: new Date(),
          branchId: user.branchId ?? NO_APPOINTMENT_BRANCH_ID,
          businessId,
          includeUserId: user.userId,
        });
  const [branches, appointmentSubjectCount, services, staffUsers] = await Promise.all([
    getOperationalBranches(businessId, user),
    isSalonBusiness
      ? prisma.customer.count({ where: { businessId } })
      : prisma.vehicle.count({ where: { businessId } }),
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
        ...(outlet.kind === "single_outlet" ? { OR: [{ branchId: null }, { branchId: outlet.internalBranchId }] } : {}),
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
  const now = getBusinessDateTimeParts();
  const currentDateValue = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  const roundedMinutes = Math.ceil(now.minute / 15) * 15;
  const rollsToNextDay = now.hour === 23 && roundedMinutes === 60;
  const defaultDate = parseDateParam(params.date)
    ?? (rollsToNextDay ? addDaysToDateValue(currentDateValue, 1) : currentDateValue);
  const defaultTime = parseTimeParam(params.time)
    ?? `${String((now.hour + Math.floor(roundedMinutes / 60)) % 24).padStart(2, "0")}:${String(roundedMinutes % 60).padStart(2, "0")}`;

  return (
    <>
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
            <form action={createOutletAppointment} className="appointment-create-form">
              <input name="scheduledDate" type="hidden" value={defaultDate} />
              <input name="scheduledTime" type="hidden" value={defaultTime} />
              <input name="notes" type="hidden" value="" />
              <div className="appointment-create-card">
                <div className="appointment-create-summary">
                  <span>{"\u25a6"}</span>
                  <div>
                    <strong>
                      {formatDateValue(defaultDate, {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    <small>{formatTimeLabel(defaultTime)}</small>
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
                  <PosOutletBranchField singleOutlet={outlet.kind === "single_outlet"} branches={branches}
                    branchId={outlet.kind === "single_outlet" ? outlet.internalBranchId : params.branchId} />
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
    </>
  );
}

function parseDateParam(value?: string) {
  return value && isValidDateValue(value) ? value : null;
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

function formatTimeLabel(timeValue: string) {
  const [hourValue, minuteValue] = timeValue.split(":").map(Number);
  const period = hourValue >= 12 ? "pm" : "am";
  const hour = hourValue % 12 || 12;

  return `${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
}
