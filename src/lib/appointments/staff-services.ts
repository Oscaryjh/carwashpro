type StaffAssignedService = {
  id: string;
  staffIds: string[];
};

export function getServicesForStaff<T extends StaffAssignedService>(
  services: T[],
  staffId: string,
) {
  if (!staffId) {
    return [];
  }

  return services.filter((service) => service.staffIds.includes(staffId));
}

export function reconcileServicesForStaff(
  selectedServiceIds: string[],
  services: StaffAssignedService[],
  staffId: string,
) {
  const eligibleServiceIds = new Set(
    getServicesForStaff(services, staffId).map((service) => service.id),
  );
  const retainedServiceIds = selectedServiceIds.filter((serviceId) =>
    eligibleServiceIds.has(serviceId),
  );

  return {
    removedCount: selectedServiceIds.length - retainedServiceIds.length,
    retainedServiceIds,
  };
}
