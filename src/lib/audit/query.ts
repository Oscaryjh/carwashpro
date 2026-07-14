export type AuditLogFilters = {
  actorUserId?: string | null;
  action?: string | null;
  entityType?: string | null;
  from?: Date | null;
  to?: Date | null;
};

export function buildAuditLogWhere(
  businessId: string,
  filters: AuditLogFilters = {},
) {
  return {
    businessId,
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };
}
