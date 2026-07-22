"use client";

import { AppointmentVehiclePicker } from "@/components/appointment-vehicle-picker";
import { AppointmentCustomerPicker } from "@/components/appointment-customer-picker";
import type { InvoiceModalSummary } from "@/components/appointment-invoice-modal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import {
  addDaysToDateValue as addBusinessDaysToDateValue,
  addMonthsToDateValue,
  dateValueToUtcDate,
  formatDateValue,
  getBusinessTodayDateValue,
  parseBusinessDateTime,
  startOfBusinessWeek,
  toBusinessDateValue,
  toBusinessTimeValue,
  utcDateToDateValue,
} from "@/lib/business-time";
import { formatAppointmentStatus } from "@/lib/validation/appointments";
import {
  calculateAppointmentDurationMinutes,
  getAppointmentSlotCount,
} from "@/lib/appointments/scheduling";

export type AppointmentCalendarItem = {
  id: string;
  branchId: string | null;
  customerId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactType: string;
  customerName: string;
  customerPhone: string;
  plateNumber: string | null;
  scheduledAt: string;
  durationMinutes: number;
  serviceName: string | null;
  serviceNames: string[];
  serviceDetails: {
    id: string;
    name: string;
    price: string;
    taxable: boolean;
    taxRate: number | null;
  }[];
  serviceIds: string[];
  productIds: string[];
  productDetails: {
    id: string;
    name: string;
    price: string;
    category: string;
    quantity: number;
    taxable: boolean;
    taxRate: number | null;
  }[];
  packageIds: string[];
  packageDetails: {
    id: string;
    name: string;
    price: string;
    category: string;
    quantity: number;
    totalUses: number;
    taxable: boolean;
    taxRate: number | null;
  }[];
  staffId: string | null;
  staffName: string | null;
  status: string;
  notes: string | null;
  invoiceBalance: number | null;
  invoiceId: string | null;
  invoiceSummary: InvoiceModalSummary | null;
  invoicePaidAmount: number | null;
  invoiceStatus: string | null;
  invoiceSubtotal: number | null;
  invoiceTotal: number | null;
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
  /** Keeps older cached appointment bundles compatible during a rolling client refresh. */
  catalogDiscounts?: unknown[];
  createAppointmentAction: (
    formData: FormData,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  convertAppointmentAction: (formData: FormData) => Promise<void>;
  datePickerCounts: {
    count: number;
    date: string;
  }[];
  datePickerHrefPrefix: string;
  isSalonBusiness: boolean;
  initialAppointmentId?: string;
  days: {
    count: number;
    date: string;
    label: string;
    shortLabel: string;
  }[];
  nextHref: string;
  previousHref: string;
  recentServiceIds: string[];
  rescheduleAction: (formData: FormData) => Promise<unknown>;
  selectedDateLabel: string;
  selectedDateValue: string;
  services: {
    category: string;
    durationMinutes: number | null;
    id: string;
    name: string;
    price: string;
    staffIds: string[];
    taxable: boolean;
    taxRate: number | null;
  }[];
  products: {
    category: string;
    id: string;
    name: string;
    price: string;
    taxable: boolean;
    taxRate: number | null;
  }[];
  packages: {
    category: string;
    id: string;
    name: string;
    price: string;
    totalUses: number;
    taxable: boolean;
    taxRate: number | null;
  }[];
  staffMembers: {
    id: string;
    name: string;
    role: string;
  }[];
  updateAppointmentAction: (formData: FormData) => Promise<unknown>;
  updateAppointmentStatusAction: (formData: FormData) => Promise<void>;
};

type CalendarStaffSlot = {
  id: string | null;
  name: string;
  role: string;
  isEmpty?: boolean;
};

const RECENT_SERVICES_CATEGORY = "Recently";

const BUSINESS_HOUR_STORAGE_KEY = "washflow:appointment-business-hours";

function countOccurrences(ids: string[], id: string) {
  return ids.filter((value) => value === id).length;
}

function countSelectedItems<T extends { id: string }>(ids: string[], items: T[]) {
  const quantities = new Map<string, number>();
  ids.forEach((id) => quantities.set(id, (quantities.get(id) ?? 0) + 1));

  return [...quantities].flatMap(([id, quantity]) => {
    const item = items.find((candidate) => candidate.id === id);
    return item ? [{ ...item, quantity }] : [];
  });
}

function getItemCategories(items: Array<{ category: string }>) {
  return [...new Set(items.map((item) => item.category).filter(Boolean))];
}

function getAppointmentDisplayItems(appointment: AppointmentCalendarItem) {
  return [
    ...appointment.serviceDetails.map((item) => ({
      ...item,
      category: "Services",
      quantity: 1,
      type: "service" as const,
    })),
    ...appointment.productDetails.map((item) => ({ ...item, type: "product" as const })),
    ...appointment.packageDetails.map((item) => ({ ...item, type: "package" as const })),
  ];
}

function normalizeCalendarAppointment(
  appointment: AppointmentCalendarItem,
): AppointmentCalendarItem {
  return {
    ...appointment,
    serviceIds: appointment.serviceIds ?? [],
    serviceDetails: appointment.serviceDetails ?? [],
    productIds: appointment.productIds ?? [],
    productDetails: appointment.productDetails ?? [],
    packageIds: appointment.packageIds ?? [],
    packageDetails: appointment.packageDetails ?? [],
  };
}

export function AppointmentCalendar({
  appointments = [],
  branches = [],
  createAppointmentAction,
  convertAppointmentAction,
  datePickerCounts = [],
  datePickerHrefPrefix,
  isSalonBusiness,
  initialAppointmentId,
  days = [],
  nextHref,
  previousHref,
  recentServiceIds = [],
  rescheduleAction,
  selectedDateLabel,
  selectedDateValue,
  services = [],
  products = [],
  packages = [],
  staffMembers = [],
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
  const [newAppointmentError, setNewAppointmentError] = useState("");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentCalendarItem | null>(null);
  const [isAppointmentMenuOpen, setIsAppointmentMenuOpen] = useState(false);
  const [appointmentEditor, setAppointmentEditor] = useState<
    "time" | "service" | "staff" | "notes" | null
  >(
    null,
  );
  const [editAppointmentDate, setEditAppointmentDate] = useState(selectedDateValue);
  const [editAppointmentStaffId, setEditAppointmentStaffId] = useState("");
  const [editAppointmentTime, setEditAppointmentTime] = useState("10:00");
  const [editAppointmentServiceIds, setEditAppointmentServiceIds] = useState<string[]>([]);
  const [editAppointmentProductIds, setEditAppointmentProductIds] = useState<string[]>([]);
  const [editAppointmentPackageIds, setEditAppointmentPackageIds] = useState<string[]>([]);
  const [editAppointmentNotes, setEditAppointmentNotes] = useState("");
  const [appointmentUpdateError, setAppointmentUpdateError] = useState<string | null>(null);
  const [isServicePickerOpen, setIsServicePickerOpen] = useState(false);
  const [activeServiceCategory, setActiveServiceCategory] = useState("");
  const [activeItemType, setActiveItemType] = useState<"service" | "product" | "package">("service");
  const [activeItemCategory, setActiveItemCategory] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [showEarlierSlots, setShowEarlierSlots] = useState(false);
  const [isPending, startTransition] = useTransition();
  const pendingCreateScrollRef = useRef<{
    mainScrollTop: number;
    windowScrollY: number;
  } | null>(null);
  const handledInitialAppointmentRef = useRef<string | null>(null);
  const grouped = groupAppointments(appointments);
  const blockedSlots = groupBlockedAppointmentSlots(appointments);
  const selectedServices = selectedServiceIds
    .map((serviceId) => services.find((service) => service.id === serviceId))
    .filter((service): service is (typeof services)[number] => Boolean(service));
  const selectedProducts = countSelectedItems(selectedProductIds, products);
  const selectedPackages = countSelectedItems(selectedPackageIds, packages);
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
  const recentServices = getRecentServices(services, recentServiceIds, 5);
  const serviceCategories = [RECENT_SERVICES_CATEGORY, ...getServiceCategories(services)];
  const visibleServiceCategory = activeServiceCategory || serviceCategories[0] || "";
  const visibleServices =
    visibleServiceCategory === RECENT_SERVICES_CATEGORY
      ? recentServices
      : visibleServiceCategory
        ? services.filter((service) => service.category === visibleServiceCategory)
        : services;
  const itemCategories = activeItemType === "product"
    ? getItemCategories(products)
    : activeItemType === "package"
      ? getItemCategories(packages)
      : serviceCategories;
  const visibleItemCategory = activeItemType === "service"
    ? visibleServiceCategory
    : activeItemCategory || itemCategories[0] || "";
  const visibleProducts = visibleItemCategory
    ? products.filter((product) => product.category === visibleItemCategory)
    : products;
  const visiblePackages = visibleItemCategory
    ? packages.filter((item) => item.category === visibleItemCategory)
    : packages;
  const dateCountByDay = new Map(datePickerCounts.map((day) => [day.date, day.count]));
  const newAppointmentDays = buildAppointmentWeekDays(newAppointmentDate, dateCountByDay);
  const visibleMonthDate = monthValueToDate(visibleMonth);
  const visibleMonthLabel = formatDateValue(`${visibleMonth}-01`, {
    month: "long",
    year: "numeric",
  });
  const visibleDatePickerDays = buildDatePickerDays(visibleMonthDate, dateCountByDay);
  const allTimeSlots = buildTimeSlots(businessStartTime, businessEndTime);
  const shouldHidePastSlots = isTodayDateValue(selectedDateValue) && !showEarlierSlots;
  const hiddenPastSlots = shouldHidePastSlots
    ? allTimeSlots.filter((time) => isEarlierThanPastVisibilityWindow(selectedDateValue, time))
    : [];
  const visibleTimeSlots = shouldHidePastSlots
    ? allTimeSlots.filter((time) => !isEarlierThanPastVisibilityWindow(selectedDateValue, time))
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
    const pendingScroll = pendingCreateScrollRef.current;

    if (!pendingScroll) {
      return;
    }

    pendingCreateScrollRef.current = null;
    requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>(".main");
      if (main) {
        main.scrollTop = pendingScroll.mainScrollTop;
      }
      window.scrollTo({ top: pendingScroll.windowScrollY });
    });
  }, [appointments]);

  useEffect(() => {
    if (
      !initialAppointmentId ||
      handledInitialAppointmentRef.current === initialAppointmentId
    ) {
      return;
    }

    const initialAppointment = appointments.find(
      (appointment) => appointment.id === initialAppointmentId,
    );

    if (initialAppointment) {
      handledInitialAppointmentRef.current = initialAppointmentId;
      setSelectedAppointment(normalizeCalendarAppointment(initialAppointment));
      clearAppointmentQueryFromAddress();
    }
  }, [appointments, initialAppointmentId]);

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
    setSelectedProductIds([]);
    setSelectedPackageIds([]);
    setIsNewAppointmentOpen(true);
  }

  function handleDatePickerDaySelect(date: string) {
    setDraftDate(date);

    if (datePickerTarget === "newAppointment") {
      setNewAppointmentDate(date);
    } else {
      router.push(`${datePickerHrefPrefix}${date}`);
    }

    setIsMonthPickerOpen(false);
    setIsDatePickerOpen(false);
  }

  function openAppointmentEditor(
    appointment: AppointmentCalendarItem,
    editor: "time" | "service" | "staff" | "notes",
  ) {
    const scheduledAt = new Date(appointment.scheduledAt);
    setEditAppointmentDate(toDateValue(scheduledAt));
    setEditAppointmentTime(toTimeValue(scheduledAt));
    setEditAppointmentStaffId(appointment.staffId ?? "");
    setEditAppointmentServiceIds(appointment.serviceIds);
    setEditAppointmentProductIds(appointment.productIds);
    setEditAppointmentPackageIds(appointment.packageIds);
    setEditAppointmentNotes(appointment.notes ?? "");
    setAppointmentUpdateError(null);
    setIsAppointmentMenuOpen(false);
    setAppointmentEditor(editor);
  }

  function handleAppointmentUpdate(
    formData: FormData,
    serviceIds = editAppointmentServiceIds,
    reopenEditorOnFailure: "service" | null = null,
    productIds = editAppointmentProductIds,
    packageIds = editAppointmentPackageIds,
  ) {
    if (!selectedAppointment) {
      return;
    }

    const normalizedServiceIds = normalizeServiceIdsByCategory(
      serviceIds,
      services,
    );
    formData.set("appointmentId", selectedAppointment.id);
    formData.set("scheduledDate", editAppointmentDate);
    formData.set("scheduledTime", editAppointmentTime);
    formData.set("assignedStaffId", editAppointmentStaffId);
    formData.set("notes", editAppointmentNotes);
    formData.delete("serviceIds");
    normalizedServiceIds.forEach((serviceId) =>
      formData.append("serviceIds", serviceId),
    );
    formData.delete("productIds");
    productIds.forEach((productId) => formData.append("productIds", productId));
    formData.delete("packageIds");
    packageIds.forEach((packageId) => formData.append("packageIds", packageId));

    if (reopenEditorOnFailure) {
      setAppointmentUpdateError(null);
      setAppointmentEditor(null);
    }

    startTransition(async () => {
      try {
        const result = await updateAppointmentAction(formData);
        if (isFailedAppointmentMutation(result)) {
          if (reopenEditorOnFailure) {
            const attemptedServices = normalizedServiceIds
              .map((serviceId) => services.find((service) => service.id === serviceId))
              .filter((service): service is (typeof services)[number] => Boolean(service));
            const attemptedDuration = calculateAppointmentDurationMinutes(
              attemptedServices.map((service) => service.durationMinutes),
            );
            const attemptedEnd = new Date(
              parseBusinessDateTime(editAppointmentDate, editAppointmentTime).getTime() +
                attemptedDuration * 60_000,
            );
            const conflictPrefix = result.error.includes("booked from")
              ? `This service would run until ${formatTimeLabel(toTimeValue(attemptedEnd))}. `
              : "";

            setEditAppointmentServiceIds(selectedAppointment.serviceIds);
            setAppointmentUpdateError(
              `${conflictPrefix}${result.error} Choose a shorter service or reschedule the appointment.`,
            );
            setAppointmentEditor(reopenEditorOnFailure);
          }
          return;
        }

        setAppointmentUpdateError(null);
        setAppointmentEditor(null);
        const updatedServices = normalizedServiceIds
          .map((serviceId) => services.find((service) => service.id === serviceId))
          .filter((service): service is (typeof services)[number] => Boolean(service));
        const updatedStaff = staffMembers.find((staff) => staff.id === editAppointmentStaffId);

        setSelectedAppointment((current) =>
          current
            ? {
                ...current,
                durationMinutes: calculateAppointmentDurationMinutes(
                  updatedServices.map((service) => service.durationMinutes),
                ),
                notes: editAppointmentNotes.trim() || null,
                scheduledAt: parseBusinessDateTime(
                  editAppointmentDate,
                  editAppointmentTime,
                ).toISOString(),
                serviceDetails: updatedServices.map((service) => ({
                  id: service.id,
                  name: service.name,
                  price: service.price,
                  taxable: service.taxable,
                  taxRate: service.taxRate,
                })),
                serviceIds: normalizedServiceIds,
                productIds,
                productDetails: countSelectedItems(productIds, products),
                packageIds,
                packageDetails: countSelectedItems(packageIds, packages),
                serviceName: updatedServices[0]?.name ?? null,
                serviceNames: updatedServices.map((service) => service.name),
                staffId: editAppointmentStaffId || null,
                staffName: updatedStaff?.name ?? null,
              }
            : current,
        );
        router.refresh();
      } catch {
        if (reopenEditorOnFailure) {
          setEditAppointmentServiceIds(selectedAppointment.serviceIds);
          setAppointmentUpdateError(
            "Unable to update this service. Check the appointment time and try again.",
          );
          setAppointmentEditor(reopenEditorOnFailure);
        }
      }
    });
  }

  function removeAppointmentItem(type: "service" | "product" | "package", itemId: string) {
    if (
      !selectedAppointment ||
      !canEditAppointmentItem(selectedAppointment, type)
    ) {
      return;
    }

    const appointment = selectedAppointment;
    const scheduledAt = new Date(appointment.scheduledAt);
    const remainingServiceIds = type === "service"
      ? appointment.serviceIds.filter((id) => id !== itemId)
      : appointment.serviceIds;
    const remainingProductIds = type === "product"
      ? appointment.productIds.filter((id) => id !== itemId)
      : appointment.productIds;
    const remainingPackageIds = type === "package"
      ? appointment.packageIds.filter((id) => id !== itemId)
      : appointment.packageIds;
    const remainingServices = appointment.serviceDetails.filter(
      (service) => remainingServiceIds.includes(service.id),
    );
    const formData = new FormData();
    formData.set("appointmentId", appointment.id);
    formData.set("scheduledDate", toDateValue(scheduledAt));
    formData.set("scheduledTime", toTimeValue(scheduledAt));
    formData.set("assignedStaffId", appointment.staffId ?? "");
    formData.set("notes", appointment.notes ?? "");
    remainingServiceIds.forEach((id) => formData.append("serviceIds", id));
    remainingProductIds.forEach((id) => formData.append("productIds", id));
    remainingPackageIds.forEach((id) => formData.append("packageIds", id));

    startTransition(async () => {
      await updateAppointmentAction(formData);
      setSelectedAppointment((current) =>
        current?.id === appointment.id
          ? {
              ...current,
              serviceDetails: remainingServices,
              serviceIds: remainingServices.map((service) => service.id),
              productIds: remainingProductIds,
              productDetails: countSelectedItems(remainingProductIds, products),
              packageIds: remainingPackageIds,
              packageDetails: countSelectedItems(remainingPackageIds, packages),
              serviceName: remainingServices[0]?.name ?? null,
              serviceNames: remainingServices.map((service) => service.name),
            }
          : current,
      );
      router.refresh();
    });
  }

  function delayAppointment(minutes: number) {
    if (!selectedAppointment) {
      return;
    }

    const nextDate = new Date(
      new Date(selectedAppointment.scheduledAt).getTime() + minutes * 60_000,
    );
    const formData = new FormData();
    formData.set("appointmentId", selectedAppointment.id);
    formData.set("scheduledDate", toDateValue(nextDate));
    formData.set("scheduledTime", toTimeValue(nextDate));
    formData.set("assignedStaffId", selectedAppointment.staffId ?? "");
    formData.set("notes", selectedAppointment.notes ?? "");
    selectedAppointment.serviceIds.forEach((serviceId) => formData.append("serviceIds", serviceId));
    selectedAppointment.productIds.forEach((productId) => formData.append("productIds", productId));
    selectedAppointment.packageIds.forEach((packageId) => formData.append("packageIds", packageId));

    startTransition(async () => {
      await updateAppointmentAction(formData);
      setAppointmentEditor(null);
      setIsAppointmentMenuOpen(false);
      setSelectedAppointment(null);
      router.refresh();
    });
  }

  function updateAppointmentStatus(
    status: "COMPLETED" | "CANCELLED" | "NO_SHOW",
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
    const appointmentDate = toDateValue(new Date(selectedAppointment.scheduledAt));

    if (status === "COMPLETED") {
      formData.set("returnToClient", "1");
    }

    formData.set(
      "redirectTo",
      `/appointments?status=active&page=1&date=${appointmentDate}`,
    );

    const appointmentBeforeCompletion = selectedAppointment;

    if (status === "COMPLETED") {
      flushSync(() => {
        setAppointmentEditor(null);
        setIsAppointmentMenuOpen(false);
        setAppointmentUpdateError(null);
        setSelectedAppointment({ ...selectedAppointment, status: "COMPLETED" });
      });
    }

    startTransition(async () => {
      try {
        await updateAppointmentStatusAction(formData);
      } catch {
        if (status === "COMPLETED") {
          setSelectedAppointment(appointmentBeforeCompletion);
          setAppointmentUpdateError(
            "Unable to complete this service. Please try again.",
          );
          return;
        }

        throw new Error("Unable to update this appointment. Please try again.");
      }

      if (status === "COMPLETED") {
        router.refresh();
        return;
      }

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
              setNewAppointmentError("");
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

      <div className="appointment-calendar-sticky">
        <div className="appointment-calendar-grid appointment-calendar-header-grid" style={calendarStyle}>
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
        </div>
      </div>

      <div className="appointment-calendar-grid appointment-calendar-body-grid" style={calendarStyle}>
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
            blockedSlots={blockedSlots}
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
              setSelectedAppointment(normalizeCalendarAppointment(appointment));
            }}
            selectedDate={selectedDateValue}
            staffSlots={calendarStaffSlots}
            time={time}
            isSalonBusiness={isSalonBusiness}
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
              <span aria-hidden="true" className="date-popover-header-spacer" />
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
                    onClick={() => handleDatePickerDaySelect(day.date)}
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
                  <strong>{Number(day.date.slice(8, 10))}</strong>
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
                      setNewAppointmentError("");
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
                onClick={() => {
                  setNewAppointmentError("");
                  setIsNewAppointmentOpen(false);
                }}
                type="button"
              >
                {"\u00d7"}
              </button>
              <h2 id="new-appointment-title">New Appointment</h2>
              <span />
            </div>
            <form
              className="appointment-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const requiredSelection = formData
                  .get(isSalonBusiness ? "customerId" : "vehicleId")
                  ?.toString()
                  .trim();

                if (!requiredSelection) {
                  setNewAppointmentError(
                    isSalonBusiness
                      ? "Select a customer before confirming."
                      : "Select a vehicle before confirming.",
                  );
                  return;
                }

                setNewAppointmentError("");
                const main = document.querySelector<HTMLElement>(".main");
                const scrollPosition = {
                  mainScrollTop: main?.scrollTop ?? 0,
                  windowScrollY: window.scrollY,
                };

                startTransition(async () => {
                  const result = await createAppointmentAction(formData);

                  if (!result.ok) {
                    setNewAppointmentError(result.error);
                    return;
                  }

                  pendingCreateScrollRef.current = scrollPosition;
                  setIsNewAppointmentOpen(false);
                  setSelectedServiceIds([]);
                  setNewAppointmentError("");
                  router.refresh();
                });
              }}
            >
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
                  {isSalonBusiness ? (
                    <AppointmentCustomerPicker
                      onSelectionChange={() => setNewAppointmentError("")}
                    />
                  ) : (
                    <AppointmentVehiclePicker
                      onSelectionChange={() => setNewAppointmentError("")}
                    />
                  )}
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
                  {selectedProductIds.map((productId, index) => (
                    <input key={`${productId}-${index}`} name="productIds" type="hidden" value={productId} />
                  ))}
                  {selectedPackageIds.map((packageId, index) => (
                    <input key={`${packageId}-${index}`} name="packageIds" type="hidden" value={packageId} />
                  ))}
                  <div className="appointment-service-summary">
                    {selectedServices.map((service) => (
                      <div className="appointment-service-summary-item" key={service.id}>
                        <span aria-hidden="true" className="appointment-service-glyph">
                          {"\u2726"}
                        </span>
                        <div>
                          <strong>{service.name}</strong>
                          <small>{service.price}</small>
                        </div>
                      </div>
                    ))}
                    {selectedProducts.map((product) => (
                      <div className="appointment-service-summary-item" key={`product-${product.id}`}>
                        <span aria-hidden="true" className="appointment-service-glyph">P</span>
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.quantity} × RM{product.price}</small>
                        </div>
                      </div>
                    ))}
                    {selectedPackages.map((item) => (
                      <div className="appointment-service-summary-item" key={`package-${item.id}`}>
                        <span aria-hidden="true" className="appointment-service-glyph">PK</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.quantity} × RM{item.price}</small>
                        </div>
                      </div>
                    ))}
                    <button
                      className="appointment-service-trigger"
                      onClick={() => {
                        setActiveServiceCategory(
                          selectedServices[0]?.category ?? RECENT_SERVICES_CATEGORY,
                        );
                        setActiveItemType("service");
                        setIsServicePickerOpen(true);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true" className="appointment-service-icon">+</span>
                      <strong>Add service, product or package</strong>
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
                  {newAppointmentError ? (
                    <p className="appointment-create-inline-error" role="alert">
                      {newAppointmentError}
                    </p>
                  ) : null}
                  <button disabled={isPending} type="submit">
                    {isPending ? "Saving..." : "Confirm"}
                  </button>
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
                        <strong>{Number(day.date.slice(8, 10))}</strong>
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
                  <h2 id="appointment-edit-service-title">Add service, product or package</h2>
                  <span />
                </div>
                {appointmentUpdateError ? (
                  <div className="appointment-service-conflict" role="alert">
                    <strong>Time conflict</strong>
                    <span>{appointmentUpdateError}</span>
                  </div>
                ) : null}
                <form action={handleAppointmentUpdate}>
                  <div className="appointment-item-type-tabs" aria-label="Item type">
                    {(["service", "product", "package"] as const).map((type) => (
                      <button
                        className={activeItemType === type ? "selected" : ""}
                        key={type}
                        onClick={() => {
                          setActiveItemType(type);
                          setActiveItemCategory("");
                        }}
                        type="button"
                      >
                        {type === "service" ? "Services" : type === "product" ? "Products" : "Packages"}
                      </button>
                    ))}
                  </div>
                  <div className="service-select-tabs compact" aria-label="Service categories">
                    {itemCategories.map((category) => (
                      <button
                        className={category === visibleItemCategory ? "selected" : ""}
                        key={category}
                        onClick={() => activeItemType === "service"
                          ? setActiveServiceCategory(category)
                          : setActiveItemCategory(category)}
                        type="button"
                      >
                        <span>{getCategoryInitial(category)}</span>
                        {category}
                      </button>
                    ))}
                  </div>
                  <div className="service-select-list compact">
                    {activeItemType === "service" ? visibleServices.map((service) => (
                      <button
                        className={editAppointmentServiceIds.includes(service.id) ? "selected" : ""}
                        disabled={isPending}
                        key={service.id}
                        onClick={() => {
                          const nextServiceIds = editAppointmentServiceIds.includes(service.id)
                            ? editAppointmentServiceIds.filter(
                                (serviceId) => serviceId !== service.id,
                              )
                            : toggleServiceIdByCategory(
                                editAppointmentServiceIds,
                                service,
                                services,
                              );
                          setEditAppointmentServiceIds(nextServiceIds);
                          handleAppointmentUpdate(new FormData(), nextServiceIds, "service");
                        }}
                        type="button"
                      >
                        <span aria-hidden="true" className="appointment-service-glyph">
                          {"\u2726"}
                        </span>
                        <strong>{service.name}</strong>
                        <small>{service.price}</small>
                        <em>{formatServiceDuration(service.durationMinutes)}</em>
                      </button>
                    )) : activeItemType === "product" ? visibleProducts.map((product) => (
                      <button
                        className={editAppointmentProductIds.includes(product.id) ? "selected" : ""}
                        disabled={isPending}
                        key={product.id}
                        onClick={() => {
                          const nextIds = [...editAppointmentProductIds, product.id];
                          setEditAppointmentProductIds(nextIds);
                          handleAppointmentUpdate(
                            new FormData(),
                            editAppointmentServiceIds,
                            "service",
                            nextIds,
                            editAppointmentPackageIds,
                          );
                        }}
                        type="button"
                      >
                        <span aria-hidden="true" className="appointment-service-glyph">P</span>
                        <strong>{product.name}</strong>
                        <small>RM{product.price}</small>
                        <em>{countOccurrences(editAppointmentProductIds, product.id) || ""}</em>
                      </button>
                    )) : visiblePackages.map((item) => (
                      <button
                        className={editAppointmentPackageIds.includes(item.id) ? "selected" : ""}
                        disabled={isPending}
                        key={item.id}
                        onClick={() => {
                          const nextIds = [...editAppointmentPackageIds, item.id];
                          setEditAppointmentPackageIds(nextIds);
                          handleAppointmentUpdate(
                            new FormData(),
                            editAppointmentServiceIds,
                            "service",
                            editAppointmentProductIds,
                            nextIds,
                          );
                        }}
                        type="button"
                      >
                        <span aria-hidden="true" className="appointment-service-glyph">PK</span>
                        <strong>{item.name}</strong>
                        <small>RM{item.price}</small>
                        <em>{item.totalUses} uses</em>
                      </button>
                    ))}
                  </div>
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

            {appointmentEditor === "notes" ? (
              <section
                aria-labelledby="appointment-edit-notes-title"
                className="appointment-edit-modal"
                role="dialog"
              >
                <div className="appointment-edit-header">
                  <button
                    aria-label="Close notes editor"
                    className="appointment-detail-close"
                    onClick={() => setAppointmentEditor(null)}
                    type="button"
                  >
                    {"\u00d7"}
                  </button>
                  <h2 id="appointment-edit-notes-title">Notes</h2>
                  <span />
                </div>
                <form action={handleAppointmentUpdate}>
                  <label className="appointment-edit-notes-field">
                    <span>Appointment notes</span>
                    <textarea
                      autoFocus
                      maxLength={1000}
                      onChange={(event) => setEditAppointmentNotes(event.target.value)}
                      placeholder="Add a short note"
                      rows={6}
                      value={editAppointmentNotes}
                    />
                  </label>
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
                      clearAppointmentQueryFromAddress();
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
                    <button onClick={() => updateAppointmentStatus("NO_SHOW")} type="button">
                      <span aria-hidden="true">!</span>
                      No Show
                    </button>
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
                  className="appointment-detail-card appointment-detail-staff"
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

                <button
                  className="appointment-detail-card appointment-detail-notes"
                  disabled={isLockedAppointment(selectedAppointment)}
                  onClick={() => openAppointmentEditor(selectedAppointment, "notes")}
                  type="button"
                >
                  <span aria-hidden="true">{"\u270e"}</span>
                  <div>
                    <strong>Notes</strong>
                    <small>{selectedAppointment.notes || "No notes"}</small>
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
                  {getAppointmentDisplayItems(selectedAppointment).map((item) => (
                    <div
                      className="appointment-detail-service-row"
                      key={`${item.type}-${item.id}`}
                    >
                      <button
                        className="appointment-detail-service-main"
                        disabled={!canEditAppointmentItem(selectedAppointment, item.type)}
                        onClick={() => {
                          setActiveItemType(item.type);
                          setActiveItemCategory(item.category);
                          openAppointmentEditor(selectedAppointment, "service");
                        }}
                        type="button"
                      >
                        <span aria-hidden="true" className="appointment-service-glyph">
                          {item.type === "service" ? "\u2726" : item.type === "product" ? "P" : "PK"}
                        </span>
                        <span className="appointment-detail-service-copy">
                          <strong>{item.name}</strong>
                          <small>
                            {item.quantity > 1 ? `${item.quantity} × ` : ""}RM{item.price}
                          </small>
                        </span>
                      </button>
                      <button
                        aria-label={`Remove ${item.name}`}
                        className="appointment-detail-service-remove"
                        disabled={
                          !canEditAppointmentItem(selectedAppointment, item.type) || isPending
                        }
                        onClick={() => removeAppointmentItem(item.type, item.id)}
                        title={`Remove ${item.name}`}
                        type="button"
                      >
                        {"\u00d7"}
                      </button>
                    </div>
                  ))}
                  <button
                    className="appointment-detail-service-add"
                    disabled={!canAddAppointmentItems(selectedAppointment)}
                    onClick={() => {
                      setActiveItemType("service");
                      openAppointmentEditor(selectedAppointment, "service");
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">{"\u2295"}</span>
                    <strong>
                      Add service, product or package
                    </strong>
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
                  renderSalonAppointmentAction(
                    selectedAppointment,
                    updateAppointmentStatus,
                  )
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
              <h2 id="service-select-title">Add service, product or package</h2>
              <span aria-hidden="true">{"\u2315"}</span>
            </div>

            <div className="appointment-item-type-tabs" aria-label="Item type">
              {(["service", "product", "package"] as const).map((type) => (
                <button
                  className={activeItemType === type ? "selected" : ""}
                  key={type}
                  onClick={() => {
                    setActiveItemType(type);
                    setActiveItemCategory("");
                  }}
                  type="button"
                >
                  {type === "service" ? "Services" : type === "product" ? "Products" : "Packages"}
                </button>
              ))}
            </div>

            <div className="service-select-tabs" aria-label="Item categories">
              {itemCategories.map((category) => (
                <button
                  className={category === visibleItemCategory ? "selected" : ""}
                  key={category}
                  onClick={() => activeItemType === "service"
                    ? setActiveServiceCategory(category)
                    : setActiveItemCategory(category)}
                  type="button"
                >
                  <span>{getCategoryInitial(category)}</span>
                  {category}
                </button>
              ))}
            </div>

            <div className="service-select-list">
              {activeItemType === "service" && visibleServices.length ? (
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
                      setIsServicePickerOpen(false);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" className="appointment-service-glyph">
                      {"\u2726"}
                    </span>
                    <strong>{service.name}</strong>
                    <small>{service.price}</small>
                    <em>{formatServiceDuration(service.durationMinutes)}</em>
                  </button>
                ))
              ) : activeItemType === "product" && visibleProducts.length ? (
                visibleProducts.map((product) => (
                  <button
                    className={selectedProductIds.includes(product.id) ? "selected" : ""}
                    key={product.id}
                    onClick={() => {
                      setSelectedProductIds((current) => [...current, product.id]);
                      setIsServicePickerOpen(false);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" className="appointment-service-glyph">P</span>
                    <strong>{product.name}</strong>
                    <small>RM{product.price}</small>
                    <em>{countOccurrences(selectedProductIds, product.id) || ""}</em>
                  </button>
                ))
              ) : activeItemType === "package" && visiblePackages.length ? (
                visiblePackages.map((item) => (
                  <button
                    className={selectedPackageIds.includes(item.id) ? "selected" : ""}
                    key={item.id}
                    onClick={() => {
                      setSelectedPackageIds((current) => [...current, item.id]);
                      setIsServicePickerOpen(false);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" className="appointment-service-glyph">PK</span>
                    <strong>{item.name}</strong>
                    <small>RM{item.price}</small>
                    <em>{item.totalUses} uses</em>
                  </button>
                ))
              ) : <p>No items in this category.</p>}
            </div>

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
  blockedSlots,
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
  isSalonBusiness,
}: {
  appointmentsBySlot: Map<string, AppointmentCalendarItem[]>;
  blockedSlots: Map<string, { endTime: string }>;
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
  isSalonBusiness: boolean;
}) {
  const isPastSlot = isPastAppointmentSlot(selectedDate, time);

  return (
    <>
      <div className="appointment-calendar-time">{time}</div>
      {staffSlots.map((staff, index) => {
        const key = `${selectedDate}T${time}::${staff.id ?? `empty-${index}`}`;
        const appointments = appointmentsBySlot.get(key) ?? [];
        const blockedSlot = blockedSlots.get(key);
        const isDropTarget = dropTarget === key;

        return (
          <div
            className={`appointment-calendar-slot ${isDropTarget ? "is-drop-target" : ""} ${
              isPastSlot ? "is-past" : ""
            }`}
            key={key}
            onDragOver={(event) => {
              if (isPastSlot || !staff.id || blockedSlot) {
                return;
              }

              event.preventDefault();
              onDragOver(key);
            }}
            onDrop={(event) => {
              if (isPastSlot || !staff.id || blockedSlot) {
                return;
              }

              event.preventDefault();
              onDrop(selectedDate, time, staff.id);
            }}
          >
            {staff.id && appointments.length === 0 && !blockedSlot && !isPastSlot ? (
              <button
                aria-label={`New appointment for ${staff.name} at ${formatTimeLabel(time)}`}
                className="appointment-calendar-slot-create"
                onClick={() => onCreate(selectedDate, time, staff.id as string)}
                type="button"
              />
            ) : null}
            {staff.id && appointments.length === 0 && blockedSlot ? (
              <div className="appointment-calendar-slot-blocked" title={`Busy until ${formatTimeLabel(blockedSlot.endTime)}`}>
                <span>Busy</span>
                <small>until {formatTimeLabel(blockedSlot.endTime)}</small>
              </div>
            ) : null}
            {appointments.map((appointment) => (
              <button
                className={`appointment-calendar-card ${
                  isLockedAppointment(appointment) ? "is-converted" : ""
                } ${
                  isCompletedAppointment(appointment) ? "is-completed" : ""
                } ${
                  isPaidAppointment(appointment) ? "is-paid" : ""
                } ${
                  isRefundedAppointment(appointment) ? "is-refunded" : ""
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
                {!isSalonBusiness && appointment.plateNumber ? (
                  <span>{appointment.plateNumber}</span>
                ) : null}
                <small>
                  {getAppointmentCardStatusLabel(appointment)}
                  {false
                    ? " · Completed"
                    : false
                      ? " · In Progress"
                      : ""}
                </small>
                <small className="appointment-calendar-card-time">
                  {formatAppointmentTimeRange(appointment)}
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

function canAppendCompletedItems(appointment: AppointmentCalendarItem) {
  return (
    appointment.status === "COMPLETED" &&
    !appointment.invoiceId &&
    !isPaidAppointment(appointment)
  );
}

function canAddAppointmentItems(appointment: AppointmentCalendarItem) {
  return !isLockedAppointment(appointment) || canAppendCompletedItems(appointment);
}

function canEditAppointmentItem(
  appointment: AppointmentCalendarItem,
  type: "service" | "product" | "package",
) {
  void type;
  return !isLockedAppointment(appointment) || canAppendCompletedItems(appointment);
}

function isCompletedPaidAppointment(appointment: AppointmentCalendarItem) {
  return appointment.workOrderStatus === "COMPLETED" && appointment.workOrderPaymentStatus === "PAID";
}

function isCompletedAppointment(appointment: AppointmentCalendarItem) {
  return appointment.status === "COMPLETED" || isCompletedPaidAppointment(appointment);
}

function isPaidAppointment(appointment: AppointmentCalendarItem) {
  return appointment.invoiceStatus === "PAID" || appointment.workOrderPaymentStatus === "PAID";
}

function isRefundedAppointment(appointment: AppointmentCalendarItem) {
  return appointment.invoiceStatus === "REFUNDED" || appointment.workOrderPaymentStatus === "REFUNDED";
}

function getAppointmentCardStatusLabel(appointment: AppointmentCalendarItem) {
  if (isRefundedAppointment(appointment)) {
    return "Refunded";
  }

  if (isPaidAppointment(appointment)) {
    return "Paid";
  }

  const label = formatAppointmentStatus(appointment.status);
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderSalonAppointmentAction(
  appointment: AppointmentCalendarItem,
  onStatusChange: (status: "COMPLETED") => void,
) {
  const action = getSalonAppointmentAction(appointment);
  const isRefunded = isRefundedAppointment(appointment);
  const balance = appointment.invoiceBalance ?? 0;

  if (!action) {
    if (appointment.status !== "COMPLETED") {
      return null;
    }

    return (
      <div className="appointment-detail-actions">
        <span className={`appointment-detail-complete ${isRefunded ? "is-refunded" : ""}`}>
          {isRefunded ? "Refunded" : "Service completed"}
        </span>
        {appointment.invoiceId ? (
          <div className={`appointment-detail-payment-summary ${isRefunded ? "is-refunded" : ""}`}>
            <span>
              {appointment.invoiceStatus ?? "Unpaid"} · Paid RM
              {(appointment.invoicePaidAmount ?? 0).toFixed(2)}
            </span>
            {isRefunded ? <strong>Invoice closed</strong> : balance > 0 ? <strong>Balance RM{balance.toFixed(2)}</strong> : null}
          </div>
        ) : null}
        {appointment.invoiceId && !isRefunded ? (
          <Link className="appointment-detail-action primary" href={`/invoices?invoice=${appointment.invoiceId}`}>
            View invoice
          </Link>
        ) : null}
        {!appointment.invoiceId && !isRefunded ? (
          <Link className="appointment-detail-action primary" href={`/cashier?appointmentId=${appointment.id}`}>
            Payment &amp; Invoice
          </Link>
        ) : null}
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
    </div>
  );
}

function clearAppointmentQueryFromAddress() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("appointment") && !url.searchParams.has("checkout")) {
    return;
  }

  url.searchParams.delete("appointment");
  url.searchParams.delete("checkout");
  window.history.replaceState(window.history.state, "", url.toString());
}

function getSalonAppointmentAction(appointment: AppointmentCalendarItem) {
  if (["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE"].includes(appointment.status)) {
    return {
      disabledReason:
        appointment.serviceDetails.length === 0 ? "Select service first" : undefined,
      label: "Complete service",
      status: "COMPLETED" as const,
    };
  }

  return null;
}

function isTodayDateValue(dateValue: string) {
  return dateValue === getBusinessTodayDateValue();
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
  const slotDate = parseBusinessDateTime(dateValue, timeValue);

  return slotDate.getTime() < Date.now();
}

function isEarlierThanPastVisibilityWindow(dateValue: string, timeValue: string) {
  const slotDate = parseBusinessDateTime(dateValue, timeValue);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  return slotDate.getTime() < oneHourAgo;
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
  const selectedMonth = currentDate.getUTCMonth();
  const selectedYear = currentDate.getUTCFullYear();
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
    const [hour, rawMinute] = toTimeValue(scheduledAt).split(":");
    const minute = Math.floor(Number(rawMinute) / 15) * 15;
    const key = `${date}T${hour}:${String(minute).padStart(2, "0")}::${appointment.staffId ?? "unassigned"}`;
    const current = grouped.get(key) ?? [];
    current.push(appointment);
    grouped.set(key, current);
  });

  return grouped;
}

function groupBlockedAppointmentSlots(appointments: AppointmentCalendarItem[]) {
  const blocked = new Map<string, { endTime: string }>();

  appointments.forEach((appointment) => {
    if (!appointment.staffId) {
      return;
    }

    const scheduledAt = new Date(appointment.scheduledAt);
    const slotCount = getAppointmentSlotCount(appointment.durationMinutes);
    const endAt = new Date(scheduledAt.getTime() + slotCount * 15 * 60_000);

    for (let index = 1; index < slotCount; index += 1) {
      const slotAt = new Date(scheduledAt.getTime() + index * 15 * 60_000);
      const date = toDateValue(slotAt);
      const time = toTimeValue(slotAt);
      blocked.set(`${date}T${time}::${appointment.staffId}`, {
        endTime: toTimeValue(endAt),
      });
    }
  });

  return blocked;
}

function buildAppointmentWeekDays(dateValue: string, dateCountByDay: Map<string, number>) {
  const weekStart = startOfBusinessWeek(dateValue);

  return Array.from({ length: 7 }, (_, index) => {
    const nextDateValue = addBusinessDaysToDateValue(weekStart, index);

    return {
      count: dateCountByDay.get(nextDateValue) ?? 0,
      date: nextDateValue,
      shortLabel: formatDateValue(nextDateValue, {
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
  return toBusinessDateValue(date);
}

function toTimeValue(date: Date) {
  return toBusinessTimeValue(date);
}

function monthValueToDate(monthValue: string) {
  return dateValueToUtcDate(`${monthValue}-01`);
}

function addMonthsToMonthValue(monthValue: string, amount: number) {
  return addMonthsToDateValue(`${monthValue}-01`, amount).slice(0, 7);
}

function addDaysToDateValue(dateValue: string, amount: number) {
  return addBusinessDaysToDateValue(dateValue, amount);
}

function toMonthValue(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function clampDraftDateToMonth(currentDateValue: string, nextMonthValue: string) {
  const currentDay = Number(currentDateValue.slice(8, 10)) || 1;
  const [year, month] = nextMonthValue.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(currentDay, daysInMonth);

  return `${nextMonthValue}-${String(day).padStart(2, "0")}`;
}

function buildDatePickerDays(monthDate: Date, countByDay: Map<string, number>) {
  const monthStart = new Date(monthDate);
  monthStart.setUTCDate(1);
  const monthStartValue = utcDateToDateValue(monthStart);
  const gridStartValue = startOfBusinessWeek(monthStartValue);

  return Array.from({ length: 42 }, (_, index) => {
    const dateValue = addBusinessDaysToDateValue(gridStartValue, index);
    const date = dateValueToUtcDate(dateValue);

    return {
      count: countByDay.get(dateValue) ?? 0,
      date: dateValue,
      day: date.getUTCDate(),
      isCurrentMonth: date.getUTCMonth() === monthStart.getUTCMonth(),
    };
  });
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
  return formatTimeLabel(toBusinessTimeValue(dateValue));
}

function formatAppointmentTimeRange(appointment: AppointmentCalendarItem) {
  const scheduledAt = new Date(appointment.scheduledAt);
  const endAt = new Date(scheduledAt.getTime() + appointment.durationMinutes * 60_000);

  return `${formatTimeLabelFromDate(appointment.scheduledAt)} - ${formatTimeLabelFromDate(
    endAt.toISOString(),
  )}`;
}

function formatLongDate(dateValue: string) {
  return formatDateValue(dateValue, {
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

function isFailedAppointmentMutation(
  result: unknown,
): result is { error: string; ok: false } {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === false
  );
}

function getServiceCategories(services: { category: string }[]) {
  return [...new Set(services.map((service) => service.category).filter(Boolean))];
}

function getRecentServices<T extends { id: string }>(
  services: T[],
  recentServiceIds: string[],
  limit: number,
) {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const recent = recentServiceIds
    .map((serviceId) => serviceById.get(serviceId))
    .filter((service): service is T => Boolean(service));
  const recentIds = new Set(recent.map((service) => service.id));

  if (recent.length >= limit) {
    return recent.slice(0, limit);
  }

  return [
    ...recent,
    ...services.filter((service) => !recentIds.has(service.id)),
  ].slice(0, limit);
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
