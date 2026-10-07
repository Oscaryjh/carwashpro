import type { CustomerPackageActivityType, CustomerPackageStatus } from "@prisma/client";

/** Authenticated server context, not a client-supplied role or grant. */
export type PackageHubContext = { businessId: string; user: { userId: string }; branchId?: string | null };
export type PackageHubWindow = { fromDate: Date; toDateExclusive: Date };
export type PackageHubFilters = { cursor?: string | null; search?: string; packageId?: string; packageSearch?: string };
export type PackageHubActivityInput = PackageHubWindow & PackageHubFilters & { eventType?: CustomerPackageActivityType };
export type PackageHubCurrentInput = PackageHubFilters & { status?: CustomerPackageStatus };
export type PackageHubPage<T> = { rows: T[]; nextCursor: string | null; pageSize: 20 };
