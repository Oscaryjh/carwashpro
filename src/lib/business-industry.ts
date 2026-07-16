import type { BusinessIndustry } from "@prisma/client";

export const BUSINESS_INDUSTRY_OPTIONS: Array<{
  value: BusinessIndustry;
  label: string;
}> = [
  { value: "AUTO_DETAILING", label: "Auto Detailing" },
  { value: "SALON_BEAUTY", label: "Salon & Beauty" },
];

export function getBusinessIndustryLabel(industry: BusinessIndustry) {
  return (
    BUSINESS_INDUSTRY_OPTIONS.find((option) => option.value === industry)?.label ??
    industry
  );
}

export function getBusinessHomeHref(industry: BusinessIndustry) {
  return industry === "SALON_BEAUTY" ? "/salon/dashboard" : "/dashboard";
}
