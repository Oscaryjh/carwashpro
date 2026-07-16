"use client";

import { AppointmentVehiclePicker } from "@/components/appointment-vehicle-picker";
import { AppointmentCustomerPicker } from "@/components/appointment-customer-picker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useState, useTransition } from "react";

export type AppointmentCalendarItem = {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  contactType: string;
  customerName: string;
  customerPhone: string;
  plateNumber: string | null;
  scheduledAt: string;
  serviceName: string | null;
  serviceNames: string[];
  serviceDetails: {
    id: string;
    name: string;
    price: string;
  }[];
  serviceIds: string[];
  staffId: string | null;
  staffName: string | null;
  status: string;
  workOrderPaymentStatus: string | null;
  workOrderStatus: string | null;
  workOrderId: string | null;
};

type AppointmentCalendarProps = {
  appointments: AppointmentCalendarItem[];
  branches: {
    id: string;
    name: string;
  }[];
  createAppointmentAction: (formData: FormData) => Promise<void>;
  convertAppointmentAction: (formData: FormData) => Promise<void>;
  datePickerCounts: {
    count: number;
    date: string;
  }[];
  datePickerHrefPrefix: string;
  isSalonBusiness: boolean;
  days: {
    count: number;
    date: string;
    label: string;
    shortLabel: string;
  }[];
  nextHref: string;
  previousHref: string;
  rescheduleAction: (formData: FormData) => Promise<void>;
  selectedDateLabel: string;
  selectedDateValue: string;
  services: {
    category: string;
    durationMinutes: number | null;
    id: string;
    name: string;
    price: string;
    staffIds: string[];
  }[];
  staffMembers: {
    id: string;
    name: string;
    role: string;
  }[];
  updateAppointmentAction: (formData: FormData) => Promise<void>;
  updateAppointmentStatusAction: (formData: FormData) => Promise<void>;
};

type CalendarStaffSlot = {
  id: string | null;
  name: string;
  role: string;
  isEmpty?: boolean;
};

const BUSINESS_HOUR_STORAGE_KEY = "washflow:appointment-business-hours";

