import type { BusinessIndustry } from "@prisma/client";

export type IndustryConfig = {
  industryType: BusinessIndustry;
  label: string;
  customerLabel: string;
  customerPluralLabel: string;
  subjectLabel: string;
  subjectPluralLabel: string;
  subjectIdentifierLabel: string;
  subjectIdentifierHint: string;
  orderLabel: string;
  orderPluralLabel: string;
  pickupStatusLabel: string;
  pickupActionLabel: string;
  usesVehicleFields: boolean;
};

export const INDUSTRY_CONFIG: Record<BusinessIndustry, IndustryConfig> = {
  AUTO_DETAILING: {
    industryType: "AUTO_DETAILING",
    label: "Auto Detailing",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Vehicle",
    subjectPluralLabel: "Vehicles",
    subjectIdentifierLabel: "Plate number",
    subjectIdentifierHint: "Enter plate number",
    orderLabel: "Job",
    orderPluralLabel: "Jobs",
    pickupStatusLabel: "Ready for pickup",
    pickupActionLabel: "Vehicle collected",
    usesVehicleFields: true,
  },
  SALON_BEAUTY: {
    industryType: "SALON_BEAUTY",
    label: "Beauty & Wellness",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Customer",
    subjectPluralLabel: "Customers",
    subjectIdentifierLabel: "Phone number",
    subjectIdentifierHint: "Search by customer name or phone",
    orderLabel: "Appointment",
    orderPluralLabel: "Appointments",
    pickupStatusLabel: "Service completed",
    pickupActionLabel: "Complete service",
    usesVehicleFields: false,
  },
  PET_GROOMING: {
    industryType: "PET_GROOMING",
    label: "Pet Grooming",
    customerLabel: "Pet owner",
    customerPluralLabel: "Pet owners",
    subjectLabel: "Pet",
    subjectPluralLabel: "Pets",
    subjectIdentifierLabel: "Pet name",
    subjectIdentifierHint: "Search by pet or owner name",
    orderLabel: "Grooming order",
    orderPluralLabel: "Grooming orders",
    pickupStatusLabel: "Ready for pickup",
    pickupActionLabel: "Pet collected",
    usesVehicleFields: false,
  },
  DEVICE_REPAIR: {
    industryType: "DEVICE_REPAIR",
    label: "Phone & Computer Repair",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Device",
    subjectPluralLabel: "Devices",
    subjectIdentifierLabel: "IMEI or serial number",
    subjectIdentifierHint: "Enter IMEI, serial number, or device name",
    orderLabel: "Repair order",
    orderPluralLabel: "Repair orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Device collected",
    usesVehicleFields: false,
  },
  BICYCLE_REPAIR: {
    industryType: "BICYCLE_REPAIR",
    label: "Bicycle Repair",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Bicycle",
    subjectPluralLabel: "Bicycles",
    subjectIdentifierLabel: "Bicycle reference",
    subjectIdentifierHint: "Enter bicycle reference or description",
    orderLabel: "Repair order",
    orderPluralLabel: "Repair orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Bicycle collected",
    usesVehicleFields: false,
  },
  SHOE_CLEANING: {
    industryType: "SHOE_CLEANING",
    label: "Shoe Cleaning",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Item",
    subjectPluralLabel: "Items",
    subjectIdentifierLabel: "Item reference",
    subjectIdentifierHint: "Enter item reference or description",
    orderLabel: "Cleaning order",
    orderPluralLabel: "Cleaning orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Item collected",
    usesVehicleFields: false,
  },
  LAUNDRY: {
    industryType: "LAUNDRY",
    label: "Laundry",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Laundry order",
    subjectPluralLabel: "Laundry orders",
    subjectIdentifierLabel: "Order reference",
    subjectIdentifierHint: "Enter order reference or customer name",
    orderLabel: "Laundry order",
    orderPluralLabel: "Laundry orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Laundry collected",
    usesVehicleFields: false,
  },
  WATCH_REPAIR: {
    industryType: "WATCH_REPAIR",
    label: "Watch Repair",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Watch",
    subjectPluralLabel: "Watches",
    subjectIdentifierLabel: "Watch reference",
    subjectIdentifierHint: "Enter watch reference or serial number",
    orderLabel: "Repair order",
    orderPluralLabel: "Repair orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Watch collected",
    usesVehicleFields: false,
  },
  GENERAL_SERVICE: {
    industryType: "GENERAL_SERVICE",
    label: "General Service",
    customerLabel: "Customer",
    customerPluralLabel: "Customers",
    subjectLabel: "Service item",
    subjectPluralLabel: "Service items",
    subjectIdentifierLabel: "Item reference",
    subjectIdentifierHint: "Enter item reference or description",
    orderLabel: "Service order",
    orderPluralLabel: "Service orders",
    pickupStatusLabel: "Ready for collection",
    pickupActionLabel: "Item collected",
    usesVehicleFields: false,
  },
};

export function getIndustryConfig(
  industryType: BusinessIndustry | null | undefined,
): IndustryConfig {
  return industryType
    ? INDUSTRY_CONFIG[industryType] ?? INDUSTRY_CONFIG.AUTO_DETAILING
    : INDUSTRY_CONFIG.AUTO_DETAILING;
}
