/** Input must already be restricted to the user's authorised locations for this use case. */
export function selectedOrOnlyBranch<T extends { id: string }>(branches: T[], requestedId?: string | null): T | undefined {
  if (requestedId) return branches.find((branch) => branch.id === requestedId);
  return branches.length === 1 ? branches[0] : undefined;
}