export function AppointmentCalendar({
  appointments,
  branches,
  createAppointmentAction,
  convertAppointmentAction,
  datePickerCounts,
  datePickerHrefPrefix,
  isSalonBusiness,
  days,
  nextHref,
  previousHref,
  rescheduleAction,
  selectedDateLabel,
  selectedDateValue,
  services,
  staffMembers,
  updateAppointmentAction,
  updateAppointmentStatusAction,
}: AppointmentCalendarProps) {
  const router = useRouter();
  const [isBusinessHourOpen, setIsBusinessHourOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isNewAppointmentOpen, setIsNewAppointmentOpen] = useState(false);
  const [isNewTimeOpen, setIsNewTimeOpen] = useState(false);
  const [timeModalDrag, setTimeModalDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [timeModalOffset, setTimeModalOffset] = useState({ x: 0, y: 0 });
  const [isResizeOpen, setIsResizeOpen] = useState(false);
  const [calendarResize, setCalendarResize] = useState(7);
  const [businessEndTime, setBusinessEndTime] = useState("22:00");
  const [businessStartTime, setBusinessStartTime] = useState("10:00");
  const [draftDate, setDraftDate] = useState(selectedDateValue);
  const [datePickerTarget, setDatePickerTarget] = useState<"page" | "newAppointment">("page");
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(selectedDateValue.slice(0, 7));
  const [draftEndTime, setDraftEndTime] = useState("22:00");
  const [draftStartTime, setDraftStartTime] = useState("10:00");
  const [useDailyTime, setUseDailyTime] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newAppointmentDate, setNewAppointmentDate] = useState(selectedDateValue);
  const [newAppointmentContactType, setNewAppointmentContactType] = useState<
    "REGISTERED_OWNER" | "OTHER_PERSON"
  >("REGISTERED_OWNER");
  const [newAppointmentStaffId, setNewAppointmentStaffId] = useState("");
  const [newAppointmentTime, setNewAppointmentTime] = useState("10:00");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentCalendarItem | null>(null);
  const [isAppointmentMenuOpen, setIsAppointmentMenuOpen] = useState(false);
  const [appointmentEditor, setAppointmentEditor] = useState<"time" | "service" | "staff" | null>(
    null,
  );
  const [editAppointmentDate, setEditAppointmentDate] = useState(selectedDateValue);
  const [editAppointmentStaffId, setEditAppointmentStaffId] = useState("");
  const [editAppointmentTime, setEditAppointmentTime] = useState("10:00");
  const [editAppointmentServiceIds, setEditAppointmentServiceIds] = useState<string[]>([]);
  const [isServicePickerOpen, setIsServicePickerOpen] = useState(false);
  const [activeServiceCategory, setActiveServiceCategory] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [showEarlierSlots, setShowEarlierSlots] = useState(false);
  const [isPending, startTransition] = useTransition();
  const grouped = groupAppointments(appointments);
  const selectedServices = selectedServiceIds
    .map((serviceId) => services.find((service) => service.id === serviceId))
    .filter((service): service is (typeof services)[number] => Boolean(service));
  const newAppointmentStaffMembers = filterStaffForServices(
    staffMembers,
    selectedServiceIds,
    services,
  );
  const editAppointmentStaffMembers = filterStaffForServices(
    staffMembers,
    editAppointmentServiceIds,
    services,
  );
  const serviceCategories = getServiceCategories(services);
  const visibleServiceCategory = activeServiceCategory || serviceCategories[0] || "";
  const visibleServices = visibleServiceCategory
    ? services.filter((service) => service.category === visibleServiceCategory)
    : services;
  const dateCountByDay = new Map(datePickerCounts.map((day) => [day.date, day.count]));
  const newAppointmentDays = buildAppointmentWeekDays(newAppointmentDate, dateCountByDay);
  const visibleMonthDate = monthValueToDate(visibleMonth);
  const visibleMonthLabel = visibleMonthDate.toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
  });
  const visibleDatePickerDays = buildDatePickerDays(visibleMonthDate, dateCountByDay);
  const allTimeSlots = buildTimeSlots(businessStartTime, businessEndTime);
  const shouldHidePastSlots = isTodayDateValue(selectedDateValue) && !showEarlierSlots;
  const hiddenPastSlots = shouldHidePastSlots
    ? allTimeSlots.filter((time) => isPastAppointmentSlot(selectedDateValue, time))
    : [];
  const visibleTimeSlots = shouldHidePastSlots
    ? allTimeSlots.filter((time) => !isPastAppointmentSlot(selectedDateValue, time))
    : allTimeSlots;
  const hiddenPastAppointmentCount = countAppointmentsInSlots(
    hiddenPastSlots,
    selectedDateValue,
    appointments,
  );
  const calendarStaffSlots = buildStaffSlots(staffMembers);
  const calendarStyle = {
    "--appointment-slot-height": `${36 + calendarResize}px`,
  } as CSSProperties;

  useEffect(() => {
    const savedHours = readStoredBusinessHours();

    if (!savedHours) {
      return;
    }

    setBusinessStartTime(savedHours.startTime);
    setBusinessEndTime(savedHours.endTime);
    setDraftStartTime(savedHours.startTime);
    setDraftEndTime(savedHours.endTime);
  }, []);

  useEffect(() => {
    setShowEarlierSlots(false);
  }, [selectedDateValue]);

  useEffect(() => {
    if (
      newAppointmentStaffId &&
      !newAppointmentStaffMembers.some((staff) => staff.id === newAppointmentStaffId)
    ) {
      setNewAppointmentStaffId("");
    }
  }, [newAppointmentStaffId, newAppointmentStaffMembers]);

  useEffect(() => {
    if (
      editAppointmentStaffId &&
      !editAppointmentStaffMembers.some((staff) => staff.id === editAppointmentStaffId)
    ) {
      setEditAppointmentStaffId("");
    }
  }, [editAppointmentStaffId, editAppointmentStaffMembers]);

  function handleDrop(date: string, time: string, staffId: string) {
    if (!draggingId) {
      return;
    }

    const formData = new FormData();
    formData.set("appointmentId", draggingId);
    formData.set("scheduledDate", date);
    formData.set("scheduledTime", time);
    formData.set("assignedStaffId", staffId);

    startTransition(async () => {
      await rescheduleAction(formData);
      setDraggingId(null);
      setDropTarget(null);
      router.refresh();
    });
  }

  function openNewAppointmentForSlot(date: string, time: string, staffId: string) {
    setNewAppointmentDate(date);
    setNewAppointmentTime(time);
    setNewAppointmentContactType("REGISTERED_OWNER");
    setNewAppointmentStaffId(staffId);
    setSelectedServiceIds([]);
    setIsNewAppointmentOpen(true);
  }

  function openAppointmentEditor(
    appointment: AppointmentCalendarItem,
    editor: "time" | "service" | "staff",
  ) {
    const scheduledAt = new Date(appointment.scheduledAt);
    setEditAppointmentDate(toDateValue(scheduledAt));
    setEditAppointmentTime(toTimeValue(scheduledAt));
    setEditAppointmentStaffId(appointment.staffId ?? "");
    setEditAppointmentServiceIds(appointment.serviceIds);
    setIsAppointmentMenuOpen(false);
    setAppointmentEditor(editor);
  }

  function handleAppointmentUpdate(formData: FormData) {
    if (!selectedAppointment) {
      return;
    }

    formData.set("appointmentId", selectedAppointment.id);
    formData.set("scheduledDate", editAppointmentDate);
    formData.set("scheduledTime", editAppointmentTime);
    formData.set("assignedStaffId", editAppointmentStaffId);
    formData.delete("serviceIds");
    normalizeServiceIdsByCategory(editAppointmentServiceIds, services).forEach((serviceId) =>
      formData.append("serviceIds", serviceId),
    );

    startTransition(async () => {
      await updateAppointmentAction(formData);
      setAppointmentEditor(null);
      setSelectedAppointment(null);
      router.refresh();
    });
  }

  function delayAppointment(minutes: number) {
    if (!selectedAppointment) {
      return;
    }

    const nextDate = new Date(selectedAppointment.scheduledAt);
    nextDate.setMinutes(nextDate.getMinutes() + minutes);
    const formData = new FormData();
    formData.set("appointmentId", selectedAppointment.id);
    formData.set("scheduledDate", toDateValue(nextDate));
    formData.set("scheduledTime", toTimeValue(nextDate));
    formData.set("assignedStaffId", selectedAppointment.staffId ?? "");
    selectedAppointment.serviceIds.forEach((serviceId) => formData.append("serviceIds", serviceId));

    startTransition(async () => {
      await updateAppointmentAction(formData);
      setAppointmentEditor(null);
      setIsAppointmentMenuOpen(false);
      setSelectedAppointment(null);
      router.refresh();
    });
  }

  function updateAppointmentStatus(
    status: "CONFIRMED" | "ARRIVED" | "IN_SERVICE" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
  ) {
    if (!selectedAppointment) {
      return;
    }

    if (
      status === "CANCELLED" &&
      !window.confirm("Cancel this appointment? This action will remove it from the active calendar.")
    ) {
      return;
    }

    const formData = new FormData();
    formData.set("appointmentId", selectedAppointment.id);
    formData.set("status", status);
    formData.set("redirectTo", "/appointments");

    startTransition(async () => {
      await updateAppointmentStatusAction(formData);
      setAppointmentEditor(null);
      setIsAppointmentMenuOpen(false);
      setSelectedAppointment(null);
      router.refresh();
    });
  }

  function handleTimeModalPointerDown(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setTimeModalDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: timeModalOffset.x,
      originY: timeModalOffset.y,
    });
  }

  function handleTimeModalPointerMove(event: PointerEvent<HTMLElement>) {
    if (!timeModalDrag || timeModalDrag.pointerId !== event.pointerId) {
      return;
    }

    setTimeModalOffset({
      x: timeModalDrag.originX + event.clientX - timeModalDrag.startX,
      y: timeModalDrag.originY + event.clientY - timeModalDrag.startY,
    });
  }

  function handleTimeModalPointerUp(event: PointerEvent<HTMLElement>) {
    if (!timeModalDrag || timeModalDrag.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setTimeModalDrag(null);
  }

  return (
    <div className="appointment-calendar">
      <div className="appointment-calendar-toolbar">
        <div className="appointment-calendar-toolbar-left">
          <button
            className="appointment-calendar-date"
            onClick={() => {
              setDatePickerTarget("page");
              setDraftDate(selectedDateValue);
              setVisibleMonth(selectedDateValue.slice(0, 7));
              setIsMonthPickerOpen(false);
              setIsDatePickerOpen(true);
            }}
            type="button"
          >
            <span aria-hidden="true">{"\ud83d\udcc5"}</span>
            {selectedDateLabel}
          </button>
        </div>

        <div className="appointment-calendar-toolbar-right">
          {isPending ? <span className="status">saving</span> : null}
          <button
            aria-label="Resize calendar"
            className="appointment-calendar-icon-link"
            onClick={() => setIsResizeOpen(true)}
            title="Resize calendar"
            type="button"
          >
            <span aria-hidden="true" className="appointment-calendar-icon-glyph">
              {"\u2194"}
            </span>
          </button>
          <button
            aria-label="New appointment"
            className="appointment-calendar-icon-link"
            onClick={() => {
              setNewAppointmentDate(toDateValue(new Date()));
              setNewAppointmentStaffId("");
              setSelectedServiceIds([]);
              setTimeModalOffset({ x: 0, y: 0 });
              setIsNewTimeOpen(true);
            }}
            title="New appointment"
            type="button"
          >
            <span aria-hidden="true" className="appointment-calendar-icon-glyph">
              +
            </span>
          </button>
        </div>
      </div>

      <div className="appointment-calendar-grid" style={calendarStyle}>
        <button
          className="appointment-calendar-time-head"
          onClick={() => {
            setDraftStartTime(businessStartTime);
            setDraftEndTime(businessEndTime);
            setIsBusinessHourOpen(true);
          }}
          type="button"
          aria-label="Business hour"
        >
          <span>{"\u2699"}</span>
        </button>
        <Link
          aria-label="Previous week"
          className="appointment-calendar-week-nav previous"
          href={previousHref}
        >
          {"\u2039"}
        </Link>
        {days.map((day) => (
          <Link
            className={`appointment-calendar-day-head${
              day.date === selectedDateValue ? " selected" : ""
            }`}
            href={`${datePickerHrefPrefix}${day.date}`}
            key={day.date}
          >
            <strong>{day.shortLabel}</strong>
            <span>{day.label}</span>
            <small>{day.count} appts</small>
          </Link>
        ))}
        <Link aria-label="Next week" className="appointment-calendar-week-nav next" href={nextHref}>
          {"\u203a"}
        </Link>

        <div className="appointment-calendar-staff-head">Staff</div>
        <div className="appointment-calendar-staff-row">
          {staffMembers.length ? (
            calendarStaffSlots.map((staff, index) =>
              staff.isEmpty ? (
                <div
                  aria-hidden="true"
                  className="appointment-calendar-staff-card is-empty"
                  key={`empty-staff-${index}`}
                />
              ) : (
                <div className="appointment-calendar-staff-card" key={staff.id}>
                  <span>{getInitials(staff.name)}</span>
                  <strong>{staff.name}</strong>
                  <small>{staff.role === "BUSINESS_OWNER" ? "Owner" : "Staff"}</small>
                </div>
              ),
            )
          ) : (
            <p>No staff assigned.</p>
          )}
        </div>

        {hiddenPastSlots.length ? (
          <button
            className="appointment-calendar-earlier-toggle"
            onClick={() => setShowEarlierSlots(true)}
            type="button"
          >
            <span>Earlier time hidden</span>
            <strong>{hiddenPastAppointmentCount ? `${hiddenPastAppointmentCount} appointments earlier` : "Show earlier"}</strong>
          </button>
        ) : showEarlierSlots && isTodayDateValue(selectedDateValue) ? (
          <button
            className="appointment-calendar-earlier-toggle"
            onClick={() => setShowEarlierSlots(false)}
            type="button"
          >
            <span>Earlier time shown</span>
            <strong>Hide earlier</strong>
          </button>
        ) : null}

        {visibleTimeSlots.map((time) => (
          <CalendarRow
            appointmentsBySlot={grouped}
            draggingId={draggingId}
            dropTarget={dropTarget}
            key={time}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragOver={(target) => setDropTarget(target)}
            onDragStart={setDraggingId}
            onCreate={openNewAppointmentForSlot}
            onDrop={handleDrop}
            onOpen={(appointment) => {
              setIsAppointmentMenuOpen(false);
              setAppointmentEditor(null);
              setSelectedAppointment(appointment);
            }}
            selectedDate={selectedDateValue}
            staffSlots={calendarStaffSlots}
            time={time}
          />
        ))}
      </div>

      {isDatePickerOpen ? (
        <div className="date-popover-backdrop" role="presentation">
          <section aria-labelledby="date-picker-title" className="date-popover" role="dialog">
            <div className="date-popover-header">
              <button
                aria-label="Close date picker"
                className="date-popover-close"
                onClick={() => setIsDatePickerOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="date-picker-title">Date</h2>
              <button
                className="date-popover-save"
                onClick={() => {
                  if (datePickerTarget === "newAppointment") {
                    setNewAppointmentDate(draftDate);
                  } else {
                    router.push(`${datePickerHrefPrefix}${draftDate}`);
                  }
                  setIsDatePickerOpen(false);
                }}
                type="button"
              >
                Save
              </button>
            </div>

            <div className="date-popover-month-row">
              <button
                aria-expanded={isMonthPickerOpen}
                className="date-popover-month-title"
                onClick={() => setIsMonthPickerOpen((current) => !current)}
                type="button"
              >
                {visibleMonthLabel} <span>{isMonthPickerOpen ? "\u2039" : "\u203a"}</span>
              </button>
              {!isMonthPickerOpen ? (
                <div className="date-popover-month-actions">
                  <button
                    aria-label="Previous month"
                    onClick={() => setVisibleMonth(addMonthsToMonthValue(visibleMonth, -1))}
                    type="button"
                  >
                    {"\u2039"}
                  </button>
                  <button
                    aria-label="Next month"
                    onClick={() => setVisibleMonth(addMonthsToMonthValue(visibleMonth, 1))}
                    type="button"
                  >
                    {"\u203a"}
                  </button>
                </div>
              ) : null}
            </div>

            {isMonthPickerOpen ? (
              <MonthYearPicker
                onChange={(monthValue) => {
                  setVisibleMonth(monthValue);
                  setDraftDate(clampDraftDateToMonth(draftDate, monthValue));
                }}
                visibleMonth={visibleMonth}
              />
            ) : (
              <div className="date-picker-grid" aria-label="Appointment date">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday) => (
                  <span className="date-picker-weekday" key={weekday}>
                    {weekday}
                  </span>
                ))}
                {visibleDatePickerDays.map((day) => (
                  <button
                    className={[
                      "date-picker-day",
                      day.date === draftDate ? "is-selected" : "",
                      day.isCurrentMonth ? "" : "is-outside-month",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={day.date}
                    onClick={() => setDraftDate(day.date)}
                    type="button"
                  >
                    <span>{day.day}</span>
                    {day.count ? <small>{day.count}</small> : null}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {isNewTimeOpen ? (
        <div className="appointment-time-modal-backdrop" role="presentation">
          <section
            aria-labelledby="appointment-time-title"
            className={`appointment-time-modal ${timeModalDrag ? "is-dragging" : ""}`}
            role="dialog"
            style={{
              transform: `translate(${timeModalOffset.x}px, ${timeModalOffset.y}px)`,
            }}
          >
            <div
              className="appointment-time-modal-header"
              onPointerCancel={handleTimeModalPointerUp}
              onPointerDown={handleTimeModalPointerDown}
              onPointerMove={handleTimeModalPointerMove}
              onPointerUp={handleTimeModalPointerUp}
            >
              <button
                aria-label="Close select time"
                className="appointment-time-close"
                onClick={() => setIsNewTimeOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="appointment-time-title">Select Time</h2>
              <button
                aria-label="Choose date"
                className="appointment-time-calendar"
                onClick={() => {
                  setDatePickerTarget("newAppointment");
                  setDraftDate(newAppointmentDate);
                  setVisibleMonth(newAppointmentDate.slice(0, 7));
                  setIsMonthPickerOpen(false);
                  setIsDatePickerOpen(true);
                }}
                type="button"
              >
                {"\ud83d\udcc5"}
              </button>
            </div>

            <div className="appointment-time-days" aria-label="Select appointment day">
              <button
                aria-label="Previous week"
                className="appointment-time-week-nav"
                onClick={() => setNewAppointmentDate(addDaysToDateValue(newAppointmentDate, -7))}
                type="button"
              >
                {"\u2039"}
              </button>
              {newAppointmentDays.map((day) => (
                <button
                  className={day.date === newAppointmentDate ? "is-selected" : ""}
                  key={day.date}
                  onClick={() => setNewAppointmentDate(day.date)}
                  type="button"
                >
                  <span>{day.shortLabel}</span>
                  <strong>{new Date(`${day.date}T00:00:00`).getDate()}</strong>
                  <small>{day.count}</small>
                </button>
              ))}
              <button
                aria-label="Next week"
                className="appointment-time-week-nav"
                onClick={() => setNewAppointmentDate(addDaysToDateValue(newAppointmentDate, 7))}
                type="button"
              >
                {"\u203a"}
              </button>
            </div>

            <div className="appointment-time-grid">
              {visibleTimeSlots.map((time) => {
                const isPastTime = isPastAppointmentSlot(newAppointmentDate, time);

                return (
                  <button
                    disabled={isPastTime}
                    key={time}
                    onClick={() => {
                      setNewAppointmentTime(time);
                      setNewAppointmentContactType("REGISTERED_OWNER");
                      setNewAppointmentStaffId("");
                      setIsNewTimeOpen(false);
                      setIsNewAppointmentOpen(true);
                    }}
                    type="button"
                  >
                    {formatTimeLabel(time)}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {isNewAppointmentOpen ? (
        <div className="appointment-create-modal-backdrop" role="presentation">
          <section
            aria-labelledby="new-appointment-title"
            className="appointment-create-modal"
            role="dialog"
          >
            <div className="appointment-create-modal-header">
              <button
                aria-label="Close new appointment"
                className="appointment-time-close"
                onClick={() => setIsNewAppointmentOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="new-appointment-title">New Appointment</h2>
              <span />
            </div>
            <form action={createAppointmentAction} className="appointment-create-form">
              <input name="scheduledDate" type="hidden" value={newAppointmentDate} />
              <input name="scheduledTime" type="hidden" value={newAppointmentTime} />
              <input name="notes" type="hidden" value="" />
              <div className="appointment-create-card">
                <div className="appointment-create-summary">
                  <span>{"\ud83d\udcc5"}</span>
                  <div>
                    <strong>{formatLongDate(newAppointmentDate)}</strong>
                    <small>{formatTimeLabel(newAppointmentTime)}</small>
                  </div>
                </div>

                <div className="appointment-create-primary">
                  {isSalonBusiness ? <AppointmentCustomerPicker /> : <AppointmentVehiclePicker />}
                </div>

                <div className="appointment-create-secondary">
                  {!isSalonBusiness ? <section className="appointment-contact-card">
                    <h3>Pick up contact</h3>
                    <div className="job-contact-options appointment-contact-options">
                      <label
                        className={`option-card ${
                          newAppointmentContactType === "REGISTERED_OWNER" ? "is-selected" : ""
                        }`}
                      >
                        <input
                          checked={newAppointmentContactType === "REGISTERED_OWNER"}
                          name="contactType"
                          onChange={() => setNewAppointmentContactType("REGISTERED_OWNER")}
                          type="radio"
                          value="REGISTERED_OWNER"
                        />
                        <strong>Registered owner</strong>
                        <small>Use customer phone</small>
                      </label>
                      <label
                        className={`option-card ${
                          newAppointmentContactType === "OTHER_PERSON" ? "is-selected" : ""
                        }`}
                      >
                        <input
                          checked={newAppointmentContactType === "OTHER_PERSON"}
                          name="contactType"
                          onChange={() => setNewAppointmentContactType("OTHER_PERSON")}
                          type="radio"
                          value="OTHER_PERSON"
                        />
                        <strong>Other person</strong>
                        <small>Pickup contact</small>
                      </label>
                    </div>
                    {newAppointmentContactType === "OTHER_PERSON" ? (
                      <div className="appointment-contact-fields">
                        <label>
                          <span>Name</span>
                          <input name="contactName" placeholder="Pickup contact name" />
                        </label>
                        <label>
                          <span>Phone</span>
                          <input name="contactPhone" placeholder="Pickup phone" />
                        </label>
                      </div>
                    ) : (
                      <p>Ready reminders will use the registered owner.</p>
                    )}
                  </section> : null}

                  {branches.length === 1 ? (
                    <input name="branchId" type="hidden" value={branches[0].id} />
                  ) : (
                    <label>
                      <span>Branch</span>
                      <select name="branchId" defaultValue="" required>
                        <option value="" disabled>
                          Select branch
                        </option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectedServiceIds.map((serviceId) => (
                    <input key={serviceId} name="serviceIds" type="hidden" value={serviceId} />
                  ))}
                  <div className="appointment-service-summary">
                    {selectedServices.map((service) => (
                      <div className="appointment-service-summary-item" key={service.id}>
                        <span aria-hidden="true">{"\u25a7"}</span>
                        <div>
                          <strong>{service.name}</strong>
                          <small>{service.price}</small>
                        </div>
                      </div>
                    ))}
                    <button
                      className="appointment-service-trigger"
                      onClick={() => {
                        setActiveServiceCategory(
                          selectedServices[0]?.category ??
                            activeServiceCategory ??
                            serviceCategories[0] ??
                            "",
                        );
                        setIsServicePickerOpen(true);
                      }}
                      type="button"
                    >
                      <span>{"\u2295"}</span>
                      <strong>Select Service</strong>
                    </button>
                  </div>
                  <label>
                    <span>Staff optional</span>
                    <select
                      name="assignedStaffId"
                      onChange={(event) => setNewAppointmentStaffId(event.target.value)}
                      value={newAppointmentStaffId}
                    >
                      <option value="">Unassigned</option>
                      {newAppointmentStaffMembers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                          {staff.role === "BUSINESS_OWNER" ? " (Owner)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="appointment-create-actions">
                  <button type="submit">Confirm</button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedAppointment ? (
        <div className="appointment-detail-modal-backdrop" role="presentation">
          <div
            className={`appointment-detail-layout ${appointmentEditor ? "has-editor" : ""}`}
          >
            {appointmentEditor === "time" ? (
              <section
                aria-labelledby="appointment-edit-time-title"
                className="appointment-edit-modal"
                role="dialog"
              >
                <div className="appointment-edit-header">
                  <button
                    aria-label="Close time editor"
                    className="appointment-detail-close"
                    onClick={() => setAppointmentEditor(null)}
                    type="button"
                  >
                    {"\u00d7"}
                  </button>
                  <h2 id="appointment-edit-time-title">{formatLongDate(editAppointmentDate)}</h2>
                  <span />
                </div>
                <form action={handleAppointmentUpdate}>
                  <div className="appointment-edit-days">
                    {days.map((day) => (
                      <button
                        className={day.date === editAppointmentDate ? "is-selected" : ""}
                        key={day.date}
                        onClick={() => setEditAppointmentDate(day.date)}
                        type="button"
                      >
                        <span>{day.shortLabel}</span>
                        <strong>{new Date(`${day.date}T00:00:00`).getDate()}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="appointment-edit-time-grid">
                    {visibleTimeSlots.slice(0, 28).map((time) => (
                      <button
                        className={time === editAppointmentTime ? "is-selected" : ""}
                        key={time}
                        onClick={() => setEditAppointmentTime(time)}
                        type="button"
                      >
                        {formatTimeLabel(time)}
                      </button>
                    ))}
                  </div>
                  <button className="appointment-edit-save" type="submit">
                    Save
                  </button>
                </form>
              </section>
            ) : null}

            {appointmentEditor === "service" ? (
              <section
                aria-labelledby="appointment-edit-service-title"
                className="appointment-edit-modal"
                role="dialog"
              >
                <div className="appointment-edit-header">
                  <button
                    aria-label="Close service editor"
                    className="appointment-detail-close"
                    onClick={() => setAppointmentEditor(null)}
                    type="button"
                  >
                    {"\u00d7"}
                  </button>
                  <h2 id="appointment-edit-service-title">Select Service</h2>
                  <span />
                </div>
                <form action={handleAppointmentUpdate}>
                  <div className="service-select-tabs compact" aria-label="Service categories">
                    {serviceCategories.map((category) => (
                      <button
                        className={category === visibleServiceCategory ? "selected" : ""}
                        key={category}
                        onClick={() => setActiveServiceCategory(category)}
                        type="button"
                      >
                        <span>{getCategoryInitial(category)}</span>
                        {category}
                      </button>
                    ))}
                  </div>
                  <div className="service-select-list compact">
                    {visibleServices.map((service) => (
                      <button
                        className={editAppointmentServiceIds.includes(service.id) ? "selected" : ""}
                        key={service.id}
                        onClick={() => {
                          setEditAppointmentServiceIds((current) =>
                            toggleServiceIdByCategory(current, service, services),
                          );
                        }}
                        type="button"
                      >
                        <span aria-hidden="true">{"\u25a7"}</span>
                        <strong>{service.name}</strong>
                        <small>{service.price}</small>
                        <em>{formatServiceDuration(service.durationMinutes)}</em>
                      </button>
                    ))}
                  </div>
                  <button className="appointment-edit-save" type="submit">
                    Save
                  </button>
                </form>
              </section>
            ) : null}

            {appointmentEditor === "staff" ? (
              <section
                aria-labelledby="appointment-edit-staff-title"
                className="appointment-edit-modal"
                role="dialog"
              >
                <div className="appointment-edit-header">
                  <button
                    aria-label="Close staff editor"
                    className="appointment-detail-close"
                    onClick={() => setAppointmentEditor(null)}
                    type="button"
                  >
                    {"\u00d7"}
                  </button>
                  <h2 id="appointment-edit-staff-title">Select Staff</h2>
                  <span />
                </div>
                <form action={handleAppointmentUpdate}>
                  <div className="appointment-edit-staff-grid">
                    <button
                      className={editAppointmentStaffId === "" ? "selected" : ""}
                      onClick={() => setEditAppointmentStaffId("")}
                      type="button"
                    >
                      <span>?</span>
                      <strong>Unassigned</strong>
                      <small>No staff</small>
                    </button>
                    {editAppointmentStaffMembers.map((staff) => (
                      <button
                        className={editAppointmentStaffId === staff.id ? "selected" : ""}
                        key={staff.id}
                        onClick={() => setEditAppointmentStaffId(staff.id)}
                        type="button"
                      >
                        <span>{getInitials(staff.name)}</span>
                        <strong>{staff.name}</strong>
                        <small>{staff.role === "BUSINESS_OWNER" ? "Owner" : "Staff"}</small>
                      </button>
                    ))}
                  </div>
                  <button className="appointment-edit-save" type="submit">
                    Save
                  </button>
                </form>
              </section>
            ) : null}

            <section
              aria-labelledby="appointment-detail-title"
              className="appointment-detail-modal"
              role="dialog"
            >
              <div className="appointment-detail-modal-header">
                <button
                  aria-label="Close appointment details"
                  className="appointment-detail-close"
                  onClick={() => {
                    setAppointmentEditor(null);
                    setSelectedAppointment(null);
                  }}
                  type="button"
                >
                  {"\u00d7"}
                </button>
                <h2 id="appointment-detail-title">Appointment</h2>
                {isLockedAppointment(selectedAppointment) ? (
                  <span className="appointment-detail-status">
                    {getAppointmentCardStatusLabel(selectedAppointment)}
                  </span>
                ) : (
                  <button
                    aria-expanded={isAppointmentMenuOpen}
                    aria-label="Appointment quick actions"
                    className="appointment-detail-more"
                    onClick={() => setIsAppointmentMenuOpen((current) => !current)}
                    type="button"
                  >
                    {"\u22ef"}
                  </button>
                )}
                {!isLockedAppointment(selectedAppointment) && isAppointmentMenuOpen ? (
                  <div className="appointment-detail-menu">
                    <button onClick={() => delayAppointment(30)} type="button">
                      <span aria-hidden="true">30</span>
                      Delay by 30 min
                    </button>
                    <button onClick={() => delayAppointment(60)} type="button">
                      <span aria-hidden="true">60</span>
                      Delay by 60 min
                    </button>
                    {selectedAppointment.status !== "ARRIVED" ? (
                      <button onClick={() => updateAppointmentStatus("NO_SHOW")} type="button">
                        <span aria-hidden="true">!</span>
                        No Show
                      </button>
                    ) : null}
                    <button
                      className="danger"
                      onClick={() => updateAppointmentStatus("CANCELLED")}
                      type="button"
                    >
                      <span aria-hidden="true">×</span>
                      Cancel Appointment
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="appointment-detail-body">
                <button
                  className="appointment-detail-card"
                  disabled={isLockedAppointment(selectedAppointment)}
                  onClick={() => openAppointmentEditor(selectedAppointment, "time")}
                  type="button"
                >
                  <span aria-hidden="true">{"\ud83d\udcc5"}</span>
                  <div>
                    <strong>{formatLongDate(toDateValue(new Date(selectedAppointment.scheduledAt)))}</strong>
                    <small>{formatTimeLabelFromDate(selectedAppointment.scheduledAt)}</small>
                  </div>
                </button>

                <div className="appointment-detail-card">
                  <span aria-hidden="true">{"\u260e"}</span>
                  <div>
                    <strong>{selectedAppointment.customerName}</strong>
                    <small>{selectedAppointment.customerPhone}</small>
                  </div>
                </div>

                {!isSalonBusiness ? <div className="appointment-detail-card">
                  <span aria-hidden="true">{"\u2706"}</span>
                  <div>
                    <strong>
                      {selectedAppointment.contactName || selectedAppointment.customerName}
                    </strong>
                    <small>
                      Pick up contact ·{" "}
                      {selectedAppointment.contactPhone || selectedAppointment.customerPhone}
                    </small>
                  </div>
                </div> : null}

                <div className="appointment-detail-service-card">
                  {selectedAppointment.serviceDetails.map((service) => (
                    <button
                      className="appointment-detail-service-row"
                      disabled={isLockedAppointment(selectedAppointment)}
                      key={service.id}
                      onClick={() => openAppointmentEditor(selectedAppointment, "service")}
                      type="button"
                    >
                      <span aria-hidden="true">{"\u25a7"}</span>
                      <div>
                        <strong>{service.name}</strong>
                        <small>{service.price}</small>
                      </div>
                    </button>
                  ))}
                  <button
                    className="appointment-detail-service-add"
                    disabled={isLockedAppointment(selectedAppointment)}
                    onClick={() => openAppointmentEditor(selectedAppointment, "service")}
                    type="button"
                  >
                    <span aria-hidden="true">{"\u2295"}</span>
                    <strong>Select Service</strong>
                  </button>
                </div>

                <button
                  className="appointment-detail-card"
                  disabled={isLockedAppointment(selectedAppointment)}
                  onClick={() => openAppointmentEditor(selectedAppointment, "staff")}
                  type="button"
                >
                  <span aria-hidden="true">{"\u25c9"}</span>
                  <div>
                    <strong>{selectedAppointment.staffName ?? "Unassigned"}</strong>
                    <small>Staff</small>
                  </div>
                </button>

                {!isSalonBusiness && !isCompletedPaidAppointment(selectedAppointment) ? (
                  <div className="appointment-detail-actions">
                    {isLockedAppointment(selectedAppointment) && selectedAppointment.workOrderId ? (
                      <Link
                        className="appointment-detail-action primary"
                        href="/work-orders"
                      >
                        Job details
                      </Link>
                    ) : selectedAppointment.serviceDetails.length === 0 ? (
                      <button className="appointment-detail-action" disabled type="button">
                        Select service first
                      </button>
                    ) : (
                      <form action={convertAppointmentAction}>
                        <input name="appointmentId" type="hidden" value={selectedAppointment.id} />
                        <input name="redirectTo" type="hidden" value="/work-orders" />
                        <button className="appointment-detail-action primary" type="submit">
                          Create Job
                        </button>
                      </form>
                    )}
                  </div>
                ) : null}

                {isSalonBusiness ? (
                  <SalonAppointmentAction
                    appointment={selectedAppointment}
                    onStatusChange={updateAppointmentStatus}
                  />
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {isServicePickerOpen ? (
        <div className="service-select-backdrop" role="presentation">
          <section
            aria-labelledby="service-select-title"
            aria-modal="true"
            className="service-select-modal"
            role="dialog"
          >
            <div className="service-select-header">
              <button
                aria-label="Close service picker"
                className="service-select-close"
                onClick={() => setIsServicePickerOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="service-select-title">Select Service</h2>
              <span aria-hidden="true">{"\u2315"}</span>
            </div>

            <div className="service-select-tabs" aria-label="Service categories">
              {serviceCategories.map((category) => (
                <button
                  className={category === visibleServiceCategory ? "selected" : ""}
                  key={category}
                  onClick={() => setActiveServiceCategory(category)}
                  type="button"
                >
                  <span>{getCategoryInitial(category)}</span>
                  {category}
                </button>
              ))}
            </div>

            <div className="service-select-list">
              {visibleServices.length ? (
                visibleServices.map((service) => (
                  <button
                    className={selectedServiceIds.includes(service.id) ? "selected" : ""}
                    key={service.id}
                    onClick={() => {
                      setSelectedServiceIds((current) => {
                        if (current.includes(service.id)) {
                          return current.filter((serviceId) => serviceId !== service.id);
                        }

                        return toggleServiceIdByCategory(current, service, services);
                      });
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">{"\u25a7"}</span>
                    <strong>{service.name}</strong>
                    <small>{service.price}</small>
                    <em>{formatServiceDuration(service.durationMinutes)}</em>
                  </button>
                ))
              ) : (
                <p>No services in this category.</p>
              )}
            </div>

            <button
              className="service-select-save"
              onClick={() => setIsServicePickerOpen(false)}
              type="button"
            >
              Save
            </button>
          </section>
        </div>
      ) : null}

      {isBusinessHourOpen ? (
        <div className="business-hour-modal-backdrop" role="presentation">
          <section
            aria-labelledby="business-hour-title"
            className="business-hour-modal"
            role="dialog"
          >
            <div className="business-hour-modal-header">
              <button
                aria-label="Close business hour"
                className="business-hour-close"
                onClick={() => setIsBusinessHourOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="business-hour-title">Business Hour</h2>
              <button
                className="business-hour-save"
                onClick={() => {
                  setBusinessStartTime(draftStartTime);
                  setBusinessEndTime(draftEndTime);
                  storeBusinessHours(draftStartTime, draftEndTime);
                  setIsBusinessHourOpen(false);
                }}
                type="button"
              >
                Save
              </button>
            </div>

            <div className="business-hour-toggle-row">
              <span>Use Daily Time</span>
              <button
                aria-pressed={useDailyTime}
                className={`business-hour-toggle ${useDailyTime ? "is-on" : ""}`}
                onClick={() => setUseDailyTime((current) => !current)}
                type="button"
              >
                <span />
              </button>
            </div>
            <p className="business-hour-help">Apply same hour for every day of the week</p>

            <div className="business-hour-card">
              <div className="business-hour-card-header">
                <div>
                  <span className="business-hour-sun">{"\u2600"}</span>
                  <strong>Daily</strong>
                </div>
                <span className="business-hour-on">{"\u2713"} On</span>
              </div>

              <div className="business-hour-time-row">
                <label>
                  <span>Start</span>
                  <input
                    max={draftEndTime}
                    onChange={(event) => setDraftStartTime(event.target.value)}
                    type="time"
                    value={draftStartTime}
                  />
                </label>
                <strong>-</strong>
                <label>
                  <span>End</span>
                  <input
                    min={draftStartTime}
                    onChange={(event) => setDraftEndTime(event.target.value)}
                    type="time"
                    value={draftEndTime}
                  />
                </label>
              </div>

              <button className="business-hour-break" type="button">
                Add Break
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isResizeOpen ? (
        <div className="resize-popover-backdrop" role="presentation">
          <section
            aria-labelledby="resize-calendar-title"
            className="resize-popover"
            role="dialog"
          >
            <div className="resize-popover-header">
              <button
                aria-label="Close resize"
                className="resize-popover-close"
                onClick={() => setIsResizeOpen(false)}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="resize-calendar-title">Resize</h2>
              <span />
            </div>
            <input
              aria-label="Calendar row size"
              className="resize-slider"
              max="24"
              min="0"
              onChange={(event) => setCalendarResize(Number(event.target.value))}
              type="range"
              value={calendarResize}
            />
            <strong className="resize-value">{calendarResize} %</strong>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function CalendarRow({
  appointmentsBySlot,
  draggingId,
  dropTarget,
  onCreate,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onOpen,
  selectedDate,
  staffSlots,
  time,
}: {
  appointmentsBySlot: Map<string, AppointmentCalendarItem[]>;
  draggingId: string | null;
  dropTarget: string | null;
  onCreate: (date: string, time: string, staffId: string) => void;
  onDragEnd: () => void;
  onDragOver: (target: string) => void;
  onDragStart: (appointmentId: string) => void;
  onDrop: (date: string, time: string, staffId: string) => void;
  onOpen: (appointment: AppointmentCalendarItem) => void;
  selectedDate: string;
  staffSlots: CalendarStaffSlot[];
  time: string;
}) {
  const isPastSlot = isPastAppointmentSlot(selectedDate, time);

  return (
    <>
      <div className="appointment-calendar-time">{time}</div>
      {staffSlots.map((staff, index) => {
        const key = `${selectedDate}T${time}::${staff.id ?? `empty-${index}`}`;
        const appointments = appointmentsBySlot.get(key) ?? [];
        const isDropTarget = dropTarget === key;

        return (
          <div
            className={`appointment-calendar-slot ${isDropTarget ? "is-drop-target" : ""} ${
              isPastSlot ? "is-past" : ""
            }`}
            key={key}
            onDragOver={(event) => {
              if (isPastSlot || !staff.id) {
                return;
              }

              event.preventDefault();
              onDragOver(key);
            }}
            onDrop={(event) => {
              if (isPastSlot || !staff.id) {
                return;
              }

              event.preventDefault();
              onDrop(selectedDate, time, staff.id);
            }}
          >
            {staff.id && appointments.length === 0 && !isPastSlot ? (
              <button
                aria-label={`New appointment for ${staff.name} at ${formatTimeLabel(time)}`}
                className="appointment-calendar-slot-create"
                onClick={() => onCreate(selectedDate, time, staff.id as string)}
                type="button"
              />
            ) : null}
            {appointments.map((appointment) => (
              <button
                className={`appointment-calendar-card ${
                  isLockedAppointment(appointment) ? "is-converted" : ""
                } ${
                  isCompletedAppointment(appointment) ? "is-completed" : ""
                } ${
                  draggingId === appointment.id ? "is-dragging" : ""
                }`}
                draggable={!isLockedAppointment(appointment)}
                key={appointment.id}
                onClick={() => onOpen(appointment)}
                onDragEnd={onDragEnd}
                onDragStart={(event) => {
                  if (isLockedAppointment(appointment)) {
                    event.preventDefault();
                    return;
                  }

                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", appointment.id);
                  onDragStart(appointment.id);
                }}
                type="button"
              >
                <strong>{appointment.customerName}</strong>
                {appointment.plateNumber ? <span>{appointment.plateNumber}</span> : null}
                <small>
                  {getAppointmentCardStatusLabel(appointment)}
                  {false
                    ? " · Completed"
                    : false
                      ? " · In Progress"
                      : ""}
                </small>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

function isLockedAppointment(appointment: AppointmentCalendarItem) {
  return ["IN_SERVICE", "COMPLETED", "CONVERTED_TO_JOB"].includes(appointment.status);
}

function isCompletedPaidAppointment(appointment: AppointmentCalendarItem) {
  return appointment.workOrderStatus === "COMPLETED" && appointment.workOrderPaymentStatus === "PAID";
}

function isCompletedAppointment(appointment: AppointmentCalendarItem) {
  return appointment.status === "COMPLETED" || isCompletedPaidAppointment(appointment);
}

function getAppointmentCardStatusLabel(appointment: AppointmentCalendarItem) {
  if (isCompletedPaidAppointment(appointment)) {
    return "Completed";
  }

  if (isLockedAppointment(appointment)) {
    return appointment.status === "COMPLETED"
      ? "Completed"
      : appointment.status === "IN_SERVICE"
        ? "In Service"
        : "In Progress";
  }

  return appointment.status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SalonAppointmentAction({
  appointment,
  onStatusChange,
}: {
  appointment: AppointmentCalendarItem;
  onStatusChange: (
    status: "CONFIRMED" | "ARRIVED" | "IN_SERVICE" | "COMPLETED",
  ) => void;
}) {
  const action = getSalonAppointmentAction(appointment);

  if (!action) {
    if (appointment.status !== "COMPLETED") {
      return null;
    }

    return (
      <div className="appointment-detail-actions">
        <span className="appointment-detail-complete">Service completed</span>
        <Link
          className="appointment-detail-action primary"
          href={`/appointments/${appointment.id}`}
        >
          Payment &amp; invoice
        </Link>
      </div>
    );
  }

  return (
    <div className="appointment-detail-actions">
      <button
        className="appointment-detail-action primary"
        disabled={Boolean(action.disabledReason)}
        onClick={() => onStatusChange(action.status)}
        type="button"
      >
        {action.disabledReason ?? action.label}
      </button>
      {canOpenSalonCheckout(appointment) ? (
        <Link
          className="appointment-detail-action secondary"
          href={`/appointments/${appointment.id}`}
        >
          Payment &amp; invoice
        </Link>
      ) : null}
    </div>
  );
}

function canOpenSalonCheckout(appointment: AppointmentCalendarItem) {
  return (
    ["ARRIVED", "IN_SERVICE", "COMPLETED"].includes(appointment.status) &&
    appointment.serviceDetails.length > 0
  );
}

function getSalonAppointmentAction(appointment: AppointmentCalendarItem) {
  if (appointment.status === "SCHEDULED") {
    return { label: "Confirm appointment", status: "CONFIRMED" as const };
  }

  if (appointment.status === "CONFIRMED") {
    return { label: "Check in", status: "ARRIVED" as const };
  }

  if (appointment.status === "ARRIVED") {
    return {
      disabledReason:
        appointment.serviceDetails.length === 0
          ? "Select service first"
          : !appointment.staffId
            ? "Assign staff first"
            : undefined,
      label: "Start service",
      status: "IN_SERVICE" as const,
    };
  }

  if (appointment.status === "IN_SERVICE") {
    return { label: "Complete service", status: "COMPLETED" as const };
  }

  return null;
}

function isTodayDateValue(dateValue: string) {
  return dateValue === toDateValue(new Date());
}

function countAppointmentsInSlots(
  slots: string[],
  dateValue: string,
  appointments: AppointmentCalendarItem[],
) {
  const slotSet = new Set(slots);

  return appointments.filter((appointment) => {
    const scheduledAt = new Date(appointment.scheduledAt);

    return toDateValue(scheduledAt) === dateValue && slotSet.has(toTimeValue(scheduledAt));
  }).length;
}

function isPastAppointmentSlot(dateValue: string, timeValue: string) {
  const slotDate = new Date(`${dateValue}T${timeValue}:00`);

  return slotDate.getTime() < Date.now();
}

function readStoredBusinessHours() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(BUSINESS_HOUR_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as {
      endTime?: unknown;
      startTime?: unknown;
    };

    if (
      typeof parsed.startTime !== "string" ||
      typeof parsed.endTime !== "string" ||
      !isValidTimeValue(parsed.startTime) ||
      !isValidTimeValue(parsed.endTime)
    ) {
      return null;
    }

    return {
      endTime: parsed.endTime,
      startTime: parsed.startTime,
    };
  } catch {
    return null;
  }
}

function storeBusinessHours(startTime: string, endTime: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    BUSINESS_HOUR_STORAGE_KEY,
    JSON.stringify({
      endTime,
      startTime,
    }),
  );
}

function isValidTimeValue(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function toggleServiceIdByCategory(
  currentIds: string[],
  service: {
    category: string;
    id: string;
  },
  services: {
    category: string;
    id: string;
  }[],
) {
  if (currentIds.includes(service.id)) {
    return currentIds.filter((serviceId) => serviceId !== service.id);
  }

  return [
    ...currentIds.filter((serviceId) => {
      const currentService = services.find((item) => item.id === serviceId);
      return currentService?.category !== service.category;
    }),
    service.id,
  ];
}

function normalizeServiceIdsByCategory(
  serviceIds: string[],
  services: {
    category: string;
    id: string;
  }[],
) {
  const selectedByCategory = new Map<string, string>();

  serviceIds.forEach((serviceId) => {
    const service = services.find((item) => item.id === serviceId);

    if (!service) {
      return;
    }

    selectedByCategory.set(service.category, service.id);
  });

  return [...selectedByCategory.values()];
}

function MonthYearPicker({
  onChange,
  visibleMonth,
}: {
  onChange: (monthValue: string) => void;
  visibleMonth: string;
}) {
  const currentDate = monthValueToDate(visibleMonth);
  const selectedMonth = currentDate.getMonth();
  const selectedYear = currentDate.getFullYear();
  const years = Array.from({ length: 11 }, (_, index) => selectedYear - 5 + index);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return (
    <div className="month-year-picker" aria-label="Select month and year">
      <div className="month-year-picker-column">
        {months.map((month, index) => (
          <button
            className={index === selectedMonth ? "is-selected" : ""}
            key={month}
            onClick={() => onChange(toMonthValue(selectedYear, index))}
            type="button"
          >
            {month}
          </button>
        ))}
      </div>
      <div className="month-year-picker-column">
        {years.map((year) => (
          <button
            className={year === selectedYear ? "is-selected" : ""}
            key={year}
            onClick={() => onChange(toMonthValue(year, selectedMonth))}
            type="button"
          >
            {year}
          </button>
        ))}
      </div>
    </div>
  );
}

function groupAppointments(appointments: AppointmentCalendarItem[]) {
  const grouped = new Map<string, AppointmentCalendarItem[]>();

  appointments.forEach((appointment) => {
    const scheduledAt = new Date(appointment.scheduledAt);
    const date = toDateValue(scheduledAt);
    const hour = String(scheduledAt.getHours()).padStart(2, "0");
    const minute = Math.floor(scheduledAt.getMinutes() / 15) * 15;
    const key = `${date}T${hour}:${String(minute).padStart(2, "0")}::${appointment.staffId ?? "unassigned"}`;
    const current = grouped.get(key) ?? [];
    current.push(appointment);
    grouped.set(key, current);
  });

  return grouped;
}

function buildAppointmentWeekDays(dateValue: string, dateCountByDay: Map<string, number>) {
  const weekStart = startOfWeek(new Date(`${dateValue}T00:00:00`));

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const nextDateValue = toDateValue(date);

    return {
      count: dateCountByDay.get(nextDateValue) ?? 0,
      date: nextDateValue,
      shortLabel: date.toLocaleDateString("en-MY", {
        weekday: "short",
      }),
    };
  });
}

function buildStaffSlots(
  staffMembers: {
    id: string;
    name: string;
    role: string;
  }[],
): CalendarStaffSlot[] {
  const visibleSlots = staffMembers.map((staff) => ({ ...staff, isEmpty: false }));
  const emptyCount = Math.max(0, 7 - visibleSlots.length);

  return [
    ...visibleSlots,
    ...Array.from({ length: emptyCount }, () => ({
      id: null,
      name: "",
      role: "",
      isEmpty: true,
    })),
  ];
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function monthValueToDate(monthValue: string) {
  return new Date(`${monthValue}-01T00:00:00`);
}

function addMonthsToMonthValue(monthValue: string, amount: number) {
  const date = monthValueToDate(monthValue);
  date.setMonth(date.getMonth() + amount);
  return toDateValue(date).slice(0, 7);
}

function addDaysToDateValue(dateValue: string, amount: number) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + amount);

  return toDateValue(date);
}

function toMonthValue(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function clampDraftDateToMonth(currentDateValue: string, nextMonthValue: string) {
  const currentDay = Number(currentDateValue.slice(8, 10)) || 1;
  const [year, month] = nextMonthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(currentDay, daysInMonth);

  return `${nextMonthValue}-${String(day).padStart(2, "0")}`;
}

function buildDatePickerDays(monthDate: Date, countByDay: Map<string, number>) {
  const monthStart = new Date(monthDate);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const gridStart = startOfWeek(monthStart);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateValue = toDateValue(date);

    return {
      count: countByDay.get(dateValue) ?? 0,
      date: dateValue,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function buildTimeSlots(startTime = "10:00", endTime = "22:00") {
  const slots: string[] = [];
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  for (let current = startMinutes; current <= endMinutes; current += 15) {
    const hour = Math.floor(current / 60);
    const minute = current % 60;
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  return slots;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatTimeLabel(time: string) {
  const [hourValue, minuteValue] = time.split(":").map(Number);
  const period = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;

  return `${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
}

function formatTimeLabelFromDate(dateValue: string) {
  const date = new Date(dateValue);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return formatTimeLabel(`${hour}:${minute}`);
}

function formatLongDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function filterStaffForServices(
  staffMembers: { id: string; name: string; role: string }[],
  serviceIds: string[],
  services: { id: string; staffIds: string[] }[],
) {
  const restrictedStaffLists = serviceIds
    .map((serviceId) => services.find((service) => service.id === serviceId)?.staffIds ?? [])
    .filter((staffIds) => staffIds.length > 0);

  if (!restrictedStaffLists.length) {
    return staffMembers;
  }

  const eligibleStaffIds = restrictedStaffLists.slice(1).reduce(
    (eligibleIds, staffIds) =>
      new Set([...eligibleIds].filter((staffId) => staffIds.includes(staffId))),
    new Set(restrictedStaffLists[0]),
  );

  return staffMembers.filter((staff) => eligibleStaffIds.has(staff.id));
}

function formatServiceDuration(durationMinutes: number | null) {
  if (!durationMinutes) {
    return "Flexible";
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getServiceCategories(services: { category: string }[]) {
  return [...new Set(services.map((service) => service.category).filter(Boolean))];
}

function getCategoryInitial(category: string) {
  return category.trim().charAt(0).toUpperCase() || "?";
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
