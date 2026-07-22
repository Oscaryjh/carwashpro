import type { BusinessIndustry } from "@prisma/client";

export const BUSINESS_INDUSTRY_OPTIONS: Array<{
  value: BusinessIndustry;
  label: string;
}> = [
  { value: "AUTO_DETAILING", label: "Auto Detailing" },
  { value: "SALON_BEAUTY", label: "Beauty & Wellness" },
  { value: "PET_GROOMING", label: "Pet Grooming" },
  { value: "DEVICE_REPAIR", label: "Phone & Computer Repair" },
  { value: "BICYCLE_REPAIR", label: "Bicycle Repair" },
  { value: "SHOE_CLEANING", label: "Shoe Cleaning" },
  { value: "LAUNDRY", label: "Laundry" },
  { value: "WATCH_REPAIR", label: "Watch Repair" },
  { value: "GENERAL_SERVICE", label: "General Service" },
];

export function getBusinessIndustryLabel(industry: BusinessIndustry) {
  return (
    BUSINESS_INDUSTRY_OPTIONS.find((option) => option.value === industry)?.label ??
    industry
  );
}

export function getBusinessHomeHref(industry: BusinessIndustry) {
  return industry === "AUTO_DETAILING" ? "/work-orders" : "/cashier";
}
