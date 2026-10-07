import { BUSINESS_TIME_ZONE } from "../business-time";

type PackageDisplayOption = {
  id: string;
  customerPackageId: string;
  name: string;
  serviceName: string;
  remainingUses: number;
  totalUses: number;
  purchasedAt?: string | null;
};

// Presentation only: map labels by the existing service-balance identity.
export function packageOptionDateLabels(options: readonly PackageDisplayOption[]) {
  const dates = options.map(option => {
    const date = option.purchasedAt ? new Date(option.purchasedAt) : null;
    return date && Number.isFinite(date.getTime())
      ? `Purchased ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(date)}`
      : "";
  });
  const keys = options.map((option, index) => JSON.stringify([
    option.name, option.serviceName, option.remainingUses, option.totalUses, dates[index],
  ]));
  return new Map(options.map((option, index) => {
    const collisions = options.filter((other, otherIndex) => keys[otherIndex] === keys[index] && other.customerPackageId !== option.customerPackageId);
    if (dates[index] && !collisions.length) return [option.id, dates[index]];
    const identity = option.customerPackageId.replaceAll("-", "").toUpperCase();
    let length = 4;
    while (length < identity.length && collisions.some(other => other.customerPackageId.replaceAll("-", "").toUpperCase().slice(-length) === identity.slice(-length))) length++;
    return [option.id, [dates[index], `#${identity.slice(-length)}`].filter(Boolean).join(" · ")];
  }));
}
