export const GROUP_STORE_COMPARISON_MIN = 2;
export const GROUP_STORE_COMPARISON_MAX = 4;

export type GroupStoreComparisonQuery = string | string[] | undefined;

export type GroupStoreComparisonSelection = {
  ids: string[];
  error: string | null;
  isDefault: boolean;
};

export function resolveGroupStoreComparisonSelection(
  query: GroupStoreComparisonQuery,
  rankedBusinessIds: readonly string[],
): GroupStoreComparisonSelection {
  const availableIds = uniqueNonEmpty(rankedBusinessIds);

  if (query === undefined) {
    return {
      ids: availableIds.slice(0, GROUP_STORE_COMPARISON_MIN),
      error: null,
      isDefault: true,
    };
  }

  const requestedIds = uniqueNonEmpty(
    (Array.isArray(query) ? query : [query]).flatMap((value) =>
      value.split(","),
    ),
  );
  const availableSet = new Set(availableIds);
  const containsUnavailableStore = requestedIds.some(
    (businessId) => !availableSet.has(businessId),
  );
  const selectedSet = new Set(
    requestedIds.filter((businessId) => availableSet.has(businessId)),
  );
  const ids = availableIds.filter((businessId) => selectedSet.has(businessId));

  if (containsUnavailableStore) {
    return {
      ids,
      error: "One or more selected stores are not available in this report.",
      isDefault: false,
    };
  }

  if (ids.length < GROUP_STORE_COMPARISON_MIN) {
    return {
      ids,
      error: `Select at least ${GROUP_STORE_COMPARISON_MIN} stores to compare.`,
      isDefault: false,
    };
  }

  if (ids.length > GROUP_STORE_COMPARISON_MAX) {
    return {
      ids,
      error: `Select no more than ${GROUP_STORE_COMPARISON_MAX} stores to compare.`,
      isDefault: false,
    };
  }

  return { ids, error: null, isDefault: false };
}

function uniqueNonEmpty(values: readonly string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
